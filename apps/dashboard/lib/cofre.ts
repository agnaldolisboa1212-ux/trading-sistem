import 'server-only';

/**
 * Cofre — cifra valores que ficam guardados no browser mas não podem ser lidos
 * nem alterados lá.
 *
 * Serve para o token OAuth da Deriv e para o pedido PKCE em curso. Os dois
 * vivem em cookies `httpOnly` (o JavaScript da página não lhes chega), e além
 * disso vão cifrados e autenticados com AES-256-GCM:
 *
 *   · cifrado      — quem copiar o cookie do disco não fica com o token
 *   · autenticado  — um cookie alterado à mão falha a abrir, em vez de ser
 *                    aceite com conteúdo forjado
 *
 * A chave vem de `COFRE_CHAVE`. Passa por SHA-256 para aceitar qualquer formato
 * (hex, base64, frase longa) e resultar sempre nos 32 bytes que o AES-256 exige.
 * Trocar a chave invalida todas as ligações Deriv existentes — o que é o
 * comportamento certo quando se suspeita de uma fuga.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const MINIMO = 32;

export function cofreConfigurado(): boolean {
  const bruta = process.env['COFRE_CHAVE'];
  return Boolean(bruta && bruta.length >= MINIMO);
}

function chave(): Buffer {
  const bruta = process.env['COFRE_CHAVE'];
  if (!bruta || bruta.length < MINIMO) {
    throw new Error(`COFRE_CHAVE em falta ou curta demais (mínimo ${MINIMO} caracteres).`);
  }
  return createHash('sha256').update(bruta).digest();
}

/** `iv.tag.dados`, cada parte em base64url — seguro dentro de um cookie. */
export function selar(valor: unknown): string {
  const iv = randomBytes(12);
  const cifra = createCipheriv('aes-256-gcm', chave(), iv);
  const dados = Buffer.concat([cifra.update(JSON.stringify(valor), 'utf8'), cifra.final()]);
  return [iv, cifra.getAuthTag(), dados].map((b) => b.toString('base64url')).join('.');
}

/** Devolve `null` para qualquer coisa que não abra: ausente, alterada, chave trocada. */
export function abrir<T>(selado: string | null | undefined): T | null {
  if (!selado || !cofreConfigurado()) return null;
  try {
    const [iv, tag, dados] = selado.split('.').map((p) => Buffer.from(p, 'base64url'));
    if (!iv || !tag || !dados || iv.length !== 12 || tag.length !== 16) return null;
    const decifra = createDecipheriv('aes-256-gcm', chave(), iv);
    decifra.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decifra.update(dados), decifra.final()]).toString('utf8')) as T;
  } catch {
    return null;
  }
}
