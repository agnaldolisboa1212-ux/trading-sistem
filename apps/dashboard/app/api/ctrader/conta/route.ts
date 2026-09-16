/** Escolhe a conta cTrader activa (demo ou real). */

import { NextResponse } from 'next/server';
import { contaDoToken } from '@/lib/ctrader/conta';
import { corpoJson, erroCtrader, semAcesso } from '@/lib/ctrader/rotas';
import { acessoCtrader, gravarSessao } from '@/lib/ctrader/sessao';

export const dynamic = 'force-dynamic';

export async function POST(pedido: Request) {
  const corpo = await corpoJson<{ contaId?: number; confirmoReal?: boolean }>(pedido);
  const contaId = Number(corpo?.contaId);
  if (!Number.isFinite(contaId)) return NextResponse.json({ erro: 'conta inválida' }, { status: 400 });

  const a = await acessoCtrader(pedido);
  if (!a.ok) return semAcesso(a);
  try {
    const { conta } = await contaDoToken(a.sessao.a, contaId);
    if (conta.real && corpo?.confirmoReal !== true) {
      return NextResponse.json({ erro: 'Conta REAL: confirme que quer negociar com dinheiro real.', precisaConfirmar: true }, { status: 428 });
    }
    await gravarSessao({ ...a.sessao, c: conta.id });
    return NextResponse.json({ ok: true, conta });
  } catch (e) {
    return erroCtrader(e);
  }
}
