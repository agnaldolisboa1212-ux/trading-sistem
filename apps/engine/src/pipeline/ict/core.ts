import { CandleSeries, TradeSignal } from '@trading/core';
import { randomUUID } from 'crypto';
import { LiquidityMatrix } from './liquidity';
import { PriceDeliveryArrays } from './pd-arrays';
import { LiquidityPool, FVG, OrderBlock, MarketStructureShift } from './types';
import { SilverBulletModel } from './models/silver-bullet';
import { OptimalTradeEntry } from './models/ote';
import { MMXMModel } from './models/mmxm';

/**
 * ============================================================================
 * ORQUESTRADOR CENTRAL: ICT ALGO - INSTITUTIONAL FLOW
 * ============================================================================
 * Agora orquestra múltiplos sub-modelos do ICT:
 * - ICT 2022 Mentorship Model
 * - Silver Bullet
 * - Optimal Trade Entry (OTE)
 * - Market Maker Models (MMXM)
 */

export class ICTCoreEngine {
  
  // Lista de ativos permitidos no teu Portfólio restrito
  private static readonly PORTFOLIO_ALLOWLIST = ['EURUSD', 'GBPUSD', 'XAUUSD', 'US30', 'NAS100'];

  public static execute(
    symbol: string, 
    daily: CandleSeries, 
    h4: CandleSeries, 
    m15: CandleSeries,
    m5: CandleSeries // Introduzido para o Silver Bullet
  ) {
    
    // Filtro Restritivo de Portfólio (Regra do Utilizador)
    if (!this.PORTFOLIO_ALLOWLIST.includes(symbol)) {
      throw new Error(`[Segurança] Ativo ${symbol} não está no Portfólio permitido. Análise abortada pelo Mestre.`);
    }
    
    if (!daily || !h4 || !m15 || !m5) throw new Error('Data stream corrompida. Faltam timeframes.');
    if (m15.candles.length < 50 || m5.candles.length < 50) throw new Error('Amostra insuficiente.');

    const bias = this.getDailyOrderFlow(daily);
    const poolsH4 = LiquidityMatrix.calculatePools(h4);
    const sweepsH4 = LiquidityMatrix.scanForSweeps(h4, poolsH4);

    const fvgsM15 = PriceDeliveryArrays.findFVGs(m15);
    const obsM15 = PriceDeliveryArrays.findOrderBlocks(m15);
    const mssM15 = this.detectDisplacement(m15, bias);

    const fvgsM5 = PriceDeliveryArrays.findFVGs(m5);
    const mssM5 = this.detectDisplacement(m5, bias);

    // Avaliação Concorrente dos Modelos (Subagentes Algorítmicos Internos)
    
    // 1. Tentar o Modelo MMXM primeiro (Mais lucrativo e raro)
    let signal = MMXMModel.evaluate(symbol, m15, bias);
    
    // 2. Tentar o Silver Bullet se o MMXM não acionou
    if (!signal) {
      signal = SilverBulletModel.evaluate(symbol, m5, m5, fvgsM5, mssM5, bias);
    }
    
    // 3. Tentar o Optimal Trade Entry (OTE)
    if (!signal) {
      signal = OptimalTradeEntry.evaluate(symbol, m15, bias);
    }
    
    // 4. Fallback para o ICT 2022 Mentorship Model Clássico
    if (!signal && sweepsH4.length > 0 && mssM15 && mssM15.displacement) {
      const unmitigatedFVG = fvgsM15.find(f => !f.mitigated && f.type === bias);
      if (unmitigatedFVG) {
        signal = {
          id: `ict_flow_2022_${symbol}_${randomUUID()}`,
          symbol,
          timeframe: '15m',
          direction: bias === 'bullish' ? 'bullish' : 'bearish',
          entryPrice: bias === 'bullish' ? unmitigatedFVG.top : unmitigatedFVG.bottom,
          stopLoss: sweepsH4[0].price,
          maxRMultiple: 5.5, 
          confidence: 0.99,
          model: 'ICT ALGO: 2022 Model',
          smtEvents: [],
          timestamp: Date.now()
        };
      }
    }

    return {
      symbol,
      modelName: signal ? signal.model : 'ICT ALGO: SCANNING',
      bias,
      h4Status: sweepsH4.length > 0 ? 'Liquidity Purged' : 'Building Liquidity',
      m15Status: mssM15 ? 'Displacement Confirmed' : 'No Displacement',
      signal
    };
  }

  private static getDailyOrderFlow(series: CandleSeries): 'bullish' | 'bearish' | 'neutral' {
    const c = series.candles;
    const current = c[c.length - 1];
    const previous = c[c.length - 2];
    
    if (current.c > previous.h) return 'bullish';
    if (current.c < previous.l) return 'bearish';
    return 'neutral';
  }

  private static detectDisplacement(series: CandleSeries, bias: string): MarketStructureShift | null {
    const c = series.candles;
    const last = c[c.length - 1];
    
    if (bias === 'bullish' && last.c > c[c.length - 10].h) {
      return { index: c.length - 1, type: 'bullish', price: last.c, displacement: true };
    }
    if (bias === 'bearish' && last.c < c[c.length - 10].l) {
      return { index: c.length - 1, type: 'bearish', price: last.c, displacement: true };
    }
    return null;
  }
}
