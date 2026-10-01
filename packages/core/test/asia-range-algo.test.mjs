/**
 * Asia Range Algo — o setup do journal (29/09/2026): POI de 15M tocado na
 * janela de Londres e reversão (MSS) em 1M.
 *
 *   1. o tiro no POI: entrada no fecho do MSS de 1M, stop além do POI, alvo na
 *      liquidez oposta por tomar a ≥ 2R
 *   2. LOOK-AHEAD: a decisão num minuto não muda quando o futuro é removido
 *   3. POI passado em mais de ½ ATR: deixa de valer; sem alvo a 2R: não há tiro
 *   4. a análise completa (15M → POI → 1M) e o plano da estratégia, numa vela
 *   5. sem `extra.algo` (o cliente) e sem 1M não há sinal
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { analisarAsiaRange, executarEstrategiasValidadas, poisDeSessao, tiroPoi } from '../dist/index.js';

const M1 = 60_000;
const M15 = 900_000;
const vela = (time, open, high, low, close) => ({ time, open, high, low, close, volume: 0 });

// Quinta 15/01/2026 (inverno: Londres = UTC). A janela é 08:00–11:00.
const INICIO = Date.UTC(2026, 0, 15, 8, 0);

/** Uma leitura das 08:00 à mão: viés de baixa, um POI de venda acima do preço. */
function leituraVenda(extra = {}) {
  return {
    dia: Math.floor(INICIO / 86_400_000),
    inicio: INICIO,
    fim: INICIO + 3 * 3_600_000,
    provisoria: false,
    vies: 'bearish',
    estrutura: { tipo: 'bos', nivel: 150.2, time: INICIO - 6 * 3_600_000 },
    asia: { alto: 150.6, baixo: 149.8, de: INICIO - 8 * 3_600_000, ate: INICIO },
    pois: [{ lado: 'venda', baixo: 150.9, alto: 151.0, extremo: 151.0, origem: INICIO - 30 * 3_600_000, chave: 'x|venda|151' }],
    liquidezOposta: [
      { preco: 149.8, rotulo: 'mínimo da Ásia' },
      { preco: 149.5, rotulo: 'fundo por tomar' },
    ],
    preco: 150.5,
    atr: 0.2,
    ...extra,
  };
}

/**
 * 1M: das 03:00 às 08:00 a oscilar em 150,5; às 08:00 sobe a 150,80, recua a
 * 150,74 (o swing de 1M), sobe ao POI (extremo 150,96) e cai com fecho abaixo
 * de 150,74 — o MSS — e continua a cair.
 */
function caminho1m({ extremo = 150.96 } = {}) {
  const pontos = [];
  for (let k = 0; k < 300; k++) pontos.push(150.5 + 0.02 * Math.sin(k / 3));
  const rampa = (de, ate, n) => {
    for (let k = 1; k <= n; k++) pontos.push(de + ((ate - de) * k) / n);
  };
  rampa(150.5, 150.8, 10);
  rampa(150.8, 150.74, 3);
  rampa(150.74, extremo, 6);
  rampa(extremo, 150.7, 8);
  rampa(150.7, 150.3, 20);
  const out = [];
  let ant = pontos[0];
  let t = INICIO - 300 * M1;
  for (const p of pontos) {
    out.push(vela(t, ant, Math.max(ant, p) + 0.005, Math.min(ant, p) - 0.005, p));
    ant = p;
    t += M1;
  }
  return out;
}

test('Asia Range: o tiro no POI — MSS de 1M, stop além do POI, alvo na liquidez oposta a ≥ 2R', () => {
  const v1 = caminho1m();
  const r = tiroPoi(leituraVenda(), v1, INICIO + 3 * 3_600_000);
  assert.equal(r.estado, 'disparado', r.detalhe);
  const t = r.tiro;
  assert.ok(t.entrada < 150.74, `entrada no fecho que quebrou o swing de 1M (${t.entrada})`);
  assert.ok(Math.abs(t.stop - 151.0) < 1e-9, `stop no extremo do POI (${t.stop})`);
  assert.equal(t.alvo.preco, 149.8, 'alvo: o mínimo da Ásia, o mais próximo que paga 2R');
  assert.ok(t.alvo.r >= 2);
  assert.ok(t.tocadoEm < t.extremoEm && t.extremoEm < t.time, 'toque → extremo → MSS');
});

test('Asia Range: o TESTE DO CORTE — antes do MSS não há tiro; depois, o mesmo tiro', () => {
  const v1 = caminho1m();
  const fim = tiroPoi(leituraVenda(), v1, INICIO + 3 * 3_600_000).tiro;
  for (let t = INICIO; t <= INICIO + 60 * M1; t += M1) {
    const cortado = v1.filter((c) => c.time + M1 <= t);
    const r = tiroPoi(leituraVenda(), cortado, t);
    const comFuturo = tiroPoi(leituraVenda(), v1, t);
    assert.deepEqual(r.tiro, comFuturo.tiro, `${new Date(t).toISOString()}: velas do futuro mudaram a decisão`);
    if (t < fim.time + M1) assert.equal(r.tiro, null, 'antes do fecho do MSS não há tiro');
    else assert.deepEqual(r.tiro, fim);
  }
});

test('Asia Range: POI passado em mais de ½ ATR deixa de valer; sem alvo a 2R não há tiro', () => {
  const passou = tiroPoi(leituraVenda(), caminho1m({ extremo: 151.15 }), INICIO + 3 * 3_600_000);
  assert.equal(passou.tiro, null);
  assert.equal(passou.estado, 'invalidado');

  const semAlvo = tiroPoi(leituraVenda({ liquidezOposta: [{ preco: 150.6, rotulo: 'perto demais' }] }), caminho1m(), INICIO + 3 * 3_600_000);
  assert.equal(semAlvo.tiro, null);
  assert.equal(semAlvo.estado, 'sem-alvo');
});

/**
 * A análise completa: um passeio de 15M (dias úteis) dá a leitura real das
 * 08:00; o 1M da janela é construído à volta do primeiro POI dessa leitura.
 */
function passeio(n, inicio, semente = 7) {
  let s = semente;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const v = [];
  let p = 150;
  for (let i = 0; i < n; i++) {
    const o = p;
    const c = o + (rnd() - 0.5) * 0.3 + Math.sin(i / 40) * 0.02;
    v.push(vela(inicio + i * M15, o, Math.max(o, c) + rnd() * 0.08, Math.min(o, c) - rnd() * 0.08, c));
    p = c;
  }
  return v.filter((c) => ![0, 6].includes(new Date(c.time).getUTCDay()));
}

function cenarioCompleto() {
  for (let semente = 1; semente < 60; semente++) {
    const v15 = passeio(96 * 12, Date.UTC(2026, 0, 5), semente).filter((c) => c.time < INICIO);
    const l = poisDeSessao(v15, INICIO);
    if (!l || l.pois.length === 0) continue;
    const z = l.pois[0];
    const venda = z.lado === 'venda';
    const dir = venda ? 1 : -1;
    const borda = venda ? z.baixo : z.alto;
    const base = l.preco;
    // Até ao POI com um recuo pelo caminho (o swing de 1M), extremo dentro dele,
    // e a reversão para lá do recuo — em direcção à liquidez oposta.
    const recuo = borda - dir * 0.25 * l.atr;
    const pontos = [];
    for (let k = 0; k < 300; k++) pontos.push(base);
    const rampa = (de, ate, n) => {
      for (let k = 1; k <= n; k++) pontos.push(de + ((ate - de) * k) / n);
    };
    rampa(base, recuo + dir * 0.1 * l.atr, 12);
    rampa(recuo + dir * 0.1 * l.atr, recuo, 4);
    rampa(recuo, (z.baixo + z.alto) / 2, 8);
    rampa((z.baixo + z.alto) / 2, recuo - dir * 0.3 * l.atr, 10);
    rampa(recuo - dir * 0.3 * l.atr, base - dir * 2 * l.atr, 60);
    const v1 = [];
    let ant = pontos[0];
    let t = INICIO - 300 * M1;
    for (const p of pontos) {
      v1.push(vela(t, ant, Math.max(ant, p), Math.min(ant, p), p));
      ant = p;
      t += M1;
    }
    // As velas de 15M da janela, agregadas do 1M (o que o motor teria).
    const v15b = [...v15];
    for (let t15 = INICIO; t15 < INICIO + 3 * 3_600_000; t15 += M15) {
      const cs = v1.filter((c) => c.time >= t15 && c.time < t15 + M15);
      if (cs.length === 0) break;
      v15b.push(vela(t15, cs[0].open, Math.max(...cs.map((c) => c.high)), Math.min(...cs.map((c) => c.low)), cs[cs.length - 1].close));
    }
    const r = tiroPoi(l, v1, INICIO + 3 * 3_600_000);
    if (r.estado === 'disparado') return { v15: v15b, v1, tiro: r.tiro, n15: v15.length };
  }
  return null;
}

test('Asia Range: a análise completa dá o sinal uma vez, na vela de 15M do MSS de 1M', () => {
  const c = cenarioCompleto();
  assert.ok(c, 'um cenário com tiro');
  const sinais = [];
  const planos = [];
  for (let i = c.n15; i < c.v15.length; i++) {
    const velas = c.v15.slice(0, i + 1);
    const fecho = velas[i].time + M15;
    const ltf = c.v1.filter((x) => x.time + M1 <= fecho).slice(-300);
    const a = analisarAsiaRange({ simbolo: 'GBPJPY', velas, par: null, ltf });
    if (a.sinal && a.sinal.index === i) sinais.push(a.sinal);
    planos.push(
      ...executarEstrategiasValidadas(velas, { symbol: 'GBPJPY', timeframe: '15m' }, { algo: { diarias: [], par: null, ltf1: ltf } }, ['asia-range-algo']),
    );
  }
  assert.equal(sinais.length, 1, 'um sinal, na vela do MSS');
  assert.equal(sinais[0].entrada, c.tiro.entrada);
  assert.equal(sinais[0].stop, c.tiro.stop);
  assert.equal(planos.length, 1, 'a estratégia emite uma vez');
  assert.equal(planos[0].strategy, 'asia-range-algo');
  assert.equal(planos[0].entryPrice, c.tiro.entrada);
});

test('Asia Range Algo e ICT ALGO: sem extra.algo (o cliente) não correm; sem 1M não há sinal', () => {
  const c = cenarioCompleto();
  const r = executarEstrategiasValidadas(c.v15, { symbol: 'GBPJPY', timeframe: '15m' }, {});
  assert.equal(r.filter((s) => s.strategy === 'asia-range-algo' || s.strategy === 'ict-algo').length, 0);
  for (let i = c.n15; i < c.v15.length; i++) {
    const a = analisarAsiaRange({ simbolo: 'GBPJPY', velas: c.v15.slice(0, i + 1), par: null, ltf: [] });
    assert.equal(a.sinal, null);
    assert.equal(a.porqueNao, 'sem velas de 1M para a reversão');
  }
});
