/**
 * Autorizar (ou retirar) o acesso do MOTOR à conta cTrader.
 *
 * A sessão cTrader normal vive num cookie do browser. O motor corre sem
 * browser, por isso precisa de uma cópia sua — cifrada, num ficheiro do
 * servidor. Este é o único sítio que a escreve, e só com a pessoa presente:
 * sessão iniciada, conta cTrader ligada, e `confirmacao: 'sim'` no corpo.
 *
 * DELETE apaga-a. É o travão de mão da automação: sem sessão do motor, não sai
 * nenhuma ordem automática, estejam as definições como estiverem.
 */

import { NextResponse } from 'next/server';
import { apagarSessaoMotor, guardarSessaoMotor, temSessaoMotor } from '@/lib/ctrader/motor';
import { acessoCtrader } from '@/lib/ctrader/sessao';

export const dynamic = 'force-dynamic';

const SEM_CACHE = { 'Cache-Control': 'no-store' };

export async function GET() {
  return NextResponse.json({ autorizado: await temSessaoMotor() }, { headers: SEM_CACHE });
}

export async function POST(pedido: Request) {
  let c: { confirmacao?: string };
  try {
    c = (await pedido.json()) as typeof c;
  } catch {
    return NextResponse.json({ erro: 'corpo inválido' }, { status: 400 });
  }
  if (c.confirmacao !== 'sim') {
    return NextResponse.json(
      { erro: 'Autorização não confirmada. O motor passará a enviar ordens sozinho nesta conta.' },
      { status: 428, headers: SEM_CACHE },
    );
  }

  const a = await acessoCtrader(pedido);
  if (!a.ok) return NextResponse.json({ erro: a.erro, codigo: a.codigo }, { status: a.estado, headers: SEM_CACHE });

  const esperado = process.env['AUTOMACAO_UTILIZADOR_ID'];
  if (esperado && esperado !== a.utilizador.id) {
    return NextResponse.json(
      { erro: 'O motor deste servidor está ligado a outra conta da plataforma.' },
      { status: 403, headers: SEM_CACHE },
    );
  }

  await guardarSessaoMotor(a.sessao);
  return NextResponse.json({ ok: true, autorizado: true }, { headers: SEM_CACHE });
}

export async function DELETE(pedido: Request) {
  const a = await acessoCtrader(pedido);
  // Mesmo com a ligação cTrader já expirada, quem tem sessão na plataforma tem
  // de conseguir desligar isto. Só se recusa quem não tem sessão nenhuma.
  if (!a.ok && a.estado === 401) {
    return NextResponse.json({ erro: a.erro, codigo: a.codigo }, { status: 401, headers: SEM_CACHE });
  }
  await apagarSessaoMotor();
  return NextResponse.json({ ok: true, autorizado: false }, { headers: SEM_CACHE });
}
