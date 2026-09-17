/**
 * Saldo manual da conta — pontos que a pessoa introduz para a curva de capital.
 *
 * Sem execução automática (as ordens só saem com um toque no terminal), não há
 * saldo real a derivar dos sinais. Cada conta regista o seu quando quiser; a
 * sessão decide de quem são as linhas, e o RLS garante-o do lado da base de
 * dados (migração 0009).
 */

import { NextResponse } from 'next/server';
import { clienteServidor } from '@/lib/supabase/servidor';

export const dynamic = 'force-dynamic';

function faltaTabela(mensagem: string): boolean {
  return /saldo_manual|relation|schema cache/i.test(mensagem);
}

export async function GET() {
  const db = await clienteServidor();
  if (!db) return NextResponse.json({ erro: 'Supabase não configurado' }, { status: 503 });
  const { data: u } = await db.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return NextResponse.json({ pontos: [], semSessao: true });

  const { data, error } = await db
    .from('saldo_manual')
    .select('id,saldo,moeda,nota,registado_em')
    .eq('utilizador_id', uid)
    .order('registado_em', { ascending: true })
    .limit(500);
  if (error) {
    return NextResponse.json(
      { erro: faltaTabela(error.message) ? 'Falta aplicar a migração 0009 no Supabase.' : error.message },
      { status: faltaTabela(error.message) ? 503 : 500 },
    );
  }
  return NextResponse.json({ pontos: data ?? [] });
}

export async function POST(pedido: Request) {
  let corpo: { saldo?: unknown; moeda?: unknown; nota?: unknown };
  try {
    corpo = (await pedido.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ erro: 'corpo inválido' }, { status: 400 });
  }
  const saldo = Number(corpo.saldo);
  if (!Number.isFinite(saldo)) return NextResponse.json({ erro: 'saldo inválido' }, { status: 400 });
  const moeda = typeof corpo.moeda === 'string' && corpo.moeda.trim() ? corpo.moeda.trim().slice(0, 8).toUpperCase() : 'USD';
  const nota = typeof corpo.nota === 'string' && corpo.nota.trim() ? corpo.nota.trim().slice(0, 200) : null;

  const db = await clienteServidor();
  if (!db) return NextResponse.json({ erro: 'Supabase não configurado' }, { status: 503 });
  const { data: u } = await db.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return NextResponse.json({ erro: 'sem sessão', codigo: 'SemSessao' }, { status: 401 });

  const { data, error } = await db
    .from('saldo_manual')
    .insert({ utilizador_id: uid, saldo, moeda, nota })
    .select('id,saldo,moeda,nota,registado_em')
    .single();
  if (error) {
    return NextResponse.json(
      { erro: faltaTabela(error.message) ? 'Falta aplicar a migração 0009 no Supabase.' : error.message },
      { status: faltaTabela(error.message) ? 503 : 500 },
    );
  }
  return NextResponse.json({ ok: true, ponto: data });
}

export async function DELETE(pedido: Request) {
  const url = new URL(pedido.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ erro: 'falta o id' }, { status: 400 });

  const db = await clienteServidor();
  if (!db) return NextResponse.json({ erro: 'Supabase não configurado' }, { status: 503 });
  const { data: u } = await db.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return NextResponse.json({ erro: 'sem sessão', codigo: 'SemSessao' }, { status: 401 });

  const { error } = await db.from('saldo_manual').delete().eq('id', id).eq('utilizador_id', uid);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
