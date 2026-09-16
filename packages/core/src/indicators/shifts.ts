/**
 * Change In State of Delivery (CISD) e Market Structure Shift (MSS).
 *
 * Sao os dois eventos que confirmam a troca de programa (buy <-> sell) e, no
 * MMXM, sao a assinatura do Smart Money Reversal.
 *
 * CISD: identifica a ultima sequencia de velas de UMA cor e marca o `open` da
 *       primeira vela dessa sequencia. Quando o preco FECHA alem desse nivel na
 *       direcao oposta, a entrega mudou de estado. E mais sensivel que o MSS e
 *       tende a aparecer antes.
 *
 * MSS:  rompimento por FECHAMENTO de um swing point de grau relevante, na
 *       direcao contraria ao fluxo vigente. Mais lento, porem mais robusto.
 */

import { candleBody, isUpCandle, type Candle, type Direction } from '../types/market.js';
import type { StructureShift, SwingDegree, SwingPoint } from '../types/structure.js';
import { computeAtr } from './fvg.js';

export interface ShiftOptions {
  /** Corpo minimo (em ATR) para considerar o rompimento um displacement. */
  displacementAtrRatio?: number;
  /** Grau minimo de swing considerado para MSS. */
  minDegree?: SwingDegree;
}

const DEGREE_RANK: Record<SwingDegree, number> = { short: 0, intermediate: 1, long: 2 };

/**
 * Detecta CISDs percorrendo a serie.
 *
 * Para cada indice, olha para tras e encontra a corrida de velas consecutivas da
 * mesma cor que antecede a vela atual. Se a vela atual for de cor oposta e
 * fechar alem do `open` da PRIMEIRA vela dessa corrida, houve CISD.
 */
export function detectCisd(candles: Candle[], options: ShiftOptions = {}): StructureShift[] {
  const ratio = options.displacementAtrRatio ?? 1.0;
  const atr = computeAtr(candles);
  const out: StructureShift[] = [];

  for (let i = 2; i < candles.length; i++) {
    const c = candles[i];
    if (!c) continue;
    const up = isUpCandle(c);

    // Corrida de velas de cor oposta a `c`, terminando em i-1.
    let start = i - 1;
    while (start >= 0) {
      const prev = candles[start];
      if (!prev) break;
      if (isUpCandle(prev) === up) break;
      start--;
    }
    start += 1;
    if (start > i - 1) continue; // nao ha corrida contraria

    const runStart = candles[start];
    if (!runStart) continue;

    const level = runStart.open;
    const crossed = up ? c.close > level : c.close < level;
    if (!crossed) continue;

    const reference = atr[i] ?? 0;
    out.push({
      index: i,
      time: c.time,
      direction: up ? 'bullish' : 'bearish',
      type: 'cisd',
      level,
      degree: null,
      withDisplacement: reference > 0 && candleBody(c) >= reference * ratio,
      brokenSwingIndex: null,
    });
  }

  return out;
}

/**
 * Detecta MSS: fechamento alem de um swing point ainda nao rompido.
 *
 * Percorre as velas e, para cada uma, verifica se ela fecha acima do ultimo
 * swing high nao rompido (MSS bullish) ou abaixo do ultimo swing low nao
 * rompido (MSS bearish).
 */
export function detectMss(
  candles: Candle[],
  swings: SwingPoint[],
  options: ShiftOptions = {},
): StructureShift[] {
  const ratio = options.displacementAtrRatio ?? 1.0;
  const minRank = DEGREE_RANK[options.minDegree ?? 'short'];
  const atr = computeAtr(candles);

  const eligible = swings.filter((s) => DEGREE_RANK[s.degree] >= minRank);
  const broken = new Set<number>();
  const out: StructureShift[] = [];

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    if (!c) continue;
    const reference = atr[i] ?? 0;
    const withDisplacement = reference > 0 && candleBody(c) >= reference * ratio;

    for (const s of eligible) {
      if (s.index >= i) break;
      const key = s.index * 2 + (s.kind === 'high' ? 1 : 0);
      if (broken.has(key)) continue;

      const crossed = s.kind === 'high' ? c.close > s.price : c.close < s.price;
      if (!crossed) continue;

      broken.add(key);
      out.push({
        index: i,
        time: c.time,
        direction: s.kind === 'high' ? 'bullish' : 'bearish',
        type: 'mss',
        level: s.price,
        degree: s.degree,
        withDisplacement,
        brokenSwingIndex: s.index,
      });
    }
  }

  return out.sort((a, b) => a.index - b.index);
}

/** Detecta CISD e MSS juntos, ordenados por indice. */
export function detectStructureShifts(
  candles: Candle[],
  swings: SwingPoint[],
  options: ShiftOptions = {},
): StructureShift[] {
  return [...detectCisd(candles, options), ...detectMss(candles, swings, options)].sort(
    (a, b) => a.index - b.index,
  );
}

/**
 * Ultimo shift na direcao pedida dentro de uma janela de `window` velas
 * terminando em `index`. Usado para confirmar o SMR num ponto especifico.
 */
export function lastShiftInWindow(
  shifts: StructureShift[],
  index: number,
  window: number,
  direction?: Direction,
): StructureShift | null {
  for (let i = shifts.length - 1; i >= 0; i--) {
    const s = shifts[i];
    if (!s) continue;
    if (s.index > index) continue;
    if (s.index < index - window) return null;
    if (direction && s.direction !== direction) continue;
    return s;
  }
  return null;
}
