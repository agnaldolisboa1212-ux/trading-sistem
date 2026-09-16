/**
 * Retrato da conta activa: saldo, posicoes abertas, movimentos e resultado.
 *
 * GET  -> tudo numa ligacao so
 * POST -> troca a conta activa (demo <-> real)
 *
 * Ambos com a credencial do PEDIDO (ver `credencial.ts`). A troca para uma conta
 * REAL exige `confirmar: true`: e a fronteira a partir da qual um toque no
 * botao de comprar move dinheiro, e nao deve poder ser atravessada por um
 * clique distraido nem por um pedido forjado.
 */

import { NextResponse } from 'next/server';
import { ErroDeriv, listarContas, retratoConta } from '@/lib/deriv/conta';
import { credencialDoPedido, semCredencial } from '@/lib/deriv/credencial';
import { contaActiva, definirContaActiva } from '@/lib/deriv/sessao';

export const dynamic = 'force-dynamic';

const SEM_CACHE = { 'Cache-Control': 'no-store' };

export async function GET(pedido: Request) {
  const acesso = await credencialDoPedido(pedido);
  if (!acesso.ok) {
    // 200 com `ligada: false`: o cartao de saldo mostra o que falta, nao um erro.
    return NextResponse.json(
      { ligada: false, erro: acesso.erro, codigo: acesso.codigo },
      { headers: SEM_CACHE },
    );
  }

  try {
    const conta = await contaActiva(acesso.credencial);
    if (!conta) {
      return NextResponse.json(
        { ligada: false, erro: 'Nenhuma conta Deriv disponivel', codigo: 'SemContas' },
        { headers: SEM_CACHE },
      );
    }

    const retrato = await retratoConta(acesso.credencial, conta);
    return NextResponse.json(
      { ligada: true, origem: acesso.credencial.origem, ...retrato },
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

export async function POST(pedido: Request) {
  let corpo: { accountId?: string; account_id?: string; confirmar?: boolean };
  try {
    corpo = (await pedido.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ erro: 'corpo invalido' }, { status: 400 });
  }

  // As duas grafias: o ecra de definicoes enviava `account_id` e esta rota lia
  // `accountId`, pelo que a troca de conta falhava sempre com "accountId em falta".
  const accountId = corpo.accountId ?? corpo.account_id;
  if (!accountId) return NextResponse.json({ erro: 'accountId em falta' }, { status: 400 });

  const acesso = await credencialDoPedido(pedido);
  if (!acesso.ok) return semCredencial(acesso);

  try {
    const contas = await listarContas(acesso.credencial);
    const alvo = contas.find((c) => c.account_id === accountId);
    if (!alvo) return NextResponse.json({ erro: 'conta desconhecida' }, { status: 404 });

    if (alvo.account_type === 'real' && corpo.confirmar !== true) {
      return NextResponse.json(
        {
          erro: 'Passar para a conta real exige confirmacao explicita.',
          precisaConfirmar: true,
          conta: alvo,
        },
        { status: 409 },
      );
    }

    await definirContaActiva(accountId);
    return NextResponse.json({ ok: true, conta: alvo });
  } catch (err) {
    return NextResponse.json(
      { erro: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
