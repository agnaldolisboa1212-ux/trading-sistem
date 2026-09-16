/**
 * Configuracao do motor, lida do ambiente.
 *
 * Regra de seguranca: `EXECUTION_MODE` e 'paper' por omissao e QUALQUER valor
 * que nao seja exatamente 'live' resolve para 'paper'. Um erro de digitacao
 * nunca pode transformar-se em ordens reais.
 */

import { DEFAULT_RISK, type RiskConfig } from '@trading/core';
import { lerTimeframes } from './pipeline/tempo-real-puro.js';

export type ExecutionMode = 'paper' | 'live';

export interface EngineConfig {
  mode: ExecutionMode;
  /** Timeframe de execucao onde os sinais sao procurados. */
  timeframe: '1d' | '1w';
  /** Timeframe superior usado para a narrativa. */
  higherTimeframe: '1w' | '1M';
  /** Quantas velas carregar por instrumento. */
  candleLimit: number;
  /** Quantas velas do timeframe superior carregar. */
  higherCandleLimit: number;
  risk: RiskConfig;
  /** R minimo para emitir sinal. */
  minRMultiple: number;
  /** Confianca minima para emitir sinal. */
  minConfidence: number;
  /** Simbolos a analisar. Vazio = todo o universo. */
  symbols: string[];
  /** Se deve gravar velas na base de dados (volumoso; util para backtest). */
  persistCandles: boolean;
  /** Expressao cron do varrimento agendado. */
  cron: string;
  /** Motor secundario: estrategias institucionais sobre velas intradiarias. */
  tempoReal: {
    cron: string;
    timeframes: string[];
    /** Vazio = o que os utilizadores escolheram no onboarding. */
    simbolos: string[];
    minR: number;
    minConviccao: number;
    velas: number;
  };
}

function num(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  return raw === 'true' || raw === '1';
}

export function loadConfig(): EngineConfig {
  // Qualquer coisa diferente de 'live' e paper. Falha para o lado seguro.
  const mode: ExecutionMode = process.env['EXECUTION_MODE'] === 'live' ? 'live' : 'paper';

  const symbolsRaw = process.env['SYMBOLS'] ?? '';
  const symbols = symbolsRaw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const risk: RiskConfig = {
    accountBalance: num('ACCOUNT_BALANCE', DEFAULT_RISK.accountBalance),
    riskPercentPerTrade: num('RISK_PERCENT_PER_TRADE', DEFAULT_RISK.riskPercentPerTrade),
    maxPortfolioRiskPercent: num('MAX_PORTFOLIO_RISK_PERCENT', DEFAULT_RISK.maxPortfolioRiskPercent),
    maxConcurrentPositions: num('MAX_CONCURRENT_POSITIONS', DEFAULT_RISK.maxConcurrentPositions),
  };

  return {
    mode,
    timeframe: (process.env['TIMEFRAME'] as '1d' | '1w') ?? '1d',
    higherTimeframe: (process.env['HIGHER_TIMEFRAME'] as '1w' | '1M') ?? '1w',
    candleLimit: num('CANDLE_LIMIT', 400),
    higherCandleLimit: num('HIGHER_CANDLE_LIMIT', 200),
    risk,
    minRMultiple: num('MIN_R_MULTIPLE', 3),
    minConfidence: num('MIN_CONFIDENCE', 0.6),
    symbols,
    persistCandles: bool('PERSIST_CANDLES', false),
    // Por omissao: dias uteis as 22:15 UTC, depois do fecho de Nova Iorque, para
    // que a vela diaria ja esteja fechada quando o varrimento corre.
    cron: process.env['SCAN_CRON'] ?? '15 22 * * 1-5',
    tempoReal: {
      /*
       * A cada minuto. Nao e desperdicio: o motor so pede velas a um par
       * simbolo/timeframe quando la fechou uma vela nova desde a passagem
       * anterior, por isso numa hora de 15m e 1h faz 5 pedidos por instrumento,
       * nao 120. O ganho e o atraso: no maximo um minuto entre o fecho da vela
       * e o aviso no telemovel.
       */
      cron: process.env['INTRADAY_CRON'] ?? '* * * * *',
      timeframes: lerTimeframes(process.env['INTRADAY_TIMEFRAMES'], ['15m', '1h']),
      simbolos: (process.env['INTRADAY_SYMBOLS'] ?? '')
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
      minR: num('INTRADAY_MIN_R', 2),
      minConviccao: num('INTRADAY_MIN_CONVICTION', 0.5),
      velas: num('INTRADAY_CANDLES', 300),
    },
  };
}

/** Resumo legivel da configuracao, para o arranque. */
export function describeConfig(config: EngineConfig): string {
  return [
    `modo=${config.mode}`,
    `timeframe=${config.timeframe} (HTF ${config.higherTimeframe})`,
    `saldo=${config.risk.accountBalance}`,
    `risco/op=${config.risk.riskPercentPerTrade}%`,
    `minR=${config.minRMultiple}`,
    `minConfianca=${(config.minConfidence * 100).toFixed(0)}%`,
    `simbolos=${config.symbols.length > 0 ? config.symbols.join(',') : 'universo completo'}`,
  ].join(' | ');
}
