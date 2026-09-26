/**
 * Asia Range 1M — o MSS detectado no próprio 1M, para a entrada ficar perto do
 * extremo da manipulação e o alvo pagar 2R mais vezes.
 *
 * Regras fixadas ANTES de medir (26/09/2026), para correr uma só vez:
 *
 *   1  Contexto   viés diário, POI de Londres e ATR de 15M lidos na última vela
 *                 de 15M FECHADA no instante da decisão (as mesmas peças do
 *                 `analisarAsiaRange`: prepararEstruturas, viesDiario, poiLondres)
 *   2  Ásia       a faixa das 00:00 às 08:00 de Londres, em 1M
 *   3  Londres    a partir das 08:00, o preço passa o extremo asiático CONTRA
 *                 o viés; o extremo da manipulação é o pavio mais fundo desde
 *                 as 08:00 até à vela da decisão
 *   4  SMT        o par correlacionado (1M) não passou o seu extremo asiático
 *                 entre as 08:00 e a vela da decisão
 *   5  MSS 1M     o primeiro fecho de 1M para lá do último swing de 1M
 *                 confirmado antes do extremo (swings de 2 velas de cada lado,
 *                 conhecidos só quando a 2.ª vela da direita fecha). Um MSS por
 *                 extremo: se não servir, só um extremo novo dá outro
 *   6  Entrada    a mercado no fecho dessa vela de 1M, que tem de fechar antes
 *                 das 10:00 de Londres. Stop no extremo da manipulação, a pelo
 *                 menos ¼ de ATR de 15M (a regra de produção)
 *   7  Alvo       o extremo oposto da Ásia ou o POI de Londres: o mais próximo
 *                 dos que pagam pelo menos 2R
 *
 * Um sinal por dia e por sentido. Simulação em 1M: stop e alvo na mesma vela =
 * stop; horizonte de 1440 velas de 1M (24 h); custos de conta normal
 * (`custoTipico`), descontados em R. Metades 2022-01→2024-06 / 2024-07→2026.
 *
 * Passa se: positiva nas duas metades, t ≥ 1,5 E positiva nos pares de
 * controlo (AUDJPY, CADJPY, CHFJPY, NZDJPY contra o USDJPY), que nunca
 * entraram em escolha nenhuma.
 *
 * Precisa de SIMBOLO_1m.json (e do par), SIMBOLO_15m.json e SIMBOLO_1h.json.
 *   node --max-old-space-size=6000 scripts/backtest/asia-range-1m.mjs
 *   RAZOES=GBPJPY …   onde os setups param
 */

import { existsSync, readFileSync } from 'node:fs';
import {
  agregar,
  custoTipico,
  diaLondres,
  faixaAsiaticaLondres,
  paresSmtIct,
  poiLondres,
  prepararEstruturas,
  relogioLondres,
  simularSinal,
  swingsConfirmados,
  ultimaFechadaAte,
  viesDiario,
} from '../../packages/core/dist/index.js';

const DIR = process.env.HISTDATA_DIR ?? 'E:/projecto Agnaldo 3.0/sistema de trading/data/backtest/histdata/';
const DESDE = Date.UTC(2022, 0, 10);
const CORTE = Date.UTC(2024, 6, 1);
const M1 = 60_000;
const M15 = 900_000;
const HORA = 3_600_000;
const DIA = 86_400_000;
const SEMANA = 7 * DIA;
/** Velas de 15M para o contexto, como no `asia-range-algo.mjs`. */
const JANELA_15M = 1200;
const RR_MINIMO = 2;
const RISCO_MINIMO_ATR = 0.25;
/** 24 h de velas de 1M, como as 96 de 15M das outras medições. */
const HORIZONTE_1M = 1440;
/** Swings de 1M a partir das 03:00 de Londres: as 300 velas que o motor teria às 08:00. */
const ANTES_DE_LONDRES = 5 * HORA;

const AO_VIVO = ['GBPJPY', 'USDJPY', 'EURJPY', 'USDCAD'];
const CONTROLO = ['AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY'];

const existe = (par, tf) => existsSync(`${DIR}${par}_${tf}.json`);
const ler = (par, tf) => {
  try {
    const v = JSON.parse(readFileSync(`${DIR}${par}_${tf}.json`, 'utf8'));
    return Array.isArray(v) && v.length > 0 ? v : null;
  } catch {
    return null;
  }
};

/** Primeiro índice com `time >= t`. */
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
  if (n < 3) return { n, media: 0, t: 0, acerto: 0 };
  const m = rs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rs.reduce((a, r) => a + (r - m) ** 2, 0) / (n - 1));
  return { n, media: m, t: sd > 0 ? m / (sd / Math.sqrt(n)) : 0, acerto: rs.filter((r) => r > 0).length / n };
};

const razoes = new Map();
const razao = (r) => razoes.set(r, (razoes.get(r) ?? 0) + 1);

function correr(par) {
  const refNome = paresSmtIct(par).find((p) => existe(p, '1m') && existe(p, '15m')) ?? (par.endsWith('JPY') ? 'USDJPY' : undefined);
  if (!refNome) return { erro: 'sem par de SMT com dados de 1M' };
  const v1 = ler(par, '1m');
  const v15 = ler(par, '15m');
  const h1 = ler(par, '1h');
  const r1 = ler(refNome, '1m');
  const r15 = ler(refNome, '15m');
  if (!v1 || !v15 || !h1 || !r1 || !r15) return { erro: 'faltam dados' };
  const diarias = agregar(h1, '1d');
  // CUSTO_MULT=0: o diagnóstico sem custos (não é uma variante para escolher).
  const custo = custoTipico(par, v1[v1.length - 1].close) * Number(process.env.CUSTO_MULT ?? 1);
  const opcoes = { espera: 0, horizonte: HORIZONTE_1M, custo };

  // ── Contexto de 15M (memorizado por vela de 15M) ───────────────────────────
  const memo = new Map();
  function contexto(j, oposto) {
    const chave = `${j}|${oposto.alto}|${oposto.baixo}`;
    if (memo.has(chave)) return memo.get(chave);
    let ctx = null;
    if (j >= JANELA_15M) {
      const velas = v15.slice(j - JANELA_15M + 1, j + 1);
      const i = velas.length - 1;
      const instante = velas[i].time + M15;
      // Só diárias FECHADAS no instante, como a Deriv as entrega ao motor.
      const dias = diarias.slice(0, ultimaFechadaAte(diarias, DIA, instante) + 1);
      const parVelas = r15.slice(primeira(r15, velas[0].time), primeira(r15, instante));
      const e = prepararEstruturas({
        simbolo: par,
        timeframe: '15m',
        velas,
        diarias: dias,
        semanais: agregar(dias, '1w'),
        referencia: dias,
        timeframeReferencia: '1d',
        par: { simbolo: refNome, velas: parVelas },
      });
      const iDia = ultimaFechadaAte(e.diarias, DIA, instante);
      const iSem = ultimaFechadaAte(e.semanais, SEMANA, instante);
      if (dias.length >= 45 && iDia >= 20 && iSem >= 4) {
        const vies = viesDiario({
          velasDiarias: e.diarias,
          iDia,
          swingsSemanais: e.swingsSemanais,
          iSemanal: iSem,
          pocas: e.pocas,
          iExecucao: i,
          preco: velas[i].close,
        });
        let poi = null;
        if (vies.direccao !== 'neutral') {
          const alta = vies.direccao === 'bullish';
          const op = alta ? oposto.alto : oposto.baixo;
          poi = poiLondres({
            velas,
            i,
            direccao: vies.direccao,
            referencia: alta ? Math.max(op, velas[i].close) : Math.min(op, velas[i].close),
            pocas: e.pocas,
            pdArrays: [...e.obs, ...e.fvgs, ...e.breakers],
          });
        }
        ctx = { direccao: vies.direccao, atr: e.atr[i] ?? 0, poi };
      }
    }
    memo.set(chave, ctx);
    return ctx;
  }

  const ops = [];
  let k = primeira(v1, DESDE);
  while (k < v1.length) {
    // Primeira vela de 1M das 08:00 de Londres (ou depois) deste dia.
    const dia = diaLondres(v1[k].time);
    let i08 = k;
    while (i08 < v1.length && diaLondres(v1[i08].time) === dia && relogioLondres(v1[i08].time).minutos < 8 * 60) i08++;
    if (i08 >= v1.length || diaLondres(v1[i08].time) !== dia || relogioLondres(v1[i08].time).minutos >= 10 * 60) {
      // Sem janela de Londres neste dia: salta para o dia seguinte.
      while (k < v1.length && diaLondres(v1[k].time) === dia) k++;
      continue;
    }
    let iFim = i08;
    while (iFim + 1 < v1.length && diaLondres(v1[iFim + 1].time) === dia && relogioLondres(v1[iFim + 1].time).minutos + 1 < 10 * 60) iFim++;

    const asia = faixaAsiaticaLondres(v1, i08);
    const iRef08 = primeira(r1, v1[i08].time);
    const asiaPar =
      iRef08 < r1.length && diaLondres(r1[iRef08].time) === dia && relogioLondres(r1[iRef08].time).minutos < 10 * 60
        ? faixaAsiaticaLondres(r1, iRef08)
        : null;

    if (asia && asiaPar) {
      // Swings de 1M do dia, das 03:00 às 10:00 de Londres.
      const s0 = primeira(v1, v1[i08].time - ANTES_DE_LONDRES);
      const fatia = v1.slice(s0, iFim + 3);
      const swings = swingsConfirmados(fatia).map((w) => ({ ...w, index: w.index + s0, confirmadoEm: w.confirmadoEm + s0 }));

      const estado = { bullish: { feito: false, avaliado: -1 }, bearish: { feito: false, avaliado: -1 } };
      let minimo = Infinity;
      let iMin = -1;
      let maximo = -Infinity;
      let iMax = -1;
      let rMin = Infinity;
      let rMax = -Infinity;
      let r = iRef08;

      for (let q = i08; q <= iFim; q++) {
        const c = v1[q];
        if (c.low < minimo) {
          minimo = c.low;
          iMin = q;
        }
        if (c.high > maximo) {
          maximo = c.high;
          iMax = q;
        }
        // O par até à vela da decisão (aberta até `c.time`, fechada no mesmo instante).
        while (r < r1.length && r1[r].time <= c.time) {
          rMin = Math.min(rMin, r1[r].low);
          rMax = Math.max(rMax, r1[r].high);
          r++;
        }

        const fecho = c.time + M1;
        const j = ultimaFechadaAte(v15, M15, fecho);
        const varreuBaixo = minimo < asia.baixo;
        const varreuAlto = maximo > asia.alto;
        if (!varreuBaixo && !varreuAlto) continue;
        const ctx = contexto(j, asia);
        if (!ctx || ctx.direccao === 'neutral') continue;
        const d = ctx.direccao;
        const alta = d === 'bullish';
        const st = estado[d];
        if (st.feito) continue;
        if (!(alta ? varreuBaixo : varreuAlto)) continue;
        const extremo = alta ? minimo : maximo;
        const iExt = alta ? iMin : iMax;
        if (q <= iExt) continue;

        // O último swing de 1M confirmado antes do extremo.
        let nivel = null;
        for (let s = swings.length - 1; s >= 0; s--) {
          const w = swings[s];
          if (w.index >= iExt || w.confirmadoEm > q) continue;
          if (w.kind === (alta ? 'high' : 'low')) {
            nivel = w.price;
            break;
          }
        }
        if (nivel === null) continue;
        if (!(alta ? c.close > nivel : c.close < nivel)) continue;
        if (st.avaliado === iExt) continue;
        st.avaliado = iExt;

        // SMT: o par não passou o seu extremo asiático.
        const parPassou = alta ? rMin < asiaPar.baixo : rMax > asiaPar.alto;
        if (parPassou) {
          razao('sem SMT no MSS');
          continue;
        }
        const entrada = c.close;
        const risco = alta ? entrada - extremo : extremo - entrada;
        if (!(risco > 0) || (ctx.atr > 0 && risco < RISCO_MINIMO_ATR * ctx.atr)) {
          razao('stop demasiado curto');
          continue;
        }
        const alvos = [alta ? asia.alto : asia.baixo, ...(ctx.poi ? [ctx.poi.preco] : [])]
          .filter((p) => (alta ? p > entrada : p < entrada))
          .map((p) => ({ preco: p, rr: Math.abs(p - entrada) / risco }))
          .filter((a) => a.rr >= RR_MINIMO)
          .sort((a, b) => (alta ? a.preco - b.preco : b.preco - a.preco));
        const alvo = alvos[0];
        if (!alvo) {
          razao('nenhum alvo paga 2R');
          continue;
        }
        st.feito = true;
        razao('SINAL');
        const sim = simularSinal(v1, { direccao: d, entrada, stop: extremo, alvo: alvo.preco, rr: alvo.rr, tipoEntrada: 'mercado' }, q, opcoes);
        if (sim.r === null) continue;
        ops.push({
          t: c.time,
          r: sim.r,
          alta,
          saida: sim.saida,
          rr: alvo.rr,
          riscoAtr: ctx.atr > 0 ? risco / ctx.atr : 0,
          detalhe: { asia: [asia.baixo, asia.alto], extremo, tExtremo: v1[iExt].time, nivel, entrada, alvo: alvo.preco, fechoEm: v1[sim.fechoEm]?.time },
        });
      }
    }
    while (k < v1.length && diaLondres(v1[k].time) === dia) k++;
  }
  return { ops, ref: refNome };
}

function linha(rotulo, ops) {
  if (ops.length < 15) return `${rotulo.padEnd(28)}${String(ops.length).padStart(5)}  (poucas)`;
  const s = est(ops.map((o) => o.r));
  const a = est(ops.filter((o) => o.t < CORTE).map((o) => o.r));
  const b = est(ops.filter((o) => o.t >= CORTE).map((o) => o.r));
  const passa = a.media > 0 && b.media > 0 && s.t >= 1.5;
  const f = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(3)}`;
  return (
    ((passa ? 'OK ' : '   ') + rotulo).padEnd(28) +
    String(s.n).padStart(5) +
    `${(100 * s.acerto).toFixed(0)}%`.padStart(7) +
    `${f(s.media)}R`.padStart(9) +
    `t=${s.t.toFixed(1)}`.padStart(8) +
    f(a.media).padStart(9) +
    f(b.media).padStart(9)
  );
}

const cab = ''.padEnd(28) + 'n'.padStart(5) + 'acerto'.padStart(7) + 'R/op'.padStart(9) + 't'.padStart(8) + '1.ª met'.padStart(9) + '2.ª met'.padStart(9);

if (process.env.RAZOES) {
  const par = process.env.RAZOES === '1' ? 'GBPJPY' : process.env.RAZOES;
  const r = correr(par);
  console.log(`${par}: ${r.ops?.length ?? 0} operações; o que aconteceu a cada MSS de 1M depois do varrimento:`);
  for (const [k, n] of [...razoes].sort((x, y) => y[1] - x[1])) console.log(`  ${k.padEnd(28)} ${String(n).padStart(6)}`);
  const hm = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
  for (const o of (r.ops ?? []).slice(0, Number(process.env.AMOSTRA ?? 0))) {
    const d = o.detalhe;
    console.log(
      `  ${hm(o.t)} UTC ${o.alta ? 'COMPRA' : 'VENDA '} Ásia ${d.asia[0]}–${d.asia[1]} · extremo ${d.extremo} (${hm(d.tExtremo)}) · swing ${d.nivel}` +
        ` · entrada ${d.entrada} · alvo ${d.alvo} (${o.rr.toFixed(2)}R) → ${o.saida} ${o.r.toFixed(2)}R às ${hm(d.fechoEm)}`,
    );
  }
  process.exit(0);
}

for (const [titulo, lista] of [
  ['AO VIVO (os pares da estratégia)', AO_VIVO],
  ['CONTROLO (pares que nunca entraram em escolha)', CONTROLO],
]) {
  console.log(`\n== Asia Range 1M · ${titulo} · MSS e entrada em 1M · 2022+ · custos ×${process.env.CUSTO_MULT ?? 1}\n${cab}`);
  const todas = [];
  razoes.clear();
  for (const par of lista) {
    const t0 = Date.now();
    const r = correr(par);
    if (r.erro) {
      console.log(`${par}: ${r.erro}`);
      continue;
    }
    todas.push(...r.ops);
    console.log(`${linha(`${par} (SMT ${r.ref})`, r.ops)}   ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  console.log('');
  console.log(linha('TODOS', todas));
  console.log(linha('  compras', todas.filter((o) => o.alta)));
  console.log(linha('  vendas', todas.filter((o) => !o.alta)));
  if (todas.length > 0) {
    const saidas = {};
    for (const o of todas) saidas[o.saida] = (saidas[o.saida] ?? 0) + 1;
    const rr = todas.reduce((a, o) => a + o.rr, 0) / todas.length;
    const ra = todas.reduce((a, o) => a + o.riscoAtr, 0) / todas.length;
    console.log(`  saídas: ${Object.entries(saidas).map(([k, n]) => `${k} ${n}`).join(' · ')} · RR planeado médio ${rr.toFixed(2)} · stop médio ${ra.toFixed(2)} ATR de 15M`);
    console.log(`  MSS de 1M: ${[...razoes].map(([k, n]) => `${k} ${n}`).join(' · ')}`);
  }
}
