#!/usr/bin/env node
/**
 * Mede as estratégias validadas com o código de PRODUÇÃO (`@trading/core`).
 *
 *   npm run build && node scripts/backtest/baixar.mjs && node scripts/backtest/verificar-validadas.mjs
 *
 * Reproduz os números que `strategies/validadas.ts` escreve em cada sinal. Se
 * uma alteração à regra os mudar, o texto do sinal tem de mudar também.
 *
 * Regras da simulação (conservadoras):
 *   - entrada ao fecho da vela do sinal; uma operação de cada vez por série
 *   - numa vela que toca o stop e o alvo, conta o stop
 *   - spread descontado em cada operação; no diário também financiamento
 *     overnight de 0,02% do nominal por dia
 *   - "fora da amostra": VWAP depois de 20/07/2026; diário de 2021 em diante
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { executarEstrategiasValidadas, saidaDinamica } = await import(
  pathToFileURL(join(RAIZ, 'packages/core/dist/index.js')).href
);
const ler = (f) => JSON.parse(readFileSync(join(RAIZ, 'data', 'backtest', f), 'utf8'));
if (!existsSync(join(RAIZ, 'data', 'backtest', 'deriv'))) {
  console.log('Falta o histórico: node scripts/backtest/baixar.mjs');
  process.exit(1);
}

const SPREAD_PONTOS = { US100: 1.8, SP500: 0.6, US30: 3.5, GER30: 2.0 };
const SPREAD_REL = { US100: 0.0001, SP500: 0.0001, US30: 0.0001, GER30: 0.0001, BTCUSD: 0.0006, ETHUSD: 0.001 };
const SWAP_DIA = 0.0002;
const CORTE_VWAP = Date.UTC(2026, 6, 20);

function resumo(rs) {
  const n = rs.length;
  if (!n) return 'n=0';
  const m = rs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rs.reduce((a, r) => a + (r - m) ** 2, 0) / Math.max(1, n - 1));
  const ganhos = rs.filter((r) => r > 0).length;
  return `${n} operações · ${((100 * ganhos) / n).toFixed(1)}% a ganhar · ${m >= 0 ? '+' : ''}${m.toFixed(2)}R por operação · t=${(m / (sd / Math.sqrt(n))).toFixed(1)}`;
}

// --- compra-vwap-indices: 1h e 4h, Deriv ---------------------------------------
{
  const dentro = { f1: [], parcial: [] };
  const fora = { f1: [], parcial: [] };
  for (const s of ['US100', 'SP500', 'US30', 'GER30']) {
    for (const tf of ['1h', '4h']) {
      const v = ler(`deriv/${s}_${tf}.json`);
      let livre = -1;
      for (let i = 300; i < v.length - 1; i++) {
        if (i <= livre) continue;
        const g = executarEstrategiasValidadas(v.slice(i - 299, i + 1), { symbol: s, timeframe: tf })[0];
        if (!g) continue;
        const risco = g.entryPrice - g.stopLoss;
        const custo = SPREAD_PONTOS[s] / risco;
        let f1 = null;
        let parcial = null;
        let armado = false;
        let k = i + 1;
        for (; k < v.length && k <= i + 200; k++) {
          const baixo = (v[k].low - g.entryPrice) / risco;
          const alto = (v[k].high - g.entryPrice) / risco;
          if (f1 === null) f1 = baixo <= -1 ? -1 : alto >= 1 ? 1 : null;
          if (parcial === null) {
            if (armado && baixo <= 0) parcial = 0.5;
            else if (!armado && baixo <= -1) parcial = -1;
            else if (alto >= 2) parcial = 1.5;
            else if (alto >= 1) armado = true;
          }
          if (f1 !== null && parcial !== null) break;
        }
        livre = k;
        if (f1 === null || parcial === null) continue;
        const destino = v[i].time < CORTE_VWAP ? dentro : fora;
        destino.f1.push(f1 - custo);
        destino.parcial.push(parcial - custo);
      }
    }
  }
  console.log('compra-vwap-indices (US100, SP500, US30, GER30 · 1h e 4h)');
  console.log('  alvo 1R        ', resumo([...dentro.f1, ...fora.f1]));
  console.log('  gestão parcial ', resumo([...dentro.parcial, ...fora.parcial]));
  console.log('  fora da amostra', resumo(fora.parcial));
}

// --- connors-rsi2-indices e tendencia-cripto: diário, 15 anos ---------------------
for (const [id, simbolos] of [
  ['connors-rsi2-indices', ['US100', 'SP500', 'US30', 'GER30']],
  ['tendencia-cripto', ['BTCUSD', 'ETHUSD']],
]) {
  const ate2020 = [];
  const desde2021 = [];
  for (const s of simbolos) {
    const v = ler(`diario/${s}.json`);
    let pos = null;
    for (let i = 300; i < v.length; i++) {
      const janela = v.slice(i - 299, i + 1);
      const x = v[i];
      if (pos) {
        let sai = null;
        if (id === 'connors-rsi2-indices') {
          const nivel = saidaDinamica(id, janela)?.nivel;
          if (x.low <= pos.stop) sai = pos.stop;
          else if ((nivel !== undefined && x.close > nivel) || i - pos.i >= 10) sai = x.close;
        } else {
          const nivel = saidaDinamica(id, v.slice(i - 299, i))?.nivel ?? -Infinity;
          const stop = Math.max(pos.stop, nivel);
          if (x.low <= stop) sai = Math.min(x.open, stop);
        }
        if (sai !== null) {
          const dias = i - pos.i;
          const r = (sai - pos.e) / pos.risco - (pos.e * SPREAD_REL[s] + pos.e * SWAP_DIA * dias) / pos.risco;
          (new Date(v[pos.i].time).getUTCFullYear() <= 2020 ? ate2020 : desde2021).push(r);
          pos = null;
        }
        continue;
      }
      const g = executarEstrategiasValidadas(janela, { symbol: s, timeframe: '1d' })[0];
      if (g) pos = { i, e: g.entryPrice, stop: g.stopLoss, risco: g.entryPrice - g.stopLoss };
    }
  }
  console.log(`${id} (${simbolos.join(', ')} · diário)`);
  console.log('  até 2020       ', resumo(ate2020));
  console.log('  2021 em diante ', resumo(desde2021));
}
