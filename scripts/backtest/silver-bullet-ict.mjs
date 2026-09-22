/**
 * Silver Bullet (ICT) — o único modelo com nome da lista que ainda não tinha
 * sido medido neste projecto.
 *
 * A REGRA, como é ensinada:
 *   janela      10:00–11:00 de Nova Iorque (a "killzone")
 *   sinal       forma-se um desequilíbrio (FVG) dentro dessa hora
 *   entrada     o preço volta ao FVG
 *   stop        do outro lado do FVG
 *   alvo        a liquidez mais próxima (máxima/mínima anterior), ou 2R
 *
 * CONTROLOS, porque o nome da hora não é evidência:
 *   - a mesma regra em OUTRAS horas do dia. Se a killzone tem algo de especial,
 *     a hora certa tem de bater as erradas.
 *   - com e sem filtro de tendência de 4h.
 *
 * ── O QUE DEU (22/09/2026) ─────────────────────────────────────────────────
 *
 * Em 15m, com custo: −0,03R a −0,07R. SEM custo: +0,103R (t=8,9) com o alvo na
 * liquidez, em 9304 operações — e a hora da killzone bate todas as outras (a
 * pior, 16h de NY, dá −0,017R sem custo e −0,269R com). A ideia TEM conteúdo;
 * o que a mata é o stop colado ao FVG em 15m, onde o spread come mais do que a
 * vantagem vale.
 *
 * Em 1h, onde o spread pesa menos por R: +0,028R (t=1,4), positivo nas duas
 * metades, 1411 operações, 5 dos 7 instrumentos positivos. Abaixo da barra do
 * projecto (t≥1,5) e, sobretudo, NEGATIVO com o spread a dobrar (−0,051R).
 * Não entrou.
 *
 * Uso: node scripts/backtest/silver-bullet-ict.mjs   (TF=1h para velas de 1h)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/';
const DIR = (process.env.HISTDATA ?? RAIZ + 'data/backtest/histdata') + '/';
const DIA = 86_400_000;
const HORA = 3_600_000;
const M15 = 900_000;
const CORTE = Date.UTC(2020, 0, 1);

/**
 * CUSTO=0.7 mede com 70% do spread assumido — é assim que se responde à
 * pergunta "e numa conta raw?" sem adivinhar os números da corretora.
 */
const CUSTO_MULT = Number(process.env.CUSTO ?? 1);

const PARES = [
  ['EURUSD', 0.00012], ['GBPUSD', 0.00018], ['USDJPY', 0.012], ['GBPJPY', 0.03],
  ['XAUUSD', 0.35], ['AUDUSD', 0.0002], ['EURJPY', 0.018],
  // Estes dois não participaram na primeira medição: servem de controlo.
  ['EURGBP', 0.00022], ['NZDUSD', 0.0003],
];

/** Nova Iorque é UTC−5, ou UTC−4 no horário de verão (2.º domingo de março a 1.º de novembro). */
function horaNovaIorque(t) {
  const d = new Date(t);
  const ano = d.getUTCFullYear();
  const marco = new Date(Date.UTC(ano, 2, 1));
  const inicio = Date.UTC(ano, 2, 1 + ((7 - marco.getUTCDay() + 7) % 7) + 7, 7); // 2.º domingo, 02:00 EST
  const nov = new Date(Date.UTC(ano, 10, 1));
  const fim = Date.UTC(ano, 10, 1 + ((7 - nov.getUTCDay() + 7) % 7), 6); // 1.º domingo, 02:00 EDT
  const verao = t >= inicio && t < fim;
  return (d.getUTCHours() - (verao ? 4 : 5) + 24) % 24;
}

/** TF=1h agrega as velas: o mesmo FVG em velas maiores paga MENOS spread por R. */
const TF = process.env.TF ?? '15m';
function ler(par) {
  let v = JSON.parse(readFileSync(`${DIR}${par}_15m.json`, 'utf8'));
  if (TF === '1h') {
    const out = [];
    for (const c of v) {
      const k = c.time - (c.time % HORA);
      const u = out[out.length - 1];
      if (u && u.time === k) { u.high = Math.max(u.high, c.high); u.low = Math.min(u.low, c.low); u.close = c.close; }
      else out.push({ time: k, open: c.open, high: c.high, low: c.low, close: c.close });
    }
    v = out;
  }
  return v.filter((c) => {
    const d = new Date(c.time).getUTCDay();
    return d !== 0 && d !== 6;
  });
}

function atrSerie(v, p = 14) {
  const a = new Float64Array(v.length);
  let x = 0;
  for (let i = 0; i < v.length; i++) {
    const tr = i === 0 ? v[i].high - v[i].low
      : Math.max(v[i].high - v[i].low, Math.abs(v[i].high - v[i - 1].close), Math.abs(v[i].low - v[i - 1].close));
    x = i < p ? (x * i + tr) / (i + 1) : (x * (p - 1) + tr) / p;
    a[i] = x;
  }
  return a;
}

/** Sentido da tendência de 4h (EMA 50 vs 200) em vigor a cada instante. */
function tendencia4h(v) {
  const passo = 4 * HORA;
  const h4 = [];
  for (const c of v) {
    const k = c.time - (c.time % passo);
    const u = h4[h4.length - 1];
    if (u && u.time === k) { u.high = Math.max(u.high, c.high); u.low = Math.min(u.low, c.low); u.close = c.close; }
    else h4.push({ time: k, high: c.high, low: c.low, close: c.close });
  }
  let e50 = h4[0]?.close ?? 0, e200 = e50;
  const m = new Map();
  for (const c of h4) {
    e50 += (2 / 51) * (c.close - e50);
    e200 += (2 / 201) * (c.close - e200);
    m.set(c.time + passo, e50 > e200 ? 1 : -1);
  }
  return (t) => {
    for (let k = t - (t % (4 * HORA)); k > t - 3 * DIA; k -= 4 * HORA) {
      const s = m.get(k);
      if (s !== undefined) return s;
    }
    return 0;
  };
}

function st(rs) {
  const n = rs.length;
  if (n < 3) return { n, media: 0, t: 0, acerto: 0 };
  const m = rs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rs.reduce((a, r) => a + (r - m) ** 2, 0) / (n - 1));
  return { n, media: m, t: m / (sd / Math.sqrt(n)), acerto: rs.filter((r) => r > 0).length / n };
}

/**
 * @param horaAlvo hora de Nova Iorque em que a janela de uma hora começa
 * @param alvo '2R' ou 'liquidez'
 * @param comTendencia só a favor da tendência de 4h
 */
function operacoes(v, atr, sentido, custo, { horaAlvo = 10, alvo = '2R', comTendencia = false, stopMinAtr = 0 } = {}) {
  const ops = [];
  for (let i = 2; i < v.length - 1; i++) {
    const h = horaNovaIorque(v[i].time);
    if (h !== horaAlvo) continue;
    // FVG de três velas: o corpo da vela i não toca o da i−2.
    const altaFvg = v[i].low > v[i - 2].high;
    const baixaFvg = v[i].high < v[i - 2].low;
    if (!altaFvg && !baixaFvg) continue;
    const lado = altaFvg ? 1 : -1;
    if (comTendencia && sentido(v[i].time) !== lado) continue;

    const topo = lado > 0 ? v[i].low : v[i - 2].low;
    const base = lado > 0 ? v[i - 2].high : v[i].high;
    const entrada = lado > 0 ? topo : base; // borda do FVG onde o preço regressa
    const extremo = lado > 0 ? Math.min(v[i].low, v[i - 1].low, v[i - 2].low) : Math.max(v[i].high, v[i - 1].high, v[i - 2].high);
    const a = atr[i];
    if (!(a > 0)) continue;
    const bruto = lado > 0 ? extremo - 0.1 * a : extremo + 0.1 * a;
    // O stop colado ao FVG é o que mata a ideia: em 15m o spread chega a comer
    // 13% de R. Alargar o stop baixa o custo EM R, ao preço de arriscar mais.
    const risco = Math.max(Math.abs(entrada - bruto), stopMinAtr * a);
    const stop = entrada - lado * risco;
    if (!(risco > 0)) continue;

    // Liquidez: extremo das 24 velas anteriores (6 horas) do lado do movimento.
    let liq = lado > 0 ? -Infinity : Infinity;
    for (let k = Math.max(0, i - (TF === '1h' ? 6 : 24)); k < i; k++) liq = lado > 0 ? Math.max(liq, v[k].high) : Math.min(liq, v[k].low);
    const precoAlvo = alvo === '2R' ? entrada + lado * 2 * risco : liq;
    const rAlvo = ((precoAlvo - entrada) * lado) / risco;
    if (!(rAlvo > 0.5)) continue;

    // Entrada: o preço tem de voltar ao FVG nas 8 velas seguintes (2 horas).
    let iEnt = -1;
    for (let k = i + 1; k <= Math.min(i + (TF === '1h' ? 3 : 8), v.length - 1); k++) {
      if (lado > 0 ? v[k].low <= entrada : v[k].high >= entrada) { iEnt = k; break; }
    }
    if (iEnt < 0) continue;

    // Gestão até ao fim do dia de Nova Iorque (16:00).
    let r = null;
    for (let k = iEnt; k < v.length; k++) {
      const contra = lado > 0 ? (entrada - v[k].low) / risco : (v[k].high - entrada) / risco;
      const aFavor = lado > 0 ? (v[k].high - entrada) / risco : (entrada - v[k].low) / risco;
      if (k > iEnt && contra >= 1) { r = -1; break; }
      if (aFavor >= rAlvo) { r = rAlvo; break; }
      if (horaNovaIorque(v[k].time) >= 16 || v[k].time - v[iEnt].time > 12 * HORA) {
        r = ((v[k].close - entrada) * lado) / risco;
        break;
      }
    }
    if (r === null) continue;
    ops.push({ t: v[i].time, r: r - custo / risco });
  }
  return ops;
}

/** PARES=XAUUSD,AUDUSD limita a medição a esses instrumentos. */
const SO_ESTES = process.env.PARES ? new Set(process.env.PARES.split(',')) : null;
const dados = new Map();
for (const [par, custo] of PARES) {
  if (SO_ESTES && !SO_ESTES.has(par)) continue;
  try {
    const v = ler(par);
    dados.set(par, { v, atr: atrSerie(v), sentido: tendencia4h(v), custo });
  } catch { /* sem dados de 15m para este par */ }
}
console.log(`Silver Bullet · ${TF} · ${dados.size} instrumentos · FVG na janela + regresso ao FVG\n`);

function mede(rot, cfg) {
  const todas = [];
  for (const [, d] of dados) todas.push(...operacoes(d.v, d.atr, d.sentido, d.custo * CUSTO_MULT, cfg));
  if (todas.length < 20) { console.log(rot.padEnd(32) + `${todas.length} operações (poucas)`); return; }
  todas.sort((a, b) => a.t - b.t);
  const s = st(todas.map((o) => o.r));
  const a = st(todas.filter((o) => o.t < CORTE).map((o) => o.r));
  const b = st(todas.filter((o) => o.t >= CORTE).map((o) => o.r));
  const passa = a.media > 0 && b.media > 0 && s.t >= 1.5;
  console.log(
    ((passa ? '✅ ' : '   ') + rot).padEnd(32) + String(s.n).padStart(6) +
      `${(100 * s.acerto).toFixed(0)}%`.padStart(6) +
      `${s.media >= 0 ? '+' : ''}${s.media.toFixed(3)}R`.padStart(10) +
      `t=${s.t.toFixed(1)}`.padStart(8) +
      `${a.media >= 0 ? '+' : ''}${a.media.toFixed(3)}`.padStart(9) +
      `${b.media >= 0 ? '+' : ''}${b.media.toFixed(3)}`.padStart(9),
  );
}

console.log('variante'.padEnd(32) + 'n'.padStart(6) + 'acerto'.padStart(6) + 'R/op'.padStart(10) + 't'.padStart(8) + 'até2019'.padStart(9) + '2020+'.padStart(9));
mede('10h NY, alvo 2R', { horaAlvo: 10, alvo: '2R' });
mede('10h NY, alvo liquidez', { horaAlvo: 10, alvo: 'liquidez' });
mede('10h NY, 2R, com tendência', { horaAlvo: 10, alvo: '2R', comTendencia: true });
mede('10h NY, liquidez, tendência', { horaAlvo: 10, alvo: 'liquidez', comTendencia: true });

console.log('\n── controlo: a MESMA regra noutras horas (a killzone é especial?) ──');
for (const h of [2, 3, 6, 8, 9, 11, 12, 14, 16, 20]) mede(`${String(h).padStart(2)}h NY, alvo 2R`, { horaAlvo: h, alvo: '2R' });

// ── Quanto disto é o spread? Sem custo nenhum, a ideia teria valor? ──────────
console.log('\n── a mesma regra SEM custo nenhum (o mundo ideal que não existe) ──');
function medeSemCusto(rot, cfg) {
  const todas = [];
  for (const [, d] of dados) todas.push(...operacoes(d.v, d.atr, d.sentido, 0, cfg));
  if (todas.length < 20) return;
  todas.sort((a, b) => a.t - b.t);
  const s = st(todas.map((o) => o.r));
  console.log(rot.padEnd(32) + String(s.n).padStart(6) + `${(100*s.acerto).toFixed(0)}%`.padStart(6) +
    `${s.media >= 0 ? '+' : ''}${s.media.toFixed(3)}R`.padStart(10) + `t=${s.t.toFixed(1)}`.padStart(8));
}
medeSemCusto('10h NY, alvo 2R', { horaAlvo: 10, alvo: '2R' });
medeSemCusto('10h NY, alvo liquidez', { horaAlvo: 10, alvo: 'liquidez' });
medeSemCusto('10h NY, liquidez, tendência', { horaAlvo: 10, alvo: 'liquidez', comTendencia: true });
medeSemCusto('16h NY (a pior hora)', { horaAlvo: 16, alvo: '2R' });


// ── O stop apertado é o problema. E se for mais largo? ──────────────────────
console.log('');
console.log('── com stop mínimo (baixa o custo em R, aumenta o risco) ──');
console.log('variante'.padEnd(32) + 'n'.padStart(6) + 'acerto'.padStart(6) + 'R/op'.padStart(10) + 't'.padStart(8) + 'até2019'.padStart(9) + '2020+'.padStart(9));
for (const smin of [0.5, 1, 1.5, 2]) {
  mede(`liquidez+tend, stop ${smin} ATR`, { horaAlvo: 10, alvo: 'liquidez', comTendencia: true, stopMinAtr: smin });
}
for (const smin of [1, 1.5, 2]) {
  mede(`liquidez, stop ${smin} ATR`, { horaAlvo: 10, alvo: 'liquidez', stopMinAtr: smin });
}
for (const smin of [1, 1.5]) {
  mede(`2R, stop ${smin} ATR`, { horaAlvo: 10, alvo: '2R', stopMinAtr: smin });
}

console.log('');
console.log('── por instrumento (10h NY, alvo na liquidez) ──');
for (const [par, d] of dados) {
  const o = operacoes(d.v, d.atr, d.sentido, d.custo * CUSTO_MULT, { horaAlvo: 10, alvo: 'liquidez' });
  if (o.length < 20) continue;
  const s = st(o.map((x) => x.r));
  const a = st(o.filter((x) => x.t < CORTE).map((x) => x.r));
  const b = st(o.filter((x) => x.t >= CORTE).map((x) => x.r));
  console.log(par.padEnd(10) + String(s.n).padStart(6) + `${(100*s.acerto).toFixed(0)}%`.padStart(6) +
    `${s.media>=0?'+':''}${s.media.toFixed(3)}R`.padStart(10) + `t=${s.t.toFixed(1)}`.padStart(8) +
    `${a.media>=0?'+':''}${a.media.toFixed(3)}`.padStart(9) + `${b.media>=0?'+':''}${b.media.toFixed(3)}`.padStart(9));
}
console.log('');
console.log('── e com o spread a dobrar (10h NY, liquidez, todos) ──');
{
  const todas = [];
  for (const [, d] of dados) todas.push(...operacoes(d.v, d.atr, d.sentido, d.custo * 2, { horaAlvo: 10, alvo: 'liquidez' }));
  const s = st(todas.map((o) => o.r));
  console.log('custo ×2'.padEnd(10) + String(s.n).padStart(6) + `${(100*s.acerto).toFixed(0)}%`.padStart(6) +
    `${s.media>=0?'+':''}${s.media.toFixed(3)}R`.padStart(10) + `t=${s.t.toFixed(1)}`.padStart(8));
}
