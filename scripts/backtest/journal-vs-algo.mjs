/**
 * O journal do Notion contra o algoritmo, dia a dia.
 *
 * Para cada ideia do journal (mesmo dia + par + lado, juntando as contas):
 *   · o R que deu (PnL ÷ risco da conta; sem conta, −1R no S/L e o R/R no T/P)
 *   · o viés que o algoritmo calculava às 08:00 de Londres (viesDiario, o do
 *     Asia Range Algo) — concorda com o lado do trade?
 *   · o que o mercado fez: que extremo da Ásia Londres varreu primeiro, se o
 *     extremo asiático do lado do trade foi tomado até às 17:00 de Londres, e o
 *     movimento 08:00→17:00 no sentido do trade (em ATR diário)
 *   · se o Asia Range 1M deu sinal nesse dia, em que sentido e com que R
 *
 * Com VIES=1 mede só o viés, em 2022+: em cada dia útil, o viés das 08:00
 * acerta no sentido de 08:00→17:00? Toma o extremo asiático do seu lado mais
 * vezes do que o do lado contrário? É a peça de que todos os setups dependem.
 *
 * O journal vem de data/backtest/journal/journal-codificado.txt (fora do git).
 */

import { existsSync, readFileSync } from 'node:fs';
import {
  agregar,
  diaLondres,
  faixaAsiaticaLondres,
  paresSmtIct,
  prepararEstruturas,
  relogioLondres,
  serieAtrIct,
  ultimaFechadaAte,
  viesDiario,
} from '../../packages/core/dist/index.js';
import { correr } from './asia-range-1m.mjs';

const RAIZ = 'E:/projecto Agnaldo 3.0/sistema de trading/';
const DIR = process.env.HISTDATA_DIR ?? `${RAIZ}data/backtest/histdata/`;
const JOURNAL = `${RAIZ}data/backtest/journal/journal-codificado.txt`;
const M1 = 60_000;
const M15 = 900_000;
const DIA = 86_400_000;
const SEMANA = 7 * DIA;
const JANELA_15M = 1200;
const FIM_DIA_LONDRES = 17 * 60;

const existe = (par, tf) => existsSync(`${DIR}${par}_${tf}.json`);
const ler = (par, tf) => JSON.parse(readFileSync(`${DIR}${par}_${tf}.json`, 'utf8'));

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

const est = (rs) => {
  const n = rs.length;
  if (n < 2) return { n, media: rs[0] ?? 0, t: 0 };
  const m = rs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rs.reduce((a, r) => a + (r - m) ** 2, 0) / (n - 1));
  return { n, media: m, t: sd > 0 ? m / (sd / Math.sqrt(n)) : 0 };
};
const f = (x, c = 2) => (x === null || x === undefined || Number.isNaN(x) ? '—' : `${x >= 0 ? '+' : ''}${x.toFixed(c)}`);

// ── O journal ────────────────────────────────────────────────────────────────
function lerJournal() {
  const linhas = readFileSync(JOURNAL, 'utf8').split('\n');
  const dic = {};
  for (const l of linhas) if (l.startsWith('#D ')) {
    const [k, v] = l.slice(3).split('=');
    dic[k] = v.split('|');
  }
  const campos = ['data', 'Symbol', 'Model', 'News', 'Narrative', 'Bias', 'Session', 'TF', 'Confluences', 'EntrySignal', 'Position', 'Status', 'sl', 'risco', 'pnl', 'maxRR', 'Mistakes', 'Account', 'Psychology'];
  const listas = new Set(['Confluences', 'EntrySignal', 'Mistakes']);
  const tamanho = { '5k Funding Trader': 5000, '50K funding traders': 50000, '5k TOT Account': 5000 };
  const out = [];
  for (const l of linhas) {
    if (!l.trim() || l.startsWith('#')) continue;
    const x = l.split(',');
    const o = {};
    campos.forEach((c, k) => {
      const v = x[k] ?? '';
      if (c === 'data') o.data = v;
      else if (['sl', 'risco', 'pnl', 'maxRR'].includes(c)) o[c] = v === '' ? null : Number(v);
      else if (listas.has(c)) o[c] = v === '' ? [] : v.split('.').map((i) => dic[c][Number(i)]);
      else o[c] = v === '' ? null : dic[c][Number(v)];
    });
    if (!o.data || !o.Symbol) continue;
    const conta = tamanho[o.Account];
    o.r =
      conta && o.risco > 0 && o.pnl !== null
        ? o.pnl / ((o.risco / 100) * conta)
        : o.Status === 'S/L'
          ? -1
          : o.Status === 'T/P' && o.maxRR !== null
            ? o.maxRR
            : null;
    const [a, m, d] = [o.data.slice(0, 2), o.data.slice(2, 4), o.data.slice(4, 6)].map(Number);
    o.dia = Date.UTC(2000 + a, m - 1, d) / DIA;
    out.push(o);
  }
  // Ideias: o mesmo trade copiado em várias contas conta uma vez.
  const ideias = new Map();
  for (const o of out) {
    if (o.Position !== 'Buy' && o.Position !== 'Sell') continue;
    const k = `${o.dia}|${o.Symbol}|${o.Position}`;
    const i = ideias.get(k) ?? { ...o, rs: [], erros: new Set() };
    if (o.r !== null) i.rs.push(o.r);
    for (const e of o.Mistakes) i.erros.add(e);
    ideias.set(k, i);
  }
  return [...ideias.values()]
    .map((i) => ({ ...i, rIdeia: i.rs.length ? i.rs.reduce((a, b) => a + b, 0) / i.rs.length : null }))
    .sort((a, b) => a.dia - b.dia);
}

// ── Mercado ──────────────────────────────────────────────────────────────────
const cache = new Map();
function dados(par) {
  if (cache.has(par)) return cache.get(par);
  let d = null;
  if (existe(par, '1m') && existe(par, '15m') && existe(par, '1h')) {
    const v1 = ler(par, '1m');
    const v15 = ler(par, '15m');
    const diarias = agregar(ler(par, '1h'), '1d');
    d = { v1, v15, diarias, atrD: serieAtrIct(diarias) };
  }
  cache.set(par, d);
  return d;
}

/** O viés diário do algoritmo no instante (o do Asia Range Algo, na última vela de 15M fechada). */
function viesEm(par, d, instante) {
  const j = ultimaFechadaAte(d.v15, M15, instante);
  if (j < JANELA_15M) return null;
  const velas = d.v15.slice(j - JANELA_15M + 1, j + 1);
  const i = velas.length - 1;
  const dias = d.diarias.slice(0, ultimaFechadaAte(d.diarias, DIA, instante) + 1);
  const e = prepararEstruturas({
    simbolo: par,
    timeframe: '15m',
    velas,
    diarias: dias,
    semanais: agregar(dias, '1w'),
    referencia: dias,
    timeframeReferencia: '1d',
    par: null,
  });
  const iDia = ultimaFechadaAte(e.diarias, DIA, instante);
  const iSem = ultimaFechadaAte(e.semanais, SEMANA, instante);
  if (dias.length < 45 || iDia < 20 || iSem < 4) return null;
  return viesDiario({ velasDiarias: e.diarias, iDia, swingsSemanais: e.swingsSemanais, iSemanal: iSem, pocas: e.pocas, iExecucao: i, preco: velas[i].close });
}

/** O dia de Londres `dia` (número de dias desde 1970): Ásia, 08:00→17:00, varrimentos. */
function oDia(d, dia) {
  const { v1 } = d;
  let k = primeira(v1, dia * DIA - 2 * 3_600_000);
  while (k < v1.length && !(diaLondres(v1[k].time) === dia && relogioLondres(v1[k].time).minutos >= 8 * 60)) {
    if (diaLondres(v1[k].time) > dia) return null;
    k++;
  }
  if (k >= v1.length) return null;
  const i08 = k;
  const asia = faixaAsiaticaLondres(v1, i08);
  if (!asia) return null;
  let alto = -Infinity;
  let baixo = Infinity;
  let primeiro = null;
  let fecho = v1[i08].open;
  let q = i08;
  for (; q < v1.length && diaLondres(v1[q].time) === dia && relogioLondres(v1[q].time).minutos < FIM_DIA_LONDRES; q++) {
    const c = v1[q];
    if (!primeiro && c.high > asia.alto && c.low < asia.baixo) primeiro = 'os dois';
    else if (!primeiro && c.high > asia.alto) primeiro = 'máxima';
    else if (!primeiro && c.low < asia.baixo) primeiro = 'mínima';
    alto = Math.max(alto, c.high);
    baixo = Math.min(baixo, c.low);
    fecho = c.close;
  }
  const iD = ultimaFechadaAte(d.diarias, DIA, v1[i08].time);
  return {
    t08: v1[i08].time,
    abertura: v1[i08].open,
    fecho,
    asia,
    tomouAlto: alto > asia.alto,
    tomouBaixo: baixo < asia.baixo,
    primeiro,
    atrD: iD >= 0 ? d.atrD[iD] : null,
  };
}

// ── Modo VIES=1: o viés sozinho, 2022+ ───────────────────────────────────────
if (process.env.VIES) {
  const pares = (process.env.PARES ?? 'GBPJPY,USDJPY,EURJPY,USDCAD,AUDJPY,CADJPY,CHFJPY,NZDJPY').split(',');
  const desde = Date.UTC(2022, 0, 10) / DIA;
  const corte = Date.UTC(2024, 6, 1) / DIA;
  console.log('Viés diário do algoritmo às 08:00 de Londres, 2022+ (08:00→17:00 de Londres)');
  console.log('par'.padEnd(8) + 'dias'.padStart(6) + 'neutro'.padStart(8) + 'acerta'.padStart(8) + '1.ª met'.padStart(9) + '2.ª met'.padStart(9) + 'toma lado'.padStart(11) + 'toma contra'.padStart(13) + 'mov/ATR'.padStart(9));
  const tot = { n: 0, neutro: 0, acertos: [], lado: 0, contra: 0, mov: [] };
  for (const par of pares) {
    const t0 = Date.now();
    const d = dados(par);
    if (!d) {
      console.log(`${par}: sem dados`);
      continue;
    }
    const r = { n: 0, neutro: 0, acertos: [], a1: [], a2: [], lado: 0, contra: 0, mov: [] };
    const ultimo = diaLondres(d.v1[d.v1.length - 1].time);
    for (let dia = desde; dia < ultimo; dia++) {
      const wd = new Date(dia * DIA).getUTCDay();
      if (wd === 0 || wd === 6) continue;
      const x = oDia(d, dia);
      if (!x || !x.atrD) continue;
      const v = viesEm(par, d, x.t08);
      if (!v) continue;
      r.n++;
      if (v.direccao === 'neutral') {
        r.neutro++;
        continue;
      }
      const s = v.direccao === 'bullish' ? 1 : -1;
      const mov = (s * (x.fecho - x.abertura)) / x.atrD;
      const ok = mov > 0 ? 1 : 0;
      r.acertos.push(ok);
      (dia < corte ? r.a1 : r.a2).push(ok);
      r.mov.push(mov);
      if (s > 0 ? x.tomouAlto : x.tomouBaixo) r.lado++;
      if (s > 0 ? x.tomouBaixo : x.tomouAlto) r.contra++;
    }
    const m = (a) => (a.length ? a.reduce((p, q) => p + q, 0) / a.length : 0);
    const k = r.acertos.length;
    console.log(
      par.padEnd(8) +
        String(r.n).padStart(6) +
        String(r.neutro).padStart(8) +
        `${(100 * m(r.acertos)).toFixed(1)}%`.padStart(8) +
        `${(100 * m(r.a1)).toFixed(1)}%`.padStart(9) +
        `${(100 * m(r.a2)).toFixed(1)}%`.padStart(9) +
        `${((100 * r.lado) / k).toFixed(0)}%`.padStart(11) +
        `${((100 * r.contra) / k).toFixed(0)}%`.padStart(13) +
        f(m(r.mov), 3).padStart(9) +
        `   ${((Date.now() - t0) / 1000).toFixed(0)}s`,
    );
    tot.n += r.n;
    tot.neutro += r.neutro;
    tot.acertos.push(...r.acertos);
    tot.lado += r.lado;
    tot.contra += r.contra;
    tot.mov.push(...r.mov);
  }
  const k = tot.acertos.length;
  const p = tot.acertos.reduce((a, b) => a + b, 0) / k;
  const z = (p - 0.5) / Math.sqrt(0.25 / k);
  const sm = est(tot.mov);
  console.log(`\nTODOS: ${k} dias com viés · acerta ${(100 * p).toFixed(1)}% (z=${z.toFixed(1)}) · toma o extremo asiático do seu lado ${((100 * tot.lado) / k).toFixed(0)}% vs contrário ${((100 * tot.contra) / k).toFixed(0)}% · movimento médio ${f(sm.media, 3)} ATR (t=${sm.t.toFixed(1)})`);
  process.exit(0);
}

// ── Modo normal: o journal, ideia a ideia ────────────────────────────────────
const ideias = lerJournal();
const primeiroDia = Math.min(...ideias.map((i) => i.dia));
const ultimoDia = Math.max(...ideias.map((i) => i.dia));
const sinais = new Map();
const paresComSinais = new Set();
const hm = (t) => new Date(t).toISOString().slice(11, 16);
const linhas = [];

for (const i of ideias) {
  const par = i.Symbol;
  const d = dados(par);
  const lado = i.Position === 'Buy' ? 1 : -1;
  const base = {
    data: new Date(i.dia * DIA).toISOString().slice(0, 10),
    par,
    lado: i.Position === 'Buy' ? 'compra' : 'venda',
    r: i.rIdeia,
    status: i.Status,
    sessao: i.Session,
    smt: i.Confluences.includes('SMT'),
    erro: i.erros.size > 0,
    narrativa: i.Narrative,
  };
  if (!d) {
    linhas.push({ ...base, semDados: true });
    continue;
  }
  if (!paresComSinais.has(par) && paresSmtIct(par).concat(par.endsWith('JPY') ? ['USDJPY'] : []).some((p) => existe(p, '1m'))) {
    paresComSinais.add(par);
    const r = correr(par, { desde: (primeiroDia - 1) * DIA, ate: (ultimoDia + 2) * DIA });
    for (const o of r.ops ?? []) sinais.set(`${par}|${o.dia}|${o.alta ? 1 : -1}`, o);
  }
  const x = oDia(d, i.dia);
  if (!x) {
    linhas.push({ ...base, semDados: true });
    continue;
  }
  const v = viesEm(par, d, x.t08);
  const dir = v ? (v.direccao === 'bullish' ? 1 : v.direccao === 'bearish' ? -1 : 0) : null;
  const s = sinais.get(`${par}|${i.dia}|${lado}`);
  const sContra = sinais.get(`${par}|${i.dia}|${-lado}`);
  linhas.push({
    ...base,
    vies: dir,
    concorda: dir === null || dir === 0 ? null : dir === lado,
    primeiro: x.primeiro,
    alvoTomado: lado > 0 ? x.tomouAlto : x.tomouBaixo,
    mov: x.atrD ? (lado * (x.fecho - x.abertura)) / x.atrD : null,
    sinal: s ? { r: s.r, hora: hm(s.t) } : null,
    sinalContra: sContra ? { r: sContra.r } : null,
  });
}

console.log('Journal do Notion contra o algoritmo — uma linha por ideia (mesmo dia + par + lado)\n');
console.log('data        par     lado    R journal  sessão  SMT erro | viés algo  1.º varrido  alvo Ásia  08→17 ATR | Asia Range 1M');
for (const l of linhas) {
  const cab = `${l.data}  ${l.par.padEnd(7)} ${l.lado.padEnd(7)} ${f(l.r).padStart(7)}   ${(l.sessao ?? '').replace('London Open', 'LO').replace('New York', 'NY').replace('London Close', 'LC').padEnd(6)}  ${l.smt ? 'sim' : '   '} ${l.erro ? 'sim ' : '    '}|`;
  if (l.semDados) {
    console.log(`${cab} sem dados de 1M deste par`);
    continue;
  }
  const vies = l.vies === null ? 'sem' : l.vies === 0 ? 'neutro' : l.vies > 0 ? 'alta' : 'baixa';
  const conc = l.concorda === null ? ' ' : l.concorda ? '✓' : '✗';
  const sinal = l.sinal ? `sinal no mesmo lado ${l.sinal.hora} UTC → ${f(l.sinal.r)}R` : l.sinalContra ? `sinal CONTRÁRIO → ${f(l.sinalContra.r)}R` : '—';
  console.log(`${cab} ${`${vies} ${conc}`.padEnd(9)}  ${(l.primeiro ?? 'nenhum').padEnd(11)}  ${(l.alvoTomado ? 'tomado' : 'não').padEnd(9)}  ${f(l.mov).padStart(8)}  | ${sinal}`);
}

const com = linhas.filter((l) => !l.semDados && l.r !== null);
const resumo = (rot, xs) => {
  const s = est(xs.map((l) => l.r));
  console.log(`  ${rot.padEnd(46)} ${String(s.n).padStart(3)} ideias  ${f(s.media)}R  t=${s.t.toFixed(1)}`);
};
console.log('\nResumo (ideias com dados de mercado e R conhecido):');
resumo('todas', com);
resumo('viés do algoritmo CONCORDA com o lado', com.filter((l) => l.concorda === true));
resumo('viés do algoritmo DISCORDA do lado', com.filter((l) => l.concorda === false));
resumo('algoritmo neutro ou sem viés', com.filter((l) => l.concorda === null));
resumo('o extremo asiático do lado do trade foi tomado', com.filter((l) => l.alvoTomado));
resumo('não foi tomado', com.filter((l) => !l.alvoTomado));
resumo('com SMT nas confluências', com.filter((l) => l.smt));
resumo('sem erro registado', com.filter((l) => !l.erro));
const dm = com.filter((l) => l.mov !== null);
console.log(`  dia a favor do trade (08→17): ${dm.filter((l) => l.mov > 0).length} de ${dm.length}`);
console.log(`  o Asia Range 1M deu sinal no mesmo dia e lado em ${com.filter((l) => l.sinal).length} das ${com.length} ideias; no lado contrário em ${com.filter((l) => l.sinalContra).length}`);
const noPeriodo = [...sinais.values()];
const diasJournal = new Set(com.map((l) => `${l.par}|${Math.round(Date.parse(l.data) / DIA)}`));
const sNos = noPeriodo.filter((o) => diasJournal.has(`${[...sinais.entries()].find(([, v]) => v === o)[0].split('|')[0]}|${o.dia}`));
console.log(`  sinais do Asia Range 1M no período do journal: ${noPeriodo.length} · média ${f(est(noPeriodo.map((o) => o.r)).media)}R · nos dias do journal ${sNos.length} (${f(est(sNos.map((o) => o.r)).media)}R)`);
