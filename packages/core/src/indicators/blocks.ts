/**
 * Order Blocks, Breaker Blocks e Mitigation Blocks.
 *
 * Order Block  — ultima vela contraria antes de um displacement que rompe
 *                estrutura. E a "pegada" institucional.
 * Breaker      — order block que falhou: o preco atravessou-o e ele passa a
 *                atuar na direcao oposta. E o bloco onde o eBook coloca a
 *                entrada do Low Risk Buy/Sell e do "True Unicorn".
 * Mitigation   — order block do lado ESQUERDO da curva do MMXM, reutilizado
 *                quando o preco volta pelo lado direito ("old selling becomes
 *                new buying").
 */

import { candleBody, candleRange, isUpCandle, type Candle, type Direction } from '../types/market.js';
import type { PriceBlock, SwingPoint } from '../types/structure.js';
import { computeAtr } from './fvg.js';

export interface BlockOptions {
  /** Quantas velas o displacement pode levar para confirmar o rompimento. */
  displacementWindow?: number;
  /** Corpo minimo da vela de displacement em multiplos do ATR. */
  displacementAtrRatio?: number;
  /** Quantas velas contrarias consecutivas podem compor o bloco. */
  maxBlockCandles?: number;
}

const DEFAULTS: Required<BlockOptions> = {
  displacementWindow: 3,
  displacementAtrRatio: 1.0,
  maxBlockCandles: 3,
};

/**
 * Detecta order blocks: procura velas de displacement (corpo grande relativo ao
 * ATR) e recua ate a ultima vela de cor oposta, que se torna o bloco.
 */
export function detectOrderBlocks(candles: Candle[], options: BlockOptions = {}): PriceBlock[] {
  const opts = { ...DEFAULTS, ...options };
  const atr = computeAtr(candles);
  const out: PriceBlock[] = [];
  const seen = new Set<number>();

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const reference = atr[i] ?? 0;
    if (!c || reference <= 0) continue;
    if (candleBody(c) < reference * opts.displacementAtrRatio) continue;

    const direction: Direction = isUpCandle(c) ? 'bullish' : 'bearish';

    // Recua ate a ultima vela de cor contraria ao displacement.
    let blockIndex = -1;
    for (let j = i - 1; j >= 0 && j >= i - opts.maxBlockCandles - 1; j--) {
      const cand = candles[j];
      if (!cand) continue;
      const candIsUp = isUpCandle(cand);
      if ((direction === 'bullish' && !candIsUp) || (direction === 'bearish' && candIsUp)) {
        blockIndex = j;
        break;
      }
    }
    if (blockIndex < 0 || seen.has(blockIndex)) continue;
    seen.add(blockIndex);

    const block = candles[blockIndex];
    if (!block) continue;

    out.push({
      index: blockIndex,
      time: block.time,
      kind: 'order-block',
      direction,
      low: block.low,
      high: block.high,
      mid: (block.low + block.high) / 2,
      mitigatedAtIndex: null,
      invalidatedAtIndex: null,
    });
  }

  annotateBlockLifecycle(out, candles);
  return out.sort((a, b) => a.index - b.index);
}

/**
 * Converte order blocks violados em breakers.
 *
 * Um order block bullish que e atravessado por um FECHAMENTO abaixo do seu low
 * vira um breaker bearish: o preco deve rejeitar essa zona ao voltar. Isto e
 * exatamente o "institutional swing point / breaker" citado no eBook.
 */
export function deriveBreakers(blocks: PriceBlock[], candles: Candle[]): PriceBlock[] {
  const out: PriceBlock[] = [];

  for (const block of blocks) {
    if (block.invalidatedAtIndex === null) continue;
    const breakIndex = block.invalidatedAtIndex;
    const c = candles[breakIndex];
    if (!c) continue;

    const flipped: Direction = block.direction === 'bullish' ? 'bearish' : 'bullish';
    const breaker: PriceBlock = {
      index: block.index,
      time: block.time,
      kind: 'breaker',
      direction: flipped,
      low: block.low,
      high: block.high,
      mid: block.mid,
      mitigatedAtIndex: null,
      invalidatedAtIndex: null,
    };

    // O ciclo de vida do breaker so comeca a contar apos o rompimento.
    for (let j = breakIndex + 1; j < candles.length; j++) {
      const k = candles[j];
      if (!k) continue;
      if (breaker.mitigatedAtIndex === null && k.high >= breaker.low && k.low <= breaker.high) {
        breaker.mitigatedAtIndex = j;
      }
      const broken = flipped === 'bullish' ? k.close < breaker.low : k.close > breaker.high;
      if (broken) {
        breaker.invalidatedAtIndex = j;
        break;
      }
    }

    out.push(breaker);
  }

  return out;
}

/**
 * Mitigation blocks: order blocks do lado esquerdo da curva (antes de
 * `curveSplitIndex`) que ainda nao foram mitigados e cuja direcao aponta contra
 * o movimento que os criou — sao as zonas de "old selling / new buying".
 */
export function deriveMitigationBlocks(
  blocks: PriceBlock[],
  curveSplitIndex: number,
): PriceBlock[] {
  return blocks
    .filter((b) => b.index < curveSplitIndex)
    .filter((b) => b.mitigatedAtIndex === null || b.mitigatedAtIndex > curveSplitIndex)
    .map((b) => ({ ...b, kind: 'mitigation' as const }));
}

/** Marca quando cada bloco foi tocado (mitigado) e quando foi atravessado. */
function annotateBlockLifecycle(blocks: PriceBlock[], candles: Candle[]): void {
  for (const block of blocks) {
    for (let j = block.index + 2; j < candles.length; j++) {
      const c = candles[j];
      if (!c) continue;

      if (block.mitigatedAtIndex === null && c.high >= block.low && c.low <= block.high) {
        block.mitigatedAtIndex = j;
      }

      const broken = block.direction === 'bullish' ? c.close < block.low : c.close > block.high;
      if (broken) {
        block.invalidatedAtIndex = j;
        break;
      }
    }
  }
}

/**
 * Rejection block: vela com pavio longo na direcao oposta ao fechamento.
 * O corpo do bloco e o pavio, nao a vela inteira.
 */
export function detectRejectionBlocks(candles: Candle[], wickRatio = 0.6): PriceBlock[] {
  const out: PriceBlock[] = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (!c) continue;
    const range = candleRange(c);
    if (range <= 0) continue;

    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;

    if (upperWick / range >= wickRatio) {
      out.push({
        index: i,
        time: c.time,
        kind: 'rejection',
        direction: 'bearish',
        low: Math.max(c.open, c.close),
        high: c.high,
        mid: (Math.max(c.open, c.close) + c.high) / 2,
        mitigatedAtIndex: null,
        invalidatedAtIndex: null,
      });
    }

    if (lowerWick / range >= wickRatio) {
      out.push({
        index: i,
        time: c.time,
        kind: 'rejection',
        direction: 'bullish',
        low: c.low,
        high: Math.min(c.open, c.close),
        mid: (c.low + Math.min(c.open, c.close)) / 2,
        mitigatedAtIndex: null,
        invalidatedAtIndex: null,
      });
    }
  }

  annotateBlockLifecycle(out, candles);
  return out;
}

/** Blocos ainda validos em `index` e ainda nao mitigados. */
export function unmitigatedBlocksAt(blocks: PriceBlock[], index: number): PriceBlock[] {
  return blocks.filter(
    (b) =>
      b.index < index &&
      (b.mitigatedAtIndex === null || b.mitigatedAtIndex > index) &&
      (b.invalidatedAtIndex === null || b.invalidatedAtIndex > index),
  );
}

/** Bloco mais proximo do preco, na direcao desejada. */
export function nearestBlock(
  blocks: PriceBlock[],
  price: number,
  direction: Direction,
): PriceBlock | null {
  let best: PriceBlock | null = null;
  let bestDistance = Infinity;

  for (const b of blocks) {
    if (b.direction !== direction) continue;
    const distance =
      price < b.low ? b.low - price : price > b.high ? price - b.high : 0;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = b;
    }
  }

  return best;
}

/** Sinaliza se um swing point coincide com um bloco (institutional swing point). */
export function blockAtSwing(blocks: PriceBlock[], swing: SwingPoint, tolerance = 0): boolean {
  return blocks.some(
    (b) => swing.price >= b.low - tolerance && swing.price <= b.high + tolerance,
  );
}
