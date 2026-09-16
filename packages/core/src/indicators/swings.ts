/**
 * Deteccao de swing points em tres graus (short / intermediate / long term),
 * seguindo a definicao fractal do ICT.
 *
 * Regra base (short-term): uma maxima e STH quando a vela tem high maior que as
 * `lookback` velas de cada lado. O mesmo, invertido, para STL.
 *
 * Regra fractal (intermediate/long): um swing de grau N+1 e um swing de grau N
 * que e mais extremo que os swings de grau N imediatamente a sua esquerda e
 * direita. Isto e exatamente o que o eBook chama de ITH/ITL — os pontos sobre os
 * quais o MMXM e desenhado.
 */

import type { Candle } from '../types/market.js';
import type { SwingDegree, SwingPoint } from '../types/structure.js';

export interface SwingOptions {
  /** Quantas velas de cada lado precisam ser menores para validar um STH/STL. */
  lookback?: number;
}

const DEFAULT_LOOKBACK = 2;

/**
 * Detecta swings short-term por comparacao local.
 *
 * Empates sao resolvidos por "strictly greater" a esquerda e "greater or equal"
 * a direita, o que evita registar dois topos no mesmo patamar de precos iguais
 * (equal highs) como dois swings distintos — esses viram liquidity pool, nao
 * swing.
 */
export function detectShortTermSwings(candles: Candle[], options: SwingOptions = {}): SwingPoint[] {
  const lookback = options.lookback ?? DEFAULT_LOOKBACK;
  const out: SwingPoint[] = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];
    if (!c) continue;

    let isHigh = true;
    let isLow = true;

    for (let j = 1; j <= lookback; j++) {
      const left = candles[i - j];
      const right = candles[i + j];
      if (!left || !right) {
        isHigh = false;
        isLow = false;
        break;
      }
      if (!(c.high > left.high && c.high >= right.high)) isHigh = false;
      if (!(c.low < left.low && c.low <= right.low)) isLow = false;
    }

    if (isHigh) out.push({ index: i, time: c.time, price: c.high, kind: 'high', degree: 'short' });
    if (isLow) out.push({ index: i, time: c.time, price: c.low, kind: 'low', degree: 'short' });
  }

  return out.sort((a, b) => a.index - b.index);
}

/**
 * Eleva swings de um grau para o grau seguinte.
 *
 * Um topo de grau N vira grau N+1 quando e mais alto que o topo de grau N
 * anterior e que o proximo — ou seja, quando ha um fundo de grau N de cada lado
 * que o "isola". Espelhado para fundos.
 */
export function promoteSwings(swings: SwingPoint[], toDegree: SwingDegree): SwingPoint[] {
  const highs = swings.filter((s) => s.kind === 'high');
  const lows = swings.filter((s) => s.kind === 'low');
  const out: SwingPoint[] = [];

  for (let i = 1; i < highs.length - 1; i++) {
    const prev = highs[i - 1];
    const cur = highs[i];
    const next = highs[i + 1];
    if (!prev || !cur || !next) continue;
    if (cur.price > prev.price && cur.price >= next.price) {
      out.push({ ...cur, degree: toDegree });
    }
  }

  for (let i = 1; i < lows.length - 1; i++) {
    const prev = lows[i - 1];
    const cur = lows[i];
    const next = lows[i + 1];
    if (!prev || !cur || !next) continue;
    if (cur.price < prev.price && cur.price <= next.price) {
      out.push({ ...cur, degree: toDegree });
    }
  }

  return out.sort((a, b) => a.index - b.index);
}

export interface SwingLadder {
  short: SwingPoint[];
  intermediate: SwingPoint[];
  long: SwingPoint[];
  /** Todos os graus concatenados, ordenados por indice. */
  all: SwingPoint[];
}

/** Constroi a escada fractal completa de swings a partir das velas. */
export function buildSwingLadder(candles: Candle[], options: SwingOptions = {}): SwingLadder {
  const short = detectShortTermSwings(candles, options);
  const intermediate = promoteSwings(short, 'intermediate');
  const long = promoteSwings(intermediate, 'long');
  const all = [...short, ...intermediate, ...long].sort((a, b) => a.index - b.index);
  return { short, intermediate, long, all };
}

/** Ultimo swing de um dado tipo e grau, ou null. */
export function lastSwing(
  swings: SwingPoint[],
  kind: 'high' | 'low',
  degree?: SwingDegree,
): SwingPoint | null {
  for (let i = swings.length - 1; i >= 0; i--) {
    const s = swings[i];
    if (!s) continue;
    if (s.kind !== kind) continue;
    if (degree && s.degree !== degree) continue;
    return s;
  }
  return null;
}

/** Swings ocorridos ate `index` (inclusive), preservando a ordem. */
export function swingsUpTo(swings: SwingPoint[], index: number): SwingPoint[] {
  return swings.filter((s) => s.index <= index);
}

export interface OrderFlowReading {
  direction: 'bullish' | 'bearish' | 'neutral';
  /** Convicção da leitura em 0..1. */
  strength: number;
  detail: string;
}

/**
 * Classifica o fluxo institucional a partir da sequencia de swings.
 *
 * Uma leitura sobre apenas DOIS swings de cada tipo e fragil: basta um unico
 * pullback profundo para transformar uma tendencia limpa em "neutral". Aqui a
 * classificacao pondera as ultimas transicoes disponiveis (ate 4 comparacoes de
 * topos e 4 de fundos), dando mais peso as mais recentes.
 *
 * Continua a existir "neutral" — o checklist do eBook pergunta se o fluxo e
 * OBVIO, e um mercado que alterna HH com LL genuinamente nao o e.
 */
export function readOrderFlow(swings: SwingPoint[], maxComparisons = 4): OrderFlowReading {
  const highs = swings.filter((s) => s.kind === 'high').slice(-(maxComparisons + 1));
  const lows = swings.filter((s) => s.kind === 'low').slice(-(maxComparisons + 1));

  if (highs.length < 2 || lows.length < 2) {
    return { direction: 'neutral', strength: 0, detail: 'Swings insuficientes para ler o fluxo.' };
  }

  // Cada transicao vale +1 (a favor da alta) ou -1, com peso crescente para as
  // mais recentes: a estrutura de ontem informa mais que a do trimestre passado.
  let score = 0;
  let totalWeight = 0;
  let higherHighs = 0;
  let higherLows = 0;
  let lowerHighs = 0;
  let lowerLows = 0;

  const accumulate = (points: SwingPoint[], onUp: () => void, onDown: () => void) => {
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const cur = points[i];
      if (!prev || !cur) continue;
      const weight = i / (points.length - 1); // 0..1, mais recente = mais peso
      if (cur.price > prev.price) {
        score += weight;
        onUp();
      } else if (cur.price < prev.price) {
        score -= weight;
        onDown();
      }
      totalWeight += weight;
    }
  };

  accumulate(highs, () => higherHighs++, () => lowerHighs++);
  accumulate(lows, () => higherLows++, () => lowerLows++);

  const normalized = totalWeight > 0 ? score / totalWeight : 0;
  const detail =
    `HH=${higherHighs} HL=${higherLows} LH=${lowerHighs} LL=${lowerLows} ` +
    `(indice ${normalized.toFixed(2)})`;

  // Limiar de 0.35: abaixo disto a estrutura esta genuinamente misturada.
  if (normalized >= 0.35) {
    return { direction: 'bullish', strength: Math.min(1, normalized), detail };
  }
  if (normalized <= -0.35) {
    return { direction: 'bearish', strength: Math.min(1, -normalized), detail };
  }
  return { direction: 'neutral', strength: Math.abs(normalized), detail };
}

/** Forma curta de `readOrderFlow`, para quem so precisa da direcao. */
export function classifyOrderFlow(swings: SwingPoint[]): 'bullish' | 'bearish' | 'neutral' {
  return readOrderFlow(swings).direction;
}
