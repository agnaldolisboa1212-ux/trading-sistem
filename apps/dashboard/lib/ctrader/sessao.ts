import 'server-only';

/**
 * Login com a cTrader (cTrader ID) e a sessão que fica guardada.
 *
 * Documentação: help.ctrader.com/open-api/account-authentication
 *
 *   autorizar  https://id.ctrader.com/my/settings/openapi/grantingaccess/
 *              ?client_id&redirect_uri&scope=trading&product=web
 *   token      GET https://openapi.ctrader.com/apps/token
 *              grant_type=authorization_code|refresh_token, code, redirect_uri,
 *              refresh_token, client_id, client_secret
 *
 * O código de autorização dura um minuto; o access token cerca de 30 dias; o
 * refresh token não expira. A sessão vai CIFRADA (AES-GCM, `COFRE_CHAVE`) num
 * cookie `httpOnly`, ligada à conta da plataforma que a criou: noutra conta, no
 * mesmo browser, não serve. O token nunca chega ao JavaScript da página.
 */

import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { abrir, selar } from '@/lib/cofre';
import { utilizadorDoPedido } from '@/lib/sessao-plataforma';
import { configCtrader } from './ligacao';

export const URL_AUTORIZAR = 'https://id.ctrader.com/my/settings/openapi/grantingaccess/';
export const URL_TOKEN = 'https://openapi.ctrader.com/apps/token';

export const COOKIE_ESTADO = 'ctrader_estado';
export const COOKIE_SESSAO = 'ctrader_sessao';
export const CAMINHO_OAUTH = '/api/ctrader/oauth';
/** O refresh token não expira; a sessão fica 90 dias sem uso. */
export const VIDA_SESSAO_S = 90 * 86_400;

export interface EstadoOAuth {
  /** state */
  s: string;
  /** utilizador da plataforma */
  u: string;
  /** redirect_uri usado */
  r: string;
  /** expira (ms) */
  e: number;
}

export interface SessaoCtrader {
  /** access token */
  a: string;
  /** refresh token */
  f: string;
  /** access token expira (ms) */
  e: number;
  /** utilizador da plataforma */
  u: string;
  /** conta cTrader activa (ctidTraderAccountId) */
  c: number | null;
}

export function urlRegressoCtrader(pedido: Request): string | null {
  const fixo = process.env['CTRADER_REDIRECT'];
  if (fixo) return fixo;
  if (process.env.NODE_ENV === 'production') return null;
  return `${new URL(pedido.url).origin}${CAMINHO_OAUTH}/retorno`;
}

export function novoEstado(): string {
  return randomBytes(16).toString('base64url');
}

export function urlAutorizacaoCtrader(clientId: string, redirectUri: string, estado: string): string {
  const u = new URL(URL_AUTORIZAR);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('scope', 'trading');
  u.searchParams.set('product', 'web');
  // A Spotware devolve o `state` no regresso; protege contra alguém ligar a SUA
  // conta cTrader à sessão de outra pessoa.
  u.searchParams.set('state', estado);
  return u.toString();
}

interface RespostaToken {
  accessToken: string;
  refreshToken: string;
  expiraEm: number;
}

async function pedirToken(params: Record<string, string>): Promise<RespostaToken> {
  const cfg = configCtrader();
  if (!cfg) throw new Error('cTrader não configurado no servidor');
  const u = new URL(URL_TOKEN);
  for (const [k, v] of Object.entries({ ...params, client_id: cfg.clientId, client_secret: cfg.clientSecret })) {
    u.searchParams.set(k, v);
  }
  const r = await fetch(u, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  const accessToken = (j['accessToken'] ?? j['access_token']) as string | undefined;
  const refreshToken = (j['refreshToken'] ?? j['refresh_token']) as string | undefined;
  if (!r.ok || !accessToken || !refreshToken) {
    const motivo = String(j['description'] ?? j['error_description'] ?? j['errorCode'] ?? j['error'] ?? `HTTP ${r.status}`);
    throw new Error(`a cTrader recusou o token (${motivo.slice(0, 160)})`);
  }
  const segundos = Number(j['expiresIn'] ?? j['expires_in'] ?? 2_628_000);
  return { accessToken, refreshToken, expiraEm: Date.now() + (Number.isFinite(segundos) ? segundos : 2_628_000) * 1000 };
}

export function trocarCodigoCtrader(codigo: string, redirectUri: string): Promise<RespostaToken> {
  return pedirToken({ grant_type: 'authorization_code', code: codigo, redirect_uri: redirectUri });
}

export function renovarTokenCtrader(refreshToken: string): Promise<RespostaToken> {
  return pedirToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
}

export async function gravarSessao(s: SessaoCtrader): Promise<void> {
  (await cookies()).set(COOKIE_SESSAO, selar(s), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: VIDA_SESSAO_S,
  });
}

export type AcessoCtrader =
  | { ok: true; sessao: SessaoCtrader; utilizador: { id: string; email: string | null } }
  | { ok: false; estado: 401 | 409 | 503; codigo: string; erro: string };

/**
 * A sessão cTrader deste pedido — da conta da plataforma que está a pedir, e
 * com o token renovado se estiver a menos de dois dias de expirar.
 */
export async function acessoCtrader(pedido: Request): Promise<AcessoCtrader> {
  if (!configCtrader()) {
    return { ok: false, estado: 503, codigo: 'CtraderNaoConfigurado', erro: 'A negociação CFD ainda não está configurada no servidor.' };
  }
  const utilizador = await utilizadorDoPedido(pedido);
  if (!utilizador) return { ok: false, estado: 401, codigo: 'SemSessao', erro: 'Entre na plataforma.' };

  const sessao = abrir<SessaoCtrader>((await cookies()).get(COOKIE_SESSAO)?.value);
  if (!sessao || sessao.u !== utilizador.id) {
    return { ok: false, estado: 409, codigo: 'CtraderNaoLigada', erro: 'Ligue a sua conta Deriv cTrader.' };
  }

  if (sessao.e - Date.now() < 2 * 86_400_000) {
    try {
      const novo = await renovarTokenCtrader(sessao.f);
      const renovada: SessaoCtrader = { ...sessao, a: novo.accessToken, f: novo.refreshToken, e: novo.expiraEm };
      await gravarSessao(renovada);
      return { ok: true, sessao: renovada, utilizador };
    } catch {
      return { ok: false, estado: 409, codigo: 'CtraderExpirou', erro: 'A ligação à cTrader expirou. Ligue a conta de novo.' };
    }
  }
  return { ok: true, sessao, utilizador };
}
