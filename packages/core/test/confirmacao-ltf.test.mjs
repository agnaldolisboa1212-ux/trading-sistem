/**
 * Confirmação em 5M do ICT ALGO: sem CHoCH/MSS a favor (e estrutura de 5M a
 * favor), o sinal não sai.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmacaoLtf } from '../dist/index.js';

const M5 = 300_000;
const vela = (time, open, high, low, close) => ({ time, open, high, low, close, volume: 0 });

/** 5M: descida em ziguezague e, no fim, um deslocamento forte para cima. */
function serie(comRalo = true) {
  const v = [];
  let p = 100;
  const t0 = Date.UTC(2025, 0, 6, 6, 0);
  for (let k = 0; k < 90; k++) {
    const onda = Math.sin(k / 2.2) * 0.25;
    const alvo = 100 - k * 0.03 + onda;
    const o = p;
    const c = alvo;
    v.push(vela(t0 + k * M5, o, Math.max(o, c) + 0.05, Math.min(o, c) - 0.05, c));
    p = c;
  }
  if (comRalo) {
    for (let k = 0; k < 8; k++) {
      const o = p;
      const c = p + 0.45;
      v.push(vela(t0 + (90 + k) * M5, o, c + 0.03, o - 0.03, c));
      p = c;
    }
    for (let k = 0; k < 6; k++) {
      const o = p;
      const c = p + (k % 2 ? -0.08 : 0.1);
      v.push(vela(t0 + (98 + k) * M5, o, Math.max(o, c) + 0.04, Math.min(o, c) - 0.04, c));
      p = c;
    }
  }
  return v;
}

test('confirmação 5M: um MSS/CHoCH de alta recente confirma a compra e não a venda', () => {
  const v = serie(true);
  const agora = v[v.length - 1].time + M5;
  const compra = confirmacaoLtf(v, 'bullish', agora);
  assert.equal(compra.ok, true, compra.detalhe);
  assert.ok(compra.tipo === 'mss' || compra.tipo === 'choch');
  const venda = confirmacaoLtf(v, 'bearish', agora);
  assert.equal(venda.ok, false, venda.detalhe);
});

test('confirmação 5M: em plena descida, a compra não está confirmada', () => {
  const v = serie(false);
  const r = confirmacaoLtf(v, 'bullish', v[v.length - 1].time + M5);
  assert.equal(r.ok, false, r.detalhe);
});

test('confirmação 5M: sem velas não há confirmação, e velas ainda abertas não contam', () => {
  assert.equal(confirmacaoLtf(undefined, 'bullish', Date.now()).ok, false);
  const v = serie(true);
  // Decidir ANTES do ralo: as velas do ralo ainda não existem para quem decide.
  const antes = confirmacaoLtf(v, 'bullish', v[89].time + M5);
  assert.equal(antes.ok, false, antes.detalhe);
});
