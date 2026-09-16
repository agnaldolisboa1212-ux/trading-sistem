/**
 * Eliminar sinais da lista da conta — um ou vários de uma vez.
 *
 * Não apaga o sinal (é do motor, e outras contas seguem o mesmo instrumento):
 * guarda em `sinais_ocultos` que esta conta não o quer ver. A sessão decide de
 * quem são as linhas; o RLS garante-o do lado da base de dados.
 */

import { NextResponse } from 'next/server';
import { clienteServidor } from '@/lib/supabase/servidor';

export const dynamic = 'force-dynamic';

export async function POST(pedido: Request) {
  let corpo: { ids?: unknown };
  try {
    corpo = (await pedido.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ erro: 'corpo inválido' }, { status: 400 });
  }
  const ids = Array.isArray(corpo.ids)
    ? [...new Set(corpo.ids.filter((x): x is string => typeof x === 'string' && x.length <= 200))].slice(0, 200)
    : [];
  if (ids.length === 0) return NextResponse.json({ erro: 'sem sinais para eliminar' }, { status: 400 });

  const db = await clienteServidor();
  if (!db) return NextResponse.json({ erro: 'Supabase não configurado' }, { status: 503 });
  const { data: u } = await db.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return NextResponse.json({ erro: 'sem sessão', codigo: 'SemSessao' }, { status: 401 });

  const { error } = await db
    .from('sinais_ocultos')
    .upsert(
      ids.map((sinal_id) => ({ utilizador_id: uid, sinal_id })),
      { onConflict: 'utilizador_id,sinal_id', ignoreDuplicates: true },
    );
  if (error) {
    const falta = /sinais_ocultos|relation|schema cache/i.test(error.message);
    return NextResponse.json(
      {
        erro: falta
          ? 'Falta criar a tabela sinais_ocultos no Supabase (migração 0006).'
          : error.message,
      },
      { status: falta ? 503 : 500 },
    );
  }
  return NextResponse.json({ ok: true, eliminados: ids.length });
}
