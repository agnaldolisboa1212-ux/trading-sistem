/**
 * ICT ALGO — onde param os modelos, e em que regime está o mercado.
 *
 * O backtest diz QUANTO rende; este diz PORQUE há os sinais que há. Conta, em
 * cada vela avaliada, o regime lido e, para cada modelo, o passo em que parou.
 * Se 99% dos candidatos de um modelo morrerem num único passo, esse passo é o
 * modelo todo — e vale a pena perguntar se é mesmo o que o site descreve.
 *
 * Uso: TF=15m MERCADO=EURUSD node scripts/backtest/ict-funil.mjs
 */

import { readFileSync } from 'node:fs';
import { agregar, avaliarVela, prepararEstruturas } from '../../packages/core/dist/index.js';

const DIR = 'E:/projecto Agnaldo 3.0/sistema de trading/data/backtest/histdata/';
const TF = process.env.TF ?? '15m';
const PARES = { EURUSD: 'GBPUSD', GBPUSD: 'EURUSD', USDJPY: 'EURJPY', EURJPY: 'GBPJPY', AUDUSD: 'NZDUSD', XAUUSD: 'XAGUSD' };
const MERCADO = process.env.MERCADO ?? 'EURUSD';

const ler = (f) => {
  try {
    return JSON.parse(readFileSync(`${DIR}${f}_${TF}.json`, 'utf8'));
  } catch {
    return null;
  }
};
const velas = ler(MERCADO);
if (!velas) {
  console.log(`sem dados de ${MERCADO} em ${TF}`);
  process.exit(1);
}
const parVelas = ler(PARES[MERCADO] ?? '');
const diarias = agregar(velas, '1d');
const e = prepararEstruturas({
  simbolo: MERCADO,
  timeframe: TF,
  velas,
  diarias,
  semanais: agregar(velas, '1w'),
  referencia: diarias,
  timeframeReferencia: '1d',
  par: parVelas ? { simbolo: PARES[MERCADO], velas: parVelas } : null,
});

const regimes = new Map();
const porModelo = new Map();
const conta = (m, k) => {
  const x = m.get(k) ?? 0;
  m.set(k, x + 1);
};
let avaliadas = 0;
const desde = Math.max(300, velas.findIndex((c) => c.time >= Date.UTC(2022, 0, 1)));
for (let i = desde; i < velas.length - 1; i++) {
  const av = avaliarVela(e, i);
  if (!av) continue;
  avaliadas++;
  conta(regimes, av.regime.regime);
  for (const r of av.resultados) {
    if (!porModelo.has(r.modelo)) porModelo.set(r.modelo, new Map());
    conta(porModelo.get(r.modelo), r.sinal ? 'MONTOU SETUP' : (r.porqueNao ?? '?'));
  }
}

console.log(`\nICT ALGO · ${MERCADO} ${TF} · ${avaliadas.toLocaleString('pt-PT')} velas desde 2022\n`);
console.log('regimes:');
for (const [k, n] of [...regimes].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(14)} ${String(n).padStart(7)}  ${((100 * n) / avaliadas).toFixed(1).padStart(5)}%`);
}
for (const [m, razoes] of porModelo) {
  const total = [...razoes.values()].reduce((a, b) => a + b, 0);
  console.log(`\n${m} (${total} avaliações, nos dois sentidos):`);
  for (const [k, n] of [...razoes].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
    console.log(`  ${k.slice(0, 60).padEnd(62)}${String(n).padStart(7)}  ${((100 * n) / total).toFixed(1).padStart(5)}%`);
  }
}
