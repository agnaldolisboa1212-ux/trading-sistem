#!/usr/bin/env node
/**
 * Cria `.next` na raiz do repositório, a apontar para `apps/dashboard/.next`.
 *
 * ── PORQUE ─────────────────────────────────────────────────────────────────
 *
 * O painel vive em `apps/dashboard`, e é lá que o `next build` escreve. A
 * Hostinger, com o preset Next.js, procura a pasta de build na RAIZ do
 * repositório e recusa o deploy se não a encontrar — mesmo com o build verde.
 *
 * Uma ligação resolve sem mudar a estrutura do monorepo nem copiar centenas de
 * megabytes. O arranque continua a ser o `server.js` (via `npm start`, que é o
 * que a Hostinger corre para apps Next.js: `npm run start -- -p $PORT`).
 *
 * Alvo RELATIVO em Linux: se a plataforma mover a pasta do projeto entre o
 * build e o arranque, a ligação continua a apontar para o sítio certo. No
 * Windows usa-se uma junction, que só aceita caminho absoluto.
 */

import { existsSync, lstatSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ALVO = join(RAIZ, 'apps', 'dashboard', '.next');
const LIGACAO = join(RAIZ, '.next');

if (!existsSync(join(ALVO, 'BUILD_ID'))) {
  console.error('[ligar-next] apps/dashboard/.next não tem build — corra o next build primeiro.');
  process.exit(1);
}

try {
  const estado = lstatSync(LIGACAO);
  // Uma ligação antiga desfaz-se sem tocar no destino; uma pasta real (de um
  // `next build` corrido por engano na raiz) apaga-se.
  if (estado.isSymbolicLink()) unlinkSync(LIGACAO);
  else rmSync(LIGACAO, { recursive: true, force: true });
} catch {
  /* não existia */
}

if (process.platform === 'win32') {
  symlinkSync(ALVO, LIGACAO, 'junction');
} else {
  symlinkSync(join('apps', 'dashboard', '.next'), LIGACAO, 'dir');
}

console.log(`[ligar-next] .next na raiz -> apps/dashboard/.next (${existsSync(join(LIGACAO, 'BUILD_ID')) ? 'ok' : 'FALHOU'})`);
