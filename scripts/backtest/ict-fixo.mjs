/**
 * ICT ALGO — o SETUP FIXO de 1H e o TIRO no timeframe baixo, medido em
 * 2022–2026 com as funções de produção:
 *
 *   escolha   `percorrerIct` (a carteira com quarentena, a do `correrIctAlgo`)
 *             diz, vela a vela de 1H, que setup o algoritmo escolhia
 *   arma      `armarSetupIct` — um setup de cada vez por instrumento; a mesma
 *             chave nunca se arma duas vezes
 *   tiro      `estadoDoSetup` — CHoCH/MSS do timeframe do gatilho depois do
 *             toque na zona, stop no extremo desde o toque
 *   saída     stop, alvo (os dois na mesma vela = stop) ou 24 h depois do tiro
 *             no fecho; custos de conta normal em R
 *
 * ── VARIANTES E REGRAS FIXADAS ANTES DE CORRER (29/09/2026) ───────────────
 *
 * Base: a de produção (zona = PD array, alvo móvel, gatilho 15M, 24 h, RR 2).
 * Quatro mudanças, das boas práticas ICT, para mais tiros e mais acerto:
 *   validade-48h   o setup de 1H vale 48 h (o preço demora a voltar ao FVG/OB)
 *   gatilho-5m     a reversão lê-se em 5M (mais cedo e com stop mais curto)
 *   toque-0.25atr  conta como toque chegar a ¼ ATR do gatilho da zona
 *   rr-1.5         o tiro sai com 1,5R (em vez de 2R)
 * Correm-se as 16 combinações, mas a escolha só olha para:
 *   1. as simples que batem a base no objectivo — R por semana (média × tiros
 *      por semana) na 1.ª metade (2022-01 → 2024-06), mercados principais;
 *   2. a combinação delas;
 *   3. vence a de maior objectivo entre a base, as simples e a combinação.
 * Validação: PASSA se a média for > 0 na 2.ª metade (2024-07 → 2026) dos
 * principais E > 0 nos mercados de controlo (todo o período).
 *
 *   MERCADO=EURUSD SAIDA_DIR=data/backtest/ict-fixo node … scripts/backtest/ict-fixo.mjs
 *   (um processo por mercado; CONTROLO=1 para os de controlo)
 *   AGREGAR=1 SAIDA_DIR=data/backtest/ict-fixo node scripts/backtest/ict-fixo.mjs
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  agregar,
  armarSetupIct,
  custoTipico,
  estadoDoSetup,
  opcoesPorTimeframe,
  percorrerIct,
  prepararEstruturas,
} from '../../packages/core/dist/index.js';

const DIR = 'E:/projecto Agnaldo 3.0/sistema de trading/data/backtest/histdata/';
const SAIDA_DIR = process.env.SAIDA_DIR ?? 'data/backtest/ict-fixo';
const DESDE = Date.UTC(2022, 0, 1);
const CORTE = Date.UTC(2024, 6, 1);
const M5 = 300_000;
const M15 = 900_000;
const H1 = 3_600_000;
const DIA = 86_400_000;
const SEMANA = 7 * DIA;
/** Velas do gatilho antes do setup (estrutura e ATR do timeframe baixo). */
const HISTORIA_GATILHO = 300;

const PRINCIPAIS = [
  ['EURUSD', 'EURUSD', 'GBPUSD'],
  ['GBPUSD', 'GBPUSD', 'EURUSD'],
  ['USDJPY', 'USDJPY', 'EURJPY'],
  ['EURJPY', 'EURJPY', 'GBPJPY'],
  ['XAUUSD', 'XAUUSD', 'XAGUSD'],
  ['GER30', 'GRXEUR', 'FRXEUR'],
];
const CONTROLO = [
  ['AUDUSD', 'AUDUSD', 'NZDUSD'],
  ['NZDUSD', 'NZDUSD', 'AUDUSD'],
  ['EURGBP', 'EURGBP', 'EURUSD'],
  ['USDCAD', 'USDCAD', 'USDCHF'],
  ['USDCHF', 'USDCHF', 'USDCAD'],
  ['GBPJPY', 'GBPJPY', 'EURJPY'],
];
const FACTORES = ['validade-48h', 'gatilho-5m', 'toque-0.25atr', 'rr-1.5'];
/** As 16 combinações, com nome "base" ou "f1+f2…". */
const COMBINACOES = [];
for (let m = 0; m < 1 << FACTORES.length; m++) {
  const fs = FACTORES.filter((_, k) => m & (1 << k));
  COMBINACOES.push({ nome: fs.length ? fs.join('+') : 'base', fs });
}

const ler = (f, tf) => {
  try {
    return JSON.parse(readFileSync(`${DIR}${f}_${tf}.json`, 'utf8'));
  } catch {
    return null;
  }
};
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
  if (n < 3) return { n, media: n ? rs.reduce((a, b) => a + b, 0) / n : 0, t: 0, acerto: n ? rs.filter((r) => r > 0).length / n : 0 };
  const m = rs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rs.reduce((a, r) => a + (r - m) ** 2, 0) / (n - 1));
  return { n, media: m, t: sd > 0 ? m / (sd / Math.sqrt(n)) : 0, acerto: rs.filter((r) => r > 0).length / n };
};

/** O tiro, depois de disparado: stop, alvo ou 24 h, nas velas do gatilho. */
function fecharTiro(v, passo, tiro, alta, custo) {
  const risco = Math.abs(tiro.entrada - tiro.stop);
  for (let k = primeira(v, tiro.time + passo); k < v.length; k++) {
    const c = v[k];
    if (c.time >= tiro.time + DIA) {
      const r = (alta ? c.open - tiro.entrada : tiro.entrada - c.open) / risco;
      return { r: r - custo / risco, fim: c.time };
    }
    if (alta ? c.low <= tiro.stop : c.high >= tiro.stop) return { r: -1 - custo / risco, fim: c.time + passo };
    if (alta ? c.high >= tiro.alvo : c.low <= tiro.alvo) return { r: tiro.rr - custo / risco, fim: c.time + passo };
  }
  return null;
}

function correrMercado([nome, ficheiro, parFicheiro]) {
  const velas = ler(ficheiro, '1h');
  const v15 = ler(ficheiro, '15m');
  const v5 = ler(ficheiro, '5m');
  const parVelas = ler(parFicheiro, '1h');
  if (!velas || !v15 || !v5 || velas.length < 3000) return null;
  const diarias = agregar(velas, '1d');
  const e = prepararEstruturas({
    simbolo: nome,
    timeframe: '1h',
    velas,
    diarias,
    semanais: agregar(velas, '1w'),
    referencia: diarias,
    timeframeReferencia: '1d',
    par: parVelas ? { simbolo: parFicheiro, velas: parVelas } : null,
  });
  const custo = custoTipico(nome, velas[velas.length - 1].close) * Number(process.env.CUSTO_MULT ?? 1);
  let desde = velas.findIndex((c) => c.time >= DESDE);
  if (desde < 300) desde = 300;
  // Os dois timeframes baixos têm de cobrir o período.
  const inicioBaixo = Math.max(v15[HISTORIA_GATILHO]?.time ?? Infinity, v5[HISTORIA_GATILHO]?.time ?? Infinity);
  while (desde < velas.length && velas[desde].time < inicioBaixo) desde++;
  const fimBaixo = Math.min(v15[v15.length - 1].time, v5[v5.length - 1].time);

  // 1 — O setup que o algoritmo escolhia em cada vela (carteira com quarentena).
  const escolhido = new Map();
  percorrerIct(e, desde, velas.length - 1, opcoesPorTimeframe('1h', custo), 'borda', (s, i, carteira) => {
    if (carteira === 'comQuarentena') escolhido.set(i, s);
    return false;
  });
  const indices = [...escolhido.keys()].sort((a, b) => a - b);

  // 2 — Setup fixo e tiro, por combinação.
  const out = { nome, semanas: (fimBaixo - velas[desde].time) / SEMANA, semanasTreino: Math.max(0, (Math.min(CORTE, fimBaixo) - velas[desde].time) / SEMANA), combinacoes: {} };
  for (const c of COMBINACOES) {
    const tem = (f) => c.fs.includes(f);
    const serie = tem('gatilho-5m') ? v5 : v15;
    const passo = tem('gatilho-5m') ? M5 : M15;
    const validade = tem('validade-48h') ? 2 * DIA : DIA;
    const opcoes = { alvoMovel: true, passoMs: passo, toleranciaAtr: tem('toque-0.25atr') ? 0.25 : 0, rrMinimo: tem('rr-1.5') ? 1.5 : 2 };
    const ops = [];
    const fins = { tiro: 0, invalidado: 0, expirado: 0 };
    let livre = 0;
    let armados = 0;
    const usadas = new Set();
    for (const i of indices) {
      const s = escolhido.get(i);
      const fecho = velas[i].time + H1;
      if (fecho < livre || usadas.has(s.chave) || fecho + validade > fimBaixo) continue;
      const setup = armarSetupIct({ simbolo: nome, sinal: s, lidas: { '1h': i + 1 }, passos: [] }, fecho);
      if (!setup) continue;
      setup.expiraEm = fecho + validade;
      usadas.add(s.chave);
      armados++;
      const a = Math.max(0, primeira(serie, fecho) - HISTORIA_GATILHO);
      const b = primeira(serie, setup.expiraEm + passo);
      const st = estadoDoSetup(setup, serie.slice(a, b), setup.expiraEm + passo, opcoes);
      if (st.estado !== 'disparado') {
        fins[st.estado === 'invalidado' ? 'invalidado' : 'expirado']++;
        livre = st.estado === 'invalidado' ? st.em + passo : setup.expiraEm;
        continue;
      }
      fins.tiro++;
      const alta = setup.direccao === 'bullish';
      const fx = fecharTiro(serie, passo, st.tiro, alta, custo);
      if (!fx) break;
      ops.push({ t: st.tiro.time, r: fx.r, rr: st.tiro.rr, alta });
      livre = fx.fim;
    }
    out.combinacoes[c.nome] = { ops, fins, armados };
  }
  return out;
}

const f = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(3)}`;

if (process.env.AGREGAR) {
  const ficheiros = readdirSync(SAIDA_DIR).filter((x) => x.endsWith('.json'));
  const mercados = ficheiros.map((x) => JSON.parse(readFileSync(`${SAIDA_DIR}/${x}`, 'utf8')));
  const principais = mercados.filter((m) => PRINCIPAIS.some((p) => p[0] === m.nome));
  const controlo = mercados.filter((m) => CONTROLO.some((p) => p[0] === m.nome));
  const resumo = (nome) => {
    const ops = principais.flatMap((m) => m.combinacoes[nome].ops);
    const opsC = controlo.flatMap((m) => m.combinacoes[nome].ops);
    const semanas = principais.reduce((a, m) => a + m.semanas, 0);
    const semanasTreino = principais.reduce((a, m) => a + m.semanasTreino, 0);
    const treino = est(ops.filter((o) => o.t < CORTE).map((o) => o.r));
    const teste = est(ops.filter((o) => o.t >= CORTE).map((o) => o.r));
    const todos = est(ops.map((o) => o.r));
    // Tiros por semana nos 10 instrumentos do ICT ALGO (a média por mercado × 10).
    const porSemana = (ops.length / semanas) * 10;
    return { nome, treino, teste, controlo: est(opsC.map((o) => o.r)), todos, porSemana, objectivo: treino.media * (treino.n / semanasTreino) * 10 };
  };
  console.log(`== ICT fixo — ${principais.length} principais, ${controlo.length} de controlo · 2022+ · custos`);
  const todas = COMBINACOES.map((c) => resumo(c.nome));
  for (const r of todas) {
    console.log(
      `${r.nome.padEnd(46)} ${String(r.todos.n).padStart(4)} · ${r.porSemana.toFixed(2)}/sem nos 10 · acerto ${(r.todos.acerto * 100).toFixed(0).padStart(2)}% · ` +
        `treino ${f(r.treino.media)} (${r.treino.n}) · teste ${f(r.teste.media)} (${r.teste.n}) · controlo ${f(r.controlo.media)} (${r.controlo.n}) · objectivo ${f(r.objectivo)}`,
    );
  }
  const base = todas.find((r) => r.nome === 'base');
  const melhores = todas.filter((r) => FACTORES.includes(r.nome) && r.objectivo > base.objectivo);
  const nomeComb = melhores.length >= 2 ? FACTORES.filter((x) => melhores.some((m) => m.nome === x)).join('+') : null;
  const candidatas = [base, ...todas.filter((r) => FACTORES.includes(r.nome)), ...(nomeComb ? [todas.find((r) => r.nome === nomeComb)] : [])];
  const vencedor = candidatas.sort((a, b) => b.objectivo - a.objectivo)[0];
  const passa = vencedor.teste.media > 0 && vencedor.controlo.media > 0;
  console.log(`\nMelhoram a base no treino: ${melhores.map((r) => r.nome).join(', ') || 'nenhuma'}${nomeComb ? ` · combinação: ${nomeComb}` : ''}`);
  console.log(`Vencedor no treino: ${vencedor.nome} · teste ${f(vencedor.teste.media)} · controlo ${f(vencedor.controlo.media)} → ${passa ? 'PASSA' : 'NÃO PASSA'}`);
} else {
  const lista = (process.env.CONTROLO ? CONTROLO : PRINCIPAIS).filter((m) => !process.env.MERCADO || m[0] === process.env.MERCADO);
  mkdirSync(SAIDA_DIR, { recursive: true });
  for (const m of lista) {
    const t0 = Date.now();
    const r = correrMercado(m);
    if (!r) {
      console.log(`${m[0]}: sem dados`);
      continue;
    }
    writeFileSync(`${SAIDA_DIR}/${m[0]}.json`, JSON.stringify(r));
    const b = r.combinacoes.base;
    console.log(`${m[0]}: base ${b.ops.length} tiros de ${b.armados} setups (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
}
