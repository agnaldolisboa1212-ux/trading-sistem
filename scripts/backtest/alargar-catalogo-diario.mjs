/**
 * Alargar o catálogo: as estratégias DIÁRIAS validadas, medidas em todos os
 * instrumentos com histórico, não só nos que já estão no catálogo.
 *
 * Usa o código de produção (planConnorsIndices, planTendencia*) e as mesmas
 * regras conservadoras do scripts/backtest/verificar-validadas.mjs:
 *   - entrada ao fecho da vela do sinal, uma operação de cada vez
 *   - numa vela que toca stop e alvo, conta o stop
 *   - spread por operação + financiamento overnight de 0,02% do nominal por dia
 *   - divisão: até 2020 (escolha) / 2021 em diante (confirmação)
 *
 * A barra para entrar no catálogo é a mesma das validadas: positivo nos DOIS
 * períodos, com t≥1,5 no conjunto e pelo menos 30 operações.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/';
const core = await import(pathToFileURL(RAIZ + 'packages/core/dist/index.js').href);
const { planConnorsIndices, planTendenciaCripto, saidaDinamica } = core;

/* Todo o universo negociável na corretora — quem não é testado não entra. */
const { CRIPTO, FOREX, INDICES, METAIS } = await import(pathToFileURL(RAIZ + 'packages/data/dist/deriv-simbolos.js').href);
const SIMBOLOS = [...INDICES, ...METAIS, ...CRIPTO, ...FOREX].map((x) => x.codigo);
const NO_CATALOGO = {
  'connors-rsi2-indices': new Set(core.CONNORS_VALIDADO),
  'tendencia-55d': new Set([...core.CRIPTO_VALIDADA, ...core.OURO_VALIDADO, ...core.INDICES_TENDENCIA]),
};
/*
 * Spread relativo por operação. Índices e metais como no verificar-validadas;
 * forex com o spread típico do par; os menos líquidos com o dobro.
 */
const SPREAD_REL = {
  US100: 0.0001, SP500: 0.0001, US30: 0.0001, GER30: 0.0001,
  UK100: 0.0002, FRA40: 0.0002, EU50: 0.0002, JP225: 0.0002,
  AUS200: 0.0002, HK50: 0.0003, NL25: 0.0003, SWI20: 0.0003,
  BTCUSD: 0.0006, ETHUSD: 0.001,
  XAUUSD: 0.0002, XAGUSD: 0.0006, XPTUSD: 0.0008, XPDUSD: 0.0012,
  EURUSD: 0.00012, GBPUSD: 0.00018, AUDUSD: 0.0002, NZDUSD: 0.0003, USDJPY: 0.0001,
  USDCHF: 0.00018, USDCAD: 0.00018, EURGBP: 0.00022, EURJPY: 0.00018, GBPJPY: 0.00025,
};
const SWAP_DIA = 0.0002;
/** CUSTO=2 dobra o spread — o teste de quem sobrevive a uma corretora pior. */
const CUSTO_MULT = Number(process.env.CUSTO ?? 1);
const ler = (s) => JSON.parse(readFileSync(`${RAIZ}data/backtest/diario/${s}.json`, 'utf8'));

function estatistica(rs) {
  const n = rs.length;
  if (n < 3) return { n, acerto: 0, media: 0, t: 0 };
  const m = rs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rs.reduce((a, r) => a + (r - m) ** 2, 0) / (n - 1));
  return { n, acerto: rs.filter((r) => r > 0).length / n, media: m, t: m / (sd / Math.sqrt(n)) };
}
const linha = (rotulo, st) =>
  `${rotulo.padEnd(16)} n=${String(st.n).padStart(3)} ${(100 * st.acerto).toFixed(0).padStart(3)}% ` +
  `${st.media >= 0 ? '+' : ''}${st.media.toFixed(3)}R t=${st.t.toFixed(1).padStart(4)}`;

/** Simula uma estratégia diária num instrumento. Devolve as operações por período. */
function simular(estrategia, simbolo) {
  const v = ler(simbolo);
  const espalhar = (SPREAD_REL[simbolo] ?? 0.0003) * CUSTO_MULT;
  const ctx = { symbol: simbolo, timeframe: '1d' };
  const ate2020 = [];
  const desde2021 = [];
  const porAno = new Map();
  let pos = null;
  for (let i = 300; i < v.length; i++) {
    const janela = v.slice(i - 299, i + 1);
    const x = v[i];
    if (pos) {
      let sai = null;
      if (estrategia === 'connors') {
        const nivel = saidaDinamica('connors-rsi2-indices', janela)?.nivel;
        if (x.low <= pos.stop) sai = pos.stop;
        else if ((nivel !== undefined && x.close > nivel) || i - pos.i >= 10) sai = x.close;
      } else {
        const nivel = saidaDinamica('tendencia-cripto', v.slice(i - 299, i))?.nivel ?? -Infinity;
        const stop = Math.max(pos.stop, nivel);
        if (x.low <= stop) sai = Math.min(x.open, stop);
      }
      if (sai !== null) {
        const dias = i - pos.i;
        const r = (sai - pos.e) / pos.risco - (pos.e * espalhar + pos.e * SWAP_DIA * dias) / pos.risco;
        const ano = new Date(v[pos.i].time).getUTCFullYear();
        (ano <= 2020 ? ate2020 : desde2021).push(r);
        porAno.set(ano, (porAno.get(ano) ?? 0) + r);
        pos = null;
      }
      continue;
    }
    const g =
      estrategia === 'connors' ? planConnorsIndices(janela, ctx)[0] : planTendenciaCripto(janela, ctx)[0];
    if (g) pos = { i, e: g.entryPrice, stop: g.stopLoss, risco: g.entryPrice - g.stopLoss };
  }
  return { ate2020, desde2021, porAno };
}

for (const [estrategia, rotulo, idCatalogo] of [
  ['connors', 'RSI(2) de Connors', 'connors-rsi2-indices'],
  ['tendencia', 'Tendência 55 dias', 'tendencia-55d'],
]) {
  console.log(`\n══════ ${rotulo} · diário, 15 anos ══════`);
  const aprovados = [];
  for (const s of SIMBOLOS) {
    let r;
    try {
      r = simular(estrategia, s);
    } catch {
      continue;
    }
    const tudo = [...r.ate2020, ...r.desde2021];
    if (tudo.length === 0) continue;
    const st = estatistica(tudo);
    const a = estatistica(r.ate2020);
    const b = estatistica(r.desde2021);
    const jaLa = NO_CATALOGO[idCatalogo].has(s);
    const anosPositivos = [...r.porAno.values()].filter((x) => x > 0).length;
    const passa = a.media > 0 && b.media > 0 && st.t >= 1.5 && st.n >= 30;
    console.log(
      `\n${s}${jaLa ? ' (já no catálogo)' : ''}${passa ? '  ✅ PASSA' : ''}\n  ` +
        linha('tudo', st) + `\n  ` + linha('até 2020', a) + `\n  ` + linha('2021+', b) +
        `\n  anos positivos: ${anosPositivos}/${r.porAno.size}`,
    );
    if (passa && !jaLa) aprovados.push(`${s} (${st.media.toFixed(2)}R, t=${st.t.toFixed(1)}, ${st.n} ops)`);
  }
  console.log(`\n>>> Passam a barra e ainda NÃO estão no catálogo: ${aprovados.length ? aprovados.join(', ') : 'nenhum'}`);
}
