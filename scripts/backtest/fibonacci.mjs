/**
 * Fibonacci como estratégia própria — e o teste de que os números são
 * especiais (27/09/2026, regras fixadas ANTES de correr):
 *
 *   1  Perna       um fundo e o topo seguinte (swings de 3 velas de cada lado)
 *                  em que o topo passa o topo anterior (BOS) e a perna mede
 *                  pelo menos 2 ATR. Venda: o espelho
 *   2  Entrada     ordem limite no recuo da perna, no nível X: Fibonacci —
 *                  38,2%, 50%, 61,8%, 78,6% — e, como PLACEBO, níveis que não
 *                  são de Fibonacci — 45%, 55%, 70%
 *   3  Stop        nos 100% (a origem da perna)
 *   4  Alvo        a extensão de 127,2% da perna
 *   5  Validade    a ordem só vale depois de o topo se confirmar; cancela-se se
 *                  o preço fizer um topo novo antes de a encher, se já estiver
 *                  para lá do nível quando o topo se confirma, ou ao fim de 2
 *                  dias. Operação fechada em 2 dias no máximo
 *
 * Um trade de cada vez por par. Na vela que enche: se também tocar o stop,
 * conta stop; stop e alvo na mesma vela = stop. Custos de conta normal
 * (`custoTipico`), em R. 2022+; metades 2022-01→2024-06 / 2024-07→2026.
 *
 * Os níveis de Fibonacci "funcionam" se: positivos nas duas metades, t ≥ 1,5,
 * positivos nos pares de controlo — E melhores do que os níveis placebo ao
 * lado deles. Sem isso, é o recuo que faz o trabalho, não o número.
 *
 *   node --max-old-space-size=6000 scripts/backtest/fibonacci.mjs          (1H)
 *   TF=15m …                                                               (15M)
 *   CUSTO_MULT=0 …                                                         (sem custos)
 */

import { existsSync, readFileSync } from 'node:fs';
import { custoTipico, serieAtrIct, swingsConfirmados } from '../../packages/core/dist/index.js';

const DIR = process.env.HISTDATA_DIR ?? 'E:/projecto Agnaldo 3.0/sistema de trading/data/backtest/histdata/';
const DESDE = Date.UTC(2022, 0, 10);
const CORTE = Date.UTC(2024, 6, 1);
const TF = process.env.TF === '15m' ? '15m' : '1h';
const VELAS_DIA = TF === '15m' ? 96 : 24;
const VALIDADE = 2 * VELAS_DIA;
const HORIZONTE = 2 * VELAS_DIA;
const LOOKBACK = 3;
const MIN_PERNA_ATR = 2;
const EXTENSAO = 1.272;

const NIVEIS = [
  { r: 0.382, fib: true },
  { r: 0.45, fib: false },
  { r: 0.5, fib: true },
  { r: 0.55, fib: false },
  { r: 0.618, fib: true },
  { r: 0.7, fib: false },
  { r: 0.786, fib: true },
];

const AO_VIVO = ['GBPJPY', 'USDJPY', 'EURJPY', 'USDCAD', 'EURUSD', 'GBPUSD', 'EURGBP', 'GBPAUD'];
const CONTROLO = ['AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY'];

const ler = (par) => {
  const f = `${DIR}${par}_${TF}.json`;
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
};

const est = (rs) => {
  const n = rs.length;
  if (n < 3) return { n, media: 0, t: 0, acerto: 0 };
  const m = rs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rs.reduce((a, r) => a + (r - m) ** 2, 0) / (n - 1));
  return { n, media: m, t: sd > 0 ? m / (sd / Math.sqrt(n)) : 0, acerto: rs.filter((r) => r > 0).length / n };
};

/** As pernas de impulso: conhecidas quando o topo (ou fundo) final se confirma. */
function pernas(v) {
  const atr = serieAtrIct(v);
  const sw = swingsConfirmados(v, LOOKBACK);
  const out = [];
  let ultAlto = null;
  let ultBaixo = null;
  let antAlto = null;
  let antBaixo = null;
  for (const w of sw) {
    if (w.kind === 'high') {
      // Compra: fundo → topo que passa o topo anterior.
      if (ultBaixo && ultBaixo.index < w.index && antAlto && w.price > antAlto.price) {
        const perna = w.price - ultBaixo.price;
        if (perna >= MIN_PERNA_ATR * (atr[w.index] ?? Infinity)) {
          out.push({ alta: true, origem: ultBaixo.price, fim: w.price, conhecida: w.confirmadoEm, iFim: w.index });
        }
      }
      antAlto = ultAlto ?? w;
      ultAlto = w;
    } else {
      if (ultAlto && ultAlto.index < w.index && antBaixo && w.price < antBaixo.price) {
        const perna = ultAlto.price - w.price;
        if (perna >= MIN_PERNA_ATR * (atr[w.index] ?? Infinity)) {
          out.push({ alta: false, origem: ultAlto.price, fim: w.price, conhecida: w.confirmadoEm, iFim: w.index });
        }
      }
      antBaixo = ultBaixo ?? w;
      ultBaixo = w;
    }
  }
  return out.sort((a, b) => a.conhecida - b.conhecida);
}

function correr(par, nivel) {
  const v = ler(par);
  if (!v) return null;
  const custo = custoTipico(par, v[v.length - 1].close) * Number(process.env.CUSTO_MULT ?? 1);
  const ops = [];
  let livreDesde = 0;
  for (const p of pernas(v)) {
    const k0 = p.conhecida;
    if (k0 < livreDesde || k0 + 1 >= v.length || v[k0].time < DESDE) continue;
    const L = Math.abs(p.fim - p.origem);
    const s = p.alta ? 1 : -1;
    const entrada = p.fim - s * nivel * L;
    const stop = p.origem;
    const alvo = p.origem + s * EXTENSAO * L;
    const risco = Math.abs(entrada - stop);
    if (!(risco > 0)) continue;
    // Já para lá do nível quando o topo se confirma: perdeu-se.
    if (p.alta ? v[k0].close <= entrada : v[k0].close >= entrada) continue;
    // Enche?
    let f = -1;
    for (let k = k0 + 1; k <= Math.min(k0 + VALIDADE, v.length - 1); k++) {
      const c = v[k];
      const passou = p.alta ? c.high > p.fim : c.low < p.fim;
      const tocou = p.alta ? c.low <= entrada : c.high >= entrada;
      if (passou) break; // topo novo antes de encher (ou na mesma vela): cancela
      if (tocou) {
        f = k;
        break;
      }
    }
    if (f < 0) continue;
    const custoR = custo / risco;
    let r = null;
    let fim = f;
    // Na vela que enche, só o stop conta.
    if (p.alta ? v[f].low <= stop : v[f].high >= stop) r = -1 - custoR;
    for (let k = f + 1; r === null && k <= Math.min(f + HORIZONTE, v.length - 1); k++) {
      const c = v[k];
      fim = k;
      if (p.alta ? c.low <= stop : c.high >= stop) r = -1 - custoR;
      else if (p.alta ? c.high >= alvo : c.low <= alvo) r = Math.abs(alvo - entrada) / risco - custoR;
    }
    if (r === null) r = (s * (v[fim].close - entrada)) / risco - custoR;
    ops.push({ t: v[f].time, r });
    livreDesde = fim + 1;
  }
  return ops;
}

function linha(rotulo, ops) {
  if (ops.length < 15) return `${rotulo.padEnd(22)}${String(ops.length).padStart(6)}  (poucas)`;
  const s = est(ops.map((o) => o.r));
  const a = est(ops.filter((o) => o.t < CORTE).map((o) => o.r));
  const b = est(ops.filter((o) => o.t >= CORTE).map((o) => o.r));
  const passa = a.media > 0 && b.media > 0 && s.t >= 1.5;
  const f = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(3)}`;
  return (
    ((passa ? 'OK ' : '   ') + rotulo).padEnd(22) +
    String(s.n).padStart(6) +
    `${(100 * s.acerto).toFixed(0)}%`.padStart(7) +
    `${f(s.media)}R`.padStart(9) +
    `t=${s.t.toFixed(1)}`.padStart(8) +
    f(a.media).padStart(9) +
    f(b.media).padStart(9)
  );
}

const cab = ''.padEnd(22) + 'n'.padStart(6) + 'acerto'.padStart(7) + 'R/op'.padStart(9) + 't'.padStart(8) + '1.ª met'.padStart(9) + '2.ª met'.padStart(9);
for (const [titulo, lista] of [
  ['AO VIVO (8 pares)', AO_VIVO],
  ['CONTROLO (4 pares)', CONTROLO],
]) {
  console.log(`\n== Fibonacci · ${titulo} · ${TF.toUpperCase()} · 2022+ · stop 100% · alvo 127,2% · custos ×${process.env.CUSTO_MULT ?? 1}\n${cab}`);
  for (const n of NIVEIS) {
    const todas = [];
    for (const par of lista) todas.push(...(correr(par, n.r) ?? []));
    const rr = (EXTENSAO - (1 - n.r)) / (1 - n.r);
    console.log(linha(`${(n.r * 100).toFixed(1)}% ${n.fib ? 'Fibonacci' : 'placebo  '} ${rr.toFixed(1)}R`, todas));
  }
}
