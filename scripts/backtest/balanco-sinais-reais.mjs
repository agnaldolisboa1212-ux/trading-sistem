#!/usr/bin/env node
/**
 * O balanço dos sinais REAIS anunciados — o que aconteceu de facto.
 *
 *   npm run build && node scripts/backtest/balanco-sinais-reais.mjs [dias]
 *
 * Lê os sinais do Supabase, pede as velas à Deriv e corre o MESMO
 * `acompanharOperacao` do motor. Não é backtest: é o registo do que foi
 * anunciado a quem estava a operar.
 *
 * Existe porque a pergunta "isto está a perder dinheiro?" tem de ter uma
 * resposta em números, não em impressões — e porque houve um período em que os
 * sinais de estratégias retiradas ficavam para sempre "abertos" e não entravam
 * em balanço nenhum.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/';
const { acompanharOperacao, nomeDeEstrategia } = await import(pathToFileURL(RAIZ + 'packages/core/dist/index.js').href);
const { velasDeriv } = await import(pathToFileURL(RAIZ + 'packages/data/dist/index.js').href);
const { acharSimbolo } = await import(pathToFileURL(RAIZ + 'packages/data/dist/deriv-simbolos.js').href);

const DIAS = Number(process.argv[2] ?? 30);
const GRAN = { '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400 };

function env(ficheiro) {
  try {
    return Object.fromEntries(
      readFileSync(RAIZ + ficheiro, 'utf8')
        .split('\n')
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
    );
  } catch {
    return {};
  }
}
const cfg = { ...env('.env'), ...env('apps/dashboard/.env.local') };
const URL_DB = cfg.NEXT_PUBLIC_SUPABASE_URL ?? cfg.SUPABASE_URL;
const CHAVE = cfg.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? cfg.SUPABASE_ANON_KEY;
if (!URL_DB || !CHAVE) {
  console.error('sem credenciais do Supabase em .env / apps/dashboard/.env.local');
  process.exit(1);
}

const desde = new Date(Date.now() - DIAS * 86_400_000).toISOString();
const r = await fetch(
  `${URL_DB}/rest/v1/sinais_tempo_real?select=*&gerado_em=gte.${desde}&order=gerado_em.asc&limit=2000`,
  { headers: { apikey: CHAVE, Authorization: `Bearer ${CHAVE}` } },
);
const linhas = await r.json();
if (!Array.isArray(linhas)) {
  console.error('resposta inesperada:', JSON.stringify(linhas).slice(0, 200));
  process.exit(1);
}
console.log(`${linhas.length} sinais anunciados nos últimos ${DIAS} dias\n`);

// Velas por instrumento+timeframe: um pedido serve todos os sinais do par.
const velasDe = new Map();
async function velas(simbolo, tf) {
  const chave = `${simbolo}|${tf}`;
  if (velasDe.has(chave)) return velasDe.get(chave);
  const s = acharSimbolo(simbolo);
  const gran = GRAN[tf];
  let v = [];
  if (s && gran) {
    try {
      v = await velasDeriv(s.deriv, gran, 1000);
    } catch {
      v = [];
    }
  }
  velasDe.set(chave, v);
  return v;
}

const porEstrategia = new Map();
let semVelas = 0;
for (const l of linhas) {
  const v = await velas(l.simbolo, l.timeframe);
  const geradoEm = new Date(l.gerado_em).getTime();
  if (!v.some((c) => c.time === geradoEm)) {
    semVelas++;
    continue;
  }
  const a = acompanharOperacao(
    {
      estrategia: l.estrategia,
      direccao: l.direccao,
      entrada: Number(l.entrada),
      stop: Number(l.stop),
      alvos: (Array.isArray(l.alvos) ? l.alvos : []).map((x) => ({ preco: Number(x.preco) })),
      geradoEm,
    },
    v,
  );
  const k = l.estrategia;
  if (!porEstrategia.has(k)) porEstrategia.set(k, { n: 0, abertos: 0, r: [], stops: 0, alvos: 0, invalidos: 0 });
  const acc = porEstrategia.get(k);
  acc.n++;
  const fim = a.eventos[a.eventos.length - 1]?.tipo;
  if (a.resultadoR === null) {
    if (a.estado === 'expirado' || a.estado === 'perdido') acc.invalidos++;
    else acc.abertos++;
  } else {
    acc.r.push(a.resultadoR);
    if (fim === 'stop' || fim === 'stop-na-entrada') acc.stops++;
    if (fim === 'alvo1' || fim === 'alvo2') acc.alvos++;
  }
}

const cab = 'estratégia'.padEnd(34) + 'sinais'.padStart(7) + 'fechados'.padStart(9) + 'stops'.padStart(7) +
  'alvos'.padStart(7) + 'abertos'.padStart(8) + 'R total'.padStart(9) + 'R/op'.padStart(8);
console.log(cab);
console.log('-'.repeat(cab.length));
let totalR = 0;
let totalOps = 0;
for (const [id, a] of [...porEstrategia].sort((x, y) => y[1].n - x[1].n)) {
  const soma = a.r.reduce((x, y) => x + y, 0);
  totalR += soma;
  totalOps += a.r.length;
  console.log(
    nomeDeEstrategia(id).slice(0, 33).padEnd(34) +
      String(a.n).padStart(7) +
      String(a.r.length).padStart(9) +
      String(a.stops).padStart(7) +
      String(a.alvos).padStart(7) +
      String(a.abertos).padStart(8) +
      `${soma >= 0 ? '+' : ''}${soma.toFixed(1)}R`.padStart(9) +
      (a.r.length ? `${soma / a.r.length >= 0 ? '+' : ''}${(soma / a.r.length).toFixed(2)}` : '—').padStart(8),
  );
}
console.log('-'.repeat(cab.length));
console.log(
  'TOTAL'.padEnd(34) + String(linhas.length).padStart(7) + String(totalOps).padStart(9) + ''.padStart(14) +
    ''.padStart(8) + `${totalR >= 0 ? '+' : ''}${totalR.toFixed(1)}R`.padStart(9) +
    (totalOps ? `${totalR / totalOps >= 0 ? '+' : ''}${(totalR / totalOps).toFixed(2)}` : '—').padStart(8),
);
if (semVelas) console.log(`\n(${semVelas} sinais sem a vela do sinal no histórico disponível — não avaliados)`);
console.log('\nR = risco por operação. +1R num risco de 1% da conta é +1% da conta.');
