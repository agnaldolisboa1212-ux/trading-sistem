/**
 * Cliente HTTP partilhado pelos providers: timeout, retry com backoff
 * exponencial e rate limiting por host.
 *
 * As APIs publicas gratuitas sao instaveis por natureza — 429 e 503 sao
 * rotina. Tratar isto aqui, uma vez, evita repetir logica em 13 adapters.
 */

import { ProviderError } from './types.js';

export interface FetchJsonOptions {
  providerId: string;
  /** Timeout por tentativa, em ms. */
  timeoutMs?: number;
  /** Numero de tentativas (1 = sem retry). */
  attempts?: number;
  headers?: Record<string, string>;
  /** Chave de rate limit. Por omissao usa o hostname da URL. */
  rateLimitKey?: string;
  /** Chamadas por minuto permitidas para esta chave. */
  rateLimitPerMinute?: number;
}

/** Estado do rate limiter: timestamps das chamadas recentes por chave. */
const callLog = new Map<string, number[]>();

/** Espera ate que uma nova chamada caiba na janela de 60s da chave. */
async function acquireSlot(key: string, perMinute: number): Promise<void> {
  if (perMinute <= 0) return;

  for (;;) {
    const now = Date.now();
    const windowStart = now - 60_000;
    const log = (callLog.get(key) ?? []).filter((t) => t > windowStart);

    if (log.length < perMinute) {
      log.push(now);
      callLog.set(key, log);
      return;
    }

    const oldest = log[0] ?? now;
    const waitMs = Math.max(50, oldest + 60_000 - now);
    callLog.set(key, log);
    await sleep(waitMs);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Status HTTP que justificam nova tentativa. */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/**
 * GET com JSON, retry e rate limit.
 *
 * Lanca `ProviderError` com `retryable` indicando se o registry deve passar ao
 * proximo provider (retryable=true) ou desistir do simbolo (false, ex.: 404).
 */
export async function fetchJson<T>(url: string, options: FetchJsonOptions): Promise<T> {
  const {
    providerId,
    timeoutMs = 15_000,
    attempts = 3,
    headers = {},
    rateLimitPerMinute = 60,
  } = options;

  let host = options.rateLimitKey;
  if (!host) {
    try {
      host = new URL(url).hostname;
    } catch {
      host = providerId;
    }
  }

  let lastError: ProviderError | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    await acquireSlot(host, rateLimitPerMinute);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          // Varias APIs publicas rejeitam pedidos sem User-Agent identificavel.
          'User-Agent': 'sistema-de-trading/0.1 (+MMXM signal engine)',
          Accept: 'application/json',
          ...headers,
        },
      });

      if (!res.ok) {
        const retryable = isRetryableStatus(res.status);
        const body = await res.text().catch(() => '');
        lastError = new ProviderError(
          `HTTP ${res.status} em ${host}: ${body.slice(0, 200)}`,
          providerId,
          retryable,
          res.status,
        );
        if (!retryable) throw lastError;
      } else {
        return (await res.json()) as T;
      }
    } catch (err) {
      if (err instanceof ProviderError) {
        if (!err.retryable) throw err;
        lastError = err;
      } else {
        const message = err instanceof Error ? err.message : String(err);
        const aborted = message.includes('abort');
        lastError = new ProviderError(
          aborted ? `timeout apos ${timeoutMs}ms em ${host}` : `falha de rede em ${host}: ${message}`,
          providerId,
          true,
        );
      }
    } finally {
      clearTimeout(timer);
    }

    if (attempt < attempts) {
      // Backoff exponencial com jitter para nao sincronizar retries.
      const backoff = 400 * 2 ** (attempt - 1);
      await sleep(backoff + Math.random() * 200);
    }
  }

  throw lastError ?? new ProviderError(`falha desconhecida em ${host}`, providerId, true);
}

/** GET de texto simples (CSV), com as mesmas garantias de retry. */
export async function fetchText(url: string, options: FetchJsonOptions): Promise<string> {
  const { providerId, timeoutMs = 15_000, headers = {}, rateLimitPerMinute = 60 } = options;

  let host = options.rateLimitKey;
  if (!host) {
    try {
      host = new URL(url).hostname;
    } catch {
      host = providerId;
    }
  }

  await acquireSlot(host, rateLimitPerMinute);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'sistema-de-trading/0.1 (+MMXM signal engine)',
        ...headers,
      },
    });
    if (!res.ok) {
      throw new ProviderError(
        `HTTP ${res.status} em ${host}`,
        providerId,
        isRetryableStatus(res.status),
        res.status,
      );
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}
