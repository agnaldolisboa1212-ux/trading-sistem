/**
 * Regresso do login cTrader.
 *
 * Confirma o `state`, que o pedido é da mesma conta da plataforma, troca o
 * código pelos tokens, confirma que a ligação lista contas, e guarda a sessão
 * cifrada. Volta sempre às Definições com `?ctrader=ligada|erro`.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { abrir } from '@/lib/cofre';
import { listarContasCtrader } from '@/lib/ctrader/conta';
import {
  CAMINHO_OAUTH,
  COOKIE_ESTADO,
  gravarSessao,
  trocarCodigoCtrader,
  type EstadoOAuth,
} from '@/lib/ctrader/sessao';
import { utilizadorDoPedido } from '@/lib/sessao-plataforma';
import { urlPublico } from '@/lib/url-publico';

export const dynamic = 'force-dynamic';

export async function GET(pedido: Request) {
  const url = new URL(pedido.url);
  const estado = abrir<EstadoOAuth>((await cookies()).get(COOKIE_ESTADO)?.value);

  const voltar = (params: Record<string, string>) => {
    const destino = urlPublico(pedido, '/definicoes');
    for (const [k, v] of Object.entries(params)) destino.searchParams.set(k, v);
    const res = NextResponse.redirect(destino, 303);
    res.cookies.set(COOKIE_ESTADO, '', { path: CAMINHO_OAUTH, maxAge: 0 });
    return res;
  };

  const erro = url.searchParams.get('error');
  if (erro) return voltar({ ctrader: 'erro', motivo: (url.searchParams.get('error_description') ?? erro).slice(0, 160) });
  if (!estado || estado.e < Date.now()) return voltar({ ctrader: 'erro', motivo: 'o pedido de ligação expirou — tente de novo' });
  if (url.searchParams.get('state') && url.searchParams.get('state') !== estado.s) {
    return voltar({ ctrader: 'erro', motivo: 'resposta inválida (state não corresponde)' });
  }
  const utilizador = await utilizadorDoPedido(pedido);
  if (!utilizador || utilizador.id !== estado.u) {
    return voltar({ ctrader: 'erro', motivo: 'a sessão da plataforma mudou durante a ligação' });
  }
  const codigo = url.searchParams.get('code');
  if (!codigo) return voltar({ ctrader: 'erro', motivo: 'a cTrader não devolveu código' });

  try {
    const t = await trocarCodigoCtrader(codigo, estado.r);
    const contas = await listarContasCtrader(t.accessToken);
    if (contas.length === 0) return voltar({ ctrader: 'erro', motivo: 'o cTrader ID não tem contas autorizadas' });
    // Começa numa conta demo, se houver: a real escolhe-se nas Definições.
    const inicial = contas.find((c) => !c.real) ?? contas[0]!;
    await gravarSessao({ a: t.accessToken, f: t.refreshToken, e: t.expiraEm, u: utilizador.id, c: inicial.id });
    return voltar({ ctrader: 'ligada' });
  } catch (e) {
    return voltar({ ctrader: 'erro', motivo: (e instanceof Error ? e.message : String(e)).slice(0, 160) });
  }
}
