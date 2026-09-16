/**
 * Com que conta Deriv é que ESTE pedido pode falar? — a regra, isolada.
 *
 * Função pura, sem imports, para poder ser testada sem servidor
 * (`apps/dashboard/test/decisao.test.mjs`). É a peça que decide se alguém vê o
 * saldo de outra pessoa ou lhe envia ordens, e por isso é a que mais precisa de
 * testes que não dependam de alguém se lembrar de a experimentar à mão.
 *
 * ── O DEFEITO QUE ISTO FECHA ───────────────────────────────────────────────
 *
 * Até aqui todas as rotas da conta usavam `DERIV_TOKEN` — o token do dono do
 * servidor — para QUALQUER pedido. Em localhost é inofensivo. Publicado, quem
 * abrisse o site via o saldo do dono e podia enviar ordens na conta dele.
 *
 * ── A REGRA ────────────────────────────────────────────────────────────────
 *
 *   1. Ligação OAuth deste browser, se for do mesmo utilizador e não expirou
 *   2. Token do servidor, SÓ para quem tiver o email em `DERIV_DONO_EMAIL`
 *      (ou, com o login desligado, em desenvolvimento)
 *   3. Nada — e a resposta diz o que falta: login, ligar a Deriv, ou ligar de
 *      novo porque a sessão de uma hora acabou
 */

export type OrigemCredencial = 'oauth' | 'dono';

/** O que vai cifrado no cookie da ligação OAuth. */
export interface SessaoOAuth {
  /** access_token da Deriv. */
  t: string;
  /** Utilizador da plataforma que fez a ligação (null se não havia login). */
  u: string | null;
  /** Expira em (ms). */
  e: number;
}

export interface EntradaDecisao {
  /** Produção, ou `DERIV_EXIGIR_LOGIN=true`. */
  exigirLogin: boolean;
  utilizador: { id: string; email: string | null } | null;
  oauth: SessaoOAuth | null;
  tokenDono: string | null;
  /** Em minúsculas. */
  emailsDono: readonly string[];
  agora: number;
}

export type Decisao =
  | { ok: true; token: string; origem: OrigemCredencial; expiraEm: number | null }
  | {
      ok: false;
      estado: 401 | 409;
      codigo: 'SemSessao' | 'DerivNaoLigada' | 'DerivExpirou';
      erro: string;
    };

export function decidirCredencial(e: EntradaDecisao): Decisao {
  // 1. A ligação do próprio utilizador.
  if (e.oauth) {
    const deOutraPessoa =
      e.oauth.u !== null && e.utilizador !== null && e.oauth.u !== e.utilizador.id;
    // Em produção, um cookie OAuth sem sessão iniciada não chega: o cookie pode
    // ter ficado num computador partilhado depois de a pessoa sair.
    const faltaLogin = e.exigirLogin && e.utilizador === null;
    if (!deOutraPessoa && !faltaLogin && e.oauth.e > e.agora) {
      return { ok: true, token: e.oauth.t, origem: 'oauth', expiraEm: e.oauth.e };
    }
  }

  // 2. O token do servidor — só para o dono.
  if (e.tokenDono) {
    const email = e.utilizador?.email?.toLowerCase() ?? null;
    const ehDono = email !== null && e.emailsDono.includes(email);
    if (ehDono || !e.exigirLogin) {
      return { ok: true, token: e.tokenDono, origem: 'dono', expiraEm: null };
    }
  }

  // 3. Nada serve: dizer exatamente o que falta.
  if (e.exigirLogin && e.utilizador === null) {
    return {
      ok: false,
      estado: 401,
      codigo: 'SemSessao',
      erro: 'Entre na plataforma para usar a sua conta de trading.',
    };
  }
  if (e.oauth && e.oauth.e <= e.agora) {
    return {
      ok: false,
      estado: 409,
      codigo: 'DerivExpirou',
      erro: 'A sessão Deriv expirou — duram uma hora. Ligue de novo: é um toque.',
    };
  }
  return {
    ok: false,
    estado: 409,
    codigo: 'DerivNaoLigada',
    erro: 'Ligue a sua conta Deriv para ver o saldo e negociar.',
  };
}
