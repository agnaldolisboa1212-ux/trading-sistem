import 'server-only';

import { cookies } from 'next/headers';
import { listarContas, type ConfigDeriv, type ContaDeriv } from './conta';

/**
 * Qual das contas da Deriv esta activa.
 *
 * Guardada num cookie `httpOnly`, nao no `localStorage`: a escolha entre DEMO e
 * REAL decide para onde vai dinheiro verdadeiro, e um valor que o JavaScript da
 * pagina consegue reescrever nao e sitio para essa decisao.
 *
 * O cookie guarda apenas o `account_id`, e as contas sao sempre relidas com a
 * credencial DESTE pedido. Um id de outra credencial — de outra pessoa, ou de
 * antes de trocar de login — simplesmente nao casa, e cai-se para a demo.
 */
const COOKIE = 'deriv_conta';

/**
 * Regra de omissao: **demo**.
 *
 * Quem abre a aplicacao pela primeira vez nao escolheu nada, e o unico valor por
 * omissao defensavel para uma conta ligada a dinheiro real e nao ser a real.
 */
export function escolherOmissao(contas: ContaDeriv[]): ContaDeriv | null {
  return contas.find((c) => c.account_type === 'demo') ?? contas[0] ?? null;
}

export async function contaActiva(c: ConfigDeriv): Promise<ContaDeriv | null> {
  const contas = await listarContas(c);
  if (contas.length === 0) return null;

  const escolhida = (await cookies()).get(COOKIE)?.value;
  if (escolhida) {
    const conta = contas.find((x) => x.account_id === escolhida);
    if (conta) return conta;
  }
  return escolherOmissao(contas);
}

export async function definirContaActiva(accountId: string): Promise<void> {
  (await cookies()).set(COOKIE, accountId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 180,
  });
}

/** Le a conta activa sem falhar quando a Deriv esta em baixo. */
export async function contaActivaSegura(c: ConfigDeriv): Promise<ContaDeriv | null> {
  try {
    return await contaActiva(c);
  } catch {
    return null;
  }
}
