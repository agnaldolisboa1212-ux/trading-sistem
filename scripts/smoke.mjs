/**
 * Smoke test end-to-end contra dados reais de mercado.
 *
 * Corre:   node scripts/smoke.mjs [SIMBOLO ...]
 * Exemplo: node scripts/smoke.mjs EURUSD NQ XAUUSD BTCUSD
 *
 * Nao escreve nada em lado nenhum — so busca velas, corre o motor e imprime o
 * diagnostico. E a forma mais rapida de ver se o pipeline inteiro esta vivo.
 */

import { analyzeInstrument, smtPairsFor, requiredSymbolsFor, INSTRUMENTS } from '../packages/core/dist/index.js';
import { ProviderRegistry } from '../packages/data/dist/index.js';

const symbols = process.argv.slice(2);
const targets = symbols.length > 0 ? symbols : ['EURUSD', 'NQ', 'XAUUSD', 'BTCUSD'];

const registry = new ProviderRegistry();

console.log('Providers ativos:');
for (const p of registry.listActive()) {
  console.log(`  - ${p.id.padEnd(18)} fidelidade=${p.fidelity.padEnd(10)} chave=${p.requiresKey ? 'sim' : 'nao'}`);
}
console.log('');

for (const symbol of targets) {
  const instrument = INSTRUMENTS.find((i) => i.symbol === symbol);
  if (!instrument) {
    console.log(`${symbol}: nao esta no universo configurado.\n`);
    continue;
  }

  const needed = requiredSymbolsFor(symbol);
  const pairs = smtPairsFor(symbol);

  process.stdout.write(`${symbol}: a buscar ${needed.length} serie(s) diarias... `);
  const daily = await registry.getMany(needed, '1d', 400);
  process.stdout.write(`ok (${daily.series.size}/${needed.length}) | semanal... `);
  const weekly = await registry.getMany([symbol], '1w', 200);
  console.log(weekly.series.has(symbol) ? 'ok' : 'FALHOU');

  for (const [sym, err] of daily.failures) {
    console.log(`   ! falha em ${sym}: ${err.slice(0, 120)}`);
  }

  const primary = daily.series.get(symbol);
  const higher = weekly.series.get(symbol);
  if (!primary || !higher) {
    console.log(`   ${symbol}: sem dados suficientes.\n`);
    continue;
  }

  const references = new Map();
  for (const p of pairs) {
    const s = daily.series.get(p.reference);
    if (s) references.set(p.reference, s);
  }

  const result = analyzeInstrument({
    primary,
    higher,
    references,
    smtPairs: pairs,
    riskConfig: {
      accountBalance: 1000,
      riskPercentPerTrade: 1,
      maxPortfolioRiskPercent: 5,
      maxConcurrentPositions: 5,
    },
  });

  const d = result.diagnostics;
  const last = primary.candles[primary.candles.length - 1];

  console.log(`   fonte=${primary.source} velas=${primary.candles.length} ultima=${new Date(last.time).toISOString().slice(0, 10)} fecho=${last.close}`);
  console.log(`   fluxo HTF: ${d.htfOrderFlow} | modelo: ${d.modelType ?? '-'} (${d.modelPhase ?? '-'})`);
  console.log(`   checklist: ${(d.checklistScore * 100).toFixed(0)}% | parou no passo: ${d.failedAtStep ?? 'nenhum'} | SMT: ${d.smtCount}`);
  console.log(`   ${d.summary}`);

  if (result.signal) {
    const s = result.signal;
    console.log('');
    console.log(`   >>> SINAL ${s.direction === 'bullish' ? 'COMPRA' : 'VENDA'} <<<`);
    console.log(`   entrada ${s.entryPrice.toFixed(5)} | stop ${s.stopLoss.toFixed(5)} | maxR ${s.maxRMultiple.toFixed(1)}`);
    console.log(`   confianca ${(s.confidence * 100).toFixed(0)}% | horizonte ~${s.expectedHorizonDays} dias`);
    for (const t of s.targets) {
      console.log(`     TP ${t.price.toFixed(5)}  ${t.rMultiple.toFixed(1)}R  fechar ${(t.closeFraction * 100).toFixed(0)}%`);
    }
  }
  console.log('');
}

console.log('Saude das fontes:');
for (const h of registry.getHealth()) {
  if (h.lastSuccessAt === null && h.lastErrorAt === null) continue;
  console.log(`  ${h.providerId.padEnd(18)} ok=${h.ok} latencia=${h.latencyMs ?? '-'}ms falhas=${h.consecutiveFailures}${h.lastError ? ` ultimo_erro="${h.lastError.slice(0, 80)}"` : ''}`);
}
