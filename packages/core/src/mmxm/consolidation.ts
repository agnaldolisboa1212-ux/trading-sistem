/**
 * Deteccao da "original consolidation" — o ponto de partida de qualquer MMXM.
 *
 * Do eBook:
 *   MMSM: "begins with an original consolidation. During this consolidation
 *          relatively equal LOWS get engineered" (sellside liquidity).
 *   MMBM: "the market consolidate and engineer relatively equal HIGHS"
 *          (buyside liquidity).
 *
 * Ou seja, a consolidacao nao e apenas um range lateral: e um range que DEIXA
 * liquidez engenheirada de um lado especifico. E esse detalhe que determina se
 * estamos perante um modelo de compra ou de venda.
 *
 * O modelo tambem se COMPLETA quando o preco volta a atravessar este range —
 * "Once price trades below the original consolidation, the MMSM is completed."
 */

import { computeAtr } from '../indicators/fvg.js';
import type { Candle, Direction } from '../types/market.js';
import type { SwingPoint } from '../types/structure.js';

export interface Consolidation {
  startIndex: number;
  endIndex: number;
  startTime: number;
  endTime: number;
  high: number;
  low: number;
  mid: number;
  /** Amplitude do range em unidades de preco. */
  range: number;
  /**
   * Lado onde a liquidez foi engenheirada.
   * 'buyside'  = equal highs -> alimenta um MMBM (o preco vai buscar acima).
   * 'sellside' = equal lows  -> alimenta um MMSM (o preco vai buscar abaixo).
   */
  engineeredSide: 'buyside' | 'sellside' | 'both' | 'none';
  /** Preco exato do cluster de niveis iguais, se existir. */
  engineeredLevel: number | null;
  /** Quantos toques formam o cluster — mais toques, mais liquidez presa. */
  engineeredTouches: number;
  /** Compressao: quanto o ATR do range e menor que o ATR anterior (0..1). */
  compression: number;
}

export interface ConsolidationOptions {
  /** Numero minimo de velas para o range contar como consolidacao. */
  minLength?: number;
  /** Numero maximo de velas analisadas por janela. */
  maxLength?: number;
  /** Amplitude maxima do range em multiplos do ATR para ser "consolidacao". */
  maxRangeAtr?: number;
  /** Tolerancia entre niveis "relativamente iguais", em multiplos do ATR. */
  equalToleranceAtr?: number;
}

const DEFAULTS: Required<ConsolidationOptions> = {
  minLength: 5,
  maxLength: 30,
  maxRangeAtr: 3.5,
  equalToleranceAtr: 0.3,
};

/**
 * Encontra consolidacoes na serie.
 *
 * Estrategia: janela deslizante de comprimento crescente. Para cada posicao
 * final, procura o range mais LONGO que ainda cabe em `maxRangeAtr`. Ranges
 * longos e apertados sao consolidacoes melhores que ranges curtos.
 */
export function detectConsolidations(
  candles: Candle[],
  swings: SwingPoint[],
  options: ConsolidationOptions = {},
): Consolidation[] {
  const opts = { ...DEFAULTS, ...options };
  const atr = computeAtr(candles);
  const out: Consolidation[] = [];

  let cursor = 0;
  while (cursor < candles.length - opts.minLength) {
    let best: Consolidation | null = null;

    for (let length = opts.minLength; length <= opts.maxLength; length++) {
      const start = cursor;
      const end = cursor + length - 1;
      if (end >= candles.length) break;

      const window = candles.slice(start, end + 1);
      const high = Math.max(...window.map((c) => c.high));
      const low = Math.min(...window.map((c) => c.low));
      const range = high - low;

      const reference = atr[end] ?? 0;
      if (reference <= 0) break;
      if (range > reference * opts.maxRangeAtr) break; // deixou de ser consolidacao

      const engineered = findEngineeredLevels(
        swings,
        start,
        end,
        (atr[end] ?? 0) * opts.equalToleranceAtr,
      );

      const priorAtr = atr[Math.max(0, start - 1)] ?? reference;
      const compression = priorAtr > 0 ? Math.max(0, 1 - reference / priorAtr) : 0;

      const startCandle = candles[start];
      const endCandle = candles[end];
      if (!startCandle || !endCandle) break;

      best = {
        startIndex: start,
        endIndex: end,
        startTime: startCandle.time,
        endTime: endCandle.time,
        high,
        low,
        mid: (high + low) / 2,
        range,
        engineeredSide: engineered.side,
        engineeredLevel: engineered.level,
        engineeredTouches: engineered.touches,
        compression,
      };
    }

    if (best && best.engineeredSide !== 'none') {
      out.push(best);
      cursor = best.endIndex + 1;
    } else if (best) {
      cursor = best.endIndex + 1;
    } else {
      cursor += 1;
    }
  }

  return out;
}

/**
 * Procura maximas ou minimas "relativamente iguais" dentro da janela.
 *
 * Retail traders leem estes niveis como suporte/resistencia forte e colocam
 * stops atras deles — e exatamente essa a liquidez que o modelo vai buscar.
 */
function findEngineeredLevels(
  swings: SwingPoint[],
  startIndex: number,
  endIndex: number,
  tolerance: number,
): { side: Consolidation['engineeredSide']; level: number | null; touches: number } {
  const inWindow = swings.filter((s) => s.index >= startIndex && s.index <= endIndex);

  const cluster = (kind: 'high' | 'low') => {
    const pts = inWindow.filter((s) => s.kind === kind).map((s) => s.price);
    if (pts.length < 2) return { level: null as number | null, touches: 0 };

    let bestLevel: number | null = null;
    let bestTouches = 0;
    for (const anchor of pts) {
      const touches = pts.filter((p) => Math.abs(p - anchor) <= tolerance).length;
      if (touches > bestTouches) {
        bestTouches = touches;
        bestLevel = anchor;
      }
    }
    return { level: bestTouches >= 2 ? bestLevel : null, touches: bestTouches };
  };

  const highs = cluster('high');
  const lows = cluster('low');

  if (highs.level !== null && lows.level !== null) {
    // Ambos os lados engenheirados: o mais tocado define o vies dominante.
    if (highs.touches === lows.touches) {
      return { side: 'both', level: null, touches: highs.touches };
    }
    return highs.touches > lows.touches
      ? { side: 'buyside', level: highs.level, touches: highs.touches }
      : { side: 'sellside', level: lows.level, touches: lows.touches };
  }
  if (highs.level !== null) return { side: 'buyside', level: highs.level, touches: highs.touches };
  if (lows.level !== null) return { side: 'sellside', level: lows.level, touches: lows.touches };
  return { side: 'none', level: null, touches: 0 };
}

/**
 * Modelo implicado por uma consolidacao.
 *
 * Equal HIGHS (buyside liquidity acima) => o preco ira buscar essa liquidez
 * eventualmente, mas primeiro desce para varrer sellside: e a assinatura do
 * MMBM. O inverso para o MMSM.
 */
export function impliedModelDirection(consolidation: Consolidation): Direction | null {
  if (consolidation.engineeredSide === 'buyside') return 'bullish'; // MMBM
  if (consolidation.engineeredSide === 'sellside') return 'bearish'; // MMSM
  return null;
}

/**
 * True quando o preco ja atravessou a consolidacao na direcao do modelo —
 * "Once price trades above/below the original consolidation, the model is
 * completed."
 */
export function isModelCompleted(
  consolidation: Consolidation,
  direction: Direction,
  candles: Candle[],
  fromIndex: number,
): { completed: boolean; atIndex: number | null } {
  for (let i = fromIndex; i < candles.length; i++) {
    const c = candles[i];
    if (!c) continue;
    const done = direction === 'bullish' ? c.close > consolidation.high : c.close < consolidation.low;
    if (done) return { completed: true, atIndex: i };
  }
  return { completed: false, atIndex: null };
}
