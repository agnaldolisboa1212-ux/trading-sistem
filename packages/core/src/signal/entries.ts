/**
 * Padroes de entrada e Points Of Interest.
 *
 * O eBook e explicito sobre qual e o melhor: o "True Unicorn", que acrescenta
 * uma terceira camada ao unicorn classico do ICT.
 *
 *   Unicorn classico (ICT 2023):  Breaker Block + Fair Value Gap sobrepostos.
 *   True Unicorn (TOTK):          Breaker + FVG + Balanced Price Range, os tres
 *                                 a sobrepor-se na mesma zona de preco.
 *
 * O BPR e a peca que distingue os dois — e a sobreposicao de um FVG de alta com
 * um de baixa, sinal de que o algoritmo reprecificou a zona nos dois sentidos.
 */

import {
  detectBalancedPriceRanges,
  priceInGap,
  type BalancedPriceRange,
} from '../indicators/fvg.js';
import type { Candle, Direction } from '../types/market.js';
import type { FairValueGap, PriceBlock } from '../types/structure.js';

export type EntryPatternKind =
  | 'true-unicorn'
  | 'unicorn'
  | 'breaker'
  | 'fvg'
  | 'inverse-fvg'
  | 'mitigation-block';

export interface EntryPattern {
  kind: EntryPatternKind;
  direction: Direction;
  /** Zona de entrada. */
  low: number;
  high: number;
  /** Preco de entrada sugerido dentro da zona. */
  entry: number;
  index: number;
  time: number;
  /** Qualidade do padrao em 0..1. O True Unicorn e o topo da escala. */
  quality: number;
  /** Componentes que formaram o padrao, para auditoria. */
  components: string[];
  description: string;
}

/** Qualidade base por tipo de padrao, na hierarquia do eBook. */
const BASE_QUALITY: Record<EntryPatternKind, number> = {
  'true-unicorn': 1.0,
  unicorn: 0.85,
  'inverse-fvg': 0.7,
  breaker: 0.65,
  'mitigation-block': 0.6,
  fvg: 0.5,
};

export interface EntryDetectionInput {
  candles: Candle[];
  blocks: PriceBlock[];
  fvgs: FairValueGap[];
  /** Direcao exigida — so interessam padroes alinhados com o modelo. */
  direction: Direction;
  /** So considerar padroes formados a partir deste indice (ex.: apos o SMR). */
  fromIndex: number;
  /** Indice atual, para ignorar padroes ja invalidados. */
  currentIndex: number;
}

/**
 * Encontra todos os padroes de entrada validos, ordenados por qualidade.
 *
 * A deteccao e cumulativa: primeiro procura o True Unicorn (mais raro e mais
 * forte) e depois desce a hierarquia. Um mesmo breaker pode aparecer sozinho e
 * como parte de um unicorn — o consumidor deve usar apenas o primeiro da lista.
 */
export function detectEntryPatterns(input: EntryDetectionInput): EntryPattern[] {
  const { candles, blocks, fvgs, direction, fromIndex, currentIndex } = input;
  const out: EntryPattern[] = [];

  const relevantBlocks = blocks.filter(
    (b) =>
      b.direction === direction &&
      b.index >= fromIndex - 40 &&
      b.index <= currentIndex &&
      (b.invalidatedAtIndex === null || b.invalidatedAtIndex > currentIndex),
  );

  const relevantFvgs = fvgs.filter(
    (g) =>
      g.direction === direction &&
      g.index >= fromIndex - 40 &&
      g.index <= currentIndex &&
      (g.filledAtIndex === null || g.filledAtIndex > currentIndex),
  );

  const bprs = detectBalancedPriceRanges(
    fvgs.filter((g) => g.index >= fromIndex - 40 && g.index <= currentIndex),
    candles,
  );

  // --- Unicorns: breaker sobreposto a um FVG -------------------------------
  for (const block of relevantBlocks) {
    if (block.kind !== 'breaker') continue;

    for (const gap of relevantFvgs) {
      const low = Math.max(block.low, gap.low);
      const high = Math.min(block.high, gap.high);
      if (high <= low) continue;

      // O BPR tem de cair DENTRO da sobreposicao breaker+FVG.
      const bpr = findOverlappingBpr(bprs, low, high);
      const kind: EntryPatternKind = bpr ? 'true-unicorn' : 'unicorn';

      const components = [
        `breaker @${block.index}`,
        `fvg ${gap.direction} @${gap.index}`,
        ...(bpr ? [`bpr @${bpr.index}`] : []),
      ];

      out.push({
        kind,
        direction,
        low,
        high,
        // Entrada no CE do FVG quando existe, senao no meio da zona.
        entry: priceInGap(gap, (low + high) / 2) ? gap.ce : (low + high) / 2,
        index: Math.max(block.index, gap.index),
        time: candles[Math.max(block.index, gap.index)]?.time ?? 0,
        quality: scoreQuality(kind, block, gap, currentIndex),
        components,
        description:
          kind === 'true-unicorn'
            ? 'True Unicorn: Breaker Block + Fair Value Gap + Balanced Price Range sobrepostos — ' +
              'a assinatura algoritmica de maior probabilidade descrita no eBook.'
            : 'Unicorn: Breaker Block sobreposto a um Fair Value Gap. Falta o Balanced Price ' +
              'Range para ser um True Unicorn.',
      });
    }
  }

  // --- Breakers isolados ---------------------------------------------------
  for (const block of relevantBlocks) {
    if (block.kind !== 'breaker') continue;
    out.push(makeBlockPattern('breaker', block, candles, direction, currentIndex));
  }

  // --- Mitigation blocks ("old selling becomes new buying") ----------------
  for (const block of relevantBlocks) {
    if (block.kind !== 'mitigation') continue;
    out.push(makeBlockPattern('mitigation-block', block, candles, direction, currentIndex));
  }

  // --- Inverse FVGs --------------------------------------------------------
  for (const gap of fvgs) {
    if (gap.invertedAtIndex === null || gap.invertedAtIndex > currentIndex) continue;
    // Apos inverter, um FVG bullish passa a atuar como zona bearish.
    const actingDirection: Direction = gap.direction === 'bullish' ? 'bearish' : 'bullish';
    if (actingDirection !== direction) continue;
    if (gap.index < fromIndex - 40) continue;

    out.push({
      kind: 'inverse-fvg',
      direction,
      low: gap.low,
      high: gap.high,
      entry: gap.ce,
      index: gap.invertedAtIndex,
      time: candles[gap.invertedAtIndex]?.time ?? 0,
      quality: BASE_QUALITY['inverse-fvg'] * freshness(gap.invertedAtIndex, currentIndex),
      components: [`ifvg @${gap.index} invertido @${gap.invertedAtIndex}`],
      description:
        'Inversion FVG: gap que foi violado e agora atua no sentido contrario — ' +
        'usado como entrada na 1a fase de Acumulacao/Distribuicao.',
    });
  }

  // --- FVGs simples --------------------------------------------------------
  for (const gap of relevantFvgs) {
    out.push({
      kind: 'fvg',
      direction,
      low: gap.low,
      high: gap.high,
      entry: gap.ce,
      index: gap.index,
      time: gap.time,
      quality: BASE_QUALITY.fvg * freshness(gap.index, currentIndex),
      components: [`fvg @${gap.index}`],
      description: 'Fair Value Gap simples — entrada no Consequent Encroachment.',
    });
  }

  return out.sort((a, b) => b.quality - a.quality);
}

function makeBlockPattern(
  kind: EntryPatternKind,
  block: PriceBlock,
  candles: Candle[],
  direction: Direction,
  currentIndex: number,
): EntryPattern {
  return {
    kind,
    direction,
    low: block.low,
    high: block.high,
    entry: block.mid,
    index: block.index,
    time: block.time,
    quality: BASE_QUALITY[kind] * freshness(block.index, currentIndex),
    components: [`${block.kind} @${block.index}`],
    description:
      kind === 'breaker'
        ? 'Breaker Block: order block violado que passa a suportar/resistir no sentido oposto.'
        : 'Mitigation Block: zona do lado esquerdo da curva reutilizada no lado direito ' +
          '("old selling becomes new buying").',
  };
}

/** BPR que cai dentro da zona de sobreposicao breaker+FVG. */
function findOverlappingBpr(
  bprs: BalancedPriceRange[],
  low: number,
  high: number,
): BalancedPriceRange | null {
  return bprs.find((b) => b.high > low && b.low < high) ?? null;
}

/**
 * Penaliza padroes antigos. Uma zona formada ha 40 velas ja foi vista pelo
 * mercado muitas vezes e perdeu poder; uma recente ainda esta "fresca".
 */
function freshness(index: number, currentIndex: number): number {
  const age = Math.max(0, currentIndex - index);
  return Math.max(0.3, 1 - age / 60);
}

function scoreQuality(
  kind: EntryPatternKind,
  block: PriceBlock,
  gap: FairValueGap,
  currentIndex: number,
): number {
  const base = BASE_QUALITY[kind];
  const age = Math.min(freshness(block.index, currentIndex), freshness(gap.index, currentIndex));
  // Um breaker ainda nao mitigado vale mais que um ja testado.
  const untested = block.mitigatedAtIndex === null ? 1 : 0.85;
  return Math.min(1, base * age * untested);
}

/**
 * Point Of Interest: zona HTF onde se ANTECIPA a formacao do SMR.
 *
 * O checklist do eBook pergunta "Has price reached a HTF point of interest where
 * you anticipate an SMR forming?" — esta funcao responde a essa pergunta.
 */
export interface PointOfInterest {
  low: number;
  high: number;
  kind: 'htf-fvg' | 'htf-breaker' | 'htf-order-block';
  direction: Direction;
  timeframe: string;
  description: string;
}

/** True se o preco esta dentro de algum POI de timeframe superior. */
export function priceInPointOfInterest(
  price: number,
  pois: PointOfInterest[],
): { inside: boolean; poi: PointOfInterest | null } {
  const poi = pois.find((p) => price >= p.low && price <= p.high) ?? null;
  return { inside: poi !== null, poi };
}

/** Constroi POIs a partir das estruturas de um timeframe superior. */
export function buildPointsOfInterest(
  htfFvgs: FairValueGap[],
  htfBlocks: PriceBlock[],
  timeframe: string,
  direction: Direction,
  currentIndex: number,
): PointOfInterest[] {
  const out: PointOfInterest[] = [];

  for (const gap of htfFvgs) {
    if (gap.direction !== direction) continue;
    if (gap.filledAtIndex !== null && gap.filledAtIndex <= currentIndex) continue;
    out.push({
      low: gap.low,
      high: gap.high,
      kind: 'htf-fvg',
      direction,
      timeframe,
      description: `HTF ${timeframe} Fair Value Gap ${gap.direction} (${gap.low.toFixed(5)} - ${gap.high.toFixed(5)})`,
    });
  }

  for (const block of htfBlocks) {
    if (block.direction !== direction) continue;
    if (block.invalidatedAtIndex !== null && block.invalidatedAtIndex <= currentIndex) continue;
    out.push({
      low: block.low,
      high: block.high,
      kind: block.kind === 'breaker' ? 'htf-breaker' : 'htf-order-block',
      direction,
      timeframe,
      description: `HTF ${timeframe} ${block.kind} ${block.direction}`,
    });
  }

  return out;
}
