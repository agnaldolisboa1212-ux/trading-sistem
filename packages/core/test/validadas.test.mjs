/**
 * Estratégias validadas — as únicas que geram sinais.
 *
 * Os testes fixam as regras exactamente como foram medidas no backtest: se
 * alguém mudar um limiar, o texto do sinal passa a mentir sobre os números.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estrategiasPara,
  estrategiaValidada,
  executarEstrategiasValidadas,
  planCompraVwapIndices,
  planConnorsIndices,
  planTendenciaCripto,
  saidaDinamica,
  temEstrategiaValidada,
} from '../dist/index.js';

const H = 3_600_000;
const D = 86_400_000;
const vela = (time, open, high, low, close) => ({ time, open, high, low, close, volume: 0 });

test('só índices e cripto validados, nos timeframes medidos', () => {
  assert.deepEqual(estrategiasPara('US100', '1h').map((e) => e.id), ['compra-vwap-indices']);
  assert.deepEqual(estrategiasPara('SP500', '1d').map((e) => e.id), ['connors-rsi2-indices']);
  // BTCUSD 1d: a compra validada, mais a venda em teste (tendencia-baixa-cripto).
  const btc1d = estrategiasPara('BTCUSD', '1d');
  assert.ok(btc1d.some((e) => e.id === 'tendencia-cripto' && !('emTeste' in e)));
  assert.ok(btc1d.filter((e) => e.id !== 'tendencia-cripto').every((e) => 'emTeste' in e));
  assert.equal(estrategiasPara('US100', '15m').length, 0);
  // Forex e ouro intradiário só têm estratégias EM TESTE (em-teste.test.mjs).
  assert.ok(estrategiasPara('EURUSD', '1h').every((e) => 'emTeste' in e));
  assert.deepEqual(estrategiasPara('XAUUSD', '1d').map((e) => e.id), ['tendencia-ouro']);
  assert.ok(estrategiasPara('XAUUSD', '1h').every((e) => 'emTeste' in e));
  assert.equal(estrategiasPara('V75', '1h').length, 0);
  assert.equal(temEstrategiaValidada('GBPUSD'), false);
  assert.equal(temEstrategiaValidada('ETHUSD'), true);
});

/** Um mês de velas de 1h a oscilar, e um fecho final muito abaixo. */
function mesComQueda(profundidade) {
  const inicio = Date.UTC(2026, 8, 1);
  const v = [];
  let p = 100;
  for (let i = 0; i < 200; i++) {
    const onda = Math.sin(i / 3) * 0.6;
    const c = 100 + onda;
    v.push(vela(inicio + i * H, p, Math.max(p, c) + 0.3, Math.min(p, c) - 0.3, c));
    p = c;
  }
  // Queda nas últimas velas até `profundidade` abaixo.
  for (let k = 1; k <= 6; k++) {
    const c = 100 - (profundidade * k) / 6;
    v.push(vela(inicio + (200 + k) * H, p, p + 0.05, c - 0.05, c));
    p = c;
  }
  return v;
}

test('VWAP: compra quando fecha 2σ abaixo, sobrevendido; nada numa oscilação normal', () => {
  const queda = mesComQueda(6);
  const s = planCompraVwapIndices(queda, { symbol: 'US30', timeframe: '1h' });
  assert.equal(s.length, 1);
  assert.equal(s[0].direction, 'bullish');
  assert.equal(s[0].strategy, 'compra-vwap-indices');
  assert.ok(s[0].stopLoss < s[0].entryPrice);
  const risco = s[0].entryPrice - s[0].stopLoss;
  assert.ok(Math.abs(s[0].targets[0].price - (s[0].entryPrice + risco)) < 1e-9, 'TP1 a +1R');
  assert.ok(Math.abs(s[0].targets[1].price - (s[0].entryPrice + 2 * risco)) < 1e-9, 'TP2 a +2R');
  assert.ok(s[0].conviction >= 0.67 && s[0].conviction <= 0.71);

  const calmo = mesComQueda(0);
  assert.equal(planCompraVwapIndices(calmo, { symbol: 'US30', timeframe: '1h' }).length, 0);
});

test('VWAP: o mesmo gráfico no EURUSD não dá sinal validado (só o de teste)', () => {
  const eurusd = executarEstrategiasValidadas(mesComQueda(6), { symbol: 'EURUSD', timeframe: '1h' });
  assert.equal(eurusd.filter((s) => estrategiaValidada(s.strategy)).length, 0);
  assert.equal(executarEstrategiasValidadas(mesComQueda(6), { symbol: 'US30', timeframe: '15m' }).length, 0);
});

/** 240 dias a subir devagar e depois `quedas` dias a descer. */
function tendenciaComCorreccao(quedas) {
  const v = [];
  let p = 100;
  for (let i = 0; i < 240; i++) {
    const c = p * 1.002 + (i % 2 === 0 ? 0.2 : -0.1);
    v.push(vela(i * D, p, Math.max(p, c) + 0.5, Math.min(p, c) - 0.5, c));
    p = c;
  }
  for (let k = 0; k < quedas; k++) {
    const c = p * 0.985;
    v.push(vela((240 + k) * D, p, p + 0.2, c - 0.3, c));
    p = c;
  }
  return v;
}

test('Connors: compra a correcção curta acima da média de 200', () => {
  const s = planConnorsIndices(tendenciaComCorreccao(3), { symbol: 'SP500', timeframe: '1d' });
  assert.equal(s.length, 1);
  assert.equal(s[0].strategy, 'connors-rsi2-indices');
  assert.ok(Math.abs(s[0].entryPrice - s[0].stopLoss) > 0);
  assert.equal(planConnorsIndices(tendenciaComCorreccao(0), { symbol: 'SP500', timeframe: '1d' }).length, 0);
  const saida = saidaDinamica('connors-rsi2-indices', tendenciaComCorreccao(3));
  assert.equal(saida?.tipo, 'fecho-acima');
});

test('Tendência cripto: só o PRIMEIRO fecho acima do máximo de 55 dias', () => {
  const v = [];
  for (let i = 0; i < 80; i++) v.push(vela(i * D, 100, 101 + (i % 3) * 0.1, 99, 100));
  const rompe = [...v, vela(80 * D, 100, 106, 100, 105)];
  const s = planTendenciaCripto(rompe, { symbol: 'BTCUSD', timeframe: '1d' });
  assert.equal(s.length, 1);
  assert.equal(s[0].targets.length, 0, 'sem alvo fixo');
  const segueAcima = [...rompe, vela(81 * D, 105, 108, 104, 107)];
  assert.equal(planTendenciaCripto(segueAcima, { symbol: 'BTCUSD', timeframe: '1d' }).length, 0);
  assert.equal(saidaDinamica('tendencia-cripto', segueAcima)?.tipo, 'stop-movel');
});

test('Tendência no ouro: a mesma regra, com a taxa medida no ouro', () => {
  const v = [];
  for (let i = 0; i < 80; i++) v.push(vela(i * D, 2000, 2010 + (i % 3), 1990, 2000));
  const rompe = [...v, vela(80 * D, 2000, 2060, 2000, 2050)];
  const s = executarEstrategiasValidadas(rompe, { symbol: 'XAUUSD', timeframe: '1d' });
  assert.equal(s.length, 1);
  assert.equal(s[0].strategy, 'tendencia-ouro');
  assert.equal(s[0].conviction, 0.48);
  assert.equal(saidaDinamica('tendencia-ouro', rompe)?.tipo, 'stop-movel');
});
