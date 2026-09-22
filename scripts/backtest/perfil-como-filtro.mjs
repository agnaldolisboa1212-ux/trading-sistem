/**
 * O perfil (TPO) reforça o rompimento de 4h?
 *
 * A ideia do Agnaldo: juntar a melhor regra ao perfil para "fortalecer" os
 * sinais. Testa-se a sério — cada filtro é medido contra a regra SEM filtro, e
 * um filtro só vale se melhorar o R por operação SEM destruir a frequência e
 * SEM estragar nenhuma das metades.
 *
 * Nota honesta: a Deriv e a HistData não dão volume negociado no forex (o campo
 * `volume` da HistData é a contagem de minutos com dados). O perfil aqui é um
 * TPO — tempo passado em cada preço, o Market Profile original do Steidlmayer.
 * Não é volume a sério, e dizer o contrário seria mentira.
 *
 * ── O QUE DEU (22/09/2026) ─────────────────────────────────────────────────
 *
 * No ouro e no USDJPY o melhor filtro (vácuo acima da entrada) levava o
 * resultado de +0,161R para +0,203R, e as operações que descartava valiam
 * −0,036R — parecia real. Nos QUINZE instrumentos que não participaram na
 * escolha, a mesma regra melhora +0,002R: nada. Oito melhoram, sete pioram.
 *
 * Os +0,24R eram ruído de selecção: testaram-se 9 filtros × 2 janelas e
 * escolheu-se o melhor. É o erro clássico, e só o teste fora da amostra o
 * apanha. O perfil NÃO entrou no sistema.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/';
const DIR = (process.env.HISTDATA ?? RAIZ + 'data/backtest/histdata') + '/';
const HORA = 3_600_000;
const CORTE = Date.UTC(2024, 6, 1);
const PARES = [
  ['XAUUSD', 0.35],
  ['USDJPY', 0.012],
];

function velas4h(par) {
  const v = JSON.parse(readFileSync(`${DIR}${par}_1h.json`, 'utf8'));
  const passo = 4 * HORA;
  const out = [];
  for (const c of v) {
    const k = c.time - (c.time % passo);
    const u = out[out.length - 1];
    if (u && u.time === k) {
      u.high = Math.max(u.high, c.high);
      u.low = Math.min(u.low, c.low);
      u.close = c.close;
    } else out.push({ time: k, open: c.open, high: c.high, low: c.low, close: c.close });
  }
  return out;
}

/** Perfil TPO das últimas `janela` velas: quanto tempo o preço passou em cada faixa. */
function perfil(v, i, janela = 120, faixas = 60) {
  const de = Math.max(0, i - janela + 1);
  let hi = -Infinity;
  let lo = Infinity;
  for (let k = de; k <= i; k++) {
    hi = Math.max(hi, v[k].high);
    lo = Math.min(lo, v[k].low);
  }
  if (!(hi > lo)) return null;
  const larg = (hi - lo) / faixas;
  const t = new Float64Array(faixas);
  for (let k = de; k <= i; k++) {
    // Cada vela reparte o seu tempo pelas faixas que atravessou.
    const a = Math.max(0, Math.min(faixas - 1, Math.floor((v[k].low - lo) / larg)));
    const b = Math.max(0, Math.min(faixas - 1, Math.floor((v[k].high - lo) / larg)));
    const n = b - a + 1;
    for (let j = a; j <= b; j++) t[j] += 1 / n;
  }
  let iPoc = 0;
  for (let j = 1; j < faixas; j++) if (t[j] > t[iPoc]) iPoc = j;
  const total = t.reduce((x, y) => x + y, 0);
  // Área de valor: cresce a partir do POC até 70% do tempo.
  let baixo = iPoc;
  let alto = iPoc;
  let soma = t[iPoc];
  while (soma < 0.7 * total && (baixo > 0 || alto < faixas - 1)) {
    const abaixo = baixo > 0 ? t[baixo - 1] : -1;
    const acima = alto < faixas - 1 ? t[alto + 1] : -1;
    if (acima >= abaixo) soma += t[++alto];
    else soma += t[--baixo];
  }
  const preco = (j) => lo + (j + 0.5) * larg;
  return {
    poc: preco(iPoc),
    vah: preco(alto),
    val: preco(baixo),
    // Densidade de tempo acima da entrada: "vácuo" = caminho livre.
    densidadeAcima: (p) => {
      const j = Math.max(0, Math.min(faixas - 1, Math.floor((p - lo) / larg)));
      let s = 0;
      for (let k = j + 1; k < faixas; k++) s += t[k];
      return s / total;
    },
  };
}

function operacoes(v, custo, filtro, janela) {
  const n = v.length;
  const atr = new Float64Array(n);
  const e50 = new Float64Array(n);
  const e200 = new Float64Array(n);
  let a = 0;
  for (let i = 0; i < n; i++) {
    const tr =
      i === 0
        ? v[i].high - v[i].low
        : Math.max(v[i].high - v[i].low, Math.abs(v[i].high - v[i - 1].close), Math.abs(v[i].low - v[i - 1].close));
    a = i < 14 ? (a * i + tr) / (i + 1) : (a * 13 + tr) / 14;
    atr[i] = a;
    const c = v[i].close;
    e50[i] = i === 0 ? c : e50[i - 1] + (2 / 51) * (c - e50[i - 1]);
    e200[i] = i === 0 ? c : e200[i - 1] + (2 / 201) * (c - e200[i - 1]);
  }
  const dispara = (i) => {
    if (!(e50[i] > e200[i])) return false;
    let hi = -Infinity;
    for (let k = i - 20; k < i; k++) hi = Math.max(hi, v[k].high);
    return v[i].close > hi;
  };
  const ops = [];
  for (let i = 210; i < n - 1; i++) {
    if (!dispara(i)) continue;
    let recente = false;
    for (let k = Math.max(210, i - 6); k < i && !recente; k++) if (dispara(k)) recente = true;
    if (recente) continue;
    if (filtro) {
      const p = perfil(v, i, janela);
      if (!p || !filtro(v[i].close, p, atr[i])) continue;
    }
    const e = v[i].close;
    const risco = 1.5 * atr[i];
    if (!(risco > 0)) continue;
    let r = null;
    for (let j = i + 1; j <= Math.min(i + 6, n - 1); j++) {
      if ((e - v[j].low) / risco >= 1) {
        r = -1;
        break;
      }
      if ((v[j].high - e) / risco >= 2) {
        r = 2;
        break;
      }
    }
    if (r === null) r = (v[Math.min(i + 6, n - 1)].close - e) / risco;
    ops.push({ t: v[i].time, r: r - custo / risco });
  }
  return ops;
}

const st = (rs) => {
  const n = rs.length;
  if (n < 3) return { n, media: 0, t: 0, acerto: 0 };
  const m = rs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rs.reduce((a, r) => a + (r - m) ** 2, 0) / (n - 1));
  return { n, media: m, t: m / (sd / Math.sqrt(n)), acerto: rs.filter((r) => r > 0).length / n };
};

const FILTROS = [
  ['sem filtro (a regra actual)', null],
  ['entrada ACIMA da VAH', (p, perf) => p > perf.vah],
  ['entrada ainda DENTRO do valor', (p, perf) => p <= perf.vah && p >= perf.val],
  ['POC a 1+ ATR abaixo', (p, perf, atr) => p - perf.poc >= atr],
  ['POC a 2+ ATR abaixo', (p, perf, atr) => p - perf.poc >= 2 * atr],
  ['vácuo acima (<10% do tempo)', (p, perf) => perf.densidadeAcima(p) < 0.1],
  ['vácuo acima (<5% do tempo)', (p, perf) => perf.densidadeAcima(p) < 0.05],
  ['ACIMA da VAH + vácuo <10%', (p, perf) => p > perf.vah && perf.densidadeAcima(p) < 0.1],
  ['perto do POC (±0,5 ATR)', (p, perf, atr) => Math.abs(p - perf.poc) <= 0.5 * atr],
];

for (const janela of [60, 120]) {
  console.log(`\n══ perfil das últimas ${janela} velas de 4h (${(janela / 6).toFixed(0)} dias) ══`);
  console.log(
    'filtro'.padEnd(30) + 'n'.padStart(6) + 'R/op'.padStart(9) + 't'.padStart(6) +
      '1.ª metade'.padStart(12) + '2.ª metade'.padStart(12) + '/ano'.padStart(7),
  );
  for (const [nome, f] of FILTROS) {
    const todas = [];
    for (const [par, custo] of PARES) todas.push(...operacoes(velas4h(par), custo, f, janela));
    if (todas.length < 20) {
      console.log(`${nome.padEnd(30)}${String(todas.length).padStart(6)}   (poucas)`);
      continue;
    }
    todas.sort((a, b) => a.t - b.t);
    const s = st(todas.map((o) => o.r));
    const a1 = st(todas.filter((o) => o.t < CORTE).map((o) => o.r));
    const a2 = st(todas.filter((o) => o.t >= CORTE).map((o) => o.r));
    const anos = (todas.at(-1).t - todas[0].t) / (365.25 * 86_400_000);
    const passa = a1.media > 0 && a2.media > 0 && s.t >= 1.5;
    console.log(
      ((passa ? '✅ ' : '   ') + nome).padEnd(30) +
        String(s.n).padStart(6) +
        `${s.media >= 0 ? '+' : ''}${s.media.toFixed(3)}`.padStart(9) +
        s.t.toFixed(1).padStart(6) +
        `${a1.media >= 0 ? '+' : ''}${a1.media.toFixed(3)}`.padStart(12) +
        `${a2.media >= 0 ? '+' : ''}${a2.media.toFixed(3)}`.padStart(12) +
        (todas.length / anos).toFixed(0).padStart(7),
    );
  }
}

// ── O teste que decide: o que o filtro DEITA FORA é mesmo pior? ──────────────
// Um filtro que "melhora" tirando operações ao acaso não melhora nada: o que
// sobra tem de ser melhor E o que sai tem de ser pior. Se as descartadas também
// são positivas, o filtro só está a cortar frequência.
console.log('\n══ o que cada filtro DESCARTA (o teste que decide) ══');
console.log('filtro'.padEnd(30) + 'fica n'.padStart(8) + 'fica R'.padStart(9) + 'sai n'.padStart(8) + 'sai R'.padStart(9) + 'diferença'.padStart(11));
for (const [nome, f] of FILTROS.slice(1)) {
  const dentro = [];
  const fora = [];
  for (const [par, custo] of PARES) {
    const v = velas4h(par);
    const todas = operacoes(v, custo, null, 60);
    const passam = new Set(operacoes(v, custo, f, 60).map((o) => o.t));
    for (const o of todas) (passam.has(o.t) ? dentro : fora).push(o);
  }
  if (fora.length < 10) { console.log(nome.padEnd(30) + '  (descarta quase nada)'); continue; }
  const a = st(dentro.map((o) => o.r));
  const b = st(fora.map((o) => o.r));
  console.log(
    nome.padEnd(30) + String(a.n).padStart(8) + `${a.media >= 0 ? '+' : ''}${a.media.toFixed(3)}`.padStart(9) +
      String(b.n).padStart(8) + `${b.media >= 0 ? '+' : ''}${b.media.toFixed(3)}`.padStart(9) +
      `${a.media - b.media >= 0 ? '+' : ''}${(a.media - b.media).toFixed(3)}`.padStart(11),
  );
}
