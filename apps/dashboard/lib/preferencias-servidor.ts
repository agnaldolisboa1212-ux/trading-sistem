import 'server-only';

/**
 * Preferências de quem está a ver a página, do lado do servidor.
 *
 * Vêm do perfil da CONTA, lido com a sessão da própria pessoa (o RLS só lhe
 * devolve a sua linha). Antes vinham de um cookie do browser: num telemóvel
 * partilhado, a segunda pessoa via os mercados e o nome da primeira.
 *
 * O cookie fica como recurso para quando o Supabase não responde — a app tem de
 * abrir na mesma.
 */

import { cookies } from 'next/headers';
import { COOKIE_PREFS, OMISSAO, dePerfil, interpretar, type Preferencias } from './preferencias';
import { clienteServidor } from './supabase/servidor';

/** Nunca rejeita. */
export async function lerPreferenciasServidor(): Promise<Preferencias> {
  try {
    const db = await clienteServidor();
    if (db) {
      const { data: u } = await db.auth.getUser();
      if (u.user) {
        const { data } = await db
          .from('perfis_utilizador')
          .select('nome, estrategia, objetivos, instrumentos, onboarding_em')
          .eq('utilizador_id', u.user.id)
          .maybeSingle();
        const nomeDaConta = (u.user.user_metadata as { nome?: string } | undefined)?.nome ?? null;
        return dePerfil(data, nomeDaConta);
      }
    }
  } catch {
    /* cai para o cookie */
  }
  try {
    return interpretar((await cookies()).get(COOKIE_PREFS)?.value);
  } catch {
    return OMISSAO;
  }
}
