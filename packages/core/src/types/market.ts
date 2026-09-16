/**
 * Tipos base de mercado.
 *
 * Todo o motor trabalha com velas fechadas. Uma vela "em formacao" nunca deve
 * entrar nos detectores de estrutura — o ICT/MMXM depende de fechamentos
 * confirmados (displacement, CISD, MSS). O pipeline descarta a ultima vela
 * quando ela ainda nao fechou.
 */

/** Timeframes suportados. O sistema opera em escala macro (swing de semanas). */
/**
 * Timeframes suportados.
 *
 * Os intradiarios (1m a 30m) entraram para o motor de tempo real. O MMXM continua
 * calibrado para 1d/1w — as janelas macro medem ciclos semanais — e a interface
 * avisa quando e usado abaixo disso. As estrategias institucionais so usam o
 * timeframe como rotulo, por isso correm em qualquer um.
 */
export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w' | '1M';

/** Ordem de granularidade, do mais rapido para o mais lento. */
export const TIMEFRAME_ORDER: readonly Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'] as const;

/** Duracao aproximada de cada timeframe em milissegundos (calendario, nao pregao). */
export const TIMEFRAME_MS: Record<Timeframe, number> = {
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

export type AssetClass = 'forex' | 'index' | 'metal' | 'crypto' | 'commodity';

/** Instrumento canonico do sistema (simbolo interno, independente de provider). */
export interface Instrument {
  /** Simbolo canonico interno, ex.: 'EURUSD', 'NQ', 'XAUUSD', 'BTCUSD'. */
  symbol: string;
  /** Nome legivel, ex.: 'Euro / US Dollar'. */
  name: string;
  assetClass: AssetClass;
  /** Casas decimais usadas para arredondar precos ao exibir/persistir. */
  pricePrecision: number;
  /**
   * Valor de 1 "pip"/tick em unidades de preco. Usado apenas para formatacao e
   * para normalizar distancias entre instrumentos ao comparar deslocamentos.
   */
  tickSize: number;
  /** Se o mercado negocia 24/7 (cripto) ou tem pregao com gaps de fim de semana. */
  continuous: boolean;
}

/** Vela OHLCV. `time` e o timestamp de ABERTURA da vela, em ms UTC. */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Volume pode faltar em varias fontes de forex — 0 significa "sem dado". */
  volume: number;
}

/** Serie de velas de um instrumento num timeframe, ordenada por tempo crescente. */
export interface CandleSeries {
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[];
  /** Provider que forneceu os dados (para auditoria e health-check). */
  source: string;
  /**
   * 'true-ohlc' quando a fonte entrega maxima e minima reais; 'synthetic'
   * quando so ha uma cotacao por periodo (O=H=L=C). Os detectores de estrutura
   * exigem 'true-ohlc'.
   */
  fidelity: 'true-ohlc' | 'synthetic';
}

export type Direction = 'bullish' | 'bearish';

/** Lado da liquidez. Buyside = acima de maximas; sellside = abaixo de minimas. */
export type LiquiditySide = 'buyside' | 'sellside';

export function oppositeDirection(d: Direction): Direction {
  return d === 'bullish' ? 'bearish' : 'bullish';
}

export function directionOfSide(side: LiquiditySide): Direction {
  return side === 'buyside' ? 'bullish' : 'bearish';
}

/** True se a vela e de alta (corpo positivo). */
export function isUpCandle(c: Candle): boolean {
  return c.close > c.open;
}

export function candleRange(c: Candle): number {
  return c.high - c.low;
}

export function candleBody(c: Candle): number {
  return Math.abs(c.close - c.open);
}

/** Meio da vela — usado como referencia de "consequent encroachment" no ICT. */
export function candleMidpoint(c: Candle): number {
  return (c.high + c.low) / 2;
}
