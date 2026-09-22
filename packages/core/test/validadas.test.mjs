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
  acompanharOperacao,
  planCompraVwapIndices,
  planConnorsIndices,
  planRompimento4h,
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
  // BTCUSD 1d: duas compras validadas (tendência de 55 dias e Connors), mais a
  // venda em teste (tendencia-baixa-cripto).
  const btc1d = estrategiasPara('BTCUSD', '1d');
  const validadasBtc = btc1d.filter((e) => !('emTeste' in e)).map((e) => e.id);
  assert.deepEqual(validadasBtc.sort(), ['connors-rsi2-indices', 'tendencia-cripto']);
  assert.ok(btc1d.filter((e) => validadasBtc.includes(e.id) === false).every((e) => 'emTeste' in e));
  // O Nikkei entrou no catálogo diário (15 anos de dados), mas NÃO no VWAP
  // intradiário, onde nunca foi medido.
  assert.deepEqual(
    estrategiasPara('JP225', '1d').map((e) => e.id).sort(),
    ['connors-rsi2-indices', 'tendencia-indices'],
  );
  assert.equal(estrategiasPara('JP225', '1h').length, 0);
  // O paládio entrou no Connors (22/09/2026); a platina foi testada e recusada.
  assert.deepEqual(estrategiasPara('XPDUSD', '1d').map((e) => e.id), ['connors-rsi2-indices']);
  assert.equal(estrategiasPara('XPTUSD', '1d').length, 0);
  // Testados e recusados: ficam sem estratégia nenhuma.
  for (const s of ['UK100', 'FRA40', 'SWI20', 'NL25', 'AUS200', 'HK50', 'AUDUSD', 'NZDUSD', 'EURGBP']) {
    assert.equal(estrategiasPara(s, '1d').length, 0, s);
  }
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

// --- Rompimento de 20 velas a favor da tendência (4h) ---------------------------

const Q = 4 * H;

/**
 * 230 velas a subir (põem a EMA 50 acima da EMA 200), 30 de consolidação com o
 * máximo em `tecto`, e uma última vela que fecha onde se pedir.
 *
 * A consolidação é essencial: numa série que sobe sempre, TODAS as velas rompem
 * o seu próprio máximo de 20 e o arrefecimento da regra bloqueia o sinal — que
 * é exactamente o que a regra deve fazer.
 */
function velas4h(fechoFinal, { tecto = 120 } = {}) {
  const inicio = Date.UTC(2026, 0, 1);
  const v = [];
  for (let i = 0; i < 230; i++) {
    const base = 100 + i * 0.08;
    v.push(vela(inicio + i * Q, base, base + 0.5, base - 0.5, base));
  }
  // Consolidação: oscila abaixo do tecto, sem nunca o romper.
  for (let i = 230; i < 260; i++) {
    const c = tecto - 2 + Math.sin(i) * 0.5;
    v.push(vela(inicio + i * Q, c, Math.min(c + 0.6, tecto), c - 0.6, c));
  }
  const t = inicio + 260 * Q;
  return v.concat([vela(t, tecto - 1, Math.max(fechoFinal, tecto) + 0.5, tecto - 2, fechoFinal)]);
}

test('Rompimento 4h: compra o fecho acima do máximo das 20 velas, com a tendência a favor', () => {
  const ctx = { symbol: 'XAUUSD', timeframe: '4h' };
  // A subida põe o máximo das 20 anteriores em ~120,7; fechar acima disso dispara.
  const v = velas4h(125);
  const s = planRompimento4h(v, ctx);
  assert.equal(s.length, 1);
  assert.equal(s[0].strategy, 'rompimento-4h');
  assert.equal(s[0].direction, 'bullish');
  assert.equal(s[0].entryPrice, 125);
  assert.ok(s[0].stopLoss < 125, 'o stop fica abaixo da entrada');
  assert.equal(s[0].targets.length, 1);
  assert.equal(s[0].targets[0].rMultiple, 3);
  // O alvo está exactamente a +3R do risco (1:3 mediu melhor do que 1:2).
  const risco = s[0].entryPrice - s[0].stopLoss;
  assert.ok(Math.abs(s[0].targets[0].price - (125 + 3 * risco)) < 1e-9);
  assert.equal(s[0].conviction, estrategiaValidada('rompimento-4h').estatistica.acerto);

  // Sem rompimento (fecha dentro da faixa): nada.
  assert.equal(planRompimento4h(velas4h(118), ctx).length, 0);
  // Noutro timeframe: nada, mesmo com a mesma forma de velas.
  assert.equal(planRompimento4h(v, { symbol: 'XAUUSD', timeframe: '1h' }).length, 0);
  // Só nos instrumentos medidos.
  assert.deepEqual(estrategiasPara('XAUUSD', '4h').map((e) => e.id).includes('rompimento-4h'), true);
  // Prata e EURJPY entraram com a medição a custo de conta raw (22/09/2026).
  assert.ok(estrategiasPara('XAGUSD', '4h').some((e) => e.id === 'rompimento-4h'));
  assert.ok(estrategiasPara('EURJPY', '4h').some((e) => e.id === 'rompimento-4h'));
  assert.equal(estrategiasPara('AUDUSD', '4h').some((e) => e.id === 'rompimento-4h'), false);
  assert.equal(estrategiasPara('EURUSD', '4h').some((e) => e.id === 'rompimento-4h'), false);
});

test('Rompimento 4h: arrefecimento de 6 velas — um movimento não dá dois sinais', () => {
  const ctx = { symbol: 'XAUUSD', timeframe: '4h' };
  const v = velas4h(125);
  // Acrescenta uma segunda vela que também rompe, logo a seguir: não deve dar sinal.
  const seguinte = vela(v.at(-1).time + Q, 125, 130, 124.5, 129);
  assert.equal(planRompimento4h([...v, seguinte], ctx).length, 0);
  // Seis velas depois, calmas e abaixo do máximo, já pode voltar a disparar.
  const calmas = [];
  for (let i = 1; i <= 6; i++) {
    const t = v.at(-1).time + i * Q;
    calmas.push(vela(t, 124, 124.5, 123.5, 124));
  }
  const rompeOutra = vela(v.at(-1).time + 7 * Q, 124, 132, 123.8, 131);
  assert.equal(planRompimento4h([...v, ...calmas, rompeOutra], ctx).length, 1);
});

test('Rompimento 4h: fecha no alvo de +2R, ou ao fim de 6 velas', () => {
  const inicio = Date.UTC(2026, 5, 1);
  const plano = {
    estrategia: 'rompimento-4h',
    direccao: 'bullish',
    entrada: 100,
    stop: 97,
    alvos: [{ preco: 106, r: 2 }],
    geradoEm: inicio,
  };
  // Toca o alvo na terceira vela.
  const comAlvo = [vela(inicio, 100, 100.5, 99.5, 100)];
  comAlvo.push(vela(inicio + Q, 100, 102, 99.5, 101));
  comAlvo.push(vela(inicio + 2 * Q, 101, 103, 100.5, 102));
  comAlvo.push(vela(inicio + 3 * Q, 102, 107, 101.5, 106.5));
  const a = acompanharOperacao(plano, comAlvo);
  assert.equal(a.estado, 'fechada');
  assert.equal(a.eventos.at(-1).tipo, 'alvo1');
  assert.equal(a.resultadoR, 2);

  // Sem tocar em nada: sai ao fim de 6 velas, ao fecho.
  const semNada = [vela(inicio, 100, 100.5, 99.5, 100)];
  for (let i = 1; i <= 7; i++) semNada.push(vela(inicio + i * Q, 101, 102, 98.5, 101.5));
  const b = acompanharOperacao(plano, semNada);
  assert.equal(b.estado, 'fechada');
  assert.equal(b.eventos.at(-1).tipo, 'saida-tempo');
  assert.ok(Math.abs(b.resultadoR - 0.5) < 1e-9, '+1,5 pontos com 3 de risco = +0,5R');
});
