/**
 * Fontes que exigem chave de API.
 *
 * Todas se auto-desativam quando a variavel de ambiente correspondente nao esta
 * definida (`isConfigured()` devolve false), por isso o sistema arranca e opera
 * sem nenhuma delas — servem para redundancia e para cobrir simbolos onde o
 * Yahoo falhe.
 *
 * Variaveis de ambiente:
 *   TWELVE_DATA_API_KEY, ALPHA_VANTAGE_API_KEY, POLYGON_API_KEY,
 *   FINNHUB_API_KEY, FMP_API_KEY
 */

import type { Candle, CandleSeries } from '@trading/core';
import { fetchJson } from '../http.js';
import { symbolsCoveredBy, toProviderSymbol, type ProviderId } from '../symbols/mapping.js';
import {
  dropUnclosedCandle,
  normalizeCandles,
  ProviderError,
  type CandleRequest,
  type DataProvider,
} from '../types.js';

abstract class KeyedProvider implements DataProvider {
  abstract readonly id: ProviderId;
  abstract readonly catalogId: string;
  abstract readonly envVar: string;
  abstract readonly rateLimitPerMinute: number;
  readonly capabilities = ['ohlc', 'equities', 'fx-rate', 'crypto-spot'] as const;
  readonly assetClasses = ['forex', 'index', 'metal', 'crypto'] as const;
  readonly requiresKey = true;
  readonly ohlcFidelity = 'true-ohlc' as const;

  protected get apiKey(): string {
    return process.env[this.envVar] ?? '';
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  supports(request: CandleRequest): boolean {
    if (!this.isConfigured()) return false;
    if (this.intervalFor(request.timeframe) === null) return false;
    return symbolsCoveredBy(this.id).includes(request.symbol);
  }

  protected abstract intervalFor(timeframe: string): string | null;
  protected abstract fetchRaw(providerSymbol: string, request: CandleRequest): Promise<Candle[]>;

  async getCandles(request: CandleRequest): Promise<CandleSeries> {
    if (!this.isConfigured()) {
      throw new ProviderError(`${this.id}: ${this.envVar} nao definida`, this.id, false);
    }
    const providerSymbol = toProviderSymbol(this.id, request.symbol);
    if (!providerSymbol) {
      throw new ProviderError(`${this.id} nao cobre ${request.symbol}`, this.id, false);
    }

    let candles = normalizeCandles(await this.fetchRaw(providerSymbol, request));
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

// ---------------------------------------------------------------------------

/** Twelve Data — melhor cobertura multi-classe entre as fontes com free tier. */
export class TwelveDataProvider extends KeyedProvider {
  readonly id = 'twelvedata' as const;
  readonly catalogId = 'twelve-data';
  readonly envVar = 'TWELVE_DATA_API_KEY';
  readonly rateLimitPerMinute = 8;

  protected intervalFor(timeframe: string): string | null {
    return { '1h': '1h', '4h': '4h', '1d': '1day', '1w': '1week', '1M': '1month' }[timeframe] ?? null;
  }

  protected async fetchRaw(providerSymbol: string, request: CandleRequest): Promise<Candle[]> {
    const interval = this.intervalFor(request.timeframe);
    const url =
      `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(providerSymbol)}` +
      `&interval=${interval}&outputsize=${Math.min(5000, request.limit + 10)}` +
      `&order=ASC&apikey=${this.apiKey}`;

    const json = await fetchJson<{
      status?: string;
      message?: string;
      values?: Array<Record<string, string>>;
    }>(url, { providerId: this.id, rateLimitPerMinute: this.rateLimitPerMinute });

    if (json.status === 'error' || !json.values) {
      throw new ProviderError(
        `Twelve Data: ${json.message ?? 'resposta sem valores'}`,
        this.id,
        // Erros de quota sao recuperaveis mais tarde; simbolo invalido nao e.
        (json.message ?? '').toLowerCase().includes('limit'),
      );
    }

    return json.values.map((v) => ({
      time: Date.parse(`${v['datetime']}Z`.replace(' ', 'T')),
      open: Number(v['open']),
      high: Number(v['high']),
      low: Number(v['low']),
      close: Number(v['close']),
      volume: Number(v['volume'] ?? 0),
    }));
  }
}

// ---------------------------------------------------------------------------

/** Alpha Vantage — free tier muito apertado (25 pedidos/dia). So como ultimo recurso. */
export class AlphaVantageProvider extends KeyedProvider {
  readonly id = 'alphavantage' as const;
  readonly catalogId = 'alpha-vantage';
  readonly envVar = 'ALPHA_VANTAGE_API_KEY';
  readonly rateLimitPerMinute = 5;

  protected intervalFor(timeframe: string): string | null {
    return { '1d': 'DAILY', '1w': 'WEEKLY', '1M': 'MONTHLY' }[timeframe] ?? null;
  }

  protected async fetchRaw(providerSymbol: string, request: CandleRequest): Promise<Candle[]> {
    const period = this.intervalFor(request.timeframe);
    const isFx = providerSymbol.includes('/');

    let url: string;
    if (isFx) {
      const [from, to] = providerSymbol.split('/');
      url =
        `https://www.alphavantage.co/query?function=FX_${period}` +
        `&from_symbol=${from}&to_symbol=${to}&outputsize=full&apikey=${this.apiKey}`;
    } else {
      url =
        `https://www.alphavantage.co/query?function=TIME_SERIES_${period}` +
        `&symbol=${providerSymbol}&outputsize=full&apikey=${this.apiKey}`;
    }

    const json = await fetchJson<Record<string, unknown>>(url, {
      providerId: this.id,
      rateLimitPerMinute: this.rateLimitPerMinute,
    });

    if (typeof json['Note'] === 'string' || typeof json['Information'] === 'string') {
      throw new ProviderError('Alpha Vantage: quota diaria esgotada', this.id, true);
    }

    const seriesKey = Object.keys(json).find((k) => k.toLowerCase().includes('time series'));
    const series = seriesKey ? (json[seriesKey] as Record<string, Record<string, string>>) : null;
    if (!series) {
      throw new ProviderError(
        `Alpha Vantage: sem serie para ${providerSymbol} (${JSON.stringify(json).slice(0, 150)})`,
        this.id,
        false,
      );
    }

    return Object.entries(series).map(([date, v]) => ({
      time: Date.parse(`${date}T00:00:00Z`),
      open: Number(v['1. open']),
      high: Number(v['2. high']),
      low: Number(v['3. low']),
      close: Number(v['4. close']),
      volume: Number(v['5. volume'] ?? v['6. volume'] ?? 0),
    }));
  }
}

// ---------------------------------------------------------------------------

/** Polygon.io — agregados diarios. Free tier tem atraso de fim de dia. */
export class PolygonProvider extends KeyedProvider {
  readonly id = 'polygon' as const;
  readonly catalogId = 'polygon';
  readonly envVar = 'POLYGON_API_KEY';
  readonly rateLimitPerMinute = 5;

  protected intervalFor(timeframe: string): string | null {
    return { '1h': '1/hour', '4h': '4/hour', '1d': '1/day', '1w': '1/week', '1M': '1/month' }[
      timeframe
    ] ?? null;
  }

  protected async fetchRaw(providerSymbol: string, request: CandleRequest): Promise<Candle[]> {
    const span = this.intervalFor(request.timeframe);
    const to = new Date().toISOString().slice(0, 10);
    // Margem generosa: o Polygon corta pelo limite de datas, nao pela contagem.
    const fromMs = Date.now() - request.limit * 86_400_000 * 2.2;
    const from = new Date(fromMs).toISOString().slice(0, 10);

    const url =
      `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(providerSymbol)}` +
      `/range/${span}/${from}/${to}?adjusted=true&sort=asc&limit=50000&apiKey=${this.apiKey}`;

    const json = await fetchJson<{
      status?: string;
      results?: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>;
    }>(url, { providerId: this.id, rateLimitPerMinute: this.rateLimitPerMinute });

    if (!json.results) {
      throw new ProviderError(`Polygon: sem resultados (status=${json.status})`, this.id, true);
    }

    return json.results.map((r) => ({
      time: r.t,
      open: r.o,
      high: r.h,
      low: r.l,
      close: r.c,
      volume: r.v,
    }));
  }
}

// ---------------------------------------------------------------------------

/** Finnhub — candles + noticias e sentimento (usados noutro modulo). */
export class FinnhubProvider extends KeyedProvider {
  readonly id = 'finnhub' as const;
  readonly catalogId = 'finnhub';
  readonly envVar = 'FINNHUB_API_KEY';
  readonly rateLimitPerMinute = 30;

  protected intervalFor(timeframe: string): string | null {
    return { '1h': '60', '1d': 'D', '1w': 'W', '1M': 'M' }[timeframe] ?? null;
  }

  protected async fetchRaw(providerSymbol: string, request: CandleRequest): Promise<Candle[]> {
    const resolution = this.intervalFor(request.timeframe);
    const to = Math.floor(Date.now() / 1000);
    const from = to - Math.ceil(request.limit * 86_400 * 2.2);
    const kind = providerSymbol.includes(':') ? 'forex' : 'stock';

    const url =
      `https://finnhub.io/api/v1/${kind}/candle?symbol=${encodeURIComponent(providerSymbol)}` +
      `&resolution=${resolution}&from=${from}&to=${to}&token=${this.apiKey}`;

    const json = await fetchJson<{
      s: string;
      t?: number[];
      o?: number[];
      h?: number[];
      l?: number[];
      c?: number[];
      v?: number[];
    }>(url, { providerId: this.id, rateLimitPerMinute: this.rateLimitPerMinute });

    if (json.s !== 'ok' || !json.t) {
      throw new ProviderError(`Finnhub: status=${json.s}`, this.id, json.s !== 'no_data');
    }

    return json.t.map((t, i) => ({
      time: t * 1000,
      open: json.o?.[i] ?? NaN,
      high: json.h?.[i] ?? NaN,
      low: json.l?.[i] ?? NaN,
      close: json.c?.[i] ?? NaN,
      volume: json.v?.[i] ?? 0,
    }));
  }
}

// ---------------------------------------------------------------------------

/** Financial Modeling Prep — historico diario completo. */
export class FmpProvider extends KeyedProvider {
  readonly id = 'fmp' as const;
  readonly catalogId = 'financial-modeling-prep';
  readonly envVar = 'FMP_API_KEY';
  readonly rateLimitPerMinute = 10;

  protected intervalFor(timeframe: string): string | null {
    return timeframe === '1d' ? 'daily' : null;
  }

  protected async fetchRaw(providerSymbol: string, request: CandleRequest): Promise<Candle[]> {
    const url =
      `https://financialmodelingprep.com/api/v3/historical-price-full/${providerSymbol}` +
      `?serietype=line&apikey=${this.apiKey}`;

    const json = await fetchJson<{
      historical?: Array<{
        date: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      }>;
    }>(url, { providerId: this.id, rateLimitPerMinute: this.rateLimitPerMinute });

    if (!json.historical) {
      throw new ProviderError(`FMP: sem historico para ${providerSymbol}`, this.id, true);
    }

    return json.historical.map((r) => ({
      time: Date.parse(`${r.date}T00:00:00Z`),
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume ?? 0,
    }));
  }
}
