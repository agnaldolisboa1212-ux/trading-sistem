import 'server-only';

/**
 * Sessão da plataforma do lado do servidor — páginas, rotas e acções.
 *
 * A sessão vive em cookies (escritos pelo cliente de `navegador.ts` e renovados
 * pelo `middleware.ts`). Aqui lê-se com o utilizador a sério: `getUser()`
 * pergunta ao Supabase, por isso uma conta apagada ou uma sessão terminada
 * deixam de valer logo, e não só quando o token expirar.
 */

import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { SUPABASE_CHAVE_PUBLICA, SUPABASE_URL, supabaseConfigurado } from './config';

export async function clienteServidor(): Promise<SupabaseClient | null> {
  if (!supabaseConfigurado) return null;
  const jar = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_CHAVE_PUBLICA, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (lista) => {
        try {
          for (const { name, value, options } of lista) jar.set(name, value, options);
        } catch {
          // Um Server Component não pode escrever cookies. Não faz mal: o
          // middleware renova a sessão no pedido seguinte.
        }
      },
    },
  });
}

/** O utilizador com sessão neste pedido, confirmado junto do Supabase. */
export async function utilizadorDaSessao(): Promise<User | null> {
  const db = await clienteServidor();
  if (!db) return null;
  try {
    const { data, error } = await db.auth.getUser();
    return error ? null : data.user;
  } catch {
    return null;
  }
}
