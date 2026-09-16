/**
 * Desliga a conta Deriv deste browser.
 *
 * Apaga o cookie com o token e a escolha de conta ativa. Não revoga o token na
 * Deriv — a documentação não indica endpoint para isso —, mas ele expira em
 * menos de uma hora e, sem o cookie, esta aplicação deixa de o ter.
 */

import { NextResponse } from 'next/server';
import { COOKIE_SESSAO } from '@/lib/deriv/oauth';

export const dynamic = 'force-dynamic';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_SESSAO, '', { path: '/', maxAge: 0 });
  res.cookies.set('deriv_conta', '', { path: '/', maxAge: 0 });
  return res;
}
