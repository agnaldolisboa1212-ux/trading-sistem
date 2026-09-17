/**
 * Estratégias EM TESTE AO VIVO — geram sinais, mas SEM vantagem medida.
 *
 * ── PORQUE EXISTEM ─────────────────────────────────────────────────────────
 *
 * No backtest nenhuma regra passou nos pares de forex que se operam (EURUSD,
 * GBPUSD, GBPJPY, USDJPY). Em vez de os deixar sem sinais, duas regras correm
 * ao vivo durante uma semana e os resultados reais decidem se ficam:
 *
 *   vwap-forex-teste  a regra do VWAP dos índices levada para o forex, nos dois
 *                     sentidos (as moedas não têm a deriva de subida dos índices)
 *   smt-teste         SMT isolado, sem MMXM: divergência entre pares
 *                     correlacionados (EURUSD↔GBPUSD↔DXY, ouro↔prata↔DXY)
 *
 * O que o backtest disse (2022–2026, HistData, com spread), para quem ler os
 * resultados da semana com o contexto certo:
 *
 *   SMT no forex        ≈ 0R ou negativo em todos os tamanhos de swing
 *   SMT ouro × DXY      +0,15R por operação em 1h, positivo nos dois períodos,
 *                       só a favor da tendência de 4h — a variante escolhida aqui
 *   VWAP ±2σ no forex   não medido nesta forma
 *
 * A convicção destes sinais é 0: não há taxa de acerto medida para mostrar, e
 * um número inventado seria pior do que nenhum.
 *
 * PUREZA: sem rede nem relógio; só lê as velas FECHADAS que recebe.
 */

import type { Candle, Direction, Timeframe } from '../types/market.js';
import type { StrategySignal } from './types.js';
import { atrSerie, emaSerie, rsiSerie } from './contexto.js';
import { computeAnchoredVwap, vwapZScore } from './vwap.js';

export type EstrategiaEmTesteId = 'vwap-forex-teste' | 'smt-teste';

export interface EstrategiaEmTeste {
  id: EstrategiaEmTesteId;
  nome: string;
  descricao: string;
  instrumentos: readonly string[];
  timeframes: readonly Timeframe[];
  entrada: string;
  saida: string;
  emTeste: {
    /** Início do teste ao vivo (AAAA-MM-DD). */
    desde: string;
    /** Data combinada para rever os resultados (AAAA-MM-DD). */
    revisao: string;
    /** O que o backtest disse antes do teste. */
    antes: string;
  };
}

export const FOREX_EM_TESTE: readonly string[] = ['EURUSD', 'GBPUSD', 'GBPJPY', 'USDJPY'];
export const SMT_EM_TESTE: readonly string[] = ['EURUSD', 'GBPUSD', 'XAUUSD', 'XAGUSD'];

export const ESTRATEGIAS_EM_TESTE: readonly EstrategiaEmTeste[] = [
  {
    id: 'vwap-forex-teste',
    nome: 'VWAP ±2σ no forex (em teste)',
    descricao:
      'A regra do VWAP dos índices aplicada ao forex, nos dois sentidos: compra 2σ abaixo do VWAP do mês e vende 2σ acima.',
    instrumentos: FOREX_EM_TESTE,
    timeframes: ['1h', '4h'],
    entrada:
      'Fecho abaixo de VWAP − 2σ com RSI(14) < 30 (compra), ou acima de VWAP + 2σ com RSI(14) > 70 (venda); ou σ do mês > 2 ATR.',
    saida: 'Stop 1σ para lá do fecho. Metade em +1R, o resto em +2R com o stop na entrada depois do primeiro alvo.',
    emTeste: {
      desde: '2026-09-17',
      revisao: '2026-09-24',
      antes: 'Nos índices: 68% a +1R. No forex esta forma nunca foi medida.',
    },
  },
  {
    id: 'smt-teste',
    nome: 'SMT sem MMXM (em teste)',
    descricao:
      'Divergência entre pares correlacionados: um faz topo mais alto e o outro não (ou o DXY não confirma). Só a favor da tendência de 4h.',
    instrumentos: SMT_EM_TESTE,
    timeframes: ['15m', '1h', '4h'],
    entrada:
      'Dois topos (ou fundos) seguidos em que o par e a referência discordam (GBPUSD/EURUSD, prata/ouro ou DXY). Entra no fecho da vela que confirma os dois swings.',
    saida: 'Stop no extremo do swing ± 0,1 ATR. Alvo a +2R. Em 15m e 1h sai às 20:00 UTC; em 4h ao fim de 12 velas.',
    emTeste: {
      desde: '2026-09-17',
      revisao: '2026-09-24',
      antes:
        'Backtest 2022–2026: ouro × DXY +0,15R por operação nos dois períodos; EURUSD e GBPUSD ≈ 0R ou negativos.',
    },
  },
];

export function estrategiaEmTeste(id: string): EstrategiaEmTeste | undefined {
  return ESTRATEGIAS_EM_TESTE.find((e) => e.id === id);
}

export function temEstrategiaEmTeste(simbolo: string): boolean {
  const s = simbolo.toUpperCase();
  return ESTRATEGIAS_EM_TESTE.some((e) => e.instrumentos.includes(s));
}

interface Contexto {
  symbol: string;
  timeframe: Timeframe;
}

/** Dados de outros instrumentos que algumas estratégias precisam. */
export interface DadosExtra {
  /** Velas FECHADAS no mesmo timeframe, por código (referências do SMT e componentes do DXY). */
  referencias?: Readonly<Record<string, readonly Candle[]>>;
  /** Velas FECHADAS de 4h do próprio instrumento (tendência do SMT). */
  velas4h?: readonly Candle[];
}

const HORA = 3_600_000;
const DIA = 86_400_000;
const PASSO_MS: Readonly<Record<string, number>> = { '15m': 900_000, '1h': HORA, '4h': 4 * HORA };

function aviso(id: EstrategiaEmTesteId): string {
  const e = estrategiaEmTeste(id)!;
  const dia = (iso: string) => iso.split('-').slice(1).reverse().join('/');
  return `Estratégia EM TESTE desde ${dia(e.emTeste.desde)}, revisão a ${dia(e.emTeste.revisao)}: sem taxa de acerto medida. ${e.emTeste.antes}`;
}

// ---------------------------------------------------------------------------
// VWAP ±2σ no forex
// ---------------------------------------------------------------------------

export function planVwapForexTeste(velas: readonly Candle[], ctx: Contexto): StrategySignal[] {
  const lista = velas as Candle[];
  const i = lista.length - 1;
  const u = lista[i];
  if (!u || lista.length < 60) return [];
  const vwap = computeAnchoredVwap(lista, { anchor: 'month' });
  const p = vwap.points[vwap.points.length - 1];
  if (!p || p.index !== i || p.sigma <= 0 || p.samples < 15) return [];
  const z = vwapZScore(p, u.close);
  const lado = z <= -2 ? 1 : z >= 2 ? -1 : 0;
  if (lado === 0) return [];

  const atr = atrSerie(lista, 14)[i] ?? Number.NaN;
  const rsi = rsiSerie(lista, 14)[i] ?? Number.NaN;
  if (!(atr > 0) || !Number.isFinite(rsi)) return [];
  const extremo = lado > 0 ? rsi < 30 : rsi > 70;
  const deslocado = p.sigma > 2 * atr;
  if (!extremo && !deslocado) return [];

  const entrada = u.close;
  const stop = p.vwap - lado * (Math.abs(z) + 1) * p.sigma;
  const risco = (entrada - stop) * lado;
  if (!(risco > 0)) return [];

  const e = estrategiaEmTeste('vwap-forex-teste')!;
  const direction: Direction = lado > 0 ? 'bullish' : 'bearish';
  return [
    {
      strategy: 'vwap-forex-teste',
      symbol: ctx.symbol,
      timeframe: ctx.timeframe,
      direction,
      regime: 'mean-reversion',
      index: i,
      generatedAt: u.time,
      referencePrice: u.close,
      entryZoneLow: entrada,
      entryZoneHigh: entrada,
      entryPrice: entrada,
      stopLoss: stop,
      targets: [
        { price: entrada + lado * risco, rMultiple: 1, closeFraction: 0.5, rationale: '+1R: fecha metade e passa o stop para a entrada.' },
        { price: entrada + lado * 2 * risco, rMultiple: 2, closeFraction: 0.5, rationale: '+2R: fecha o resto.' },
      ],
      maxRMultiple: 2,
      conviction: 0,
      rationale:
        `Fecho a ${z >= 0 ? '+' : ''}${z.toFixed(1)}σ do VWAP do mês${extremo ? `, RSI(14) ${rsi.toFixed(0)}` : ''}` +
        `${deslocado ? `, σ do mês ${(p.sigma / atr).toFixed(1)}× o ATR` : ''}. ${aviso('vwap-forex-teste')}`,
      assumptions: [e.descricao, e.saida],
      warnings: [
        'Em teste: sem vantagem medida no forex.',
        ...(vwap.usedVolume ? [] : ['Sem volume da Deriv: VWAP ponderado pelo tempo.']),
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// SMT isolado
// ---------------------------------------------------------------------------

/** Pesos do índice do dólar (ICE), sem a coroa sueca — a Deriv não a cota. */
export const PESOS_DXY: Readonly<Record<string, number>> = {
  EURUSD: -0.576,
  USDJPY: 0.136,
  GBPUSD: -0.119,
  USDCAD: 0.091,
  USDCHF: 0.036,
};

/**
 * DXY sintético a partir das velas dos pares que o compõem, alinhadas por tempo.
 * Só entram os tempos em que os cinco têm vela. Máxima e mínima combinam os
 * extremos de cada par no sentido do seu peso (é o limite da amplitude real).
 */
export function dxySintetico(series: Readonly<Record<string, readonly Candle[]>>): Candle[] {
  const pares = Object.keys(PESOS_DXY);
  if (pares.some((p) => !series[p]?.length)) return [];
  const mapas = new Map(pares.map((p) => [p, new Map(series[p]!.map((c) => [c.time, c]))]));
  const out: Candle[] = [];
  for (const base of series['EURUSD']!) {
    let o = 50.14348112;
    let h = o;
    let l = o;
    let c = o;
    let completo = true;
    for (const p of pares) {
      const x = mapas.get(p)!.get(base.time);
      if (!x) {
        completo = false;
        break;
      }
      const w = PESOS_DXY[p]!;
      o *= x.open ** w;
      c *= x.close ** w;
      h *= (w > 0 ? x.high : x.low) ** w;
      l *= (w > 0 ? x.low : x.high) ** w;
    }
    if (completo) out.push({ time: base.time, open: o, high: h, low: l, close: c, volume: 0 });
  }
  return out;
}

/** Referências de cada instrumento. `inversa`: o DXY anda ao contrário do EURUSD, do GBPUSD e do ouro. */
export const REFERENCIAS_SMT_TESTE: Readonly<Record<string, ReadonlyArray<{ codigo: string; inversa: boolean }>>> = {
  EURUSD: [
    { codigo: 'GBPUSD', inversa: false },
    { codigo: 'DXY', inversa: true },
  ],
  GBPUSD: [
    { codigo: 'EURUSD', inversa: false },
    { codigo: 'DXY', inversa: true },
  ],
  XAUUSD: [
    { codigo: 'XAGUSD', inversa: false },
    { codigo: 'DXY', inversa: true },
  ],
  XAGUSD: [
    { codigo: 'XAUUSD', inversa: false },
    { codigo: 'DXY', inversa: true },
  ],
};

/** Códigos cujas velas o motor tem de pedir para correr o SMT deste instrumento. */
export function velasNecessariasSmt(simbolo: string): string[] {
  const refs = REFERENCIAS_SMT_TESTE[simbolo.toUpperCase()] ?? [];
  const out = new Set<string>();
  for (const r of refs) {
    if (r.codigo === 'DXY') for (const p of Object.keys(PESOS_DXY)) out.add(p);
    else out.add(r.codigo);
  }
  out.delete(simbolo.toUpperCase());
  return [...out];
}

/** Velas de cada lado de um swing, por timeframe. */
export const SWING_SMT_TESTE: Readonly<Record<string, number>> = { '15m': 3, '1h': 3, '4h': 2 };

function swings(v: readonly Candle[], L: number): { topos: number[]; fundos: number[] } {
  const topos: number[] = [];
  const fundos: number[] = [];
  for (let i = L; i < v.length - L; i++) {
    const c = v[i]!;
    let topo = true;
    let fundo = true;
    for (let j = 1; j <= L; j++) {
      if (!(c.high > v[i - j]!.high && c.high >= v[i + j]!.high)) topo = false;
      if (!(c.low < v[i - j]!.low && c.low <= v[i + j]!.low)) fundo = false;
    }
    if (topo) topos.push(i);
    if (fundo) fundos.push(i);
  }
  return { topos, fundos };
}

interface EventoSmt {
  lado: 1 | -1;
  i1: number;
  i2: number;
  extremo: number;
  frase: string;
}

/** Divergências cuja confirmação (swings dos dois pares confirmados) cai na ÚLTIMA vela de A. */
function smtNaUltima(
  A: readonly Candle[],
  B: readonly Candle[],
  referencia: string,
  inversa: boolean,
  L: number,
  passo: number,
  simbolo: string,
): EventoSmt[] {
  const ultimo = A.length - 1;
  const sa = swings(A, L);
  const sb = swings(B, L);
  const out: EventoSmt[] = [];
  for (const tipo of ['high', 'low'] as const) {
    const emA = tipo === 'high' ? sa.topos : sa.fundos;
    const tipoB = inversa ? (tipo === 'high' ? 'low' : 'high') : tipo;
    const emB = tipoB === 'high' ? sb.topos : sb.fundos;
    const parEmB = (ia: number): number | null => {
      const t = A[ia]!.time;
      let melhor: number | null = null;
      for (const j of emB) {
        const tj = B[j]!.time;
        if (Math.abs(tj - t) > L * passo) continue;
        if (melhor === null || Math.abs(tj - t) < Math.abs(B[melhor]!.time - t)) melhor = j;
      }
      return melhor;
    };
    for (let n = 1; n < emA.length; n++) {
      const i1 = emA[n - 1]!;
      const i2 = emA[n]!;
      if (i2 + L > ultimo || i2 - i1 > 20 * L || i2 - i1 < L) continue;
      const j1 = parEmB(i1);
      const j2 = parEmB(i2);
      if (j1 === null || j2 === null || j1 === j2) continue;
      const dA = A[i2]![tipo] - A[i1]![tipo];
      const dB = B[j2]![tipoB] - B[j1]![tipoB];
      if (dA === 0 || dB === 0) continue;
      const mesmoSinal = dA > 0 === dB > 0;
      if (inversa ? !mesmoSinal : mesmoSinal) continue;
      // Confirmada quando os DOIS swings têm L velas fechadas depois deles.
      const tConfB = B[j2 + L]!.time;
      let k = i2 + L;
      while (k <= ultimo && A[k]!.time < tConfB) k++;
      if (k !== ultimo) continue;
      const nome = (d: number, t: 'high' | 'low') =>
        t === 'high' ? (d > 0 ? 'topo mais alto' : 'topo mais baixo') : d > 0 ? 'fundo mais alto' : 'fundo mais baixo';
      out.push({
        lado: tipo === 'high' ? -1 : 1,
        i1,
        i2,
        extremo: A[i2]![tipo],
        frase: `${simbolo} fez ${nome(dA, tipo)} e ${referencia} ${nome(dB, tipoB)}`,
      });
    }
  }
  return out;
}

/** Tendência de 4h na hora `t`: fecho e EMA 50 do mesmo lado, com a EMA a andar nesse sentido. */
function tendencia4h(velas4h: readonly Candle[] | undefined, t: number): -1 | 0 | 1 {
  if (!velas4h || velas4h.length < 60) return 0;
  let i = velas4h.length - 1;
  while (i >= 0 && velas4h[i]!.time + 4 * HORA > t) i--;
  if (i < 53) return 0;
  const ema = emaSerie(
    velas4h.slice(0, i + 1).map((c) => c.close),
    50,
  );
  const c = velas4h[i]!.close;
  const e = ema[i]!;
  const e3 = ema[i - 3]!;
  if (c > e && e > e3) return 1;
  if (c < e && e < e3) return -1;
  return 0;
}

export function planSmtTeste(velas: readonly Candle[], ctx: Contexto, extra: DadosExtra = {}): StrategySignal[] {
  const simbolo = ctx.symbol.toUpperCase();
  const L = SWING_SMT_TESTE[ctx.timeframe];
  const passo = PASSO_MS[ctx.timeframe];
  const refs = REFERENCIAS_SMT_TESTE[simbolo];
  const A = velas as Candle[];
  const ultimo = A.length - 1;
  if (!L || !passo || !refs || ultimo < 60) return [];

  const fecho = A[ultimo]!.time + passo;
  const intradia = passo < 4 * HORA;
  // Day trade: depois das 18:00 UTC não sobra sessão até à saída das 20:00.
  if (intradia && (fecho % DIA) / HORA > 18) return [];

  const tendencia = tendencia4h(ctx.timeframe === '4h' ? A : extra.velas4h, fecho);
  if (tendencia === 0) return [];

  const eventos: Array<EventoSmt & { referencia: string }> = [];
  for (const r of refs) {
    const B = r.codigo === 'DXY' ? dxySintetico(extra.referencias ?? {}) : extra.referencias?.[r.codigo];
    if (!B || B.length < 60) continue;
    for (const ev of smtNaUltima(A, B, r.codigo, r.inversa, L, passo, simbolo)) {
      if (ev.lado === tendencia) eventos.push({ ...ev, referencia: r.codigo });
    }
  }
  const ev = eventos[0];
  if (!ev) return [];

  // O preço não pode ter passado o extremo entre o swing e a confirmação.
  for (let k = ev.i2 + 1; k <= ultimo; k++) {
    if (ev.lado < 0 ? A[k]!.high > ev.extremo : A[k]!.low < ev.extremo) return [];
  }
  const atr = atrSerie(A, 14)[ultimo] ?? Number.NaN;
  if (!(atr > 0)) return [];
  const entrada = A[ultimo]!.close;
  const stop = ev.extremo - ev.lado * 0.1 * atr;
  const risco = (entrada - stop) * ev.lado;
  if (!(risco > 0)) return [];

  const e = estrategiaEmTeste('smt-teste')!;
  const direction: Direction = ev.lado > 0 ? 'bullish' : 'bearish';
  const refsTexto = [...new Set(eventos.map((x) => x.referencia))].join(' e ');
  const saida = intradia ? 'Se não chegar, sai às 20:00 UTC.' : 'Se não chegar, sai ao fim de 12 velas.';
  return [
    {
      strategy: 'smt-teste',
      symbol: ctx.symbol,
      timeframe: ctx.timeframe,
      direction,
      regime: 'mean-reversion',
      index: ultimo,
      generatedAt: A[ultimo]!.time,
      referencePrice: entrada,
      entryZoneLow: entrada,
      entryZoneHigh: entrada,
      entryPrice: entrada,
      stopLoss: stop,
      targets: [{ price: entrada + ev.lado * 2 * risco, rMultiple: 2, closeFraction: 1, rationale: `Alvo a +2R. ${saida}` }],
      maxRMultiple: 2,
      conviction: 0,
      rationale:
        `SMT com ${refsTexto}: ${eventos.map((x) => x.frase).join('; ')}. ` +
        `A favor da tendência de 4h (${tendencia > 0 ? 'a subir' : 'a descer'}). ${aviso('smt-teste')}`,
      assumptions: [e.descricao, e.saida],
      warnings: ['Em teste: sem vantagem medida nestes pares.'],
    },
  ];
}
