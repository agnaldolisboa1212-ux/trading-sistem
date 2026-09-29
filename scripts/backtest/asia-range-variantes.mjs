/**
 * Asia Range — variantes para MAIS SINAIS e MAIS ACERTO, sem sobreajuste
 * (pedido do Agnaldo, 29/09/2026).
 *
 * Corre as funções de PRODUÇÃO (`poisDeSessao` + `tiroPoi`, com as suas opções)
 * dia a dia, uma sessão de cada vez; simulação em 1M a partir do fecho da vela
 * do MSS (stop e alvo na mesma vela = stop; 24 h; custos de conta normal).
 *
 * ── REGRAS FIXADAS ANTES DE CORRER ─────────────────────────────────────────
 *
 * Variantes (uma mudança de cada vez sobre a base de produção), das boas
 * práticas ICT e do journal:
 *   janela-12h / janela-13h   a janela de Londres até às 12:00 / 13:00
 *   nova-iorque               + a sessão de Nova Iorque (13:00–16:00, leitura às 13:00)
 *   poi-5-dias                POI dos 5 dias anteriores (em vez de 3)
 *   poi-lookback-4            topos/fundos com 4 velas de cada lado (em vez de 8)
 *   rr-1.5                    alvo: a liquidez mais próxima que pague 1,5R
 *   alvo-2R-fixo              alvo fixo a 2R (sem esperar pela liquidez)
 *   exigir-smt                só com SMT a favor
 *   vies-diario               só quando o viés diário (as 5 perguntas) concorda com a estrutura de 15M
 *
 * Escolha — SÓ na 1.ª metade (2022-01 → 2024-06) e só nos pares ao vivo:
 *   objectivo = R por semana (média × sinais por semana): premeia mais sinais e
 *   mais acerto ao mesmo tempo, e castiga mais sinais que perdem.
 *   1. as variantes simples que batem a base no objectivo;
 *   2. a combinação delas (dos grupos em conflito — janela; alvo — fica a melhor);
 *   3. vence a de maior objectivo entre a base, as simples e a combinação.
 * Validação — o vencedor PASSA se: média > 0 na 2.ª metade (2024-07 → 2026)
 *   dos pares ao vivo E média > 0 nos pares de controlo (todo o período).
 *   Só uma variante que passa vai para produção.
 *
 *   node --max-old-space-size=7000 scripts/backtest/asia-range-variantes.mjs
 *   FASE=2 …   corre a combinação escolhida pela fase 1 (lê SAIDA da fase 1)
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  agregar,
  custoTipico,
  paresSmtIct,
  poisDeSessao,
  prepararEstruturas,
  relogioLondres,
  diaLondres,
  simularSinal,
  tiroPoi,
  ultimaFechadaAte,
  viesDoDia,
} from '../../packages/core/dist/index.js';

const DIR = process.env.HISTDATA_DIR ?? 'E:/projecto Agnaldo 3.0/sistema de trading/data/backtest/histdata/';
const SAIDA = process.env.SAIDA ?? 'data/backtest/asia-variantes.json';
const DESDE = Date.UTC(2022, 0, 10);
const CORTE = Date.UTC(2024, 6, 1);
const M1 = 60_000;
const M15 = 900_000;
const HORA = 3_600_000;
const DIA = 86_400_000;
const SEMANA = 7 * DIA;

const AO_VIVO = ['GBPJPY', 'USDJPY', 'EURJPY', 'USDCAD', 'GBPUSD', 'EURUSD'];
const CONTROLO = ['AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY'];

const BASE = {};
const SIMPLES = {
  'janela-12h': { janela: { de: 480, ate: 720 } },
  'janela-13h': { janela: { de: 480, ate: 780 } },
  'nova-iorque': { ny: true },
  'poi-5-dias': { dias: 5 },
  'poi-lookback-4': { lookback: 4 },
  'rr-1.5': { rrMinimo: 1.5 },
  'alvo-2R-fixo': { alvo: 'fixo' },
  'exigir-smt': { exigirSmt: true },
  'vies-diario': { viesDiario: true },
};
const GRUPOS = [['janela-12h', 'janela-13h'], ['rr-1.5', 'alvo-2R-fixo']];

const ler = (par, tf) => (existsSync(`${DIR}${par}_${tf}.json`) ? JSON.parse(readFileSync(`${DIR}${par}_${tf}.json`, 'utf8')) : null);
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
  if (n < 3) return { n, media: n ? rs.reduce((a, b) => a + b, 0) / n : 0, t: 0, acerto: 0 };
  const m = rs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rs.reduce((a, r) => a + (r - m) ** 2, 0) / (n - 1));
  return { n, media: m, t: sd > 0 ? m / (sd / Math.sqrt(n)) : 0, acerto: rs.filter((r) => r > 0).length / n };
};

/** Todas as variantes pedidas, num par: as operações de cada uma. */
function correrPar(par, variantes) {
  const v1 = ler(par, '1m');
  const v15 = ler(par, '15m');
  const h1 = ler(par, '1h');
  if (!v1 || !v15 || !h1) return null;
  const refNome = paresSmtIct(par).find((p) => existsSync(`${DIR}${p}_15m.json`)) ?? (par.endsWith('JPY') && par !== 'USDJPY' ? 'USDJPY' : null);
  const r15 = refNome ? ler(refNome, '15m') : null;
  const custo = custoTipico(par, v1[v1.length - 1].close);
  const opSim = { espera: 0, horizonte: 1440, custo };

  // O viés diário (as 5 perguntas), com as estruturas de 1H calculadas uma vez.
  const precisaVies = Object.values(variantes).some((o) => o.viesDiario);
  const e = precisaVies
    ? prepararEstruturas({ simbolo: par, timeframe: '1h', velas: h1, diarias: agregar(h1, '1d'), semanais: agregar(h1, '1w'), referencia: agregar(h1, '1d'), timeframeReferencia: '1d' })
    : null;
  const viesEm = (t) => {
    const iDia = ultimaFechadaAte(e.diarias, DIA, t);
    const iSem = ultimaFechadaAte(e.semanais, SEMANA, t);
    if (iDia < 20 || iSem < 4) return 'neutral';
    return viesDoDia({ velasDiarias: e.diarias, iDia, swingsSemanais: e.swingsSemanais, iSemanal: iSem, pocasDiarias: e.pocasDiarias }).direccao;
  };

  // Os dias de Londres com velas de 1M, e o primeiro índice de cada um.
  const dias = [];
  for (let k = primeira(v1, DESDE); k < v1.length; ) {
    const d = diaLondres(v1[k].time);
    dias.push(k);
    while (k < v1.length && diaLondres(v1[k].time) === d) k++;
  }

  const out = {};
  for (const [nome, o] of Object.entries(variantes)) {
    const sessoes = [o.janela ?? { de: 480, ate: 660 }, ...(o.ny ? [{ de: 780, ate: 960 }] : [])];
    const ops = [];
    for (const k0 of dias) {
      const d = diaLondres(v1[k0].time);
      for (const janela of sessoes) {
        // Primeira vela de 1M da sessão, neste dia.
        let k = k0;
        while (k < v1.length && diaLondres(v1[k].time) === d && relogioLondres(v1[k].time).minutos < janela.de) k++;
        if (k >= v1.length || diaLondres(v1[k].time) !== d || relogioLondres(v1[k].time).minutos >= janela.ate) continue;
        const agora = v1[k].time;
        const i15 = primeira(v15, agora - M15 + 1); // velas de 15M fechadas até agora
        if (i15 < 200) continue;
        // Regra de dados: o 15M tem de chegar até esta sessão.
        if (v15[i15 - 1].time + M15 < agora - 30 * M1) continue;
        const leitura = poisDeSessao(v15.slice(Math.max(0, i15 - 800), i15), agora, { janela, dias: o.dias, lookback: o.lookback });
        if (!leitura || leitura.provisoria) continue;
        if (o.viesDiario && viesEm(agora) !== leitura.vies) continue;
        const a = primeira(v1, leitura.inicio - 5 * HORA);
        const b = primeira(v1, leitura.fim);
        const parVelas = r15 ? r15.slice(primeira(r15, leitura.inicio - DIA), primeira(r15, leitura.fim)) : null;
        const r = tiroPoi(leitura, v1.slice(a, b), leitura.fim, parVelas, { rrMinimo: o.rrMinimo, alvo: o.alvo, exigirSmt: o.exigirSmt });
        if (!r.tiro) continue;
        const t = r.tiro;
        const qd = primeira(v1, t.time);
        const sim = simularSinal(
          v1,
          { direccao: leitura.vies, entrada: t.entrada, stop: t.stop, alvo: t.alvo.preco, rr: t.alvo.r, tipoEntrada: 'mercado' },
          qd,
          opSim,
        );
        if (sim.r === null) continue;
        ops.push({ t: t.time, r: sim.r, alta: leitura.vies === 'bullish', smt: t.smt });
      }
    }
    const semanas = (v1[v1.length - 1].time - v1[dias[0]].time) / SEMANA;
    out[nome] = { ops, semanas, semanasTreino: Math.max(0, (Math.min(CORTE, v1[v1.length - 1].time) - v1[dias[0]].time) / SEMANA) };
  }
  return out;
}

function juntar(res, lista, nome) {
  const ops = [];
  let semanas = 0;
  let semanasTreino = 0;
  for (const par of lista) {
    const x = res[par]?.[nome];
    if (!x) continue;
    ops.push(...x.ops);
    semanas += x.semanas;
    semanasTreino += x.semanasTreino;
  }
  return { ops, semanas, semanasTreino };
}

function resumo(res, nome) {
  const vivo = juntar(res, AO_VIVO, nome);
  const ctl = juntar(res, CONTROLO, nome);
  const treino = est(vivo.ops.filter((o) => o.t < CORTE).map((o) => o.r));
  const teste = est(vivo.ops.filter((o) => o.t >= CORTE).map((o) => o.r));
  const controlo = est(ctl.ops.map((o) => o.r));
  const todos = est(vivo.ops.map((o) => o.r));
  // Por semana nos 6 pares (as semanas somadas são par-semanas).
  const porSemana = (vivo.ops.length / vivo.semanas) * AO_VIVO.length;
  const porSemanaTreino = (treino.n / vivo.semanasTreino) * AO_VIVO.length;
  return { nome, treino, teste, controlo, todos, porSemana, objectivo: treino.media * porSemanaTreino };
}

const f = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(3)}`;
function linha(r) {
  return (
    `${r.nome.padEnd(34)} ${String(r.todos.n).padStart(5)} · ${r.porSemana.toFixed(2).padStart(5)}/sem · acerto ${(r.todos.acerto * 100).toFixed(0).padStart(2)}% · ` +
    `treino ${f(r.treino.media)} (${r.treino.n}) · teste ${f(r.teste.media)} (${r.teste.n}) · controlo ${f(r.controlo.media)} (${r.controlo.n}) · ` +
    `objectivo ${f(r.objectivo)}R/sem`
  );
}

const fase = process.env.FASE ?? '1';
const res = {};
let variantes;
if (fase === '1') {
  variantes = { base: BASE, ...SIMPLES };
} else {
  const f1 = JSON.parse(readFileSync(SAIDA, 'utf8'));
  variantes = { [f1.combinacao.nome]: f1.combinacao.opcoes };
}
for (const par of [...AO_VIVO, ...CONTROLO]) {
  const t0 = Date.now();
  const r = correrPar(par, variantes);
  if (!r) {
    console.log(`${par}: sem dados`);
    continue;
  }
  res[par] = r;
  console.log(`${par}: ${Object.entries(r).map(([n, x]) => `${n} ${x.ops.length}`).join(' · ')} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}

console.log(`\n== Asia Range — variantes · FASE ${fase} · 2022+ · custos · pares ao vivo: ${AO_VIVO.join(', ')}`);
const resumos = Object.keys(variantes).map((n) => resumo(res, n));
for (const r of resumos) console.log(linha(r));

if (fase === '1') {
  const base = resumos.find((r) => r.nome === 'base');
  let melhores = resumos.filter((r) => r.nome !== 'base' && r.objectivo > base.objectivo);
  // Dos grupos em conflito fica a melhor.
  for (const g of GRUPOS) {
    const doGrupo = melhores.filter((r) => g.includes(r.nome)).sort((a, b) => b.objectivo - a.objectivo);
    melhores = melhores.filter((r) => !g.includes(r.nome) || r === doGrupo[0]);
  }
  const combinacao = {
    nome: melhores.length >= 2 ? `combinação: ${melhores.map((r) => r.nome).join(' + ')}` : null,
    opcoes: Object.assign({}, ...melhores.map((r) => SIMPLES[r.nome])),
  };
  console.log(`\nMelhoram a base no treino: ${melhores.map((r) => r.nome).join(', ') || 'nenhuma'}`);
  writeFileSync(SAIDA, JSON.stringify({ resumos, combinacao }, null, 1));
  if (combinacao.nome) console.log(`Próximo passo: FASE=2 para medir "${combinacao.nome}".`);
} else {
  const f1 = JSON.parse(readFileSync(SAIDA, 'utf8'));
  const todas = [...f1.resumos, ...resumos];
  const vencedor = todas.sort((a, b) => b.objectivo - a.objectivo)[0];
  const passa = vencedor.teste.media > 0 && vencedor.controlo.media > 0;
  console.log(`\nVencedor no treino: ${vencedor.nome} (objectivo ${f(vencedor.objectivo)}R/sem)`);
  console.log(`Validação: teste ${f(vencedor.teste.media)} · controlo ${f(vencedor.controlo.media)} → ${passa ? 'PASSA' : 'NÃO PASSA'}`);
  writeFileSync(SAIDA, JSON.stringify({ ...f1, fase2: resumos, vencedor: vencedor.nome, passa }, null, 1));
}
