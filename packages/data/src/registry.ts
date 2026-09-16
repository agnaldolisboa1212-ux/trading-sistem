/**
 * Registry de providers com failover e circuit breaker.
 *
 * O motor pede velas ao registry, nunca a um provider concreto. O registry:
 *   1. filtra os providers que suportam o pedido;
 *   2. exclui os que estao com o circuito aberto (falhas consecutivas);
 *   3. exclui os `synthetic` quando se exige OHLC real;
 *   4. tenta por ordem de prioridade do catalogo ate um responder;
 *   5. regista saude de cada fonte para o dashboard.
 */

import type { CandleSeries } from '@trading/core';
import { findSource } from './catalog.js';
import {
  BinanceProvider,
  CoinbaseProvider,
  CoinGeckoProvider,
  KrakenProvider,
} from './providers/crypto.js';
import { ExchangeRateHostProvider, FrankfurterProvider } from './providers/fiat.js';
import {
  AlphaVantageProvider,
  FinnhubProvider,
  FmpProvider,
  PolygonProvider,
  TwelveDataProvider,
} from './providers/keyed.js';
import { DerivProvider } from './providers/deriv.js';
import { YahooProvider } from './providers/yahoo.js';
import { ProviderError, type CandleRequest, type DataProvider, type ProviderHealth } from './types.js';

export interface RegistryOptions {
  /**
   * Falhas consecutivas antes de abrir o circuito de um provider.
   * Com o circuito aberto ele deixa de ser tentado ate ao `circuitResetMs`.
   */
  failureThreshold?: number;
  /** Tempo que o circuito fica aberto, em ms. */
  circuitResetMs?: number;
}

export interface GetCandlesOptions {
  /**
   * Se true (por omissao), recusa fontes `synthetic`. O motor MMXM exige isto:
   * estrutura calculada sobre velas sem pavios e invalida.
   */
  requireTrueOhlc?: boolean;
  /** Forca um provider especifico (util para reproduzir um sinal historico). */
  preferProvider?: string;
  /**
   * Manter a vela ainda em formacao. So para visualizacao — quem analisa tem de
   * a excluir, senao produz estrutura que desaparece na vela seguinte.
   */
  includeForming?: boolean;
}

export class ProviderRegistry {
  private readonly providers: DataProvider[];
  private readonly health = new Map<string, ProviderHealth>();
  private readonly openUntil = new Map<string, number>();
  private readonly failureThreshold: number;
  private readonly circuitResetMs: number;

  constructor(providers?: DataProvider[], options: RegistryOptions = {}) {
    this.providers = providers ?? defaultProviders();
    this.failureThreshold = options.failureThreshold ?? 3;
    this.circuitResetMs = options.circuitResetMs ?? 10 * 60_000;

    for (const p of this.providers) {
      this.health.set(p.id, {
        providerId: p.id,
        ok: true,
        latencyMs: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastError: null,
        consecutiveFailures: 0,
      });
    }
  }

  /** Prioridade de failover, lida do catalogo (menor = tentado primeiro). */
  private priorityOf(provider: DataProvider): number {
    return findSource(provider.catalogId)?.priority ?? 99;
  }

  private isCircuitOpen(providerId: string): boolean {
    const until = this.openUntil.get(providerId);
    if (until === undefined) return false;
    if (Date.now() >= until) {
      this.openUntil.delete(providerId);
      return false;
    }
    return true;
  }

  /** Providers candidatos para um pedido, ja ordenados. */
  candidatesFor(request: CandleRequest, options: GetCandlesOptions = {}): DataProvider[] {
    const requireTrue = options.requireTrueOhlc ?? true;

    return this.providers
      .filter((p) => p.isConfigured())
      .filter((p) => !requireTrue || p.ohlcFidelity === 'true-ohlc')
      .filter((p) => p.supports(request))
      .filter((p) => !this.isCircuitOpen(p.id))
      .filter((p) => !options.preferProvider || p.id === options.preferProvider)
      .sort((a, b) => this.priorityOf(a) - this.priorityOf(b));
  }

  /**
   * Busca velas percorrendo os candidatos ate um responder.
   *
   * Erros nao recuperaveis (simbolo desconhecido pela fonte) nao contam para o
   * circuit breaker — sao uma limitacao permanente daquele provider para aquele
   * simbolo, nao um sinal de que a fonte esta em baixo.
   */
  async getCandles(request: CandleRequest, options: GetCandlesOptions = {}): Promise<CandleSeries> {
    const candidates = this.candidatesFor(request, options);

    if (candidates.length === 0) {
      throw new ProviderError(
        `nenhum provider disponivel para ${request.symbol} ${request.timeframe}` +
          (options.requireTrueOhlc === false ? '' : ' com OHLC real'),
        'registry',
        false,
      );
    }

    const errors: string[] = [];

    for (const provider of candidates) {
      const startedAt = Date.now();
      try {
        const series = await provider.getCandles(request);

        if (series.candles.length === 0) {
          throw new ProviderError(`serie vazia para ${request.symbol}`, provider.id, true);
        }

        this.recordSuccess(provider.id, Date.now() - startedAt);
        return series;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const retryable = err instanceof ProviderError ? err.retryable : true;
        errors.push(`${provider.id}: ${message}`);
        if (retryable) this.recordFailure(provider.id, message);
      }
    }

    throw new ProviderError(
      `todas as fontes falharam para ${request.symbol} ${request.timeframe} — ${errors.join(' | ')}`,
      'registry',
      true,
    );
  }

  /** Busca varios simbolos em paralelo, tolerando falhas individuais. */
  async getMany(
    symbols: string[],
    timeframe: CandleRequest['timeframe'],
    limit: number,
    options: GetCandlesOptions = {},
  ): Promise<{ series: Map<string, CandleSeries>; failures: Map<string, string> }> {
    const series = new Map<string, CandleSeries>();
    const failures = new Map<string, string>();

    const results = await Promise.allSettled(
      symbols.map((symbol) =>
        this.getCandles(
          { symbol, timeframe, limit, includeForming: options.includeForming },
          options,
        ),
      ),
    );

    results.forEach((result, i) => {
      const symbol = symbols[i];
      if (!symbol) return;
      if (result.status === 'fulfilled') {
        series.set(symbol, result.value);
      } else {
        const reason = result.reason;
        failures.set(symbol, reason instanceof Error ? reason.message : String(reason));
      }
    });

    return { series, failures };
  }

  private recordSuccess(providerId: string, latencyMs: number): void {
    const h = this.health.get(providerId);
    if (!h) return;
    h.ok = true;
    h.latencyMs = latencyMs;
    h.lastSuccessAt = Date.now();
    h.consecutiveFailures = 0;
    this.openUntil.delete(providerId);
  }

  private recordFailure(providerId: string, message: string): void {
    const h = this.health.get(providerId);
    if (!h) return;
    h.ok = false;
    h.lastErrorAt = Date.now();
    h.lastError = message;
    h.consecutiveFailures += 1;

    if (h.consecutiveFailures >= this.failureThreshold) {
      this.openUntil.set(providerId, Date.now() + this.circuitResetMs);
    }
  }

  /** Estado de saude de todas as fontes, para o dashboard e alertas. */
  getHealth(): ProviderHealth[] {
    return [...this.health.values()].map((h) => ({ ...h }));
  }

  /** Providers registados e configurados (chave presente quando exigida). */
  listActive(): Array<{ id: string; catalogId: string; fidelity: string; requiresKey: boolean }> {
    return this.providers
      .filter((p) => p.isConfigured())
      .map((p) => ({
        id: p.id,
        catalogId: p.catalogId,
        fidelity: p.ohlcFidelity,
        requiresKey: p.requiresKey,
      }));
  }
}

/** Conjunto de providers por omissao. Os que exigem chave auto-desativam-se. */
export function defaultProviders(): DataProvider[] {
  return [
    new YahooProvider(),
    new DerivProvider(),
    new BinanceProvider(),
    new CoinGeckoProvider(),
    new CoinbaseProvider(),
    new KrakenProvider(),
    new TwelveDataProvider(),
    new PolygonProvider(),
    new FinnhubProvider(),
    new FmpProvider(),
    new AlphaVantageProvider(),
    new FrankfurterProvider(),
    new ExchangeRateHostProvider(),
  ];
}
