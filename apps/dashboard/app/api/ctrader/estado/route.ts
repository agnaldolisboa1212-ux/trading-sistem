/**
 * Estado da ligação cTrader de quem pede: contas, conta activa e o seu retrato
 * (saldo, capital, posições com lucro, ordens pendentes).
 */

import { NextResponse } from 'next/server';
import { listarContasCtrader, retratoCtrader } from '@/lib/ctrader/conta';
import { configCtrader } from '@/lib/ctrader/ligacao';
import { erroCtrader } from '@/lib/ctrader/rotas';
import { acessoCtrader } from '@/lib/ctrader/sessao';

export const dynamic = 'force-dynamic';

export async function GET(pedido: Request) {
  const base = { configurado: Boolean(configCtrader()) };
  const a = await acessoCtrader(pedido);
  if (!a.ok) {
    return NextResponse.json(
      { ...base, ligada: false, codigo: a.codigo, erro: a.codigo === 'CtraderNaoLigada' ? null : a.erro },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
  try {
    const contas = await listarContasCtrader(a.sessao.a);
    const activa = contas.find((c) => c.id === a.sessao.c) ?? contas.find((c) => !c.real) ?? contas[0] ?? null;
    const retrato = activa ? await retratoCtrader(a.sessao.a, activa.id) : null;
    return NextResponse.json(
      { ...base, ligada: true, contas, contaActiva: activa?.id ?? null, retrato },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return erroCtrader(e);
  }
}
