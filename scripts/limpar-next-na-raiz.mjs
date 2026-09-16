#!/usr/bin/env node
/**
 * Apaga o `.next` da raiz do repositório quando é uma ligação simbólica.
 *
 * ── PORQUE ─────────────────────────────────────────────────────────────────
 *
 * Builds anteriores criavam aqui uma ligação para `apps/dashboard/.next`, a
 * pensar no preset Next.js da Hostinger. Estava errado por dois motivos:
 *
 *   - A Hostinger arranca esta aplicação pelo `server.js` (Entry file, com a
 *     Output directory vazia), não pelo preset Next.js — que não sabe lidar
 *     com um monorepo.
 *   - As regras de deploy da Hostinger proíbem ligações simbólicas na pasta
 *     publicada: partem o deploy depois de o build acabar bem.
 *
 * A pasta onde a Hostinger compila é reutilizada entre deploys e o `.gitignore`
 * esconde o `.next`, por isso a ligação antiga ficava lá para sempre se o build
 * não a apagasse. Só se apaga a LIGAÇÃO: o destino fica intacto, e uma pasta
 * `.next` real na raiz não é tocada.
 */

import { lstatSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIGACAO = join(dirname(fileURLToPath(import.meta.url)), '..', '.next');

try {
  if (lstatSync(LIGACAO).isSymbolicLink()) {
    unlinkSync(LIGACAO);
    console.log('[limpar-next] ligação .next antiga removida da raiz');
  }
} catch {
  /* não existe — nada a fazer */
}
