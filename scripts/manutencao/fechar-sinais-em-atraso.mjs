#!/usr/bin/env node
/**
 * Fecha os sinais que ficaram para trás — sem estado, para sempre "activos".
 *
 *   node scripts/manutencao/fechar-sinais-em-atraso.mjs            (só mostra)
 *   node scripts/manutencao/fechar-sinais-em-atraso.mjs --aplicar  (escreve)
 *
 * POR QUE É PRECISO
 * -----------------
 * Durante um período o motor saltava o acompanhamento dos planos cuja
 * estratégia tinha saído do catálogo (corrigido em 22/09/2026). Esses sinais
 * ficaram sem `estado`: aparecem como activos na página inicial, não entram no
 * histórico e não contam no balanço — e como o motor só acompanha um plano
 * enquanto a VELA DO SINAL ainda está na janela que pede à Deriv (300 velas),
 * um sinal de 15m com mais de três dias nunca mais fecharia sozinho.
 *
 * O que este script faz é o que o motor teria feito na altura: pede as velas,
 * corre o mesmo `acompanharOperacao` e grava o desfecho. Não inventa nada — se
 * a operação ainda está viva, deixa-a viva.
 *
 * Escreve com a chave de SERVIÇO quando existe (SUPABASE_SECRET_KEY no .env);
 * sem ela usa a publicável, e a escrita pode ser recusada pelas políticas.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/';
const { acompanharOperacao, nomeDeEstrategia } = await import(pathToFileURL(RAIZ + 'packages/core/dist/index.js').href);
const { velasDeriv } = await import(pathToFileURL(RAIZ + 'packages/data/dist/index.js').href);
const { acharSimbolo } = await import(pathToFileURL(RAIZ + 'packages/data/dist/deriv-simbolos.js').href);

const APLICAR = process.argv.includes('--aplicar');
const DIAS = Number(process.env.DIAS ?? 120);
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
const CHAVE = cfg.SUPABASE_SECRET_KEY ?? cfg.SUPABASE_SERVICE_ROLE_KEY ?? cfg.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? cfg.SUPABASE_ANON_KEY;
if (!URL_DB || !CHAVE) {
  console.error('sem credenciais do Supabase');
  process.exit(1);
}
const cabecalhos = { apikey: CHAVE, Authorization: `Bearer ${CHAVE}`, 'Content-Type': 'application/json' };

const desde = new Date(Date.now() - DIAS * 86_400_000).toISOString();
const r = await fetch(
  `${URL_DB}/rest/v1/sinais_tempo_real?select=*&estado=is.null&gerado_em=gte.${desde}&order=gerado_em.asc&limit=2000`,
  { headers: cabecalhos },
);
const linhas = await r.json();
if (!Array.isArray(linhas)) {
  console.error('resposta inesperada:', JSON.stringify(linhas).slice(0, 200));
  process.exit(1);
}
console.log(`${linhas.length} sinais sem estado nos últimos ${DIAS} dias${APLICAR ? '' : '  (simulação — nada é escrito)'}\n`);

const cache = new Map();
async function velas(simbolo, tf) {
  const chave = `${simbolo}|${tf}`;
  if (cache.has(chave)) return cache.get(chave);
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
  cache.set(chave, v);
  return v;
}

const resumo = new Map();
let escritos = 0;
let vivos = 0;
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
  // Ainda a decorrer: fica como está. Só se grava um desfecho.
  if (a.estado === 'em-curso' || a.estado === 'protegida' || a.estado === 'a-aguardar-entrada') {
    vivos++;
    continue;
  }
  const chave = `${nomeDeEstrategia(l.estrategia)} → ${a.estado}`;
  const acc = resumo.get(chave) ?? { n: 0, r: 0 };
  acc.n++;
  acc.r += a.resultadoR ?? 0;
  resumo.set(chave, acc);

  if (APLICAR) {
    const resposta = await fetch(`${URL_DB}/rest/v1/sinais_tempo_real?id=eq.${encodeURIComponent(l.id)}`, {
      method: 'PATCH',
      headers: { ...cabecalhos, Prefer: 'return=minimal' },
      body: JSON.stringify({
        estado: a.estado,
        stop_actual: a.stopActual,
        resultado_r: a.resultadoR,
        eventos: a.eventos,
        acompanhado_em: new Date().toISOString(),
      }),
    });
    if (resposta.ok) escritos++;
    else if (escritos === 0) console.error('escrita recusada:', resposta.status, (await resposta.text()).slice(0, 160));
  }
}

console.log('desfecho'.padEnd(52) + 'sinais'.padStart(7) + 'R total'.padStart(9));
console.log('-'.repeat(68));
let totalN = 0;
let totalR = 0;
for (const [k, a] of [...resumo].sort((x, y) => y[1].n - x[1].n)) {
  totalN += a.n;
  totalR += a.r;
  console.log(k.slice(0, 51).padEnd(52) + String(a.n).padStart(7) + `${a.r >= 0 ? '+' : ''}${a.r.toFixed(1)}R`.padStart(9));
}
console.log('-'.repeat(68));
console.log('TOTAL'.padEnd(52) + String(totalN).padStart(7) + `${totalR >= 0 ? '+' : ''}${totalR.toFixed(1)}R`.padStart(9));
console.log(`\n${vivos} ainda vivos (ficam como estão) · ${semVelas} sem a vela do sinal no histórico disponível`);
if (APLICAR) console.log(`${escritos} linhas actualizadas na base de dados.`);
else console.log('\nPara aplicar: node scripts/manutencao/fechar-sinais-em-atraso.mjs --aplicar');
