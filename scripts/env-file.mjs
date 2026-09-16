/**
 * Escrita segura no .env.
 *
 * PORQUÊ: os scripts de configuração liam o ficheiro no arranque e escreviam-no
 * inteiro no fim. Quando dois corriam com sobreposição — ou quando o utilizador
 * editava o ficheiro enquanto um deles esperava —, o segundo a gravar repunha a
 * sua cópia antiga e apagava silenciosamente as alterações do outro. Aconteceu
 * mesmo: o setup do Telegram ficou 3 minutos à espera de uma mensagem e, ao
 * gravar, apagou as variáveis do n8n acrescentadas nesse intervalo.
 *
 * A correção é RELER imediatamente antes de gravar e alterar apenas as linhas
 * indicadas, preservando tudo o resto — incluindo comentários e a convenção de
 * fim de linha do ficheiro (o .env aqui é CRLF).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

/** Lê o .env para um objeto simples. */
export function readEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

/**
 * Define chaves no .env preservando o resto do ficheiro.
 *
 * Relê no momento da escrita: quaisquer alterações feitas desde que o script
 * arrancou sobrevivem.
 */
export function setEnv(path, updates) {
  const raw = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);

  const changed = [];
  for (const [key, value] of Object.entries(updates)) {
    const idx = lines.findIndex((l) => l.trimStart().startsWith(`${key}=`));
    const linha = `${key}=${value}`;
    if (idx >= 0) {
      if (lines[idx] !== linha) changed.push(key);
      lines[idx] = linha;
    } else {
      // Chave nova vai para o fim, sem mexer na estrutura existente.
      while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
      lines.push(linha);
      changed.push(key);
    }
  }

  writeFileSync(path, lines.join(eol).replace(/\s*$/, eol), 'utf8');
  return changed;
}
