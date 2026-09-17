/**
 * Marcar que sinais a pessoa REALMENTE negociou, e em que conta.
 *
 * Os sinais em `sinais_tempo_real` são do sistema — partilhados com toda a
 * gente que segue aquele instrumento. Sem esta marcação, o desempenho
 * "pessoal" do Financeiro mediria todos os sinais gerados como se tivessem
 * sido todos negociados. A sessão decide de quem são as marcações; o RLS
 * garante-o do lado da base de dados (migração 0010).
 */

import { NextResponse } from 'next/server';
import { clienteServidor } from '@/lib/supabase/servidor';

export const dynamic = 'force-dynamic';

function faltaTabela(mensagem: string): boolean {
  return /entradas_pessoais|relation|schema cache/i.test(mensagem);
}

export async function GET() {
  const db = await clienteServidor();
  if (!db) return NextResponse.json({ erro: 'Supabase não configurado' }, { status: 503 });
  const { data: u } = await db.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return NextResponse.json({ entradas: [], semSessao: true });

  const { data, error } = await db
    .from('entradas_pessoais')
    .select('id,conta_id,sinal_id,criado_em')
    .eq('utilizador_id', uid)
    .order('criado_em', { ascending: false })
    .limit(2000);
  if (error) {
    return NextResponse.json(
      { erro: faltaTabela(error.message) ? 'Falta aplicar a migração 0010 no Supabase.' : error.message },
      { status: faltaTabela(error.message) ? 503 : 500 },
    );
  }
  return NextResponse.json({ entradas: data ?? [] });
}

export async function POST(pedido: Request) {
  let corpo: { contaId?: unknown; sinalId?: unknown };
  try {
    corpo = (await pedido.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ erro: 'corpo inválido' }, { status: 400 });
  }
  const contaId = Number(corpo.contaId);
  const sinalId = typeof corpo.sinalId === 'string' ? corpo.sinalId : '';
  if (!Number.isFinite(contaId) || !sinalId) {
    return NextResponse.json({ erro: 'falta a conta ou o sinal' }, { status: 400 });
  }

  const db = await clienteServidor();
  if (!db) return NextResponse.json({ erro: 'Supabase não configurado' }, { status: 503 });
  const { data: u } = await db.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return NextResponse.json({ erro: 'sem sessão', codigo: 'SemSessao' }, { status: 401 });

  const { data, error } = await db
    .from('entradas_pessoais')
    .upsert(
      { utilizador_id: uid, conta_id: contaId, sinal_id: sinalId },
      { onConflict: 'conta_id,sinal_id', ignoreDuplicates: true },
    )
    .select('id,conta_id,sinal_id,criado_em');
  if (error) {
    const semSinal = /foreign key|violat/i.test(error.message);
    return NextResponse.json(
      {
        erro: faltaTabela(error.message)
          ? 'Falta aplicar a migração 0010 no Supabase.'
          : semSinal
            ? 'Esse sinal ou essa conta não existem.'
            : error.message,
      },
      { status: faltaTabela(error.message) ? 503 : semSinal ? 400 : 500 },
    );
  }
  return NextResponse.json({ ok: true, entrada: data?.[0] ?? { conta_id: contaId, sinal_id: sinalId } });
}

export async function DELETE(pedido: Request) {
  const url = new URL(pedido.url);
  const contaId = Number(url.searchParams.get('contaId'));
  const sinalId = url.searchParams.get('sinalId');
  if (!Number.isFinite(contaId) || !sinalId) {
    return NextResponse.json({ erro: 'falta a conta ou o sinal' }, { status: 400 });
  }

  const db = await clienteServidor();
  if (!db) return NextResponse.json({ erro: 'Supabase não configurado' }, { status: 503 });
  const { data: u } = await db.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return NextResponse.json({ erro: 'sem sessão', codigo: 'SemSessao' }, { status: 401 });

  const { error } = await db
    .from('entradas_pessoais')
    .delete()
    .eq('utilizador_id', uid)
    .eq('conta_id', contaId)
    .eq('sinal_id', sinalId);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
