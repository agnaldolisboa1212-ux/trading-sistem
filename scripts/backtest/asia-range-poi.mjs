/**
 * Asia Range POI — a estratégia do journal tal como o Agnaldo a descreveu
 * (26/09/2026), com os prints do TradingView como contexto.
 *
 * Regras fixadas ANTES de medir, para correr uma só vez:
 *
 *   1  POI (15M)   os topos e fundos dos últimos 3 dias de negociação que o
 *                  preço ainda não voltou a tocar às 08:00 de Londres: swings de
 *                  15M com 8 velas (2 h) de cada lado. A zona vai do pavio ao
 *                  corpo da vela do extremo (as caixas roxa e azul dos prints):
 *                  topo → [max(abertura, fecho), máximo]; fundo → [mínimo,
 *                  min(abertura, fecho)]
 *   2  Viés        a estrutura de mercado em 15M: o lado da última quebra de
 *                  estrutura (BOS/CHoCH/MSS — as linhas vermelhas) confirmada
 *                  até às 08:00. Baixa → só vendas em POI acima do preço;
 *                  alta → só compras em POI abaixo
 *   3  Ásia        das 00:00 às 08:00 de Londres
 *   4  Janela      das 08:00 às 11:00 de Londres (antes da sobreposição com
 *                  Nova Iorque): a vela de 1M da entrada fecha antes das 11:00
 *   5  Toque       o preço entra na zona do POI. O POI deixa de valer se o
 *                  preço passar o extremo da zona em mais de ½ ATR de 15M
 *   6  Entrada     reversão em 1M no POI: o primeiro fecho de 1M além do último
 *                  swing de 1M (2 velas de cada lado) confirmado antes do
 *                  extremo feito no POI. Entrada a mercado no fecho dessa vela
 *   7  Stop        além do POI: o mais afastado entre o extremo da zona e o
 *                  extremo que o preço fez; pelo menos ¼ de ATR de 15M (a
 *                  regra de produção)
 *   8  Alvo        a liquidez do lado oposto, por tomar: o extremo oposto da
 *                  Ásia ou um topo/fundo de 15M dos últimos 3 dias para lá dele
 *                  — o mais próximo que pague pelo menos 2R
 *
 * VERSÃO C (VERSAO=C), fixada antes de correr, a partir do desenho do Agnaldo
 * (26/09/2026: "POI em micro timeframe", "MSS em micro estrutura"): os passos
 * 1–6 iguais; depois do MSS de 1M a entrada NÃO é a mercado — é uma ordem
 * limite no micro-POI, o order block de 1M que originou o MSS (a última vela
 * de 1M contra o trade entre 10 velas antes do extremo e o MSS; venda: a última
 * vela de alta, zona [abertura, máximo], limite na abertura). A ordem vale 60
 * minutos; se o preço for ao alvo antes, não há trade. Stop e alvo como na
 * versão A, medidos a partir do preço limite. Um trade por dia.
 *
 * SMT (confluência, só em C): entre as 08:00 e o extremo feito no POI, o par
 * correlacionado andou ao contrário (GBPJPY sobe ao POI, USDJPY desce). Mede-se
 * à parte ("com SMT"), sem mudar a regra principal.
 *
 * Uma operação por dia e por par. Simulação em 1M: stop e alvo na mesma vela =
 * stop; horizonte de 24 h; custos de conta normal (`custoTipico`), em R.
 * Metades 2022-01→2024-06 / 2024-07→2026.
 *
 * Passa se: positiva nas duas metades, t ≥ 1,5 E positiva nos pares de
 * controlo (AUDJPY, CADJPY, CHFJPY, NZDJPY), que nunca entraram em escolha.
 *
 *   node --max-old-space-size=6000 scripts/backtest/asia-range-poi.mjs
 *   RAZOES=GBPJPY …        onde os dias param
 *   CUSTO_MULT=0 …         o diagnóstico sem custos
 */

import { existsSync, readFileSync } from 'node:fs';
import {
  custoTipico,
  diaLondres,
  quebrasDeEstrutura,
  relogioLondres,
  serieAtrIct,
  paresSmtIct,
  simularSinal,
  swingsConfirmados,
  ultimaFechadaAte,
} from '../../packages/core/dist/index.js';

const DIR = process.env.HISTDATA_DIR ?? 'E:/projecto Agnaldo 3.0/sistema de trading/data/backtest/histdata/';
const DESDE = Date.UTC(2022, 0, 10);
const CORTE = Date.UTC(2024, 6, 1);
const M1 = 60_000;
const M15 = 900_000;
const HORA = 3_600_000;
const DIA = 86_400_000;

const LOOKBACK_POI = 8;
const DIAS_POI = 3;
const INVALIDA_ATR = 0.5;
const RISCO_MINIMO_ATR = 0.25;
const RR_MINIMO = 2;
const HORIZONTE_1M = 1440;
const FIM_JANELA = 11 * 60;
/** A versão: A (entrada a mercado no MSS) ou C (limite no micro-POI). */
const VERSAO = process.env.VERSAO === 'C' ? 'C' : 'A';
/** Velas de 1M antes do extremo onde se procura o order block de 1M. */
const OB_ANTES = 10;
/** Validade da ordem limite, em velas de 1M. */
const ESPERA_LIMITE = 60;

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

const est = (rs) => {
  const n = rs.length;
  if (n < 3) return { n, media: 0, t: 0, acerto: 0 };
  const m = rs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rs.reduce((a, r) => a + (r - m) ** 2, 0) / (n - 1));
  return { n, media: m, t: sd > 0 ? m / (sd / Math.sqrt(n)) : 0, acerto: rs.filter((r) => r > 0).length / n };
};

const razoes = new Map();
const razao = (r) => razoes.set(r, (razoes.get(r) ?? 0) + 1);

export function correr(par) {
  if (!existe(par, '1m') || !existe(par, '15m')) return { erro: 'faltam dados de 1M ou 15M' };
  const v1 = ler(par, '1m');
  const v15 = ler(par, '15m');
  const custo = custoTipico(par, v1[v1.length - 1].close) * Number(process.env.CUSTO_MULT ?? 1);
  const opcoes = { espera: VERSAO === 'C' ? ESPERA_LIMITE : 0, horizonte: HORIZONTE_1M, custo };
  // O par do SMT (só para a medição da confluência na versão C).
  const refNome = VERSAO === 'C'
    ? (paresSmtIct(par).find((p) => p !== par && existe(p, '1m')) ?? (par.endsWith('JPY') && par !== 'USDJPY' ? 'USDJPY' : null))
    : null;
  const r1 = refNome ? ler(refNome, '1m') : null;

  // ── 15M, calculado uma vez: tudo tem `confirmadoEm`, lê-se só o conhecido às 08:00.
  const atr15 = serieAtrIct(v15);
  const quebras = quebrasDeEstrutura(v15, swingsConfirmados(v15), atr15);
  const swingsPoi = swingsConfirmados(v15, LOOKBACK_POI);
  // Dias de negociação (de Londres) do 15M, por ordem, para "os últimos 3 dias".
  const diasNeg = [];
  for (let i = 0; i < v15.length; i++) {
    const d = diaLondres(v15[i].time);
    if (diasNeg[diasNeg.length - 1] !== d) diasNeg.push(d);
  }
  // Máximos e mínimos acumulados de 15M não servem para "por tocar" (depende do
  // intervalo); verifica-se à mão, só nos poucos swings da janela.
  const tocadoAte = (s, iAte) => {
    for (let k = s.index + 1; k <= iAte; k++) {
      if (s.kind === 'high' ? v15[k].high >= s.price : v15[k].low <= s.price) return true;
    }
    return false;
  };

  const ops = [];
  let iq = 0;
  let k = primeira(v1, DESDE);
  while (k < v1.length) {
    const dia = diaLondres(v1[k].time);
    let i08 = k;
    while (i08 < v1.length && diaLondres(v1[i08].time) === dia && relogioLondres(v1[i08].time).minutos < 8 * 60) i08++;
    const semJanela =
      i08 >= v1.length || diaLondres(v1[i08].time) !== dia || relogioLondres(v1[i08].time).minutos >= FIM_JANELA;
    if (!semJanela) {
      const r = umDia(dia, i08);
      if (r) ops.push(r);
    }
    while (k < v1.length && diaLondres(v1[k].time) === dia) k++;
  }
  return { ops, ref: refNome };

  /** Um dia: POI, viés, e a entrada se houver. */
  function umDia(dia, i08) {
    const t08 = v1[i08].time;
    // Última vela de 15M fechada às 08:00.
    const j = ultimaFechadaAte(v15, M15, t08);
    if (j < 200) return null;
    // Regra de dados (não da estratégia): o 15M tem de chegar às 08:00 deste dia.
    // Alguns ficheiros de 15M acabam antes do 1M; sem isto, o viés e os POI
    // seriam os de semanas antes.
    if (v15[j].time + M15 < t08 - 30 * 60_000) return null;
    const atr = atr15[j];
    if (!(atr > 0)) return null;

    // 2 — viés: a última quebra de estrutura confirmada até j.
    while (iq + 1 < quebras.length && quebras[iq + 1].confirmadoEm <= j) iq++;
    const q = quebras[iq];
    if (!q || q.confirmadoEm > j) {
      razao('sem estrutura');
      return null;
    }
    const venda = q.lado === 'bearish';

    // 3 — Ásia (00:00–08:00 de Londres), em 1M.
    let asiaAlto = -Infinity;
    let asiaBaixo = Infinity;
    let nAsia = 0;
    for (let a = i08 - 1; a >= 0 && diaLondres(v1[a].time) === dia; a--) {
      asiaAlto = Math.max(asiaAlto, v1[a].high);
      asiaBaixo = Math.min(asiaBaixo, v1[a].low);
      nAsia++;
    }
    if (nAsia < 240) {
      razao('Ásia com poucas velas');
      return null;
    }

    // 1 — POI dos últimos 3 dias de negociação, por tocar às 08:00.
    const pos = diasNeg.indexOf(dia);
    if (pos < DIAS_POI) return null;
    const desdeDia = diasNeg[pos - DIAS_POI];
    const candidatos = [];
    const opostos = [];
    for (let s = swingsPoi.length - 1; s >= 0; s--) {
      const w = swingsPoi[s];
      if (w.confirmadoEm > j) continue;
      const dw = diaLondres(v15[w.index].time);
      if (dw < desdeDia) break;
      if (dw >= dia) continue;
      if (tocadoAte(w, j)) continue;
      const c = v15[w.index];
      if (w.kind === 'high') {
        const zona = { baixo: Math.max(c.open, c.close), alto: c.high, extremo: c.high };
        if (venda) candidatos.push(zona);
        else opostos.push(c.high);
      } else {
        const zona = { baixo: c.low, alto: Math.min(c.open, c.close), extremo: c.low };
        if (!venda) candidatos.push(zona);
        else opostos.push(c.low);
      }
    }
    const abertura = v1[i08].open;
    // No lado do viés, à frente do preço das 08:00.
    const pois = candidatos
      .filter((z) => (venda ? z.baixo > abertura : z.alto < abertura))
      .map((z) => ({ ...z, tocado: false, invalido: false, ext: venda ? -Infinity : Infinity, iExt: -1, avaliado: -1 }));
    if (pois.length === 0) {
      razao('sem POI por tocar do lado do viés');
      return null;
    }

    // Swings de 1M das 03:00 às 11:00 de Londres (as 300 velas que o motor teria).
    let iFim = i08;
    while (iFim + 1 < v1.length && diaLondres(v1[iFim + 1].time) === dia && relogioLondres(v1[iFim + 1].time).minutos + 1 < FIM_JANELA) iFim++;
    const s0 = primeira(v1, t08 - 5 * HORA);
    const swings1 = swingsConfirmados(v1.slice(s0, iFim + 3)).map((w) => ({ ...w, index: w.index + s0, confirmadoEm: w.confirmadoEm + s0 }));

    let maxDesde08 = -Infinity;
    let minDesde08 = Infinity;
    let tocouAlgum = false;
    for (let qd = i08; qd <= iFim; qd++) {
      const c = v1[qd];
      maxDesde08 = Math.max(maxDesde08, c.high);
      minDesde08 = Math.min(minDesde08, c.low);
      for (const p of pois) {
        if (p.invalido) continue;
        // 5 — toque e invalidação.
        if (!p.tocado && (venda ? c.high >= p.baixo : c.low <= p.alto)) p.tocado = true;
        if (!p.tocado) continue;
        tocouAlgum = true;
        if (venda ? c.high > p.ext : c.low < p.ext) {
          p.ext = venda ? c.high : c.low;
          p.iExt = qd;
        }
        if (venda ? p.ext > p.extremo + INVALIDA_ATR * atr : p.ext < p.extremo - INVALIDA_ATR * atr) {
          p.invalido = true;
          continue;
        }
        if (qd <= p.iExt || p.avaliado === p.iExt) continue;
        // 6 — MSS de 1M: o último swing do lado oposto antes do extremo.
        let nivel = null;
        for (let s = swings1.length - 1; s >= 0; s--) {
          const w = swings1[s];
          if (w.index >= p.iExt || w.confirmadoEm > qd) continue;
          if (w.kind === (venda ? 'low' : 'high')) {
            nivel = w.price;
            break;
          }
        }
        if (nivel === null || !(venda ? c.close < nivel : c.close > nivel)) continue;
        p.avaliado = p.iExt;

        // Versão C: a entrada é uma ordem limite no micro-POI (o order block de 1M).
        let entrada = c.close;
        if (VERSAO === 'C') {
          let iOb = -1;
          for (let x = qd - 1; x >= Math.max(0, p.iExt - OB_ANTES); x--) {
            const v = v1[x];
            if (venda ? v.close > v.open : v.close < v.open) {
              iOb = x;
              break;
            }
          }
          if (iOb < 0) {
            razao('sem order block de 1M');
            continue;
          }
          entrada = v1[iOb].open;
          if (venda ? entrada <= c.close : entrada >= c.close) {
            razao('order block do lado errado do fecho');
            continue;
          }
        }
        // 7 — stop além do POI.
        const stop = venda ? Math.max(p.extremo, p.ext) : Math.min(p.extremo, p.ext);
        const risco = venda ? stop - entrada : entrada - stop;
        if (!(risco >= RISCO_MINIMO_ATR * atr)) {
          razao('stop demasiado curto');
          continue;
        }
        // 8 — alvo: liquidez oposta por tomar, no extremo da Ásia ou para lá dele.
        const asiaOposto = venda ? asiaBaixo : asiaAlto;
        const niveis = [asiaOposto, ...opostos.filter((x) => (venda ? x < asiaOposto : x > asiaOposto))]
          // Por tomar: Londres ainda não lá chegou.
          .filter((x) => (venda ? x < minDesde08 && x < entrada : x > maxDesde08 && x > entrada))
          .map((x) => ({ preco: x, rr: Math.abs(entrada - x) / risco }))
          .filter((a) => a.rr >= RR_MINIMO)
          .sort((a, b) => (venda ? b.preco - a.preco : a.preco - b.preco));
        const alvo = niveis[0];
        if (!alvo) {
          razao('nenhum alvo paga 2R');
          continue;
        }
        razao('ENTRADA');
        const sim = simularSinal(
          v1,
          {
            direccao: venda ? 'bearish' : 'bullish',
            entrada,
            stop,
            alvo: alvo.preco,
            rr: alvo.rr,
            tipoEntrada: VERSAO === 'C' ? 'limite' : 'mercado',
          },
          qd,
          opcoes,
        );
        if (sim.r === null) {
          razao(`ordem não preenchida (${sim.saida})`);
          return null;
        }
        // SMT: do 08:00 ao extremo, o par correlacionado andou ao contrário.
        let smt = null;
        if (r1) {
          const a0 = primeira(r1, t08);
          const a1 = primeira(r1, v1[p.iExt].time + M1) - 1;
          if (a0 < r1.length && a1 > a0) {
            const nosso = v1[p.iExt].close - v1[i08].open;
            const dele = r1[a1].close - r1[a0].open;
            smt = Math.sign(nosso) !== 0 && Math.sign(dele) === -Math.sign(nosso);
          }
        }
        return {
          t: c.time,
          r: sim.r,
          alta: !venda,
          saida: sim.saida,
          rr: alvo.rr,
          riscoAtr: risco / atr,
          smt,
          detalhe: { poi: [p.baixo, p.alto], ext: p.ext, tExt: v1[p.iExt].time, nivel, entrada, stop, alvo: alvo.preco, asia: [asiaBaixo, asiaAlto], estrutura: q.tipo, fecho: v1[sim.fechoEm]?.time },
        };
      }
    }
    razao(tocouAlgum ? 'tocou o POI sem entrada válida' : 'Londres não chegou ao POI');
    return null;
  }
}

function linha(rotulo, ops) {
  if (ops.length < 15) return `${rotulo.padEnd(24)}${String(ops.length).padStart(5)}  (poucas)`;
  const s = est(ops.map((o) => o.r));
  const a = est(ops.filter((o) => o.t < CORTE).map((o) => o.r));
  const b = est(ops.filter((o) => o.t >= CORTE).map((o) => o.r));
  const passa = a.media > 0 && b.media > 0 && s.t >= 1.5;
  const f = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(3)}`;
  return (
    ((passa ? 'OK ' : '   ') + rotulo).padEnd(24) +
    String(s.n).padStart(5) +
    `${(100 * s.acerto).toFixed(0)}%`.padStart(7) +
    `${f(s.media)}R`.padStart(9) +
    `t=${s.t.toFixed(1)}`.padStart(8) +
    f(a.media).padStart(9) +
    f(b.media).padStart(9)
  );
}

const cab = ''.padEnd(24) + 'n'.padStart(5) + 'acerto'.padStart(7) + 'R/op'.padStart(9) + 't'.padStart(8) + '1.ª met'.padStart(9) + '2.ª met'.padStart(9);

if (process.env.RAZOES) {
  const par = process.env.RAZOES === '1' ? 'GBPJPY' : process.env.RAZOES;
  const r = correr(par);
  console.log(`${par}: ${r.ops?.length ?? 0} operações ${r.erro ?? ''}; onde os dias pararam:`);
  for (const [k, n] of [...razoes].sort((x, y) => y[1] - x[1])) console.log(`  ${k.padEnd(36)} ${String(n).padStart(6)}`);
  const hm = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
  for (const o of (r.ops ?? []).slice(0, Number(process.env.AMOSTRA ?? 0))) {
    const d = o.detalhe;
    console.log(
      `  ${hm(o.t)} UTC ${o.alta ? 'COMPRA' : 'VENDA '} (${d.estrutura}) POI ${d.poi[0]}–${d.poi[1]} · extremo ${d.ext} ${hm(d.tExt)} · swing 1M ${d.nivel}` +
        ` · entrada ${d.entrada} stop ${d.stop} alvo ${d.alvo} (${o.rr.toFixed(1)}R) · Ásia ${d.asia[0]}–${d.asia[1]} → ${o.saida} ${o.r.toFixed(2)}R às ${hm(d.fecho)}`,
    );
  }
  process.exit(0);
}

for (const [titulo, lista] of [
  ['AO VIVO (journal + prints)', AO_VIVO],
  ['CONTROLO (nunca entraram em escolha)', CONTROLO],
]) {
  console.log(`\n== Asia Range POI ${VERSAO} · ${titulo} · 2022+ · custos ×${process.env.CUSTO_MULT ?? 1}\n${cab}`);
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
    console.log(`${linha(par + (r.ref ? ` (SMT ${r.ref})` : ''), r.ops)}   ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  console.log('');
  console.log(linha('TODOS', todas));
  console.log(linha('  compras', todas.filter((o) => o.alta)));
  console.log(linha('  vendas', todas.filter((o) => !o.alta)));
  if (VERSAO === 'C') {
    console.log(linha('  com SMT', todas.filter((o) => o.smt === true)));
    console.log(linha('  sem SMT', todas.filter((o) => o.smt === false)));
  }
  if (todas.length > 0) {
    const saidas = {};
    for (const o of todas) saidas[o.saida] = (saidas[o.saida] ?? 0) + 1;
    const rr = todas.reduce((a, o) => a + o.rr, 0) / todas.length;
    const ra = todas.reduce((a, o) => a + o.riscoAtr, 0) / todas.length;
    console.log(`  saídas: ${Object.entries(saidas).map(([x, n]) => `${x} ${n}`).join(' · ')} · RR planeado médio ${rr.toFixed(2)} · stop médio ${ra.toFixed(2)} ATR de 15M`);
    console.log(`  dias: ${[...razoes].map(([x, n]) => `${x} ${n}`).join(' · ')}`);
  }
}
