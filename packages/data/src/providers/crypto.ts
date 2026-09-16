/**
 * Fontes de cripto sem chave de API.
 *
 * Quatro implementacoes independentes para o mesmo dado. A redundancia importa:
 * cripto negoceia 24/7 e uma exchange em manutencao nao pode parar o motor.
 * Ordem de failover definida em catalog.ts: Binance -> CoinGecko -> Coinbase ->
 * Kraken.
 */

import type { Candle, CandleSeries } from '@trading/core';
import { fetchJson } from '../http.js';
import { symbolsCoveredBy, toProviderSymbol } from '../symbols/mapping.js';
import {
  dropUnclosedCandle,
  normalizeCandles,
  ProviderError,
  type CandleRequest,
  type DataProvider,
} from '../types.js';

/** Base comum: reduz a repeticao entre as quatro exchanges. */
abstract class CryptoProvider implements DataProvider {
  abstract readonly id: string;
  abstract readonly catalogId: string;
  readonly capabilities = ['ohlc', 'crypto-spot'] as const;
  readonly assetClasses = ['crypto'] as const;
  readonly requiresKey = false;
  readonly ohlcFidelity = 'true-ohlc' as const;
  abstract readonly rateLimitPerMinute: number;

  isConfigured(): boolean {
    return true;
  }

  supports(request: CandleRequest): boolean {
    return (
      symbolsCoveredBy(this.id as never).includes(request.symbol) &&
      this.intervalFor(request.timeframe) !== null
    );
  }

  protected abstract intervalFor(timeframe: string): string | null;
  protected abstract fetchRaw(providerSymbol: string, request: CandleRequest): Promise<Candle[]>;

  async getCandles(request: CandleRequest): Promise<CandleSeries> {
    const providerSymbol = toProviderSymbol(this.id as never, request.symbol);
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

/** Binance klines. Formato: [openTime, open, high, low, close, volume, ...]. */
export class BinanceProvider extends CryptoProvider {
  readonly id = 'binance';
  readonly catalogId = 'binance';
  readonly rateLimitPerMinute = 100;

  protected intervalFor(timeframe: string): string | null {
    return { '1h': '1h', '4h': '4h', '1d': '1d', '1w': '1w', '1M': '1M' }[timeframe] ?? null;
  }

  protected async fetchRaw(providerSymbol: string, request: CandleRequest): Promise<Candle[]> {
    const interval = this.intervalFor(request.timeframe);
    const limit = Math.min(1000, request.limit + 5);
    const url = `https://api.binance.com/api/v3/klines?symbol=${providerSymbol}&interval=${interval}&limit=${limit}`;

    const rows = await fetchJson<unknown[][]>(url, {
      providerId: this.id,
      rateLimitPerMinute: this.rateLimitPerMinute,
    });

    return rows.map((r) => ({
      time: Number(r[0]),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
    }));
  }
}

// ---------------------------------------------------------------------------

/**
 * Coinbase Exchange candles.
 *
 * ATENCAO ao formato: `[time, low, high, open, close, volume]` — low e high vem
 * ANTES de open e close, ao contrario de quase todas as outras exchanges. E a
 * resposta vem em ordem DECRESCENTE (mais recente primeiro).
 */
export class CoinbaseProvider extends CryptoProvider {
  readonly id = 'coinbase';
  readonly catalogId = 'coinbase';
  readonly rateLimitPerMinute = 60;

  protected intervalFor(timeframe: string): string | null {
    // Granularidade em segundos. O Coinbase nao tem semanal nem mensal.
    return { '1h': '3600', '4h': '21600', '1d': '86400' }[timeframe] ?? null;
  }

  protected async fetchRaw(providerSymbol: string, request: CandleRequest): Promise<Candle[]> {
    const granularity = this.intervalFor(request.timeframe);
    const url = `https://api.exchange.coinbase.com/products/${providerSymbol}/candles?granularity=${granularity}`;

    const rows = await fetchJson<number[][]>(url, {
      providerId: this.id,
      rateLimitPerMinute: this.rateLimitPerMinute,
    });

    return rows.map((r) => ({
      time: Number(r[0]) * 1000,
      low: Number(r[1]),
      high: Number(r[2]),
      open: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
    }));
  }
}

// ---------------------------------------------------------------------------

/**
 * Kraken OHLC.
 *
 * A chave do resultado NAO e o par pedido: pedimos `XBTUSD` e recebemos
 * `XXBTZUSD` (nomenclatura interna do Kraken). Por isso lemos a primeira chave
 * do objeto `result` ignorando `last`.
 */
export class KrakenProvider extends CryptoProvider {
  readonly id = 'kraken';
  readonly catalogId = 'kraken';
  readonly rateLimitPerMinute = 30;

  protected intervalFor(timeframe: string): string | null {
    // Intervalo em minutos.
    return { '1h': '60', '4h': '240', '1d': '1440', '1w': '10080' }[timeframe] ?? null;
  }

  protected async fetchRaw(providerSymbol: string, request: CandleRequest): Promise<Candle[]> {
    const interval = this.intervalFor(request.timeframe);
    const url = `https://api.kraken.com/0/public/OHLC?pair=${providerSymbol}&interval=${interval}`;

    const json = await fetchJson<{ error: string[]; result: Record<string, unknown> }>(url, {
      providerId: this.id,
      rateLimitPerMinute: this.rateLimitPerMinute,
    });

    if (json.error?.length) {
      throw new ProviderError(`Kraken: ${json.error.join('; ')}`, this.id, false);
    }

    const key = Object.keys(json.result).find((k) => k !== 'last');
    const rows = key ? (json.result[key] as unknown[][]) : null;
    if (!rows) {
      throw new ProviderError(`Kraken devolveu resultado vazio para ${providerSymbol}`, this.id, true);
    }

    // [time, open, high, low, close, vwap, volume, count]
    return rows.map((r) => ({
      time: Number(r[0]) * 1000,
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[6]),
    }));
  }
}

// ---------------------------------------------------------------------------

/**
 * CoinGecko OHLC.
 *
 * Devolve `[time, open, high, low, close]` sem volume, e a granularidade e
 * escolhida automaticamente pelo parametro `days` (nao ha controlo fino). Para
 * `days=max` o CoinGecko entrega velas diarias, que e o que interessa ao motor.
 */
export class CoinGeckoProvider extends CryptoProvider {
  readonly id = 'coingecko';
  readonly catalogId = 'coingecko';
  readonly rateLimitPerMinute = 10;

  protected intervalFor(timeframe: string): string | null {
    return timeframe === '1d' ? 'daily' : null;
  }

  protected async fetchRaw(providerSymbol: string, request: CandleRequest): Promise<Candle[]> {
    const days = Math.min(365, Math.max(30, request.limit + 10));
    const url = `https://api.coingecko.com/api/v3/coins/${providerSymbol}/ohlc?vs_currency=usd&days=${days}`;

    const rows = await fetchJson<number[][]>(url, {
      providerId: this.id,
      rateLimitPerMinute: this.rateLimitPerMinute,
    });

    return rows.map((r) => ({
      time: Number(r[0]),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: 0,
    }));
  }
}
