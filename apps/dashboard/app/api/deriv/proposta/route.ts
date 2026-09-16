/**
 * Preco de um contrato, antes de haver ordem nenhuma.
 *
 * Esta rota nao move dinheiro. Existe para que o botao de comprar mostre o
 * pagamento que a CORRETORA calcula, e nao uma estimativa local. A proposta tem
 * `id`, e e esse id que a rota de ordem consome: comprar sem passar por aqui e
 * impossivel por construcao.
 */

import { NextResponse } from 'next/server';
import { ErroDeriv, propor } from '@/lib/deriv/conta';
import { credencialDoPedido, semCredencial } from '@/lib/deriv/credencial';
import { contaActiva } from '@/lib/deriv/sessao';
import { acharSimbolo } from '@/lib/deriv/simbolos';

export const dynamic = 'force-dynamic';

/** Duracoes que a Deriv aceita variam por mercado; estas sao seguras nos majors. */
const UNIDADES = new Set(['t', 's', 'm', 'h', 'd']);

export async function POST(pedido: Request) {
  let corpo: {
    simbolo?: string;
    direccao?: 'compra' | 'venda';
    montante?: number;
    duracao?: number;
    unidade?: string;
  };
  try {
    corpo = (await pedido.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ erro: 'corpo invalido' }, { status: 400 });
  }

  const s = corpo.simbolo ? acharSimbolo(corpo.simbolo) : undefined;
  if (!s) return NextResponse.json({ erro: 'simbolo desconhecido' }, { status: 400 });

  const montante = Number(corpo.montante);
  if (!Number.isFinite(montante) || montante <= 0) {
    return NextResponse.json({ erro: 'montante invalido' }, { status: 400 });
  }

  const duracao = Number(corpo.duracao ?? 5);
  const unidade = String(corpo.unidade ?? 'm');
  if (!UNIDADES.has(unidade) || !Number.isFinite(duracao) || duracao <= 0) {
    return NextResponse.json({ erro: 'duracao invalida' }, { status: 400 });
  }

  const acesso = await credencialDoPedido(pedido);
  if (!acesso.ok) return semCredencial(acesso);

  try {
    const conta = await contaActiva(acesso.credencial);
    if (!conta) return NextResponse.json({ erro: 'sem conta Deriv' }, { status: 409 });

    const proposta = await propor(acesso.credencial, {
      accountId: conta.account_id,
      derivSymbol: s.deriv,
      tipo: corpo.direccao === 'venda' ? 'PUT' : 'CALL',
      montante,
      moeda: conta.currency,
      duracao,
      unidade: unidade as 't' | 's' | 'm' | 'h' | 'd',
    });

    return NextResponse.json({
      ok: true,
      proposta,
      conta: { id: conta.account_id, tipo: conta.account_type, moeda: conta.currency },
    });
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
