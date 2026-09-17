/**
 * Contas de negociação da pessoa — uma por corretora, se for o caso.
 *
 * Cada conta tem a sua curva de capital (`/api/saldo`) e o seu conjunto de
 * sinais marcados como negociados (`/api/entradas`). A sessão decide de quem
 * são; o RLS garante-o do lado da base de dados (migração 0010).
 */

import { NextResponse } from 'next/server';
import { clienteServidor } from '@/lib/supabase/servidor';

export const dynamic = 'force-dynamic';

function faltaTabela(mensagem: string): boolean {
  return /contas|relation|schema cache/i.test(mensagem);
}

export async function GET() {
  const db = await clienteServidor();
  if (!db) return NextResponse.json({ erro: 'Supabase não configurado' }, { status: 503 });
  const { data: u } = await db.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return NextResponse.json({ contas: [], semSessao: true });

  const { data, error } = await db
    .from('contas')
    .select('id,nome,corretora,moeda,arquivada,criado_em')
    .eq('utilizador_id', uid)
    .order('criado_em', { ascending: true });
  if (error) {
    return NextResponse.json(
      { erro: faltaTabela(error.message) ? 'Falta aplicar a migração 0010 no Supabase.' : error.message },
      { status: faltaTabela(error.message) ? 503 : 500 },
    );
  }
  return NextResponse.json({ contas: data ?? [] });
}

export async function POST(pedido: Request) {
  let corpo: { nome?: unknown; corretora?: unknown; moeda?: unknown };
  try {
    corpo = (await pedido.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ erro: 'corpo inválido' }, { status: 400 });
  }
  const nome = typeof corpo.nome === 'string' ? corpo.nome.trim().slice(0, 80) : '';
  if (!nome) return NextResponse.json({ erro: 'falta o nome da conta' }, { status: 400 });
  const corretora = typeof corpo.corretora === 'string' && corpo.corretora.trim() ? corpo.corretora.trim().slice(0, 80) : null;
  const moeda = typeof corpo.moeda === 'string' && corpo.moeda.trim() ? corpo.moeda.trim().slice(0, 8).toUpperCase() : 'USD';

  const db = await clienteServidor();
  if (!db) return NextResponse.json({ erro: 'Supabase não configurado' }, { status: 503 });
  const { data: u } = await db.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return NextResponse.json({ erro: 'sem sessão', codigo: 'SemSessao' }, { status: 401 });

  const { data, error } = await db
    .from('contas')
    .insert({ utilizador_id: uid, nome, corretora, moeda })
    .select('id,nome,corretora,moeda,arquivada,criado_em')
    .single();
  if (error) {
    return NextResponse.json(
      { erro: faltaTabela(error.message) ? 'Falta aplicar a migração 0010 no Supabase.' : error.message },
      { status: faltaTabela(error.message) ? 503 : 500 },
    );
  }
  return NextResponse.json({ ok: true, conta: data });
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

  // Apaga também os pontos de saldo e as entradas marcadas dessa conta (FK em cascata).
  const { error } = await db.from('contas').delete().eq('id', id).eq('utilizador_id', uid);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
