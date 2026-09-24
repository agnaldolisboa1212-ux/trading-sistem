// @ts-nocheck
import { CandleSeries, TradeSignal } from '@trading/core';
import { randomUUID } from 'crypto';

export class MMXMModel {
  /**
   * MMXM (Market Maker Buy/Sell Model)
   * Este modelo procura o ciclo completo do Smart Money:
   * 1. Original Consolidation
   * 2. Accumulation/Distribution
   * 3. Smart Money Reversal (SMR)
   * 4. Distribution/Accumulation back to Original Consolidation
   */
  public static evaluate(
    symbol: string,
    series: CandleSeries,
    bias: 'bullish' | 'bearish'
  ): TradeSignal | null {
    const c = series.candles;
    if (c.length < 50) return null;

    // Detectando a Original Consolidation (Fase 1) nas últimas 50-30 velas
    let max = -1;
    let min = 999999;
    for (let i = c.length - 50; i < c.length - 30; i++) {
      if (c[i].high > max) max = c[i].high;
      if (c[i].low < min) min = c[i].low;
    }
    const consolidationMid = (max + min) / 2;
    const isConsolidating = (max - min) < (consolidationMid * 0.005); // Faixa estreita

    if (!isConsolidating) return null;

    // Smart Money Reversal (SMR) recente
    const currentPrice = c[c.length - 1].close;

    if (bias === 'bullish') {
      // Market Maker Buy Model (MMBM)
      // O preço deve estar abaixo da consolidação e ter feito um Reversal (fundo duplo/sweep)
      if (currentPrice < min) {
        // Encontra o Sweep recente
        const isSMR = c[c.length - 2].low < c[c.length - 3].low && c[c.length - 1].close > c[c.length - 2].high;
        if (isSMR) {
          return {
            id: `mmbm_${symbol}_${randomUUID()}`,
            symbol,
            timeframe: '15m',
            direction: 'bullish',
            entryPrice: currentPrice,
            stopLoss: c[c.length - 2].low - 0.0005, // Abaixo do SMR
            maxRMultiple: 5, // Alvo é a Original Consolidation
            confidence: 0.95,
            model: 'ICT ALGO: MMBM (Buy Model)',
            smtEvents: [],
            timestamp: Date.now()
          };
        }
      }
    } else {
      // Market Maker Sell Model (MMSM)
      // O preço deve estar acima da consolidação e ter feito um Reversal
      if (currentPrice > max) {
        const isSMR = c[c.length - 2].high > c[c.length - 3].high && c[c.length - 1].close < c[c.length - 2].low;
        if (isSMR) {
          return {
            id: `mmsm_${symbol}_${randomUUID()}`,
            symbol,
            timeframe: '15m',
            direction: 'bearish',
            entryPrice: currentPrice,
            stopLoss: c[c.length - 2].high + 0.0005, // Acima do SMR
            maxRMultiple: 5, // Alvo é a Original Consolidation
            confidence: 0.95,
            model: 'ICT ALGO: MMSM (Sell Model)',
            smtEvents: [],
            timestamp: Date.now()
          };
        }
      }
    }

    return null;
  }
}
