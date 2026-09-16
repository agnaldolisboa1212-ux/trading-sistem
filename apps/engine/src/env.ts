/**
 * Carregamento do .env.
 *
 * O motor lia `process.env` mas nada carregava o ficheiro. O resultado era o
 * pior tipo de falha: `npm run engine:scan` corria, analisava tudo, imprimia o
 * radar — e saltava a persistência em silêncio, porque `isDbConfigured()`
 * devolvia false. Nenhum erro, nenhum aviso, e a base de dados vazia.
 *
 * Implementado sem dependências: o formato que precisamos de suportar é
 * `CHAVE=valor` com comentários, e trazer uma biblioteca para isso seria
 * desproporcionado.
 *
 * Variáveis já presentes no ambiente têm precedência sobre o ficheiro — é o que
 * permite sobrepor pontualmente sem editar nada:
 *
 *     MIN_CONFIDENCE=0.8 npm run engine:scan
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Sobe a árvore à procura do .env — o motor corre de `apps/engine/dist`. */
function findEnvFile(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Remove aspas envolventes, se existirem. */
function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'"))) {
    return v.slice(1, -1);
  }
  return v;
}

export interface LoadEnvResult {
  path: string | null;
  loaded: number;
  skipped: number;
}

export function loadEnvFile(): LoadEnvResult {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = findEnvFile(here);
  if (!path) return { path: null, loaded: 0, skipped: 0 };

  let loaded = 0;
  let skipped = 0;

  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (!key) continue;

    // O ambiente vence o ficheiro.
    if (process.env[key] !== undefined) {
      skipped++;
      continue;
    }

    process.env[key] = unquote(line.slice(eq + 1));
    loaded++;
  }

  return { path, loaded, skipped };
}
