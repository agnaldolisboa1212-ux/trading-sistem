'use client';

/**
 * `fetch` para as rotas da própria aplicação, com a sessão da plataforma.
 *
 * A sessão do Supabase vive no browser. Sem este cabeçalho as rotas da conta
 * Deriv não sabem quem está a pedir — e em produção recusam, que é o correto.
 */

import { authCliente } from './auth';

export async function apiFetch(entrada: string, init: RequestInit = {}): Promise<Response> {
  const cabecalhos = new Headers(init.headers);
  try {
    const db = authCliente();
    if (db) {
      const { data } = await db.auth.getSession();
      const token = data.session?.access_token;
      if (token) cabecalhos.set('Authorization', `Bearer ${token}`);
    }
  } catch {
    // Sem sessão legível segue sem cabeçalho; a rota diz o que falta.
  }
  return fetch(entrada, { cache: 'no-store', ...init, headers: cabecalhos });
}

/**
 * Leva a pessoa à página de login da Deriv.
 *
 * Devolve uma mensagem de erro, ou não devolve nada porque o browser já saiu
 * desta página.
 */
export async function ligarContaDeriv(): Promise<string | null> {
  try {
    const r = await apiFetch('/api/deriv/oauth/iniciar', { method: 'POST' });
    const j = (await r.json().catch(() => ({}))) as { url?: string; erro?: string };
    if (!r.ok || !j.url) return j.erro ?? `não foi possível começar (HTTP ${r.status})`;
    window.location.assign(j.url);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export async function desligarContaDeriv(): Promise<void> {
  await apiFetch('/api/deriv/oauth/sair', { method: 'POST' });
}
