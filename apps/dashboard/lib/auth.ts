'use client';

/**
 * Autenticação da plataforma — Supabase Auth no browser.
 *
 * NÃO CONFUNDIR com a ligação à Deriv. São dois logins com propósitos e riscos
 * diferentes:
 *
 *   plataforma (aqui) — quem é o utilizador deste painel. Chave publicável,
 *                       pode viver no browser, RLS limita o que ele vê.
 *   corretora (Deriv) — acesso a dinheiro real. O token NUNCA chega ao browser;
 *                       vive só em rotas de servidor.
 *
 * Método: código por email (OTP), não palavra-passe. Evita gerir recuperação,
 * força de palavra-passe e fugas — e o utilizador já tem de ter acesso ao email
 * de qualquer forma.
 */

import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const chave =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  '';

export const authConfigurada = Boolean(url && chave);

let cliente: SupabaseClient | null = null;

/**
 * Cliente com sessão persistente.
 *
 * Ao contrário do cliente de leitura em `lib/supabase.ts` (que usa
 * `persistSession: false` porque corre no servidor a cada pedido), este guarda
 * a sessão para o utilizador não ter de voltar a autenticar-se a cada visita.
 */
export function authCliente(): SupabaseClient | null {
  if (!authConfigurada) return null;
  cliente ??= createClient(url, chave, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return cliente;
}

export interface Perfil {
  utilizador_id: string;
  nome: string | null;
  avatar_url: string | null;
  estrategia: string;
  instrumentos: string[];
  /** Até dois. Coluna criada pela migração 0004. */
  objetivos?: string[];
  deriv_ligada: boolean;
  deriv_account_id: string | null;
  deriv_ambiente: 'demo' | 'real' | null;
  onboarding_em: string | null;
}

/** Envia o código de verificação para o email. */
export async function pedirCodigo(email: string): Promise<{ ok: boolean; erro?: string }> {
  const db = authCliente();
  if (!db) return { ok: false, erro: 'Supabase não configurado.' };

  const { error } = await db.auth.signInWithOtp({
    email,
    options: {
      // Cria a conta se ainda não existir — não há ecrã de registo separado.
      shouldCreateUser: true,
    },
  });

  return error ? { ok: false, erro: error.message } : { ok: true };
}

/** Valida o código de seis dígitos e abre a sessão. */
export async function validarCodigo(
  email: string,
  codigo: string,
): Promise<{ ok: boolean; erro?: string; sessao?: Session }> {
  const db = authCliente();
  if (!db) return { ok: false, erro: 'Supabase não configurado.' };

  const { data, error } = await db.auth.verifyOtp({
    email,
    token: codigo.trim(),
    type: 'email',
  });

  if (error) return { ok: false, erro: error.message };
  return { ok: true, sessao: data.session ?? undefined };
}

export async function sessaoAtual(): Promise<Session | null> {
  const db = authCliente();
  if (!db) return null;
  const { data } = await db.auth.getSession();
  return data.session;
}

export async function sair(): Promise<void> {
  await authCliente()?.auth.signOut();
}

/**
 * Lê o perfil do utilizador autenticado.
 *
 * A migração cria a linha automaticamente por trigger no registo, mas o trigger
 * pode falhar em projetos onde a função não tem privilégio para escrever na
 * tabela. Por isso: se não existir, cria-se aqui. Um perfil em falta bloquearia
 * o onboarding inteiro.
 */
export async function lerPerfil(): Promise<Perfil | null> {
  const db = authCliente();
  if (!db) return null;

  const { data: sessao } = await db.auth.getSession();
  const uid = sessao.session?.user?.id;
  if (!uid) return null;

  const { data } = await db
    .from('perfis_utilizador')
    .select('*')
    .eq('utilizador_id', uid)
    .maybeSingle();

  if (data) return data as Perfil;

  const { data: criado } = await db
    .from('perfis_utilizador')
    .insert({ utilizador_id: uid })
    .select('*')
    .maybeSingle();

  return (criado as Perfil | null) ?? null;
}

/** Grava preferências. Só os campos passados são tocados. */
export async function guardarPerfil(
  campos: Partial<Omit<Perfil, 'utilizador_id'>>,
): Promise<{ ok: boolean; erro?: string }> {
  const db = authCliente();
  if (!db) return { ok: false, erro: 'Supabase não configurado.' };

  const { data: sessao } = await db.auth.getSession();
  const uid = sessao.session?.user?.id;
  if (!uid) return { ok: false, erro: 'Sessão expirada.' };

  /*
   * `upsert`, e não `update`.
   *
   * A migração 0003 tenta criar o perfil automaticamente com um trigger em
   * `auth.users` — mas avisa que nem todos os projetos dão privilégios para
   * isso e, nesse caso, ignora-o em silêncio. Sem o trigger não existe linha, e
   * um `update` sobre linha nenhuma devolve SUCESSO a afetar zero linhas: o
   * onboarding dizia "guardado" e não guardava nada. O `upsert` cria a linha
   * quando falta e atualiza quando existe; as políticas RLS de inserção e de
   * atualização limitam ambas a `auth.uid()`.
   */
  const { error } = await db
    .from('perfis_utilizador')
    .upsert({ utilizador_id: uid, ...campos }, { onConflict: 'utilizador_id' });

  return error ? { ok: false, erro: error.message } : { ok: true };
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
 * Registo das estratégias.
 *
 * `pronta` significa uma coisa concreta e verificável: **existe código que a
 * corre sobre dados reais e devolve um plano de negociação**. Não significa que
 * ganhe dinheiro — nenhuma destas tem vantagem demonstrada, e o rodapé do
 * ecrã de escolha diz isso por extenso.
 *
 * As duas institucionais estiveram marcadas como "em construção" enquanto
 * eram. Deixaram de o ser: vivem em `packages/core/src/strategies/`, têm 18
 * testes automáticos e correm em `/api/radar` para todo o instrumento fora do
 * universo MMXM. Manter a etiqueta seria mentir na direção segura, o que
 * continua a ser mentir.
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
    id: 'supply-demand',
    nome: 'Oferta e procura',
    descricao:
      'Zonas onde um desequilíbrio deixou ordens por preencher, mais níveis por toques repetidos, flips e números redondos.',
    escala: 'Intradiário a swing',
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
