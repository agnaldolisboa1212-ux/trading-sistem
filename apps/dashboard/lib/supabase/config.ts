/**
 * Endereço e chave pública do Supabase — o mesmo par para browser, servidor e
 * middleware.
 *
 * Cada nome `NEXT_PUBLIC_*` aparece escrito por extenso: o Next substitui-os no
 * build por análise do texto, e uma procura dinâmica ficaria vazia no browser.
 * A chave é a PÚBLICA; o que ela pode ler decide-o o RLS.
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_CHAVE_PUBLICA =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  '';

export const supabaseConfigurado = Boolean(SUPABASE_URL && SUPABASE_CHAVE_PUBLICA);
