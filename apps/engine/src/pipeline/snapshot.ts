// @ts-nocheck
/**
 * Snapshot local do varrimento em JSON.
 *
 * Existe para que o sistema seja utilizavel em localhost sem infraestrutura
 * nenhuma. O Supabase continua a ser o registo historico e auditavel; este
 * ficheiro e apenas a fotografia do ULTIMO varrimento, que o dashboard le
 * quando nao ha base de dados configurada.
 *
 * Deliberadamente nao acumula historico: para isso existe o Supabase. Um
 * ficheiro que crescesse indefinidamente acabaria por ser lido inteiro a cada
 * pedido do dashboard.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { dirDados } from './estado.js';
import type { TradeSignal } from '@trading/core';
import type { ProviderHealth } from '@trading/data';
import type { EngineConfig } from '../config.js';
import type { ScanReport } from './scan.js';

/** Caminho do snapshot. O dashboard le exatamente este ficheiro. */
export function snapshotPath(): string {
  return process.env['SNAPSHOT_PATH']
    ? resolve(process.env['SNAPSHOT_PATH'])
    : join(dirDados(), 'latest-scan.json');
}

export interface ScanSnapshot {
  scanId: string;
  scannedAt: string;
  durationMs: number;
  mode: string;
  timeframe: string;
  higherTimeframe: string;
  symbolsAnalyzed: number;
  signalsGenerated: number;
  signals: Array<Record<string, unknown>>;
  diagnostics: Array<Record<string, unknown>>;
  providerHealth: Array<Record<string, unknown>>;
  errors: string[];
}

export function buildSnapshot(
  report: ScanReport,
  config: EngineConfig,
  health: ProviderHealth[],
): ScanSnapshot {
  return {
    scanId: report.scanId,
    scannedAt: new Date(report.startedAt).toISOString(),
    durationMs: report.finishedAt - report.startedAt,
    mode: config.mode,
    timeframe: config.timeframe,
    higherTimeframe: config.higherTimeframe,
    symbolsAnalyzed: report.symbolsAnalyzed,
    signalsGenerated: report.signalsGenerated,
    signals: report.newSignals.map(serializeSignal),
    diagnostics: report.results.map((r) => ({
      symbol: r.symbol,
      timeframe: r.timeframe,
      htf_order_flow: r.diagnostics.htfOrderFlow,
      model_type: r.diagnostics.modelType,
      model_phase: r.diagnostics.modelPhase,
      checklist_score: r.diagnostics.checklistScore,
      failed_at_step: r.diagnostics.failedAtStep,
      smt_count: r.diagnostics.smtCount,
      summary: r.diagnostics.summary,
      scanned_at: new Date(report.startedAt).toISOString(),
    })),
    providerHealth: health.map((h) => ({
      provider_id: h.providerId,
      ok: h.ok,
      latency_ms: h.latencyMs,
      last_success_at: h.lastSuccessAt ? new Date(h.lastSuccessAt).toISOString() : null,
      last_error: h.lastError,
      consecutive_failures: h.consecutiveFailures,
    })),
    errors: report.errors.slice(0, 40),
  };
}

/**
 * Serializa um sinal com os MESMOS nomes de campo que as colunas do Supabase.
 *
 * Assim o dashboard usa exatamente o mesmo componente de renderizacao, venham
 * os dados da base de dados ou do ficheiro — sem ramificacoes na camada visual.
 */
function serializeSignal(signal: TradeSignal): Record<string, unknown> {
  return {
    id: signal.id,
    symbol: signal.symbol,
    timeframe: signal.timeframe,
    direction: signal.direction,
    status: signal.status,
    mode: 'paper',
    generated_at: new Date(signal.generatedAt).toISOString(),
    entry_price: signal.entryPrice,
    entry_zone_low: signal.entryZoneLow,
    entry_zone_high: signal.entryZoneHigh,
    stop_loss: signal.stopLoss,
    max_r_multiple: signal.maxRMultiple,
    confidence: signal.confidence,
    checklist_score: signal.checklist.score,
    entry_stage: signal.entryStage,
    entry_pattern_kind: signal.entryPattern?.kind ?? null,
    expected_horizon_days: signal.expectedHorizonDays,
    narrative: signal.narrative,
    targets: signal.targets,
    checklist: signal.checklist,
    warnings: signal.warnings,
  };
}

export function writeSnapshot(snapshot: ScanSnapshot): string {
  const path = snapshotPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(snapshot, null, 2), 'utf-8');
  return path;
}
