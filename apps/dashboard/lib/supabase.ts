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
// Tipos das linhas lidas. Deliberadamente parciais: o dashboard so declara o
// que mostra, para nao ter de acompanhar cada alteracao do esquema.
// ---------------------------------------------------------------------------

export interface SignalRow {
  id: string;
  symbol: string;
  timeframe: string;
  direction: 'bullish' | 'bearish';
  status: string;
  mode: string;
  generated_at: string;
  entry_price: number;
  entry_zone_low: number;
  entry_zone_high: number;
  stop_loss: number;
  max_r_multiple: number;
  confidence: number;
  checklist_score: number;
  entry_stage: string | null;
  entry_pattern_kind: string | null;
  expected_horizon_days: number | null;
  narrative: string | null;
  targets: Array<{ price: number; rMultiple: number; closeFraction: number; rationale: string }>;
  checklist: {
    steps?: Array<{ step: number; question: string; passed: boolean; detail: string }>;
    score?: number;
    passed?: boolean;
  };
  warnings: string[];
}

export interface DiagnosticRow {
  symbol: string;
  timeframe: string;
  htf_order_flow: string | null;
  model_type: string | null;
  model_phase: string | null;
  checklist_score: number;
  failed_at_step: number | null;
  smt_count: number;
  summary: string | null;
  scanned_at: string;
}

export interface PositionRow {
  id: string;
  symbol: string;
  direction: string;
  opened_at: string;
  filled_price: number;
  current_stop: number;
  remaining_fraction: number;
  realized_r: number;
  unrealized_r: number;
  status: string;
  max_r_multiple: number | null;
  confidence: number | null;
  entry_stage: string | null;
}

export interface ProviderHealthRow {
  provider_id: string;
  ok: boolean;
  latency_ms: number | null;
  last_success_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export async function fetchSignals(limit = 25): Promise<SignalRow[]> {
  const db = getSupabase();
  if (!db) return [];
  const { data } = await db
    .from('signals')
    .select('*')
    .order('generated_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as SignalRow[];
}

/**
 * Diagnostico do varrimento MAIS RECENTE.
 *
 * Duas consultas em vez de uma: primeiro descobre o `scan_id` mais recente,
 * depois traz as linhas desse varrimento. Ordenar por data e cortar por limite
 * misturaria varrimentos diferentes quando o universo muda de tamanho.
 */
export async function fetchLatestDiagnostics(): Promise<DiagnosticRow[]> {
  const db = getSupabase();
  if (!db) return [];

  const { data: latest } = await db
    .from('scan_diagnostics')
    .select('scan_id')
    .order('scanned_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const scanId = (latest as { scan_id: string } | null)?.scan_id;
  if (!scanId) return [];

  const { data } = await db
    .from('scan_diagnostics')
    .select('*')
    .eq('scan_id', scanId)
    .order('checklist_score', { ascending: false });

  return (data ?? []) as DiagnosticRow[];
}

export async function fetchOpenPositions(): Promise<PositionRow[]> {
  const db = getSupabase();
  if (!db) return [];
  const { data } = await db.from('v_open_positions').select('*').order('opened_at', { ascending: false });
  return (data ?? []) as PositionRow[];
}

export async function fetchProviderHealth(): Promise<ProviderHealthRow[]> {
  const db = getSupabase();
  if (!db) return [];
  const { data } = await db.from('provider_health').select('*').order('provider_id');
  return (data ?? []) as ProviderHealthRow[];
}

// ---------------------------------------------------------------------------
// Financeiro
// ---------------------------------------------------------------------------

export interface AccountSummaryRow {
  open_positions: number;
  closed_positions: number;
  total_realized_r: number;
  total_unrealized_r: number;
  wins: number;
  losses: number;
  pending_signals: number;
  total_signals: number;
}

export interface EquityPointRow {
  taken_at: string;
  balance: number;
  open_risk: number;
  open_positions: number;
  realized_pnl: number;
  unrealized_pnl: number;
}

export interface ClosedPositionRow {
  id: string;
  symbol: string;
  direction: string;
  opened_at: string;
  closed_at: string | null;
  filled_price: number;
  entry_price: number | null;
  realized_r: number;
  status: string;
  close_reason: string | null;
  max_r_multiple: number | null;
}

export async function fetchAccountSummary(): Promise<AccountSummaryRow | null> {
  const db = getSupabase();
  if (!db) return null;
  const { data } = await db.from('v_account_summary').select('*').maybeSingle();
  return (data as AccountSummaryRow | null) ?? null;
}

export async function fetchEquityCurve(limit = 180): Promise<EquityPointRow[]> {
  const db = getSupabase();
  if (!db) return [];
  const { data } = await db
    .from('equity_snapshots')
    .select('*')
    .order('taken_at', { ascending: false })
    .limit(limit);
  // Vem descendente para o `limit` apanhar os mais recentes; o gráfico precisa
  // de ordem cronológica.
  return ((data ?? []) as EquityPointRow[]).reverse();
}

export async function fetchClosedPositions(limit = 50): Promise<ClosedPositionRow[]> {
  const db = getSupabase();
  if (!db) return [];
  const { data } = await db
    .from('positions')
    .select('*')
    .in('status', ['closed', 'stopped'])
    .order('closed_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as ClosedPositionRow[];
}
