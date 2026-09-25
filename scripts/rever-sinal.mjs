#!/usr/bin/env node
/**
 * Revê o último sinal de ICT ALGO / Asia Range Algo de um instrumento com as
 * regras ACTUAIS (stop para lá do POI de entrada; a confirmação LTF — 5M no
 * ICT, 3M no Asia — só decide a entrada).
 *
 *   npm run build            (uma vez, para o dist estar em dia)
 *   node scripts/rever-sinal.mjs            # último sinal do US30
 *   node scripts/rever-sinal.mjs GBPJPY     # outro instrumento
 *
 * Lê o sinal de `sinais_tempo_real` (Supabase, credenciais de .env /
 * apps/dashboard/.env.local), pede as velas à Deriv, corta-as no instante do
 * sinal (nada do futuro entra na decisão) e volta a correr a estratégia.
 * Mostra entrada/stop/alvo antigos e novos e o que cada um teria dado nas velas
 * que vieram depois.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..') + '/';
const core = await import(pathToFileURL(RAIZ + 'packages/core/dist/index.js').href);
const { velasDeriv } = await import(pathToFileURL(RAIZ + 'packages/data/dist/index.js').href);
const { acharSimbolo } = await import(pathToFileURL(RAIZ + 'packages/data/dist/deriv-simbolos.js').href);
const { planIctAlgo, planAsiaRangeAlgo, acompanharOperacao, paresSmtIct } = core;

const SIMBOLO = (process.argv[2] ?? 'US30').toUpperCase();
const ALGOS = ['ict-algo', 'asia-range-algo'];
const GRAN = { '15m': 900, '1h': 3600, '4h': 14400 };
const VELAS = 1500;

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

const r = await fetch(
  `${URL_DB}/rest/v1/sinais_tempo_real?select=*&simbolo=eq.${SIMBOLO}` +
    `&estrategia=in.(${ALGOS.join(',')})&order=gerado_em.desc&limit=1`,
  { headers: { apikey: CHAVE, Authorization: `Bearer ${CHAVE}` } },
);
const [sinal] = await r.json();
if (!sinal) {
  console.log(`Sem sinais de ICT ALGO / Asia Range Algo para ${SIMBOLO}.`);
  process.exit(0);
}
const tf = sinal.timeframe;
const gran = GRAN[tf];
if (!gran) {
  console.error(`timeframe ${tf} não suportado`);
  process.exit(1);
}
const geradoEm = new Date(sinal.gerado_em).getTime();
const fechoSinal = geradoEm + gran * 1000;
const sim = acharSimbolo(SIMBOLO);

const pedir = async (codigo, g) => {
  const s = acharSimbolo(codigo);
  if (!s) return [];
  try {
    return await velasDeriv(s.deriv, g, VELAS);
  } catch (err) {
    console.error(`velas ${codigo} ${g}s: ${err instanceof Error ? err.message : err}`);
    return [];
  }
};
/** Só as velas que já tinham FECHADO quando o sinal saiu. */
const ate = (velas, g) => velas.filter((c) => c.time + g * 1000 <= fechoSinal);

const todas = await pedir(SIMBOLO, gran);
const iSinal = todas.findIndex((c) => c.time === geradoEm);
if (iSinal < 0) {
  console.error('A vela do sinal já não está no histórico que a Deriv devolve.');
  process.exit(1);
}
const velas = todas.slice(0, iSinal + 1);
const diarias = ate(await pedir(SIMBOLO, 86400), 86400);
let par = null;
for (const c of paresSmtIct(SIMBOLO)) {
  const v = ate(await pedir(c, gran), gran);
  if (v.length) {
    par = { simbolo: c, velas: v };
    break;
  }
}
const ltf = ate(await pedir(SIMBOLO, 300), 300);
const ltf3 = sinal.estrategia === 'asia-range-algo' ? ate(await pedir(SIMBOLO, 180), 180) : undefined;

const algo = { diarias, par, ltf, ltf3 };
const ctx = { symbol: SIMBOLO, timeframe: tf };
const [novo] = sinal.estrategia === 'ict-algo' ? planIctAlgo(velas, ctx, algo) : planAsiaRangeAlgo(velas, ctx, algo);

const fmt = (x) => (x == null ? '—' : Number(x).toFixed(sim?.casas ?? 2));
const antigo = {
  direccao: sinal.direccao,
  entrada: Number(sinal.entrada),
  stop: Number(sinal.stop),
  alvos: (Array.isArray(sinal.alvos) ? sinal.alvos : []).map((a) => ({ preco: Number(a.preco) })),
};
const resultado = (p) => {
  const a = acompanharOperacao({ estrategia: sinal.estrategia, ...p, geradoEm }, todas);
  const fim = a.eventos[a.eventos.length - 1];
  return a.resultadoR === null
    ? `${a.estado}${fim ? ` (último evento: ${fim.tipo})` : ''}`
    : `${a.resultadoR >= 0 ? '+' : ''}${a.resultadoR.toFixed(2)}R (${fim?.tipo})`;
};

console.log(`\n${SIMBOLO} · ${sinal.estrategia} · ${tf} · ${new Date(geradoEm).toISOString()} · ${sinal.direccao}`);
console.log('\nANTES (como foi anunciado)');
console.log(`  entrada ${fmt(antigo.entrada)}  stop ${fmt(antigo.stop)}  alvo ${fmt(antigo.alvos[0]?.preco)}`);
console.log(`  risco ${fmt(Math.abs(antigo.entrada - antigo.stop))}  →  ${resultado(antigo)}`);

console.log('\nAGORA (stop para lá do POI; confirmação LTF só para entrar)');
if (!novo) {
  console.log('  Com as regras actuais este sinal NÃO sairia (falta confirmação LTF, RR < 2 com o stop maior, ou o setup mudou).');
} else {
  const p = {
    direccao: novo.direction,
    entrada: novo.entryPrice,
    stop: novo.stopLoss,
    alvos: novo.targets.map((t) => ({ preco: t.price })),
  };
  console.log(`  entrada ${fmt(p.entrada)}  stop ${fmt(p.stop)}  alvo ${fmt(p.alvos[0]?.preco)}  (${novo.maxRMultiple.toFixed(1)}R)`);
  console.log(`  risco ${fmt(Math.abs(p.entrada - p.stop))}  →  ${resultado(p)}`);
  console.log(`\n  ${novo.rationale}`);
}
console.log('');
