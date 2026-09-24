// @ts-nocheck
/**
 * Ciclo de vida das posições (paper).
 *
 * Sem este módulo o sistema emitia sinais de entrada e nunca mais olhava para
 * eles. Aqui fecha-se o ciclo:
 *
 *   sinal pendente → preço toca a zona → posição aberta
 *   posição aberta → avaliar saídas a cada varrimento → parciais / fecho
 *   sinal pendente que nunca foi tocado → expira
 *
 * Corre DEPOIS da análise, reutilizando as velas já carregadas — não faz uma
 * única chamada de rede extra.
 *
 * Nota sobre preenchimento: uma zona é considerada tocada quando o intervalo
 * [low, high] de uma vela POSTERIOR ao sinal a intersecta, e o preenchimento é
 * assumido ao pior preço da zona. Assumir o melhor preço inflacionaria todos os
 * resultados de paper trading e tornaria a comparação com o backtest inútil.
 */

import {
  applyExit,
  evaluateExits,
  type CandleSeries,
  type ExitPlan,
  type ExitSignal,
  type OpenPosition,
  type SmtEvent,
} from '@trading/core';
import type { PendingSignalRow, StoredPosition, TradingRepository } from '@trading/db';
import { broadcastExit } from '@trading/notify';
import type { EngineConfig } from '../config.js';

export interface PositionReport {
  filled: Array<{ signalId: string; symbol: string; price: number }>;
  expired: string[];
  exits: ExitSignal[];
  closed: string[];
  errors: string[];
}

export interface ManagePositionsInput {
  config: EngineConfig;
  repo: TradingRepository;
  /** Séries já carregadas pelo varrimento, indexadas por símbolo. */
  series: Map<string, CandleSeries>;
  /** SMT corrente por símbolo, para a saída por reversão de divergência. */
  smtBySymbol: Map<string, SmtEvent[]>;
  now?: number;
}

export async function managePositions(input: ManagePositionsInput): Promise<PositionReport> {
  const report: PositionReport = { filled: [], expired: [], exits: [], closed: [], errors: [] };
  const now = input.now ?? Date.now();

  await fillPendingSignals(input, report, now);
  await processOpenPositions(input, report, now);
  await snapshotEquity(input, report);

  return report;
}

// ---------------------------------------------------------------------------
// 1. Preenchimento de ordens pendentes
// ---------------------------------------------------------------------------

async function fillPendingSignals(
  input: ManagePositionsInput,
  report: PositionReport,
  now: number,
): Promise<void> {
  let pending: PendingSignalRow[];
  try {
    pending = await input.repo.listPendingSignals();
  } catch (err) {
    report.errors.push(`listPendingSignals: ${message(err)}`);
    return;
  }

  for (const signal of pending) {
    const series = input.series.get(signal.symbol);
    if (!series) continue;

    const signalTime = Date.parse(signal.generated_at);
    // Só velas POSTERIORES à do sinal: na vela do sinal a decisão já foi tomada
    // com ela fechada, por isso não pode servir de preenchimento.
    const after = series.candles.filter((c) => c.time > signalTime);

    const maxBars = signal.expires_after_bars ?? 15;

    const touchIndex = after.findIndex(
      (c) => c.low <= signal.entry_zone_high && c.high >= signal.entry_zone_low,
    );

    if (touchIndex >= 0) {
      const candle = after[touchIndex]!;
      // Pior preço da zona: numa compra assume-se o topo, numa venda o fundo.
      const fillPrice =
        signal.direction === 'bullish'
          ? Math.min(signal.entry_zone_high, Math.max(signal.entry_zone_low, candle.high))
          : Math.max(signal.entry_zone_low, Math.min(signal.entry_zone_high, candle.low));

      try {
        await input.repo.openPosition({
          signalId: signal.id,
          symbol: signal.symbol,
          direction: signal.direction,
          mode: input.config.mode,
          openedAt: candle.time,
          filledPrice: fillPrice,
          units: signal.position_units ?? 0,
          entryPrice: signal.entry_price,
          stopLoss: signal.stop_loss,
          targets: signal.targets,
          consolidationHigh: signal.consolidation_high ?? 0,
          consolidationLow: signal.consolidation_low ?? 0,
          expectedHorizonDays: signal.expected_horizon_days ?? 21,
          maxRMultiple: signal.max_r_multiple,
        });
        await input.repo.updateSignalStatus(signal.id, 'active');
        report.filled.push({ signalId: signal.id, symbol: signal.symbol, price: fillPrice });
      } catch (err) {
        report.errors.push(`openPosition(${signal.id}): ${message(err)}`);
      }
      continue;
    }

    if (after.length > maxBars) {
      try {
        await input.repo.expireSignal(signal.id);
        report.expired.push(signal.id);
      } catch (err) {
        report.errors.push(`expireSignal(${signal.id}): ${message(err)}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Gestão das posições abertas
// ---------------------------------------------------------------------------

async function processOpenPositions(
  input: ManagePositionsInput,
  report: PositionReport,
  now: number,
): Promise<void> {
  let positions: StoredPosition[];
  try {
    positions = await input.repo.listOpenPositionsWithPlan();
  } catch (err) {
    report.errors.push(`listOpenPositionsWithPlan: ${message(err)}`);
    return;
  }

  for (const stored of positions) {
    const series = input.series.get(stored.symbol);
    if (!series) continue;

    const plan: ExitPlan = {
      signalId: stored.signalId,
      symbol: stored.symbol,
      direction: stored.direction,
      entryPrice: stored.entryPrice,
      stopLoss: stored.initialStop,
      targets: stored.targets,
      consolidationHigh: stored.consolidationHigh,
      consolidationLow: stored.consolidationLow,
      expectedHorizonDays: stored.expectedHorizonDays,
    };

    let position: OpenPosition = {
      plan,
      filledPrice: stored.filledPrice,
      remainingFraction: stored.remainingFraction,
      currentStop: stored.currentStop,
      hitTargets: stored.hitTargets,
      openedAt: stored.openedAt,
    };

    const exits = evaluateExits({
      position,
      series,
      currentSmt: input.smtBySymbol.get(stored.symbol) ?? [],
      now,
    });

    if (exits.length === 0) {
      await touchUnrealized(input, stored, series, report);
      continue;
    }

    let realizedR = stored.realizedR;

    for (const exit of exits) {
      try {
        await input.repo.recordExit(stored.id, exit);
        realizedR += exit.rMultipleRealized * exit.closeFraction;
        position = applyExit(position, exit);
        report.exits.push(exit);

        const outcomes = await broadcastExit(exit);
        for (const o of outcomes) {
          if (!o.ok && !o.skipped) report.errors.push(`notificação ${o.channel}: ${o.error}`);
        }
      } catch (err) {
        report.errors.push(`recordExit(${stored.id}): ${message(err)}`);
      }
    }

    const closed = position.remainingFraction <= 0.001;

    try {
      await input.repo.updatePosition(stored.id, {
        remainingFraction: position.remainingFraction,
        currentStop: position.currentStop,
        hitTargets: position.hitTargets,
        realizedR,
        status: closed ? (exits.some((e) => e.reason === 'stop-hit') ? 'stopped' : 'closed') : 'partial',
        ...(closed
          ? {
              closeReason: exits[exits.length - 1]?.reason,
              closedAt: now,
            }
          : {}),
      });

      if (closed) {
        report.closed.push(stored.id);
        await input.repo.updateSignalStatus(
          stored.signalId,
          exits.some((e) => e.reason === 'stop-hit') ? 'closed-stop' : 'closed-target',
        );
      }
    } catch (err) {
      report.errors.push(`updatePosition(${stored.id}): ${message(err)}`);
    }
  }
}

/** Atualiza o R não realizado de uma posição que não teve saída neste varrimento. */
async function touchUnrealized(
  input: ManagePositionsInput,
  stored: StoredPosition,
  series: CandleSeries,
  report: PositionReport,
): Promise<void> {
  const last = series.candles[series.candles.length - 1];
  if (!last) return;

  const risk = Math.abs(stored.entryPrice - stored.initialStop);
  const unrealized =
    risk > 0
      ? stored.direction === 'bullish'
        ? (last.close - stored.filledPrice) / risk
        : (stored.filledPrice - last.close) / risk
      : 0;

  try {
    await input.repo.updatePositionMark(stored.id, {
      lastPrice: last.close,
      unrealizedR: unrealized * stored.remainingFraction,
      evaluatedAt: last.time,
    });
  } catch (err) {
    report.errors.push(`updatePositionMark(${stored.id}): ${message(err)}`);
  }
}

// ---------------------------------------------------------------------------
// 3. Snapshot da curva de capital
// ---------------------------------------------------------------------------

async function snapshotEquity(input: ManagePositionsInput, report: PositionReport): Promise<void> {
  try {
    const positions = await input.repo.listOpenPositionsWithPlan();
    const balance = input.config.risk.accountBalance;
    const riskPerTrade = balance * (input.config.risk.riskPercentPerTrade / 100);

    await input.repo.saveEquitySnapshot({
      mode: input.config.mode,
      balance,
      openRisk: positions.length * riskPerTrade,
      openPositions: positions.length,
      realizedPnl: 0,
      unrealizedPnl: 0,
    });
  } catch (err) {
    report.errors.push(`snapshotEquity: ${message(err)}`);
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Resumo textual da gestão de posições, para o log do varrimento. */
export function formatPositionReport(report: PositionReport): string {
  const parts: string[] = [];
  if (report.filled.length > 0) {
    parts.push(
      `preenchidos: ${report.filled.map((f) => `${f.symbol}@${f.price.toFixed(5)}`).join(', ')}`,
    );
  }
  if (report.exits.length > 0) {
    parts.push(
      `saídas: ${report.exits.map((e) => `${e.symbol}/${e.reason} ${e.rMultipleRealized >= 0 ? '+' : ''}${e.rMultipleRealized.toFixed(2)}R`).join(', ')}`,
    );
  }
  if (report.expired.length > 0) parts.push(`expirados: ${report.expired.length}`);
  if (report.closed.length > 0) parts.push(`fechados: ${report.closed.length}`);
  return parts.length > 0 ? parts.join(' | ') : 'sem alterações em posições';
}
