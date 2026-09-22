/**
 * Os sinais de tempo real de QUEM PEDE.
 *
 *   só do portfólio   instrumentos que a conta escolheu (perfil); portfólio
 *                     vazio = lista vazia, e o ecrã diz como a encher
 *   sem os eliminados tabela `sinais_ocultos` (migração 0006)
 *   com estado        à espera, em curso, alvo, invalidado (stop, sem entrada,
 *                     expirado) — calculado sobre as velas da Deriv desde o
 *                     fecho da vela do sinal
 *   ordenados         pelo momento do anúncio, mais recente primeiro
 *
 * As velas pedem-se uma vez por instrumento/timeframe e ficam um minuto em
 * memória: vinte pessoas a abrir o início não são vinte pedidos à Deriv.
 */

import { NextResponse } from 'next/server';
import {
  acompanharOperacao,
  estrategiaEmTeste,
  fraseEvento,
  timeframesDoPerfil,
  type Acompanhamento,
  type Candle,
} from '@trading/core';
import { velasDeriv } from '@trading/data';
import { acharSimbolo } from '@/lib/deriv/simbolos';
import type { EstadoPlano } from '@/lib/estado-sinal';
import { clienteServidor } from '@/lib/supabase/servidor';

export const dynamic = 'force-dynamic';

const GRANULARIDADE_S: Record<string, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
};

/** Sinais mais antigos do que isto não entram na lista. */
const JANELA_DIAS = 7;

export interface SinalDaConta {
  id: string;
  simbolo: string;
  timeframe: string;
  estrategia: string;
  direccao: 'bullish' | 'bearish';
  entrada: number;
  stop: number;
  alvos: Array<{ preco: number; r: number }>;
  rMaximo: number;
  conviccao: number;
  razao: string;
  geradoEm: string;
  anunciadoEm: string;
  estado: EstadoPlano | null;
  /** Resultado em R quando a operação já fechou (gestão da estratégia). */
  resultadoR: number | null;
  /** Último acontecimento, em texto: "+1R atingido", "stop móvel subiu"... */
  ultimoEvento: string | null;
  /** Stop em vigor (sobe com a protecção ou o stop móvel). */
  stopActual: number | null;
  /** Estratégia em teste ao vivo: sem taxa de acerto medida. */
  emTeste: boolean;
}

/** O estado do acompanhamento na linguagem da lista. */
function estadoDaLista(a: Acompanhamento): EstadoPlano {
  switch (a.estado) {
    case 'a-aguardar-entrada':
      return 'a-aguardar-entrada';
    case 'em-curso':
    case 'protegida':
      return 'em-curso';
    case 'fechada':
      return (a.resultadoR ?? 0) > 0 ? 'alvo-atingido' : 'stop-atingido';
    case 'expirado':
      return 'expirado';
    case 'perdido':
      return 'perdido';
  }
}

const memoriaVelas = new Map<string, { ate: number; velas: Candle[] }>();

/** Velas desde o sinal mais antigo, com 60 de história antes (médias, mínimos, viés). */
async function velasDesde(simbolo: string, timeframe: string, desdeMs: number): Promise<Candle[] | null> {
  const s = acharSimbolo(simbolo);
  const gran = GRANULARIDADE_S[timeframe];
  if (!s || !gran) return null;
  const chave = `${s.deriv}|${gran}`;
  const guardado = memoriaVelas.get(chave);
  const precisa = Math.min(1000, Math.ceil((Date.now() - desdeMs) / (gran * 1000)) + 63);
  if (guardado && guardado.ate > Date.now() && guardado.velas.length >= precisa) return guardado.velas;
  try {
    // Só velas FECHADAS: a que está em formação ainda pode mudar o estado.
    const velas = (await velasDeriv(s.deriv, gran, precisa)).filter((c) => c.time + gran * 1000 <= Date.now());
    if (memoriaVelas.size > 200) memoriaVelas.clear();
    memoriaVelas.set(chave, { ate: Date.now() + 60_000, velas });
    return velas;
  } catch {
    return null;
  }
}

export async function GET() {
  const db = await clienteServidor();
  if (!db) return NextResponse.json({ erro: 'Supabase não configurado' }, { status: 503 });

  const { data: u } = await db.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return NextResponse.json({ erro: 'sem sessão', codigo: 'SemSessao' }, { status: 401 });

  let consulta: { data: Record<string, unknown> | null; error: { message: string } | null } = await db
    .from('perfis_utilizador')
    .select('instrumentos,objetivos,timeframes_sinais')
    .eq('utilizador_id', uid)
    .maybeSingle();
  if (consulta.error) {
    // Migração 0008 por aplicar.
    consulta = await db.from('perfis_utilizador').select('instrumentos,objetivos').eq('utilizador_id', uid).maybeSingle();
  }
  const perfil = consulta.data;
  const portfolio = ((perfil?.['instrumentos'] as string[] | null) ?? []).map((c) => c.toUpperCase());
  // Os timeframes escolhidos nas Definições; sem escolha, os do objetivo do onboarding.
  const timeframes = timeframesDoPerfil(
    perfil?.['objetivos'] as string[] | null,
    perfil?.['timeframes_sinais'] as string[] | null,
  );

  let ocultos = new Set<string>();
  let ocultarDisponivel = true;
  {
    const { data, error } = await db.from('sinais_ocultos').select('sinal_id').eq('utilizador_id', uid);
    if (error) ocultarDisponivel = false;
    else ocultos = new Set((data ?? []).map((l) => l.sinal_id as string));
  }

  if (portfolio.length === 0) {
    return NextResponse.json(
      { portfolio, timeframes, sinais: [], ocultarDisponivel },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const desde = new Date(Date.now() - JANELA_DIAS * 86_400_000).toISOString();
  const { data: linhas, error } = await db
    .from('sinais_tempo_real')
    .select('id,simbolo,timeframe,estrategia,direccao,entrada,stop,alvos,r_maximo,conviccao,razao,gerado_em,criado_em')
    .in('simbolo', portfolio)
    .in('timeframe', timeframes)
    .gte('criado_em', desde)
    .order('criado_em', { ascending: false })
    .limit(80);
  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }

  const sinais: SinalDaConta[] = (linhas ?? [])
    /*
     * Não se filtra por estratégia activa.
     *
     * Filtrar aqui fazia DESAPARECER operações reais: ao retirar uma regra do
     * catálogo, os sinais que ela tinha anunciado — incluindo os que estavam
     * abertos com dinheiro em risco — saíam da lista e do histórico, como se
     * nunca tivessem existido. O catálogo manda no que se GERA; o que já foi
     * anunciado é registo e fica. O nome de uma estratégia retirada resolve-se
     * para o próprio id, que é honesto.
     */
    .filter((l) => !ocultos.has(l.id))
    .map((l) => ({
      id: l.id,
      simbolo: l.simbolo,
      timeframe: l.timeframe,
      estrategia: l.estrategia,
      direccao: l.direccao,
      entrada: Number(l.entrada),
      stop: Number(l.stop),
      alvos: Array.isArray(l.alvos) ? l.alvos : [],
      rMaximo: Number(l.r_maximo),
      conviccao: Number(l.conviccao),
      razao: l.razao ?? '',
      geradoEm: l.gerado_em,
      anunciadoEm: l.criado_em,
      estado: null,
      resultadoR: null,
      ultimoEvento: null,
      stopActual: null,
      emTeste: estrategiaEmTeste(l.estrategia as string) !== undefined,
    }));

  // Estado: um pedido de velas por instrumento/timeframe, desde o sinal mais antigo.
  const grupos = new Map<string, SinalDaConta[]>();
  for (const s of sinais) {
    const k = `${s.simbolo}|${s.timeframe}`;
    grupos.set(k, [...(grupos.get(k) ?? []), s]);
  }
  await Promise.all(
    [...grupos.values()].map(async (lista) => {
      const primeiro = lista[0]!;
      const maisAntigo = Math.min(...lista.map((s) => Date.parse(s.geradoEm)));
      const velas = await velasDesde(primeiro.simbolo, primeiro.timeframe, maisAntigo);
      if (!velas) return;
      const casas = acharSimbolo(primeiro.simbolo)?.casas ?? 2;
      for (const s of lista) {
        // A mesma leitura que o motor usa para avisar o andamento.
        const a = acompanharOperacao(
          {
            estrategia: s.estrategia,
            direccao: s.direccao,
            entrada: s.entrada,
            stop: s.stop,
            alvos: s.alvos,
            geradoEm: Date.parse(s.geradoEm),
          },
          velas,
        );
        s.estado = estadoDaLista(a);
        s.resultadoR = a.resultadoR;
        s.stopActual = a.stopActual;
        const ultimo = a.eventos[a.eventos.length - 1];
        s.ultimoEvento = ultimo ? fraseEvento(ultimo, casas, s.estrategia).titulo : null;
      }
    }),
  );

  return NextResponse.json(
    { portfolio, timeframes, sinais, ocultarDisponivel },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
