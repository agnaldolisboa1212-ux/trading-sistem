/**
 * Envia uma notificacao de teste aos dispositivos de QUEM PEDE.
 *
 * Existe porque "as notificacoes estao configuradas" e uma afirmacao que so se
 * pode verificar recebendo uma. O ecra de definicoes chama esta rota e mostra
 * quantas sairam, quantas falharam e quantas subscricoes mortas foram limpas —
 * tres numeros que dizem exatamente onde esta o problema quando ha um.
 */

import { NextResponse } from 'next/server';
import { enviarAviso, configPush } from '@/lib/push';
import { utilizadorDoPedido } from '@/lib/sessao-plataforma';

export const dynamic = 'force-dynamic';

export async function POST(pedido: Request) {
  // Só para os dispositivos da própria conta: um teste não pode tocar no
  // telemóvel de todos os utilizadores.
  const utilizador = await utilizadorDoPedido(pedido);
  if (!utilizador) {
    return NextResponse.json({ erro: 'Entre na plataforma para enviar um teste.' }, { status: 401 });
  }

  if (!configPush()) {
    return NextResponse.json(
      {
        erro: 'Push nao configurado. Faltam VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY.',
      },
      { status: 409 },
    );
  }

  const r = await enviarAviso(
    {
      titulo: 'Forex Dude System',
      corpo: 'As notificacoes estao a funcionar. Vai receber alertas de entrada e saida aqui.',
      url: '/',
      tag: 'teste',
      validadeS: 300,
    },
    { utilizador: utilizador.id },
  );

  return NextResponse.json({ ok: true, ...r });
}
