/**
 * Cliente Supabase do dashboard.
 *
 * Usa a chave PUBLICA, que por politica RLS so tem SELECT. A chave secreta
 * (`sb_secret_...` ou `service_role`) nunca pode aparecer aqui: este modulo
 * acaba no browser.
 *
 * O Supabase tem duas geracoes de chaves e ambas sao aceites:
 *   - nova:    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  (`sb_publishable_...`)
 *   - legada:  NEXT_PUBLIC_SUPABASE_ANON_KEY         (JWT `eyJ...`)
 *
 * As duas ocupam a mesma posicao no cliente e resolvem para o papel `anon` no
 * Postgres, que e o papel a que as politicas de leitura dao acesso.
 *
 * NOTA sobre Next.js: `process.env.NEXT_PUBLIC_*` e substituido em build por
 * analise estatica do texto, por isso cada nome tem de aparecer escrito por
 * extenso. Uma procura dinamica (`process.env[nome]`) devolveria undefined no
 * bundle do cliente.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const publishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  '';

export const isConfigured = Boolean(url && publishableKey);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!isConfigured) return null;
  client ??= createClient(url, publishableKey, {
    auth: { persistSession: false },
  });
  return client;
}

// ---------------------------------------------------------------------------
// sinais_tempo_real — os sinais REAIS do motor (estratégias validadas e em
// teste). É a única fonte do Financeiro: não há posições de papel simuladas.
// ---------------------------------------------------------------------------

export interface SinalTempoRealRow {
  id: string;
  simbolo: string;
  timeframe: string;
  estrategia: string;
  direccao: 'bullish' | 'bearish';
  entrada: number;
  stop: number;
  stop_actual: number | null;
  alvos: Array<{ preco: number; r: number }>;
  r_maximo: number;
  conviccao: number;
  concordam: number;
  razao: string | null;
  gerado_em: string;
  criado_em: string;
  /** a-aguardar-entrada | em-curso | protegida | fechada | expirado | perdido | null (sem acompanhamento ainda) */
  estado: string | null;
  resultado_r: number | null;
  eventos: Array<{ tipo: string; em: number; preco: number; resultadoR?: number }>;
}

/**
 * Sinais do motor de tempo real, mais recentes primeiro.
 *
 * Sem filtro de portfólio: o Financeiro mede o SISTEMA — todos os pares e
 * estratégias que já geraram sinal — não só o que esta conta escolheu ver.
 */
export async function fetchSinaisTempoReal(limite = 1000): Promise<SinalTempoRealRow[]> {
  const db = getSupabase();
  if (!db) return [];
  const { data } = await db
    .from('sinais_tempo_real')
    .select(
      'id,simbolo,timeframe,estrategia,direccao,entrada,stop,stop_actual,alvos,r_maximo,conviccao,concordam,razao,gerado_em,criado_em,estado,resultado_r,eventos',
    )
    .order('gerado_em', { ascending: false })
    .limit(limite);
  return (data ?? []) as SinalTempoRealRow[];
}

// ---------------------------------------------------------------------------
// saldo_manual — pontos de saldo que cada conta introduz (migração 0009).
// Lido do lado do servidor com a sessão (RLS por utilizador); ver
// `app/api/saldo/route.ts`. Aqui fica só o tipo, partilhado com o cliente.
// ---------------------------------------------------------------------------

export interface SaldoManualRow {
  id: number;
  saldo: number;
  moeda: string;
  nota: string | null;
  registado_em: string;
}
