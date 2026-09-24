// @ts-nocheck
/**
 * Varrimento completo: carrega dados, analisa cada instrumento, persiste e
 * notifica.
 *
 * Desenho deliberado: o varrimento NUNCA aborta por causa de um instrumento.
 * Uma falha em EURUSD nao pode impedir a analise de BTCUSD — cada simbolo e
 * isolado e as falhas sao acumuladas e reportadas no fim.
 */

import {
  allRequiredSymbols,
  analyzeInstrument,
  getInstrument,
  INSTRUMENTS,
  requiredSymbolsFor,
  smtPairsFor,
  type AnalyzeResult,
  type CandleSeries,
  type SmtEvent,
  type TradeSignal,
} from '@trading/core';
import { ProviderRegistry } from '@trading/data';
import { isDbConfigured, createDbClient, TradingRepository } from '@trading/db';
import { broadcastEntry, isN8nConfigured, isTelegramConfigured, sendToN8n } from '@trading/notify';
import { randomUUID } from 'node:crypto';
import type { EngineConfig } from '../config.js';
import { formatPositionReport, managePositions, type PositionReport } from './positions.js';
import { buildSnapshot, writeSnapshot } from './snapshot.js';

export interface ScanReport {
  scanId: string;
  startedAt: number;
  finishedAt: number;
  symbolsAnalyzed: number;
  signalsGenerated: number;
  newSignals: TradeSignal[];
  results: AnalyzeResult[];
  dataFailures: Map<string, string>;
  /** Ciclo de vida das posicoes: preenchimentos, saidas e fechos. */
  positions: PositionReport | null;
  errors: string[];
}

export async function runScan(config: EngineConfig): Promise<ScanReport> {
  const scanId = randomUUID();
  const startedAt = Date.now();
  const errors: string[] = [];

  const registry = new ProviderRegistry();

  const targets =
    config.symbols.length > 0
      ? config.symbols.filter((s) => getInstrument(s) !== undefined)
      : INSTRUMENTS.map((i) => i.symbol);

  if (config.symbols.length > 0) {
    const unknown = config.symbols.filter((s) => getInstrument(s) === undefined);
    if (unknown.length > 0) {
      errors.push(`Simbolos desconhecidos ignorados: ${unknown.join(', ')}`);
    }
  }

  /*
   * Carrega TODOS os simbolos necessarios de uma vez — incluindo as referencias
   * de SMT, que muitas vezes nao estao na lista de alvos. Buscar uma unica vez e
   * partilhar as series entre instrumentos evita dezenas de pedidos repetidos ao
   * mesmo endpoint.
   */
  const needed = new Set<string>();
  for (const symbol of targets) {
    for (const s of requiredSymbolsFor(symbol)) needed.add(s);
  }
  if (config.symbols.length === 0) {
    for (const s of allRequiredSymbols()) needed.add(s);
  }

  console.log(`[scan ${scanId.slice(0, 8)}] a carregar ${needed.size} series ${config.timeframe}...`);

  const daily = await registry.getMany([...needed], config.timeframe, config.candleLimit);
  const higher = await registry.getMany(targets, config.higherTimeframe, config.higherCandleLimit);

  for (const [symbol, error] of daily.failures) {
    errors.push(`dados ${symbol} (${config.timeframe}): ${error}`);
  }
  for (const [symbol, error] of higher.failures) {
    errors.push(`dados ${symbol} (${config.higherTimeframe}): ${error}`);
  }

  // --- Analise por instrumento --------------------------------------------
  const results: AnalyzeResult[] = [];
  const newSignals: TradeSignal[] = [];

  for (const symbol of targets) {
    const primary = daily.series.get(symbol);
    const htf = higher.series.get(symbol);

    if (!primary || !htf) {
      errors.push(`${symbol}: sem series suficientes para analisar.`);
      continue;
    }

    try {
      const pairs = smtPairsFor(symbol);
      const references = new Map<string, CandleSeries>();
      for (const pair of pairs) {
        const ref = daily.series.get(pair.reference);
        if (ref) references.set(pair.reference, ref);
      }

      const result = analyzeInstrument({
        primary,
        higher: htf,
        references,
        smtPairs: pairs,
        riskConfig: config.risk,
        minRMultiple: config.minRMultiple,
        minConfidence: config.minConfidence,
      });

      results.push(result);
      if (result.signal) newSignals.push(result.signal);
    } catch (err) {
      errors.push(`${symbol}: erro de analise — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // --- Persistencia --------------------------------------------------------
  const persisted = await persist({
    scanId,
    config,
    registry,
    results,
    daily,
    errors,
  });

  // --- Ciclo de vida das posicoes ------------------------------------------
  // Depois de persistir (para os sinais novos ja estarem gravados e poderem ser
  // preenchidos ainda neste varrimento) e antes de notificar as entradas.
  let positionReport: PositionReport | null = null;
  if (isDbConfigured()) {
    try {
      const smtBySymbol = new Map<string, SmtEvent[]>();
      for (const r of results) {
        if (r.detail) smtBySymbol.set(r.symbol, r.detail.smtRelevant);
      }

      positionReport = await managePositions({
        config,
        repo: new TradingRepository(createDbClient()),
        series: daily.series,
        smtBySymbol,
      });
      errors.push(...positionReport.errors);
    } catch (err) {
      errors.push(`gestao de posicoes: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // --- Notificacao ---------------------------------------------------------
  // So notifica sinais que ainda nao tinham sido gravados: sem isto, o mesmo
  // setup seria anunciado a cada varrimento enquanto continuasse valido.
  //
  // DESLIGADO por omissao: o MMXM nao tem vantagem medida (17 operacoes em 6
  // anos, 81% do lucro num unico negocio). Os sinais so saem para o telemovel
  // das estrategias validadas; o MMXM continua a ser analisado e gravado, e
  // `MMXM_AVISOS=true` volta a liga-lo para quem o quiser acompanhar.
  const avisosMmxm = process.env['MMXM_AVISOS'] === 'true';
  for (const signal of newSignals) {
    if (!avisosMmxm) break;
    if (persisted.alreadyKnown.has(signal.id)) continue;
    try {
      const outcomes = await broadcastEntry(signal);
      for (const outcome of outcomes) {
        if (!outcome.ok && !outcome.skipped) {
          errors.push(`notificacao ${outcome.channel}: ${outcome.error ?? 'falhou'}`);
        }
      }
    } catch (err) {
      errors.push(`notificacao ${signal.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const finishedAt = Date.now();

  /*
   * Snapshot local ANTES do evento n8n: e o que torna o dashboard utilizavel em
   * localhost sem Supabase. Uma falha a escrever o ficheiro nunca pode derrubar
   * o varrimento — o resultado ja esta em memoria e ja foi notificado.
   */
  const report: ScanReport = {
    scanId,
    startedAt,
    finishedAt,
    symbolsAnalyzed: results.length,
    signalsGenerated: newSignals.length,
    newSignals,
    results,
    dataFailures: daily.failures,
    positions: positionReport,
    errors,
  };

  try {
    const path = writeSnapshot(buildSnapshot(report, config, registry.getHealth()));
    console.log(`[scan] snapshot gravado em ${path}`);
  } catch (err) {
    errors.push(`snapshot: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Evento de fim de varrimento para o n8n — permite montar um relatorio diario
  // mesmo em dias sem sinal nenhum.
  if (isN8nConfigured()) {
    await sendToN8n('scan.completed', {
      scanId,
      mode: config.mode,
      durationMs: finishedAt - startedAt,
      symbolsAnalyzed: results.length,
      signalsGenerated: newSignals.length,
      errors: errors.slice(0, 20),
      diagnostics: results.map((r) => ({
        symbol: r.symbol,
        model: r.diagnostics.modelType,
        phase: r.diagnostics.modelPhase,
        checklistScore: r.diagnostics.checklistScore,
        failedAtStep: r.diagnostics.failedAtStep,
        summary: r.diagnostics.summary,
      })),
    }).catch(() => undefined);
  }

  return report;
}

// ---------------------------------------------------------------------------

interface PersistInput {
  scanId: string;
  config: EngineConfig;
  registry: ProviderRegistry;
  results: AnalyzeResult[];
  daily: { series: Map<string, CandleSeries>; failures: Map<string, string> };
  errors: string[];
}

/**
 * Grava tudo o que o varrimento produziu.
 *
 * Se o Supabase nao estiver configurado, salta silenciosamente: o motor tem de
 * conseguir correr numa maquina limpa, sem infraestrutura, so para inspecionar
 * o que a estrategia esta a ver.
 */
async function persist(input: PersistInput): Promise<{ alreadyKnown: Set<string> }> {
  const alreadyKnown = new Set<string>();

  if (!isDbConfigured()) {
    console.log('[scan] Supabase nao configurado — a saltar persistencia.');
    return { alreadyKnown };
  }

  const repo = new TradingRepository(createDbClient());

  try {
    await repo.upsertInstruments(INSTRUMENTS);

    if (input.config.persistCandles) {
      for (const series of input.daily.series.values()) {
        await repo.saveCandles(series);
      }
    }

    await repo.saveDiagnostics(
      input.scanId,
      input.results.map((r) => ({
        symbol: r.symbol,
        timeframe: r.timeframe,
        htfOrderFlow: r.diagnostics.htfOrderFlow,
        modelType: r.diagnostics.modelType,
        modelPhase: r.diagnostics.modelPhase,
        checklistScore: r.diagnostics.checklistScore,
        failedAtStep: r.diagnostics.failedAtStep,
        smtCount: r.diagnostics.smtCount,
        summary: r.diagnostics.summary,
      })),
    );

    for (const result of input.results) {
      const signal = result.signal;
      if (!signal) continue;

      const modelId = await repo.saveModel(signal.symbol, signal.timeframe, signal.model);
      await repo.saveSmtEvents(signal.smtEvents);

      const isNew = await repo.saveSignal(signal, modelId, input.config.mode);
      if (!isNew) alreadyKnown.add(signal.id);
    }

    await repo.saveProviderHealth(input.registry.getHealth());
  } catch (err) {
    input.errors.push(`persistencia: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { alreadyKnown };
}

/** Resumo textual do varrimento, para a consola e para os logs. */
export function formatScanReport(report: ScanReport, config: EngineConfig): string {
  const lines: string[] = [];
  const seconds = ((report.finishedAt - report.startedAt) / 1000).toFixed(1);

  lines.push('='.repeat(78));
  lines.push(`VARRIMENTO ${report.scanId.slice(0, 8)}  —  ${new Date(report.startedAt).toISOString()}`);
  lines.push(
    `modo=${config.mode}  instrumentos=${report.symbolsAnalyzed}  sinais=${report.signalsGenerated}  duracao=${seconds}s`,
  );
  lines.push(
    `canais: telegram=${isTelegramConfigured() ? 'on' : 'off'}  n8n=${isN8nConfigured() ? 'on' : 'off'}  supabase=${isDbConfigured() ? 'on' : 'off'}`,
  );
  lines.push('='.repeat(78));

  // Ordena pelos que chegaram mais longe no checklist — o topo da lista sao os
  // setups a amadurecer, que e o que interessa vigiar.
  const sorted = [...report.results].sort(
    (a, b) => b.diagnostics.checklistScore - a.diagnostics.checklistScore,
  );

  for (const r of sorted) {
    const d = r.diagnostics;
    const mark = r.signal ? '>>>' : '   ';
    lines.push(
      `${mark} ${r.symbol.padEnd(8)} ${(d.modelType ?? '-').padEnd(5)} ${(d.modelPhase ?? '-').padEnd(28)} ` +
        `HTF=${d.htfOrderFlow.padEnd(8)} checklist=${(d.checklistScore * 100).toFixed(0).padStart(3)}% ` +
        `passo=${String(d.failedAtStep ?? 'ok').padStart(2)} SMT=${d.smtCount}`,
    );
  }

  if (report.newSignals.length > 0) {
    lines.push('');
    lines.push('SINAIS:');
    for (const s of report.newSignals) {
      lines.push(
        `  ${s.direction === 'bullish' ? 'COMPRA' : 'VENDA '} ${s.symbol}  entrada=${s.entryPrice.toFixed(5)}  ` +
          `stop=${s.stopLoss.toFixed(5)}  maxR=${s.maxRMultiple.toFixed(1)}  confianca=${(s.confidence * 100).toFixed(0)}%`,
      );
    }
  }

  if (report.positions) {
    lines.push('');
    lines.push(`POSICOES: ${formatPositionReport(report.positions)}`);
  }

  if (report.errors.length > 0) {
    lines.push('');
    lines.push(`AVISOS (${report.errors.length}):`);
    for (const e of report.errors.slice(0, 15)) lines.push(`  ! ${e.slice(0, 160)}`);
  }

  return lines.join('\n');
}
