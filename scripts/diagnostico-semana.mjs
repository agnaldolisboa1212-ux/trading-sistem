#!/usr/bin/env node
/**
 * Porque é que não saíram sinais esta semana? Três respostas, lado a lado:
 *
 *   1  O motor de tempo real correu? (`motor_execucoes`: passagens, falhas,
 *      buracos de mais de 10 min e os erros mais repetidos)
 *   2  O que foi anunciado (`sinais_tempo_real`), por estratégia
 *   3  O que as estratégias validadas (as "básicas", sem os algos) teriam
 *      anunciado: para cada instrumento e timeframe seguido nos perfis, as
 *      velas da Deriv e, vela a vela desde o início da semana, a mesma chamada
 *      que o motor faz (`executarEstrategiasValidadas`, 300 velas, só sinais da
 *      última vela fechada)
 *
 *   npm run build            (uma vez, para o dist estar em dia)
 *   node scripts/diagnostico-semana.mjs          # desde segunda-feira
 *   node scripts/diagnostico-semana.mjs 10       # os últimos 10 dias
 *
 * Se (3) tem sinais que (2) não tem, o motor perdeu-os — e (1) diz porquê.
 * Se (3) também está vazio, as regras simplesmente não dispararam.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..') + '/';
const core = await import(pathToFileURL(RAIZ + 'packages/core/dist/index.js').href);
const { velasDeriv } = await import(pathToFileURL(RAIZ + 'packages/data/dist/index.js').href);
const { acharSimbolo } = await import(pathToFileURL(RAIZ + 'packages/data/dist/deriv-simbolos.js').href);
const { estrategiasPara, executarEstrategiasValidadas, timeframesDoPerfil, nomeDeEstrategia } = core;

const ALGOS = new Set(['ict-algo', 'asia-range-algo']);
const GRAN = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400 };
/** O que o motor pede por omissão (`INTRADAY_CANDLES`). */
const VELAS = 300;
/** O motor pede mais velas para o VWAP do mês chegar ao dia 1 (`VELAS_VWAP`). */
const VELAS_VWAP = 800;
/** Os instrumentos do motor quando nenhum perfil escolheu (VIGILANCIA_OMISSAO). */
const OMISSAO = ['EURUSD', 'GBPUSD', 'US100', 'SP500', 'US30', 'GER30'];

function env(ficheiro) {
  try {
    return Object.fromEntries(
      readFileSync(RAIZ + ficheiro, 'utf8')
        .split('\n')
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
    );
  } catch {
    return {};
  }
}
const cfg = { ...env('.env'), ...env('apps/engine/.env'), ...env('apps/dashboard/.env.local'), ...process.env };
const URL_DB = cfg.SUPABASE_URL ?? cfg.NEXT_PUBLIC_SUPABASE_URL;
// A chave de serviço lê tudo (perfis, execuções); a pública só o que as regras deixarem.
const CHAVE =
  cfg.SUPABASE_SECRET_KEY ?? cfg.SUPABASE_SERVICE_ROLE_KEY ?? cfg.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? cfg.SUPABASE_ANON_KEY;
if (!URL_DB || !CHAVE) {
  console.error('sem credenciais do Supabase em .env / apps/engine/.env / apps/dashboard/.env.local');
  process.exit(1);
}

const agora = Date.now();
const dias = Number(process.argv[2]);
const desde = Number.isFinite(dias) && dias > 0 ? agora - dias * 86_400_000 : inicioDaSemana(agora);
const desdeIso = new Date(desde).toISOString();

function inicioDaSemana(t) {
  const d = new Date(t);
  const dow = (d.getUTCDay() + 6) % 7; // segunda = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow);
}

async function ler(tabela, query) {
  let r;
  try {
    r = await fetch(`${URL_DB}/rest/v1/${tabela}?${query}`, {
      headers: { apikey: CHAVE, Authorization: `Bearer ${CHAVE}` },
    });
  } catch (err) {
    return { erro: err instanceof Error ? err.message : String(err), linhas: [] };
  }
  const corpo = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(corpo)) return { erro: JSON.stringify(corpo).slice(0, 200), linhas: [] };
  return { erro: null, linhas: corpo };
}

const fmtData = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
console.log(`\nDesde ${fmtData(desde)} UTC\n`);

// --- 1. O motor correu? ------------------------------------------------------
{
  const { erro, linhas } = await ler(
    'motor_execucoes',
    `select=iniciado_em,ok,instrumentos,sinais,novos,erros&motor=eq.tempoReal&iniciado_em=gte.${desdeIso}&order=iniciado_em.asc&limit=20000`,
  );
  console.log('1 · MOTOR DE TEMPO REAL');
  if (erro) console.log(`  não consegui ler motor_execucoes: ${erro}`);
  else if (linhas.length === 0) console.log('  NENHUMA passagem registada — o motor não correu (ou não grava no Supabase).');
  else {
    const falhas = linhas.filter((l) => !l.ok).length;
    console.log(`  ${linhas.length} passagens, ${falhas} com falha, última às ${fmtData(Date.parse(linhas.at(-1).iniciado_em))} UTC`);
    const buracos = [];
    for (let k = 1; k < linhas.length; k++) {
      const a = Date.parse(linhas[k - 1].iniciado_em);
      const b = Date.parse(linhas[k].iniciado_em);
      if (b - a > 10 * 60_000) buracos.push([a, b]);
    }
    const ultima = Date.parse(linhas.at(-1).iniciado_em);
    if (agora - ultima > 10 * 60_000) buracos.push([ultima, agora]);
    if (buracos.length) {
      console.log(`  ${buracos.length} buraco(s) de mais de 10 min sem passagens:`);
      for (const [a, b] of buracos.slice(-10)) console.log(`    ${fmtData(a)} → ${fmtData(b)} (${Math.round((b - a) / 60_000)} min)`);
    } else console.log('  sem buracos de mais de 10 min');
    const contagem = new Map();
    for (const l of linhas) for (const e of l.erros ?? []) {
      const chave = String(e).replace(/\d+(\.\d+)?/g, '#').slice(0, 140);
      contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
    }
    const top = [...contagem].sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (top.length) {
      console.log('  erros mais repetidos:');
      for (const [e, n] of top) console.log(`    ${String(n).padStart(5)}×  ${e}`);
    }
  }
}

// --- 2. O que foi anunciado ---------------------------------------------------
const anunciados = new Set();
{
  const { erro, linhas } = await ler(
    'sinais_tempo_real',
    `select=simbolo,timeframe,estrategia,direccao,gerado_em&gerado_em=gte.${desdeIso}&order=gerado_em.asc&limit=5000`,
  );
  console.log('\n2 · SINAIS ANUNCIADOS');
  if (erro) console.log(`  não consegui ler sinais_tempo_real: ${erro}`);
  else if (linhas.length === 0) console.log('  nenhum');
  else {
    const porEstrategia = new Map();
    for (const l of linhas) {
      anunciados.add(`${l.estrategia}|${l.simbolo}|${l.timeframe}|${Date.parse(l.gerado_em)}`);
      porEstrategia.set(l.estrategia, (porEstrategia.get(l.estrategia) ?? 0) + 1);
    }
    for (const [e, n] of [...porEstrategia].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${nomeDeEstrategia(e)}`);
  }
}

// --- 3. O que as regras teriam dado -----------------------------------------
const { linhas: perfis, erro: erroPerfis } = await ler('perfis_utilizador', 'select=instrumentos,objetivos,timeframes_sinais');
const pares = new Map();
for (const p of erroPerfis ? [] : perfis) {
  const tfs = timeframesDoPerfil(p.objetivos, p.timeframes_sinais);
  for (const c of p.instrumentos ?? []) {
    const s = acharSimbolo(c);
    if (!s) continue;
    const lista = pares.get(s.codigo) ?? new Set();
    for (const tf of tfs) lista.add(tf);
    pares.set(s.codigo, lista);
  }
}
const origem = pares.size ? 'perfis' : `omissão do motor${erroPerfis ? ` (perfis ilegíveis: ${erroPerfis})` : ''}`;
if (!pares.size) for (const c of OMISSAO) pares.set(c, new Set(timeframesDoPerfil([], [])));

// Regras que o motor nunca corre: nenhum perfil segue o instrumento NESSE timeframe.
{
  const todas = [...(core.ESTRATEGIAS_VALIDADAS ?? []), ...(core.ESTRATEGIAS_EM_TESTE ?? [])].filter((e) => !ALGOS.has(e.id));
  const fora = todas.filter((e) => !(e.instrumentos ?? []).some((c) => (e.timeframes ?? []).some((tf) => pares.get(c)?.has(tf))));
  console.log(`\n   Perfis (${origem}): ${[...pares].map(([c, t]) => `${c} ${[...t].join('/')}`).join(' · ')}`);
  if (fora.length) {
    console.log('   Regras que o motor NÃO corre (nenhum perfil segue os seus instrumentos nesse timeframe):');
    for (const e of fora) console.log(`     ${nomeDeEstrategia(e.id)} — ${(e.instrumentos ?? []).join(', ')} em ${(e.timeframes ?? []).join('/')}`);
  }
}

console.log(`\n3 · O QUE AS REGRAS VALIDADAS TERIAM DADO (instrumentos de: ${origem})`);
const fechadas = (v, g) => v.filter((c) => c.time + g * 1000 <= agora);
let total = 0;
let perdidos = 0;
let semVelas = 0;
for (const [codigo, tfs] of pares) {
  const s = acharSimbolo(codigo);
  for (const tf of tfs) {
    const g = GRAN[tf];
    const regras = estrategiasPara(codigo, tf).filter((e) => !ALGOS.has(e.id));
    if (!g || regras.length === 0) continue;
    const nomes = regras.map((e) => e.id);
    const janelaMotor = nomes.some((n) => /vwap/.test(n)) ? VELAS_VWAP : VELAS;
    let velas;
    let diarias;
    try {
      velas = fechadas(await velasDeriv(s.deriv, g, janelaMotor + 200), g);
      diarias = nomes.some((n) => /vwap|dax/.test(n)) ? fechadas(await velasDeriv(s.deriv, 86400, 400), 86400) : undefined;
    } catch (err) {
      semVelas++;
      console.log(`  ${codigo} ${tf}: sem velas (${err instanceof Error ? err.message : err})`);
      continue;
    }
    const linha = [];
    for (let i = 0; i < velas.length; i++) {
      if (velas[i].time < desde) continue;
      const janela = velas.slice(Math.max(0, i + 1 - janelaMotor), i + 1);
      const ultima = janela.at(-1);
      const extra = diarias ? { velas1d: diarias.filter((d) => d.time + 86_400_000 <= ultima.time + g * 1000) } : {};
      const sinais = executarEstrategiasValidadas(janela, { symbol: codigo, timeframe: tf }, extra, nomes).filter(
        (x) => x.generatedAt === ultima.time,
      );
      for (const x of sinais) {
        total++;
        const foi = anunciados.has(`${x.strategy}|${codigo}|${tf}|${x.generatedAt}`);
        if (!foi) perdidos++;
        linha.push(`    ${fmtData(x.generatedAt)}  ${x.direction === 'bullish' ? 'COMPRA' : 'VENDA '}  ${nomeDeEstrategia(x.strategy)}  ${foi ? '✓ anunciado' : '✗ NÃO anunciado'}`);
      }
    }
    console.log(`  ${codigo} ${tf} — ${nomes.join(', ')}: ${linha.length ? '' : 'nenhum sinal'}`);
    for (const l of linha) console.log(l);
  }
}
console.log(
  `\n${total} sinal(is) das regras validadas desde ${fmtData(desde)}, ${perdidos} não anunciado(s).` +
    (semVelas ? ` ${semVelas} par(es) sem velas da Deriv — essa parte ficou por ver.` : total === 0 ? ' As regras não dispararam: a semana não teve os setups delas.' : ''),
);
console.log('');
