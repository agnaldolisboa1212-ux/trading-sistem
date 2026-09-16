#!/usr/bin/env node
/**
 * Junta em `saida/` tudo o que o build gera e o arranque precisa — o último passo
 * de `npm run build`.
 *
 * ── PORQUE ─────────────────────────────────────────────────────────────────
 *
 * A Hostinger compila numa pasta e corre a aplicação noutra: um checkout do
 * repositório com o `node_modules`. Nessa pasta não chega nada do que o build
 * gerou — nem `packages/*\/dist`, nem `apps/engine/dist`, nem a compilação do
 * painel (Runtime logs: "FALTA" em todos). O que a Hostinger leva do build para
 * a aplicação é a **Output directory**, e é isso que esta pasta é.
 *
 * A estrutura dentro de `saida/` repete a do repositório. Assim serve venha a
 * Hostinger a pô-la como subpasta (`saida/…`, e o `server.js` repõe os ficheiros
 * no sítio) ou a despejar o conteúdo na raiz (e aí já está tudo no sítio).
 *
 * Fica de fora a `cache` do Next: centenas de megabytes que só aceleram o build
 * seguinte.
 */

import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SAIDA = join(RAIZ, 'saida');
const CACHE_NEXT = join(RAIZ, 'apps', 'dashboard', 'compilado', 'cache');

const pacotes = readdirSync(join(RAIZ, 'packages')).flatMap((p) => [
  `packages/${p}/package.json`,
  `packages/${p}/dist`,
]);

const ITENS = [
  'server.js',
  'package.json',
  'apps/dashboard/package.json',
  'apps/dashboard/next.config.mjs',
  'apps/dashboard/public',
  'apps/dashboard/compilado',
  'apps/engine/package.json',
  'apps/engine/dist',
  ...pacotes,
];

const faltam = ITENS.filter((item) => !existsSync(join(RAIZ, item)));
if (faltam.length > 0) {
  console.error(`[preparar-saida] o build não gerou: ${faltam.join(', ')}`);
  process.exit(1);
}

rmSync(SAIDA, { recursive: true, force: true });
for (const item of ITENS) {
  cpSync(join(RAIZ, item), join(SAIDA, item), {
    recursive: true,
    filter: (origem) => origem !== CACHE_NEXT,
  });
}

console.log(`[preparar-saida] saida/ pronta com ${ITENS.length} itens`);
