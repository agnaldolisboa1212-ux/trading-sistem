// @ts-nocheck
import { CandleSeries } from '@trading/core';
import { FVG, OrderBlock } from './types.js';

export class PriceDeliveryArrays {
  /**
   * Scanner de Fair Value Gaps (FVG / Imbalances)
   */
  public static findFVGs(series: CandleSeries): FVG[] {
    const fvgs: FVG[] = [];
    const c = series.candles;
    
    // Algoritmo de deteção de desequilíbrio (BISI / SIBI)
    for (let i = 2; i < c.length; i++) {
      const c1 = c[i-2];
      const c2 = c[i-1];
      const c3 = c[i];
      
      if (!c1 || !c2 || !c3) continue;

      // Bullish Imbalance Sell-Side Inefficiency (BISI)
      if (c3.low > c1.high) {
        fvgs.push({
          startIndex: i-1,
          endIndex: i,
          bottom: c1.high,
          top: c3.low,
          type: 'bullish',
          mitigated: false,
          volumeProfile: (c2.high - c2.low) // Volatilidade da vela deslocadora
        });
      }
      
      // Bearish Imbalance Buy-Side Inefficiency (SIBI)
      if (c3.high < c1.low) {
        fvgs.push({
          startIndex: i-1,
          endIndex: i,
          bottom: c3.high,
          top: c1.low,
          type: 'bearish',
          mitigated: false,
          volumeProfile: (c2.high - c2.low)
        });
      }
    }
    
    return this.checkMitigation(fvgs, series);
  }

  /**
   * Identificador de Institutional Order Blocks (OB)
   */
  public static findOrderBlocks(series: CandleSeries): OrderBlock[] {
    const obs: OrderBlock[] = [];
    const c = series.candles;
    
    for (let i = 1; i < c.length - 3; i++) {
      const c1 = c[i];
      const c2 = c[i+1];
      const c3 = c[i+2];

      if (!c1 || !c2 || !c3) continue;

      // Bullish OB: Última vela de baixa antes do movimento forte de alta
      if (c1.close < c1.open && c2.close > c2.open && c3.close > c3.open) {
        // Validação de Displacement: A vela seguinte tem de quebrar a máxima do OB
        if (c2.close > c1.high) {
          obs.push({
            startIndex: i,
            top: c1.high,
            bottom: c1.low,
            type: 'bullish',
            mitigated: false,
            consequentEncroachment: (c1.high + c1.low) / 2
          });
        }
      }

      // Bearish OB: Última vela de alta antes do movimento forte de baixa
      if (c1.close > c1.open && c2.close < c2.open && c3.close < c3.open) {
        if (c2.close < c1.low) {
          obs.push({
            startIndex: i,
            top: c1.high,
            bottom: c1.low,
            type: 'bearish',
            mitigated: false,
            consequentEncroachment: (c1.high + c1.low) / 2
          });
        }
      }
    }
    
    return obs;
  }

  private static checkMitigation(arrays: any[], series: CandleSeries): any[] {
    const c = series.candles;
    for (const item of arrays) {
      for (let j = item.endIndex || item.startIndex + 1; j < c.length; j++) {
        const curr = c[j];
        if (!curr) continue;
        if (item.type === 'bullish' && curr.low <= (item.bottom || item.consequentEncroachment)) {
          item.mitigated = true;
        }
        if (item.type === 'bearish' && curr.high >= (item.top || item.consequentEncroachment)) {
          item.mitigated = true;
        }
      }
    }
    return arrays;
  }
}
