/**
 * Preço ao vivo — rota leve, separada da análise.
 *
 * PORQUÊ ESTA ROTA EXISTE: o gráfico atualizava só de 60 em 60 segundos porque
 * cada atualização re-corria a análise completa — 5 séries carregadas, estrutura
 * MMXM, SMT contra todos os pares, checklist. Isso custa 1-2s e não pode ser
 * feito de 10 em 10 segundos.
 *
 * Mas o PREÇO não precisa de nada disso. Esta rota devolve só as últimas velas,
 * incluindo a que está em formação, numa fração do custo. O gráfico passa a ter
 * dois relógios:
 *
 *   preço     — de 10 em 10 segundos, por aqui
 *   análise   — de 5 em 5 minutos, pelo Server Component
 *
 * A estrutura só muda quando uma vela fecha, por isso recalculá-la ao ritmo do
 * preço seria trabalho desperdiçado.
 *
 * Nota sobre streaming: a Deriv tem subscrição de ticks por WebSocket, mas o
 * `app_id` público (1089) recusa-a — devolve InvalidSymbol para qualquer
 * símbolo. Streaming a sério exige registar uma aplicação em
 * api.deriv.com/dashboard e definir DERIV_APP_ID. Até lá, sondagem curta é o
 * melhor disponível.
 */

import { NextResponse } from 'next/server';
import { getInstrument, type Timeframe } from '@trading/core';
import { ProviderRegistry } from '@trading/data';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const TIMEFRAMES: Timeframe[] = ['1h', '4h', '1d', '1w'];

/** Uma só instância: reutiliza a ligação WebSocket da Deriv entre pedidos. */
const registry = new ProviderRegistry();

export async function GET(
  request: Request,
  context: { params: Promise<{ symbol: string }> },
) {
  const { symbol: raw } = await context.params;
  const symbol = decodeURIComponent(raw).toUpperCase();

  if (!getInstrument(symbol)) {
    return NextResponse.json({ erro: `Símbolo desconhecido: ${symbol}` }, { status: 404 });
  }

  const url = new URL(request.url);
  const tfParam = url.searchParams.get('tf') ?? '1d';
  const timeframe: Timeframe = (TIMEFRAMES as string[]).includes(tfParam)
    ? (tfParam as Timeframe)
    : '1d';

  try {
    /*
     * Só 3 velas. O gráfico já tem o histórico; daqui precisa apenas da ponta —
     * a vela em formação e uma ou duas anteriores para o caso de uma ter
     * fechado entre sondagens.
     */
    const serie = await registry.getCandles(
      { symbol, timeframe, limit: 3, includeForming: true },
      { includeForming: true },
    );

    const velas = serie.candles.map((c) => ({
      t: c.time,
      o: c.open,
      h: c.high,
      l: c.low,
      c: c.close,
      v: c.volume,
    }));

    return NextResponse.json(
      {
        symbol,
        timeframe,
        fonte: serie.source,
        velas,
        em: Date.now(),
      },
      {
        // Sem cache em lado nenhum: o objetivo é precisamente ter o valor atual.
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      },
    );
  } catch (err) {
    return NextResponse.json(
      { erro: err instanceof Error ? err.message : String(err) },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
