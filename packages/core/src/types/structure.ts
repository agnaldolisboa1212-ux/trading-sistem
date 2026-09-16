/**
 * Tipos das estruturas ICT detectadas sobre uma serie de velas.
 *
 * Toda estrutura carrega `index` (posicao na serie) e `time` (ms UTC) para que
 * possa ser persistida no Supabase e re-ancorada sem depender do array original.
 */

import type { Direction, LiquiditySide, Timeframe } from './market.js';

/**
 * Grau de um swing point, na nomenclatura ICT:
 * - short-term (STH/STL): maxima/minima com uma vela menor de cada lado.
 * - intermediate-term (ITH/ITL): swing cercado por dois short-term menores.
 * - long-term (LTH/LTL): swing cercado por dois intermediate-term menores.
 *
 * O MMXM e construido sobre swings intermediate e long-term; os short-term
 * servem para detectar CISD/MSS e para o Silver Bullet.
 */
export type SwingDegree = 'short' | 'intermediate' | 'long';

export interface SwingPoint {
  index: number;
  time: number;
  price: number;
  /** 'high' = topo (buyside liquidity acima), 'low' = fundo (sellside abaixo). */
  kind: 'high' | 'low';
  degree: SwingDegree;
}

/**
 * Fair Value Gap (imbalance de 3 velas).
 * BISI = Buyside Imbalance Sellside Inefficiency (gap de alta).
 * SIBI = Sellside Imbalance Buyside Inefficiency (gap de baixa).
 */
export interface FairValueGap {
  /** Indice da vela do MEIO (a de displacement). */
  index: number;
  time: number;
  direction: Direction;
  /** Limite inferior do gap. */
  low: number;
  /** Limite superior do gap. */
  high: number;
  /** Consequent Encroachment: ponto medio do gap, alvo classico de retracao. */
  ce: number;
  /** Indice da vela que preencheu totalmente o gap, se ja preenchido. */
  filledAtIndex: number | null;
  /** Indice em que o gap foi invertido (fechou do outro lado) — vira IFVG. */
  invertedAtIndex: number | null;
  /** Tamanho do gap em unidades de preco. */
  size: number;
}

/**
 * Order Block: ultima vela contraria antes de um displacement.
 * Breaker Block: order block que FALHOU (foi violado) e agora atua ao contrario.
 * Mitigation Block: order block do lado esquerdo da curva reutilizado a direita.
 */
export type BlockKind = 'order-block' | 'breaker' | 'mitigation' | 'rejection';

export interface PriceBlock {
  index: number;
  time: number;
  kind: BlockKind;
  /** Direcao em que o bloco deve empurrar o preco quando revisitado. */
  direction: Direction;
  low: number;
  high: number;
  /** Ponto medio do bloco. */
  mid: number;
  /** Indice em que o bloco foi mitigado (tocado) pela primeira vez. */
  mitigatedAtIndex: number | null;
  /** Indice em que o bloco foi invalidado (atravessado por fechamento). */
  invalidatedAtIndex: number | null;
}

/**
 * Poco de liquidez: cluster de maximas/minimas relativamente iguais, ou nivel
 * de referencia temporal (PWH/PWL, PMH/PML...).
 */
export type LiquidityOrigin =
  | 'equal-levels'
  | 'previous-day'
  | 'previous-week'
  | 'previous-month'
  | 'previous-quarter'
  | 'previous-year'
  | 'swing';

export interface LiquidityPool {
  side: LiquiditySide;
  price: number;
  origin: LiquidityOrigin;
  /** Indices das velas que formam o cluster (vazio para niveis temporais). */
  memberIndices: number[];
  /** Quantas vezes o nivel foi respeitado — quanto maior, mais liquidez presa. */
  touches: number;
  time: number;
  /** Indice em que a liquidez foi varrida (purged), se ja ocorreu. */
  sweptAtIndex: number | null;
}

/**
 * Change In State of Delivery / Market Structure Shift.
 *
 * CISD: o preco fecha alem do open da ultima sequencia de velas contrarias —
 * sinaliza troca de programa (buy program <-> sell program).
 * MSS: displacement que rompe um swing point de grau relevante.
 */
export interface StructureShift {
  index: number;
  time: number;
  /** Direcao do NOVO programa. */
  direction: Direction;
  type: 'cisd' | 'mss';
  /** Nivel rompido (open da sequencia para CISD; preco do swing para MSS). */
  level: number;
  /** Grau do swing rompido (apenas para MSS). */
  degree: SwingDegree | null;
  /** True se o rompimento veio com displacement (vela de expansao + FVG). */
  withDisplacement: boolean;
  /** Indice do swing rompido, quando aplicavel. */
  brokenSwingIndex: number | null;
}

/** Snapshot completo das estruturas de um instrumento num timeframe. */
export interface StructureSnapshot {
  symbol: string;
  timeframe: Timeframe;
  /** Timestamp da ultima vela FECHADA considerada. */
  asOf: number;
  swings: SwingPoint[];
  fvgs: FairValueGap[];
  blocks: PriceBlock[];
  pools: LiquidityPool[];
  shifts: StructureShift[];
  /** Direcao do fluxo institucional dominante inferido da estrutura. */
  orderFlow: Direction | 'neutral';
}
