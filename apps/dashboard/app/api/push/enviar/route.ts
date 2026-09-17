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

  let corpo: Record<string, unknown>;
  try {
    corpo = (await pedido.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ erro: 'corpo inválido' }, { status: 400 });
  }

  const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  const titulo = texto(corpo['titulo'], 120);
  const mensagem = texto(corpo['corpo'], 300);
  if (!titulo || !mensagem) {
    return NextResponse.json({ erro: 'titulo e corpo são obrigatórios' }, { status: 400 });
  }
  // Só caminhos internos: um aviso que abre um site externo ao tocar seria um
  // vector de phishing com o nome da app.
  const url = texto(corpo['url'], 300);
  const validade = Number(corpo['validadeS']);

  const r = await enviarAviso({
    titulo,
    corpo: mensagem,
    url: url.startsWith('/') && !url.startsWith('//') ? url : '/',
    tag: texto(corpo['tag'], 120) || undefined,
    validadeS: Number.isFinite(validade) && validade > 0 ? Math.min(validade, 86_400) : undefined,
    urgencia: corpo['urgencia'] === 'normal' ? 'normal' : 'high',
    topico: texto(corpo['topico'], 64) || undefined,
    simbolo: texto(corpo['simbolo'], 20) || undefined,
    timeframe: texto(corpo['timeframe'], 8) || undefined,
  });
  return NextResponse.json({ ok: true, ...r });
}
