/**
 * Validacao da qualidade do OHLC antes de qualquer analise estrutural.
 *
 * Existe por uma razao concreta e verificada: os simbolos spot de forex do Yahoo
 * (`EURUSD=X`) devolvem `open` praticamente igual a `close` — medido em 200
 * velas diarias, o corpo era 2,4% do range, contra ~49% num OHLC real. Nada
 * disto gera erro: as velas chegam bem formadas, os detectores correm, e o
 * sistema produz zero order blocks e zero CISDs sem dizer porque.
 *
 * Falhar ruidosamente e melhor do que analisar dados invalidos em silencio.
 */

import type { Candle } from '../types/market.js';

export interface OhlcQuality {
  /** Corpo medio dividido pelo range medio. Series reais medem 0,45-0,55. */
  bodyToRangeRatio: number;
  /** Fracao de velas com corpo exatamente zero. */
  zeroBodyFraction: number;
  /** Fracao de velas com maxima igual a minima (sem range algum). */
  flatFraction: number;
  /** True quando a serie nao serve para analise ICT. */
  degenerate: boolean;
  reason: string;
}

/** Abaixo deste corpo/range a serie e considerada sintetizada. */
const MIN_BODY_RATIO = 0.1;
/** Acima desta fracao de velas sem corpo a serie e considerada degenerada. */
const MAX_ZERO_BODY = 0.4;

export function assessOhlcQuality(candles: Candle[]): OhlcQuality {
  if (candles.length < 10) {
    return {
      bodyToRangeRatio: 0,
      zeroBodyFraction: 1,
      flatFraction: 1,
      degenerate: true,
      reason: `Apenas ${candles.length} velas — insuficiente para avaliar a qualidade.`,
    };
  }

  const flat = candles.filter((c) => c.high <= c.low).length;
  const zeroBody = candles.filter((c) => c.open === c.close).length;
  const usable = candles.filter((c) => c.high > c.low);

  const totalBody = usable.reduce((a, c) => a + Math.abs(c.close - c.open), 0);
  const totalRange = usable.reduce((a, c) => a + (c.high - c.low), 0);
  const ratio = totalRange > 0 ? totalBody / totalRange : 0;

  const zeroBodyFraction = zeroBody / candles.length;
  const flatFraction = flat / candles.length;

  const degenerate =
    ratio < MIN_BODY_RATIO || zeroBodyFraction > MAX_ZERO_BODY || flatFraction > 0.2;

  let reason: string;
  if (!degenerate) {
    reason = `OHLC utilizavel — corpo/range ${(ratio * 100).toFixed(1)}%.`;
  } else if (ratio < MIN_BODY_RATIO) {
    reason =
      `Corpo medio e apenas ${(ratio * 100).toFixed(1)}% do range (esperado 45-55%). ` +
      'A fonte esta a sintetizar a abertura a partir do fecho anterior; sem corpo real ' +
      'nao existe displacement, order block nem cor de vela, e metade do framework ICT ' +
      'deixa de funcionar.';
  } else if (zeroBodyFraction > MAX_ZERO_BODY) {
    reason = `${(zeroBodyFraction * 100).toFixed(0)}% das velas tem corpo exatamente zero.`;
  } else {
    reason = `${(flatFraction * 100).toFixed(0)}% das velas nao tem range (high = low).`;
  }

  return { bodyToRangeRatio: ratio, zeroBodyFraction, flatFraction, degenerate, reason };
}
