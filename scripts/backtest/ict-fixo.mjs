/**
 * ICT ALGO — o SETUP FIXO de 1H e o TIRO em 15M (produção desde 29/09/2026),
 * medido em 2022–2026 com as funções de produção:
 *
 *   escolha   `percorrerIct` (a carteira com quarentena, a do `correrIctAlgo`)
 *             diz, vela a vela de 1H, que setup o algoritmo escolhia
 *   arma      `armarSetupIct` — um setup de cada vez por instrumento; um setup
 *             (a mesma chave) nunca se arma duas vezes
 *   tiro      `estadoDoSetup` sobre as velas de 15M — CHoCH/MSS de 15M depois
 *             do toque na zona, stop no extremo desde o toque, RR ≥ 2
 *   saída     o tiro fecha no stop, no alvo (stop e alvo na mesma vela = stop)
 *             ou ao fim de 24 h no fecho; custos de conta normal em R
 *
 * Quatro variantes, fixadas antes de correr (29/09/2026):
 *   A  zona OTE ∩ PD array, alvo fixo   (a regra até hoje)
 *   B  zona = PD array inteiro, alvo fixo
 *   C  zona OTE ∩ PD array, alvo móvel
 *   D  zona = PD array inteiro, alvo móvel   (a pedida pelo Agnaldo + a correcção do alvo)
 *
 * Passa se: positiva nas duas metades (2022-01→2024-06 / 2024-07→2026), t ≥ 1,5
 * e positiva nos mercados de controlo. Só mercados com 15M em HistData.
 *
 *   node --max-old-space-size=6000 scripts/backtest/ict-fixo.mjs
 *   CONTROLO=1 …     mercados de controlo
 *   MERCADO=EURUSD … só um (para correr em paralelo); SAIDA=f.json grava o resumo
 */

import { readFileSync, writeFileSync } from 'node:fs';
import {
  agregar,
  armarSetupIct,
  custoTipico,
  estadoDoSetup,
  opcoesPorTimeframe,
  percorrerIct,
  prepararEstruturas,
} from '../../packages/core/dist/index.js';

const DIR = 'E:/projecto Agnaldo 3.0/sistema de trading/data/backtest/histdata/';
const DESDE = Date.UTC(2022, 0, 1);
const CORTE = Date.UTC(2024, 6, 1);
const M15 = 900_000;
const H1 = 3_600_000;
const DIA = 86_400_000;
/** Velas de 15M antes do setup que o gatilho vê (estrutura e ATR de 15M). */
const HISTORIA_15M = 300;

const PRINCIPAIS = [
  ['EURUSD', 'EURUSD', 'GBPUSD'],
  ['GBPUSD', 'GBPUSD', 'EURUSD'],
  ['USDJPY', 'USDJPY', 'EURJPY'],
  ['EURJPY', 'EURJPY', 'GBPJPY'],
  ['XAUUSD', 'XAUUSD', 'XAGUSD'],
  ['GER30', 'GRXEUR', 'FRXEUR'],
];
const CONTROLO = [
  ['AUDUSD', 'AUDUSD', 'NZDUSD'],
  ['NZDUSD', 'NZDUSD', 'AUDUSD'],
  ['EURGBP', 'EURGBP', 'EURUSD'],
  ['USDCAD', 'USDCAD', 'USDCHF'],
  ['USDCHF', 'USDCHF', 'USDCAD'],
  ['GBPJPY', 'GBPJPY', 'EURJPY'],
];
const VARIANTES = {
  A: { zona: 'ote', alvoMovel: false },
  B: { zona: 'pd-array', alvoMovel: false },
  C: { zona: 'ote', alvoMovel: true },
  D: { zona: 'pd-array', alvoMovel: true },
};

const ler = (f, tf) => {
  try {
    return JSON.parse(readFileSync(`${DIR}${f}_${tf}.json`, 'utf8'));
  } catch {
    return null;
  }
};
function primeira(v, t) {
  let lo = 0;
  let hi = v.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (v[m].time < t) lo = m + 1;
    else hi = m;
  }
  return lo;
}
export const est = (rs) => {
  const n = rs.length;
  if (n < 3) return { n, media: n ? rs.reduce((a, b) => a + b, 0) / n : 0, t: 0, acerto: 0 };
  const m = rs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rs.reduce((a, r) => a + (r - m) ** 2, 0) / (n - 1));
  return { n, media: m, t: sd > 0 ? m / (sd / Math.sqrt(n)) : 0, acerto: rs.filter((r) => r > 0).length / n };
};

/** O tiro, depois de disparado: stop, alvo ou 24 h. R líquido de custos. */
function fecharTiro(v15, tiro, alta, custo) {
  const risco = Math.abs(tiro.entrada - tiro.stop);
  let k = primeira(v15, tiro.time + M15);
  for (; k < v15.length; k++) {
    const c = v15[k];
    if (c.time >= tiro.time + DIA) {
      const r = (alta ? c.open - tiro.entrada : tiro.entrada - c.open) / risco;
      return { r: r - custo / risco, saida: 'tempo', fim: c.time };
    }
    if (alta ? c.low <= tiro.stop : c.high >= tiro.stop) return { r: -1 - custo / risco, saida: 'stop', fim: c.time + M15 };
    if (alta ? c.high >= tiro.alvo : c.low <= tiro.alvo) return { r: tiro.rr - custo / risco, saida: 'alvo', fim: c.time + M15 };
  }
  return null;
}

function correrMercado([nome, ficheiro, parFicheiro]) {
  const velas = ler(ficheiro, '1h');
  const v15 = ler(ficheiro, '15m');
  const parVelas = ler(parFicheiro, '1h');
  if (!velas || !v15 || velas.length < 3000) return null;
  const diarias = agregar(velas, '1d');
  const e = prepararEstruturas({
    simbolo: nome,
    timeframe: '1h',
    velas,
    diarias,
    semanais: agregar(velas, '1w'),
    referencia: diarias,
    timeframeReferencia: '1d',
    par: parVelas ? { simbolo: parFicheiro, velas: parVelas } : null,
  });
  const custo = custoTipico(nome, velas[velas.length - 1].close) * Number(process.env.CUSTO_MULT ?? 1);
  let desde = velas.findIndex((c) => c.time >= DESDE);
  if (desde < 300) desde = 300;
  // O 15M tem de cobrir: começa-se quando ele começa.
  const inicio15 = v15[HISTORIA_15M]?.time ?? Infinity;
  while (desde < velas.length && velas[desde].time < inicio15) desde++;
  const fim15 = v15[v15.length - 1].time;

  // 1 — O setup que o algoritmo escolhia em cada vela (carteira com quarentena).
  const escolhido = new Map();
  percorrerIct(e, desde, velas.length - 1, opcoesPorTimeframe('1h', custo), 'borda', (s, i, carteira) => {
    if (carteira === 'comQuarentena') escolhido.set(i, s);
    return false;
  });

  // 2 — Setup fixo e tiro, por variante.
  const out = {};
  for (const [nv, op] of Object.entries(VARIANTES)) {
    const ops = [];
    const fins = { tiro: 0, invalidado: 0, expirado: 0 };
    let livre = 0;
    let armados = 0;
    const usadas = new Set();
    for (const i of [...escolhido.keys()].sort((a, b) => a - b)) {
      const s = escolhido.get(i);
      const fecho = velas[i].time + H1;
      if (fecho < livre || usadas.has(s.chave) || fecho + DIA > fim15) continue;
      const setup = armarSetupIct({ simbolo: nome, sinal: s, lidas: { '1h': i + 1 }, passos: [] }, fecho, (m) => m, { zona: op.zona });
      if (!setup) continue;
      usadas.add(s.chave);
      armados++;
      const a = Math.max(0, primeira(v15, fecho) - HISTORIA_15M);
      const b = primeira(v15, setup.expiraEm + M15);
      const est15 = estadoDoSetup(setup, v15.slice(a, b), setup.expiraEm + M15, { alvoMovel: op.alvoMovel });
      if (est15.estado !== 'disparado') {
        fins[est15.estado === 'invalidado' ? 'invalidado' : 'expirado']++;
        livre = est15.estado === 'invalidado' ? est15.em + M15 : setup.expiraEm;
        continue;
      }
      fins.tiro++;
      const alta = setup.direccao === 'bullish';
      const f = fecharTiro(v15, est15.tiro, alta, custo);
      if (!f) break;
      ops.push({ t: est15.tiro.time, r: f.r, saida: f.saida, rr: est15.tiro.rr, alta });
      livre = f.fim;
    }
    const semanas = (fim15 - velas[desde].time) / (7 * DIA);
    out[nv] = { ops, fins, armados, semanas };
  }
  return out;
}

function linha(rotulo, ops) {
  const t = est(ops.map((o) => o.r));
  const h1 = est(ops.filter((o) => o.t < CORTE).map((o) => o.r));
  const h2 = est(ops.filter((o) => o.t >= CORTE).map((o) => o.r));
  const f = (x) => `${x.media >= 0 ? '+' : ''}${x.media.toFixed(3)}R`;
  return `${rotulo.padEnd(10)} ${String(t.n).padStart(4)} · ${(t.acerto * 100).toFixed(0).padStart(3)}% · ${f(t)} · t=${t.t.toFixed(1)} · metades ${f(h1)} (${h1.n}) / ${f(h2)} (${h2.n})`;
}

const lista = (process.env.CONTROLO ? CONTROLO : PRINCIPAIS).filter((m) => !process.env.MERCADO || m[0] === process.env.MERCADO);
const todos = {};
for (const m of lista) {
  const t0 = Date.now();
  const r = correrMercado(m);
  if (!r) {
    console.log(`${m[0]}: sem dados`);
    continue;
  }
  for (const [nv, x] of Object.entries(r)) {
    (todos[nv] ??= { ops: [], armados: 0, semanas: 0, fins: { tiro: 0, invalidado: 0, expirado: 0 } });
    todos[nv].ops.push(...x.ops);
    todos[nv].armados += x.armados;
    todos[nv].semanas += x.semanas;
    for (const k of Object.keys(x.fins)) todos[nv].fins[k] += x.fins[k];
    console.log(`${m[0].padEnd(7)} ${nv}: ${linha('', x.ops)} · armados ${x.armados} (${(x.armados / x.semanas).toFixed(2)}/sem) · tiros ${x.fins.tiro} (${(x.fins.tiro / x.semanas).toFixed(2)}/sem) · invalidados ${x.fins.invalidado} · expirados ${x.fins.expirado}`);
  }
  console.log(`  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
console.log(`\n== ICT fixo 1H → tiro 15M · ${process.env.CONTROLO ? 'CONTROLO' : 'PRINCIPAIS'} · 2022+ · custos ×${process.env.CUSTO_MULT ?? 1}`);
for (const [nv, x] of Object.entries(todos)) {
  const porMercadoSemana = x.semanas > 0 ? x.fins.tiro / x.semanas : 0;
  console.log(`${linha(`${nv} ${VARIANTES[nv].zona}/${VARIANTES[nv].alvoMovel ? 'móvel' : 'fixo'}`, x.ops)} · tiros por mercado e semana ${porMercadoSemana.toFixed(2)} · armados ${x.armados}, invalidados ${x.fins.invalidado}, expirados ${x.fins.expirado}`);
}
if (process.env.SAIDA) writeFileSync(process.env.SAIDA, JSON.stringify(todos));
