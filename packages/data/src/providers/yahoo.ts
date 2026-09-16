/**
 * Yahoo Finance — endpoint publico de charts.
 *
 * Fonte PRIMARIA do sistema: e a unica gratuita e sem chave que cobre, com OHLC
 * real, as quatro classes de que precisamos (forex, futuros de indices, metais
 * e cripto) — incluindo o DXY (DX-Y.NYB), que quase nenhuma fonte gratuita tem.
 *
 * Endpoint nao oficial. Pode mudar sem aviso; por isso o registry tem failover
 * para Twelve Data e Polygon, e o health-check marca a fonte como degradada
 * assim que o formato deixar de bater certo.
 */

import type { CandleSeries } from '@trading/core';
import { fetchJson } from '../http.js';
import { isInvertedSymbol, symbolsCoveredBy, toProviderSymbol } from '../symbols/mapping.js';
import {
  dropUnclosedCandle,
  invertCandles,
  normalizeCandles,
  ProviderError,
  type CandleRequest,
  type DataProvider,
} from '../types.js';

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

/** Timeframe canonico -> parametro `interval` do Yahoo. */
const INTERVAL: Record<string, string> = {
  '1h': '1h',
  '4h': '1h', // o Yahoo nao tem 4h nativo; agregamos a partir de 1h.
  '1d': '1d',
  '1w': '1wk',
  '1M': '1mo',
};

/** Quanto historico pedir para conseguir `limit` velas fechadas. */
function rangeFor(timeframe: string, limit: number): string {
  const perDay: Record<string, number> = { '1h': 7, '4h': 7, '1d': 1, '1w': 1 / 5, '1M': 1 / 21 };
  const days = Math.ceil(limit / (perDay[timeframe] ?? 1)) * 1.6 + 30;
  if (days <= 30) return '1mo';
  if (days <= 90) return '3mo';
  if (days <= 180) return '6mo';
  if (days <= 365) return '1y';
  if (days <= 730) return '2y';
  if (days <= 1825) return '5y';
  if (days <= 3650) return '10y';
  return 'max';
}

interface YahooChartResponse {
  chart: {
    result?: Array<{
      meta: { symbol: string };
      timestamp?: number[];
      indicators: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
    error?: { code: string; description: string } | null;
  };
}

export class YahooProvider implements DataProvider {
  readonly id = 'yahoo';
  readonly catalogId = 'yahoo-finance';
  readonly capabilities = ['ohlc', 'equities', 'fx-rate', 'metals', 'crypto-spot', 'index'] as const;
  readonly assetClasses = ['forex', 'index', 'metal', 'crypto', 'commodity'] as const;
  readonly requiresKey = false;
  readonly rateLimitPerMinute = 60;
  readonly ohlcFidelity = 'true-ohlc' as const;

  isConfigured(): boolean {
    return true;
  }

  supports(request: CandleRequest): boolean {
    if (!(request.timeframe in INTERVAL)) return false;
    return symbolsCoveredBy('yahoo').includes(request.symbol);
  }

  async getCandles(request: CandleRequest): Promise<CandleSeries> {
    const providerSymbol = toProviderSymbol('yahoo', request.symbol);
    if (!providerSymbol) {
      throw new ProviderError(`Yahoo nao cobre ${request.symbol}`, this.id, false);
    }

    const interval = INTERVAL[request.timeframe];
    if (!interval) {
      throw new ProviderError(`timeframe ${request.timeframe} nao suportado`, this.id, false);
    }

    const url =
      `${BASE}/${encodeURIComponent(providerSymbol)}` +
      `?interval=${interval}&range=${rangeFor(request.timeframe, request.limit)}` +
      `&includePrePost=false&events=div%2Csplit`;

    const json = await fetchJson<YahooChartResponse>(url, {
      providerId: this.id,
      rateLimitPerMinute: this.rateLimitPerMinute,
    });

    if (json.chart.error) {
      throw new ProviderError(
        `Yahoo: ${json.chart.error.code} — ${json.chart.error.description}`,
        this.id,
        false,
      );
    }

    const result = json.chart.result?.[0];
    const quote = result?.indicators.quote?.[0];
    const stamps = result?.timestamp;
    if (!result || !quote || !stamps) {
      throw new ProviderError(`Yahoo devolveu payload vazio para ${providerSymbol}`, this.id, true);
    }

    const raw = stamps.map((t, i) => ({
      time: t * 1000,
      open: quote.open?.[i] ?? NaN,
      high: quote.high?.[i] ?? NaN,
      low: quote.low?.[i] ?? NaN,
      close: quote.close?.[i] ?? NaN,
      volume: quote.volume?.[i] ?? 0,
    }));

    let candles = normalizeCandles(raw);
    // Os futuros da CME cotam CHF/USD, JPY/USD e CAD/USD — inverter para a
    // convencao de mercado (USDCHF, USDJPY, USDCAD) antes de qualquer analise.
    if (isInvertedSymbol('yahoo', request.symbol)) {
      candles = normalizeCandles(invertCandles(candles));
    }
    if (request.timeframe === '4h') candles = aggregate(candles, 4);
    if (!request.includeForming) {
      candles = dropUnclosedCandle(candles, request.timeframe);
    }
    if (request.since !== undefined) candles = candles.filter((c) => c.time >= request.since!);

    return {
      symbol: request.symbol,
      timeframe: request.timeframe,
      candles: candles.slice(-request.limit),
      source: this.id,
      fidelity: this.ohlcFidelity,
    };
  }
}

/**
 * Agrega N velas consecutivas numa so. Usado para construir 4h a partir de 1h.
 * Os grupos sao alinhados ao epoch para que o mesmo instante caia sempre no
 * mesmo bucket, independentemente de onde a serie comeca.
 */
function aggregate(candles: ReturnType<typeof normalizeCandles>, factor: number) {
  const buckets = new Map<number, (typeof candles)[number]>();
  const span = 3_600_000 * factor;

  for (const c of candles) {
    const key = Math.floor(c.time / span) * span;
    const acc = buckets.get(key);
    if (!acc) {
      buckets.set(key, { ...c, time: key });
    } else {
      acc.high = Math.max(acc.high, c.high);
      acc.low = Math.min(acc.low, c.low);
      acc.close = c.close;
      acc.volume += c.volume;
    }
  }

  return [...buckets.values()].sort((a, b) => a.time - b.time);
}
