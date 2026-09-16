import 'server-only';

/**
 * Quem está a fazer este pedido? — do lado do servidor.
 *
 * A sessão do Supabase vive no BROWSER (o cliente em `lib/auth.ts` guarda-a em
 * `localStorage`). Uma rota de API não a vê. O cliente envia o `access_token`
 * no cabeçalho `Authorization` (ver `lib/api.ts`), e aqui confirma-se junto do
 * Supabase que é válido e a quem pertence.
 *
 * Confirmar no Supabase, e não só descodificar o JWT localmente, é deliberado:
 * um token de uma conta apagada ou de uma sessão terminada continua a ter uma
 * assinatura válida até expirar. `getUser` responde com o estado real.
 *
 * Um minuto de cache por token: as rotas da conta são chamadas de 20 em 20
 * segundos por página aberta, e perguntar ao Supabase a cada uma acrescentaria
 * um salto de rede sem mudar a resposta.
 */

import { createClient } from '@supabase/supabase-js';

export interface UtilizadorPlataforma {
  id: string;
  /** Sempre em minúsculas. */
  email: string | null;
}

const TTL_MS = 60_000;
const cache = new Map<string, { utilizador: UtilizadorPlataforma; ate: number }>();

export async function utilizadorDoPedido(pedido: Request): Promise<UtilizadorPlataforma | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(pedido.headers.get('authorization') ?? '');
  const jwt = m?.[1];
  if (!jwt) return null;

  const guardado = cache.get(jwt);
  if (guardado && guardado.ate > Date.now()) return guardado.utilizador;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !chave) return null;

  try {
    const { data, error } = await createClient(url, chave, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).auth.getUser(jwt);
    if (error || !data.user) return null;

    const utilizador = { id: data.user.id, email: data.user.email?.toLowerCase() ?? null };
    // Tecto simples: não é um cache de produção, é um amortecedor.
    if (cache.size > 500) cache.clear();
    cache.set(jwt, { utilizador, ate: Date.now() + TTL_MS });
    return utilizador;
  } catch {
    return null;
  }
}
