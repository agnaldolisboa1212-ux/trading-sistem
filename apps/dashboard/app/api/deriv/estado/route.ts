/**
 * Estado da ligacao a corretora, para QUEM esta a pedir.
 *
 * Antes perguntava sempre com o token do servidor, e por isso dizia "ligada"
 * com as contas do dono a qualquer visitante. Agora responde com a credencial
 * do pedido e, quando nao ha nenhuma, diz exatamente o que falta:
 *
 *   SemSessao            entrar na plataforma
 *   DerivNaoLigada       entrar com a Deriv
 *   DerivExpirou         ligar de novo (as sessoes OAuth duram uma hora)
 *   DerivNaoConfigurada  o servidor nao tem DERIV_APP_ID
 *   Recusada             ha credencial mas a Deriv recusou-a
 *
 * Responde sempre 200: e um diagnostico, e o ecra precisa de o mostrar.
 * Nunca devolve token nenhum.
 */

import { NextResponse } from 'next/server';
import { cofreConfigurado } from '@/lib/cofre';
import { estadoDeriv } from '@/lib/deriv/conta';
import { credencialDoPedido } from '@/lib/deriv/credencial';
import { contaActivaSegura } from '@/lib/deriv/sessao';

export const dynamic = 'force-dynamic';

const SEM_CACHE = { 'Cache-Control': 'no-store' };

export async function GET(pedido: Request) {
  // O botao "Entrar com a Deriv" so aparece se o servidor o souber completar.
  const podeLigar = Boolean(process.env['DERIV_APP_ID']) && cofreConfigurado();
  const acesso = await credencialDoPedido(pedido);

  if (!acesso.ok) {
    return NextResponse.json(
      {
        configurada: acesso.codigo !== 'DerivNaoConfigurada',
        ligada: false,
        contas: [],
        erro: acesso.erro,
        codigo: acesso.codigo,
        origem: null,
        expiraEm: null,
        contaActiva: null,
        tipoActivo: null,
        podeLigar,
      },
      { headers: SEM_CACHE },
    );
  }

  const estado = await estadoDeriv(acesso.credencial);
  const activa = estado.ligada ? await contaActivaSegura(acesso.credencial) : null;

  return NextResponse.json(
    {
      ...estado,
      codigo: estado.ligada ? 'Ligada' : 'Recusada',
      origem: acesso.credencial.origem,
      expiraEm: acesso.credencial.expiraEm,
      contaActiva: activa?.account_id ?? null,
      tipoActivo: activa?.account_type ?? null,
      podeLigar,
    },
    { headers: SEM_CACHE },
  );
}
