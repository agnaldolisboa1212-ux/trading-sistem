/**
 * Fecha um contrato aberto antes do vencimento.
 *
 * Tal como a rota de ordem, so corre a partir de um toque e com a credencial do
 * pedido. Fechar REDUZ a exposicao, por isso nao exige o passo extra de "aceito
 * o risco" que a abertura exige.
 */

import { NextResponse } from 'next/server';
import { ErroDeriv, vender } from '@/lib/deriv/conta';
import { credencialDoPedido, semCredencial } from '@/lib/deriv/credencial';
import { contaActiva } from '@/lib/deriv/sessao';

export const dynamic = 'force-dynamic';

export async function POST(pedido: Request) {
  let corpo: { contractId?: number; contract_id?: number; precoMinimo?: number };
  try {
    corpo = (await pedido.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ erro: 'corpo invalido' }, { status: 400 });
  }

  // As duas grafias: o Portfolio enviava `contract_id` e esta rota lia
  // `contractId`, pelo que o botao "vender" respondia sempre "contractId invalido".
  const contractId = Number(corpo.contractId ?? corpo.contract_id);
  if (!Number.isFinite(contractId) || contractId <= 0) {
    return NextResponse.json({ erro: 'contractId invalido' }, { status: 400 });
  }

  const acesso = await credencialDoPedido(pedido);
  if (!acesso.ok) return semCredencial(acesso);

  try {
    const conta = await contaActiva(acesso.credencial);
    if (!conta) return NextResponse.json({ erro: 'sem conta Deriv' }, { status: 409 });

    const r = await vender(
      acesso.credencial,
      conta.account_id,
      contractId,
      Number(corpo.precoMinimo ?? 0),
    );
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    const e = err instanceof ErroDeriv ? err : null;
    return NextResponse.json(
      {
        erro: err instanceof Error ? err.message : String(err),
        codigo: e?.codigo ?? 'Desconhecido',
      },
      { status: 400 },
    );
  }
}
