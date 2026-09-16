/**
 * Testes do ciclo de saída.
 *
 * Este é o caminho mais complexo do sistema e o menos exercitado na prática:
 * depende de haver um sinal, de ele ser preenchido, e de o preço fazer algo —
 * o que em swing trading pode demorar semanas. Testá-lo com dados sintéticos é
 * a única forma de saber que funciona antes de confiar nele com dinheiro.
 *
 * Cobre as regras que decidem o resultado de uma operação:
 *   - stop tem precedência sobre alvo na mesma vela (hipótese pessimista)
 *   - o primeiro alvo move o stop para break-even
 *   - as parciais reduzem a fração aberta corretamente
 *   - o modelo completo realiza metade e protege o resto
 *   - o time stop fecha operações paradas
 *
 * Corre com:  npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { applyExit, evaluateExits } from '../dist/index.js';

const DAY = 86_400_000;
const T0 = Date.parse('2026-01-01T00:00:00Z');

/** Constrói uma série a partir de tuplos [open, high, low, close]. */
function series(rows, symbol = 'TESTE') {
  return {
    symbol,
    timeframe: '1d',
    source: 'test',
    fidelity: 'true-ohlc',
    candles: rows.map(([o, h, l, c], i) => ({
      time: T0 + i * DAY,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: 0,
    })),
  };
}

/** Plano de saída de uma compra: entrada 100, stop 90 (risco = 10). */
function buyPlan(overrides = {}) {
  return {
    signalId: 'S1',
    symbol: 'TESTE',
    direction: 'bullish',
    entryPrice: 100,
    stopLoss: 90,
    targets: [
      { price: 120, rMultiple: 2, closeFraction: 0.3, rationale: 'TP1' },
      { price: 140, rMultiple: 4, closeFraction: 0.4, rationale: 'TP2' },
      { price: 160, rMultiple: 6, closeFraction: 0.3, rationale: 'TP3' },
    ],
    consolidationHigh: 150,
    consolidationLow: 80,
    expectedHorizonDays: 20,
    ...overrides,
  };
}

function position(overrides = {}) {
  return {
    plan: buyPlan(),
    filledPrice: 100,
    remainingFraction: 1,
    currentStop: 90,
    hitTargets: [],
    openedAt: T0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

test('stop atingido fecha a posicao toda', () => {
  const exits = evaluateExits({
    position: position(),
    series: series([[100, 102, 88, 95]]),
    currentSmt: [],
    now: T0 + DAY,
  });

  assert.equal(exits.length, 1);
  assert.equal(exits[0].reason, 'stop-hit');
  assert.equal(exits[0].closeFraction, 1);
  // Entrada 100, stop 90, risco 10 => perda de exatamente 1R.
  assert.ok(Math.abs(exits[0].rMultipleRealized - -1) < 1e-9);
});

test('stop tem precedencia sobre alvo na MESMA vela', () => {
  // Vela que toca o stop (88) e o primeiro alvo (120). Pelo OHLC e impossivel
  // saber qual veio primeiro; assumir o alvo inflacionaria os resultados.
  const exits = evaluateExits({
    position: position(),
    series: series([[100, 125, 88, 110]]),
    currentSmt: [],
    now: T0 + DAY,
  });

  assert.equal(exits.length, 1, 'so deve devolver a saida por stop');
  assert.equal(exits[0].reason, 'stop-hit');
});

test('primeiro alvo fecha a fracao certa e move o stop para break-even', () => {
  const exits = evaluateExits({
    position: position(),
    series: series([[100, 121, 99, 118]]),
    currentSmt: [],
    now: T0 + DAY,
  });

  const tp1 = exits.find((e) => e.reason === 'target-hit');
  assert.ok(tp1, 'devia ter atingido o alvo 1');
  assert.equal(tp1.closeFraction, 0.3);
  assert.equal(tp1.newStopLoss, 100, 'stop deve ir para o preco de preenchimento');
  assert.equal(tp1.rMultipleRealized, 2);
});

test('applyExit reduz a fracao aberta e regista o alvo', () => {
  const before = position();
  const exit = {
    signalId: 'S1',
    symbol: 'TESTE',
    reason: 'target-hit',
    closeFraction: 0.3,
    price: 120,
    time: T0 + DAY,
    newStopLoss: 100,
    rMultipleRealized: 2,
    narrative: '',
  };

  const after = applyExit(before, exit);
  assert.ok(Math.abs(after.remainingFraction - 0.7) < 1e-9);
  assert.equal(after.currentStop, 100);
  assert.deepEqual(after.hitTargets, [0]);
});

test('nao repete um alvo ja atingido', () => {
  const exits = evaluateExits({
    position: position({ hitTargets: [0], remainingFraction: 0.7, currentStop: 100 }),
    series: series([[110, 121, 105, 118]]),
    currentSmt: [],
    now: T0 + DAY,
  });

  assert.equal(
    exits.filter((e) => e.reason === 'target-hit').length,
    0,
    'o alvo 1 ja tinha sido registado',
  );
});

test('atravessar a consolidacao original realiza metade e protege o resto', () => {
  // Fecho acima de consolidationHigh (150), sem tocar alvos ainda nao atingidos.
  const exits = evaluateExits({
    position: position({ hitTargets: [0, 1], remainingFraction: 0.3, currentStop: 100 }),
    series: series([[145, 152, 144, 151]]),
    currentSmt: [],
    now: T0 + DAY,
  });

  const done = exits.find((e) => e.reason === 'model-completed');
  assert.ok(done, 'devia detetar o modelo completo');
  assert.ok(done.closeFraction <= 0.3, 'nunca fecha mais do que resta');
  assert.equal(done.newStopLoss, 80, 'stop protegido atras da consolidacao');
});

test('time stop fecha operacao parada sem alvos atingidos', () => {
  const exits = evaluateExits({
    position: position({ openedAt: T0 }),
    series: series([[100, 101, 99, 100]]),
    currentSmt: [],
    // Horizonte 20 dias => time stop a 40; 50 dias ja passou.
    now: T0 + 50 * DAY,
  });

  const stop = exits.find((e) => e.reason === 'time-stop');
  assert.ok(stop, 'devia disparar o time stop');
  assert.equal(stop.closeFraction, 1);
});

test('time stop NAO dispara se ja houve alvo atingido', () => {
  const exits = evaluateExits({
    position: position({ hitTargets: [0], remainingFraction: 0.7, currentStop: 100 }),
    series: series([[110, 112, 108, 111]]),
    currentSmt: [],
    now: T0 + 50 * DAY,
  });

  assert.equal(
    exits.filter((e) => e.reason === 'time-stop').length,
    0,
    'uma operacao que ja realizou lucro nao e "parada"',
  );
});

test('venda: stop e alvos invertem-se corretamente', () => {
  const sellPlan = {
    ...buyPlan(),
    direction: 'bearish',
    entryPrice: 100,
    stopLoss: 110,
    targets: [{ price: 80, rMultiple: 2, closeFraction: 1, rationale: 'TP1' }],
    consolidationHigh: 120,
    consolidationLow: 50,
  };

  const exits = evaluateExits({
    position: {
      plan: sellPlan,
      filledPrice: 100,
      remainingFraction: 1,
      currentStop: 110,
      hitTargets: [],
      openedAt: T0,
    },
    series: series([[100, 101, 79, 82]]),
    currentSmt: [],
    now: T0 + DAY,
  });

  const tp = exits.find((e) => e.reason === 'target-hit');
  assert.ok(tp, 'numa venda o alvo esta ABAIXO da entrada');
  assert.equal(tp.rMultipleRealized, 2);
});

test('SMT invertido em varios pares reduz exposicao', () => {
  const smt = [
    { reference: 'A', direction: 'bearish', primaryIndex: 0, at: 'high', strength: 0.5 },
    { reference: 'B', direction: 'bearish', primaryIndex: 0, at: 'high', strength: 0.5 },
  ];

  const exits = evaluateExits({
    position: position(),
    series: series([[100, 105, 99, 104]]),
    currentSmt: smt,
    now: T0 + DAY,
  });

  const rev = exits.find((e) => e.reason === 'smt-reversed');
  assert.ok(rev, 'dois pares a divergir contra a posicao devem reduzir');
  assert.ok(rev.closeFraction <= 0.5);
});
