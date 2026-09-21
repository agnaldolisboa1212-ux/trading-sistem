/**
 * O que a automação fez — e o que recusou fazer.
 *
 * Sem este registo, uma automação que não envia ordens é indistinguível de uma
 * automação avariada. Cada sinal deixa aqui uma linha, mesmo quando foi
 * recusado, com o motivo.
 */

import { NextResponse } from 'next/server';
import { clienteServidor, utilizadorDaSessao } from '@/lib/supabase/servidor';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = await clienteServidor();
  const u = await utilizadorDaSessao();
  if (!db || !u) return NextResponse.json({ erro: 'Entre na plataforma.' }, { status: 401 });

  const { data, error } = await db
    .from('ordens_automaticas')
    .select('id,simbolo,estrategia,lado,lotes,resultado,motivo,criado_em')
    .eq('utilizador_id', u.id)
    .order('criado_em', { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ordens: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
}
