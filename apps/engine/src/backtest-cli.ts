/**
 * CLI de backtest.
 *
 *   node dist/backtest-cli.js                      universo completo
 *   node dist/backtest-cli.js EURUSD NQ            instrumentos escolhidos
 *   node dist/backtest-cli.js --sweep              analise de sensibilidade
 *
 * A janela de analise usada e a MESMA do motor em producao (`CANDLE_LIMIT`).
 * Um backtest que ve mais historico do que a producao nao testa a producao.
 *
 * Os resultados sao escritos em `data/backtest.json`, que o dashboard le quando
 * o Supabase nao esta configurado.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { INSTRUMENTS, requiredSymbolsFor, smtPairsFor, type CandleSeries } from '@trading/core';
import { ProviderRegistry } from '@trading/data';
import { loadConfig } from './config.js';
import { backtestInstrument, formatBacktest, type BacktestResult } from './pipeline/backtest.js';

const config = loadConfig();
const args = process.argv.slice(2);
const sweep = args.includes('--sweep');
const targets = args.filter((a) => !a.startsWith('--')).map((s) => s.toUpperCase());
const symbols = targets.length > 0 ? targets : INSTRUMENTS.map((i) => i.symbol);

const HISTORY = Number(process.env['BACKTEST_CANDLES'] ?? 1500);
const registry = new ProviderRegistry();

// ---------------------------------------------------------------------------
// Carregamento — uma vez so, reutilizado por todas as configuracoes do sweep.
// ---------------------------------------------------------------------------

interface Dataset {
  symbol: string;
  primary: CandleSeries;
  higher: CandleSeries;
  references: Map<string, CandleSeries>;
}

console.log(`A carregar dados (${HISTORY} velas, ${symbols.length} instrumentos)...`);

const needed = new Set<string>();
for (const s of symbols) for (const r of requiredSymbolsFor(s)) needed.add(r);

const daily = await registry.getMany([...needed], config.timeframe, HISTORY);
const weekly = await registry.getMany(symbols, config.higherTimeframe, 400);

const datasets: Dataset[] = [];
for (const symbol of symbols) {
  const primary = daily.series.get(symbol);
  const higher = weekly.series.get(symbol);
  if (!primary || !higher) {
    console.log(`  ${symbol}: SEM DADOS — ignorado`);
    continue;
  }
  const references = new Map<string, CandleSeries>();
  for (const pair of smtPairsFor(symbol)) {
    const ref = daily.series.get(pair.reference);
    if (ref) references.set(pair.reference, ref);
  }
  datasets.push({ symbol, primary, higher, references });
}

console.log(`${datasets.length} instrumentos prontos.\n`);

// ---------------------------------------------------------------------------

interface Aggregate {
  label: string;
  minConfidence: number;
  minRMultiple: number;
  trades: number;
  neverFilled: number;
  wins: number;
  losses: number;
  winRate: number;
  averageWinR: number;
  averageLossR: number;
  totalR: number;
  expectancyR: number;
  profitFactor: number;
  best: number;
  worst: number;
}

function runConfiguration(minConfidence: number, minRMultiple: number, verbose: boolean): {
  aggregate: Aggregate;
  results: BacktestResult[];
} {
  const results: BacktestResult[] = [];

  for (const d of datasets) {
    const result = backtestInstrument({
      primary: d.primary,
      higher: d.higher,
      references: d.references,
      risk: config.risk,
      minRMultiple,
      minConfidence,
      // Mesma janela que o motor ao vivo usa.
      analysisWindow: config.candleLimit,
      higherWindow: config.higherCandleLimit,
    });
    results.push(result);
    if (verbose) {
      console.log(formatBacktest(result));
      console.log('');
    }
  }

  const closed = results
    .flatMap((r) => r.trades)
    .filter((t) => t.outcome === 'win' || t.outcome === 'loss' || t.outcome === 'breakeven');
  const neverFilled = results
    .flatMap((r) => r.trades)
    .filter((t) => t.outcome === 'never-filled').length;

  const rs = closed.map((t) => t.rMultiple);
  const wins = rs.filter((r) => r > 0.05);
  const losses = rs.filter((r) => r < -0.05);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

  const winRate = rs.length ? wins.length / rs.length : 0;
  const averageWinR = avg(wins);
  const grossLoss = Math.abs(sum(losses));

  return {
    results,
    aggregate: {
      label: `conf>=${minConfidence.toFixed(2)} R>=${minRMultiple}`,
      minConfidence,
      minRMultiple,
      trades: rs.length,
      neverFilled,
      wins: wins.length,
      losses: losses.length,
      winRate,
      averageWinR,
      averageLossR: avg(losses),
      totalR: sum(rs),
      expectancyR: winRate * averageWinR - (1 - winRate),
      profitFactor: grossLoss > 0 ? sum(wins) / grossLoss : sum(wins) > 0 ? Infinity : 0,
      best: rs.length ? Math.max(...rs) : 0,
      worst: rs.length ? Math.min(...rs) : 0,
    },
  };
}

// ---------------------------------------------------------------------------

const outputPath = resolve(process.cwd(), 'data', 'backtest.json');

if (sweep) {
  /*
   * Analise de sensibilidade.
   *
   * Serve para responder a uma pergunta concreta: os filtros estao a
   * selecionar setups melhores, ou apenas a reduzir a amostra? Se a expectativa
   * nao melhorar a medida que os filtros apertam, os filtros nao estao a
   * discriminar — estao so a cortar operacoes ao acaso.
   */
  const confidences = [0.4, 0.5, 0.6, 0.7];
  const rMultiples = [2, 3, 4];
  const grid: Aggregate[] = [];

  for (const conf of confidences) {
    for (const minR of rMultiples) {
      process.stdout.write(`  a correr conf>=${conf} R>=${minR}... `);
      const { aggregate } = runConfiguration(conf, minR, false);
      grid.push(aggregate);
      console.log(`${aggregate.trades} operacoes, ${aggregate.totalR.toFixed(1)}R`);
    }
  }

  console.log('');
  console.log('='.repeat(96));
  console.log('ANALISE DE SENSIBILIDADE');
  console.log('='.repeat(96));
  console.log(
    'conf   minR   ops   naoPreench   acerto   Rmedio+   Rmedio-   Rtotal   expect   PF     melhor',
  );
  console.log('-'.repeat(96));
  for (const a of grid) {
    console.log(
      `${a.minConfidence.toFixed(2)}   ${String(a.minRMultiple).padStart(4)}   ` +
        `${String(a.trades).padStart(3)}   ${String(a.neverFilled).padStart(10)}   ` +
        `${(a.winRate * 100).toFixed(0).padStart(5)}%   ${a.averageWinR.toFixed(2).padStart(7)}   ` +
        `${a.averageLossR.toFixed(2).padStart(7)}   ${a.totalR.toFixed(1).padStart(6)}   ` +
        `${a.expectancyR.toFixed(2).padStart(6)}   ` +
        `${(a.profitFactor === Infinity ? 'inf' : a.profitFactor.toFixed(2)).padStart(5)}   ` +
        `${a.best.toFixed(1).padStart(6)}`,
    );
  }
  console.log('='.repeat(96));
  console.log(
    '\nLeitura: se a coluna `expect` NAO subir de forma consistente quando `conf` e `minR`\n' +
      'aumentam, os filtros nao estao a discriminar qualidade — estao apenas a reduzir a amostra.',
  );

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(), sweep: grid }, null, 2));
  console.log(`\nGravado em ${outputPath}`);
} else {
  const { aggregate, results } = runConfiguration(config.minConfidence, config.minRMultiple, true);

  console.log('='.repeat(78));
  console.log(`AGREGADO — ${aggregate.label}  ·  janela de analise ${config.candleLimit} velas`);
  console.log('='.repeat(78));
  if (aggregate.trades === 0) {
    console.log('Nenhuma operacao fechada. Amostra insuficiente para concluir seja o que for.');
  } else {
    console.log(
      `operacoes=${aggregate.trades}  vitorias=${aggregate.wins}  derrotas=${aggregate.losses}  ` +
        `nao preenchidos=${aggregate.neverFilled}`,
    );
    console.log(
      `taxa de acerto=${(aggregate.winRate * 100).toFixed(1)}%  ` +
        `R medio ganho=${aggregate.averageWinR.toFixed(2)}  R medio perdido=${aggregate.averageLossR.toFixed(2)}`,
    );
    console.log(
      `R total=${aggregate.totalR.toFixed(2)}  expectativa=${aggregate.expectancyR.toFixed(3)}R/operacao  ` +
        `profit factor=${aggregate.profitFactor === Infinity ? 'inf' : aggregate.profitFactor.toFixed(2)}`,
    );
    console.log(`melhor=${aggregate.best.toFixed(2)}R  pior=${aggregate.worst.toFixed(2)}R`);

    // Aviso estatistico explicito: sem isto e facil ler ruido como resultado.
    if (aggregate.trades < 30) {
      console.log('');
      console.log(
        `AVISO: ${aggregate.trades} operacoes nao suportam qualquer conclusao estatistica.\n` +
          'Com esta amostra, o intervalo de confianca da taxa de acerto e largo demais para\n' +
          'distinguir uma estrategia positiva de ruido. Sao precisas 100+ operacoes.',
      );
    }
  }
  console.log('='.repeat(78));

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        analysisWindow: config.candleLimit,
        aggregate,
        perInstrument: results.map((r) => ({
          symbol: r.symbol,
          periodStart: r.periodStart,
          periodEnd: r.periodEnd,
          totalSignals: r.totalSignals,
          wins: r.wins,
          losses: r.losses,
          winRate: r.winRate,
          averageR: r.averageR,
          expectancyR: r.expectancyR,
          maxDrawdownPercent: r.maxDrawdownPercent,
          trades: r.trades,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`\nGravado em ${outputPath}`);
}
