/**
 * Envio de notificações push a pedido do MOTOR.
 *
 * O motor de sinais corre noutro processo e não tem as chaves VAPID nem a lista
 * de subscrições — isso vive aqui. Quando encontra um sinal, chama esta rota.
 *
 * ── AUTENTICAÇÃO ───────────────────────────────────────────────────────────
 *
 * Segredo partilhado no cabeçalho `X-Motor-Segredo`, igual a `MOTOR_SEGREDO` no
 * ambiente. Comparado com `timingSafeEqual`: uma comparação normal de strings
 * pára no primeiro carácter diferente, e o tempo de resposta denuncia quantos
 * caracteres acertaram.
 *
 * Sem `MOTOR_SEGREDO` definido a rota recusa tudo com 503, em vez de aceitar
 * tudo. Uma rota que manda notificações para o telemóvel de todos os
 * utilizadores não pode ter "aberta" como estado por omissão.
 */

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { configPush, enviarAviso } from '@/lib/push';

export const dynamic = 'force-dynamic';

function segredoValido(recebido: string | null): boolean {
  const esperado = process.env['MOTOR_SEGREDO'] ?? '';
  if (!esperado || !recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  // `timingSafeEqual` exige o mesmo comprimento; a diferença de comprimento em
  // si não revela o conteúdo.
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(pedido: Request) {
  if (!process.env['MOTOR_SEGREDO']) {
    return NextResponse.json({ erro: 'MOTOR_SEGREDO não definido no painel.' }, { status: 503 });
  }
  if (!segredoValido(pedido.headers.get('x-motor-segredo'))) {
    return NextResponse.json({ erro: 'não autorizado' }, { status: 401 });
  }
  if (!configPush()) {
    return NextResponse.json(
      { erro: 'Push não configurado: faltam VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY.' },
      { status: 409 },
    );
  }

  let corpo: { titulo?: unknown; corpo?: unknown; url?: unknown; tag?: unknown };
  try {
    corpo = (await pedido.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ erro: 'corpo inválido' }, { status: 400 });
  }

  const titulo = typeof corpo.titulo === 'string' ? corpo.titulo.slice(0, 120) : '';
  const texto = typeof corpo.corpo === 'string' ? corpo.corpo.slice(0, 300) : '';
  if (!titulo || !texto) {
    return NextResponse.json({ erro: 'titulo e corpo são obrigatórios' }, { status: 400 });
  }
  // Só caminhos internos: um aviso que abre um site externo ao tocar seria um
  // vector de phishing com o nome da app.
  const url = typeof corpo.url === 'string' && corpo.url.startsWith('/') ? corpo.url : '/';
  const tag = typeof corpo.tag === 'string' ? corpo.tag.slice(0, 120) : undefined;

  const r = await enviarAviso({ titulo, corpo: texto, url, tag });
  return NextResponse.json({ ok: true, ...r });
}
