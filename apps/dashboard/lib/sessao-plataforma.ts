import 'server-only';

/**
 * Quem está a fazer este pedido? — do lado do servidor.
 *
 * Duas fontes, por esta ordem:
 *
 *   1. cookies da sessão (o normal: o browser envia-os sozinho)
 *   2. `Authorization: Bearer <token>` (o que `apiFetch` também manda)
 *
 * Nas duas confirma-se junto do Supabase (`getUser`) e não só pela assinatura
 * do token: uma conta apagada ou uma sessão terminada continuam a ter token
 * assinado até expirar, e `getUser` responde com o estado real.
 *
 * Um minuto de cache por token: as rotas da conta são chamadas de 20 em 20
 * segundos por página aberta.
 */

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_CHAVE_PUBLICA, SUPABASE_URL, supabaseConfigurado } from './supabase/config';
import { utilizadorDaSessao } from './supabase/servidor';

export interface UtilizadorPlataforma {
  id: string;
  /** Sempre em minúsculas. */
  email: string | null;
}

const TTL_MS = 60_000;
const cache = new Map<string, { utilizador: UtilizadorPlataforma; ate: number }>();

async function doToken(jwt: string): Promise<UtilizadorPlataforma | null> {
  const guardado = cache.get(jwt);
  if (guardado && guardado.ate > Date.now()) return guardado.utilizador;
  try {
    const { data, error } = await createClient(SUPABASE_URL, SUPABASE_CHAVE_PUBLICA, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).auth.getUser(jwt);
    if (error || !data.user) return null;
    const utilizador = { id: data.user.id, email: data.user.email?.toLowerCase() ?? null };
    if (cache.size > 500) cache.clear();
    cache.set(jwt, { utilizador, ate: Date.now() + TTL_MS });
    return utilizador;
  } catch {
    return null;
  }
}

export async function utilizadorDoPedido(pedido: Request): Promise<UtilizadorPlataforma | null> {
  if (!supabaseConfigurado) return null;

  const daSessao = await utilizadorDaSessao();
  if (daSessao) return { id: daSessao.id, email: daSessao.email?.toLowerCase() ?? null };

  const m = /^Bearer\s+(\S+)$/i.exec(pedido.headers.get('authorization') ?? '');
  return m?.[1] ? doToken(m[1]) : null;
}
