/**
 * @trading/data — camada de acesso a dados de mercado.
 *
 * Exporta o catalogo completo das APIs publicas de financas, os adapters
 * concretos e o registry com failover.
 */

export * from './catalog.js';
export * from './types.js';
export * from './registry.js';
export * from './symbols/mapping.js';
export { fetchJson, fetchText, sleep } from './http.js';
export {
  calendarioAltoImpacto,
  comunicadosBancosCentrais,
  posicionamentoCot,
  type Comunicado,
  type PosicionamentoCot,
} from './noticias.js';

export { YahooProvider } from './providers/yahoo.js';
export {
  DerivProvider,
  closeDerivConnection,
  derivSymbols,
  mercadosAbertosDeriv,
  velasDeriv,
} from './providers/deriv.js';
/*
 * Seleccao explicita, e nao `export *`: o catalogo exporta nomes genericos
 * (`Timeframe`, `TIMEFRAMES`, `TODOS`) que colidiriam com o resto do pacote. O
 * browser importa o ficheiro inteiro pelo subcaminho `@trading/data/deriv-simbolos`.
 */
export {
  acharSimbolo,
  paraDeriv,
  porCodigoDeriv,
  TODOS as SIMBOLOS_DERIV,
  type SimboloDeriv,
} from './deriv-simbolos.js';
export {
  BinanceProvider,
  CoinbaseProvider,
  CoinGeckoProvider,
  KrakenProvider,
} from './providers/crypto.js';
export {
  AlphaVantageProvider,
  FinnhubProvider,
  FmpProvider,
  PolygonProvider,
  TwelveDataProvider,
} from './providers/keyed.js';
export { ExchangeRateHostProvider, FrankfurterProvider } from './providers/fiat.js';
