/**
 * Execucao de uma ordem.
 *
 * ── A REGRA QUE MANDA NESTE FICHEIRO ───────────────────────────────────────
 *
 * Esta rota so corre quando UMA PESSOA toca no botao. Nao ha nada no sistema
 * que a chame: nem o motor de sinais, nem o agendador, nem o worker de
 * notificacoes. Procure por `\/api\/deriv\/ordem` no repositorio — os unicos
 * chamadores sao componentes de interface accionados por `onClick`.
 *
 * Isso foi uma decisao de desenho tomada no inicio do projeto e mantem-se: um
 * sistema que emite sinais e um sistema que executa ordens tem perfis de risco
 * completamente diferentes, e a estrategia deste ainda nao tem vantagem
 * demonstrada. Automatizar a execucao de uma estrategia por validar seria
 * transformar um problema de analise num problema de dinheiro.
 *
 * ── PROTECCOES ─────────────────────────────────────────────────────────────
 *
 *   1. `propostaId` obrigatorio — nao se compra sem ter pedido preco primeiro
 *   2. `precoMaximo` — a Deriv rejeita se o preco subiu entretanto
 *   3. `confirmacao` tem de ser exatamente 'sim' — nao aceita `true` nem 1
 *   4. Conta real exige `aceitoRisco: true` alem da confirmacao
 *   5. Limite duro de montante por ordem
 */

import { NextResponse } from 'next/server';
import { comprar, ErroDeriv } from '@/lib/deriv/conta';
import { credencialDoPedido, semCredencial } from '@/lib/deriv/credencial';
import { contaActiva } from '@/lib/deriv/sessao';

export const dynamic = 'force-dynamic';

/**
 * Tecto por ordem.
 *
 * Nao substitui a gestao de risco — e um travao contra o dedo escorregar num
 * campo numerico. Configuravel, mas com um valor por omissao que nao arruina
 * ninguem.
 */
const LIMITE_POR_ORDEM = Number(process.env['DERIV_LIMITE_ORDEM'] ?? 100);

export async function POST(pedido: Request) {
  let corpo: {
    propostaId?: string;
    precoMaximo?: number;
    confirmacao?: string;
    aceitoRisco?: boolean;
  };
  try {
    corpo = (await pedido.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ erro: 'corpo invalido' }, { status: 400 });
  }

  if (corpo.confirmacao !== 'sim') {
    return NextResponse.json(
      { erro: 'Ordem nao confirmada. Toque em confirmar para executar.' },
      { status: 428 },
    );
  }

  const propostaId = corpo.propostaId;
  if (!propostaId) {
    return NextResponse.json(
      { erro: 'Sem proposta. Peca o preco antes de comprar.' },
      { status: 400 },
    );
  }

  const precoMaximo = Number(corpo.precoMaximo);
  if (!Number.isFinite(precoMaximo) || precoMaximo <= 0) {
    return NextResponse.json({ erro: 'precoMaximo invalido' }, { status: 400 });
  }
  if (precoMaximo > LIMITE_POR_ORDEM) {
    return NextResponse.json(
      {
        erro: `Acima do limite por ordem (${LIMITE_POR_ORDEM}). Ajuste DERIV_LIMITE_ORDEM para o mudar.`,
      },
      { status: 400 },
    );
  }

  // A credencial do pedido: a conta do proprio utilizador, nunca a do dono por
  // omissao (ver lib/deriv/decisao.ts).
  const acesso = await credencialDoPedido(pedido);
  if (!acesso.ok) return semCredencial(acesso);

  try {
    const conta = await contaActiva(acesso.credencial);
    if (!conta) return NextResponse.json({ erro: 'sem conta Deriv' }, { status: 409 });

    if (conta.account_type === 'real' && corpo.aceitoRisco !== true) {
      return NextResponse.json(
        {
          erro: 'Conta REAL. Confirme que percebe que isto usa dinheiro seu.',
          precisaAceitarRisco: true,
        },
        { status: 428 },
      );
    }

    const r = await comprar(acesso.credencial, conta.account_id, propostaId, precoMaximo);
    return NextResponse.json({
      ok: true,
      ordem: r,
      conta: { id: conta.account_id, tipo: conta.account_type },
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
