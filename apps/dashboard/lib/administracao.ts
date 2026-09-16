import 'server-only';

/**
 * Quem gere o servidor.
 *
 * `ADMIN_EMAILS` (lista separada por vírgulas); sem ela vale `DERIV_DONO_EMAIL`,
 * que já identificava o dono. Serve só para MOSTRAR o estado do servidor nas
 * definições (integrações, chaves, fontes) — não dá acesso a contas de ninguém.
 */

import type { User } from '@supabase/supabase-js';

export function ehAdministrador(u: Pick<User, 'email'> | null): boolean {
  const email = u?.email?.toLowerCase();
  if (!email) return false;
  const lista = (process.env['ADMIN_EMAILS'] ?? process.env['DERIV_DONO_EMAIL'] ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return lista.includes(email);
}
