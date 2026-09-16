/**
 * Fontes de taxa de cambio fiat (BCE e agregadores).
 *
 * IMPORTANTE: estas fontes dao UMA cotacao por dia, sem maxima nem minima. O
 * adapter preenche O=H=L=C e marca a serie como `synthetic`. O registry NUNCA as
 * entrega ao motor MMXM — sem pavios nao existem FVG, swing points nem
 * displacement, e a estrutura detectada seria pura ficcao.
 *
 * Servem para: verificacao de sanidade de preco, deteccao de desvio entre
 * fontes, e reconstrucao do DXY sintetico quando o Yahoo esta em baixo.
 */

import type { Candle, CandleSeries } from '@trading/core';
import { fetchJson } from '../http.js';
import { splitFiatPair, symbolsCoveredBy, toProviderSymbol } from '../symbols/mapping.js';
import {
  dropUnclosedCandle,
  normalizeCandles,
  ProviderError,
  type CandleRequest,
  type DataProvider,
} from '../types.js';

abstract class FiatRateProvider implements DataProvider {
  abstract readonly id: 'frankfurter' | 'exchangeratehost';
  abstract readonly catalogId: string;
  readonly capabilities = ['fx-rate'] as const;
  readonly assetClasses = ['forex'] as const;
  readonly requiresKey = false;
  readonly rateLimitPerMinute = 30;
  /** Ver nota no topo do ficheiro: serie sem maxima/minima reais. */
  readonly ohlcFidelity = 'synthetic' as const;

  isConfigured(): boolean {
    return true;
  }

  supports(request: CandleRequest): boolean {
    return request.timeframe === '1d' && symbolsCoveredBy(this.id).includes(request.symbol);
  }

  protected abstract fetchSeries(
    base: string,
    quote: string,
    from: string,
    to: string,
  ): Promise<Record<string, number>>;

  async getCandles(request: CandleRequest): Promise<CandleSeries> {
    const providerSymbol = toProviderSymbol(this.id, request.symbol);
    const pair = providerSymbol ? splitFiatPair(providerSymbol) : null;
    if (!pair) {
      throw new ProviderError(`${this.id} nao cobre ${request.symbol}`, this.id, false);
    }

    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - request.limit * 86_400_000 * 1.6)
      .toISOString()
      .slice(0, 10);

    const rates = await this.fetchSeries(pair.base, pair.quote, from, to);

    const raw: Candle[] = Object.entries(rates).map(([date, rate]) => ({
      time: Date.parse(`${date}T00:00:00Z`),
      open: rate,
      high: rate,
      low: rate,
      close: rate,
      volume: 0,
    }));

    let candles = normalizeCandles(raw);
    if (!request.includeForming) {
      candles = dropUnclosedCandle(candles, request.timeframe);
    }

    return {
      symbol: request.symbol,
      timeframe: request.timeframe,
      candles: candles.slice(-request.limit),
      source: this.id,
      fidelity: this.ohlcFidelity,
    };
  }
}

/** Frankfurter — taxas de referencia do Banco Central Europeu, sem chave. */
export class FrankfurterProvider extends FiatRateProvider {
  readonly id = 'frankfurter' as const;
  readonly catalogId = 'frankfurter';

  protected async fetchSeries(
    base: string,
    quote: string,
    from: string,
    to: string,
  ): Promise<Record<string, number>> {
    const url = `https://api.frankfurter.dev/v1/${from}..${to}?base=${base}&symbols=${quote}`;
    const json = await fetchJson<{ rates?: Record<string, Record<string, number>> }>(url, {
      providerId: this.id,
      rateLimitPerMinute: this.rateLimitPerMinute,
    });

    if (!json.rates) {
      throw new ProviderError(`Frankfurter: sem taxas para ${base}/${quote}`, this.id, true);
    }

    const out: Record<string, number> = {};
    for (const [date, entry] of Object.entries(json.rates)) {
      const rate = entry[quote];
      if (typeof rate === 'number') out[date] = rate;
    }
    return out;
  }
}

/** exchangerate.host — agregador com serie temporal gratuita. */
export class ExchangeRateHostProvider extends FiatRateProvider {
  readonly id = 'exchangeratehost' as const;
  readonly catalogId = 'exchangerate-host';

  protected async fetchSeries(
    base: string,
    quote: string,
    from: string,
    to: string,
  ): Promise<Record<string, number>> {
    const url =
      `https://api.exchangerate.host/timeframe?source=${base}&currencies=${quote}` +
      `&start_date=${from}&end_date=${to}`;

    const json = await fetchJson<{
      success?: boolean;
      error?: { info?: string };
      quotes?: Record<string, Record<string, number>>;
    }>(url, { providerId: this.id, rateLimitPerMinute: this.rateLimitPerMinute });

    if (!json.quotes) {
      throw new ProviderError(
        `exchangerate.host: ${json.error?.info ?? 'sem quotes'}`,
        this.id,
        true,
      );
    }

    const out: Record<string, number> = {};
    for (const [date, entry] of Object.entries(json.quotes)) {
      const rate = entry[`${base}${quote}`];
      if (typeof rate === 'number') out[date] = rate;
    }
    return out;
  }
}
