/**
 * ICT Power of 3 — as regras do site (theinnercircletraders.com/ict-power-of-3),
 * medidas uma vez (26/09/2026), fixadas ANTES de correr:
 *
 *   1  Viés        o viés diário do algoritmo (viesDiario, o do Asia Range Algo),
 *                  lido às 02:00 de Nova Iorque — "confirm daily bias from the
 *                  higher timeframe"
 *   2  Acumulação  a faixa asiática das 20:00 às 02:00 de Nova Iorque
 *   3  Manipulação a killzone de Londres, 02:00–05:00 de Nova Iorque: o preço
 *                  passa o extremo asiático CONTRA o viés (Judas swing): numa
 *                  compra, abaixo do mínimo da Ásia
 *   4  CHoCH       uma vela de 5M a favor (compra: fecho > abertura) que fecha de
 *                  volta para dentro da Ásia (compra: acima do mínimo) depois do
 *                  varrimento — "bullish candle that closes back above the Asian
 *                  low". O 5M monta-se do 1M
 *   5  Entrada     a mercado no fecho dessa vela de 5M ("entry at the CHoCH")
 *   6  Stop        no pavio do Judas swing (o extremo desde as 02:00), a pelo
 *                  menos ¼ de ATR de 15M (a regra de produção)
 *   7  Alvo        a liquidez diária seguinte: compra → o máximo do dia anterior
 *                  ou, se já não pagar, o da semana anterior; venda → os mínimos.
 *                  Por tomar e a pagar pelo menos 2R (o site: "typical 1:3 to 1:5")
 *   8  Distribuição a operação fecha às 11:00 de Nova Iorque se nem o stop nem o
 *                  alvo tiverem sido tocados (a distribuição é 07:00–10:00 NY)
 *
 * VERSÃO 15M (TF_CHOCH=15), fixada antes de correr, a pedido do Agnaldo ("a
 * análise deve partir do timeframe de 15 minutos"): o Judas swing e a CHoCH
 * lêem-se em velas de 15M (montadas do 1M) em vez de 5M; entrada no fecho da
 * vela de 15M. O resto igual.
 *
 * Uma operação por dia e por par. Simulação em 1M; stop e alvo na mesma vela =
 * stop; custos de conta normal (`custoTipico`), em R. Metades 2022-01→2024-06 /
 * 2024-07→2026. Passa se: positiva nas duas metades, t ≥ 1,5 e positiva nos
 * pares de controlo.
 *
 *   node --max-old-space-size=6000 scripts/backtest/asia-range-po3.mjs
 *   CUSTO_MULT=0 …    diagnóstico sem custos      RAZOES=GBPJPY …   onde os dias param
 */

import { existsSync, readFileSync } from 'node:fs';
import {
  agregar,
  custoTipico,
  prepararEstruturas,
  relogioNy,
  simularSinal,
  ultimaFechadaAte,
  viesDiario,
} from '../../packages/core/dist/index.js';

const DIR = process.env.HISTDATA_DIR ?? 'E:/projecto Agnaldo 3.0/sistema de trading/data/backtest/histdata/';
const DESDE = Date.UTC(2022, 0, 10);
const CORTE = Date.UTC(2024, 6, 1);
const M1 = 60_000;
const M5 = 300_000;
/** O timeframe da CHoCH: 5M (as regras do site) ou 15M (TF_CHOCH=15). */
const BALDE = process.env.TF_CHOCH === '15' ? 900_000 : M5;
const M15 = 900_000;
const DIA = 86_400_000;
const SEMANA = 7 * DIA;
const JANELA_15M = 1200;
const RR_MINIMO = 2;
const RISCO_MINIMO_ATR = 0.25;

const AO_VIVO = ['GBPJPY', 'USDJPY', 'EURJPY', 'USDCAD', 'EURUSD', 'GBPUSD', 'EURGBP', 'GBPAUD'];
const CONTROLO = ['AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY'];

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

/** Minutos de Nova Iorque e a data de Nova Iorque (dias desde 1970). */
function ny(t) {
  const r = relogioNy(t);
  const minNy = r.hora * 60 + r.minuto;
  const u = new Date(t);
  const desvio = ((minNy - (u.getUTCHours() * 60 + u.getUTCMinutes()) + 1440) % 1440) - 1440;
  return { min: minNy, dia: Math.floor((t + desvio * M1) / DIA), diaSemana: r.diaSemana, desvioMs: desvio * M1 };
}

const est = (rs) => {
  const n = rs.length;
  if (n < 3) return { n, media: 0, t: 0, acerto: 0 };
  const m = rs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rs.reduce((a, r) => a + (r - m) ** 2, 0) / (n - 1));
  return { n, media: m, t: sd > 0 ? m / (sd / Math.sqrt(n)) : 0, acerto: rs.filter((r) => r > 0).length / n };
};

const razoes = new Map();
const razao = (r) => razoes.set(r, (razoes.get(r) ?? 0) + 1);

function correr(par) {
  if (!existe(par, '1m') || !existe(par, '15m') || !existe(par, '1h')) return { erro: 'faltam dados' };
  const v1 = ler(par, '1m');
  const v15 = ler(par, '15m');
  const diarias = agregar(ler(par, '1h'), '1d');
  const custo = custoTipico(par, v1[v1.length - 1].close) * Number(process.env.CUSTO_MULT ?? 1);

  // Índices de 1M por data de Nova Iorque.
  const porDia = new Map();
  for (let i = primeira(v1, DESDE - 2 * DIA); i < v1.length; i++) {
    const d = ny(v1[i].time).dia;
    const e = porDia.get(d);
    if (e) e[1] = i;
    else porDia.set(d, [i, i]);
  }

  const ops = [];
  for (const [dia, [i0, i1]] of porDia) {
    const t0 = v1[i0].time;
    if (t0 < DESDE) continue;
    const wd = ny(t0).diaSemana;
    if (wd === 0 || wd === 6) continue;
    const ontem = porDia.get(dia - 1) ?? porDia.get(dia - 3);
    if (!ontem) continue;

    // 2 — Ásia: 20:00 (véspera) – 02:00 NY.
    let asiaAlto = -Infinity;
    let asiaBaixo = Infinity;
    let nAsia = 0;
    let i02 = -1;
    for (let k = ontem[0]; k <= i1; k++) {
      const c = v1[k];
      const n = ny(c.time);
      const naAsia = (n.dia < dia && n.min >= 20 * 60) || (n.dia === dia && n.min < 2 * 60);
      if (naAsia) {
        asiaAlto = Math.max(asiaAlto, c.high);
        asiaBaixo = Math.min(asiaBaixo, c.low);
        nAsia++;
      } else if (n.dia === dia && n.min >= 2 * 60) {
        i02 = k;
        break;
      }
    }
    if (nAsia < 240 || i02 < 0) {
      razao('Ásia incompleta');
      continue;
    }
    const t02 = v1[i02].time;

    // 1 — viés diário às 02:00 NY (o do Asia Range Algo).
    const j = ultimaFechadaAte(v15, M15, t02);
    if (j < JANELA_15M || v15[j].time + M15 < t02 - 30 * M1) continue;
    const velas = v15.slice(j - JANELA_15M + 1, j + 1);
    const dias = diarias.slice(0, ultimaFechadaAte(diarias, DIA, t02) + 1);
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
    const iDia = ultimaFechadaAte(e.diarias, DIA, t02);
    const iSem = ultimaFechadaAte(e.semanais, SEMANA, t02);
    if (iDia < 20 || iSem < 4) continue;
    const vies = viesDiario({
      velasDiarias: e.diarias,
      iDia,
      swingsSemanais: e.swingsSemanais,
      iSemanal: iSem,
      pocas: e.pocas,
      iExecucao: velas.length - 1,
      preco: velas[velas.length - 1].close,
    });
    if (vies.direccao === 'neutral') {
      razao('sem viés diário');
      continue;
    }
    const compra = vies.direccao === 'bullish';
    const atr = e.atr[velas.length - 1] ?? 0;
    const pd = e.diarias[iDia];
    const pw = e.semanais[iSem];

    // 3–5 — killzone 02:00–05:00 NY em velas de 5M montadas do 1M.
    let extremo = compra ? Infinity : -Infinity;
    let varreu = false;
    let op = null;
    let k = i02;
    while (k <= i1 && !op) {
      const b0 = Math.floor(v1[k].time / BALDE) * BALDE;
      if (ny(b0).min >= 5 * 60) break;
      let o = v1[k].open;
      let h = -Infinity;
      let l = Infinity;
      let c = o;
      let kFim = k;
      while (kFim <= i1 && v1[kFim].time < b0 + BALDE) {
        h = Math.max(h, v1[kFim].high);
        l = Math.min(l, v1[kFim].low);
        c = v1[kFim].close;
        kFim++;
      }
      extremo = compra ? Math.min(extremo, l) : Math.max(extremo, h);
      if (compra ? extremo < asiaBaixo : extremo > asiaAlto) varreu = true;
      const choch = varreu && (compra ? c > o && c > asiaBaixo : c < o && c < asiaAlto);
      const iUlt = kFim - 1;
      k = kFim;
      if (!choch) continue;

      // 6 — stop no pavio do Judas swing.
      const entrada = c;
      const stop = extremo;
      const risco = compra ? entrada - stop : stop - entrada;
      if (!(risco >= RISCO_MINIMO_ATR * atr)) {
        razao('stop demasiado curto');
        op = 'feito';
        break;
      }
      // 7 — alvo: a liquidez diária (dia anterior, depois semana anterior), por tomar.
      let maxHoje = -Infinity;
      let minHoje = Infinity;
      for (let x = ontem[0]; x <= iUlt; x++) {
        if (ny(v1[x].time).dia < dia && ny(v1[x].time).min < 20 * 60) continue;
        maxHoje = Math.max(maxHoje, v1[x].high);
        minHoje = Math.min(minHoje, v1[x].low);
      }
      const niveis = (compra ? [pd.high, pw?.high] : [pd.low, pw?.low])
        .filter((x) => x !== undefined && (compra ? x > entrada && x > maxHoje : x < entrada && x < minHoje))
        .map((x) => ({ preco: x, rr: Math.abs(x - entrada) / risco }))
        .filter((a) => a.rr >= RR_MINIMO)
        .sort((a, b) => (compra ? a.preco - b.preco : b.preco - a.preco));
      const alvo = niveis[0];
      if (!alvo) {
        razao('liquidez diária não paga 2R');
        op = 'feito';
        break;
      }
      // 8 — fecho às 11:00 NY.
      let horizonte = 0;
      for (let x = iUlt + 1; x <= i1 && ny(v1[x].time).min < 11 * 60; x++) horizonte++;
      const sim = simularSinal(
        v1,
        { direccao: compra ? 'bullish' : 'bearish', entrada, stop, alvo: alvo.preco, rr: alvo.rr, tipoEntrada: 'mercado' },
        iUlt,
        { espera: 0, horizonte: Math.max(1, horizonte), custo },
      );
      razao('ENTRADA');
      op = { t: v1[iUlt].time, r: sim.r, alta: compra, saida: sim.saida, rr: alvo.rr, riscoAtr: risco / atr };
    }
    if (op && op !== 'feito' && op.r !== null) ops.push(op);
    else if (!op) razao(varreu ? 'varreu sem CHoCH até às 05:00' : 'sem Judas swing na killzone');
  }
  return { ops };
}

function linha(rotulo, ops) {
  if (ops.length < 15) return `${rotulo.padEnd(20)}${String(ops.length).padStart(5)}  (poucas)`;
  const s = est(ops.map((o) => o.r));
  const a = est(ops.filter((o) => o.t < CORTE).map((o) => o.r));
  const b = est(ops.filter((o) => o.t >= CORTE).map((o) => o.r));
  const passa = a.media > 0 && b.media > 0 && s.t >= 1.5;
  const f = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(3)}`;
  return (
    ((passa ? 'OK ' : '   ') + rotulo).padEnd(20) +
    String(s.n).padStart(5) +
    `${(100 * s.acerto).toFixed(0)}%`.padStart(7) +
    `${f(s.media)}R`.padStart(9) +
    `t=${s.t.toFixed(1)}`.padStart(8) +
    f(a.media).padStart(9) +
    f(b.media).padStart(9)
  );
}

const cab = ''.padEnd(20) + 'n'.padStart(5) + 'acerto'.padStart(7) + 'R/op'.padStart(9) + 't'.padStart(8) + '1.ª met'.padStart(9) + '2.ª met'.padStart(9);

if (process.env.RAZOES) {
  const r = correr(process.env.RAZOES === '1' ? 'GBPJPY' : process.env.RAZOES);
  console.log(`${r.ops?.length ?? 0} operações ${r.erro ?? ''}`);
  for (const [x, n] of [...razoes].sort((a, b) => b[1] - a[1])) console.log(`  ${x.padEnd(34)} ${String(n).padStart(6)}`);
  process.exit(0);
}

for (const [titulo, lista] of [
  ['AO VIVO', AO_VIVO],
  ['CONTROLO', CONTROLO],
]) {
  console.log(`\n== ICT Power of 3 (regras do site, CHoCH em ${BALDE / 60_000}M) · ${titulo} · 2022+ · custos ×${process.env.CUSTO_MULT ?? 1}\n${cab}`);
  const todas = [];
  razoes.clear();
  for (const par of lista) {
    const r = correr(par);
    if (r.erro) {
      console.log(`${par}: ${r.erro}`);
      continue;
    }
    todas.push(...r.ops);
    console.log(linha(par, r.ops));
  }
  console.log('');
  console.log(linha('TODOS', todas));
  console.log(linha('  compras', todas.filter((o) => o.alta)));
  console.log(linha('  vendas', todas.filter((o) => !o.alta)));
  if (todas.length) {
    const saidas = {};
    for (const o of todas) saidas[o.saida] = (saidas[o.saida] ?? 0) + 1;
    console.log(`  saídas: ${Object.entries(saidas).map(([x, n]) => `${x} ${n}`).join(' · ')} · RR planeado médio ${(todas.reduce((a, o) => a + o.rr, 0) / todas.length).toFixed(2)} · stop médio ${(todas.reduce((a, o) => a + o.riscoAtr, 0) / todas.length).toFixed(2)} ATR de 15M`);
    console.log(`  dias: ${[...razoes].map(([x, n]) => `${x} ${n}`).join(' · ')}`);
  }
}
