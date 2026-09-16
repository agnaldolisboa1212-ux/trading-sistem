import 'server-only';

/**
 * Login com a Deriv — OAuth 2.0 com PKCE.
 *
 * Endpoints e parâmetros tirados da documentação oficial
 * (developers.deriv.com/docs/intro/oauth):
 *
 *   autorizar  GET  https://auth.deriv.com/oauth2/auth
 *              response_type=code, client_id, redirect_uri, scope, state,
 *              code_challenge, code_challenge_method=S256
 *   token      POST https://auth.deriv.com/oauth2/token   (form-urlencoded)
 *              grant_type=authorization_code, client_id, code, code_verifier,
 *              redirect_uri
 *              → { access_token, expires_in: 3600, token_type: "Bearer" }
 *
 * ── PORQUE PKCE ────────────────────────────────────────────────────────────
 *
 * Sem ele, quem intercetasse o `code` no regresso trocava-o por um token. Com
 * PKCE a troca exige o `code_verifier`, que nunca sai do servidor: vai cifrado
 * num cookie `httpOnly` e só o servidor o abre.
 *
 * ── A SENHA ────────────────────────────────────────────────────────────────
 *
 * Nunca passa por esta aplicação. A pessoa escreve-a na página da própria
 * Deriv; o que volta para aqui é um código de uso único.
 *
 * ── LIMITE CONHECIDO ───────────────────────────────────────────────────────
 *
 * A documentação não menciona refresh tokens. O token dura uma hora e depois
 * é preciso ligar de novo. Se a sessão na Deriv ainda estiver aberta, a Deriv
 * normalmente não volta a pedir a senha — é um redirecionamento e volta.
 */

import { createHash, randomBytes } from 'node:crypto';

export const URL_AUTORIZAR = 'https://auth.deriv.com/oauth2/auth';
export const URL_TOKEN = 'https://auth.deriv.com/oauth2/token';

/** Pedido em curso. Vive 10 minutos, só no caminho das rotas OAuth. */
export const COOKIE_PKCE = 'deriv_pkce';
/** A ligação feita. */
export const COOKIE_SESSAO = 'deriv_oauth';
export const CAMINHO_PKCE = '/api/deriv/oauth';

export interface PedidoPkce {
  /** code_verifier */
  v: string;
  /** state */
  s: string;
  /** utilizador da plataforma que pediu */
  u: string | null;
  /** redirect_uri usado — a troca tem de repetir exatamente o mesmo */
  r: string;
  /** expira em (ms) */
  e: number;
}

export function exigirLogin(): boolean {
  return process.env.NODE_ENV === 'production' || process.env['DERIV_EXIGIR_LOGIN'] === 'true';
}

/**
 * Âmbitos pedidos. A documentação lista `trade account_manage application_read
 * payment`; pede-se o mínimo para ver contas e negociar. `payment` (depósitos e
 * levantamentos) fica de fora de propósito.
 */
export function ambito(): string {
  return process.env['DERIV_OAUTH_SCOPE'] ?? 'trade account_manage';
}

export function gerarPkce(): { verificador: string; desafio: string; estado: string } {
  const verificador = randomBytes(32).toString('base64url');
  const desafio = createHash('sha256').update(verificador).digest('base64url');
  const estado = randomBytes(16).toString('base64url');
  return { verificador, desafio, estado };
}

/**
 * URL de regresso registado na Deriv.
 *
 * Em produção TEM de vir de `DERIV_OAUTH_REDIRECT`. Deduzi-lo do cabeçalho
 * `Host` seria aceitar um valor que o cliente escolhe — a Deriv recusaria um
 * URL não registado, mas não é sítio para confiar nisso.
 */
export function urlRegresso(pedido: Request): string | null {
  const fixo = process.env['DERIV_OAUTH_REDIRECT'];
  if (fixo) return fixo;
  if (exigirLogin()) return null;
  return `${new URL(pedido.url).origin}/api/deriv/oauth/retorno`;
}

export function urlAutorizacao(p: {
  clientId: string;
  redirectUri: string;
  desafio: string;
  estado: string;
}): string {
  const u = new URL(URL_AUTORIZAR);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', p.clientId);
  u.searchParams.set('redirect_uri', p.redirectUri);
  u.searchParams.set('scope', ambito());
  u.searchParams.set('state', p.estado);
  u.searchParams.set('code_challenge', p.desafio);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

export async function trocarCodigo(p: {
  clientId: string;
  codigo: string;
  verificador: string;
  redirectUri: string;
}): Promise<{ token: string; expiraEmSegundos: number }> {
  const r = await fetch(URL_TOKEN, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: p.clientId,
      code: p.codigo,
      code_verifier: p.verificador,
      redirect_uri: p.redirectUri,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });

  const texto = await r.text();
  let j: Record<string, unknown> = {};
  try {
    j = JSON.parse(texto) as Record<string, unknown>;
  } catch {
    /* resposta não-JSON: fica o HTTP */
  }

  const token = j['access_token'];
  if (!r.ok || typeof token !== 'string') {
    const motivo = String(j['error_description'] ?? j['error'] ?? `HTTP ${r.status}`);
    throw new Error(`a Deriv recusou a troca do código (${motivo.slice(0, 160)})`);
  }

  const expira = Number(j['expires_in']);
  return { token, expiraEmSegundos: Number.isFinite(expira) && expira > 0 ? expira : 3600 };
}
