/**
 * Notícias de alto impacto: calendário da semana, comunicados de política
 * monetária (Fed, BCE, Banco de Inglaterra) e posicionamento dos fundos (COT).
 *
 * Cada fonte tem memória no servidor (`@trading/data`): muitas pessoas a abrir
 * a página não são muitos pedidos às fontes.
 */

import { NextResponse } from 'next/server';
import { instrumentosAfectados } from '@trading/core';
import {
  calendarioAltoImpacto,
  comunicadosBancosCentrais,
  posicionamentoCot,
  SIMBOLOS_DERIV,
} from '@trading/data';

export const dynamic = 'force-dynamic';

const CATALOGO = SIMBOLOS_DERIV.filter((s) => s.classe !== 'synthetic').map((s) => s.codigo);

export async function GET() {
  const [eventos, comunicados, cot] = await Promise.all([
    calendarioAltoImpacto(),
    comunicadosBancosCentrais(),
    posicionamentoCot(),
  ]);
  return NextResponse.json(
    {
      eventos: eventos.map((e) => ({ ...e, instrumentos: instrumentosAfectados(e, CATALOGO) })),
      comunicados,
      cot,
      geradoEm: Date.now(),
    },
    { headers: { 'Cache-Control': 'private, max-age=300' } },
  );
}
