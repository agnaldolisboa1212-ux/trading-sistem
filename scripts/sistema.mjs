#!/usr/bin/env node
/**
 * Arranca o sistema inteiro com um comando:
 *
 *   npm run sistema            motores + painel em modo desenvolvimento
 *   npm run sistema:producao   motores + painel compilado (next build + start)
 *
 * O que faz, por ordem:
 *
 *   1. compila os pacotes e o motor (`tsc -b`) — um motor antigo em `dist/` a
 *      correr contra código novo é o tipo de erro que só se descobre à noite
 *   2. lança o agendador dos DOIS motores (principal diário + tempo real)
 *   3. lança o painel
 *   4. reinicia qualquer um dos dois se cair, com espera crescente
 *
 * Sem dependências: `child_process` chega. Ctrl+C pára tudo.
 *
 * NÃO é um gestor de processos de produção. Numa VPS use `pm2` ou `systemd`
 * (ver docs/producao.md) — sobrevivem a reinícios da máquina, este não.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const producao = process.argv.includes('--producao');
/*
 * `--sem-compilar`: a plataforma de alojamento (Hostinger, etc.) ja correu
 * `npm run build` num passo proprio. Voltar a compilar no arranque duplicaria o
 * tempo de deploy e, sem permissao de escrita em `dist/`, falharia.
 */
const semCompilar = process.argv.includes('--sem-compilar');
const windows = process.platform === 'win32';

const cor = (codigo, texto) => (process.stdout.isTTY ? `\x1b[${codigo}m${texto}\x1b[0m` : texto);

/**
 * No Windows o `npx` é um `.cmd` e só arranca através da shell. Passar a lista
 * de argumentos COM `shell: true` dispara o aviso DEP0190 do Node (os argumentos
 * não são escapados, só concatenados). Monta-se a linha já citada e passa-se
 * como um único comando — o mesmo resultado, sem ambiguidade.
 */
const citar = (a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
const linha = (comando, args) => [comando, ...args].map(citar).join(' ');

function correrSincrono(rotulo, comando, args, cwd = RAIZ) {
  console.log(cor('36', `[sistema] ${rotulo}…`));
  const r = windows
    ? spawnSync(linha(comando, args), { cwd, stdio: 'inherit', shell: true })
    : spawnSync(comando, args, { cwd, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(cor('31', `[sistema] ${rotulo} falhou (código ${r.status}). A parar.`));
    process.exit(r.status ?? 1);
  }
}

// --- 1. compilar -------------------------------------------------------------
if (!semCompilar) correrSincrono('a compilar pacotes e motores', 'npx', ['tsc', '-b']);

if (producao && !semCompilar) {
  correrSincrono('a compilar o painel para produção', 'npx', ['next', 'build'], join(RAIZ, 'apps', 'dashboard'));
}

// --- 2 e 3. processos -------------------------------------------------------
const processos = [
  {
    nome: 'motores',
    cor: '33',
    comando: process.execPath,
    args: [join(RAIZ, 'apps', 'engine', 'dist', 'index.js'), 'schedule'],
    cwd: RAIZ,
  },
  {
    nome: 'painel',
    cor: '35',
    comando: 'npx',
    /*
     * Em desenvolvimento, 127.0.0.1: o token Deriv do dono responde sem login
     * (lib/deriv/decisao.ts), e isso só é seguro se mais ninguém na rede chegar
     * ao painel.
     *
     * Em produção, 0.0.0.0: o proxy da plataforma pode ligar-se por outra
     * interface, e aí a proteção não é o endereço — é o login obrigatório e a
     * regra do dono. `HOST` sobrepõe em qualquer dos casos.
     */
    args: [
      'next',
      producao ? 'start' : 'dev',
      '-p',
      process.env.PORT ?? '3000',
      '-H',
      process.env.HOST ?? (producao ? '0.0.0.0' : '127.0.0.1'),
    ],
    cwd: join(RAIZ, 'apps', 'dashboard'),
  },
];

if (!existsSync(processos[0].args[0])) {
  console.error(cor('31', '[sistema] o motor não compilou para apps/engine/dist/index.js'));
  process.exit(1);
}

let aParar = false;
const vivos = new Map();

function prefixar(nome, codigoCor, fluxo, destino) {
  let resto = '';
  fluxo.on('data', (bloco) => {
    const texto = resto + bloco.toString();
    const linhas = texto.split(/\r?\n/);
    resto = linhas.pop() ?? '';
    for (const l of linhas) destino.write(`${cor(codigoCor, `[${nome}]`)} ${l}\n`);
  });
}

function lancar(p, tentativa = 0) {
  if (aParar) return;
  const opcoes = { cwd: p.cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] };
  const filho =
    windows && p.comando === 'npx'
      ? spawn(linha(p.comando, p.args), { ...opcoes, shell: true })
      : spawn(p.comando, p.args, opcoes);
  vivos.set(p.nome, filho);
  const arrancouEm = Date.now();

  prefixar(p.nome, p.cor, filho.stdout, process.stdout);
  prefixar(p.nome, p.cor, filho.stderr, process.stderr);

  filho.on('exit', (codigo) => {
    vivos.delete(p.nome);
    if (aParar) return;

    // Correu mais de 2 minutos: foi uma queda, não um arranque falhado. Reset.
    const proxima = Date.now() - arrancouEm > 120_000 ? 0 : tentativa + 1;
    const espera = Math.min(60_000, 2_000 * 2 ** Math.min(proxima, 5));
    console.error(
      cor('31', `[sistema] ${p.nome} terminou (código ${codigo}). A reiniciar em ${Math.round(espera / 1000)}s.`),
    );
    setTimeout(() => lancar(p, proxima), espera);
  });
}

for (const p of processos) lancar(p);

console.log(
  cor(
    '32',
    `[sistema] motores e painel a arrancar${producao ? ' (produção)' : ''}. ` +
      `Painel em http://localhost:${process.env.PORT ?? '3000'} · Ctrl+C para parar tudo.`,
  ),
);

// --- 4. paragem --------------------------------------------------------------
function pararTudo() {
  if (aParar) return;
  aParar = true;
  console.log(cor('36', '\n[sistema] a parar motores e painel…'));
  for (const [, filho] of vivos) {
    if (!filho.pid) continue;
    if (windows) {
      // O `next` lança processos filhos; sem /T ficariam órfãos a ocupar a porta.
      spawnSync('taskkill', ['/pid', String(filho.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      filho.kill('SIGTERM');
    }
  }
  setTimeout(() => process.exit(0), 1500);
}

process.on('SIGINT', pararTudo);
process.on('SIGTERM', pararTudo);
