/**
 * Notícias de alto impacto e o que fazem a um sinal.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { instrumentosAfectados, moedasDoInstrumento, riscoDeNoticias } from '../dist/index.js';

const MIN = 60_000;
const agora = Date.UTC(2026, 8, 18, 12, 0);
const nfp = { titulo: 'Non-Farm Employment Change', moeda: 'USD', em: agora + 20 * MIN };
const bce = { titulo: 'Main Refinancing Rate', moeda: 'EUR', em: agora + 6 * 60 * MIN };

test('moedas: índices pela economia, forex pelas duas metades', () => {
  assert.deepEqual(moedasDoInstrumento('US100'), ['USD']);
  assert.deepEqual(moedasDoInstrumento('GER30'), ['EUR', 'USD']);
  assert.deepEqual(moedasDoInstrumento('EURJPY'), ['EUR', 'JPY']);
  assert.deepEqual(instrumentosAfectados(bce, ['US100', 'GER30', 'EURUSD', 'BTCUSD']), ['GER30', 'EURUSD']);
});

test('1h: sinal colado a uma notícia do instrumento não sai', () => {
  const r = riscoDeNoticias('US30', '1h', [nfp], agora);
  assert.equal(r.suspender, true);
  assert.match(r.aviso, /Non-Farm/);
});

test('4h e 1D: sai, com o aviso da notícia', () => {
  const r = riscoDeNoticias('SP500', '1d', [nfp, bce], agora);
  assert.equal(r.suspender, false);
  assert.match(r.aviso, /Non-Farm/);
  assert.doesNotMatch(r.aviso, /Refinancing/, 'o BCE não move o S&P 500 neste mapa');
});

test('sem notícias do instrumento por perto: nada', () => {
  const r = riscoDeNoticias('US100', '1h', [bce], agora);
  assert.equal(r.suspender, false);
  assert.equal(r.aviso, null);
});
