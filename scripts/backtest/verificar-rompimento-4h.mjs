#!/usr/bin/env node
/**
 * Mede o rompimento de 4h com o código de PRODUÇÃO (`planRompimento4h`).
 *
 *   npm run build && node scripts/backtest/verificar-rompimento-4h.mjs
 *
 * Precisa de velas de 1 minuto da HistData agregadas em 1h, em
 * `data/backtest/histdata/<PAR>_1h.json` (HISTDATA=<pasta> muda o sítio).
 *
 * Se os números aqui não baterem com os da investigação, é a regra escrita no
 * core que está diferente da que foi medida — e é esta que vai para o ar.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/';
const DIR = (process.env.HISTDATA ?? RAIZ + 'data/backtest/histdata') + '/';
const { planRompimento4h, acompanharOperacao, ROMPIMENTO_VALIDADO } = await import(
  pathToFileURL(RAIZ + 'packages/core/dist/index.js').href
);
/*
 * Por omissão mede os instrumentos do catálogo. PARES=AUDUSD,NZDUSD testa
 * CANDIDATOS: a regra corre à mesma (não olha ao instrumento), e é assim que se
 * vê se um mercado novo merece entrar.
 */
const PARES = process.env.PARES ? process.env.PARES.split(',') : ROMPIMENTO_VALIDADO;

const HORA = 3_600_000;
const CORTE = Date.UTC(2024, 6, 1);
/** Spread + deslize, em unidades de preço. */
const CUSTO = {
  XAUUSD: 0.35, XAGUSD: 0.03, USDJPY: 0.012, GBPJPY: 0.03,
  EURUSD: 0.00012, GBPUSD: 0.00018, AUDUSD: 0.0002, NZDUSD: 0.0003,
  EURGBP: 0.00022, EURJPY: 0.018, USDCAD: 0.00018, USDCHF: 0.00018,
};

function velas4h(par) {
  const v = JSON.parse(readFileSync(`${DIR}${par}_1h.json`, 'utf8'));
  const passo = 4 * HORA;
  const out = [];
  for (const c of v) {
    const k = c.time - (c.time % passo);
    const u = out[out.length - 1];
    if (u && u.time === k) {
      u.high = Math.max(u.high, c.high);
      u.low = Math.min(u.low, c.low);
      u.close = c.close;
    } else out.push({ time: k, open: c.open, high: c.high, low: c.low, close: c.close, volume: 0 });
  }
  return out;
}

function st(rs) {
  const n = rs.length;
  if (n < 3) return { n, media: 0, t: 0, acerto: 0 };
  const m = rs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rs.reduce((a, r) => a + (r - m) ** 2, 0) / (n - 1));
  return { n, media: m, t: m / (sd / Math.sqrt(n)), acerto: rs.filter((r) => r > 0).length / n };
}
const mostra = (rot, s) =>
  console.log(
    `${rot.padEnd(22)} n=${String(s.n).padStart(4)} ${(100 * s.acerto).toFixed(0).padStart(3)}% ` +
      `${s.media >= 0 ? '+' : ''}${s.media.toFixed(3)}R t=${s.t.toFixed(1).padStart(5)}`,
  );

console.log('Rompimento de 4h, medido com o código de produção\n');
const todas = [];
for (const par of PARES) {
  let v;
  try {
    v = velas4h(par);
  } catch (e) {
    // Diz PORQUE falhou: sem ficheiro é uma coisa, ficheiro corrompido (um
    // download interrompido a meio) é outra — e essa cala-se se não se disser.
    console.log(`${par}: ${String(e).includes('ENOENT') ? 'sem dados em ' + DIR : 'ficheiro ilegível — ' + String(e).slice(0, 80)}`);
    continue;
  }
  const ops = [];
  for (let i = 300; i < v.length - 1; i++) {
    const g = planRompimento4h(v.slice(i - 299, i + 1), { symbol: par, timeframe: '4h' })[0];
    if (!g) continue;
    // A gestão é a de produção: `acompanharOperacao` com as velas seguintes.
    const a = acompanharOperacao(
      {
        estrategia: 'rompimento-4h',
        direccao: 'bullish',
        entrada: g.entryPrice,
        stop: g.stopLoss,
        alvos: g.targets.map((t) => ({ preco: t.price, r: t.rMultiple })),
        geradoEm: v[i].time,
      },
      v.slice(i - 299, Math.min(i + 12, v.length)),
    );
    if (a.resultadoR === null) continue;
    const risco = g.entryPrice - g.stopLoss;
    ops.push({ t: v[i].time, r: a.resultadoR - CUSTO[par] / risco });
  }
  mostra(par, st(ops.map((o) => o.r)));
  todas.push(...ops);
}

if (todas.length === 0) {
  console.log('sem operacoes — nada a medir.');
  process.exit(0);
}
todas.sort((a, b) => a.t - b.t);
console.log('');
mostra('TUDO', st(todas.map((o) => o.r)));
mostra('  até jun/2024', st(todas.filter((o) => o.t < CORTE).map((o) => o.r)));
mostra('  jul/2024 em diante', st(todas.filter((o) => o.t >= CORTE).map((o) => o.r)));
const anos = new Map();
for (const o of todas) {
  const y = new Date(o.t).getUTCFullYear();
  anos.set(y, (anos.get(y) ?? 0) + o.r);
}
const semanas = (todas.at(-1).t - todas[0].t) / (7 * 24 * 3600_000);
console.log(
  `anos positivos ${[...anos.values()].filter((x) => x > 0).length}/${anos.size} · ` +
    `${(todas.length / semanas).toFixed(1)} sinais por semana`,
);
// O período MEDIDO, não o pretendido: os ficheiros no disco podem cobrir menos
// anos do que a medição publicada, e sem isto a diferença passava despercebida.
console.log(
  `medido de ${new Date(todas[0].t).toISOString().slice(0, 10)} a ` +
    `${new Date(todas.at(-1).t).toISOString().slice(0, 10)}`,
);
console.log('\nesperado da investigação: n≈750 · 53% · +0,161R · t≈4,2 · 12/15 anos · 1,0/semana');
