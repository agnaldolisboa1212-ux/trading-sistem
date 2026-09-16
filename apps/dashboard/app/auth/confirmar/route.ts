/**
 * Destino dos links nos emails: confirmar a conta, recuperar a palavra-passe,
 * entrar por link.
 *
 * Dois formatos, conforme o modelo de email do Supabase:
 *
 *   ?code=…                  fluxo PKCE (o que o cliente usa por omissão);
 *                            só funciona no mesmo browser que pediu o email
 *   ?token_hash=…&type=…     modelo com `{{ .TokenHash }}`; funciona em qualquer
 *                            browser
 *
 * Abre a sessão (os cookies saem nesta resposta) e segue para `proximo`, que
 * passa por `destinoSeguro`.
 */

import { NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { destinoSeguro } from '@/lib/acesso';
import { clienteServidor } from '@/lib/supabase/servidor';
import { urlPublico } from '@/lib/url-publico';

export const dynamic = 'force-dynamic';

const TIPOS: EmailOtpType[] = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'];

export async function GET(pedido: Request) {
  const url = new URL(pedido.url);
  const para = (caminho: string) => NextResponse.redirect(urlPublico(pedido, caminho), 303);
  const proximo = destinoSeguro(url.searchParams.get('proximo'));
  const db = await clienteServidor();
  if (!db) return para('/entrar');

  const falhou = (motivo: string) =>
    para(`/entrar?erro=${encodeURIComponent(motivo)}`);

  const erroNoLink = url.searchParams.get('error_description');
  if (erroNoLink) return falhou('O link expirou ou já foi usado. Peça outro.');

  const code = url.searchParams.get('code');
  if (code) {
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (error) {
      return falhou(
        'Não foi possível confirmar com este link neste browser. Abra-o no mesmo dispositivo onde pediu, ou use o código do email.',
      );
    }
    return para(proximo);
  }

  const tokenHash = url.searchParams.get('token_hash');
  const tipo = url.searchParams.get('type') as EmailOtpType | null;
  if (tokenHash && tipo && TIPOS.includes(tipo)) {
    const { error } = await db.auth.verifyOtp({ token_hash: tokenHash, type: tipo });
    if (error) return falhou('O link expirou ou já foi usado. Peça outro.');
    return para(tipo === 'recovery' ? '/recuperar/nova' : proximo);
  }

  return falhou('Link incompleto.');
}
