/**
 * O instrumento na conta cTrader activa: existe? volume mínimo e passo em lotes,
 * casas decimais. Alimenta o bilhete de ordem.
 */

import { NextResponse } from 'next/server';
import { simboloParaCodigo } from '@/lib/ctrader/conta';
import { erroCtrader, semAcesso } from '@/lib/ctrader/rotas';
import { acessoCtrader } from '@/lib/ctrader/sessao';
import { acharSimbolo } from '@/lib/deriv/simbolos';

export const dynamic = 'force-dynamic';

export async function GET(pedido: Request) {
  const codigo = (new URL(pedido.url).searchParams.get('codigo') ?? '').toUpperCase();
  const a = await acessoCtrader(pedido);
  if (!a.ok) return semAcesso(a);
  if (!a.sessao.c) return NextResponse.json({ erro: 'Escolha uma conta cTrader.' }, { status: 409 });
  try {
    const r = await simboloParaCodigo(a.sessao.a, a.sessao.c, codigo, acharSimbolo(codigo)?.nome ?? null);
    if (!r) return NextResponse.json({ existe: false, codigo }, { headers: { 'Cache-Control': 'no-store' } });
    const d = r.detalhe;
    return NextResponse.json(
      {
        existe: true,
        codigo,
        nome: r.simbolo.symbolName,
        casas: d.digits,
        lotesMinimo: d.minVolume / d.lotSize,
        lotesPasso: d.stepVolume / d.lotSize,
        lotesMaximo: d.maxVolume / d.lotSize,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return erroCtrader(e);
  }
}
