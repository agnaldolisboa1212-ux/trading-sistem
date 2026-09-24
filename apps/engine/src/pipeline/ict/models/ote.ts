import { CandleSeries, TradeSignal } from '@trading/core';
import { randomUUID } from 'crypto';

export class OptimalTradeEntry {
  /**
   * OTE (Optimal Trade Entry) Pattern
   * Baseado na retração Fibonacci de um impulso (Displacement).
   * O ICT foca nas retrações entre 62%, 70.5% (Sweet Spot) e 79%.
   */
  public static evaluate(
    symbol: string,
    series: CandleSeries,
    bias: 'bullish' | 'bearish'
  ): TradeSignal | null {
    const c = series.candles;
    
    // Procurar o último grande impulso (últimas 20 velas)
    let swingHigh = { price: -1, index: -1 };
    let swingLow = { price: 999999, index: -1 };
    
    for (let i = c.length - 20; i < c.length - 1; i++) {
      if (c[i].h > swingHigh.price) swingHigh = { price: c[i].h, index: i };
      if (c[i].l < swingLow.price) swingLow = { price: c[i].l, index: i };
    }

    // Calcular OTE Levels se o impulso for recente
    if (bias === 'bullish' && swingHigh.index > swingLow.index) {
      // Impulso de alta
      const range = swingHigh.price - swingLow.price;
      const fib62 = swingHigh.price - (range * 0.62);
      const fib79 = swingHigh.price - (range * 0.79);
      const oteSweetSpot = swingHigh.price - (range * 0.705);
      
      const currentPrice = c[c.length - 1].c;
      
      // Se o preço atual entrou na zona OTE
      if (currentPrice <= fib62 && currentPrice >= fib79) {
        return {
          id: `ote_${symbol}_${randomUUID()}`,
          symbol,
          timeframe: '15m', // Pode rodar em qualquer TF
          direction: 'bullish',
          entryPrice: currentPrice,
          stopLoss: swingLow.price - 0.0003, // Stop abaixo do fundo do impulso
          maxRMultiple: 4,
          confidence: 0.90,
          model: 'ICT ALGO: OTE (70.5%)',
          smtEvents: [],
          timestamp: Date.now()
        };
      }
    }

    if (bias === 'bearish' && swingLow.index > swingHigh.index) {
      // Impulso de baixa
      const range = swingHigh.price - swingLow.price;
      const fib62 = swingLow.price + (range * 0.62);
      const fib79 = swingLow.price + (range * 0.79);
      const oteSweetSpot = swingLow.price + (range * 0.705);
      
      const currentPrice = c[c.length - 1].c;
      
      if (currentPrice >= fib62 && currentPrice <= fib79) {
        return {
          id: `ote_${symbol}_${randomUUID()}`,
          symbol,
          timeframe: '15m',
          direction: 'bearish',
          entryPrice: currentPrice,
          stopLoss: swingHigh.price + 0.0003, // Stop acima do topo do impulso
          maxRMultiple: 4,
          confidence: 0.90,
          model: 'ICT ALGO: OTE (70.5%)',
          smtEvents: [],
          timestamp: Date.now()
        };
      }
    }

    return null;
  }
}
