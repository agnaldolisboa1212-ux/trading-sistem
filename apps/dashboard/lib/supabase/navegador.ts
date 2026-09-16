'use client';

/**
 * Cliente Supabase do browser, com a sessão em cookies.
 *
 * Antes a sessão vivia no `localStorage`: o servidor não a via, e por isso não
 * havia como fechar as páginas a quem não entrou — toda a gente abria a app
 * como o mesmo visitante anónimo. Em cookies, o `middleware.ts` vê quem é antes
 * de servir qualquer página.
 */

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CHAVE_PUBLICA, SUPABASE_URL, supabaseConfigurado } from './config';

let cliente: SupabaseClient | null = null;

export function clienteNavegador(): SupabaseClient | null {
  if (!supabaseConfigurado) return null;
  cliente ??= createBrowserClient(SUPABASE_URL, SUPABASE_CHAVE_PUBLICA);
  return cliente;
}
