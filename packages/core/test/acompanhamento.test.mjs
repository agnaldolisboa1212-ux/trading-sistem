/**
 * Acompanhamento das operações: os eventos que viram avisos no telemóvel.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { acompanharOperacao, fraseEvento } from '../dist/index.js';

const vela = (time, open, high, low, close) => ({ time, open, high, low, close, volume: 0 });

/** 30 velas de história a 100, o sinal na vela 30 (fecho 100) e depois `seguintes`. */
function serie(seguintes) {
  const v = [];
  for (let i = 0; i < 30; i++) v.push(vela(i, 100, 100.5, 99.5, 100));
  v.push(vela(30, 100, 100.2, 99.8, 100));
  seguintes.forEach(([h, l, c], k) => v.push(vela(31 + k, c, h, l, c)));
  return v;
}

const vwap = { estrategia: 'compra-vwap-indices', direccao: 'bullish', entrada: 100, stop: 98, alvos: [{ preco: 102 }, { preco: 104 }], geradoEm: 30 };

test('VWAP: +1R avisa para fechar metade e proteger; volta à entrada fecha a +0,5R', () => {
  const a = acompanharOperacao(vwap, serie([[101, 99.5, 100.5], [102.1, 100.4, 101.8], [101.5, 99.9, 100.1]]));
  assert.deepEqual(a.eventos.map((e) => e.tipo), ['alvo1', 'stop-na-entrada']);
  assert.equal(a.estado, 'fechada');
  assert.equal(a.resultadoR, 0.5);
  assert.match(fraseEvento(a.eventos[0], 2, 'compra-vwap-indices').corpo, /Feche metade/);
});

test('VWAP: chegar a +2R fecha a +1,5R', () => {
  const a = acompanharOperacao(vwap, serie([[102.2, 99.9, 102], [104.1, 101.5, 104]]));
  assert.deepEqual(a.eventos.map((e) => e.tipo), ['alvo1', 'alvo2']);
  assert.equal(a.resultadoR, 1.5);
});

test('stop antes de +1R: −1R; e uma vela que toca stop e alvo conta como stop', () => {
  const a = acompanharOperacao(vwap, serie([[102.5, 97.9, 99]]));
  assert.deepEqual(a.eventos.map((e) => e.tipo), ['stop']);
  assert.equal(a.resultadoR, -1);
});

test('Connors: sai no primeiro fecho acima da média de 5', () => {
  const plano = { estrategia: 'connors-rsi2-indices', direccao: 'bullish', entrada: 100, stop: 96, alvos: [], geradoEm: 30 };
  const a = acompanharOperacao(plano, serie([[100.3, 99, 99.2], [101.5, 99.5, 101.2]]));
  assert.equal(a.eventos.at(-1).tipo, 'saida');
  assert.equal(a.estado, 'fechada');
  assert.ok(a.resultadoR > 0);
});

test('Tendência: o stop móvel sobe e sair abaixo dele é a saída da regra', () => {
  const plano = { estrategia: 'tendencia-cripto', direccao: 'bullish', entrada: 100, stop: 90, alvos: [], geradoEm: 30 };
  // 25 velas a subir 1 por vela (o mínimo de 20 sobe), depois uma queda forte.
  const subida = Array.from({ length: 25 }, (_, k) => [101 + k + 0.5, 100 + k, 101 + k]);
  const a = acompanharOperacao(plano, serie([...subida, [120, 100, 101]]));
  assert.ok(a.eventos.some((e) => e.tipo === 'stop-movel'));
  assert.equal(a.eventos.at(-1).tipo, 'saida');
  assert.ok(a.resultadoR > 0, 'saiu a ganhar com o stop acima da entrada');
});

test('viés: avisa uma vez quando a tendência vira contra a compra', () => {
  const plano = { estrategia: 'connors-rsi2-indices', direccao: 'bullish', entrada: 100, stop: 60, alvos: [], geradoEm: 60 };
  const v = [];
  for (let i = 0; i < 60; i++) v.push(vela(i, 100 + i * 0.2, 100.5 + i * 0.2, 99.5 + i * 0.2, 100 + i * 0.2));
  v.push(vela(60, 100, 100.2, 99.8, 100));
  for (let k = 1; k <= 9; k++) v.push(vela(60 + k, 100 - k, 100 - k + 0.3, 100 - k - 1, 100 - k - 0.8));
  const a = acompanharOperacao(plano, v);
  assert.equal(a.eventos.filter((e) => e.tipo === 'vies').length, 1);
});
