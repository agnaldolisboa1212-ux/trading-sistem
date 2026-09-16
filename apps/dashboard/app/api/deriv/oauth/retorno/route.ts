/**
 * Regresso do login da Deriv — o `redirect_uri` registado na aplicação.
 *
 * Verificações, por ordem, e todas antes de falar com a Deriv:
 *
 *   1. a Deriv devolveu erro (a pessoa carregou em "cancelar")?
 *   2. existe um pedido PKCE deste browser, e ainda não expirou?
 *   3. o `state` que volta é o que foi enviado? (proteção contra CSRF: sem isto,
 *      alguém podia fazer o browser de outra pessoa ligar a conta DELE)
 *
 * Só depois troca o código pelo token, confirma que o token lista contas, e
 * guarda-o cifrado num cookie `httpOnly`. O token nunca chega ao JavaScript da
 * página nem a nenhum registo.
 */

import { NextResponse } from 'next/server';
import { abrir, selar } from '@/lib/cofre';
import { listarContas } from '@/lib/deriv/conta';
import type { SessaoOAuth } from '@/lib/deriv/decisao';
import {
  CAMINHO_PKCE,
  COOKIE_PKCE,
  COOKIE_SESSAO,
  trocarCodigo,
  type PedidoPkce,
} from '@/lib/deriv/oauth';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function GET(pedido: Request) {
  const url = new URL(pedido.url);
  const pkce = abrir<PedidoPkce>((await cookies()).get(COOKIE_PKCE)?.value);

  // Volta sempre para a origem registada, e não para a do pedido.
  const origem = pkce ? new URL(pkce.r).origin : url.origin;
  const voltar = (params: Record<string, string>) => {
    const destino = new URL('/definicoes', origem);
    for (const [k, v] of Object.entries(params)) destino.searchParams.set(k, v);
    const res = NextResponse.redirect(destino);
    // O pedido PKCE é de uso único, corra bem ou mal.
    res.cookies.set(COOKIE_PKCE, '', { path: CAMINHO_PKCE, maxAge: 0 });
    return res;
  };

  const erroDeriv = url.searchParams.get('error');
  if (erroDeriv) {
    return voltar({
      deriv: 'erro',
      motivo: (url.searchParams.get('error_description') ?? erroDeriv).slice(0, 160),
    });
  }

  if (!pkce || pkce.e < Date.now()) {
    return voltar({ deriv: 'erro', motivo: 'o pedido de ligação expirou — tente de novo' });
  }
  if (url.searchParams.get('state') !== pkce.s) {
    return voltar({ deriv: 'erro', motivo: 'resposta inválida (state não corresponde)' });
  }

  const codigo = url.searchParams.get('code');
  const clientId = process.env['DERIV_APP_ID'];
  if (!codigo || !clientId) {
    return voltar({ deriv: 'erro', motivo: 'a Deriv não devolveu código' });
  }

  try {
    const { token, expiraEmSegundos } = await trocarCodigo({
      clientId,
      codigo,
      verificador: pkce.v,
      redirectUri: pkce.r,
    });

    // Prova de vida: um token que não lista contas não serve para nada, e é
    // melhor dizê-lo agora do que no primeiro toque em "comprar".
    const contas = await listarContas({ token, appId: clientId, origem: 'oauth' });
    if (contas.length === 0) {
      return voltar({ deriv: 'erro', motivo: 'a conta Deriv não tem contas de opções disponíveis' });
    }

    // Um minuto de margem: melhor pedir para ligar de novo um pouco cedo do que
    // ter um pedido a falhar a meio.
    const validade = Math.max(60, expiraEmSegundos - 60);
    const sessao: SessaoOAuth = { t: token, u: pkce.u, e: Date.now() + validade * 1000 };

    const res = voltar({ deriv: 'ligada' });
    res.cookies.set(COOKIE_SESSAO, selar(sessao), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: validade,
    });
    // A conta activa anterior era de outra credencial: começa na demo.
    res.cookies.set('deriv_conta', '', { path: '/', maxAge: 0 });
    return res;
  } catch (err) {
    return voltar({
      deriv: 'erro',
      motivo: (err instanceof Error ? err.message : String(err)).slice(0, 160),
    });
  }
}
