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
  avaliarPrecoActual,
  cortarVelaAberta,
  escolherPorConfluencia,
  escolherVigilancia,
  idSinal,
  lerTimeframes,
  mercadoParado,
  sinalFresco,
  validadeAvisoS,
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

// --- validade no momento do anúncio ----------------------------------------

test('frescura: um sinal de 15m anunciado 20 s depois do fecho é notícia', () => {
  const abertura = Date.UTC(2026, 8, 16, 16, 30);
  const fecho = abertura + MIN15 * 1000;
  assert.equal(sinalFresco(abertura, MIN15, fecho + 20_000), true);
});

test('frescura: ao acordar 40 min depois do fecho de uma vela de 1h já não é', () => {
  const abertura = Date.UTC(2026, 8, 16, 16, 0);
  const fecho = abertura + 3600 * 1000;
  assert.equal(sinalFresco(abertura, 3600, fecho + 40 * 60_000), false);
  // o limite de uma vela de 1h é 10 minutos, não meia hora
  assert.equal(sinalFresco(abertura, 3600, fecho + 11 * 60_000), false);
  assert.equal(sinalFresco(abertura, 3600, fecho + 9 * 60_000), true);
});

test('frescura: sinais de 4h e diários valem horas, não minutos', () => {
  const dia = Date.UTC(2026, 8, 16);
  const fechoDia = dia + 86_400 * 1000;
  assert.equal(sinalFresco(dia, 86_400, fechoDia + 3 * 3_600_000), true);
  assert.equal(sinalFresco(dia, 86_400, fechoDia + 7 * 3_600_000), false);
  const q = Date.UTC(2026, 8, 16, 8);
  const fecho4h = q + 14_400 * 1000;
  assert.equal(sinalFresco(q, 14_400, fecho4h + 50 * 60_000), true);
  assert.equal(sinalFresco(q, 14_400, fecho4h + 70 * 60_000), false);
});

test('validade do push: meia vela, entre 5 e 30 minutos', () => {
  assert.equal(validadeAvisoS(60), 300);
  assert.equal(validadeAvisoS(900), 450);
  assert.equal(validadeAvisoS(3600), 1800);
  assert.equal(validadeAvisoS(86400), 1800);
});

const compra = { direccao: 'bullish', entrada: 100, stop: 98, alvo: 106 };
const venda = { direccao: 'bearish', entrada: 100, stop: 102, alvo: 94 };

test('preço: na entrada', () => {
  const r = avaliarPrecoActual({ ...compra, actual: 100.2 });
  assert.equal(r.estado, 'na-entrada');
  assert.equal(r.anunciar, true);
});

test('preço: compra com o preço acima da entrada espera o recuo', () => {
  const r = avaliarPrecoActual({ ...compra, actual: 101.5 });
  assert.equal(r.estado, 'a-aguardar');
  assert.equal(r.anunciar, true);
  assert.equal(r.distanciaR, 0.75);
});

test('preço: compra que já fez metade do caminho até ao alvo não é anunciada', () => {
  const r = avaliarPrecoActual({ ...compra, actual: 103 });
  assert.equal(r.estado, 'passou');
  assert.equal(r.anunciar, false);
});

test('preço: compra com o stop já tocado não é anunciada', () => {
  const r = avaliarPrecoActual({ ...compra, actual: 97.9 });
  assert.equal(r.estado, 'invalidado');
  assert.equal(r.anunciar, false);
});

test('preço: compra abaixo da entrada com o stop intacto é melhor preço', () => {
  const r = avaliarPrecoActual({ ...compra, actual: 99 });
  assert.equal(r.estado, 'melhor-que-entrada');
  assert.equal(r.anunciar, true);
});

test('preço: venda espelha a compra', () => {
  assert.equal(avaliarPrecoActual({ ...venda, actual: 98.5 }).estado, 'a-aguardar');
  assert.equal(avaliarPrecoActual({ ...venda, actual: 97 }).estado, 'passou');
  assert.equal(avaliarPrecoActual({ ...venda, actual: 102.1 }).estado, 'invalidado');
  assert.equal(avaliarPrecoActual({ ...venda, actual: 101 }).estado, 'melhor-que-entrada');
});

test('preço: sem alvo usa 2R como caminho', () => {
  const r = avaliarPrecoActual({ ...compra, alvo: null, actual: 102 });
  // 2R = 4 pontos; 2 pontos percorridos = metade → passou
  assert.equal(r.estado, 'passou');
});

// ---------------------------------------------------------------------------
// Pares por perfil e anti-repintagem
// ---------------------------------------------------------------------------

import { escolherPares, filtrarRepintagem } from '../dist/pipeline/tempo-real-puro.js';
import { timeframesDosObjetivos } from '@trading/core';

const conhecido = (c) => (['EURUSD', 'XAUUSD', 'V75'].includes(c) ? c : null);

test('pares: cada instrumento só nos timeframes de quem o segue', () => {
  const r = escolherPares({
    envSimbolos: [],
    envTimeframes: ['15m', '1h'],
    perfis: [
      { instrumentos: ['XAUUSD', 'EURUSD'], objetivos: ['swing', 'intraday'] },
      { instrumentos: ['EURUSD'], objetivos: ['day'] },
      { instrumentos: [], objetivos: ['day'] },
    ],
    omissao: ['V75'],
    conhecido,
    timeframesDe: timeframesDosObjetivos,
  });
  assert.equal(r.origem, 'perfis');
  assert.deepEqual(r.pares.get('XAUUSD'), ['1h', '4h', '1d']);
  assert.deepEqual(r.pares.get('EURUSD'), ['15m', '1h', '4h', '1d']);
  assert.equal(r.pares.has('V75'), false);
});

test('pares: sem perfis usa a lista por omissão e os timeframes do .env', () => {
  const r = escolherPares({
    envSimbolos: [],
    envTimeframes: ['15m', '1h'],
    perfis: [],
    omissao: ['V75', 'NADA'],
    conhecido,
    timeframesDe: timeframesDosObjetivos,
  });
  assert.equal(r.origem, 'omissao');
  assert.deepEqual(r.pares.get('V75'), ['15m', '1h']);
  assert.deepEqual(r.ignorados, ['NADA']);
});

test('objetivos: intradiário e swing dão 1h, 4h e 1d — nunca 15m', () => {
  assert.deepEqual(timeframesDosObjetivos(['swing', 'intraday']), ['1h', '4h', '1d']);
  assert.deepEqual(timeframesDosObjetivos(['day']), ['15m']);
  assert.deepEqual(timeframesDosObjetivos([]), ['1h', '4h']);
});

test('repintagem: a mesma estratégia não repete enquanto o plano está vivo', () => {
  const vivo = { id: 'a', estrategia: 'vwap-bands', direccao: 'bullish', entrada: 1, stop: 0.9, alvo: 1.2, geradoEm: 0 };
  const r = filtrarRepintagem(
    [
      { estrategia: 'vwap-bands', direccao: 'bullish', conviccao: 0.7 },
      { estrategia: 'support-resistance', direccao: 'bullish', conviccao: 0.6 },
      { estrategia: 'volume-profile', direccao: 'bearish', conviccao: 0.8 },
    ],
    [vivo],
  );
  assert.deepEqual(r.repetidos.map((c) => c.estrategia), ['vwap-bands']);
  assert.deepEqual(r.permitidos.map((c) => c.estrategia), ['support-resistance']);
  assert.deepEqual(r.contraVies.map((c) => c.candidato.estrategia), ['volume-profile']);
});

test('repintagem: sem planos vivos passa tudo', () => {
  const r = filtrarRepintagem([{ estrategia: 'vwap-bands', direccao: 'bearish', conviccao: 0.5 }], []);
  assert.equal(r.permitidos.length, 1);
});
