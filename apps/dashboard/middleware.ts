/**
 * Porta de entrada: nenhuma página nem rota de dados abre sem sessão.
 *
 * A regra está em `lib/acesso.ts` (testada); aqui só se juntam os factos:
 *
 *   sessão       `getClaims()` confirma a assinatura do token e, se expirou,
 *                renova-o e escreve os cookies novos na resposta
 *   2 passos     o token diz `aal2` quando o código já foi pedido nesta
 *                sessão. Se diz `aal1`, pergunta-se ao Supabase se a conta tem
 *                um factor activo — e não à sessão guardada no cookie, que o
 *                próprio browser pode editar
 *   onboarding   `user_metadata.onboarding`, gravado quando termina
 */

import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { caminhoAberto, decidirAcesso } from './lib/acesso';
import { urlPublico } from './lib/url-publico';
import { SUPABASE_CHAVE_PUBLICA, SUPABASE_URL, supabaseConfigurado } from './lib/supabase/config';

/**
 * Tem segundo factor? — um minuto de memória por utilizador. Sem isto cada
 * pedido de uma conta sem 2FA (quase todas) faria uma chamada ao Supabase.
 */
const factores = new Map<string, { tem: boolean; ate: number }>();

async function tem2fa(db: SupabaseClient, id: string): Promise<boolean> {
  const guardado = factores.get(id);
  if (guardado && guardado.ate > Date.now()) return guardado.tem;
  const { data, error } = await db.auth.getUser();
  // Falha de rede: deixa passar sem guardar. Fechar a app a toda a gente
  // porque o Supabase demorou seria pior; a próxima pergunta repete.
  if (error || !data.user) return false;
  const tem = (data.user.factors ?? []).some((f) => f.status === 'verified');
  if (factores.size > 5000) factores.clear();
  factores.set(id, { tem, ate: Date.now() + 60_000 });
  return tem;
}

export async function middleware(pedido: NextRequest) {
  const caminho = pedido.nextUrl.pathname;
  if (caminhoAberto(caminho)) return NextResponse.next();
  // Sem Supabase (desenvolvimento sem .env) não há contas: a app fica aberta.
  if (!supabaseConfigurado) return NextResponse.next();

  let resposta = NextResponse.next({ request: pedido });
  const db = createServerClient(SUPABASE_URL, SUPABASE_CHAVE_PUBLICA, {
    cookies: {
      getAll: () => pedido.cookies.getAll(),
      setAll: (lista) => {
        for (const { name, value } of lista) pedido.cookies.set(name, value);
        resposta = NextResponse.next({ request: pedido });
        for (const { name, value, options } of lista) resposta.cookies.set(name, value, options);
      },
    },
  });

  let autenticado = false;
  let falta2fa = false;
  let onboardingFeito = false;
  try {
    const { data } = await db.auth.getClaims();
    const claims = data?.claims;
    if (claims?.sub) {
      autenticado = true;
      onboardingFeito =
        (claims.user_metadata as { onboarding?: unknown } | undefined)?.onboarding === true;
      if (claims.aal !== 'aal2') falta2fa = await tem2fa(db, claims.sub);
    }
  } catch {
    // Token ilegível ou Supabase inacessível: conta como sem sessão.
  }

  const d = decidirAcesso({ caminho, autenticado, falta2fa, onboardingFeito });
  if (d.tipo === 'seguir') return resposta;

  const final =
    d.tipo === 'recusar'
      ? NextResponse.json(
          { erro: d.erro, codigo: d.codigo },
          { status: d.estado, headers: { 'Cache-Control': 'no-store' } },
        )
      : NextResponse.redirect(urlPublico(pedido, d.para), {
          status: 307,
          headers: { 'Cache-Control': 'no-store' },
        });

  // Uma sessão renovada neste pedido tem de chegar ao browser mesmo num redirect.
  for (const c of resposta.cookies.getAll()) final.cookies.set(c);
  return final;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|icones/|favicon.ico|sw.js|manifest.webmanifest).*)'],
};
