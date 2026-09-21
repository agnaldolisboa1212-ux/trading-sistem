/**
 * FASE 2 — que CONDIÇÃO DE ENTRADA bate o jogo justo.
 *
 * A fase 1b mostrou que, sem regra, o mercado é quase um jogo justo a 1h–4h e
 * que o custo é o que mata: com stop de 0,5 ATR em 1h, o spread come 0,22R a
 * 0,53R por operação. Daí as escolhas fixas aqui:
 *
 *   stop 1,5 ATR   → o custo cai para ~4% de R nos índices e ~7% no forex
 *   horizonte 24h  → day trade: a operação morre no fim do dia seguinte
 *
 * Varre-se cada família de entrada contra cada alvo, agregando por GRUPO de
 * mercados (não por mercado) para não escolher o vencedor no ruído de um só.
 * Cada família é medida em duas metades: até jun/2024 e depois.
 *
 * Uso: node familias.mjs [horizonte-horas] [stop-em-ATR]
 */
import { readFileSync } from 'node:fs';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/';
// Velas de 1 minuto da HistData agregadas em 1h. HISTDATA=<pasta> muda o sítio.
const DIR = (process.env.HISTDATA ?? RAIZ + 'data/backtest/histdata') + '/';
const HORA = 3_600_000;
const HORIZONTE_H = Number(process.argv[2] ?? 24);
const STOP_ATR = Number(process.argv[3] ?? 1.5);
const CORTE = Date.UTC(2024, 6, 1);
const KS = [1.5, 2, 3];

const MERCADOS = [
  ['GER30', 'GRXEUR', 2, 'índices'],
  ['UK100', 'UKXGBP', 2, 'índices'],
  ['FRA40', 'FRXEUR', 2, 'índices'],
  ['JP225', 'JPXJPY', 12, 'índices'],
  ['SP500', 'SPXUSD', 0.6, 'índices'],
  ['US100', 'NSXUSD', 1.8, 'índices'],
  ['EURUSD', 'EURUSD', 0.00012, 'forex'],
  ['GBPUSD', 'GBPUSD', 0.00018, 'forex'],
  ['GBPJPY', 'GBPJPY', 0.03, 'forex'],
  ['USDJPY', 'USDJPY', 0.012, 'forex'],
  ['XAUUSD', 'XAUUSD', 0.35, 'metais'],
  ['XAGUSD', 'XAGUSD', 0.03, 'metais'],
];

function velas(ficheiro, horas) {
  const v = JSON.parse(readFileSync(`${DIR}${ficheiro}_1h.json`, 'utf8'));
  if (horas === 1) return v;
  const passo = horas * HORA;
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

function indicadores(v) {
  const n = v.length;
  const atr = new Float64Array(n);
  const atrMedio = new Float64Array(n);
  const ema20 = new Float64Array(n);
  const ema50 = new Float64Array(n);
  const ema200 = new Float64Array(n);
  const rsi2 = new Float64Array(n);
  const max10 = new Float64Array(n);
  const max20 = new Float64Array(n);
  const max50 = new Float64Array(n);
  const min10 = new Float64Array(n);
  const min20 = new Float64Array(n);
  const min50 = new Float64Array(n);
  const desvio20 = new Float64Array(n);
  let a = 0;
  let g = 0;
  let p = 0;
  let somaAtr = 0;
  let soma = 0;
  let soma2 = 0;
  for (let i = 0; i < n; i++) {
    const tr =
      i === 0
        ? v[i].high - v[i].low
        : Math.max(v[i].high - v[i].low, Math.abs(v[i].high - v[i - 1].close), Math.abs(v[i].low - v[i - 1].close));
    a = i < 14 ? (a * i + tr) / (i + 1) : (a * 13 + tr) / 14;
    atr[i] = a;
    somaAtr += a;
    if (i >= 50) somaAtr -= atr[i - 50];
    atrMedio[i] = somaAtr / Math.min(50, i + 1);
    const c = v[i].close;
    ema20[i] = i === 0 ? c : ema20[i - 1] + (2 / 21) * (c - ema20[i - 1]);
    ema50[i] = i === 0 ? c : ema50[i - 1] + (2 / 51) * (c - ema50[i - 1]);
    ema200[i] = i === 0 ? c : ema200[i - 1] + (2 / 201) * (c - ema200[i - 1]);
    const d = i === 0 ? 0 : c - v[i - 1].close;
    g = i < 2 ? Math.max(d, 0) : (g + Math.max(d, 0)) / 2;
    p = i < 2 ? Math.max(-d, 0) : (p + Math.max(-d, 0)) / 2;
    rsi2[i] = p === 0 ? 100 : 100 - 100 / (1 + g / p);
    soma += c;
    soma2 += c * c;
    if (i >= 20) {
      soma -= v[i - 20].close;
      soma2 -= v[i - 20].close * v[i - 20].close;
    }
    const cnt = Math.min(20, i + 1);
    const m = soma / cnt;
    desvio20[i] = Math.sqrt(Math.max(0, soma2 / cnt - m * m));
  }
  // Máximos e mínimos das N velas ANTERIORES, em janela deslizante.
  const janela = (N, alvoMax, alvoMin) => {
    for (let i = 0; i < n; i++) {
      let hi = -Infinity;
      let lo = Infinity;
      for (let k = Math.max(0, i - N); k < i; k++) {
        if (v[k].high > hi) hi = v[k].high;
        if (v[k].low < lo) lo = v[k].low;
      }
      alvoMax[i] = hi;
      alvoMin[i] = lo;
    }
  };
  janela(10, max10, min10);
  janela(20, max20, min20);
  janela(50, max50, min50);
  return { atr, atrMedio, ema20, ema50, ema200, rsi2, max10, max20, max50, min10, min20, min50, desvio20 };
}

/** Família → lado (+1 compra, −1 venda, 0 nenhum) na vela i. */
const FAMILIAS = {
  'rompe-20': (v, x, i) => (v[i].close > x.max20[i] ? 1 : v[i].close < x.min20[i] ? -1 : 0),
  'rompe-50': (v, x, i) => (v[i].close > x.max50[i] ? 1 : v[i].close < x.min50[i] ? -1 : 0),
  'rompe-20-tend': (v, x, i) => {
    const t = x.ema50[i] > x.ema200[i] ? 1 : x.ema50[i] < x.ema200[i] ? -1 : 0;
    const r = v[i].close > x.max20[i] ? 1 : v[i].close < x.min20[i] ? -1 : 0;
    return r !== 0 && r === t ? r : 0;
  },
  'rompe-20-so-compra': (v, x, i) =>
    x.ema50[i] > x.ema200[i] && v[i].close > x.max20[i] ? 1 : 0,
  'recuo-tend': (v, x, i) => {
    if (x.ema50[i] > x.ema200[i] && v[i].close < x.ema20[i] && v[i - 1].close >= x.ema20[i - 1]) return 1;
    if (x.ema50[i] < x.ema200[i] && v[i].close > x.ema20[i] && v[i - 1].close <= x.ema20[i - 1]) return -1;
    return 0;
  },
  'rsi2-tend': (v, x, i) => {
    if (x.ema50[i] > x.ema200[i] && x.rsi2[i] < 10) return 1;
    if (x.ema50[i] < x.ema200[i] && x.rsi2[i] > 90) return -1;
    return 0;
  },
  'reversao-2sigma': (v, x, i) => {
    const m = x.ema20[i];
    if (v[i].close < m - 2 * x.desvio20[i]) return 1;
    if (v[i].close > m + 2 * x.desvio20[i]) return -1;
    return 0;
  },
  'compressao-rompe': (v, x, i) => {
    if (!(x.atr[i] < 0.7 * x.atrMedio[i])) return 0;
    return v[i].close > x.max10[i] ? 1 : v[i].close < x.min10[i] ? -1 : 0;
  },
  'engolfo-tend': (v, x, i) => {
    const corpo = Math.abs(v[i].close - v[i].open);
    const anterior = Math.abs(v[i - 1].close - v[i - 1].open);
    if (!(corpo > anterior && corpo > 0.5 * x.atr[i])) return 0;
    if (x.ema50[i] > x.ema200[i] && v[i].close > v[i].open && v[i - 1].close < v[i - 1].open) return 1;
    if (x.ema50[i] < x.ema200[i] && v[i].close < v[i].open && v[i - 1].close > v[i - 1].open) return -1;
    return 0;
  },
};

const acc = new Map();

for (const horas of [1, 2, 4]) {
  const H = Math.max(1, Math.round(HORIZONTE_H / horas));
  for (const [nome, ficheiro, custo, grupo] of MERCADOS) {
    let v;
    try {
      v = velas(ficheiro, horas);
    } catch {
      continue;
    }
    if (v.length < 500) continue;
    const x = indicadores(v);
    const anos = (v[v.length - 1].time - v[0].time) / (365.25 * 24 * HORA);
    for (const [fam, regra] of Object.entries(FAMILIAS)) {
      const livrePorK = KS.map(() => -1);
      for (let i = 210; i < v.length - 1; i++) {
        const lado = regra(v, x, i);
        if (lado === 0) continue;
        const e = v[i].close;
        const risco = STOP_ATR * x.atr[i];
        if (!(risco > 0)) continue;
        const custoR = custo / risco;
        for (let ki = 0; ki < KS.length; ki++) {
          if (i <= livrePorK[ki]) continue;
          const k = KS[ki];
          let r = null;
          let j = i + 1;
          for (; j <= Math.min(i + H, v.length - 1); j++) {
            const aFavor = lado > 0 ? (v[j].high - e) / risco : (e - v[j].low) / risco;
            const contra = lado > 0 ? (e - v[j].low) / risco : (v[j].high - e) / risco;
            if (contra >= 1) {
              r = -1;
              break;
            }
            if (aFavor >= k) {
              r = k;
              break;
            }
          }
          livrePorK[ki] = j;
          if (r === null) {
            const fim = v[Math.min(i + H, v.length - 1)].close;
            r = (lado > 0 ? fim - e : e - fim) / risco;
          }
          const ch = `${horas}|${fam}|${grupo}|${k}`;
          if (!acc.has(ch)) acc.set(ch, { antes: [], depois: [], anos: 0 });
          const c = acc.get(ch);
          (v[i].time < CORTE ? c.antes : c.depois).push(r - custoR);
          c.anos = Math.max(c.anos, anos);
        }
      }
    }
  }
}

function st(rs) {
  const n = rs.length;
  if (n < 3) return { n, media: 0, t: 0, acerto: 0 };
  const m = rs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rs.reduce((a, r) => a + (r - m) ** 2, 0) / (n - 1));
  return { n, media: m, t: m / (sd / Math.sqrt(n)), acerto: rs.filter((r) => r > 0).length / n };
}

console.log(`horizonte ${HORIZONTE_H}h · stop ${STOP_ATR} ATR · custo incluído · metades: até jun/2024 | depois`);
const linhas = [];
for (const [ch, c] of acc) {
  const [horas, fam, grupo, k] = ch.split('|');
  const tudo = st([...c.antes, ...c.depois]);
  const a = st(c.antes);
  const b = st(c.depois);
  if (tudo.n < 40) continue;
  linhas.push({
    rotulo: `${horas}h ${fam.padEnd(19)} ${grupo.padEnd(8)} ${k}R`,
    tudo,
    a,
    b,
    porSemana: tudo.n / (c.anos * 52),
    passa: a.media > 0 && b.media > 0 && tudo.t >= 1.5,
  });
}
linhas.sort((x, y) => y.tudo.media - x.tudo.media);
const mostrar = (l) =>
  `${l.passa ? '✅' : '  '} ${l.rotulo.padEnd(42)} n=${String(l.tudo.n).padStart(4)} ` +
  `${(100 * l.tudo.acerto).toFixed(0).padStart(3)}% ${l.tudo.media >= 0 ? '+' : ''}${l.tudo.media.toFixed(3)}R ` +
  `t=${l.tudo.t.toFixed(1).padStart(5)} | ${l.a.media >= 0 ? '+' : ''}${l.a.media.toFixed(3)} | ` +
  `${l.b.media >= 0 ? '+' : ''}${l.b.media.toFixed(3)} | ${l.porSemana.toFixed(1)}/sem`;

console.log('\n── 20 melhores por R/operação ──');
for (const l of linhas.slice(0, 20)) console.log(mostrar(l));
console.log('\n── Passam nas DUAS metades com t≥1,5 ──');
const passam = linhas.filter((l) => l.passa).sort((x, y) => y.porSemana - x.porSemana);
for (const l of passam) console.log(mostrar(l));
if (passam.length === 0) console.log('(nenhuma)');
