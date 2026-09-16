/**
 * Universo de instrumentos monitorizados e os pares SMT.
 *
 * O SMT so existe em PARES — um instrumento sozinho nao pode divergir. Por isso
 * o universo e desenhado em blocos correlacionados, nao como uma lista solta.
 */

import type { Instrument } from './types/market.js';
import type { SmtPair } from './smt/divergence.js';

export const INSTRUMENTS: readonly Instrument[] = Object.freeze([
  // --- Forex majors + indice do dolar --------------------------------------
  { symbol: 'EURUSD', name: 'Euro / US Dollar', assetClass: 'forex', pricePrecision: 5, tickSize: 0.0001, continuous: false },
  { symbol: 'GBPUSD', name: 'British Pound / US Dollar', assetClass: 'forex', pricePrecision: 5, tickSize: 0.0001, continuous: false },
  { symbol: 'AUDUSD', name: 'Australian Dollar / US Dollar', assetClass: 'forex', pricePrecision: 5, tickSize: 0.0001, continuous: false },
  { symbol: 'NZDUSD', name: 'New Zealand Dollar / US Dollar', assetClass: 'forex', pricePrecision: 5, tickSize: 0.0001, continuous: false },
  { symbol: 'USDCHF', name: 'US Dollar / Swiss Franc', assetClass: 'forex', pricePrecision: 5, tickSize: 0.0001, continuous: false },
  { symbol: 'USDJPY', name: 'US Dollar / Japanese Yen', assetClass: 'forex', pricePrecision: 3, tickSize: 0.01, continuous: false },
  { symbol: 'USDCAD', name: 'US Dollar / Canadian Dollar', assetClass: 'forex', pricePrecision: 5, tickSize: 0.0001, continuous: false },
  { symbol: 'DXY', name: 'US Dollar Index', assetClass: 'forex', pricePrecision: 3, tickSize: 0.01, continuous: false },

  // --- Indices US ----------------------------------------------------------
  { symbol: 'NQ', name: 'Nasdaq 100', assetClass: 'index', pricePrecision: 2, tickSize: 0.25, continuous: false },
  { symbol: 'ES', name: 'S&P 500', assetClass: 'index', pricePrecision: 2, tickSize: 0.25, continuous: false },
  { symbol: 'YM', name: 'Dow Jones 30', assetClass: 'index', pricePrecision: 2, tickSize: 1, continuous: false },
  { symbol: 'RTY', name: 'Russell 2000', assetClass: 'index', pricePrecision: 2, tickSize: 0.1, continuous: false },

  // --- Metais --------------------------------------------------------------
  { symbol: 'XAUUSD', name: 'Gold / US Dollar', assetClass: 'metal', pricePrecision: 2, tickSize: 0.01, continuous: false },
  { symbol: 'XAGUSD', name: 'Silver / US Dollar', assetClass: 'metal', pricePrecision: 3, tickSize: 0.001, continuous: false },

  // --- Cripto --------------------------------------------------------------
  { symbol: 'BTCUSD', name: 'Bitcoin / US Dollar', assetClass: 'crypto', pricePrecision: 2, tickSize: 0.01, continuous: true },
  { symbol: 'ETHUSD', name: 'Ethereum / US Dollar', assetClass: 'crypto', pricePrecision: 2, tickSize: 0.01, continuous: true },
  { symbol: 'SOLUSD', name: 'Solana / US Dollar', assetClass: 'crypto', pricePrecision: 3, tickSize: 0.001, continuous: true },
]);

export function getInstrument(symbol: string): Instrument | undefined {
  return INSTRUMENTS.find((i) => i.symbol === symbol);
}

/**
 * Pares SMT.
 *
 * `weight` reflete a fiabilidade da relacao: NQ/ES e o par canonico do ICT e
 * quase nunca falha; ja XAU/DXY tem correlacao inversa forte mas com periodos
 * de descolamento (crises de risco), por isso pesa menos.
 *
 * Cada instrumento aparece como `primary` com varias referencias diferentes —
 * quando diverge contra VARIAS ao mesmo tempo, o sinal e muito mais fiavel
 * (ver `aggregateSmtConfluence`).
 */
export const SMT_PAIRS: readonly SmtPair[] = Object.freeze([
  // Indices US — o SMT classico do ICT.
  { primary: 'NQ', reference: 'ES', correlation: 'positive', weight: 1.0, notes: 'Par canonico do ICT.' },
  { primary: 'ES', reference: 'NQ', correlation: 'positive', weight: 1.0 },
  { primary: 'NQ', reference: 'YM', correlation: 'positive', weight: 0.8 },
  { primary: 'ES', reference: 'YM', correlation: 'positive', weight: 0.8 },
  { primary: 'YM', reference: 'ES', correlation: 'positive', weight: 0.8 },
  { primary: 'NQ', reference: 'RTY', correlation: 'positive', weight: 0.6, notes: 'Small caps descolam em risk-off.' },

  // Forex — correlacionados entre si e inversos ao DXY.
  { primary: 'EURUSD', reference: 'GBPUSD', correlation: 'positive', weight: 1.0, notes: 'Exemplo direto do eBook ($EU vs $GU).' },
  { primary: 'GBPUSD', reference: 'EURUSD', correlation: 'positive', weight: 1.0 },
  { primary: 'EURUSD', reference: 'DXY', correlation: 'inverse', weight: 1.0, notes: 'Exemplo direto do eBook ($DXY vs $EU).' },
  { primary: 'GBPUSD', reference: 'DXY', correlation: 'inverse', weight: 0.9 },
  { primary: 'EURUSD', reference: 'USDCHF', correlation: 'inverse', weight: 0.85 },
  { primary: 'AUDUSD', reference: 'NZDUSD', correlation: 'positive', weight: 0.9, notes: 'Par commodity currencies.' },
  { primary: 'NZDUSD', reference: 'AUDUSD', correlation: 'positive', weight: 0.9 },
  { primary: 'AUDUSD', reference: 'DXY', correlation: 'inverse', weight: 0.75 },
  { primary: 'USDJPY', reference: 'DXY', correlation: 'positive', weight: 0.7 },
  { primary: 'USDCAD', reference: 'DXY', correlation: 'positive', weight: 0.65 },

  // Metais.
  { primary: 'XAUUSD', reference: 'XAGUSD', correlation: 'positive', weight: 0.9, notes: 'Ouro vs Prata.' },
  { primary: 'XAGUSD', reference: 'XAUUSD', correlation: 'positive', weight: 0.9 },
  { primary: 'XAUUSD', reference: 'DXY', correlation: 'inverse', weight: 0.7, notes: 'Descola em crises de liquidez.' },

  // Cripto.
  { primary: 'BTCUSD', reference: 'ETHUSD', correlation: 'positive', weight: 0.9 },
  { primary: 'ETHUSD', reference: 'BTCUSD', correlation: 'positive', weight: 0.9 },
  { primary: 'BTCUSD', reference: 'SOLUSD', correlation: 'positive', weight: 0.6 },
  { primary: 'ETHUSD', reference: 'SOLUSD', correlation: 'positive', weight: 0.6 },
]);

/** Todos os pares em que `symbol` e o instrumento principal. */
export function smtPairsFor(symbol: string): SmtPair[] {
  return SMT_PAIRS.filter((p) => p.primary === symbol);
}

/** Simbolos que precisam de ser carregados para avaliar `symbol` (ele + referencias). */
export function requiredSymbolsFor(symbol: string): string[] {
  const refs = smtPairsFor(symbol).map((p) => p.reference);
  return [...new Set([symbol, ...refs])];
}

/** Todos os simbolos que o pipeline precisa de carregar para o universo inteiro. */
export function allRequiredSymbols(): string[] {
  const set = new Set<string>();
  for (const i of INSTRUMENTS) set.add(i.symbol);
  for (const p of SMT_PAIRS) {
    set.add(p.primary);
    set.add(p.reference);
  }
  return [...set];
}
