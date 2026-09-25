/**
 * ICT ALGO — a análise de um instrumento, para a secção do gráfico.
 *
 * Corre no servidor porque o algoritmo é top-down e precisa de várias séries
 * ao mesmo tempo — execução, diária (que também dá a semanal e a vela de
 * referência) e o par correlacionado para o SMT. Pedir tudo isso do lado do
 * cliente seriam várias viagens à rede antes do primeiro traço.
 *
 * ── O TRAVÃO DE PORTFÓLIO ──────────────────────────────────────────────────
 *
 * Só analisa instrumentos que estejam no portfólio de QUEM PEDE (a coluna
 * `instrumentos` do perfil, a mesma que filtra os sinais). Fora dele, a rota
 * responde com a razão e não corre nada. Sem sessão, não há portfólio a
 * consultar, e a rota recusa.
 *
 * ── O QUE ESTA ROTA NÃO FAZ ────────────────────────────────────────────────
 *
 * Não inventa nada. Se faltar uma série, devolve a razão; se nenhum modelo
 * montar setup, devolve os passos com o veredicto de cada um. A versão anterior
 * deste painel mostrava um sinal com preços escritos à mão.
 */

import { NextResponse } from 'next/server';
import { velasDeriv } from '@trading/data';
import { agregar, confirmacaoLtf, correrIctAlgo, paresSmtIct, type Candle, type Timeframe } from '@trading/core';
import { acharSimbolo } from '@/lib/deriv/simbolos';
import { clienteServidor } from '@/lib/supabase/servidor';
import { guardarCacheVela, lerCacheVela } from '@/lib/cache-vela';

export const dynamic = 'force-dynamic';
/** Duas séries longas mais o par correlacionado: 60s é folgado mas seguro. */
export const maxDuration = 60;

const GRANULARIDADE_S: Record<string, number> = { '15m': 900, '1h': 3600, '4h': 14400 };
/**
 * Velas do timeframe de execução. O placar de cada modelo precisa de história
 * (as últimas ~3000 velas); a Deriv serve no máximo 5000 por pedido.
 */
const VELAS_EXECUCAO = 3500;

async function fechadas(derivSymbol: string, gran: number, quantas: number): Promise<Candle[]> {
  const brutas = await velasDeriv(derivSymbol, gran, quantas);
  // A Deriv devolve a vela em formação no fim. O algoritmo só lê velas fechadas.
  return brutas.filter((c) => c.time + gran * 1000 <= Date.now());
}

const semCache = { headers: { 'Cache-Control': 'no-store' } };

export async function GET(pedido: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const url = new URL(pedido.url);
  const tfBruto = url.searchParams.get('tf') ?? '1h';
  const tf = (GRANULARIDADE_S[tfBruto] ? tfBruto : '1h') as Timeframe;
  const canonico = symbol.toUpperCase();
  const em = Date.now();

  const s = acharSimbolo(canonico);
  if (!s) return NextResponse.json({ simbolo: canonico, erro: 'instrumento desconhecido' }, { status: 404 });

  // ── Portfólio de quem pede ────────────────────────────────────────────────
  const db = await clienteServidor();
  if (!db) return NextResponse.json({ erro: 'Supabase não configurado' }, { status: 503 });
  const { data: u } = await db.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return NextResponse.json({ erro: 'sem sessão', codigo: 'SemSessao' }, { status: 401 });
  const { data: perfil } = await db
    .from('perfis_utilizador')
    .select('instrumentos')
    .eq('utilizador_id', uid)
    .maybeSingle();
  const portfolio = ((perfil?.['instrumentos'] as string[] | null) ?? []).map((c) => c.toUpperCase());
  if (portfolio.length === 0) {
    return NextResponse.json(
      { simbolo: s.codigo, analise: null, porqueNao: 'O portfólio está vazio — escolha os instrumentos nas Definições.', em },
      semCache,
    );
  }
  if (!portfolio.includes(s.codigo.toUpperCase())) {
    return NextResponse.json(
      {
        simbolo: s.codigo,
        analise: null,
        porqueNao: `${s.codigo} não está no seu portfólio — o ICT ALGO não analisa instrumentos fora dele.`,
        em,
      },
      semCache,
    );
  }

  // O par correlacionado: sem ele o Venom (que exige SMT) não pode emitir. Os
  // outros modelos não precisam dele.
  // O primeiro par correlacionado que a Deriv serve (ver `paresSmtIct`).
  const parSimbolo = paresSmtIct(s.codigo).map((c) => acharSimbolo(c)).find((x) => x) ?? null;
  const parCodigo = parSimbolo?.codigo ?? null;

  // Depois do travão de portfólio (que vale para cada pessoa) e antes de pedir
  // velas à Deriv: até ao fecho da próxima vela a análise é a mesma, e a aba
  // pergunta a cada minuto (ver lib/cache-vela.ts).
  const chaveCache = `ict|${s.codigo}|${tf}`;
  const guardado = lerCacheVela<Record<string, unknown>>(chaveCache, tf);
  if (guardado) return NextResponse.json(guardado, semCache);

  try {
    const gran = GRANULARIDADE_S[tf]!;
    const [execucao, diarias, parVelas, velas5m] = await Promise.all([
      fechadas(s.deriv, gran, VELAS_EXECUCAO),
      fechadas(s.deriv, 86_400, 400),
      parSimbolo ? fechadas(parSimbolo.deriv, gran, VELAS_EXECUCAO).catch(() => []) : Promise.resolve([]),
      // 5M: a confirmação do sinal (a mesma que o motor exige para o enviar).
      fechadas(s.deriv, 300, 300).catch(() => []),
    ]);

    // A Deriv não serve velas semanais: agregam-se das diárias, alinhadas ao
    // domingo como a semana do forex.
    const semanais = agregar(diarias, '1w');

    const analise = correrIctAlgo({
      simbolo: s.codigo,
      timeframe: tf,
      velas: execucao,
      diarias,
      semanais,
      // O site: "Prior daily candle (when entering on 1H or 15M)".
      referencia: diarias,
      timeframeReferencia: '1d',
      par: parSimbolo && parVelas.length > 0 ? { simbolo: parSimbolo.codigo, velas: parVelas } : null,
      portfolio,
    });
    if (analise.sinal) {
      const ult = execucao[execucao.length - 1];
      analise.confirmacao = confirmacaoLtf(
        velas5m,
        analise.sinal.direccao,
        (ult?.time ?? Date.now()) + GRANULARIDADE_S[tf]! * 1000,
      );
    }

    const corpo = { simbolo: s.codigo, nome: s.nome, timeframe: tf, par: parCodigo, analise, em };
    const ultimaVela = execucao[execucao.length - 1]?.time;
    if (ultimaVela !== undefined) guardarCacheVela(chaveCache, tf, ultimaVela, corpo);
    return NextResponse.json(corpo, semCache);
  } catch (e) {
    return NextResponse.json(
      { simbolo: s.codigo, analise: null, porqueNao: `Falha a obter as velas: ${e instanceof Error ? e.message : String(e)}`, em },
      { status: 502, ...semCache },
    );
  }
}
