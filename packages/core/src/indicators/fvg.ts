/**
 * Fair Value Gaps (imbalances) e Balanced Price Ranges.
 *
 * FVG de alta (BISI): high[i-1] < low[i+1] — existe um intervalo de preco que
 * nunca foi negociado por ambos os lados. O algoritmo tende a voltar a este
 * intervalo antes de continuar.
 *
 * FVG de baixa (SIBI): low[i-1] > high[i+1].
 *
 * Balanced Price Range (BPR): sobreposicao entre um FVG de alta e um de baixa.
 * E a terceira camada do "True Unicorn" descrito no eBook (Breaker + FVG + BPR).
 */

import type { Candle, Direction } from '../types/market.js';
import type { FairValueGap } from '../types/structure.js';

export interface FvgOptions {
  /**
   * Tamanho minimo do gap como fracao do ATR local. Filtra micro-gaps que sao
   * ruido em timeframes altos. 0 desativa o filtro.
   */
  minSizeAtrRatio?: number;
  /** Janela para o ATR usado no filtro acima. */
  atrPeriod?: number;
}

const DEFAULT_MIN_RATIO = 0.15;
const DEFAULT_ATR_PERIOD = 14;

/** True Range de uma vela em relacao a anterior. */
function trueRange(cur: Candle, prev: Candle | undefined): number {
  if (!prev) return cur.high - cur.low;
  return Math.max(
    cur.high - cur.low,
    Math.abs(cur.high - prev.close),
    Math.abs(cur.low - prev.close),
  );
}

/** ATR simples (media aritmetica do True Range) por indice. */
export function computeAtr(candles: Candle[], period = DEFAULT_ATR_PERIOD): number[] {
  const tr: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (!c) {
      tr.push(0);
      continue;
    }
    tr.push(trueRange(c, candles[i - 1]));
  }

  const atr: number[] = new Array(candles.length).fill(0);
  let sum = 0;
  for (let i = 0; i < tr.length; i++) {
    sum += tr[i] ?? 0;
    if (i >= period) sum -= tr[i - period] ?? 0;
    const window = Math.min(i + 1, period);
    atr[i] = sum / window;
  }
  return atr;
}

/**
 * Detecta todos os FVGs da serie e anota, para cada um, se e quando foi
 * preenchido e se foi invertido (virou IFVG).
 *
 * "Preenchido" = o preco negociou por todo o intervalo do gap.
 * "Invertido"  = o preco FECHOU do lado oposto ao gap; o gap passa a atuar como
 *                resistencia/suporte invertido (Inversion FVG).
 */
export function detectFairValueGaps(candles: Candle[], options: FvgOptions = {}): FairValueGap[] {
  const minRatio = options.minSizeAtrRatio ?? DEFAULT_MIN_RATIO;
  const atr = computeAtr(candles, options.atrPeriod ?? DEFAULT_ATR_PERIOD);
  const out: FairValueGap[] = [];

  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1];
    const mid = candles[i];
    const next = candles[i + 1];
    if (!prev || !mid || !next) continue;

    let direction: Direction | null = null;
    let low = 0;
    let high = 0;

    if (prev.high < next.low) {
      direction = 'bullish';
      low = prev.high;
      high = next.low;
    } else if (prev.low > next.high) {
      direction = 'bearish';
      low = next.high;
      high = prev.low;
    }

    if (!direction) continue;

    const size = high - low;
    const reference = atr[i] ?? 0;
    if (minRatio > 0 && reference > 0 && size < reference * minRatio) continue;

    out.push({
      index: i,
      time: mid.time,
      direction,
      low,
      high,
      ce: (low + high) / 2,
      size,
      filledAtIndex: null,
      invertedAtIndex: null,
    });
  }

  annotateFvgLifecycle(out, candles);
  return out;
}

/** Preenche `filledAtIndex` e `invertedAtIndex` percorrendo as velas seguintes. */
function annotateFvgLifecycle(gaps: FairValueGap[], candles: Candle[]): void {
  for (const gap of gaps) {
    for (let j = gap.index + 2; j < candles.length; j++) {
      const c = candles[j];
      if (!c) continue;

      if (gap.filledAtIndex === null) {
        const covered = gap.direction === 'bullish' ? c.low <= gap.low : c.high >= gap.high;
        if (covered) gap.filledAtIndex = j;
      }

      if (gap.invertedAtIndex === null) {
        const inverted = gap.direction === 'bullish' ? c.close < gap.low : c.close > gap.high;
        if (inverted) {
          gap.invertedAtIndex = j;
          break;
        }
      }
    }
  }
}

/** FVGs ainda validos em `index`: ja formados, nao invertidos e nao totalmente preenchidos. */
export function activeFvgsAt(gaps: FairValueGap[], index: number): FairValueGap[] {
  return gaps.filter(
    (g) =>
      g.index + 1 <= index &&
      (g.invertedAtIndex === null || g.invertedAtIndex > index) &&
      (g.filledAtIndex === null || g.filledAtIndex > index),
  );
}

/** FVGs que ja inverteram em `index` — sao os IFVG, usados como entrada. */
export function inverseFvgsAt(gaps: FairValueGap[], index: number): FairValueGap[] {
  return gaps.filter((g) => g.invertedAtIndex !== null && g.invertedAtIndex <= index);
}

/**
 * Balanced Price Range: regiao onde um FVG de alta e um de baixa se sobrepoem.
 * Quando presente dentro de um breaker, forma o "True Unicorn" do eBook.
 */
export interface BalancedPriceRange {
  low: number;
  high: number;
  /** Indice da vela em que a sobreposicao passa a existir (o gap mais recente). */
  index: number;
  time: number;
  bullishFvgIndex: number;
  bearishFvgIndex: number;
}

/**
 * Procura BPRs entre pares de FVGs de direcoes opostas formados a no maximo
 * `maxSeparation` velas de distancia. Gaps muito distantes um do outro nao
 * representam o mesmo evento de reprecificacao.
 */
export function detectBalancedPriceRanges(
  gaps: FairValueGap[],
  candles: Candle[],
  maxSeparation = 20,
): BalancedPriceRange[] {
  const bullish = gaps.filter((g) => g.direction === 'bullish');
  const bearish = gaps.filter((g) => g.direction === 'bearish');
  const out: BalancedPriceRange[] = [];

  for (const up of bullish) {
    for (const down of bearish) {
      if (Math.abs(up.index - down.index) > maxSeparation) continue;

      const low = Math.max(up.low, down.low);
      const high = Math.min(up.high, down.high);
      if (high <= low) continue;

      const index = Math.max(up.index, down.index);
      const candle = candles[index];
      out.push({
        low,
        high,
        index,
        time: candle?.time ?? 0,
        bullishFvgIndex: up.index,
        bearishFvgIndex: down.index,
      });
    }
  }

  return out.sort((a, b) => a.index - b.index);
}

/** True se `price` esta dentro do intervalo do gap (inclusive). */
export function priceInGap(gap: FairValueGap, price: number): boolean {
  return price >= gap.low && price <= gap.high;
}
