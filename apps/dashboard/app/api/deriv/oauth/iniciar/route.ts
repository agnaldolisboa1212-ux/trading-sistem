/**
 * Começa o login com a Deriv.
 *
 * POST e não GET: o cliente precisa de enviar o seu token da plataforma no
 * cabeçalho `Authorization`, e uma navegação de topo não leva cabeçalhos. A rota
 * devolve o URL da Deriv e é o cliente que navega para lá.
 *
 * Um GET que começasse o fluxo também poderia ser disparado por um `<img>` num
 * site qualquer — com POST e o token no cabeçalho, não.
 */

import { NextResponse } from 'next/server';
import { cofreConfigurado, selar } from '@/lib/cofre';
import {
  CAMINHO_PKCE,
  COOKIE_PKCE,
  exigirLogin,
  gerarPkce,
  urlAutorizacao,
  urlRegresso,
  type PedidoPkce,
} from '@/lib/deriv/oauth';
import { utilizadorDoPedido } from '@/lib/sessao-plataforma';

export const dynamic = 'force-dynamic';

export async function POST(pedido: Request) {
  const clientId = process.env['DERIV_APP_ID'];
  if (!clientId) {
    return NextResponse.json({ erro: 'DERIV_APP_ID não está definido no servidor.' }, { status: 503 });
  }
  if (!cofreConfigurado()) {
    return NextResponse.json({ erro: 'COFRE_CHAVE não está definida no servidor.' }, { status: 503 });
  }

  const utilizador = await utilizadorDoPedido(pedido);
  if (exigirLogin() && !utilizador) {
    return NextResponse.json(
      { erro: 'Entre na plataforma antes de ligar a conta Deriv.', codigo: 'SemSessao' },
      { status: 401 },
    );
  }

  const redirectUri = urlRegresso(pedido);
  if (!redirectUri) {
    return NextResponse.json(
      { erro: 'Defina DERIV_OAUTH_REDIRECT com o URL registado na aplicação Deriv.' },
      { status: 503 },
    );
  }

  const { verificador, desafio, estado } = gerarPkce();
  const pkce: PedidoPkce = {
    v: verificador,
    s: estado,
    u: utilizador?.id ?? null,
    r: redirectUri,
    e: Date.now() + 10 * 60_000,
  };

  const res = NextResponse.json({
    url: urlAutorizacao({ clientId, redirectUri, desafio, estado }),
  });
  res.cookies.set(COOKIE_PKCE, selar(pkce), {
    httpOnly: true,
    // `lax` deixa o cookie viajar no regresso da Deriv, que é uma navegação de
    // topo. `strict` perdê-lo-ia e o login falharia sempre.
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: CAMINHO_PKCE,
    maxAge: 600,
  });
  return res;
}
