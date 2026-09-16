/**
 * Pocos de liquidez e Draw On Liquidity.
 *
 * O eBook define dois tipos de liquidez relevantes:
 *  1. Equal highs / equal lows engenheirados durante a consolidacao original.
 *  2. "Time Based Liquidity Pools" — maximas e minimas de ciclos temporais
 *     anteriores. Na versao intradiaria sao Asia/London/NY; na escala macro
 *     deste sistema sao Dia / Semana / Mes / Trimestre / Ano anteriores.
 *
 * O Draw On Liquidity e o poco NAO varrido mais relevante na direcao da
 * narrativa — o "iman" para onde o preco e entregue.
 */

import type { Candle, LiquiditySide } from '../types/market.js';
import type { LiquidityOrigin, LiquidityPool, SwingPoint } from '../types/structure.js';
import { computeAtr } from './fvg.js';

export interface EqualLevelOptions {
  /** Tolerancia entre niveis "iguais", em multiplos do ATR. */
  toleranceAtrRatio?: number;
  /** Minimo de toques para o cluster contar como poco de liquidez. */
  minTouches?: number;
}

/**
 * Agrupa swings do mesmo tipo cujos precos estao dentro da tolerancia,
 * produzindo os clusters de equal highs / equal lows.
 */
export function detectEqualLevels(
  candles: Candle[],
  swings: SwingPoint[],
  options: EqualLevelOptions = {},
): LiquidityPool[] {
  const tolRatio = options.toleranceAtrRatio ?? 0.25;
  const minTouches = options.minTouches ?? 2;
  const atr = computeAtr(candles);
  const out: LiquidityPool[] = [];

  for (const kind of ['high', 'low'] as const) {
    const pts = swings.filter((s) => s.kind === kind).sort((a, b) => a.price - b.price);
    let cluster: SwingPoint[] = [];

    const flush = () => {
      if (cluster.length < minTouches) {
        cluster = [];
        return;
      }
      const last = cluster.reduce((a, b) => (a.index > b.index ? a : b));
      const price =
        kind === 'high'
          ? Math.max(...cluster.map((s) => s.price))
          : Math.min(...cluster.map((s) => s.price));
      out.push({
        side: kind === 'high' ? 'buyside' : 'sellside',
        price,
        origin: 'equal-levels',
        memberIndices: cluster.map((s) => s.index),
        touches: cluster.length,
        time: last.time,
        sweptAtIndex: null,
      });
      cluster = [];
    };

    for (const pt of pts) {
      if (cluster.length === 0) {
        cluster = [pt];
        continue;
      }
      const ref = cluster[cluster.length - 1];
      if (!ref) continue;
      const tolerance = (atr[pt.index] ?? 0) * tolRatio;
      if (Math.abs(pt.price - ref.price) <= tolerance) {
        cluster.push(pt);
      } else {
        flush();
        cluster = [pt];
      }
    }
    flush();
  }

  annotateSweeps(out, candles);
  return out.sort((a, b) => a.time - b.time);
}

/**
 * Pocos de liquidez baseados em tempo: maximas e minimas dos ciclos anteriores.
 *
 * A versao macro do "During London we refer to Asia's High and Low" do eBook:
 * ao operar o diario, referimo-nos a semana anterior; ao operar o semanal, ao
 * mes anterior; e assim por diante.
 */
/**
 * Quantos ciclos ANTERIORES de cada tipo manter.
 *
 * O conceito do eBook e sobre ciclos recentes — "During London we refer to
 * Asia's High and Low", nao a de ha tres meses. Sem este limite, uma serie de
 * 1500 velas diarias gerava ~1500 pocos so de `previous-day` (3888 no total),
 * o que era analiticamente errado e, por ser O(pocos x velas) na anotacao de
 * varrimentos, tornava a funcao no ponto mais lento de todo o motor.
 *
 * Niveis antigos que realmente importam continuam representados: pelos ciclos
 * longos (trimestre, ano) e pelos clusters de `equal-levels`.
 */
const CYCLE_MEMORY: Record<string, number> = {
  'previous-day': 10,
  'previous-week': 12,
  'previous-month': 12,
  'previous-quarter': 8,
  'previous-year': 5,
};

export function detectTimeBasedPools(candles: Candle[]): LiquidityPool[] {
  const out: LiquidityPool[] = [];

  const cycles: Array<{ origin: LiquidityOrigin; key: (d: Date) => string }> = [
    { origin: 'previous-day', key: (d) => `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}` },
    { origin: 'previous-week', key: (d) => `${d.getUTCFullYear()}-W${isoWeek(d)}` },
    { origin: 'previous-month', key: (d) => `${d.getUTCFullYear()}-${d.getUTCMonth()}` },
    { origin: 'previous-quarter', key: (d) => `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3)}` },
    { origin: 'previous-year', key: (d) => `${d.getUTCFullYear()}` },
  ];

  for (const cycle of cycles) {
    const groups = new Map<string, { high: number; low: number; lastIndex: number; time: number }>();

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      if (!c) continue;
      const k = cycle.key(new Date(c.time));
      const g = groups.get(k);
      if (!g) {
        groups.set(k, { high: c.high, low: c.low, lastIndex: i, time: c.time });
      } else {
        g.high = Math.max(g.high, c.high);
        g.low = Math.min(g.low, c.low);
        g.lastIndex = i;
      }
    }

    // O ultimo grupo ainda esta em formacao — nao e um ciclo "anterior".
    // Dos restantes, guarda apenas os mais recentes (ver CYCLE_MEMORY).
    const memory = CYCLE_MEMORY[cycle.origin] ?? 12;
    const entries = [...groups.values()]
      .sort((a, b) => a.time - b.time)
      .slice(0, -1)
      .slice(-memory);
    for (const g of entries) {
      out.push({
        side: 'buyside',
        price: g.high,
        origin: cycle.origin,
        memberIndices: [],
        touches: 1,
        time: g.time,
        sweptAtIndex: null,
      });
      out.push({
        side: 'sellside',
        price: g.low,
        origin: cycle.origin,
        memberIndices: [],
        touches: 1,
        time: g.time,
        sweptAtIndex: null,
      });
    }
  }

  annotateSweeps(out, candles);
  return out.sort((a, b) => a.time - b.time);
}

/** Numero da semana ISO-8601 de uma data UTC. */
function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/** Marca em que indice cada poco foi varrido (preco negociou alem do nivel). */
function annotateSweeps(pools: LiquidityPool[], candles: Candle[]): void {
  for (const pool of pools) {
    // Procura binaria pela primeira vela posterior ao poco: varrer desde o
    // inicio da serie repetia trabalho para cada um dos pocos.
    let lo = 0;
    let hi = candles.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((candles[mid]?.time ?? 0) <= pool.time) lo = mid + 1;
      else hi = mid;
    }

    for (let i = lo; i < candles.length; i++) {
      const c = candles[i];
      if (!c) continue;
      const swept = pool.side === 'buyside' ? c.high > pool.price : c.low < pool.price;
      if (swept) {
        pool.sweptAtIndex = i;
        break;
      }
    }
  }
}

/** Pocos ainda intactos em `index`. */
export function unsweptPoolsAt(pools: LiquidityPool[], index: number, time: number): LiquidityPool[] {
  return pools.filter(
    (p) => p.time <= time && (p.sweptAtIndex === null || p.sweptAtIndex > index),
  );
}

/** Peso relativo de cada tipo de poco ao escolher o Draw On Liquidity. */
const ORIGIN_WEIGHT: Record<LiquidityOrigin, number> = {
  'previous-year': 6,
  'previous-quarter': 5,
  'previous-month': 4,
  'previous-week': 3,
  'equal-levels': 3,
  'previous-day': 1,
  swing: 1,
};

export interface DrawOnLiquidity {
  pool: LiquidityPool;
  /** Distancia absoluta do preco atual ate o poco. */
  distance: number;
  /** Pontuacao usada no ranking (peso do ciclo + toques - penalidade de distancia). */
  score: number;
}

/**
 * Escolhe o Draw On Liquidity: o poco nao varrido, do lado indicado pela
 * narrativa, com melhor combinacao de relevancia temporal e proximidade.
 *
 * Pocos muito longe recebem penalidade porque, num swing de semanas, um alvo a
 * varias vezes o ATR de distancia deixa de ser acionavel no horizonte previsto.
 */
export function selectDrawOnLiquidity(
  pools: LiquidityPool[],
  currentPrice: number,
  side: LiquiditySide,
  atrValue: number,
): DrawOnLiquidity | null {
  const candidates = pools.filter((p) => {
    if (p.side !== side) return false;
    if (p.sweptAtIndex !== null) return false;
    return side === 'buyside' ? p.price > currentPrice : p.price < currentPrice;
  });

  let best: DrawOnLiquidity | null = null;
  for (const pool of candidates) {
    const distance = Math.abs(pool.price - currentPrice);
    const atrDistance = atrValue > 0 ? distance / atrValue : 0;
    const score = ORIGIN_WEIGHT[pool.origin] + pool.touches - atrDistance * 0.15;
    if (!best || score > best.score) best = { pool, distance, score };
  }

  return best;
}
