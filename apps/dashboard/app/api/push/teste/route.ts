/**
 * Envia uma notificacao de teste a todos os subscritores.
 *
 * Existe porque "as notificacoes estao configuradas" e uma afirmacao que so se
 * pode verificar recebendo uma. O ecra de definicoes chama esta rota e mostra
 * quantas sairam, quantas falharam e quantas subscricoes mortas foram limpas —
 * tres numeros que dizem exatamente onde esta o problema quando ha um.
 */

import { NextResponse } from 'next/server';
import { exigirLogin } from '@/lib/deriv/oauth';
import { enviarAviso, configPush } from '@/lib/push';
import { utilizadorDoPedido } from '@/lib/sessao-plataforma';

export const dynamic = 'force-dynamic';

export async function POST(pedido: Request) {
  /*
   * Em produção só com sessão iniciada. Sem isto, qualquer pessoa que
   * descobrisse o URL mandava notificações para o telemóvel de TODOS os
   * utilizadores, quantas vezes quisesse.
   */
  if (exigirLogin() && !(await utilizadorDoPedido(pedido))) {
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

  const r = await enviarAviso({
    titulo: 'Sistema de Trading',
    corpo: 'As notificacoes estao a funcionar. Vai receber alertas de entrada e saida aqui.',
    url: '/',
    tag: 'teste',
  });

  return NextResponse.json({ ok: true, ...r });
}
