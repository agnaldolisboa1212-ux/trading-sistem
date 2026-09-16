/**
 * Testes das funcoes puras do motor.
 *
 * Cobrem sobretudo os pontos onde ja foram encontrados defeitos reais durante a
 * validacao — sao esses que precisam de rede de seguranca contra regressoes:
 *
 *   - inversao de series (maxima e minima TEM de trocar)
 *   - deteccao de OHLC degenerado (o bug dos pares `=X` do Yahoo)
 *   - direcao implicada pelo SMT (havia um ternario morto)
 *   - emparelhamento de swings um-para-um (mapeava varios para o mesmo)
 *   - regras dos macros (as duas regras de execucao do eBook)
 *   - matematica de risco
 *
 * Corre com:  npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assessOhlcQuality,
  breakEvenWinRate,
  buildTargetPlan,
  calculatePositionSize,
  detectFairValueGaps,
  detectShortTermSwings,
  detectSmtDivergences,
  evaluateMacroExecution,
  expectancy,
  readOrderFlow,
  simulateSequence,
} from '../dist/index.js';

import { invertCandles } from '../../data/dist/index.js';

/** Constroi uma vela com valores explicitos. */
const c = (time, open, high, low, close, volume = 0) => ({ time, open, high, low, close, volume });

const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Inversao de series
// ---------------------------------------------------------------------------

test('invertCandles troca maxima e minima', () => {
  // CHF/USD: abriu a 1.25, tocou 1.30 em cima e 1.20 em baixo, fechou a 1.28.
  const [out] = invertCandles([c(0, 1.25, 1.3, 1.2, 1.28)]);

  assert.ok(Math.abs(out.open - 1 / 1.25) < 1e-12);
  assert.ok(Math.abs(out.close - 1 / 1.28) < 1e-12);
  // A maxima de USD/CHF corresponde a MINIMA de CHF/USD.
  assert.ok(Math.abs(out.high - 1 / 1.2) < 1e-12, 'high deve vir do low original');
  assert.ok(Math.abs(out.low - 1 / 1.3) < 1e-12, 'low deve vir do high original');
  // Invariante que o bug original violava.
  assert.ok(out.high > out.low, 'high tem de continuar acima de low apos inverter');
});

test('invertCandles descarta precos nao positivos em vez de gerar Infinity', () => {
  assert.equal(invertCandles([c(0, 0, 1, 0, 1)]).length, 0);
  assert.equal(invertCandles([c(0, -1, 1, 0.5, 1)]).length, 0);
});

// ---------------------------------------------------------------------------
// Qualidade do OHLC — o defeito dos pares `=X` do Yahoo
// ---------------------------------------------------------------------------

test('assessOhlcQuality apanha series com abertura sintetizada', () => {
  // Corpo quase nulo com range real: exatamente o padrao do EURUSD=X.
  const degenerate = Array.from({ length: 60 }, (_, i) =>
    c(i * DAY, 1.1, 1.105, 1.095, 1.1 + 1e-6),
  );
  const verdict = assessOhlcQuality(degenerate);

  assert.equal(verdict.degenerate, true);
  assert.ok(verdict.bodyToRangeRatio < 0.01);
  assert.match(verdict.reason, /sintetizar/);
});

test('assessOhlcQuality aceita OHLC real', () => {
  // Corpo ~50% do range, como nos futuros da CME.
  const healthy = Array.from({ length: 60 }, (_, i) =>
    c(i * DAY, 1.1, 1.11, 1.09, 1.105),
  );
  const verdict = assessOhlcQuality(healthy);

  assert.equal(verdict.degenerate, false);
  assert.ok(verdict.bodyToRangeRatio > 0.2);
});

test('assessOhlcQuality recusa amostras demasiado pequenas', () => {
  assert.equal(assessOhlcQuality([c(0, 1, 2, 0.5, 1.5)]).degenerate, true);
});

// ---------------------------------------------------------------------------
// Swings e fluxo
// ---------------------------------------------------------------------------

test('detectShortTermSwings encontra o topo e o fundo locais', () => {
  const candles = [
    c(0 * DAY, 10, 11, 9, 10),
    c(1 * DAY, 10, 12, 10, 11),
    c(2 * DAY, 11, 15, 11, 14), // topo
    c(3 * DAY, 14, 13, 10, 11),
    c(4 * DAY, 11, 12, 8, 9),
    c(5 * DAY, 9, 10, 5, 6), // fundo
    c(6 * DAY, 6, 9, 6, 8),
    c(7 * DAY, 8, 11, 7, 10),
  ];
  const swings = detectShortTermSwings(candles, { lookback: 2 });

  assert.ok(swings.some((s) => s.kind === 'high' && s.index === 2), 'topo em i=2');
  assert.ok(swings.some((s) => s.kind === 'low' && s.index === 5), 'fundo em i=5');
});

test('readOrderFlow separa tendencia de estrutura misturada', () => {
  const swing = (index, price, kind) => ({
    index,
    time: index * DAY,
    price,
    kind,
    degree: 'intermediate',
  });

  const bullish = [
    swing(0, 10, 'low'), swing(1, 20, 'high'),
    swing(2, 14, 'low'), swing(3, 25, 'high'),
    swing(4, 18, 'low'), swing(5, 30, 'high'),
  ];
  assert.equal(readOrderFlow(bullish).direction, 'bullish');

  // Higher high seguido de lower low: genuinamente indeciso.
  const mixed = [
    swing(0, 10, 'low'), swing(1, 20, 'high'),
    swing(2, 14, 'low'), swing(3, 25, 'high'),
    swing(4, 8, 'low'), swing(5, 22, 'high'),
  ];
  assert.equal(readOrderFlow(mixed).direction, 'neutral');
});

// ---------------------------------------------------------------------------
// Fair Value Gaps
// ---------------------------------------------------------------------------

test('detectFairValueGaps identifica gap de alta e calcula o CE', () => {
  const candles = [
    c(0 * DAY, 10, 11, 9, 10.5),
    c(1 * DAY, 10.5, 20, 10.5, 19), // displacement
    c(2 * DAY, 19, 21, 15, 20), // low 15 > high 11 da primeira -> BISI
    c(3 * DAY, 20, 22, 19, 21),
  ];
  const gaps = detectFairValueGaps(candles, { minSizeAtrRatio: 0 });
  const bullish = gaps.find((g) => g.direction === 'bullish');

  assert.ok(bullish, 'deve existir um FVG de alta');
  assert.equal(bullish.low, 11);
  assert.equal(bullish.high, 15);
  assert.equal(bullish.ce, 13, 'Consequent Encroachment e o ponto medio');
});

// ---------------------------------------------------------------------------
// SMT — direcao implicada e emparelhamento
// ---------------------------------------------------------------------------

test('SMT em topos e bearish e em fundos e bullish', () => {
  const pair = { primary: 'NQ', reference: 'ES', correlation: 'positive', weight: 1 };

  const sw = (index, price, kind) => ({
    index,
    time: index * DAY,
    price,
    kind,
    degree: 'intermediate',
  });

  const candles = Array.from({ length: 40 }, (_, i) => c(i * DAY, 100, 101, 99, 100));

  // Topos: o primario sobe, a referencia falha -> crack em topos.
  const primaryHighs = [sw(10, 100, 'high'), sw(20, 110, 'high')];
  const referenceHighs = [sw(10, 100, 'high'), sw(20, 95, 'high')];

  const highEvents = detectSmtDivergences(pair, candles, primaryHighs, referenceHighs, {
    minDegree: 'intermediate',
  });
  assert.equal(highEvents.length, 1);
  assert.equal(highEvents[0].direction, 'bearish', 'crack em topos implica leitura bearish');
  assert.equal(highEvents[0].at, 'high');

  // Fundos: o primario desce, a referencia nao acompanha -> crack em fundos.
  const primaryLows = [sw(10, 100, 'low'), sw(20, 90, 'low')];
  const referenceLows = [sw(10, 100, 'low'), sw(20, 105, 'low')];

  const lowEvents = detectSmtDivergences(pair, candles, primaryLows, referenceLows, {
    minDegree: 'intermediate',
  });
  assert.equal(lowEvents.length, 1);
  assert.equal(lowEvents[0].direction, 'bullish', 'crack em fundos implica leitura bullish');
});

test('correlacao inversa diverge quando os dois se movem no MESMO sentido', () => {
  const sw = (index, price, kind) => ({
    index, time: index * DAY, price, kind, degree: 'intermediate',
  });
  const candles = Array.from({ length: 40 }, (_, i) => c(i * DAY, 100, 101, 99, 100));

  const inverse = { primary: 'EURUSD', reference: 'DXY', correlation: 'inverse', weight: 1 };

  // Ambos fazem higher high: para pares inversos, isso e a rachadura.
  const events = detectSmtDivergences(
    inverse,
    candles,
    [sw(10, 100, 'high'), sw(20, 110, 'high')],
    [sw(10, 100, 'high'), sw(20, 108, 'high')],
    { minDegree: 'intermediate' },
  );
  assert.equal(events.length, 1);

  // Movimentos opostos sao o comportamento NORMAL — nao ha divergencia.
  const none = detectSmtDivergences(
    inverse,
    candles,
    [sw(10, 100, 'high'), sw(20, 110, 'high')],
    [sw(10, 100, 'high'), sw(20, 92, 'high')],
    { minDegree: 'intermediate' },
  );
  assert.equal(none.length, 0);
});

// ---------------------------------------------------------------------------
// Macros — as duas regras de execucao do eBook
// ---------------------------------------------------------------------------

test('regra 1: SMR dentro de janela de reversao permite executar', () => {
  // 2026-08-04 e uma terca-feira: nucleo da janela de reversao semanal.
  const tuesday = Date.parse('2026-08-04T12:00:00Z');
  const verdict = evaluateMacroExecution(tuesday, tuesday);

  assert.equal(verdict.canExecute, true);
  assert.equal(verdict.rule, 'smr-in-toi');
  assert.ok(verdict.score > 0);
});

test('regra 2: SMR fora de janela obriga a esperar pela expansao', () => {
  // 2026-08-08 e um sabado: fora de qualquer janela.
  const saturday = Date.parse('2026-08-08T12:00:00Z');
  const waiting = evaluateMacroExecution(saturday, saturday);

  assert.equal(waiting.canExecute, false);
  assert.equal(waiting.rule, 'smr-out-of-toi-waiting');
  assert.equal(waiting.score, 0);

  // A quinta-feira seguinte esta na janela de expansao: ja pode executar.
  const thursday = Date.parse('2026-08-13T12:00:00Z');
  const active = evaluateMacroExecution(saturday, thursday);

  assert.equal(active.canExecute, true);
  assert.equal(active.rule, 'smr-out-of-toi-expansion-active');
});

// ---------------------------------------------------------------------------
// Risco
// ---------------------------------------------------------------------------

test('calculatePositionSize dimensiona pela distancia do stop', () => {
  const size = calculatePositionSize(100, 90, {
    accountBalance: 10_000,
    riskPercentPerTrade: 1,
    maxPortfolioRiskPercent: 5,
    maxConcurrentPositions: 5,
  });

  assert.equal(size.riskAmount, 100); // 1% de 10 000
  assert.equal(size.stopDistance, 10);
  assert.equal(size.units, 10); // 100 / 10
  assert.equal(size.notional, 1000);
});

test('calculatePositionSize avisa quando o risco excede o intervalo institucional', () => {
  const size = calculatePositionSize(100, 90, {
    accountBalance: 1000,
    riskPercentPerTrade: 100,
    maxPortfolioRiskPercent: 100,
    maxConcurrentPositions: 1,
  });
  assert.ok(size.warnings.some((w) => w.includes('acima do intervalo')));
});

test('calculatePositionSize nao divide por zero com stop na entrada', () => {
  const size = calculatePositionSize(100, 100, {
    accountBalance: 1000,
    riskPercentPerTrade: 1,
    maxPortfolioRiskPercent: 5,
    maxConcurrentPositions: 5,
  });
  assert.equal(size.units, 0);
  assert.ok(size.warnings.length > 0);
});

test('buildTargetPlan rejeita setups abaixo do R minimo', () => {
  // Alvos muito proximos da entrada face ao risco.
  const plan = buildTargetPlan({
    entry: 100,
    stopLoss: 90,
    direction: 'bullish',
    consolidationTarget: 105,
    drawOnLiquidityTarget: 108,
    minRMultiple: 3,
  });

  assert.equal(plan.viable, false);
  assert.match(plan.reason, /abaixo do minimo/);
});

test('buildTargetPlan aceita setups com espaco e as fracoes somam 1', () => {
  const plan = buildTargetPlan({
    entry: 100,
    stopLoss: 90,
    direction: 'bullish',
    consolidationTarget: 140,
    drawOnLiquidityTarget: 190,
    minRMultiple: 3,
  });

  assert.equal(plan.viable, true);
  assert.ok(plan.maxR >= 8);

  const total = plan.targets.reduce((a, t) => a + t.closeFraction, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, 'as fracoes de fecho tem de somar 1');
});

test('expectancy e breakEvenWinRate sao coerentes entre si', () => {
  // A 5R, o break-even esta em 1/6 dos acertos.
  const rate = breakEvenWinRate(5);
  assert.ok(Math.abs(rate - 1 / 6) < 1e-12);
  assert.ok(Math.abs(expectancy(rate, 5)) < 1e-12, 'no break-even a expectativa e zero');

  assert.ok(expectancy(0.4, 3) > 0);
  assert.ok(expectancy(0.1, 3) < 0);
});

test('simulateSequence mostra a ruina de arriscar tudo numa operacao', () => {
  const config = {
    accountBalance: 1000,
    riskPercentPerTrade: 100,
    maxPortfolioRiskPercent: 100,
    maxConcurrentPositions: 1,
  };
  // Cinco vitorias enormes seguidas de uma unica perda total.
  const result = simulateSequence([5, 5, 5, 5, 5, -1], config);

  assert.equal(result.finalBalance, 0);
  assert.equal(result.ruined, true);
});

test('simulateSequence com risco de 1% sobrevive a uma sequencia longa de perdas', () => {
  const config = {
    accountBalance: 1000,
    riskPercentPerTrade: 1,
    maxPortfolioRiskPercent: 5,
    maxConcurrentPositions: 5,
  };
  const result = simulateSequence(Array(10).fill(-1), config);

  assert.equal(result.ruined, false);
  assert.ok(result.finalBalance > 900, 'dez perdas a 1% custam ~10% da conta');
});
