/**
 * Diagnostico de baixo nivel dos detectores de estrutura.
 *
 * Corre:   node scripts/diagnose.mjs [SIMBOLO]
 *
 * Mostra quantos swings, FVGs, order blocks e eventos SMT cada detector produz
 * sobre dados reais. Serve para calibrar os limiares (lookback, ATR ratios)
 * quando um checklist para sempre no mesmo passo.
 */

import {
  buildSwingLadder, classifyOrderFlow, detectSmtDivergences, smtPairsFor,
  detectFairValueGaps, detectOrderBlocks, deriveBreakers, detectConsolidations,
  requiredSymbolsFor,
} from '../packages/core/dist/index.js';
import { ProviderRegistry } from '../packages/data/dist/index.js';

const symbol = process.argv[2] ?? 'EURUSD';
const registry = new ProviderRegistry();

const needed = requiredSymbolsFor(symbol);
const daily = await registry.getMany(needed, '1d', 400);
const weekly = await registry.getCandles({ symbol, timeframe: '1w', limit: 200 });

const wl = buildSwingLadder(weekly.candles);
console.log(`SEMANAL ${symbol}: ${weekly.candles.length} velas`);
console.log(`  swings  short=${wl.short.length}  intermediate=${wl.intermediate.length}  long=${wl.long.length}`);
console.log(`  fluxo(intermediate)=${classifyOrderFlow(wl.intermediate)}`);
console.log(`  fluxo(short)=${classifyOrderFlow(wl.short)}`);
console.log(`  ultimos intermediate: ${wl.intermediate.slice(-6).map(s => `${s.kind}@${s.index}:${s.price.toFixed(4)}`).join('  ')}`);

const p = daily.series.get(symbol);
const pl = buildSwingLadder(p.candles);
const fvgs = detectFairValueGaps(p.candles);
const obs = detectOrderBlocks(p.candles);
const brk = deriveBreakers(obs, p.candles);
const cons = detectConsolidations(p.candles, pl.all);

console.log(`\nDIARIO ${symbol}: ${p.candles.length} velas (fonte ${p.source})`);
console.log(`  swings  short=${pl.short.length}  intermediate=${pl.intermediate.length}  long=${pl.long.length}`);
console.log(`  FVGs=${fvgs.length}  orderBlocks=${obs.length}  breakers=${brk.length}`);
console.log(`  consolidacoes=${cons.length}  com liquidez engenheirada=${cons.filter(c => c.engineeredSide !== 'none' && c.engineeredSide !== 'both').length}`);
console.log(`  ultimas consolidacoes: ${cons.slice(-3).map(c => `[${c.startIndex}-${c.endIndex}] ${c.engineeredSide}(${c.engineeredTouches})`).join('  ')}`);

console.log(`\nSMT para ${symbol}:`);
for (const pair of smtPairsFor(symbol)) {
  const ref = daily.series.get(pair.reference);
  if (!ref) { console.log(`  ${pair.reference}: SEM DADOS`); continue; }
  const rl = buildSwingLadder(ref.candles);
  const inter = detectSmtDivergences(pair, p.candles, pl.all, rl.all, { minDegree: 'intermediate' });
  const short = detectSmtDivergences(pair, p.candles, pl.all, rl.all, { minDegree: 'short' });
  const recent = inter.filter(e => e.primaryIndex >= p.candles.length - 15);
  console.log(`  ${pair.primary}/${pair.reference} (${pair.correlation}): intermediate=${inter.length}  short=${short.length}  recentes(15v)=${recent.length}`);
  for (const e of inter.slice(-2)) {
    console.log(`      ${e.at}@${e.primaryIndex} dir=${e.direction} forca=${e.strength.toFixed(2)} :: ${e.description}`);
  }
}
