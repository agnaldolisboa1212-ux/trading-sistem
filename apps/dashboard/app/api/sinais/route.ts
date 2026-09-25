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
import { planoVivo, type EstadoPlano } from '@/lib/estado-sinal';
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

/** Estratégias que trazem o seu próprio timeframe (ver o motor de tempo real). */
const ALGOS = ['ict-algo', 'asia-range-algo'];

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
  /**
   * Quanto o preço já andou desde a entrada, em R.
   *
   * O plano é calculado no fecho da vela; quem abre a aplicação meia hora
   * depois precisa de saber quanto do movimento já foi. Medido no rompimento de
   * 4h: entrar a +0,25R da entrada deita fora 40% da vantagem, e a +0,5R mais
   * de metade — com o mesmo stop, portanto o mesmo risco.
   */
  distanciaR: number | null;
  /** Regra sem taxa de acerto medida. */
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
    // Velas antigas continuam a ser velas fechadas: um stop que elas mostram
    // atingido continua atingido. Melhor do que nenhum estado.
    return guardado?.velas ?? null;
  }
}

/*
 * ── PORQUE SE GUARDAM OS ESTADOS FINAIS ────────────────────────────────────
 *
 * Medido: com a Deriv a responder `RateLimit` a `ticks_history`, `velasDesde`
 * devolvia `null`, o estado ficava por calcular e a lista mostrava como
 * ACTIVOS sinais que tinham ido ao stop dias antes.
 *
 * Um sinal fechado (alvo, stop, sem entrada, expirado) nunca volta a abrir.
 * Guardado aqui, deixa de precisar de velas: os pedidos à Deriv passam a ser só
 * para os sinais ainda vivos, e uma falha da Deriv já não o ressuscita.
 */
interface EstadoFinal {
  estado: EstadoPlano;
  resultadoR: number | null;
  stopActual: number | null;
  ultimoEvento: string | null;
}
const estadosFinais = new Map<string, EstadoFinal>();

/** Quantos grupos instrumento/timeframe pedem velas ao mesmo tempo. */
const PEDIDOS_EM_PARALELO = 3;

async function emLotes<T>(itens: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  const trabalhador = async () => {
    while (i < itens.length) await fn(itens[i++]!);
  };
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, trabalhador));
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
    // Os timeframes do perfil — mais os algos, que trazem o seu (15M) e o motor
    // corre para quem segue o instrumento mesmo sem esse timeframe escolhido.
    .or(`timeframe.in.(${timeframes.join(',')}),estrategia.in.(${ALGOS.join(',')})`)
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
      distanciaR: null,
      emTeste: estrategiaEmTeste(l.estrategia as string) !== undefined,
    }));

  // Sinais já fechados: o estado guardado basta, sem velas.
  for (const s of sinais) {
    const f = estadosFinais.get(s.id);
    if (f) Object.assign(s, f);
  }

  // Estado dos restantes: um pedido de velas por instrumento/timeframe, desde o
  // sinal mais antigo, poucos de cada vez para não esbarrar no limite da Deriv.
  const grupos = new Map<string, SinalDaConta[]>();
  for (const s of sinais) {
    if (s.estado !== null) continue;
    const k = `${s.simbolo}|${s.timeframe}`;
    grupos.set(k, [...(grupos.get(k) ?? []), s]);
  }
  await emLotes([...grupos.values()], PEDIDOS_EM_PARALELO, async (lista) => {
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
      const agora = velas[velas.length - 1]?.close;
      const risco = Math.abs(s.entrada - s.stop);
      s.distanciaR =
        agora !== undefined && risco > 0
          ? ((agora - s.entrada) * (s.direccao === 'bullish' ? 1 : -1)) / risco
          : null;
      if (!planoVivo(s.estado)) {
        if (estadosFinais.size > 2000) estadosFinais.clear();
        estadosFinais.set(s.id, {
          estado: s.estado,
          resultadoR: s.resultadoR,
          stopActual: s.stopActual,
          ultimoEvento: s.ultimoEvento,
        });
      }
    }
  });

  return NextResponse.json(
    { portfolio, timeframes, sinais, ocultarDisponivel },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
