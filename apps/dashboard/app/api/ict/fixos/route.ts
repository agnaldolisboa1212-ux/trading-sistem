/**
 * O setup fixo do ICT ALGO de um instrumento (o que o motor está a seguir) e
 * os que terminaram — para o gráfico mostrar o setup e o tiro mesmo depois de
 * a análise de agora ter mudado.
 */

import { NextResponse } from 'next/server';
import { clienteServidor } from '@/lib/supabase/servidor';
import { lerSetupsIct } from '@/lib/motores';

export const dynamic = 'force-dynamic';

export async function GET(pedido: Request) {
  const db = await clienteServidor();
  if (!db) return NextResponse.json({ erro: 'Supabase não configurado' }, { status: 503 });
  const { data: u } = await db.auth.getUser();
  if (!u.user) return NextResponse.json({ erro: 'sem sessão', codigo: 'SemSessao' }, { status: 401 });
  const s = new URL(pedido.url).searchParams.get('s')?.toUpperCase() ?? '';
  const todos = await lerSetupsIct();
  return NextResponse.json({ simbolo: s, registo: todos[s] ?? null, em: Date.now() }, { headers: { 'Cache-Control': 'no-store' } });
}
