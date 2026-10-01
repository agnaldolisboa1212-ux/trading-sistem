/**
 * VWAP +2σ em VENDA — o espelho da compra validada (28/09/2026).
 *
 * A mesma simulação de `vwap-com-confirmacao.mjs` (a que validou a compra),
 * invertida: metade a −1R e o stop para a entrada, o resto a −2R; os mesmos
 * custos; uma operação de cada vez. A regra é a de produção
 * (`planVendaVwapIndices`). Metades até jun/2024 e depois.
 *
 *   node scripts/backtest/vwap-venda.mjs                    (os 4 da compra + GBPUSD)
 *   node scripts/backtest/vwap-venda.mjs UK100 FRA40 JP225  (controlo)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/';
const DIR = RAIZ + 'data/backtest/histdata/';
const DIARIO = RAIZ + 'data/backtest/diario/';
const { planVendaVwapIndices } = await import(pathToFileURL(RAIZ + 'packages/core/dist/index.js').href);

const HORA = 3_600_000;
const CORTE = Date.UTC(2024, 6, 1);
const CUSTO_MULT = Number(process.env.CUSTO ?? 1);
const CUSTO = { GER30: 2, SP500: 0.6, US100: 1.8, JP225: 12, UK100: 2, FRA40: 2, GBPUSD: 0.00018 };
const FICHEIRO = { GER30: 'GRXEUR', SP500: 'SPXUSD', US100: 'NSXUSD', JP225: 'JPXJPY', UK100: 'UKXGBP', FRA40: 'FRXEUR', GBPUSD: 'GBPUSD' };

function velas(simbolo, tf) {
  const v = JSON.parse(readFileSync(`${DIR}${FICHEIRO[simbolo]}_1h.json`, 'utf8'));
  if (tf === '1h') return v;
  const passo = 4 * HORA;
  const out = [];
  for (const c of v) {
    const k = c.time - (c.time % passo);
    const u = out[out.length - 1];
    if (u && u.time === k) {
      u.high = Math.max(u.high, c.high);
      u.low = Math.min(u.low, c.low);
      u.close = c.close;
    } else out.push({ ...c, time: k });
  }
  return out;
}
const diarias = (s) => {
  try {
    return JSON.parse(readFileSync(`${DIARIO}${s}.json`, 'utf8'));
  } catch {
    return null;
  }
};
const st = (rs) => {
  const n = rs.length;
  if (n < 3) return { n, media: 0, t: 0, acerto: 0 };
  const m = rs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rs.reduce((a, r) => a + (r - m) ** 2, 0) / (n - 1));
  return { n, media: m, t: m / (sd / Math.sqrt(n)), acerto: rs.filter((r) => r > 0).length / n };
};

// O US30 fica de fora: o UDXUSD do HistData é o índice do dólar, não o Dow Jones.
const SIMBOLOS = process.argv.slice(2).length ? process.argv.slice(2) : ['GER30', 'SP500', 'US100', 'GBPUSD'];
const todas = [];
for (const s of SIMBOLOS) {
  const velas1d = diarias(s === 'US30' ? 'US100' : s) ?? undefined;
  const porSimbolo = [];
  for (const tf of ['1h', '4h']) {
    let v;
    try {
      v = velas(s, tf);
    } catch {
      continue;
    }
    let livre = -1;
    for (let i = 300; i < v.length - 1; i++) {
      if (i <= livre) continue;
      const g = planVendaVwapIndices(v.slice(i - 299, i + 1), { symbol: s, timeframe: tf }, { velas1d })[0];
      if (!g) continue;
      const risco = g.stopLoss - g.entryPrice;
      if (!(risco > 0)) continue;
      const custo = (CUSTO[s] * CUSTO_MULT) / risco;
      let parcial = null;
      let armado = false;
      let k = i + 1;
      for (; k < v.length && k <= i + 200; k++) {
        // Em venda: o "baixo" do comprador é o máximo da vela.
        const contra = (g.entryPrice - v[k].high) / risco;
        const favor = (g.entryPrice - v[k].low) / risco;
        if (armado && contra <= 0) parcial = 0.5;
        else if (!armado && contra <= -1) parcial = -1;
        else if (favor >= 2) parcial = 1.5;
        else if (favor >= 1) armado = true;
        if (parcial !== null) break;
      }
      if (parcial === null) continue;
      livre = k;
      porSimbolo.push({ t: v[i].time, r: parcial - custo });
    }
  }
  const e = st(porSimbolo.map((o) => o.r));
  console.log(`${s.padEnd(7)} ${String(e.n).padStart(5)} op · ${(100 * e.acerto).toFixed(0)}% · ${e.media >= 0 ? '+' : ''}${e.media.toFixed(3)}R · t=${e.t.toFixed(1)}`);
  todas.push(...porSimbolo);
}
const f = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(3)}`;
const e = st(todas.map((o) => o.r));
const a = st(todas.filter((o) => o.t < CORTE).map((o) => o.r));
const b = st(todas.filter((o) => o.t >= CORTE).map((o) => o.r));
const anos = todas.length ? (Math.max(...todas.map((o) => o.t)) - Math.min(...todas.map((o) => o.t))) / (365.25 * 24 * HORA) : 0;
console.log(`TODOS   ${e.n} op (${(e.n / Math.max(anos, 0.1)).toFixed(0)}/ano) · ${(100 * e.acerto).toFixed(0)}% · ${f(e.media)}R · t=${e.t.toFixed(1)} · até jun/24 ${f(a.media)} (${a.n}) · depois ${f(b.media)} (${b.n}) · custos ×${CUSTO_MULT}`);
