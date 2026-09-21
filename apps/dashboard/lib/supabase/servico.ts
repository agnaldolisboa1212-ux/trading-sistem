import 'server-only';

/**
 * Acesso ao Supabase com a chave de SERVIÇO — sem sessão de ninguém.
 *
 * Só para pedidos que não vêm de um browser: o motor a pedir uma ordem
 * automática, por exemplo. A chave de serviço passa por cima do RLS, por isso
 * cada rota que a use tem de decidir por si de quem são os dados que lê ou
 * escreve. Nunca chega ao cliente: este ficheiro é `server-only`.
 *
 * REST em vez do SDK, como em `push.ts`: são duas ou três chamadas.
 */

function credenciais(): { url: string; chave: string } | null {
  const url = process.env['SUPABASE_URL'] ?? process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const chave = process.env['SUPABASE_SECRET_KEY'] ?? process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !chave) return null;
  return { url, chave };
}

export const temServico = (): boolean => credenciais() !== null;

export async function lerServico<T>(caminho: string): Promise<T[] | null> {
  const c = credenciais();
  if (!c) return null;
  try {
    const r = await fetch(`${c.url}/rest/v1/${caminho}`, {
      headers: { apikey: c.chave, Authorization: `Bearer ${c.chave}` },
      cache: 'no-store',
    });
    if (!r.ok) return null;
    return (await r.json()) as T[];
  } catch {
    return null;
  }
}

export async function escreverServico(
  caminho: string,
  corpo: unknown,
  prefer = 'return=minimal',
): Promise<{ ok: boolean; erro: string | null }> {
  const c = credenciais();
  if (!c) return { ok: false, erro: 'Supabase de serviço não configurado.' };
  try {
    const r = await fetch(`${c.url}/rest/v1/${caminho}`, {
      method: 'POST',
      headers: {
        apikey: c.chave,
        Authorization: `Bearer ${c.chave}`,
        'Content-Type': 'application/json',
        Prefer: prefer,
      },
      body: JSON.stringify(corpo),
    });
    if (!r.ok) return { ok: false, erro: `${r.status} ${(await r.text()).slice(0, 200)}` };
    return { ok: true, erro: null };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}
