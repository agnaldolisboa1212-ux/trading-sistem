import 'server-only';

/**
 * A credencial Deriv de um pedido HTTP.
 *
 * Junta as três fontes — sessão da plataforma, cookie OAuth, token do servidor —
 * e entrega-as a `decidirCredencial`, que tem a regra. Todas as rotas da conta
 * passam por aqui; nenhuma lê `DERIV_TOKEN` diretamente.
 */

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { abrir } from '@/lib/cofre';
import { utilizadorDoPedido, type UtilizadorPlataforma } from '@/lib/sessao-plataforma';
import type { ConfigDeriv } from './conta';
import { decidirCredencial, type OrigemCredencial, type SessaoOAuth } from './decisao';
import { COOKIE_SESSAO, exigirLogin } from './oauth';

export interface CredencialDeriv extends ConfigDeriv {
  readonly origem: OrigemCredencial;
  readonly expiraEm: number | null;
}

export type ResultadoCredencial =
  | { ok: true; credencial: CredencialDeriv; utilizador: UtilizadorPlataforma | null }
  | { ok: false; estado: 401 | 409 | 503; codigo: string; erro: string };

export async function credencialDoPedido(pedido: Request): Promise<ResultadoCredencial> {
  const appId = process.env['DERIV_APP_ID'];
  if (!appId) {
    return {
      ok: false,
      estado: 503,
      codigo: 'DerivNaoConfigurada',
      erro: 'DERIV_APP_ID não está definido no servidor.',
    };
  }

  const utilizador = await utilizadorDoPedido(pedido);
  const oauth = abrir<SessaoOAuth>((await cookies()).get(COOKIE_SESSAO)?.value);

  const d = decidirCredencial({
    exigirLogin: exigirLogin(),
    utilizador,
    oauth,
    tokenDono: process.env['DERIV_TOKEN'] ?? null,
    emailsDono: (process.env['DERIV_DONO_EMAIL'] ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    agora: Date.now(),
  });

  if (!d.ok) return d;
  return {
    ok: true,
    credencial: { token: d.token, appId, origem: d.origem, expiraEm: d.expiraEm },
    utilizador,
  };
}

/** Resposta JSON uniforme para quando não há credencial. */
export function semCredencial(
  r: Extract<ResultadoCredencial, { ok: false }>,
  extra: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json(
    { erro: r.erro, codigo: r.codigo, ...extra },
    { status: r.estado, headers: { 'Cache-Control': 'no-store' } },
  );
}
