/**
 * Uma posição aberta: alterar SL/TP, ou fechar (toda ou parte).
 */

import { NextResponse } from 'next/server';
import { alterarPosicaoCtrader, fecharPosicaoCtrader } from '@/lib/ctrader/conta';
import { corpoJson, erroCtrader, preco, semAcesso } from '@/lib/ctrader/rotas';
import { acessoCtrader } from '@/lib/ctrader/sessao';

export const dynamic = 'force-dynamic';

export async function POST(pedido: Request) {
  const c = await corpoJson<Record<string, unknown>>(pedido);
  const positionId = Number(c?.['positionId']);
  const accao = c?.['accao'];
  if (!c || !Number.isFinite(positionId) || (accao !== 'alterar' && accao !== 'fechar')) {
    return NextResponse.json({ erro: 'pedido inválido' }, { status: 400 });
  }
  if (accao === 'fechar' && c['confirmacao'] !== 'sim') {
    return NextResponse.json({ erro: 'Fecho não confirmado.' }, { status: 428 });
  }

  const a = await acessoCtrader(pedido);
  if (!a.ok) return semAcesso(a);
  if (!a.sessao.c) return NextResponse.json({ erro: 'Escolha uma conta cTrader.' }, { status: 409 });

  try {
    if (accao === 'alterar') {
      await alterarPosicaoCtrader(a.sessao.a, a.sessao.c, positionId, preco(c['stopLoss']), preco(c['takeProfit']));
    } else {
      const lotes = Number(c['lotes']);
      await fecharPosicaoCtrader(a.sessao.a, a.sessao.c, positionId, lotes > 0 ? lotes : null);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return erroCtrader(e);
  }
}
