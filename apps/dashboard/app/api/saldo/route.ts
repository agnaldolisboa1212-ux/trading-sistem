/**
 * Saldo manual — pontos que a pessoa introduz para a curva de capital de UMA conta.
 *
 * Sem execução automática (as ordens só saem com um toque no terminal), não há
 * saldo real a derivar dos sinais. Cada conta (migração 0010, `/api/contas`)
 * regista o seu quando quiser; a sessão decide de quem são as linhas, e o RLS
 * garante-o do lado da base de dados (migrações 0009 e 0010).
 */

import { NextResponse } from 'next/server';
import { clienteServidor } from '@/lib/supabase/servidor';

export const dynamic = 'force-dynamic';

function faltaTabela(mensagem: string): boolean {
  return /saldo_manual|contas|relation|schema cache/i.test(mensagem);
}

export async function GET(pedido: Request) {
  const url = new URL(pedido.url);
  const contaId = url.searchParams.get('contaId');

  const db = await clienteServidor();
  if (!db) return NextResponse.json({ erro: 'Supabase não configurado' }, { status: 503 });
  const { data: u } = await db.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return NextResponse.json({ pontos: [], semSessao: true });

  let consulta = db
    .from('saldo_manual')
    .select('id,conta_id,saldo,moeda,nota,registado_em')
    .eq('utilizador_id', uid)
    .order('registado_em', { ascending: true })
    .limit(1000);
  if (contaId) consulta = consulta.eq('conta_id', Number(contaId));

  const { data, error } = await consulta;
  if (error) {
    return NextResponse.json(
      { erro: faltaTabela(error.message) ? 'Falta aplicar a migração 0010 no Supabase.' : error.message },
      { status: faltaTabela(error.message) ? 503 : 500 },
    );
  }
  return NextResponse.json({ pontos: data ?? [] });
}

export async function POST(pedido: Request) {
  let corpo: { contaId?: unknown; saldo?: unknown; moeda?: unknown; nota?: unknown };
  try {
    corpo = (await pedido.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ erro: 'corpo inválido' }, { status: 400 });
  }
  const contaId = Number(corpo.contaId);
  const saldo = Number(corpo.saldo);
  if (!Number.isFinite(contaId)) return NextResponse.json({ erro: 'falta a conta' }, { status: 400 });
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
    .insert({ utilizador_id: uid, conta_id: contaId, saldo, moeda, nota })
    .select('id,conta_id,saldo,moeda,nota,registado_em')
    .single();
  if (error) {
    const semConta = /foreign key|violat/i.test(error.message);
    return NextResponse.json(
      {
        erro: faltaTabela(error.message)
          ? 'Falta aplicar a migração 0010 no Supabase.'
          : semConta
            ? 'Essa conta não existe.'
            : error.message,
      },
      { status: faltaTabela(error.message) ? 503 : semConta ? 400 : 500 },
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
