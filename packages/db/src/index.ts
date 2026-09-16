/**
 * @trading/db — persistencia no Supabase.
 *
 * O motor escreve com a chave SECRETA (sb_secret_... ou service_role), que
 * ignora RLS; o dashboard le com a chave PUBLICAVEL (sb_publishable_... ou
 * anon), que por politica RLS so tem SELECT. Este pacote assume o papel de
 * escrita: nunca deve ser importado por codigo que corra no browser.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  CandleSeries,
  ExitSignal,
  MmxmModel,
  SmtEvent,
  TradeSignal,
} from '@trading/core';

export interface DbConfig {
  url: string;
  serviceRoleKey: string;
}

/**
 * Chave de ESCRITA, nas duas geracoes de chaves do Supabase:
 *   - nova:    SUPABASE_SECRET_KEY        (`sb_secret_...`)
 *   - legada:  SUPABASE_SERVICE_ROLE_KEY  (JWT `eyJ...`)
 *
 * Ambas ignoram RLS, por isso so podem viver no servidor — nunca num bundle
 * servido ao browser.
 */
function writeKey(): string {
  return process.env['SUPABASE_SECRET_KEY'] ?? process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '';
}

export function createDbClient(config?: Partial<DbConfig>): SupabaseClient {
  const url = config?.url ?? process.env['SUPABASE_URL'] ?? '';
  const key = config?.serviceRoleKey ?? writeKey();

  if (!url || !key) {
    throw new Error(
      'Para escrever na base de dados sao precisas SUPABASE_URL e uma chave secreta ' +
        '(SUPABASE_SECRET_KEY, formato sb_secret_..., ou SUPABASE_SERVICE_ROLE_KEY). ' +
        'A chave publicavel (sb_publishable_...) NAO serve: as politicas RLS so lhe dao leitura.',
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** True quando o ambiente tem credenciais — permite correr o motor sem BD. */
export function isDbConfigured(): boolean {
  return Boolean(process.env['SUPABASE_URL'] && writeKey());
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Linha de um sinal a aguardar preenchimento. */
export interface PendingSignalRow {
  id: string;
  symbol: string;
  direction: 'bullish' | 'bearish';
  generated_at: string;
  entry_zone_low: number;
  entry_zone_high: number;
  entry_price: number;
  stop_loss: number;
  targets: Array<{ price: number; rMultiple: number; closeFraction: number; rationale: string }>;
  max_r_multiple: number;
  expected_horizon_days: number | null;
  expires_after_bars: number | null;
  consolidation_high: number | null;
  consolidation_low: number | null;
  position_units: number | null;
  risk_amount: number | null;
  narrative: string | null;
}

/** Tudo o que e preciso para abrir uma posicao com o plano congelado. */
export interface OpenPositionInput {
  signalId: string;
  symbol: string;
  direction: 'bullish' | 'bearish';
  mode: 'paper' | 'live';
  openedAt: number;
  filledPrice: number;
  units: number;
  entryPrice: number;
  stopLoss: number;
  targets: Array<{ price: number; rMultiple: number; closeFraction: number; rationale: string }>;
  consolidationHigh: number;
  consolidationLow: number;
  expectedHorizonDays: number;
  maxRMultiple: number;
}

/** Posicao aberta, com o plano de saida congelado na abertura. */
export interface StoredPosition {
  id: string;
  signalId: string;
  symbol: string;
  direction: 'bullish' | 'bearish';
  openedAt: number;
  filledPrice: number;
  entryPrice: number;
  initialStop: number;
  currentStop: number;
  remainingFraction: number;
  hitTargets: number[];
  targets: Array<{ price: number; rMultiple: number; closeFraction: number; rationale: string }>;
  consolidationHigh: number;
  consolidationLow: number;
  expectedHorizonDays: number;
  realizedR: number;
  initialUnits: number;
}

// ---------------------------------------------------------------------------

export class TradingRepository {
  constructor(private readonly db: SupabaseClient) {}

  /** Garante que os instrumentos do universo existem na base de dados. */
  async upsertInstruments(
    instruments: ReadonlyArray<{
      symbol: string;
      name: string;
      assetClass: string;
      pricePrecision: number;
      tickSize: number;
      continuous: boolean;
    }>,
  ): Promise<void> {
    const rows = instruments.map((i) => ({
      symbol: i.symbol,
      name: i.name,
      asset_class: i.assetClass,
      price_precision: i.pricePrecision,
      tick_size: i.tickSize,
      continuous: i.continuous,
    }));
    const { error } = await this.db.from('instruments').upsert(rows, { onConflict: 'symbol' });
    if (error) throw new Error(`upsertInstruments: ${error.message}`);
  }

  /**
   * Grava velas de forma idempotente.
   *
   * O upsert na chave (symbol, timeframe, open_time) significa que reprocessar
   * um dia ja gravado apenas actualiza — nunca duplica nem falha.
   */
  async saveCandles(series: CandleSeries): Promise<number> {
    if (series.candles.length === 0) return 0;

    const rows = series.candles.map((c) => ({
      symbol: series.symbol,
      timeframe: series.timeframe,
      open_time: iso(c.time),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      source: series.source,
      fidelity: series.fidelity,
    }));

    // Lotes de 500 para nao estourar o limite de payload do PostgREST.
    let written = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const { error } = await this.db
        .from('candles')
        .upsert(batch, { onConflict: 'symbol,timeframe,open_time' });
      if (error) throw new Error(`saveCandles(${series.symbol}): ${error.message}`);
      written += batch.length;
    }
    return written;
  }

  /** Grava um modelo MMXM e devolve o seu id. */
  async saveModel(symbol: string, timeframe: string, model: MmxmModel): Promise<string | null> {
    const row = {
      symbol,
      timeframe,
      model_type: model.type,
      direction: model.direction,
      phase: model.phase,
      entry_stage: model.entryStage,
      consolidation_high: model.consolidation.high,
      consolidation_low: model.consolidation.low,
      consolidation_start_at: iso(model.consolidation.startTime),
      consolidation_end_at: iso(model.consolidation.endTime),
      engineered_side: model.consolidation.engineeredSide,
      engineered_touches: model.consolidation.engineeredTouches,
      left_curve_extreme: model.leftCurveExtremePrice,
      smr_at: model.smr ? iso(model.smr.time) : null,
      smr_price: model.smr?.price ?? null,
      smr_confidence: model.smr?.confidence ?? null,
      smr_components: model.smr?.components ?? null,
      right_curve_legs: model.rightCurveLegs,
      target_level: model.targetLevel,
      invalidation_level: model.invalidationLevel,
      confidence: model.confidence,
      notes: model.notes,
    };

    const { data, error } = await this.db
      .from('mmxm_models')
      .upsert(row, { onConflict: 'symbol,timeframe,consolidation_start_at,model_type' })
      .select('id')
      .single();

    if (error) throw new Error(`saveModel(${symbol}): ${error.message}`);
    return (data as { id: string } | null)?.id ?? null;
  }

  async saveSmtEvents(events: SmtEvent[]): Promise<number> {
    if (events.length === 0) return 0;

    const rows = events.map((e) => ({
      primary_symbol: e.primary,
      reference_symbol: e.reference,
      correlation: e.correlation,
      direction: e.direction,
      formed_at: e.at,
      degree: e.degree,
      weak_side: e.weakSide,
      strength: e.strength,
      occurred_at: iso(e.time),
      primary_price: e.primaryPrice,
      reference_price: e.referencePrice,
      description: e.description,
    }));

    const { error } = await this.db
      .from('smt_events')
      .upsert(rows, { onConflict: 'primary_symbol,reference_symbol,occurred_at,formed_at' });
    if (error) throw new Error(`saveSmtEvents: ${error.message}`);
    return rows.length;
  }

  /** Grava um sinal. Devolve false se ja existia (evita notificar duas vezes). */
  async saveSignal(signal: TradeSignal, modelId: string | null, mode: 'paper' | 'live'): Promise<boolean> {
    const { data: existing } = await this.db
      .from('signals')
      .select('id')
      .eq('id', signal.id)
      .maybeSingle();

    const row = {
      id: signal.id,
      symbol: signal.symbol,
      timeframe: signal.timeframe,
      kind: signal.kind,
      direction: signal.direction,
      status: signal.status,
      mode,
      generated_at: iso(signal.generatedAt),
      reference_price: signal.referencePrice,
      entry_zone_low: signal.entryZoneLow,
      entry_zone_high: signal.entryZoneHigh,
      entry_price: signal.entryPrice,
      stop_loss: signal.stopLoss,
      targets: signal.targets,
      max_r_multiple: signal.maxRMultiple,
      position_units: signal.positionSize?.units ?? null,
      position_notional: signal.positionSize?.notional ?? null,
      risk_amount: signal.positionSize?.riskAmount ?? null,
      model_id: modelId,
      entry_stage: signal.entryStage,
      entry_pattern_kind: signal.entryPattern?.kind ?? null,
      entry_pattern_quality: signal.entryPattern?.quality ?? null,
      consolidation_high: signal.model.consolidation.high,
      consolidation_low: signal.model.consolidation.low,
      checklist: signal.checklist,
      checklist_score: signal.checklist.score,
      confidence: signal.confidence,
      expected_horizon_days: signal.expectedHorizonDays,
      narrative: signal.narrative,
      warnings: signal.warnings,
      updated_at: new Date().toISOString(),
    };

    const { error } = await this.db.from('signals').upsert(row, { onConflict: 'id' });
    if (error) throw new Error(`saveSignal(${signal.id}): ${error.message}`);

    return existing === null;
  }

  async updateSignalStatus(signalId: string, status: string): Promise<void> {
    const { error } = await this.db
      .from('signals')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', signalId);
    if (error) throw new Error(`updateSignalStatus(${signalId}): ${error.message}`);
  }

  /**
   * Abre uma posicao (paper), CONGELANDO o plano de saida.
   *
   * Recebe o plano EXPLICITO em vez de um `TradeSignal`. Isto permite abrir
   * tanto a partir de um sinal acabado de gerar como a partir de uma linha lida
   * da base de dados, sem forcar tipos nem reconstruir o modelo MMXM inteiro so
   * para gravar meia duzia de numeros.
   */
  async openPosition(input: OpenPositionInput): Promise<string> {
    const { data, error } = await this.db
      .from('positions')
      .insert({
        signal_id: input.signalId,
        symbol: input.symbol,
        direction: input.direction,
        mode: input.mode,
        opened_at: iso(input.openedAt),
        filled_price: input.filledPrice,
        initial_units: input.units,
        remaining_fraction: 1,
        current_stop: input.stopLoss,
        hit_targets: [],
        status: 'open',
        entry_price: input.entryPrice,
        initial_stop: input.stopLoss,
        targets: input.targets,
        consolidation_high: input.consolidationHigh,
        consolidation_low: input.consolidationLow,
        expected_horizon_days: input.expectedHorizonDays,
        max_r_multiple: input.maxRMultiple,
        last_price: input.filledPrice,
      })
      .select('id')
      .single();

    if (error) throw new Error(`openPosition(${input.signalId}): ${error.message}`);
    return (data as { id: string }).id;
  }

  /** Marca a preco de mercado uma posicao que nao teve saida. */
  async updatePositionMark(
    positionId: string,
    mark: { lastPrice: number; unrealizedR: number; evaluatedAt: number },
  ): Promise<void> {
    const { error } = await this.db
      .from('positions')
      .update({
        last_price: mark.lastPrice,
        unrealized_r: mark.unrealizedR,
        last_evaluated_at: iso(mark.evaluatedAt),
        updated_at: new Date().toISOString(),
      })
      .eq('id', positionId);
    if (error) throw new Error(`updatePositionMark(${positionId}): ${error.message}`);
  }

  /** Sinais emitidos ainda a aguardar preenchimento. */
  async listPendingSignals(): Promise<PendingSignalRow[]> {
    const { data, error } = await this.db
      .from('signals')
      .select('*')
      .eq('status', 'pending')
      .order('generated_at', { ascending: true });
    if (error) throw new Error(`listPendingSignals: ${error.message}`);
    return (data ?? []) as PendingSignalRow[];
  }

  /** Posicoes abertas com o plano de saida ja congelado. */
  async listOpenPositionsWithPlan(): Promise<StoredPosition[]> {
    const { data, error } = await this.db
      .from('positions')
      .select('*')
      .in('status', ['open', 'partial']);
    if (error) throw new Error(`listOpenPositionsWithPlan: ${error.message}`);

    return (data ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: String(row['id']),
        signalId: String(row['signal_id']),
        symbol: String(row['symbol']),
        direction: row['direction'] as 'bullish' | 'bearish',
        openedAt: Date.parse(String(row['opened_at'])),
        filledPrice: Number(row['filled_price']),
        entryPrice: Number(row['entry_price'] ?? row['filled_price']),
        initialStop: Number(row['initial_stop'] ?? row['current_stop']),
        currentStop: Number(row['current_stop']),
        remainingFraction: Number(row['remaining_fraction']),
        hitTargets: (row['hit_targets'] as number[]) ?? [],
        targets: (row['targets'] as StoredPosition['targets']) ?? [],
        consolidationHigh: Number(row['consolidation_high'] ?? 0),
        consolidationLow: Number(row['consolidation_low'] ?? 0),
        expectedHorizonDays: Number(row['expected_horizon_days'] ?? 21),
        realizedR: Number(row['realized_r'] ?? 0),
        initialUnits: Number(row['initial_units'] ?? 0),
      };
    });
  }

  /** Marca sinais que nunca chegaram a ser preenchidos. */
  async expireSignal(signalId: string): Promise<void> {
    await this.updateSignalStatus(signalId, 'expired');
  }

  async recordExit(positionId: string, exit: ExitSignal): Promise<void> {
    const { error: eventError } = await this.db.from('position_events').insert({
      position_id: positionId,
      reason: exit.reason,
      close_fraction: exit.closeFraction,
      price: exit.price,
      r_multiple: exit.rMultipleRealized,
      new_stop_loss: exit.newStopLoss,
      narrative: exit.narrative,
      occurred_at: iso(exit.time),
    });
    if (eventError) throw new Error(`recordExit: ${eventError.message}`);
  }

  async updatePosition(
    positionId: string,
    patch: {
      remainingFraction?: number;
      currentStop?: number;
      hitTargets?: number[];
      realizedR?: number;
      status?: string;
      closeReason?: string;
      closedAt?: number;
    },
  ): Promise<void> {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.remainingFraction !== undefined) row['remaining_fraction'] = patch.remainingFraction;
    if (patch.currentStop !== undefined) row['current_stop'] = patch.currentStop;
    if (patch.hitTargets !== undefined) row['hit_targets'] = patch.hitTargets;
    if (patch.realizedR !== undefined) row['realized_r'] = patch.realizedR;
    if (patch.status !== undefined) row['status'] = patch.status;
    if (patch.closeReason !== undefined) row['close_reason'] = patch.closeReason;
    if (patch.closedAt !== undefined) row['closed_at'] = iso(patch.closedAt);

    const { error } = await this.db.from('positions').update(row).eq('id', positionId);
    if (error) throw new Error(`updatePosition(${positionId}): ${error.message}`);
  }

  async listOpenPositions(): Promise<Array<Record<string, unknown>>> {
    const { data, error } = await this.db
      .from('positions')
      .select('*, signals(*)')
      .in('status', ['open', 'partial']);
    if (error) throw new Error(`listOpenPositions: ${error.message}`);
    return (data ?? []) as Array<Record<string, unknown>>;
  }

  /** Grava o diagnostico de um varrimento — inclusive quando nao houve sinal. */
  async saveDiagnostics(
    scanId: string,
    rows: Array<{
      symbol: string;
      timeframe: string;
      htfOrderFlow: string;
      modelType: string | null;
      modelPhase: string | null;
      checklistScore: number;
      failedAtStep: number | null;
      smtCount: number;
      summary: string;
    }>,
  ): Promise<void> {
    if (rows.length === 0) return;
    const { error } = await this.db.from('scan_diagnostics').insert(
      rows.map((r) => ({
        scan_id: scanId,
        symbol: r.symbol,
        timeframe: r.timeframe,
        htf_order_flow: r.htfOrderFlow,
        model_type: r.modelType,
        model_phase: r.modelPhase,
        checklist_score: r.checklistScore,
        failed_at_step: r.failedAtStep,
        smt_count: r.smtCount,
        summary: r.summary,
      })),
    );
    if (error) throw new Error(`saveDiagnostics: ${error.message}`);
  }

  async saveProviderHealth(
    health: Array<{
      providerId: string;
      ok: boolean;
      latencyMs: number | null;
      lastSuccessAt: number | null;
      lastErrorAt: number | null;
      lastError: string | null;
      consecutiveFailures: number;
    }>,
  ): Promise<void> {
    if (health.length === 0) return;
    const { error } = await this.db.from('provider_health').upsert(
      health.map((h) => ({
        provider_id: h.providerId,
        ok: h.ok,
        latency_ms: h.latencyMs,
        last_success_at: h.lastSuccessAt ? iso(h.lastSuccessAt) : null,
        last_error_at: h.lastErrorAt ? iso(h.lastErrorAt) : null,
        last_error: h.lastError,
        consecutive_failures: h.consecutiveFailures,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: 'provider_id' },
    );
    if (error) throw new Error(`saveProviderHealth: ${error.message}`);
  }

  /**
   * Regista uma notificacao de forma idempotente.
   * Devolve false se `eventKey` ja tinha sido enviado naquele canal — e assim
   * que evitamos repetir o mesmo alerta no Telegram a cada varrimento.
   */
  async claimNotification(
    channel: 'telegram' | 'n8n' | 'webhook',
    eventKey: string,
    signalId: string | null,
    payload: unknown,
  ): Promise<boolean> {
    const { error } = await this.db.from('notifications').insert({
      channel,
      event_key: eventKey,
      signal_id: signalId,
      payload: payload as Record<string, unknown>,
      delivered: false,
    });

    // 23505 = unique_violation: ja existe, logo ja foi reclamado antes.
    if (error) {
      if (error.code === '23505') return false;
      throw new Error(`claimNotification: ${error.message}`);
    }
    return true;
  }

  async markNotificationDelivered(
    channel: string,
    eventKey: string,
    error?: string,
  ): Promise<void> {
    await this.db
      .from('notifications')
      .update({ delivered: !error, error: error ?? null })
      .eq('channel', channel)
      .eq('event_key', eventKey);
  }

  async saveEquitySnapshot(snapshot: {
    mode: string;
    balance: number;
    openRisk: number;
    openPositions: number;
    realizedPnl: number;
    unrealizedPnl: number;
  }): Promise<void> {
    const { error } = await this.db.from('equity_snapshots').insert({
      mode: snapshot.mode,
      balance: snapshot.balance,
      open_risk: snapshot.openRisk,
      open_positions: snapshot.openPositions,
      realized_pnl: snapshot.realizedPnl,
      unrealized_pnl: snapshot.unrealizedPnl,
    });
    if (error && error.code !== '23505') throw new Error(`saveEquitySnapshot: ${error.message}`);
  }
}
