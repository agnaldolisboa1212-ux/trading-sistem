/**
 * Histórico completo da conta Deriv activa.
 *
 * GET → trades fechados, transacções, métricas de desempenho.
 *
 * Separado de `/api/deriv/conta` porque:
 *   1. É mais pesado (500 trades vs 100)
 *   2. Só o Financeiro o usa — o painel de saldo não precisa disto
 *   3. Pode ser chamado independentemente do ciclo de 20s do `usarConta`
 */

import { NextResponse } from 'next/server';
import { ErroDeriv, historicoCompleto, listarContas } from '@/lib/deriv/conta';
import { credencialDoPedido, semCredencial } from '@/lib/deriv/credencial';
import { contaActiva } from '@/lib/deriv/sessao';
import { calcularEstatisticasDeriv } from '@/lib/desempenho';

export const dynamic = 'force-dynamic';

const SEM_CACHE = { 'Cache-Control': 'no-store' };

export async function GET(pedido: Request) {
  const acesso = await credencialDoPedido(pedido);
  if (!acesso.ok) {
    return NextResponse.json(
      { ligada: false, erro: acesso.erro, codigo: acesso.codigo },
      { headers: SEM_CACHE },
    );
  }

  try {
    const conta = await contaActiva(acesso.credencial);
    if (!conta) {
      return NextResponse.json(
        { ligada: false, erro: 'Nenhuma conta Deriv disponível', codigo: 'SemContas' },
        { headers: SEM_CACHE },
      );
    }

    const historico = await historicoCompleto(acesso.credencial, conta);
    const resumo = calcularEstatisticasDeriv(historico.trades, historico.saldo.moeda);

    return NextResponse.json(
      {
        ligada: true,
        conta: {
          id: conta.account_id,
          tipo: conta.account_type,
          moeda: conta.currency,
          grupo: conta.group,
          estado: conta.status,
        },
        saldo: historico.saldo,
        trades: historico.trades,
        transaccoes: historico.transaccoes,
        resumo,
      },
      { headers: SEM_CACHE },
    );
  } catch (err) {
    const e = err instanceof ErroDeriv ? err : null;
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
