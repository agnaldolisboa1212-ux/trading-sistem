/**
 * Power of 3 (AMD) em 15 minutos — acumulação, manipulação, distribuição.
 *
 * ── COMO SE TRADUZ A IDEIA EM REGRA MEDÍVEL ────────────────────────────────
 *
 *   Acumulação   o intervalo da sessão asiática (00:00–06:00 UTC): máxima e
 *                mínima com o mercado parado.
 *   Manipulação  durante Londres (07:00–12:00 UTC), o preço VARRE um dos lados
 *                desse intervalo — passa por cima da máxima (ou por baixo da
 *                mínima) — e volta para dentro. É a liquidez a ser apanhada.
 *   Distribuição entra-se CONTRA a varredura quando o preço fecha de volta
 *                dentro do intervalo, com o alvo do outro lado.
 *
 * ── OS FILTROS DE SINAL FALSO (o que o Agnaldo pediu) ──────────────────────
 *
 * Uma varredura que não volta não é manipulação: é rompimento. Cada filtro
 * abaixo é medido ligado e desligado, para se ver o que cada um VALE:
 *
 *   volta      a vela que volta tem de FECHAR dentro do intervalo (sempre)
 *   corpo      essa vela tem de ter corpo ≥ X ATR — mostra intenção
 *   so-pavio   a varredura não pode ter FECHADO fora (fecho fora = rompimento)
 *   fvg        o regresso tem de deixar um desequilíbrio (fair value gap)
 *   calmo      o intervalo asiático tem de ser estreito (≤ X ATR): acumulação
 *              a sério, não um dia de tendência
 *   htf        só a favor da tendência de 4h (EMA 50 sobre EMA 200)
 *
 * Saída: alvo no lado oposto do intervalo, ou a 2R/3R; stop do outro lado da
 * varredura. Se nada acontecer, fecha às 20:00 UTC — day trade.
 *
 * ── O QUE DEU (22/09/2026) ─────────────────────────────────────────────────
 *
 * Cinco pares (EURUSD, GBPUSD, USDJPY, GBPJPY, XAUUSD), 2016–2026, 8476
 * operações: NEGATIVO em todas as combinações de filtros, alvos e tamanhos de
 * stop, e nas duas metades. A melhor (com FVG) fica em −0,062R. O filtro de
 * FVG faz o que deve — leva de −0,17R para −0,06R, cortando as varreduras que
 * não eram manipulação — mas não cria vantagem onde não há. Operar A FAVOR da
 * varredura também perde. Não entrou no sistema.
 *
 * Uso: node power-of-3.mjs [alvo]   (alvo: 'oposto', '1', '2', '3')
 *      STOP_MIN=1 node ...          (stop mínimo em ATR)
 *      SENTIDO=a-favor node ...     (controlo: seguir a varredura)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/';
// Velas de 1 minuto da HistData agregadas em 15m. HISTDATA=<pasta> muda o sítio.
const DIR = (process.env.HISTDATA ?? RAIZ + 'data/backtest/histdata') + '/';
const DIA = 86_400_000;
const HORA = 3_600_000;
const M15 = 900_000;
const CORTE = Date.UTC(2022, 0, 1); // metade 1: até 2021 · metade 2: 2022+

const PARES = [
  ['EURUSD', 0.00012],
  ['GBPUSD', 0.00018],
  ['USDJPY', 0.012],
  ['GBPJPY', 0.03],
  ['XAUUSD', 0.35],
];

const ASIA = [0, 6 * HORA];
const LONDRES = [7 * HORA, 12 * HORA];
const FECHO_DIA = 20 * HORA;

function ler(par) {
  const v = JSON.parse(readFileSync(`${DIR}${par}_15m.json`, 'utf8'));
  return v.filter((c) => {
    const d = new Date(c.time).getUTCDay();
    return d !== 0 && d !== 6;
  });
}

function atrSerie(v, periodo = 14) {
  const a = new Float64Array(v.length);
  let x = 0;
  for (let i = 0; i < v.length; i++) {
    const tr =
      i === 0
        ? v[i].high - v[i].low
        : Math.max(v[i].high - v[i].low, Math.abs(v[i].high - v[i - 1].close), Math.abs(v[i].low - v[i - 1].close));
    x = i < periodo ? (x * i + tr) / (i + 1) : (x * (periodo - 1) + tr) / periodo;
    a[i] = x;
  }
  return a;
}

/** EMA 50 e 200 de 4h, para o filtro de tendência — só com velas já fechadas. */
function tendencia4h(v) {
  const passo = 4 * HORA;
  const h4 = [];
  for (const c of v) {
    const k = c.time - (c.time % passo);
    const u = h4[h4.length - 1];
    if (u && u.time === k) {
      u.high = Math.max(u.high, c.high);
      u.low = Math.min(u.low, c.low);
      u.close = c.close;
    } else h4.push({ time: k, high: c.high, low: c.low, close: c.close });
  }
  let e50 = h4[0]?.close ?? 0;
  let e200 = e50;
  const sentido = new Map();
  for (const c of h4) {
    e50 += (2 / 51) * (c.close - e50);
    e200 += (2 / 201) * (c.close - e200);
    // vale para as velas DEPOIS desta fechar
    sentido.set(c.time + passo, e50 > e200 ? 1 : -1);
  }
  return sentido;
}

/** O sentido de 4h em vigor no instante t (o último fecho de 4h antes de t). */
function sentidoEm(sentido, t) {
  const passo = 4 * HORA;
  for (let k = t - (t % passo); k > t - 3 * DIA; k -= passo) {
    const s = sentido.get(k);
    if (s !== undefined) return s;
  }
  return 0;
}

function st(rs) {
  const n = rs.length;
  if (n < 3) return { n, media: 0, t: 0, acerto: 0 };
  const m = rs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rs.reduce((a, r) => a + (r - m) ** 2, 0) / (n - 1));
  return { n, media: m, t: m / (sd / Math.sqrt(n)), acerto: rs.filter((r) => r > 0).length / n };
}

const ALVO = process.argv[2] ?? 'oposto';
/** Stop mínimo em ATR: com o stop colado à varredura, o spread come ~15% de R. */
const STOP_MIN_ATR = Number(process.env.STOP_MIN ?? 0);
/** SENTIDO=contra (o AMD clássico) ou =a-favor (controlo: seguir a varredura). */
const SENTIDO = process.env.SENTIDO ?? 'contra';

/**
 * Corre o AMD num par com uma combinação de filtros.
 * Devolve as operações: { t, r, par }.
 */
function correr(v, atr, sentido, custo, filtros) {
  const ops = [];
  // índice por dia
  const porDia = new Map();
  for (let i = 0; i < v.length; i++) {
    const d = Math.floor(v[i].time / DIA) * DIA;
    if (!porDia.has(d)) porDia.set(d, []);
    porDia.get(d).push(i);
  }
  for (const [dia, idx] of porDia) {
    // 1. ACUMULAÇÃO: intervalo asiático
    const asia = idx.filter((i) => v[i].time - dia >= ASIA[0] && v[i].time - dia < ASIA[1]);
    if (asia.length < 16) continue;
    let hi = -Infinity;
    let lo = Infinity;
    for (const i of asia) {
      hi = Math.max(hi, v[i].high);
      lo = Math.min(lo, v[i].low);
    }
    const faixa = hi - lo;
    const aRef = atr[asia[asia.length - 1]];
    if (!(faixa > 0) || !(aRef > 0)) continue;
    if (filtros.calmo && faixa > filtros.calmo * aRef) continue;

    // 2. MANIPULAÇÃO: primeira varredura durante Londres
    const londres = idx.filter((i) => v[i].time - dia >= LONDRES[0] && v[i].time - dia < LONDRES[1]);
    let varreu = 0; // +1 varreu a máxima (procura-se venda), −1 varreu a mínima
    let iVarr = -1;
    for (const i of londres) {
      if (v[i].high > hi) {
        varreu = 1;
        iVarr = i;
        break;
      }
      if (v[i].low < lo) {
        varreu = -1;
        iVarr = i;
        break;
      }
    }
    if (varreu === 0) continue;
    const lado = SENTIDO === 'a-favor' ? varreu : -varreu;
    if (filtros.soPavio) {
      // Fechar fora do intervalo não é manipulação: é rompimento.
      if (varreu > 0 ? v[iVarr].close > hi : v[iVarr].close < lo) continue;
    }

    // 3. DISTRIBUIÇÃO: a vela que fecha de volta dentro do intervalo
    let iEnt = -1;
    let extremo = varreu > 0 ? v[iVarr].high : v[iVarr].low;
    for (let k = iVarr; k < Math.min(iVarr + filtros.velasVolta, v.length); k++) {
      extremo = varreu > 0 ? Math.max(extremo, v[k].high) : Math.min(extremo, v[k].low);
      const dentro = varreu > 0 ? v[k].close < hi : v[k].close > lo;
      if (!dentro) continue;
      if (filtros.corpo) {
        const corpo = Math.abs(v[k].close - v[k].open);
        if (!(corpo >= filtros.corpo * atr[k])) continue;
      }
      if (filtros.fvg && k >= 2) {
        // Desequilíbrio: a vela k−2 e a vela k não se tocam (gap de preço).
        const gap = lado > 0 ? v[k].low > v[k - 2].high : v[k].high < v[k - 2].low;
        if (!gap) continue;
      }
      iEnt = k;
      break;
    }
    if (iEnt < 0) continue;
    if (filtros.htf && sentidoEm(sentido, v[iEnt].time) !== lado) continue;

    // 4. Operação
    const entrada = v[iEnt].close;
    const bruto = lado > 0 ? extremo - 0.1 * atr[iEnt] : extremo + 0.1 * atr[iEnt];
    // Nunca menos do que STOP_MIN ATR: abaixo disso o custo domina o resultado.
    const distancia = Math.max(Math.abs(entrada - bruto), STOP_MIN_ATR * atr[iEnt]);
    const stop = entrada - lado * distancia;
    const risco = distancia;
    if (!(risco > 0)) continue;
    const alvo =
      ALVO === 'oposto'
        ? lado > 0
          ? hi
          : lo
        : entrada + lado * Number(ALVO) * risco;
    const rAlvo = ((alvo - entrada) * lado) / risco;
    if (!(rAlvo > 0.3)) continue; // alvo demasiado perto para valer a pena
    let r = null;
    for (let k = iEnt + 1; k < v.length && v[k].time - dia <= FECHO_DIA; k++) {
      const contra = lado > 0 ? (entrada - v[k].low) / risco : (v[k].high - entrada) / risco;
      const aFavor = lado > 0 ? (v[k].high - entrada) / risco : (entrada - v[k].low) / risco;
      if (contra >= 1) {
        r = -1;
        break;
      }
      if (aFavor >= rAlvo) {
        r = rAlvo;
        break;
      }
      if (v[k].time - dia >= FECHO_DIA - M15) {
        r = ((v[k].close - entrada) * lado) / risco;
        break;
      }
    }
    if (r === null) continue;
    ops.push({ t: v[iEnt].time, r: r - custo / risco, rAlvo });
  }
  return ops;
}

// ---------------------------------------------------------------------------

const dados = new Map();
for (const [par, custo] of PARES) {
  try {
    const v = ler(par);
    dados.set(par, { v, atr: atrSerie(v), sentido: tendencia4h(v), custo });
  } catch {
    console.log(`${par}: sem dados de 15m`);
  }
}
if (dados.size === 0) process.exit(1);
const primeiro = [...dados.values()][0].v;
console.log(
  `Power of 3 · 15m · alvo=${ALVO} · ${dados.size} pares · ` +
    `${new Date(primeiro[0].time).toISOString().slice(0, 10)} a ${new Date(primeiro.at(-1).time).toISOString().slice(0, 10)}\n`,
);

const COMBINACOES = [
  ['nada (só volta ao intervalo)', { velasVolta: 4 }],
  ['+ só pavio', { velasVolta: 4, soPavio: true }],
  ['+ corpo 0,3 ATR', { velasVolta: 4, soPavio: true, corpo: 0.3 }],
  ['+ corpo 0,5 ATR', { velasVolta: 4, soPavio: true, corpo: 0.5 }],
  ['+ FVG', { velasVolta: 4, soPavio: true, fvg: true }],
  ['+ corpo 0,3 + FVG', { velasVolta: 4, soPavio: true, corpo: 0.3, fvg: true }],
  ['+ ásia calma (≤3 ATR)', { velasVolta: 4, soPavio: true, corpo: 0.3, calmo: 3 }],
  ['+ ásia calma + FVG', { velasVolta: 4, soPavio: true, corpo: 0.3, calmo: 3, fvg: true }],
  ['+ tendência 4h', { velasVolta: 4, soPavio: true, corpo: 0.3, htf: true }],
  ['tudo ligado', { velasVolta: 4, soPavio: true, corpo: 0.3, calmo: 3, fvg: true, htf: true }],
  ['volta rápida (2 velas)', { velasVolta: 2, soPavio: true, corpo: 0.3 }],
  ['volta lenta (8 velas)', { velasVolta: 8, soPavio: true, corpo: 0.3 }],
];

console.log(
  'filtros'.padEnd(30) + 'n'.padStart(6) + 'acerto'.padStart(8) + 'R/op'.padStart(9) + 't'.padStart(6) +
    'até2021'.padStart(10) + '2022+'.padStart(9) + '/semana'.padStart(9),
);
for (const [nome, filtros] of COMBINACOES) {
  const todas = [];
  for (const [par, d] of dados) {
    for (const o of correr(d.v, d.atr, d.sentido, d.custo, filtros)) todas.push({ ...o, par });
  }
  if (todas.length < 20) {
    console.log(`${nome.padEnd(30)}${String(todas.length).padStart(6)}  (poucas operações)`);
    continue;
  }
  todas.sort((a, b) => a.t - b.t);
  const s = st(todas.map((o) => o.r));
  const a = st(todas.filter((o) => o.t < CORTE).map((o) => o.r));
  const b = st(todas.filter((o) => o.t >= CORTE).map((o) => o.r));
  const semanas = (todas.at(-1).t - todas[0].t) / (7 * DIA);
  const passa = a.media > 0 && b.media > 0 && s.t >= 1.5;
  console.log(
    `${(passa ? '✅ ' : '   ') + nome}`.padEnd(30) +
      String(s.n).padStart(6) +
      `${(100 * s.acerto).toFixed(0)}%`.padStart(8) +
      `${s.media >= 0 ? '+' : ''}${s.media.toFixed(3)}`.padStart(9) +
      s.t.toFixed(1).padStart(6) +
      `${a.media >= 0 ? '+' : ''}${a.media.toFixed(3)}`.padStart(10) +
      `${b.media >= 0 ? '+' : ''}${b.media.toFixed(3)}`.padStart(9) +
      (todas.length / semanas).toFixed(1).padStart(9),
  );
}
