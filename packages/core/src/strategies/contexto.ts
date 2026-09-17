/**
 * Contexto de mercado — o que uma mesa olha ANTES de aceitar um setup.
 *
 * As quatro estratégias dizem ONDE (zona, nível, banda, value area). Nenhuma
 * dizia EM QUE MERCADO: vender a banda de 2σ do VWAP num dia de tendência forte
 * é a mesma geometria de vender num dia de balanço, e o resultado é o oposto.
 * Medido nos sinais reais: 1 ganho e 14 perdas no VWAP, quase todas reversões
 * contra o movimento.
 *
 * Estas medidas são as que as mesas de sistemáticos usam para separar regimes:
 *
 *   ATR (Wilder)            escala de volatilidade — stops e distâncias em ATR
 *   Efficiency Ratio        Kaufman: deslocação / caminho percorrido. ~1 tendência
 *                           limpa, ~0 ruído a ir e vir
 *   ADX (Wilder)            força da tendência, sem sentido
 *   EMA 50 e 200            tendência de fundo e o seu declive em ATR
 *   RSI (Wilder)            extensão de curto prazo
 *   viés superior           tendência do timeframe acima (1h → 4h, 4h → 1d)
 *
 * PUREZA E SEM FUTURO: cada valor no índice i usa só as velas 0..i. As séries
 * calculam-se uma vez e servem o motor e o backtest da mesma forma.
 */

import type { Candle, Direction } from '../types/market.js';

/** Média móvel exponencial. Começa na média simples das primeiras `period` velas. */
export function emaSerie(valores: readonly number[], period: number): number[] {
  const out: number[] = new Array(valores.length).fill(Number.NaN);
  if (valores.length < period || period < 1) return out;
  const k = 2 / (period + 1);
  let soma = 0;
  for (let i = 0; i < period; i++) soma += valores[i] ?? 0;
  let ema = soma / period;
  out[period - 1] = ema;
  for (let i = period; i < valores.length; i++) {
    ema = (valores[i] ?? ema) * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

function trueRange(c: Candle, anterior: Candle | undefined): number {
  if (!anterior) return c.high - c.low;
  return Math.max(c.high - c.low, Math.abs(c.high - anterior.close), Math.abs(c.low - anterior.close));
}

/** ATR com a suavização de Wilder. */
export function atrSerie(velas: readonly Candle[], period = 14): number[] {
  const out: number[] = new Array(velas.length).fill(Number.NaN);
  if (velas.length <= period) return out;
  let soma = 0;
  for (let i = 1; i <= period; i++) soma += trueRange(velas[i]!, velas[i - 1]);
  let atr = soma / period;
  out[period] = atr;
  for (let i = period + 1; i < velas.length; i++) {
    atr = (atr * (period - 1) + trueRange(velas[i]!, velas[i - 1])) / period;
    out[i] = atr;
  }
  return out;
}

/** Efficiency Ratio de Kaufman: |fecho − fecho n velas antes| / soma dos |Δfecho|. */
export function eficienciaSerie(velas: readonly Candle[], period = 20): number[] {
  const out: number[] = new Array(velas.length).fill(Number.NaN);
  for (let i = period; i < velas.length; i++) {
    let caminho = 0;
    for (let k = i - period + 1; k <= i; k++) caminho += Math.abs(velas[k]!.close - velas[k - 1]!.close);
    out[i] = caminho > 0 ? Math.abs(velas[i]!.close - velas[i - period]!.close) / caminho : 0;
  }
  return out;
}

/** ADX de Wilder (0..100). */
export function adxSerie(velas: readonly Candle[], period = 14): number[] {
  const n = velas.length;
  const out: number[] = new Array(n).fill(Number.NaN);
  if (n <= period * 2) return out;
  let tr = 0;
  let mais = 0;
  let menos = 0;
  const dx: number[] = new Array(n).fill(Number.NaN);
  for (let i = 1; i < n; i++) {
    const c = velas[i]!;
    const p = velas[i - 1]!;
    const sobe = c.high - p.high;
    const desce = p.low - c.low;
    const dmMais = sobe > desce && sobe > 0 ? sobe : 0;
    const dmMenos = desce > sobe && desce > 0 ? desce : 0;
    const t = trueRange(c, p);
    if (i <= period) {
      tr += t;
      mais += dmMais;
      menos += dmMenos;
      if (i < period) continue;
    } else {
      tr = tr - tr / period + t;
      mais = mais - mais / period + dmMais;
      menos = menos - menos / period + dmMenos;
    }
    const diMais = tr > 0 ? (100 * mais) / tr : 0;
    const diMenos = tr > 0 ? (100 * menos) / tr : 0;
    const soma = diMais + diMenos;
    dx[i] = soma > 0 ? (100 * Math.abs(diMais - diMenos)) / soma : 0;
  }
  let adx = 0;
  for (let i = period; i < period * 2; i++) adx += dx[i] ?? 0;
  adx /= period;
  out[period * 2 - 1] = adx;
  for (let i = period * 2; i < n; i++) {
    adx = (adx * (period - 1) + (dx[i] ?? 0)) / period;
    out[i] = adx;
  }
  return out;
}

/** RSI de Wilder (0..100). */
export function rsiSerie(velas: readonly Candle[], period = 14): number[] {
  const n = velas.length;
  const out: number[] = new Array(n).fill(Number.NaN);
  if (n <= period) return out;
  let ganho = 0;
  let perda = 0;
  for (let i = 1; i <= period; i++) {
    const d = velas[i]!.close - velas[i - 1]!.close;
    if (d > 0) ganho += d;
    else perda -= d;
  }
  ganho /= period;
  perda /= period;
  out[period] = perda === 0 ? 100 : 100 - 100 / (1 + ganho / perda);
  for (let i = period + 1; i < n; i++) {
    const d = velas[i]!.close - velas[i - 1]!.close;
    ganho = (ganho * (period - 1) + Math.max(0, d)) / period;
    perda = (perda * (period - 1) + Math.max(0, -d)) / period;
    out[i] = perda === 0 ? 100 : 100 - 100 / (1 + ganho / perda);
  }
  return out;
}

export type Vies = Direction | 'neutral';

export interface ViesTendencia {
  vies: Vies;
  /** Declive da EMA 50 nas últimas 5 velas, em ATR. */
  declive: number;
  /** Distância do fecho à EMA 50, em ATR. */
  distancia: number;
  /** EMA 50 acima (1) ou abaixo (−1) da EMA 200; 0 sem histórico. */
  alinhamentoLongo: number;
}

/**
 * Tendência de uma série na vela `i`: fecho e declive da EMA 50 do mesmo lado.
 * Declive abaixo de 0,1 ATR por 5 velas conta como plano — neutro.
 */
export function viesDeTendencia(
  velas: readonly Candle[],
  i = velas.length - 1,
  series?: { ema50: number[]; ema200: number[]; atr: number[] },
): ViesTendencia {
  const fechos = series ? null : velas.map((v) => v.close);
  const ema50 = series?.ema50 ?? emaSerie(fechos!, 50);
  const ema200 = series?.ema200 ?? emaSerie(fechos!, 200);
  const atr = series?.atr ?? atrSerie(velas, 14);
  const e = ema50[i];
  const ePassada = ema50[i - 5];
  const a = atr[i];
  const c = velas[i];
  if (!c || e === undefined || ePassada === undefined || a === undefined || !Number.isFinite(e) || !Number.isFinite(ePassada) || !(a > 0)) {
    return { vies: 'neutral', declive: 0, distancia: 0, alinhamentoLongo: 0 };
  }
  const declive = (e - ePassada) / a;
  const distancia = (c.close - e) / a;
  const longo = ema200[i];
  const alinhamentoLongo = longo !== undefined && Number.isFinite(longo) ? Math.sign(e - longo) : 0;
  let vies: Vies = 'neutral';
  if (declive > 0.1 && distancia > 0) vies = 'bullish';
  else if (declive < -0.1 && distancia < 0) vies = 'bearish';
  return { vies, declive, distancia, alinhamentoLongo };
}

export interface ContextoMercado {
  atr: number;
  eficiencia: number;
  adx: number;
  rsi: number;
  /** ATR actual / média do ATR das últimas 100 velas. */
  regimeVolatilidade: number;
  tendencia: ViesTendencia;
  /** Tendência do timeframe superior, quando foi dado. */
  superior: ViesTendencia | null;
}

/** Séries de contexto de uma série inteira, para ler em qualquer índice. */
export interface SeriesContexto {
  atr: number[];
  eficiencia: number[];
  adx: number[];
  rsi: number[];
  ema50: number[];
  ema200: number[];
}

export function seriesDeContexto(velas: readonly Candle[]): SeriesContexto {
  const fechos = velas.map((v) => v.close);
  return {
    atr: atrSerie(velas, 14),
    eficiencia: eficienciaSerie(velas, 20),
    adx: adxSerie(velas, 14),
    rsi: rsiSerie(velas, 14),
    ema50: emaSerie(fechos, 50),
    ema200: emaSerie(fechos, 200),
  };
}

/** Contexto na vela `i`, a partir de séries já calculadas. */
export function contextoNoIndice(
  velas: readonly Candle[],
  series: SeriesContexto,
  i: number,
  superior: ViesTendencia | null = null,
): ContextoMercado {
  let somaAtr = 0;
  let nAtr = 0;
  for (let k = Math.max(0, i - 99); k <= i; k++) {
    const v = series.atr[k];
    if (v !== undefined && Number.isFinite(v)) {
      somaAtr += v;
      nAtr++;
    }
  }
  const atr = series.atr[i] ?? Number.NaN;
  return {
    atr,
    eficiencia: series.eficiencia[i] ?? Number.NaN,
    adx: series.adx[i] ?? Number.NaN,
    rsi: series.rsi[i] ?? Number.NaN,
    regimeVolatilidade: nAtr > 0 && somaAtr > 0 ? atr / (somaAtr / nAtr) : 1,
    tendencia: viesDeTendencia(velas, i, series),
    superior,
  };
}

/** Contexto da última vela de uma série (o caso do motor em tempo real). */
export function contextoDeMercado(velas: readonly Candle[], superiores?: readonly Candle[]): ContextoMercado {
  const series = seriesDeContexto(velas);
  const superior = superiores && superiores.length > 0 ? viesDeTendencia(superiores) : null;
  return contextoNoIndice(velas, series, velas.length - 1, superior);
}

/** Timeframe superior usado para o viés de cada timeframe de sinal. */
export const TIMEFRAME_SUPERIOR: Readonly<Record<string, string>> = {
  '15m': '1h',
  '1h': '4h',
  '4h': '1d',
  '1d': '1w',
};
