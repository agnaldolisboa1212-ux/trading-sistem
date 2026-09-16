/**
 * Começa a ligação à conta Deriv cTrader (cTrader ID).
 *
 * POST: o browser recebe o URL da cTrader e navega para lá. O `state` e a conta
 * da plataforma ficam cifrados num cookie curto, só no caminho das rotas OAuth.
 */

import { NextResponse } from 'next/server';
import { cofreConfigurado, selar } from '@/lib/cofre';
import { configCtrader } from '@/lib/ctrader/ligacao';
import {
  CAMINHO_OAUTH,
  COOKIE_ESTADO,
  novoEstado,
  urlAutorizacaoCtrader,
  urlRegressoCtrader,
  type EstadoOAuth,
} from '@/lib/ctrader/sessao';
import { utilizadorDoPedido } from '@/lib/sessao-plataforma';

export const dynamic = 'force-dynamic';

export async function POST(pedido: Request) {
  const cfg = configCtrader();
  if (!cfg) {
    return NextResponse.json({ erro: 'A negociação CFD ainda não está configurada no servidor (CTRADER_CLIENT_ID).' }, { status: 503 });
  }
  if (!cofreConfigurado()) {
    return NextResponse.json({ erro: 'COFRE_CHAVE não está definida no servidor.' }, { status: 503 });
  }
  const utilizador = await utilizadorDoPedido(pedido);
  if (!utilizador) return NextResponse.json({ erro: 'Entre na plataforma.', codigo: 'SemSessao' }, { status: 401 });

  const redirectUri = urlRegressoCtrader(pedido);
  if (!redirectUri) {
    return NextResponse.json({ erro: 'Defina CTRADER_REDIRECT com o URL registado na app cTrader.' }, { status: 503 });
  }

  const estado = novoEstado();
  const guardado: EstadoOAuth = { s: estado, u: utilizador.id, r: redirectUri, e: Date.now() + 10 * 60_000 };
  const res = NextResponse.json({ url: urlAutorizacaoCtrader(cfg.clientId, redirectUri, estado) });
  res.cookies.set(COOKIE_ESTADO, selar(guardado), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: CAMINHO_OAUTH,
    maxAge: 600,
  });
  return res;
}
