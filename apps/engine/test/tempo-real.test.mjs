/**
 * Testes das decisões puras do motor de tempo real.
 *
 * Cobrem os defeitos que custariam mais: anunciar o mesmo sinal várias vezes,
 * analisar uma vela aberta, anunciar um sinal de sexta-feira ao domingo, e
 * anunciar quando as estratégias discordam.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cortarVelaAberta,
  escolherPorConfluencia,
  escolherVigilancia,
  idSinal,
  lerTimeframes,
  mercadoParado,
} from '../dist/pipeline/tempo-real-puro.js';

const vela = (time) => ({ time, open: 1, high: 2, low: 0.5, close: 1.5, volume: 0 });
const MIN15 = 900;

test('corta a vela em formação', () => {
  const t0 = Date.UTC(2026, 8, 15, 10, 0);
  const velas = [vela(t0), vela(t0 + MIN15 * 1000)];
  // 5 minutos dentro da segunda vela: ainda aberta
  const r = cortarVelaAberta(velas, MIN15, t0 + MIN15 * 1000 + 5 * 60_000);
  assert.equal(r.length, 1);
  assert.equal(r[0].time, t0);
});

test('mantém a última vela quando já fechou', () => {
  const t0 = Date.UTC(2026, 8, 15, 10, 0);
  const velas = [vela(t0), vela(t0 + MIN15 * 1000)];
  const r = cortarVelaAberta(velas, MIN15, t0 + 2 * MIN15 * 1000 + 1);
  assert.equal(r.length, 2);
});

test('série vazia não rebenta', () => {
  assert.deepEqual(cortarVelaAberta([], MIN15, Date.now()), []);
});

test('mesmo setup na mesma vela produz o mesmo id', () => {
  const p = { estrategia: 'vwap-bands', simbolo: 'GER30', timeframe: '15m', direccao: 'bearish', geradoEm: 1_788_000_000_000 };
  assert.equal(idSinal(p), idSinal({ ...p }));
  assert.notEqual(idSinal(p), idSinal({ ...p, geradoEm: p.geradoEm + MIN15 * 1000 }));
  assert.notEqual(idSinal(p), idSinal({ ...p, direccao: 'bullish' }));
});

test('mercado parado: três velas de silêncio num instrumento não contínuo', () => {
  const abertura = Date.UTC(2026, 8, 11, 20, 45); // sexta
  const domingo = Date.UTC(2026, 8, 13, 12, 0);
  assert.equal(mercadoParado(abertura, MIN15, domingo, false), true);
  // os sintéticos negoceiam sempre
  assert.equal(mercadoParado(abertura, MIN15, domingo, true), false);
  // logo a seguir ao fecho da vela, não está parado
  assert.equal(mercadoParado(abertura, MIN15, abertura + 2 * MIN15 * 1000, false), false);
});

test('timeframes inválidos são descartados, com omissão', () => {
  assert.deepEqual(lerTimeframes('15m, 1h, 7m, 15m', ['1h']), ['15m', '1h']);
  assert.deepEqual(lerTimeframes('', ['15m', '1h']), ['15m', '1h']);
  assert.deepEqual(lerTimeframes('xyz', ['1h']), ['1h']);
});

test('vigilância: .env manda, depois perfis, depois omissão', () => {
  const conhecido = (c) => ({ NQ: 'US100', US100: 'US100', GER30: 'GER30', V75: 'V75' })[c] ?? null;

  const env = escolherVigilancia({ env: ['ger30', 'FOO'], perfis: [['V75']], omissao: ['US100'], conhecido });
  assert.equal(env.origem, 'env');
  assert.deepEqual(env.simbolos, ['GER30']);
  assert.deepEqual(env.ignorados, ['FOO']);

  // aliases dos perfis antigos (NQ) resolvem e não duplicam
  const perfis = escolherVigilancia({ env: [], perfis: [['NQ', 'V75'], ['US100']], omissao: ['GER30'], conhecido });
  assert.equal(perfis.origem, 'perfis');
  assert.deepEqual(perfis.simbolos, ['US100', 'V75']);

  const omissao = escolherVigilancia({ env: [], perfis: [], omissao: ['GER30'], conhecido });
  assert.equal(omissao.origem, 'omissao');
  assert.deepEqual(omissao.simbolos, ['GER30']);
});

test('vigilância: .env só com códigos desconhecidos cai para os perfis', () => {
  const conhecido = (c) => (c === 'V75' ? 'V75' : null);
  const r = escolherVigilancia({ env: ['FOO'], perfis: [['V75']], omissao: [], conhecido });
  assert.equal(r.origem, 'perfis');
  assert.deepEqual(r.simbolos, ['V75']);
});

test('confluência: escolhe a maior convicção e conta estratégias distintas', () => {
  const r = escolherPorConfluencia([
    { estrategia: 'vwap-bands', direccao: 'bearish', conviccao: 0.5 },
    { estrategia: 'volume-profile', direccao: 'bearish', conviccao: 0.7 },
    { estrategia: 'volume-profile', direccao: 'bearish', conviccao: 0.6 },
  ]);
  assert.equal(r.conflito, false);
  assert.equal(r.escolhido.conviccao, 0.7);
  assert.equal(r.concordam, 2);
});

test('confluência: sentidos opostos não anunciam nada', () => {
  const r = escolherPorConfluencia([
    { estrategia: 'vwap-bands', direccao: 'bearish', conviccao: 0.9 },
    { estrategia: 'supply-demand', direccao: 'bullish', conviccao: 0.4 },
  ]);
  assert.equal(r.conflito, true);
  assert.equal(r.escolhido, null);
});

test('confluência: sem sinais', () => {
  assert.deepEqual(escolherPorConfluencia([]), { escolhido: null, concordam: 0, conflito: false });
});
