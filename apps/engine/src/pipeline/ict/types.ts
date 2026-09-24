// @ts-nocheck
import type { CandleSeries } from '@trading/core';

export interface IctPoint {
  index: number;
  price: number;
  timestamp: number;
  type: 'high' | 'low';
  significance: 'major' | 'minor';
}

export interface FVG {
  startIndex: number;
  endIndex: number;
  top: number;
  bottom: number;
  type: 'bullish' | 'bearish';
  mitigated: boolean;
  volumeProfile: number;
}

export interface OrderBlock {
  startIndex: number;
  top: number;
  bottom: number;
  type: 'bullish' | 'bearish';
  mitigated: boolean;
  consequentEncroachment: number; // 50% level
}

export interface MarketStructureShift {
  index: number;
  type: 'bullish' | 'bearish';
  price: number;
  displacement: boolean; // Confirmação de volume/força
}

export interface LiquidityPool {
  id: string;
  price: number;
  type: 'buyside' | 'sellside';
  swept: boolean;
  sweepIndex?: number;
  age: number; // Quantas velas atrás se formou
  strength: number; // Duplo topo = forte, swing normal = medio
}

export interface AsianRange {
  high: number;
  low: number;
  midpoint: number;
}

export interface Killzone {
  name: 'London' | 'NY AM' | 'NY PM' | 'London Close';
  startHour: number;
  endHour: number;
  active: boolean;
}

export interface RiskProfile {
  maxDrawdown: number;
  lotSize: number;
  dynamicStopLoss: number;
}
