/**
 * Traducao entre o simbolo CANONICO interno e o simbolo de cada provider.
 *
 * Regra: o motor so conhece 'EURUSD', 'NQ', 'BTCUSD'. Qualquer particularidade
 * de nomenclatura de fonte vive aqui e em lado nenhum mais.
 *
 * Para indices e metais usamos os CONTRATOS FUTUROS (NQ=F, ES=F, GC=F) e nao os
 * indices a vista (^NDX, ^GSPC). O ICT/MMXM e construido sobre futuros: sao eles
 * que carregam o volume institucional e cujas maximas/minimas formam os pocos de
 * liquidez reais. Os indices a vista nao negoceiam fora de horas e produziriam
 * gaps artificiais que o detector de FVG interpretaria como imbalances.
 */

export type ProviderId =
  | 'yahoo'
  | 'binance'
  | 'coingecko'
  | 'coinbase'
  | 'kraken'
  | 'twelvedata'
  | 'alphavantage'
  | 'polygon'
  | 'finnhub'
  | 'fmp'
  | 'frankfurter'
  | 'exchangeratehost'
  | 'fred';

/** symbol canonico -> symbol do provider. `null` = provider nao cobre o ativo. */
type SymbolTable = Record<string, string | null>;

/*
 * FOREX VIA FUTUROS DA CME, NAO VIA `=X`.
 *
 * Os simbolos spot do Yahoo (EURUSD=X, GBPUSD=X...) devolvem `open` praticamente
 * igual a `close` — medido em 200 velas diarias, o corpo e ~2% do range, contra
 * ~50% num OHLC real. Isso destroi tudo o que depende do corpo da vela:
 * displacement, order blocks, CISD e a propria cor da vela.
 *
 * Os futuros da CME (6E, 6B, 6A, 6N, 6S, 6J, 6C) tem OHLC verdadeiro com volume
 * (corpo/range medido entre 49% e 55%) — e sao, alem disso, o instrumento que o
 * ICT efetivamente opera. Corrigir a fonte corrige tambem a fidelidade ao
 * framework.
 */
const YAHOO: SymbolTable = {
  EURUSD: '6E=F',
  GBPUSD: '6B=F',
  AUDUSD: '6A=F',
  NZDUSD: '6N=F',
  USDCHF: '6S=F',
  USDJPY: '6J=F',
  USDCAD: '6C=F',
  DXY: 'DX-Y.NYB',
  NQ: 'NQ=F',
  ES: 'ES=F',
  YM: 'YM=F',
  RTY: 'RTY=F',
  XAUUSD: 'GC=F',
  XAGUSD: 'SI=F',
  BTCUSD: 'BTC-USD',
  ETHUSD: 'ETH-USD',
  SOLUSD: 'SOL-USD',
};

const BINANCE: SymbolTable = {
  BTCUSD: 'BTCUSDT',
  ETHUSD: 'ETHUSDT',
  SOLUSD: 'SOLUSDT',
};

const COINGECKO: SymbolTable = {
  BTCUSD: 'bitcoin',
  ETHUSD: 'ethereum',
  SOLUSD: 'solana',
};

const COINBASE: SymbolTable = {
  BTCUSD: 'BTC-USD',
  ETHUSD: 'ETH-USD',
  SOLUSD: 'SOL-USD',
};

const KRAKEN: SymbolTable = {
  BTCUSD: 'XBTUSD',
  ETHUSD: 'ETHUSD',
  SOLUSD: 'SOLUSD',
};

const TWELVEDATA: SymbolTable = {
  EURUSD: 'EUR/USD',
  GBPUSD: 'GBP/USD',
  AUDUSD: 'AUD/USD',
  NZDUSD: 'NZD/USD',
  USDCHF: 'USD/CHF',
  USDJPY: 'USD/JPY',
  USDCAD: 'USD/CAD',
  DXY: 'DXY',
  NQ: 'NDX',
  ES: 'SPX',
  YM: 'DJI',
  RTY: 'RUT',
  XAUUSD: 'XAU/USD',
  XAGUSD: 'XAG/USD',
  BTCUSD: 'BTC/USD',
  ETHUSD: 'ETH/USD',
  SOLUSD: 'SOL/USD',
};

const ALPHAVANTAGE: SymbolTable = {
  EURUSD: 'EUR/USD',
  GBPUSD: 'GBP/USD',
  AUDUSD: 'AUD/USD',
  NZDUSD: 'NZD/USD',
  USDCHF: 'USD/CHF',
  USDJPY: 'USD/JPY',
  USDCAD: 'USD/CAD',
  DXY: null,
  NQ: 'QQQ',
  ES: 'SPY',
  YM: 'DIA',
  RTY: 'IWM',
  XAUUSD: null,
  XAGUSD: null,
  BTCUSD: 'BTC',
  ETHUSD: 'ETH',
  SOLUSD: 'SOL',
};

const POLYGON: SymbolTable = {
  EURUSD: 'C:EURUSD',
  GBPUSD: 'C:GBPUSD',
  AUDUSD: 'C:AUDUSD',
  NZDUSD: 'C:NZDUSD',
  USDCHF: 'C:USDCHF',
  USDJPY: 'C:USDJPY',
  USDCAD: 'C:USDCAD',
  DXY: null,
  NQ: 'QQQ',
  ES: 'SPY',
  YM: 'DIA',
  RTY: 'IWM',
  XAUUSD: 'C:XAUUSD',
  XAGUSD: 'C:XAGUSD',
  BTCUSD: 'X:BTCUSD',
  ETHUSD: 'X:ETHUSD',
  SOLUSD: 'X:SOLUSD',
};

const FINNHUB: SymbolTable = {
  EURUSD: 'OANDA:EUR_USD',
  GBPUSD: 'OANDA:GBP_USD',
  AUDUSD: 'OANDA:AUD_USD',
  NZDUSD: 'OANDA:NZD_USD',
  USDCHF: 'OANDA:USD_CHF',
  USDJPY: 'OANDA:USD_JPY',
  USDCAD: 'OANDA:USD_CAD',
  DXY: null,
  NQ: 'QQQ',
  ES: 'SPY',
  YM: 'DIA',
  RTY: 'IWM',
  XAUUSD: 'OANDA:XAU_USD',
  XAGUSD: 'OANDA:XAG_USD',
  BTCUSD: 'BINANCE:BTCUSDT',
  ETHUSD: 'BINANCE:ETHUSDT',
  SOLUSD: 'BINANCE:SOLUSDT',
};

const FMP: SymbolTable = {
  EURUSD: 'EURUSD',
  GBPUSD: 'GBPUSD',
  AUDUSD: 'AUDUSD',
  NZDUSD: 'NZDUSD',
  USDCHF: 'USDCHF',
  USDJPY: 'USDJPY',
  USDCAD: 'USDCAD',
  DXY: null,
  NQ: 'QQQ',
  ES: 'SPY',
  YM: 'DIA',
  RTY: 'IWM',
  XAUUSD: 'XAUUSD',
  XAGUSD: 'XAGUSD',
  BTCUSD: 'BTCUSD',
  ETHUSD: 'ETHUSD',
  SOLUSD: 'SOLUSD',
};

/**
 * Frankfurter e exchangerate.host devolvem apenas UMA taxa por dia (fecho do
 * BCE), sem maxima nem minima. Sao registados aqui porque servem como rede de
 * seguranca de PRECO, mas o registry marca-os como fidelidade `synthetic` e o
 * motor MMXM recusa-os — sem pavios nao ha FVG nem swing point validos.
 */
const FIAT_RATE: SymbolTable = {
  EURUSD: 'EUR|USD',
  GBPUSD: 'GBP|USD',
  AUDUSD: 'AUD|USD',
  NZDUSD: 'NZD|USD',
  USDCHF: 'USD|CHF',
  USDJPY: 'USD|JPY',
  USDCAD: 'USD|CAD',
};

const TABLES: Record<ProviderId, SymbolTable> = {
  yahoo: YAHOO,
  binance: BINANCE,
  coingecko: COINGECKO,
  coinbase: COINBASE,
  kraken: KRAKEN,
  twelvedata: TWELVEDATA,
  alphavantage: ALPHAVANTAGE,
  polygon: POLYGON,
  finnhub: FINNHUB,
  fmp: FMP,
  frankfurter: FIAT_RATE,
  exchangeratehost: FIAT_RATE,
  fred: {},
};

/**
 * Simbolos que o provider cota INVERTIDOS em relacao a convencao canonica.
 *
 * Os futuros da CME cotam sempre a moeda estrangeira contra o dolar: 6S=F e
 * CHF/USD, nao USD/CHF. Como o universo interno usa a convencao de mercado
 * (USDCHF, USDJPY, USDCAD), estas series tem de ser invertidas na leitura.
 */
const INVERTED_SYMBOLS: Partial<Record<ProviderId, ReadonlySet<string>>> = {
  yahoo: new Set(['USDCHF', 'USDJPY', 'USDCAD']),
};

/** True se a serie deste provider precisa de ser invertida para o simbolo dado. */
export function isInvertedSymbol(provider: ProviderId, symbol: string): boolean {
  return INVERTED_SYMBOLS[provider]?.has(symbol) ?? false;
}

/** Traduz o simbolo canonico. Devolve null se o provider nao cobre o ativo. */
export function toProviderSymbol(provider: ProviderId, symbol: string): string | null {
  return TABLES[provider][symbol] ?? null;
}

/** Todos os simbolos canonicos que um provider consegue servir. */
export function symbolsCoveredBy(provider: ProviderId): string[] {
  return Object.entries(TABLES[provider])
    .filter(([, v]) => v !== null)
    .map(([k]) => k);
}

/** Separa 'EUR|USD' em base e quote, para os providers de taxa fiat. */
export function splitFiatPair(providerSymbol: string): { base: string; quote: string } | null {
  const [base, quote] = providerSymbol.split('|');
  if (!base || !quote) return null;
  return { base, quote };
}
