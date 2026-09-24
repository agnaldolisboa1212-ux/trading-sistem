import type { CandleSeries, Direction, Candle, Timeframe } from '../types/market.js';
import type { StrategySignal, StrategyPlanContext } from './types.js';

/**
 * Agrega velas LTF em velas HTF baseadas num factor multiplicador.
 * Exemplo: factor 15 transforma velas de 1m em velas de 15m.
 */
function buildHTFCandles(candles: Candle[], factor: number): Candle[] {
  const htf: Candle[] = [];
  let currentHtfCandle: Candle | null = null;
  let count = 0;

  for (const c of candles) {
    if (!currentHtfCandle) {
      currentHtfCandle = { ...c };
      count = 1;
    } else {
      currentHtfCandle.high = Math.max(currentHtfCandle.high, c.high);
      currentHtfCandle.low = Math.min(currentHtfCandle.low, c.low);
      currentHtfCandle.close = c.close;
      currentHtfCandle.volume = (currentHtfCandle.volume || 0) + (c.volume || 0);
      count++;
    }

    if (count === factor) {
      htf.push(currentHtfCandle);
      currentHtfCandle = null;
    }
  }

  // Não incluímos a última vela inacabada HTF para evitar falseamentos
  return htf;
}

/**
 * ICT Advanced Strategy (The Inner Circle Trader) - MULTI TIMEFRAME
 * O algoritmo troca internamente de timeframe agregando velas.
 * Lê o Timeframe Maior (HTF) para apanhar o Bias Direcional.
 * Lê o Timeframe Menor (LTF) à procura de MSS (Market Structure Shift) + FVG (Fair Value Gap).
 */
export function planICTAdvancedTrades(
  series: CandleSeries,
  context: StrategyPlanContext
): StrategySignal[] {
  const signals: StrategySignal[] = [];
  const candles = series.candles;

  if (candles.length < 150) {
    return signals;
  }

  // 1. Determinar o fator de Timeframe Interno (Múltiplo de 15 ou 4)
  let factor = 4;
  if (context.timeframe === '1m' || context.timeframe === '5m') factor = 15;
  if (context.timeframe === '1d' || context.timeframe === '1w' || context.timeframe === '1M') {
    factor = 1; // Não faz agregação para timeframes muito altos
  }

  // 2. Construir o contexto HTF (Higher Timeframe)
  const htfCandles = factor > 1 ? buildHTFCandles(candles, factor) : candles;
  
  if (htfCandles.length < 20) {
    return signals; // Sem histórico HTF suficiente
  }

  // Identificar Swings HTF para Bias
  const htfPivotHighs = findPivots(htfCandles, 'high', 3, 3);
  const htfPivotLows = findPivots(htfCandles, 'low', 3, 3);
  
  // Detetar Bias HTF (Tendência de mercado baseada nos últimos pivots HTF)
  let htfBias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (htfPivotHighs.length >= 2 && htfPivotLows.length >= 2) {
    const lastHH = htfPivotHighs[htfPivotHighs.length - 1];
    const prevHH = htfPivotHighs[htfPivotHighs.length - 2];
    const lastLL = htfPivotLows[htfPivotLows.length - 1];
    const prevLL = htfPivotLows[htfPivotLows.length - 2];

    if (lastHH && prevHH && lastLL && prevLL) {
      if (lastHH.value > prevHH.value && lastLL.value > prevLL.value) {
        htfBias = 'bullish';
      } else if (lastHH.value < prevHH.value && lastLL.value < prevLL.value) {
        htfBias = 'bearish';
      }
    }
  }

  // 3. Execução LTF minuto a minuto / vela a vela 
  const pivotHighs = findPivots(candles, 'high', 5, 5);
  const pivotLows = findPivots(candles, 'low', 5, 5);

  const startIndex = Math.max(100, candles.length - 30); // Analisa as últimas 30 velas LTF ativamente
  
  for (let i = startIndex; i < candles.length - 1; i++) {
    const current = candles[i];
    
    // Bullish Setup (Só aceita se o HTF Bias for bullish ou neutral)
    if (htfBias !== 'bearish') {
      const recentPivotHighs = pivotHighs.filter(p => p.index < i && p.index > i - 30);
      if (recentPivotHighs.length > 0) {
        const lastHigh = recentPivotHighs[recentPivotHighs.length - 1];
        
        // MSS Bullish
        if (current && lastHigh && current.close > lastHigh.value && candles[i - 1] && candles[i - 1]!.close <= lastHigh.value) {
          const fvg = findFVG(candles, i - 5, i, 'bullish');
          if (fvg) {
            signals.push(createSignal('bullish', current, fvg, context, i, htfBias));
          }
        }
      }
    }

    // Bearish Setup (Só aceita se o HTF Bias for bearish ou neutral)
    if (htfBias !== 'bullish') {
      const recentPivotLows = pivotLows.filter(p => p.index < i && p.index > i - 30);
      if (recentPivotLows.length > 0) {
        const lastLow = recentPivotLows[recentPivotLows.length - 1];
        
        // MSS Bearish
        if (current && lastLow && current.close < lastLow.value && candles[i - 1] && candles[i - 1]!.close >= lastLow.value) {
          const fvg = findFVG(candles, i - 5, i, 'bearish');
          if (fvg) {
            signals.push(createSignal('bearish', current, fvg, context, i, htfBias));
          }
        }
      }
    }
  }

  return signals;
}

function findPivots(candles: Candle[], type: 'high' | 'low', leftLen: number, rightLen: number) {
  const pivots: { index: number; value: number }[] = [];
  for (let i = leftLen; i < candles.length - rightLen; i++) {
    let isPivot = true;
    const currentCandle = candles[i];
    if (!currentCandle) continue;
    const val = type === 'high' ? currentCandle.high : currentCandle.low;
    
    for (let j = i - leftLen; j <= i + rightLen; j++) {
      if (i === j) continue;
      const jCandle = candles[j];
      if (!jCandle) continue;
      if (type === 'high' && jCandle.high > val) { isPivot = false; break; }
      if (type === 'low' && jCandle.low < val) { isPivot = false; break; }
    }
    
    if (isPivot) {
      pivots.push({ index: i, value: val });
    }
  }
  return pivots;
}

function findFVG(candles: Candle[], start: number, end: number, direction: 'bullish' | 'bearish') {
  start = Math.max(2, start);
  for (let i = end; i >= start; i--) {
    const c1 = candles[i - 2];
    const c3 = candles[i];
    
    if (!c1 || !c3) continue;

    if (direction === 'bullish') {
      if (c3.low > c1.high) {
        return { top: c3.low, bottom: c1.high, index: i - 1 };
      }
    } else {
      if (c3.high < c1.low) {
        return { top: c1.low, bottom: c3.high, index: i - 1 };
      }
    }
  }
  return null;
}

function createSignal(
  direction: Direction, 
  current: Candle, 
  fvg: { top: number; bottom: number; index: number }, 
  context: StrategyPlanContext, 
  index: number,
  htfBias: string
): StrategySignal {
  const isBull = direction === 'bullish';
  const entryPrice = isBull ? fvg.top : fvg.bottom;
  const stopLoss = isBull ? fvg.bottom * 0.999 : fvg.top * 1.001;
  const target = isBull ? entryPrice + (entryPrice - stopLoss) * 2 : entryPrice - (stopLoss - entryPrice) * 2;
  
  return {
    strategy: 'ict-advanced' as any,
    symbol: context.symbol,
    timeframe: context.timeframe,
    direction,
    regime: 'continuation',
    index,
    generatedAt: current.time,
    referencePrice: current.close,
    entryZoneLow: fvg.bottom,
    entryZoneHigh: fvg.top,
    entryPrice: entryPrice,
    stopLoss: stopLoss,
    targets: [{ 
      price: target, 
      rMultiple: 2, 
      closeFraction: 1.0, 
      rationale: 'Opposite Liquidity 2R' 
    }],
    maxRMultiple: 2,
    conviction: htfBias === direction ? 0.95 : 0.70, // Maior convicção se alinhado com HTF
    rationale: `[ICT ALGO] Market Structure Shift (MSS) com Fair Value Gap (FVG). Alinhamento de Bias Diário/HTF: ${htfBias.toUpperCase()}. FVG índice ${fvg.index}. Ponto de entrada na mitigação.`,
    assumptions: ['Killzone ativa', 'Viés Direcional Correto', 'Estrutura institucional alinhada em Multi-Timeframe'],
    warnings: htfBias !== direction ? ['Sinal contra o Bias principal do Timeframe Maior. Operação de risco elevado.'] : []
  };
}
