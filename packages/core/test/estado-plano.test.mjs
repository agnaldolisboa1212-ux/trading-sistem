/**
 * O que aconteceu a um plano: é o que marca um sinal como invalidado na lista.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estadoDoPlano, planoInvalidado, planoVivo } from '../dist/index.js';

const compra = { direccao: 'bullish', entrada: 100, stop: 98, alvo: 106 };
const venda = { direccao: 'bearish', entrada: 100, stop: 102, alvo: 94 };
const v = (low, high, i = 0) => ({ time: i, low, high });

test('sem velas depois: à espera da entrada', () => {
  assert.equal(estadoDoPlano(compra, []), 'a-aguardar-entrada');
});

test('compra: toca na entrada e fica em curso', () => {
  assert.equal(estadoDoPlano(compra, [v(101, 103), v(99.5, 101)]), 'em-curso');
});

test('compra: entra e chega ao alvo', () => {
  assert.equal(estadoDoPlano(compra, [v(99.5, 101), v(101, 106.5)]), 'alvo-atingido');
});

test('compra: toca no stop é invalidado', () => {
  const e = estadoDoPlano(compra, [v(99.5, 101), v(97.9, 100)]);
  assert.equal(e, 'stop-atingido');
  assert.equal(planoInvalidado(e), true);
});

test('compra: vai ao alvo sem tocar na entrada', () => {
  const e = estadoDoPlano(compra, [v(101, 104), v(103, 107)]);
  assert.equal(e, 'perdido');
  assert.equal(planoInvalidado(e), true);
});

test('stop e alvo na mesma vela contam como stop', () => {
  assert.equal(estadoDoPlano(compra, [v(97, 107)]), 'stop-atingido');
});

test('venda espelha a compra', () => {
  assert.equal(estadoDoPlano(venda, [v(99, 100.5)]), 'em-curso');
  assert.equal(estadoDoPlano(venda, [v(99, 100.5), v(93.5, 99)]), 'alvo-atingido');
  assert.equal(estadoDoPlano(venda, [v(99, 102.1)]), 'stop-atingido');
});

test('expira ao fim de N velas sem entrada', () => {
  const longe = Array.from({ length: 20 }, (_, i) => v(101, 103, i));
  assert.equal(estadoDoPlano(compra, longe), 'expirado');
  assert.equal(estadoDoPlano(compra, longe.slice(0, 19)), 'a-aguardar-entrada');
  assert.equal(estadoDoPlano(compra, longe, { expirarAposVelas: 50 }), 'a-aguardar-entrada');
});

test('com entrada tocada não expira', () => {
  const velas = [v(99.5, 101), ...Array.from({ length: 30 }, (_, i) => v(99, 104, i + 1))];
  assert.equal(estadoDoPlano(compra, velas), 'em-curso');
  assert.equal(planoVivo('em-curso'), true);
});

test('sem alvo: só stop ou em curso', () => {
  assert.equal(estadoDoPlano({ ...compra, alvo: null }, [v(99.5, 120)]), 'em-curso');
});
