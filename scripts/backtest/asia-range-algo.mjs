/**
 * Asia Range Algo — a medição da estratégia tal como corre ao vivo.
 *
 * Não reimplementa nada: chama `analisarAsiaRange` de `@trading/core`, a MESMA
 * função que o motor e o radar usam, em cada vela de 15M da janela de Londres
 * (08:00–10:00), com a confirmação em 3M incluída. Um sinal conta só na vela em
 * que a função o dá; um por dia e por sentido, como ao vivo.
 *
 * Simulação: entrada a mercado no fecho da vela do sinal, stop e alvo do sinal;
 * stop e alvo na mesma vela = stop; horizonte de 24h (a regra não tem saída por
 * tempo); custos de conta normal. Metades 2022-01→2024-06 e 2024-07→2026.
 *
 * Pares ao vivo: GBPJPY, USDJPY, EURJPY, USDCAD, com os pares de SMT do código
 * (`paresSmtIct`). Controlo: AUDJPY, CADJPY, CHFJPY, NZDJPY contra o USDJPY —
 * nunca entraram em escolha nenhuma.
 *
 * Precisa de SIMBOLO_15m.json e SIMBOLO_3m.json (scripts/backtest/baixar-histdata.mjs
 * com --tfs 3m,15m) e de SIMBOLO_1h.json para o diário.
 */

import { readFileSync } from 'node:fs';
import {
  agregar,
  analisarAsiaRange,
  custoTipico,
  opcoesPorTimeframe,
  paresSmtIct,
  relogioLondres,
  simularSinal,
} from '../../packages/core/dist/index.js';

const DIR = process.env.HISTDATA_DIR ?? 'E:/projecto Agnaldo 3.0/sistema de trading/data/backtest/histdata/';
const DESDE = Date.UTC(2022, 0, 10);
const CORTE = Date.UTC(2024, 6, 1);
const M15 = 900_000;
const HORA = 3_600_000;
/** Velas de 15M dadas à função em cada chamada: ~12 dias chegam para as estruturas. */
const JANELA_15M = 1200;

const AO_VIVO = ['GBPJPY', 'USDJPY', 'EURJPY', 'USDCAD'];
const CONTROLO = ['AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY'];

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

/** Com RAZOES=1: onde a análise parou, em cada vela da janela de Londres. */
const razoes = new Map();

function correr(par) {
  const v = ler(par, '15m');
  const v3 = ler(par, '3m');
  const h1 = ler(par, '1h');
  if (!v || !v3 || !h1) return { erro: `faltam dados (${!v ? '15m ' : ''}${!v3 ? '3m ' : ''}${!h1 ? '1h' : ''})` };
  // O primeiro par de SMT com dados de 15M, como no motor.
  // O primeiro par de SMT com dados de 15M, como no motor. Os pares de controlo
  // não estão na lista do código: os cruzados de iene usam o USDJPY, como nas notas.
  const refNome = paresSmtIct(par).find((p) => ler(p, '15m')) ?? (par.endsWith('JPY') ? 'USDJPY' : undefined);
  if (!refNome) return { erro: 'sem par de SMT com dados' };
  const ref = ler(refNome, '15m');
  const diarias = agregar(h1, '1d');
  const custo = custoTipico(par, v[v.length - 1].close);
  const opcoes = opcoesPorTimeframe('15m', custo);

  const ops = [];
  const vistos = new Set();
  const inicio = Math.max(JANELA_15M, primeira(v, Math.max(DESDE, v3[0].time + 8 * HORA)));
  for (let i = inicio; i < v.length - 1; i++) {
    const l = relogioLondres(v[i].time);
    // Só a janela onde a função pode dar sinal: vela abre 08:00–09:45 de Londres.
    if (l.minutos < 8 * 60 || l.minutos + 15 >= 10 * 60) continue;

    const velas = v.slice(i - JANELA_15M + 1, i + 1);
    const agora = v[i].time + M15;
    const parVelas = ref.slice(primeira(ref, velas[0].time), primeira(ref, agora));
    const ltf = v3.slice(primeira(v3, agora - 8 * HORA), primeira(v3, agora));
    const dias = diarias.slice(0, primeira(diarias, agora));

    const a = analisarAsiaRange({ simbolo: par, velas, diarias: dias, par: { simbolo: refNome, velas: parVelas }, ltf });
    if (process.env.RAZOES) razoes.set(a.porqueNao ?? 'SINAL', (razoes.get(a.porqueNao ?? 'SINAL') ?? 0) + 1);
    const s = a.sinal;
    if (!s || s.index !== velas.length - 1) continue;
    const chave = `${Math.floor((agora + HORA) / 86_400_000)}|${s.direccao}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    const sim = simularSinal(v, { ...s, tipoEntrada: 'mercado' }, i, opcoes);
    if (sim.r === null) continue;
    ops.push({ t: v[i].time, r: sim.r, alta: s.direccao === 'bullish', saida: sim.saida, rr: s.rr });
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
    `${(100 * s.acerto).toFixed(0)}%`.padStart(6) +
    `${f(s.media)}R`.padStart(9) +
    `t=${s.t.toFixed(1)}`.padStart(8) +
    f(a.media).padStart(9) +
    f(b.media).padStart(9)
  );
}

const cab = ''.padEnd(28) + 'n'.padStart(5) + 'acerto'.padStart(6) + 'R/op'.padStart(9) + 't'.padStart(8) + '1.ª met'.padStart(9) + '2.ª met'.padStart(9);

if (process.env.RAZOES) {
  const par = process.env.RAZOES === '1' ? 'GBPJPY' : process.env.RAZOES;
  const r = correr(par);
  console.log(`${par}: ${r.ops?.length ?? 0} sinais; onde parou, em cada vela das 08:00–10:00 de Londres:`);
  const total = [...razoes.values()].reduce((x, y) => x + y, 0);
  for (const [k, n] of [...razoes].sort((x, y) => y[1] - x[1])) console.log(`  ${k.padEnd(48)} ${String(n).padStart(6)}  ${((100 * n) / total).toFixed(1)}%`);
  process.exit(0);
}

for (const [titulo, lista] of [
  ['AO VIVO (os pares da estratégia)', AO_VIVO],
  ['CONTROLO (pares que nunca entraram em escolha)', CONTROLO],
]) {
  console.log(`\n== Asia Range Algo · ${titulo} · 15M + confirmação 3M · 2022+ · custos\n${cab}`);
  const todas = [];
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
    console.log(`  saídas: ${Object.entries(saidas).map(([k, n]) => `${k} ${n}`).join(' · ')} · RR planeado médio ${rr.toFixed(2)}`);
  }
}
