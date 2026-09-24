import { planICTAdvancedTrades } from '@trading/core';
import type { CandleSeries } from '@trading/core';

// Função para gerar uma vela simulada
function createCandle(time: number, open: number, high: number, low: number, close: number) {
  return { time, open, high, low, close, volume: 1000 };
}

async function run() {
  console.log('[Subagente 6] A iniciar backtest histórico da Estratégia ICT...');

  // Criar dados históricos simulados (ex: 60 velas com uma tendência de baixa, seguida por um sweep e um MSS bullish)
  const candles = [];
  let currentPrice = 1000;
  
  // 150 velas de descida (Para termos histórico HTF)
  for (let i = 0; i < 150; i++) {
    candles.push(createCandle(1000000 + i * 60000, currentPrice, currentPrice + 5, currentPrice - 10, currentPrice - 5));
    currentPrice -= 5;
  }

  // Liquidity Sweep (Vai muito abaixo e retrai forte)
  candles.push(createCandle(1000000 + 150 * 60000, currentPrice, currentPrice + 2, currentPrice - 20, currentPrice));
  
  // Market Structure Shift (Sobe rapidamente quebrando os highs anteriores)
  for (let i = 0; i < 5; i++) {
    candles.push(createCandle(1000000 + (151 + i) * 60000, currentPrice, currentPrice + 20, currentPrice - 2, currentPrice + 15));
    currentPrice += 15;
  }

  // Fair Value Gap é deixado para trás. Nova vela mitiga.
  candles.push(createCandle(1000000 + 156 * 60000, currentPrice, currentPrice + 2, currentPrice - 15, currentPrice - 5));

  const series: CandleSeries = {
    symbol: 'SIMULATED',
    timeframe: '15m',
    fidelity: 'true-ohlc',
    source: 'backtest',
    candles
  };

  const signals = planICTAdvancedTrades(series, { symbol: 'SIMULATED', timeframe: '15m' });

  if (signals.length > 0) {
    console.log(`✅ [SUCESSO] Sinais detetados: ${signals.length}`);
    console.log(JSON.stringify(signals, null, 2));
  } else {
    console.log(`❌ Nenhuns sinais detetados. O algoritmo precisa de afinação.`);
  }
}

run().catch(console.error);
