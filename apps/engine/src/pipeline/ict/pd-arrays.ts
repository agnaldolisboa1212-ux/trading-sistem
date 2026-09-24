import { CandleSeries } from '@trading/core';
import { FVG, OrderBlock } from './types';

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
      const c3 = c[i];
      
      // Bullish Imbalance Sell-Side Inefficiency (BISI)
      if (c3.l > c1.h) {
        fvgs.push({
          startIndex: i-1,
          endIndex: i,
          bottom: c1.h,
          top: c3.l,
          type: 'bullish',
          mitigated: false,
          volumeProfile: (c[i-1].h - c[i-1].l) // Volatilidade da vela deslocadora
        });
      }
      
      // Bearish Imbalance Buy-Side Inefficiency (SIBI)
      if (c3.h < c1.l) {
        fvgs.push({
          startIndex: i-1,
          endIndex: i,
          bottom: c3.h,
          top: c1.l,
          type: 'bearish',
          mitigated: false,
          volumeProfile: (c[i-1].h - c[i-1].l)
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
      // Bullish OB: Última vela de baixa antes do movimento forte de alta
      if (c[i].c < c[i].o && c[i+1].c > c[i+1].o && c[i+2].c > c[i+2].o) {
        // Validação de Displacement: A vela seguinte tem de quebrar a máxima do OB
        if (c[i+1].c > c[i].h) {
          obs.push({
            startIndex: i,
            top: c[i].h,
            bottom: c[i].l,
            type: 'bullish',
            mitigated: false,
            consequentEncroachment: (c[i].h + c[i].l) / 2
          });
        }
      }

      // Bearish OB: Última vela de alta antes do movimento forte de baixa
      if (c[i].c > c[i].o && c[i+1].c < c[i+1].o && c[i+2].c < c[i+2].o) {
        if (c[i+1].c < c[i].l) {
          obs.push({
            startIndex: i,
            top: c[i].h,
            bottom: c[i].l,
            type: 'bearish',
            mitigated: false,
            consequentEncroachment: (c[i].h + c[i].l) / 2
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
        if (item.type === 'bullish' && c[j].l <= (item.bottom || item.consequentEncroachment)) {
          item.mitigated = true;
        }
        if (item.type === 'bearish' && c[j].h >= (item.top || item.consequentEncroachment)) {
          item.mitigated = true;
        }
      }
    }
    return arrays;
  }
}
