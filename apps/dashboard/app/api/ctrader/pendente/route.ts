/**
 * Uma ordem pendente (limite ou stop): alterar preço e SL/TP, ou cancelar.
 */

import { NextResponse } from 'next/server';
import { alterarOrdemCtrader, cancelarOrdemCtrader } from '@/lib/ctrader/conta';
import { corpoJson, erroCtrader, preco, semAcesso } from '@/lib/ctrader/rotas';
import { acessoCtrader } from '@/lib/ctrader/sessao';

export const dynamic = 'force-dynamic';

export async function POST(pedido: Request) {
  const c = await corpoJson<Record<string, unknown>>(pedido);
  const orderId = Number(c?.['orderId']);
  const accao = c?.['accao'];
  if (!c || !Number.isFinite(orderId) || (accao !== 'alterar' && accao !== 'cancelar')) {
    return NextResponse.json({ erro: 'pedido inválido' }, { status: 400 });
  }

  const a = await acessoCtrader(pedido);
  if (!a.ok) return semAcesso(a);
  if (!a.sessao.c) return NextResponse.json({ erro: 'Escolha uma conta cTrader.' }, { status: 409 });

  try {
    if (accao === 'alterar') {
      await alterarOrdemCtrader(a.sessao.a, a.sessao.c, orderId, {
        preco: preco(c['preco']),
        stopLoss: preco(c['stopLoss']),
        takeProfit: preco(c['takeProfit']),
      });
    } else {
      await cancelarOrdemCtrader(a.sessao.a, a.sessao.c, orderId);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return erroCtrader(e);
  }
}
