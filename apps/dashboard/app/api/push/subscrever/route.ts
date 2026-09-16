/**
 * Registo e remocao de subscricoes push.
 *
 * POST   -> guarda a subscricao que o browser produziu
 * DELETE -> apaga-a (o utilizador desligou as notificacoes)
 *
 * A subscricao vem do proprio browser e contem um endpoint do servico de push
 * (Google, Mozilla, Apple) e duas chaves. Nao ha nada de secreto do nosso lado
 * a validar — a chave privada VAPID nunca sai do servidor e e ela que autentica
 * os envios.
 */

import { NextResponse } from 'next/server';
import { registarSubscritor, removerSubscritor, estadoPush } from '@/lib/push';

export const dynamic = 'force-dynamic';

export async function GET() {
  const e = await estadoPush();
  return NextResponse.json(e, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(pedido: Request) {
  let corpo: {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
    utilizador?: string | null;
  };
  try {
    corpo = (await pedido.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ erro: 'corpo invalido' }, { status: 400 });
  }

  const { endpoint, keys } = corpo;
  if (!endpoint || !keys?.p256dh || !keys.auth) {
    return NextResponse.json({ erro: 'subscricao incompleta' }, { status: 400 });
  }

  // Um endpoint que nao seja HTTPS nao vem de nenhum servico de push real.
  if (!endpoint.startsWith('https://')) {
    return NextResponse.json({ erro: 'endpoint invalido' }, { status: 400 });
  }

  try {
    await registarSubscritor(
      { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } },
      corpo.utilizador ?? null,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { erro: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function DELETE(pedido: Request) {
  let corpo: { endpoint?: string };
  try {
    corpo = (await pedido.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ erro: 'corpo invalido' }, { status: 400 });
  }
  if (!corpo.endpoint) return NextResponse.json({ erro: 'endpoint em falta' }, { status: 400 });

  await removerSubscritor(corpo.endpoint);
  return NextResponse.json({ ok: true });
}
