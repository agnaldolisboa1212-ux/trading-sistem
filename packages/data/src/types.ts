/**
 * Contrato que qualquer fonte de dados tem de cumprir para alimentar o motor.
 *
 * A ideia e que o motor NUNCA saiba de onde veio a vela. Ele pede
 * `getCandles('EURUSD', '1d', 500)` ao registry e recebe uma serie normalizada,
 * independentemente de ter vindo do Yahoo, do Binance ou do Frankfurter.
 */

import type { Candle, CandleSeries, Timeframe } from '@trading/core';

// A avaliacao de qualidade vive no core: e uma regra de dominio, nao de transporte.
export { assessOhlcQuality, type OhlcQuality } from '@trading/core';
import type { CatalogAssetClass, Capability } from './catalog.js';

export interface CandleRequest {
  /** Simbolo CANONICO interno (ex.: 'EURUSD', 'NQ', 'XAUUSD', 'BTCUSD'). */
  symbol: string;
  timeframe: Timeframe;
  /** Quantas velas fechadas se pretende, contando para tras a partir de agora. */
  limit: number;
  /** Limite inferior opcional, em ms UTC. */
  since?: number;
  /**
   * Manter a vela AINDA EM FORMACAO no fim da serie.
   *
   * Por omissao ela e descartada: CISD, MSS e displacement dependem de
   * fechamentos, e uma vela viva produziria estrutura que desaparece na vela
   * seguinte. Ativar isto serve APENAS para visualizacao — quem consome tem de
   * a excluir antes de analisar.
   */
  includeForming?: boolean;
}

export interface ProviderHealth {
  providerId: string;
  ok: boolean;
  /** Latencia da ultima chamada bem sucedida, em ms. */
  latencyMs: number | null;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  /** Falhas consecutivas. Usado para abrir o circuit breaker. */
  consecutiveFailures: number;
}

export interface DataProvider {
  /** Deve coincidir com o campo `adapter` da entrada correspondente no catalogo. */
  readonly id: string;
  /** Id da entrada no catalogo (`CatalogEntry.id`), para rastrear a origem. */
  readonly catalogId: string;
  readonly capabilities: readonly Capability[];
  readonly assetClasses: readonly CatalogAssetClass[];
  /** Se precisa de chave e se ela esta configurada no ambiente. */
  readonly requiresKey: boolean;
  /** Chamadas por minuto que a fonte tolera. O registry respeita este limite. */
  readonly rateLimitPerMinute: number;
  /**
   * Qualidade do OHLC devolvido.
   *
   * 'true-ohlc'  — abertura, maxima, minima e fecho reais.
   * 'synthetic'  — a fonte so da uma cotacao por periodo e o adapter preenche
   *                O=H=L=C. Serve para verificar preco, mas o motor MMXM
   *                RECUSA estas series: sem pavios nao ha FVG, swing point nem
   *                displacement validos.
   */
  readonly ohlcFidelity: 'true-ohlc' | 'synthetic';

  /** True se o provider esta utilizavel agora (chave presente, etc.). */
  isConfigured(): boolean;

  /** True se este provider consegue servir o simbolo/timeframe pedidos. */
  supports(request: CandleRequest): boolean;

  /** Busca velas FECHADAS, ordem cronologica crescente. */
  getCandles(request: CandleRequest): Promise<CandleSeries>;
}

/** Erro tipado para distinguir falhas recuperaveis de definitivas. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly providerId: string,
    /** True quando vale a pena tentar outro provider ou repetir mais tarde. */
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/**
 * Inverte uma serie de precos (p -> 1/p).
 *
 * A maxima e a minima TROCAM: se o preco maximo de CHF/USD foi 1.25, o preco
 * minimo de USD/CHF nesse periodo foi 1/1.25 = 0.80. Esquecer esta troca produz
 * velas com high < low, que o `normalizeCandles` descartaria silenciosamente.
 */
export function invertCandles(candles: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    if (c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) continue;
    out.push({
      time: c.time,
      open: 1 / c.open,
      high: 1 / c.low,
      low: 1 / c.high,
      close: 1 / c.close,
      volume: c.volume,
    });
  }
  return out;
}

/** Ordena por tempo e remove duplicados pelo timestamp de abertura. */
export function normalizeCandles(candles: Candle[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const c of candles) {
    if (!Number.isFinite(c.time)) continue;
    if (!Number.isFinite(c.open) || !Number.isFinite(c.high)) continue;
    if (!Number.isFinite(c.low) || !Number.isFinite(c.close)) continue;
    // high/low incoerentes indicam dado corrompido na fonte.
    if (c.high < c.low) continue;
    byTime.set(c.time, c);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/**
 * Remove a ultima vela se ela ainda nao fechou.
 *
 * Critico para o MMXM: CISD, MSS e displacement dependem de FECHAMENTOS. Uma
 * vela em formacao produziria sinais que desaparecem no candle seguinte.
 */
export function dropUnclosedCandle(
  candles: Candle[],
  timeframe: Timeframe,
  now = Date.now(),
): Candle[] {
  const last = candles[candles.length - 1];
  if (!last) return candles;
  const durations: Record<Timeframe, number> = {
    '1m': 60_000,
    '5m': 300_000,
    '15m': 900_000,
    '30m': 1_800_000,
    '1h': 3_600_000,
    '4h': 14_400_000,
    '1d': 86_400_000,
    '1w': 604_800_000,
    '1M': 2_592_000_000,
  };
  const closesAt = last.time + durations[timeframe];
  return now < closesAt ? candles.slice(0, -1) : candles;
}
