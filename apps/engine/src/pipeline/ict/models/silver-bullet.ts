// @ts-nocheck
import { CandleSeries, TradeSignal } from '@trading/core';
import { randomUUID } from 'crypto';
import { Killzones } from '../killzones.js';
import { FVG, MarketStructureShift } from '../types.js';

/**
 * Estratégia ICT Silver Bullet
 * A setup temporal estrita, operada apenas durante as janelas de 1 hora
 * (3 AM, 10 AM, 2 PM EST). Foca num FVG gerado por um deslocamento (Displacement)
 * alinhado ao Draw on Liquidity oposto.
 */
export class SilverBulletModel {
  
  public static evaluate(
    symbol: string, 
    m15: CandleSeries, 
    m5: CandleSeries,
    fvgsM5: FVG[],
    mssM5: MarketStructureShift | null,
    bias: 'bullish' | 'bearish'
  ): TradeSignal | null {
    
    // 1. Verificação de Tempo (A regra de ouro do Silver Bullet)
    const currentCandle = m5.candles[m5.candles.length - 1];
    if (!Killzones.isSilverBulletWindow(currentCandle.time)) {
      return null; // Não opera fora da janela de 1 hora
    }

    // 2. Procura pelo Deslocamento (MSS) alinhado ao Bias e FVG
    if (mssM5 && mssM5.displacement && mssM5.type === bias) {
      // Procurar FVG criado nas últimas 5 velas
      const validFVG = fvgsM5.find(f => !f.mitigated && f.type === bias && f.startIndex >= mssM5.index - 5);
      
      if (validFVG) {
        return {
          id: `sb_${symbol}_${randomUUID()}`,
          symbol,
          timeframe: '5m',
          direction: bias,
          entryPrice: bias === 'bullish' ? validFVG.top : validFVG.bottom,
          // Stop no extremo do swing de deslocamento
          stopLoss: bias === 'bullish' ? validFVG.bottom - 0.0005 : validFVG.top + 0.0005,
          maxRMultiple: 3, // Silver Bullet aponta normalmente para R:R de 1:2 ou 1:3 rápidos
          confidence: 0.95,
          model: 'ICT ALGO: SILVER BULLET',
          smtEvents: [],
          timestamp: Date.now()
        };
      }
    }

    return null;
  }
}
