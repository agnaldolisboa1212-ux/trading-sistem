/**
 * FASE 1 — a geometria do payoff: onde está, matematicamente, o RR alto.
 *
 * Antes de inventar regras, mede-se o que o mercado OFERECE. Entra-se em TODAS
 * as velas (sem regra nenhuma), stop a 1 ATR, e mede-se com que frequência o
 * preço chega a +kR antes de −1R, dentro de um horizonte de day trade.
 *
 * A matemática: num passeio aleatório sem custos, tocar +kR antes de −1R tem
 * probabilidade 1/(1+k). Se o mercado der p > 1/(1+k) depois de custos, há
 * estrutura a explorar — e o k onde a diferença é maior é onde vive o RR alto.
 *
 *   k=1   precisa de 50%      k=2   precisa de 33,3%
 *   k=1,5 precisa de 40%      k=3   precisa de 25%
 *
 * Uso: node geometria.mjs [horas-do-horizonte]
 */
import { readFileSync } from 'node:fs';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/';
// Velas de 1 minuto da HistData agregadas em 1h. HISTDATA=<pasta> muda o sítio.
const DIR = (process.env.HISTDATA ?? RAIZ + 'data/backtest/histdata') + '/';
const HORA = 3_600_000;
const HORIZONTE_H = Number(process.argv[2] ?? 24); // horas de vida da operação
const CORTE = Date.UTC(2024, 6, 1);
const KS = [1, 1.5, 2, 3];

// Instrumento → ficheiro e custo (spread + deslize) em unidades de preço.
const MERCADOS = [
  ['GER30', 'GRXEUR', 2],
  ['UK100', 'UKXGBP', 2],
  ['FRA40', 'FRXEUR', 2],
  ['JP225', 'JPXJPY', 12],
  ['SP500', 'SPXUSD', 0.6],
  ['US100', 'NSXUSD', 1.8],
  ['EURUSD', 'EURUSD', 0.00012],
  ['GBPUSD', 'GBPUSD', 0.00018],
  ['GBPJPY', 'GBPJPY', 0.03],
  ['USDJPY', 'USDJPY', 0.012],
  ['XAUUSD', 'XAUUSD', 0.35],
  ['XAGUSD', 'XAGUSD', 0.03],
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

function atrSerie(v, periodo = 14) {
  const a = new Float64Array(v.length);
  let atr = 0;
  for (let i = 0; i < v.length; i++) {
    const tr =
      i === 0
        ? v[i].high - v[i].low
        : Math.max(v[i].high - v[i].low, Math.abs(v[i].high - v[i - 1].close), Math.abs(v[i].low - v[i - 1].close));
    atr = i < periodo ? (atr * i + tr) / (i + 1) : (atr * (periodo - 1) + tr) / periodo;
    a[i] = atr;
  }
  return a;
}

/**
 * Entrada ao fecho da vela i, stop a 1 ATR, alvo a kR. Devolve o resultado em R
 * de cada k, mais a excursão máxima a favor (MFE) e contra (MAE), em R.
 * Numa vela que toca os dois, conta o stop — a hipótese conservadora.
 */
function simular(v, atr, i, lado, H, custoR) {
  const e = v[i].close;
  const r = atr[i];
  if (!(r > 0)) return null;
  const res = new Array(KS.length).fill(null);
  let mfe = 0;
  let mae = 0;
  for (let k = i + 1; k <= Math.min(i + H, v.length - 1); k++) {
    const aFavor = lado > 0 ? (v[k].high - e) / r : (e - v[k].low) / r;
    const contra = lado > 0 ? (e - v[k].low) / r : (v[k].high - e) / r;
    mfe = Math.max(mfe, aFavor);
    mae = Math.max(mae, contra);
    for (let j = 0; j < KS.length; j++) {
      if (res[j] !== null) continue;
      if (contra >= 1) res[j] = -1;
      else if (aFavor >= KS[j]) res[j] = KS[j];
    }
    if (res.every((x) => x !== null)) break;
  }
  // Sem desfecho no horizonte: fecha-se ao preço do fim.
  const fim = v[Math.min(i + H, v.length - 1)].close;
  const rFim = (lado > 0 ? fim - e : e - fim) / r;
  const tocou = KS.map((k, j) => res[j] !== null && res[j] >= k - 1e-9);
  for (let j = 0; j < KS.length; j++) if (res[j] === null) res[j] = rFim;
  return { res: res.map((x) => x - custoR), tocou, mfe, mae };
}

const media = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const mediana = (a) => {
  if (!a.length) return 0;
  const b = [...a].sort((x, y) => x - y);
  return b[Math.floor(b.length / 2)];
};

console.log(`horizonte ${HORIZONTE_H}h · entrada em TODAS as velas · stop 1 ATR · custo incluído`);
for (const horas of [1, 2, 4]) {
  const H = Math.max(1, Math.round(HORIZONTE_H / horas));
  console.log(`\n═══════════ ${horas}h (horizonte ${H} velas) ═══════════`);
  console.log(
    `${'mercado'.padEnd(9)}` +
      KS.map((k) => `alvo ${k}R (acerto, vs aleatório, R/op)`.padEnd(25)).join('') +
      ' MFE/MAE',
  );
  for (const [nome, ficheiro, custo] of MERCADOS) {
    let v;
    try {
      v = velas(ficheiro, horas);
    } catch {
      continue;
    }
    if (v.length < 500) continue;
    const atr = atrSerie(v);
    for (const lado of [1, -1]) {
      const porK = KS.map(() => []);
      const tocouK = KS.map(() => 0);
      const mfes = [];
      const maes = [];
      for (let i = 30; i < v.length - 1; i++) {
        const s = simular(v, atr, i, lado, H, custo / atr[i]);
        if (!s) continue;
        s.res.forEach((x, j) => porK[j].push(x));
        s.tocou.forEach((x, j) => (tocouK[j] += x ? 1 : 0));
        mfes.push(s.mfe);
        maes.push(s.mae);
      }
      const cols = porK.map((rs, j) => {
        const k = KS[j];
        const p = tocouK[j] / rs.length;
        const alvo = 1 / (1 + k);
        const vantagem = 100 * (p - alvo); // pontos percentuais acima do passeio aleatório
        const m = media(rs);
        return (
          `${(100 * p).toFixed(1)}%`.padStart(6) +
          `${vantagem >= 0 ? '+' : ''}${vantagem.toFixed(1)}pp`.padStart(8) +
          `${m >= 0 ? '+' : ''}${m.toFixed(3)}R`.padStart(9) +
          '  '
        );
      });
      console.log(
        `${nome.padEnd(7)}${(lado > 0 ? 'C' : 'V')} ${cols.join('')}` +
          ` ${mediana(mfes).toFixed(2)}/${mediana(maes).toFixed(2)}`,
      );
    }
  }
}
