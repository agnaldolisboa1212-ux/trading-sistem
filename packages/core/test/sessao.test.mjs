/**
 * Sessão de negociação — só filtra avisos intradiários, nunca o diário.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { dentroDaSessao } from '../dist/index.js';

const H = 3_600_000;
const dia = (hora) => Date.UTC(2026, 8, 17, hora);

test('sem sessões escolhidas: qualquer hora passa', () => {
  assert.equal(dentroDaSessao(dia(3), []), true);
  assert.equal(dentroDaSessao(dia(3), null), true);
  assert.equal(dentroDaSessao(dia(3), undefined), true);
});

test('diário nunca é filtrado, mesmo com sessão escolhida', () => {
  assert.equal(dentroDaSessao(dia(3), ['londres'], '1d'), true);
});

test('Londres: 07:00–16:00 UTC', () => {
  assert.equal(dentroDaSessao(dia(6) + 59 * 60_000, ['londres'], '1h'), false);
  assert.equal(dentroDaSessao(dia(7), ['londres'], '1h'), true);
  assert.equal(dentroDaSessao(dia(15) + 59 * 60_000, ['londres'], '1h'), true);
  assert.equal(dentroDaSessao(dia(16), ['londres'], '1h'), false);
});

test('Sydney atravessa a meia-noite (21h–06h)', () => {
  assert.equal(dentroDaSessao(dia(22), ['sydney'], '1h'), true);
  assert.equal(dentroDaSessao(dia(2), ['sydney'], '1h'), true);
  assert.equal(dentroDaSessao(dia(10), ['sydney'], '1h'), false);
});

test('várias sessões escolhidas: basta uma bater certo', () => {
  const escolhidas = ['londres', 'nova-iorque'];
  assert.equal(dentroDaSessao(dia(8), escolhidas, '1h'), true); // Londres
  assert.equal(dentroDaSessao(dia(18), escolhidas, '1h'), true); // Nova Iorque
  assert.equal(dentroDaSessao(dia(23), escolhidas, '1h'), false); // nenhuma
});

test('ignora nomes desconhecidos em vez de rebentar', () => {
  assert.equal(dentroDaSessao(dia(3), ['marte']), true);
});
