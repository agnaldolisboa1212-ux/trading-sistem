/**
 * ICT ALGO — a medição do algoritmo adaptativo.
 *
 * Não reimplementa nada: chama `prepararEstruturas` e `percorrerIct` de
 * `@trading/core`, as MESMAS funções que a análise ao vivo usa. Um backtest que
 * reescreve a lógica mede uma coisa e envia outra — neste projecto já
 * aconteceu, e foi assim que um resultado publicado divergiu do código.
 *
 * ── O QUE SE MEDE, E PORQUÊ CADA COISA ────────────────────────────────────
 *
 *   modelos crus     cada modelo sozinho, sem regime: o desempenho de base
 *   modelo × regime  cada modelo DENTRO e FORA dos regimes que o mapa lhe dá —
 *                    se o mapa estiver certo, dentro tem de ser melhor
 *   estrutural       o algoritmo com a camada de estrutura (regime → modelo)
 *   com quarentena   o algoritmo completo; só vale a pena se bater o anterior
 *
 * A fasquia é a de sempre: positivo nas DUAS metades + t >= 1,5 + funciona em
 * instrumentos que não participaram na escolha (`CONTROLO=1`).
 *
 * Uso:
 *   node scripts/backtest/ict-algo.mjs                    mercados principais, 1H
 *   CONTROLO=1 node scripts/backtest/ict-algo.mjs         mercados de controlo
 *   TF=15m node scripts/backtest/ict-algo.mjs             em 15M
 *   MERCADO=EURUSD node scripts/backtest/ict-algo.mjs     só um (para correr em paralelo)
 *   SAIDA=ficheiro.json ...                               grava as operações
 *   CONFIRMAR=1 TF=15m ...                                com a confirmação em 5M do caminho ao
 *                                                         vivo (precisa de SIMBOLO_5m.json)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import {
  agregar,
  confirmacaoLtf,
  custoTipico,
  MODELOS_DO_REGIME,
  TODOS_OS_MODELOS,
  opcoesPorTimeframe,
  percorrerIct,
  prepararEstruturas,
} from '../../packages/core/dist/index.js';

const DIR = 'E:/projecto Agnaldo 3.0/sistema de trading/data/backtest/histdata/';
/**
 * Só dados de 2022 em diante: o mercado de antes (juros a zero, outra
 * volatilidade) não é o mercado que se vai operar. A estrutura usa a história
 * anterior para aquecer o viés, mas nenhuma operação antes de DESDE conta.
 */
const DESDE = Date.UTC(2022, 0, 1);
const CORTE = Date.UTC(2024, 6, 1); // metade da amostra 2022–2026
const TF = process.env.TF ?? '1h';
/** Modelo de entrada: borda | meio | ote | mercado (ver packages/core/src/ict/entrada.ts). */
const ENTRADA = process.env.ENTRADA ?? 'borda';

/** [nome, ficheiro, ficheiro do par para o SMT, nome do par] */
const MERCADOS = [
  ['EURUSD', 'EURUSD', 'GBPUSD'],
  ['GBPUSD', 'GBPUSD', 'EURUSD'],
  ['USDJPY', 'USDJPY', 'EURJPY'],
  ['EURJPY', 'EURJPY', 'GBPJPY'],
  ['XAUUSD', 'XAUUSD', 'XAGUSD'],
  ['SP500', 'SPXUSD', 'NSXUSD'],
  ['US100', 'NSXUSD', 'SPXUSD'],
  ['GER30', 'GRXEUR', 'FRXEUR'],
];
const CONTROLO = [
  ['AUDUSD', 'AUDUSD', 'NZDUSD'],
  ['NZDUSD', 'NZDUSD', 'AUDUSD'],
  ['EURGBP', 'EURGBP', 'EURUSD'],
  ['USDCAD', 'USDCAD', 'USDCHF'],
  ['USDCHF', 'USDCHF', 'USDCAD'],
  ['GBPJPY', 'GBPJPY', 'EURJPY'],
  ['UK100', 'UKXGBP', 'FRXEUR'],
  ['FRA40', 'FRXEUR', 'UKXGBP'],
];

const MS = { '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000 };
function carregar(ficheiro) {
  // Só se agrega PARA CIMA: de 1H não se tiram velas de 15M.
  for (const tf of [TF, '15m', '1h']) {
    if (MS[tf] > MS[TF]) continue;
    try {
      const v = JSON.parse(readFileSync(`${DIR}${ficheiro}_${tf}.json`, 'utf8'));
      if (!Array.isArray(v) || v.length === 0) continue;
      return tf === TF ? v : agregar(v, TF);
    } catch {
      /* tenta o seguinte */
    }
  }
  return null;
}

export const est = (rs) => {
  const n = rs.length;
  if (n < 3) return { n, media: 0, t: 0, acerto: 0 };
  const m = rs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rs.reduce((a, r) => a + (r - m) ** 2, 0) / (n - 1));
  return { n, media: m, t: sd > 0 ? m / (sd / Math.sqrt(n)) : 0, acerto: rs.filter((r) => r > 0).length / n };
};

function correrMercado([nome, ficheiro, parFicheiro]) {
  const velas = carregar(ficheiro);
  const parVelas = carregar(parFicheiro);
  if (!velas || velas.length < 3000) return null;
  const diarias = agregar(velas, '1d');
  const e = prepararEstruturas({
    simbolo: nome,
    timeframe: TF,
    velas,
    diarias,
    semanais: agregar(velas, '1w'),
    referencia: diarias,
    timeframeReferencia: '1d',
    par: parVelas ? { simbolo: parFicheiro, velas: parVelas } : null,
  });
  // CUSTO_MULT=0 mede o algoritmo sem custos: separa "não há vantagem" de
  // "há vantagem e os custos comem-na" — dois problemas com remédios diferentes.
  const custo = custoTipico(nome, velas[velas.length - 1].close) * Number(process.env.CUSTO_MULT ?? 1);
  const t0 = Date.now();
  let desde = velas.findIndex((c) => c.time >= DESDE);
  if (desde < 300) desde = 300;

  // A confirmação em 5M de `planIctAlgo`: CHoCH/MSS e estrutura de 5M a favor,
  // com as velas de 5M fechadas até à decisão. Só a janela das últimas horas
  // interessa à função; cortá-la aqui evita percorrer anos de 5M a cada vela.
  let aceitar;
  if (process.env.CONFIRMAR) {
    let v5;
    try {
      v5 = JSON.parse(readFileSync(`${DIR}${ficheiro}_5m.json`, 'utf8'));
    } catch {
      return null;
    }
    const tfMs = MS[TF];
    const primeira = (t) => {
      let lo = 0;
      let hi = v5.length;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (v5[m].time < t) lo = m + 1;
        else hi = m;
      }
      return lo;
    };
    aceitar = (s, i) => {
      const agora = velas[i].time + tfMs;
      const janela = v5.slice(primeira(agora - 8 * 3_600_000), primeira(agora));
      return confirmacaoLtf(janela, s.direccao, agora).ok;
    };
    // Sem 5M no início do período, as primeiras velas não confirmam nada.
    const inicio5m = velas.findIndex((c) => c.time >= v5[0].time + 8 * 3_600_000);
    if (inicio5m > desde) desde = inicio5m;
  }
  const p = percorrerIct(e, desde, velas.length - 2, opcoesPorTimeframe(TF, custo), ENTRADA, aceitar);
  const marca = (ops) => ops.map((o) => ({ ...o, mercado: nome }));
  return {
    nome,
    segundos: (Date.now() - t0) / 1000,
    sombras: marca(p.sombras),
    estrutural: marca(p.estrutural),
    comQuarentena: marca(p.comQuarentena),
  };
}

export function linha(rotulo, ops, largura = 34) {
  if (ops.length < 20) return rotulo.padEnd(largura) + `${String(ops.length).padStart(6)}  (poucas para concluir)`;
  const s = est(ops.map((o) => o.r));
  const a = est(ops.filter((o) => o.time < CORTE).map((o) => o.r));
  const b = est(ops.filter((o) => o.time >= CORTE).map((o) => o.r));
  const passa = a.media > 0 && b.media > 0 && s.t >= 1.5;
  const f = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(3)}`;
  return (
    ((passa ? 'OK ' : '   ') + rotulo).padEnd(largura) +
    String(s.n).padStart(6) +
    `${(100 * s.acerto).toFixed(0)}%`.padStart(7) +
    `${f(s.media)}R`.padStart(9) +
    `t=${s.t.toFixed(1)}`.padStart(8) +
    f(a.media).padStart(9) +
    f(b.media).padStart(9)
  );
}

const cabecalho = (t) =>
  `\n${t}\n` +
  ''.padEnd(34) + 'n'.padStart(6) + 'acerto'.padStart(7) + 'R/op'.padStart(9) + 't'.padStart(8) + '1.ª met'.padStart(9) + '2.ª met'.padStart(9);

// ── Execução ───────────────────────────────────────────────────────────────
const lista = (process.env.CONTROLO ? CONTROLO : MERCADOS).filter(
  (m) => !process.env.MERCADO || m[0] === process.env.MERCADO,
);
const resultados = [];
for (const m of lista) {
  const r = correrMercado(m);
  if (!r) {
    console.log(`${m[0]}: sem dados`);
    continue;
  }
  console.log(`${m[0]}: ${r.sombras.length} setups crus, ${r.estrutural.length} operações do algoritmo (${r.segundos.toFixed(0)}s)`);
  resultados.push(r);
}

if (process.env.SAIDA) {
  writeFileSync(process.env.SAIDA, JSON.stringify(resultados));
  console.log(`\noperações gravadas em ${process.env.SAIDA}`);
}

const todas = (k) => resultados.flatMap((r) => r[k]);
const sombras = todas('sombras');
// Do core, não copiados: uma cópia à mão já ficou desactualizada uma vez.
const MODELOS = [...TODOS_OS_MODELOS];

console.log(cabecalho(`ICT ALGO · ${TF} · entrada ${ENTRADA} · ${resultados.length} mercados${process.env.CONTROLO ? ' DE CONTROLO' : ''} · custos incluídos`));
console.log('\n── cada modelo sozinho, sem regime ──');
for (const m of MODELOS) console.log(linha(m, sombras.filter((o) => o.modelo === m)));

console.log('\n── cada modelo dentro e fora dos regimes que o mapa lhe dá ──');
const MAPA = Object.fromEntries(Object.entries(MODELOS_DO_REGIME).filter(([, ms]) => ms.length > 0));
for (const m of MODELOS) {
  const dentro = sombras.filter((o) => o.modelo === m && (MAPA[o.regime] ?? []).includes(m));
  const fora = sombras.filter((o) => o.modelo === m && !(MAPA[o.regime] ?? []).includes(m));
  console.log(linha(`${m} · no seu regime`, dentro));
  console.log(linha(`${m} · fora dele`, fora));
}

console.log('\n── o algoritmo ──');
console.log(linha('estrutural (regime → modelo)', todas('estrutural')));
console.log(linha('completo (+ quarentena)', todas('comQuarentena')));
const final = todas('comQuarentena');
console.log(linha('  só compras', final.filter((o) => o.direccao === 'bullish')));
console.log(linha('  só vendas', final.filter((o) => o.direccao === 'bearish')));
console.log('\n── por mercado: estrutural | completo ──');
for (const r of resultados) {
  console.log(linha(`${r.nome} estrutural`, r.estrutural));
  console.log(linha(`${r.nome} completo`, r.comQuarentena));
}
console.log('\n── como saem as operações do algoritmo completo ──');
const saidas = {};
for (const o of final) saidas[o.saida] = (saidas[o.saida] ?? 0) + 1;
console.log('  ' + Object.entries(saidas).map(([k, n]) => `${k} ${n} (${((100 * n) / Math.max(1, final.length)).toFixed(0)}%)`).join(' · '));
const rrMedio = final.reduce((s, o) => s + o.rr, 0) / Math.max(1, final.length);
console.log(`  RR médio planeado ${rrMedio.toFixed(2)} → acerto de equilíbrio ${(100 / (1 + rrMedio)).toFixed(0)}% (antes de custos)`);
console.log('\n── o algoritmo completo, por regime e modelo escolhido ──');
for (const reg of Object.keys(MAPA)) {
  for (const m of MAPA[reg]) {
    const ops = final.filter((o) => o.regime === reg && o.modelo === m);
    if (ops.length > 0) console.log(linha(`${reg} → ${m}`, ops));
  }
}

const anos = (Math.max(...final.map((o) => o.time)) - Math.min(...final.map((o) => o.time))) / (365.25 * 86_400_000);
if (final.length > 0) {
  console.log(`\nfrequência: ${final.length} operações em ${anos.toFixed(1)} anos e ${resultados.length} mercados = ${(final.length / anos / Math.max(1, resultados.length)).toFixed(1)} por mercado e por ano`);
}
