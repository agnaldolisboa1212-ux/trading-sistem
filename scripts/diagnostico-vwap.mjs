#!/usr/bin/env node
/**
 * Porque é que o VWAP não deu sinal? Vela a vela, desde segunda-feira, nos
 * instrumentos e timeframes do VWAP (compra validada e venda em teste), mostra
 * o filtro que travou cada vela e conta quantos sinais haveria se a regra fosse
 * menos exigente:
 *
 *   regra actual     regime (média de 200 dias) + ±2σ + (RSI ou σ > 2 ATR) — sem o
 *                    filtro da vela desde 02/10/2026
 *   com vela         também a vela do sinal a fechar a favor (a regra de 22/09 a 02/10)
 *   só ±2σ           sem regime nem vela (a regra antiga, de antes de 22/09)
 *
 * O VWAP do mês é calculado com o histórico todo desde o dia 1 (como no
 * backtest) e também com só as últimas 300 velas (o que o motor pedia até
 * 02/10/2026): na segunda metade do mês, 300 velas de 1H não chegam ao dia 1 e
 * a âncora do "mês" passava a ser a vela mais antiga da janela.
 *
 *   npm run build            (uma vez, para o dist estar em dia)
 *   node scripts/diagnostico-vwap.mjs          # desde segunda-feira
 *   node scripts/diagnostico-vwap.mjs 10       # os últimos 10 dias
 *   node scripts/diagnostico-vwap.mjs 10 -v    # com a linha de cada vela
 */

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..') + '/';
const core = await import(pathToFileURL(RAIZ + 'packages/core/dist/index.js').href);
const { velasDeriv } = await import(pathToFileURL(RAIZ + 'packages/data/dist/index.js').href);
const { acharSimbolo } = await import(pathToFileURL(RAIZ + 'packages/data/dist/deriv-simbolos.js').href);
const { computeAnchoredVwap, vwapZScore, rsiSerie, atrSerie, VWAP_VALIDADO, VWAP_VENDA_EM_TESTE } = core;

const GRAN = { '1h': 3600, '4h': 14400 };
const JANELA_MOTOR = 300;
const verbose = process.argv.includes('-v');
const dias = Number(process.argv.find((a, i) => i >= 2 && /^\d+$/.test(a)));
const agora = Date.now();
const desde = Number.isFinite(dias) && dias > 0 ? agora - dias * 86_400_000 : inicioDaSemana(agora);

function inicioDaSemana(t) {
  const d = new Date(t);
  const dow = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow);
}
const fechadas = (v, g) => v.filter((c) => c.time + g * 1000 <= agora);
const data = (t) => new Date(t).toISOString().slice(5, 16).replace('T', ' ');

/** Último fecho diário JÁ FECHADO antes de `t` contra a média de 200 dias: 1 acima, −1 abaixo, 0 sem dados. */
function regime(diarias, t) {
  const fim = diarias.findLastIndex((d) => d.time < t);
  if (fim < 200) return 0;
  let soma = 0;
  for (let k = fim - 199; k <= fim; k++) soma += diarias[k].close;
  return diarias[fim].close > soma / 200 ? 1 : -1;
}

/** O ponto do VWAP do mês na última vela da série (null se a vela não entrou). */
function pontoVwap(serie) {
  const r = computeAnchoredVwap(serie, { anchor: 'month' });
  const p = r.points.at(-1);
  return p && p.index === serie.length - 1 ? p : null;
}

const simbolos = [...new Set([...VWAP_VALIDADO, ...VWAP_VENDA_EM_TESTE])];
console.log(`\nVWAP desde ${new Date(desde).toISOString().slice(0, 16).replace('T', ' ')} UTC\n`);

for (const codigo of simbolos) {
  const s = acharSimbolo(codigo);
  if (!s) {
    console.log(`${codigo}: sem símbolo na Deriv`);
    continue;
  }
  let diarias;
  try {
    diarias = fechadas(await velasDeriv(s.deriv, 86400, 400), 86400);
  } catch (err) {
    console.log(`${codigo}: sem diárias (${err instanceof Error ? err.message : err})`);
    continue;
  }
  for (const tf of ['1h', '4h']) {
    const g = GRAN[tf];
    let velas;
    try {
      // Um mês inteiro de 1H a 24 h/dia são ~744 velas; 900 cobrem o dia 1 e a semana.
      velas = fechadas(await velasDeriv(s.deriv, g, 900), g);
    } catch (err) {
      console.log(`${codigo} ${tf}: sem velas (${err instanceof Error ? err.message : err})`);
      continue;
    }
    const rsi = rsiSerie(velas, 14);
    const atr = atrSerie(velas, 14);
    const conta = { actual: 0, comVela: 0, so2s: 0, actual300: 0 };
    const travas = {};
    let zMin = Infinity;
    let zMax = -Infinity;
    let ancoraCurta = 0;
    let n = 0;
    const linhas = [];
    for (let i = 0; i < velas.length; i++) {
      const u = velas[i];
      if (u.time < desde) continue;
      n++;
      const p = pontoVwap(velas.slice(0, i + 1));
      const janela = velas.slice(Math.max(0, i + 1 - JANELA_MOTOR), i + 1);
      const p300 = pontoVwap(janela);
      const mesDaVela = new Date(u.time).getUTCMonth();
      if (new Date(janela[0].time).getUTCMonth() === mesDaVela && new Date(janela[0].time).getUTCDate() > 1) ancoraCurta++;
      const reg = regime(diarias, u.time);
      const a = atr[i];
      const r = rsi[i];

      const avalia = (pt) => {
        if (!pt || pt.sigma <= 0 || pt.samples < 15 || !(a > 0) || !Number.isFinite(r)) return { motivo: 'poucas velas no mês' };
        const z = vwapZScore(pt, u.close);
        const desloc = pt.sigma > 2 * a;
        const compra2s = z <= -2;
        const venda2s = z >= 2;
        const extremo = compra2s ? r < 30 || desloc : venda2s ? r > 70 || desloc : false;
        const velaFavor = compra2s ? u.close > u.open : venda2s ? u.close < u.open : false;
        const regFavor = compra2s ? reg === 1 : venda2s ? reg === -1 : false;
        let motivo = 'dentro de ±2σ';
        if (compra2s || venda2s) {
          if (!extremo) motivo = 'sem RSI extremo nem σ > 2 ATR';
          else if (!regFavor) motivo = compra2s ? 'compra abaixo da média de 200 dias' : 'venda acima da média de 200 dias';
          else motivo = 'SINAL';
        }
        return { z, extremo, velaFavor, regFavor, banda: compra2s || venda2s, motivo };
      };
      const e = avalia(p);
      const e300 = avalia(p300);
      if (e.z !== undefined) {
        zMin = Math.min(zMin, e.z);
        zMax = Math.max(zMax, e.z);
      }
      travas[e.motivo] = (travas[e.motivo] ?? 0) + 1;
      if (e.motivo === 'SINAL') conta.actual++;
      if (e.motivo === 'SINAL' && e.velaFavor) conta.comVela++;
      if (e.banda && e.extremo) conta.so2s++;
      if (e300.motivo === 'SINAL') conta.actual300++;
      if (verbose || e.banda || e300.motivo === 'SINAL') {
        linhas.push(
          `    ${data(u.time)}  z ${e.z === undefined ? '  —  ' : e.z.toFixed(2).padStart(5)}` +
            `  (300 velas: ${e300.z === undefined ? '—' : e300.z.toFixed(2)})  RSI ${Number.isFinite(r) ? r.toFixed(0) : '—'}` +
            `  regime ${reg === 1 ? 'acima' : reg === -1 ? 'abaixo' : '—'}  → ${e.motivo}` +
            (e300.motivo !== e.motivo ? `  [motor com 300 velas: ${e300.motivo}]` : ''),
        );
      }
    }
    const fz = (z) => (Number.isFinite(z) ? z.toFixed(2) : '—');
    console.log(
      `${codigo} ${tf}: ${n} velas · z entre ${fz(zMin)} e ${fz(zMax)} · regime hoje ${regime(diarias, agora) === 1 ? 'ACIMA' : 'ABAIXO'} da média de 200 dias`,
    );
    console.log(
      `  sinais: regra actual ${conta.actual} · com o filtro da vela ${conta.comVela} · só ±2σ (sem regime nem vela) ${conta.so2s}` +
        ` · motor com 300 velas ${conta.actual300}` +
        (ancoraCurta ? ` · em ${ancoraCurta} velas as 300 não chegavam ao dia 1 do mês` : ''),
    );
    console.log(
      '  o que travou: ' +
        Object.entries(travas)
          .sort((x, y) => y[1] - x[1])
          .map(([m, q]) => `${m} ${q}`)
          .join(' · '),
    );
    for (const l of linhas) console.log(l);
  }
}
console.log(
  '\nLeitura: "dentro de ±2σ" a dominar quer dizer que o preço nunca se afastou o suficiente do VWAP do mês —\n' +
    'não há filtro a afrouxar que crie esse sinal sem mudar a própria regra.',
);
