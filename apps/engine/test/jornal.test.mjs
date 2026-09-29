/**
 * O jornal dos sinais (apps/engine/src/pipeline/jornal.ts): três edições por
 * dia útil — 07:30, 12:45 e 21:30 de Lisboa/Londres —, cada uma uma só vez, e
 * ainda até 90 minutos depois se o motor estiver parado à hora certa.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edicaoDevida } from '../dist/pipeline/jornal.js';
import { formatarJornal } from '../../../packages/notify/dist/index.js';

// Terça, 29/09/2026 — horário de verão: Londres = UTC+1.
const utc = (h, m) => Date.UTC(2026, 8, 29, h, m);

test('as três edições saem às horas de Lisboa, uma vez cada', () => {
  assert.equal(edicaoDevida(utc(6, 29), new Set()), null);
  const manha = edicaoDevida(utc(6, 30), new Set());
  assert.equal(manha?.id, 'manha');
  assert.equal(edicaoDevida(utc(6, 31), new Set([manha.chave])), null);
  assert.equal(edicaoDevida(utc(11, 45), new Set([manha.chave]))?.id, 'meio-dia');
  assert.equal(edicaoDevida(utc(20, 30), new Set())?.id, 'fecho');
});

test('motor parado à hora certa: sai até 90 minutos depois, não mais', () => {
  assert.equal(edicaoDevida(utc(7, 59), new Set())?.id, 'manha');
  assert.equal(edicaoDevida(utc(8, 0), new Set()), null);
});

test('fim de semana: sem jornal', () => {
  // Sábado, 03/10/2026, 07:30 de Londres.
  assert.equal(edicaoDevida(Date.UTC(2026, 9, 3, 6, 30), new Set()), null);
});

test('o texto do jornal tem as secções e o total do dia', () => {
  const linha = {
    simbolo: 'EURUSD',
    timeframe: '15m',
    estrategia: 'asia-range-algo',
    direccao: 'bearish',
    entrada: 1.1702,
    stop: 1.1718,
    alvo: { preco: 1.1654, r: 3 },
    geradoEm: utc(9, 10),
    estado: 'alvo-atingido',
    resultadoR: 3,
    casas: 5,
  };
  const t = formatarJornal({
    titulo: 'Meio-dia · antes de Nova Iorque',
    em: utc(11, 45),
    desde: utc(6, 30),
    novos: [linha],
    emAberto: [],
    fechados: [linha],
    dia: { r: 3, n: 1 },
    setupsIct: [
      { simbolo: 'USDJPY', casas: 3, direccao: 'bearish', modelo: 'Venom', zonaBaixa: 150.85, zonaAlta: 150.95, alvo: 149, estado: 'à espera da zona' },
    ],
    pois: [],
    atencao: [],
  });
  assert.match(t, /Jornal dos sinais/);
  assert.ok(t.includes('Novos desde as 07:30 \\(1\\)'));
  assert.match(t, /EURUSD 15m/);
  assert.match(t, /\+3\\\.0R no total/);
  assert.match(t, /USDJPY/);
  assert.ok(t.length < 4096);
});
