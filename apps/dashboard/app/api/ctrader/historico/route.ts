import { NextResponse } from 'next/server';
import { ErroCtrader } from '@/lib/ctrader/ligacao';
import { acessoCtrader } from '@/lib/ctrader/sessao';
import { historicoCompletoCtrader } from '@/lib/ctrader/conta';
import { calcularEstatisticasDeriv } from '@/lib/desempenho';

export const dynamic = 'force-dynamic';

const SEM_CACHE = { 'Cache-Control': 'no-store' };

export async function GET(pedido: Request) {
  const acesso = await acessoCtrader(pedido);
  if (!acesso.ok) {
    return NextResponse.json(
      { ligada: false, erro: acesso.erro, codigo: acesso.codigo },
      { headers: SEM_CACHE },
    );
  }

  const { sessao } = acesso;
  if (!sessao.c) {
    return NextResponse.json(
      { ligada: false, erro: 'Nenhuma conta cTrader seleccionada', codigo: 'SemContas' },
      { headers: SEM_CACHE },
    );
  }

  try {
    const historico = await historicoCompletoCtrader(sessao.a, sessao.c, 90);
    const resumo = calcularEstatisticasDeriv(historico.trades, historico.moeda);

    return NextResponse.json(
      {
        ligada: true,
        conta: {
          id: historico.conta.id,
          tipo: historico.conta.real ? 'real' : 'demo',
          moeda: historico.moeda,
          corretora: historico.conta.corretora,
        },
        saldo: {
          saldo: historico.saldo,
          moeda: historico.moeda,
          loginid: historico.conta.login ?? historico.conta.id,
        },
        trades: historico.trades,
        resumo,
      },
      { headers: SEM_CACHE },
    );
  } catch (err) {
    const e = err instanceof ErroCtrader ? err : null;
    return NextResponse.json(
      {
        ligada: false,
        erro: err instanceof Error ? err.message : String(err),
        codigo: e?.codigo ?? 'Desconhecido',
      },
      { headers: SEM_CACHE },
    );
  }
}
