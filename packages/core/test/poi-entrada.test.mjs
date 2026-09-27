/**
 * POI de entrada: o order block por mitigar de onde o preço pode partir no
 * sentido do viés — abaixo do preço numa compra, acima numa venda.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { poiEntrada } from '../dist/index.js';

const velas = Array.from({ length: 50 }, (_, i) => ({ time: i * 3_600_000, open: 1.1, high: 1.101, low: 1.099, close: 1.1, volume: 0 }));
const pd = (tipo, lado, baixo, alto, index, mitigadoEm = null) => ({
  tipo, lado, baixo, alto, index, time: index * 3_600_000, confirmadoEm: index + 1, mitigadoEm, tocadoEm: null, rotulo: `${tipo} ${lado}`,
});

test('POI de entrada: compra → o OB de alta por mitigar mais próximo abaixo do preço', () => {
  const r = poiEntrada({
    velas,
    i: 49,
    direccao: 'bullish',
    pdArrays: [
      pd('order-block', 'bullish', 1.095, 1.097, 10), // mais longe
      pd('order-block', 'bullish', 1.097, 1.098, 20), // o mais próximo
      pd('order-block', 'bullish', 1.098, 1.099, 30, 40), // mitigado
      pd('order-block', 'bearish', 1.098, 1.099, 35), // lado errado
      pd('order-block', 'bullish', 1.101, 1.102, 36), // acima do preço
      pd('fvg', 'bullish', 1.0985, 1.0995, 37), // FVG mais perto, mas o OB tem prioridade
    ],
  });
  assert.equal(r.tipo, 'order-block');
  assert.equal(r.baixo, 1.097);
  assert.equal(r.alto, 1.098);
});

test('POI de entrada: venda → acima do preço; sem OB, cai para breaker e depois FVG', () => {
  const venda = poiEntrada({ velas, i: 49, direccao: 'bearish', pdArrays: [pd('fvg', 'bearish', 1.102, 1.103, 20), pd('breaker', 'bearish', 1.104, 1.105, 25)] });
  assert.equal(venda.tipo, 'breaker');
  const soFvg = poiEntrada({ velas, i: 49, direccao: 'bearish', pdArrays: [pd('fvg', 'bearish', 1.102, 1.103, 20)] });
  assert.equal(soFvg.tipo, 'fvg');
  // Uma zona que só se confirma depois de i não conta (sem futuro).
  assert.equal(poiEntrada({ velas, i: 20, direccao: 'bearish', pdArrays: [pd('order-block', 'bearish', 1.102, 1.103, 20)] }), null);
  assert.equal(poiEntrada({ velas, i: 49, direccao: 'neutral', pdArrays: [] }), null);
});
