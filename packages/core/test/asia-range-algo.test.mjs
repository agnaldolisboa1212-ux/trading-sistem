/**
 * Asia Range Algo — a estratégia do journal.
 *
 *   1. o cenário das notas dá o sinal, com o stop e o alvo das regras
 *   2. sem SMT não dá; à sexta-feira dá (desde 25/09/2026)
 *   3. LOOK-AHEAD: a decisão numa vela não muda quando o futuro é removido
 *   4. sem `extra.algo` (o caso do cliente) a estratégia não corre
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { analisarAsiaRange, executarEstrategiasValidadas, relogioLondres } from '../dist/index.js';

const M15 = 15 * 60_000;
const DIA = 86_400_000;
const vela = (time, open, high, low, close) => ({ time, open, high, low, close, volume: 100 });
const VIES = { direccao: 'bullish', aFavor: 4 };

/**
 * Janeiro (Londres = UTC). Dois dias a oscilar à volta de 100,5; depois a Ásia
 * de terça entre 99,8 e 101,9; às 08:00 Londres cai a 99,63 (varre a mínima da
 * Ásia) e sobe com fecho acima do último swing. O par faz o mesmo, a não ser
 * que `parVarre` seja falso — aí fica acima da sua mínima asiática (SMT).
 */
function cenario(parVarre, deslocarDias = 0) {
  const inicio = Date.UTC(2024, 0, 14, 0, 0) + deslocarDias * DIA; // domingo
  const v = [];
  const p = [];
  const push = (arr, t, o, c, extra = 0.05) => arr.push(vela(t, o, Math.max(o, c) + extra, Math.min(o, c) - extra, c));
  let t = inicio;
  for (let k = 0; k < 192; k++, t += M15) {
    const a = 100.5 + 0.3 * Math.sin(k / 4);
    const b = 100.5 + 0.3 * Math.sin((k + 1) / 4);
    push(v, t, a, b);
    push(p, t, a + 50, b + 50);
  }
  const asia = (k) => (k < 12 ? 100.4 + (k / 12) * 1.5 : k < 24 ? 101.9 - ((k - 12) / 12) * 2.1 : 99.8 + ((k - 24) / 8) * 0.3);
  for (let k = 0; k < 32; k++, t += M15) {
    push(v, t, asia(k), asia(k + 1), 0.02);
    push(p, t, asia(k) + 50, asia(k + 1) + 50, 0.02);
  }
  const londres = [100.1, 100.25, 100.05, 99.9, 99.75, 99.65, 99.9, 100.35, 100.5, 100.6, 100.7];
  for (let k = 0; k < londres.length - 1; k++, t += M15) {
    push(v, t, londres[k], londres[k + 1], 0.02);
    const q = parVarre ? londres : londres.map((x) => Math.max(x, 99.95));
    push(p, t, q[k] + 50, q[k + 1] + 50, 0.02);
  }
  // Diário: 60 dias quaisquer antes do cenário (o viés é forçado).
  const diarias = [];
  for (let d = 60; d >= 1; d--) {
    const td = inicio - d * DIA;
    diarias.push(vela(td, 100, 101, 99, 100.5));
  }
  return { v, p, diarias };
}

/**
 * 3M a partir das velas de 15M: cada uma partida em cinco, do abertura ao fecho
 * a passar pelo mínimo e pelo máximo (compra: mínimo primeiro).
 */
function em3m(v15) {
  const out = [];
  for (const c of v15) {
    const sobe = c.close >= c.open;
    const pontos = sobe ? [c.open, c.low, (c.low + c.high) / 2, c.high, c.close] : [c.open, c.high, (c.low + c.high) / 2, c.low, c.close];
    let ant = c.open;
    for (let k = 0; k < 5; k++) {
      const alvo = k === 4 ? c.close : pontos[k + 1];
      out.push(vela(c.time + k * 180_000, ant, Math.max(ant, alvo), Math.min(ant, alvo), alvo));
      ant = alvo;
    }
  }
  return out;
}

const analisar = (v, p, diarias, i, ltf = em3m(v)) =>
  analisarAsiaRange({ simbolo: 'GBPJPY', velas: v.slice(0, i + 1), diarias, par: { simbolo: 'USDJPY', velas: p }, viesForcado: VIES, ltf });

test('Asia Range Algo: varrimento da Ásia + SMT + MSS dá compra com alvo na máxima da Ásia', () => {
  const { v, p, diarias } = cenario(false);
  const sinais = [];
  const razoes = [];
  for (let i = 224; i < v.length; i++) {
    const a = analisar(v, p, diarias, i);
    razoes.push(`${new Date(v[i].time).toISOString().slice(11, 16)} ${a.porqueNao}`);
    if (a.sinal) sinais.push(a.sinal);
  }
  assert.equal(sinais.length, 1, `um setup por dia — ${razoes.join(' | ')}`);
  const s = sinais[0];
  assert.equal(s.direccao, 'bullish');
  // Stop para lá do extremo da manipulação (99,63) / do POI que o cobre, com margem.
  assert.ok(s.stop < 99.63 && s.stop > 99.63 - 3.2 * (s.entrada - 99.63), `stop além do extremo da manipulação (${s.stop})`);
  assert.ok(Math.abs(s.alvo - 101.92) < 1e-9, `alvo na máxima da Ásia (${s.alvo})`);
  assert.ok(s.rr >= 2);
  assert.ok(relogioLondres(s.time).minutos + 15 < 10 * 60, 'fecha antes das 10:00 de Londres');
});

test('Asia Range Algo: sem SMT não há sinal; à sexta-feira há', () => {
  const { v, p, diarias } = cenario(true);
  const razoes = new Set();
  for (let i = 224; i < v.length; i++) {
    const a = analisar(v, p, diarias, i);
    assert.equal(a.sinal, null);
    razoes.add(a.porqueNao);
  }
  assert.ok(razoes.has('sem divergência SMT na abertura de Londres'), [...razoes].join(' | '));

  const sexta = cenario(false, 3);
  let naSexta = 0;
  for (let i = 224; i < sexta.v.length; i++) if (analisar(sexta.v, sexta.p, sexta.diarias, i).sinal) naSexta++;
  assert.equal(naSexta, 1, 'à sexta-feira o setup também sai');
});

test('Asia Range Algo: o TESTE DO CORTE — o futuro removido não muda a decisão', () => {
  const { v, p, diarias } = cenario(false);
  for (let i = 224; i < v.length; i++) {
    const cortada = analisarAsiaRange({
      simbolo: 'GBPJPY',
      velas: v.slice(0, i + 1),
      diarias,
      par: { simbolo: 'USDJPY', velas: p.slice(0, i + 1) },
      viesForcado: VIES,
      // 3M só até ao fim da vela i: o futuro de 3M também fica de fora.
      ltf: em3m(v.slice(0, i + 1)),
    });
    const comFuturoDoPar = analisar(v, p, diarias, i);
    assert.deepEqual(cortada.sinal, comFuturoDoPar.sinal, `vela ${i}: o par do futuro mudou a decisão`);
    assert.equal(cortada.porqueNao, comFuturoDoPar.porqueNao);
  }
});

test('Asia Range Algo e ICT ALGO: sem extra.algo (o cliente) não correm', () => {
  const { v } = cenario(false);
  const r = executarEstrategiasValidadas(v, { symbol: 'GBPJPY', timeframe: '15m' }, {});
  assert.equal(r.filter((s) => s.strategy === 'asia-range-algo' || s.strategy === 'ict-algo').length, 0);
});

test('Asia Range Algo: sem velas de 3M (sem confirmação) não há sinal', () => {
  const { v, p, diarias } = cenario(false);
  const razoes = new Set();
  for (let i = 224; i < v.length; i++) {
    const a = analisar(v, p, diarias, i, []);
    assert.equal(a.sinal, null);
    razoes.add(a.porqueNao);
  }
  assert.ok(razoes.has('à espera de confirmação 3M'), [...razoes].join(' | '));
});
