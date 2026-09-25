'use client';

/**
 * Contas da plataforma — Supabase Auth no browser.
 *
 * NÃO CONFUNDIR com a ligação à Deriv. São dois logins com riscos diferentes:
 *
 *   plataforma (aqui) — quem é o utilizador desta app: preferências, avisos,
 *                       e qual ligação Deriv é dele. Sessão em cookies, que o
 *                       `middleware.ts` confirma antes de servir qualquer página.
 *   corretora (Deriv) — acesso a dinheiro. O token NUNCA chega ao browser;
 *                       vive cifrado num cookie `httpOnly` ligado a esta conta.
 *
 * ── MÉTODOS ────────────────────────────────────────────────────────────────
 *
 * Email e palavra-passe para o dia a dia, porque funciona dentro da app
 * instalada sem ir ao email a cada entrada. Código por email como alternativa e
 * para confirmar a conta e recuperar a palavra-passe. Verificação em dois
 * passos (TOTP, com uma app como o Google Authenticator) opcional, nas
 * definições.
 */

import type { Factor, Session, User } from '@supabase/supabase-js';
import { supabaseConfigurado } from './supabase/config';
import { clienteNavegador } from './supabase/navegador';

export const authConfigurada = supabaseConfigurado;

/** Mantido para `lib/api.ts` e outros que só precisam do cliente. */
export function authCliente() {
  return clienteNavegador();
}

export type Resultado<T = undefined> =
  | { ok: true; valor: T }
  | { ok: false; erro: string; codigo?: string };

const SEM_SUPABASE: Resultado<never> = { ok: false, erro: 'Supabase não configurado.' };

/**
 * As mensagens do Supabase vêm em inglês e, algumas, a falar de coisas internas.
 * A pessoa precisa de saber o que fazer a seguir.
 */
export function traduzirErro(e: { code?: string; message?: string } | null | undefined): string {
  if (!e) return 'Ocorreu um erro. Tente de novo.';
  switch (e.code) {
    case 'invalid_credentials':
      return 'Email ou palavra-passe errados.';
    case 'email_not_confirmed':
      return 'Ainda não confirmou o email. Procure a mensagem que enviámos, incluindo no spam.';
    case 'user_already_exists':
    case 'email_exists':
      return 'Já existe uma conta com este email. Entre, ou recupere a palavra-passe.';
    case 'weak_password':
      return 'Palavra-passe fraca: use pelo menos 8 caracteres, com letras e números.';
    case 'over_email_send_rate_limit':
      return 'Foram enviados demasiados emails. Espere alguns minutos e tente de novo.';
    case 'over_request_rate_limit':
      return 'Demasiadas tentativas seguidas. Espere um minuto.';
    case 'email_address_not_authorized':
      return 'O envio de emails ainda não está configurado para este endereço. Contacte o administrador.';
    case 'otp_expired':
      return 'O código está errado ou expirou. Peça outro.';
    case 'same_password':
      return 'A nova palavra-passe tem de ser diferente da actual.';
    case 'signup_disabled':
      return 'O registo de novas contas está fechado.';
    case 'email_address_invalid':
    case 'validation_failed':
      return 'Esse email não é válido.';
    case 'mfa_verification_failed':
    case 'mfa_challenge_expired':
      return 'Código errado ou expirado. Use o código que a app mostra agora.';
    case 'reauthentication_needed':
    case 'insufficient_aal':
      return 'Por segurança, confirme primeiro o código da verificação em dois passos.';
    case 'session_not_found':
    case 'refresh_token_not_found':
      return 'A sessão terminou. Entre de novo.';
    case 'user_banned':
      return 'Esta conta está suspensa.';
  }
  const m = e.message ?? '';
  if (/failed to fetch|network/i.test(m)) return 'Sem ligação ao servidor. Verifique a internet.';
  return m || 'Ocorreu um erro. Tente de novo.';
}

function falha(e: { code?: string; message?: string } | null | undefined): Resultado<never> {
  return { ok: false, erro: traduzirErro(e), codigo: e?.code };
}

// ---------------------------------------------------------------------------
// Palavra-passe
// ---------------------------------------------------------------------------

export const PALAVRA_PASSE_MINIMO = 8;

/** Devolve o que falta, ou `null` se serve. */
export function problemaPalavraPasse(p: string): string | null {
  if (p.length < PALAVRA_PASSE_MINIMO) return `Pelo menos ${PALAVRA_PASSE_MINIMO} caracteres.`;
  if (!/[a-zA-Z]/.test(p) || !/\d/.test(p)) return 'Use letras e números.';
  return null;
}

/** 0 (fraca) a 4 (forte) — só para a barra de força, não é uma garantia. */
export function forcaPalavraPasse(p: string): number {
  let pontos = 0;
  if (p.length >= PALAVRA_PASSE_MINIMO) pontos++;
  if (p.length >= 12) pontos++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) pontos++;
  if (/\d/.test(p) && /[^a-zA-Z0-9]/.test(p)) pontos++;
  return pontos;
}

const origem = () => (typeof window === 'undefined' ? '' : window.location.origin);

// ---------------------------------------------------------------------------
// Entrar, registar, recuperar
// ---------------------------------------------------------------------------

export async function entrar(email: string, palavraPasse: string): Promise<Resultado> {
  const db = clienteNavegador();
  if (!db) return SEM_SUPABASE;
  const { error } = await db.auth.signInWithPassword({ email: email.trim(), password: palavraPasse });
  return error ? falha(error) : { ok: true, valor: undefined };
}

/** `precisaConfirmar`: a conta foi criada mas só entra depois de confirmar o email. */
export async function registar(p: {
  nome: string;
  email: string;
  palavraPasse: string;
}): Promise<Resultado<{ precisaConfirmar: boolean }>> {
  const db = clienteNavegador();
  if (!db) return SEM_SUPABASE;
  const { data, error } = await db.auth.signUp({
    email: p.email.trim(),
    password: p.palavraPasse,
    options: {
      data: { nome: p.nome.trim() },
      emailRedirectTo: `${origem()}/auth/confirmar?proximo=/onboarding`,
    },
  });
  if (error) return falha(error);
  // Com a confirmação de email ligada, um email já registado devolve um
  // utilizador sem identidades em vez de erro — para não revelar quem tem conta.
  // Diz-se o mesmo que a um registo novo: "veja o seu email".
  return { ok: true, valor: { precisaConfirmar: !data.session } };
}

export async function reenviarConfirmacao(email: string): Promise<Resultado> {
  const db = clienteNavegador();
  if (!db) return SEM_SUPABASE;
  const { error } = await db.auth.resend({
    type: 'signup',
    email: email.trim(),
    options: { emailRedirectTo: `${origem()}/auth/confirmar?proximo=/onboarding` },
  });
  return error ? falha(error) : { ok: true, valor: undefined };
}

/**
 * Valida um código de seis dígitos enviado por email.
 *
 *   signup    confirmar a conta
 *   recovery  recuperar a palavra-passe (abre uma sessão para a mudar)
 *   email     entrar sem palavra-passe
 */
export async function validarCodigo(
  email: string,
  codigo: string,
  tipo: 'signup' | 'recovery' | 'email',
): Promise<Resultado> {
  const db = clienteNavegador();
  if (!db) return SEM_SUPABASE;
  const { error } = await db.auth.verifyOtp({ email: email.trim(), token: codigo.trim(), type: tipo });
  return error ? falha(error) : { ok: true, valor: undefined };
}

/** Código para entrar sem palavra-passe. Não cria contas: para isso há o registo. */
export async function pedirCodigoEntrada(email: string): Promise<Resultado> {
  const db = clienteNavegador();
  if (!db) return SEM_SUPABASE;
  const { error } = await db.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: false },
  });
  return error ? falha(error) : { ok: true, valor: undefined };
}

export async function pedirRecuperacao(email: string): Promise<Resultado> {
  const db = clienteNavegador();
  if (!db) return SEM_SUPABASE;
  const { error } = await db.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${origem()}/auth/confirmar?proximo=/recuperar/nova`,
  });
  return error ? falha(error) : { ok: true, valor: undefined };
}

export async function definirPalavraPasse(nova: string): Promise<Resultado> {
  const db = clienteNavegador();
  if (!db) return SEM_SUPABASE;
  const { error } = await db.auth.updateUser({ password: nova });
  return error ? falha(error) : { ok: true, valor: undefined };
}

/**
 * Sair.
 *
 * A ligação Deriv é desligada primeiro: é um cookie deste browser, e num
 * telemóvel partilhado a próxima pessoa não pode herdar o acesso à corretora.
 * `todos`: termina também as sessões nos outros dispositivos.
 */
export async function sair(todos = false): Promise<void> {
  try {
    await fetch('/api/deriv/oauth/sair', { method: 'POST' });
  } catch {
    /* sem rede: o cookie Deriv expira sozinho numa hora */
  }
  try {
    await clienteNavegador()?.auth.signOut({ scope: todos ? 'global' : 'local' });
  } catch {
    /* os cookies locais são limpos na mesma */
  }
  try {
    localStorage.removeItem('avatar');
  } catch {
    /* modo privado */
  }
  document.cookie = 'prefs=; path=/; max-age=0';
}

export async function sessaoAtual(): Promise<Session | null> {
  const db = clienteNavegador();
  if (!db) return null;
  const { data } = await db.auth.getSession();
  return data.session;
}

export async function utilizadorAtual(): Promise<User | null> {
  const db = clienteNavegador();
  if (!db) return null;
  const { data } = await db.auth.getUser();
  return data.user;
}

/**
 * Marca o onboarding como feito na própria conta.
 *
 * Vai para `user_metadata` porque é o que o middleware lê no token, sem ir à
 * base de dados a cada pedido. A sessão é renovada logo a seguir: o token antigo
 * ainda diria "por fazer" e o middleware mandaria a pessoa de volta.
 */
export async function marcarOnboarding(nome: string | null): Promise<Resultado> {
  const db = clienteNavegador();
  if (!db) return SEM_SUPABASE;
  const { error } = await db.auth.updateUser({
    data: { onboarding: true, ...(nome ? { nome } : {}) },
  });
  if (error) return falha(error);
  const { error: erroRenovar } = await db.auth.refreshSession();
  return erroRenovar ? falha(erroRenovar) : { ok: true, valor: undefined };
}

// ---------------------------------------------------------------------------
// Verificação em dois passos (TOTP)
// ---------------------------------------------------------------------------

export async function factores2fa(): Promise<Factor[]> {
  const db = clienteNavegador();
  if (!db) return [];
  const { data } = await db.auth.mfa.listFactors();
  return data?.totp ?? [];
}

/** Começa a activação: devolve o QR para a app de autenticação ler. */
export async function iniciar2fa(): Promise<
  Resultado<{ factorId: string; qr: string; segredo: string }>
> {
  const db = clienteNavegador();
  if (!db) return SEM_SUPABASE;

  // Uma activação abandonada deixa um factor por verificar, e o Supabase recusa
  // outro com o mesmo nome. Limpa-se antes de começar.
  const { data: lista } = await db.auth.mfa.listFactors();
  for (const f of lista?.all ?? []) {
    if (f.factor_type === 'totp' && f.status !== 'verified') {
      await db.auth.mfa.unenroll({ factorId: f.id });
    }
  }

  const { data, error } = await db.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `App de autenticação ${new Date().toISOString().slice(0, 10)}`,
  });
  if (error || !data) return falha(error);
  return { ok: true, valor: { factorId: data.id, qr: data.totp.qr_code, segredo: data.totp.secret } };
}

/** Confirma a activação, ou o código pedido ao entrar. */
export async function confirmar2fa(factorId: string, codigo: string): Promise<Resultado> {
  const db = clienteNavegador();
  if (!db) return SEM_SUPABASE;
  const { error } = await db.auth.mfa.challengeAndVerify({ factorId, code: codigo.trim() });
  return error ? falha(error) : { ok: true, valor: undefined };
}

export async function desactivar2fa(factorId: string): Promise<Resultado> {
  const db = clienteNavegador();
  if (!db) return SEM_SUPABASE;
  const { error } = await db.auth.mfa.unenroll({ factorId });
  if (error) return falha(error);
  await db.auth.refreshSession();
  return { ok: true, valor: undefined };
}

// ---------------------------------------------------------------------------
// Perfil
// ---------------------------------------------------------------------------

export interface Perfil {
  utilizador_id: string;
  nome: string | null;
  avatar_url: string | null;
  estrategia: string;
  instrumentos: string[];
  /** Até dois. Coluna criada pela migração 0004. */
  objetivos?: string[];
  /** Timeframes dos sinais escolhidos pela pessoa (migração 0008). Vazio = os do objetivo. */
  timeframes_sinais?: string[];
  /** Sessões em que os avisos push chegam (migração 0011). Vazio = qualquer hora. */
  sessoes_sinais?: string[];
  avisos_ativos?: boolean;
  montante_por_operacao?: number;
  deriv_ligada: boolean;
  deriv_account_id: string | null;
  deriv_ambiente: 'demo' | 'real' | null;
  onboarding_em: string | null;
}

async function idAtual(): Promise<string | null> {
  const db = clienteNavegador();
  if (!db) return null;
  const { data } = await db.auth.getSession();
  return data.session?.user?.id ?? null;
}

/**
 * Lê o perfil de quem entrou. Se ainda não existir linha, cria-a: o trigger da
 * migração 0003 nem sempre tem privilégios para o fazer.
 */
export async function lerPerfil(): Promise<Perfil | null> {
  const db = clienteNavegador();
  const uid = await idAtual();
  if (!db || !uid) return null;

  const { data } = await db.from('perfis_utilizador').select('*').eq('utilizador_id', uid).maybeSingle();
  if (data) return data as Perfil;

  const { data: criado } = await db
    .from('perfis_utilizador')
    .insert({ utilizador_id: uid })
    .select('*')
    .maybeSingle();
  return (criado as Perfil | null) ?? null;
}

/**
 * Grava preferências. Só os campos passados são tocados.
 *
 * `upsert` e não `update`: sem linha, um `update` devolve sucesso a afectar zero
 * linhas e o onboarding dizia "guardado" sem guardar. As políticas RLS limitam
 * a inserção e a actualização ao próprio `auth.uid()`.
 */
export async function guardarPerfil(
  campos: Partial<Omit<Perfil, 'utilizador_id'>>,
): Promise<Resultado> {
  const db = clienteNavegador();
  if (!db) return SEM_SUPABASE;
  const uid = await idAtual();
  if (!uid) return { ok: false, erro: 'A sessão terminou. Entre de novo.' };

  const { error } = await db
    .from('perfis_utilizador')
    .upsert({ utilizador_id: uid, ...campos }, { onConflict: 'utilizador_id' });
  return error ? falha(error) : { ok: true, valor: undefined };
}

/** Catálogo de estratégias oferecidas no onboarding. */
export interface EstrategiaDisponivel {
  id: string;
  nome: string;
  descricao: string;
  escala: string;
  /** False quando ainda está a ser construída. */
  pronta: boolean;
}

/*
 * `pronta` significa uma coisa concreta: existe código que a corre sobre dados
 * reais e devolve um plano. Não significa que ganhe dinheiro — nenhuma destas
 * tem vantagem demonstrada, e o ecrã de escolha diz isso por extenso.
 */
export const ESTRATEGIAS: EstrategiaDisponivel[] = [
  {
    id: 'mmxm-smt',
    nome: 'MMXM + SMT Divergence',
    descricao:
      'Market Maker Models com divergência entre pares correlacionados e alinhamento Time & Price. Muito seletiva: 9 passos têm de passar todos.',
    escala: 'Swing · dias a semanas',
    pronta: true,
  },
  {
    id: 'institucional',
    nome: 'Fluxo institucional',
    descricao:
      'VWAP com bandas de desvio-padrão e perfil de volume (POC e value area). Dispara com muito mais frequência — e por isso apanha mais ruído.',
    escala: 'Intradiário',
    pronta: true,
  },
];
