/**
 * Maquina de estados do Market Maker Model (MMXM).
 *
 * Sequencia completa, tal como o eBook a descreve:
 *
 *   consolidacao original  (liquidez engenheirada de um lado)
 *        |
 *   lado ESQUERDO da curva (1-3 expansoes + retracoes, na direcao CONTRARIA ao
 *        |                  destino final — vai varrer a liquidez oposta)
 *   Smart Money Reversal   (key price level + key time; sweep + CISD/MSS + SMT)
 *        |
 *   lado DIREITO da curva  (1-3 expansoes na direcao final, com tres fases de
 *        |                  entrada: LRB/LRS -> 1a Acc/Dist -> Silver Bullet)
 *   completado             (preco atravessa a consolidacao original)
 *
 * MMBM: consolidacao com equal HIGHS -> curva esquerda desce -> curva direita
 *       sobe -> completa acima da consolidacao.
 * MMSM: consolidacao com equal LOWS  -> curva esquerda sobe  -> curva direita
 *       desce -> completa abaixo da consolidacao.
 */

import { computeAtr } from '../indicators/fvg.js';
import { oppositeDirection, type Candle, type Direction } from '../types/market.js';
import type { LiquidityPool, StructureShift, SwingPoint } from '../types/structure.js';
import {
  detectConsolidations,
  impliedModelDirection,
  isModelCompleted,
  type Consolidation,
  type ConsolidationOptions,
} from './consolidation.js';

/** MMBM = Market Maker Buy Model; MMSM = Market Maker Sell Model. */
export type MmxmType = 'MMBM' | 'MMSM';

export type MmxmPhase =
  | 'original-consolidation'
  | 'left-curve'
  | 'smart-money-reversal'
  | 'right-curve-low-risk-entry'
  | 'right-curve-stage-1'
  | 'right-curve-silver-bullet'
  | 'completed'
  | 'invalidated';

/** Fase de entrada, na nomenclatura exata do eBook. */
export type EntryStage = 'low-risk-buy-sell' | 'first-stage-acc-dist' | 'silver-bullet' | null;

export interface SmartMoneyReversal {
  index: number;
  time: number;
  /** Preco extremo atingido — o ponto de viragem. */
  price: number;
  /** Direcao do NOVO programa apos a reversao. */
  direction: Direction;
  /** Poco de liquidez varrido imediatamente antes da reversao, se houve. */
  sweptPool: LiquidityPool | null;
  /** Shift (CISD ou MSS) que confirmou a troca de programa. */
  confirmation: StructureShift | null;
  /** Componentes presentes, para auditoria do sinal. */
  components: {
    liquiditySweep: boolean;
    cisd: boolean;
    mss: boolean;
    displacement: boolean;
  };
  /** Confianca 0..1 baseada nos componentes presentes. */
  confidence: number;
}

export interface MmxmModel {
  type: MmxmType;
  /** Direcao final do modelo (para onde a curva direita entrega). */
  direction: Direction;
  phase: MmxmPhase;
  entryStage: EntryStage;
  consolidation: Consolidation;
  /** Indice do extremo do lado esquerdo da curva. */
  leftCurveExtremeIndex: number | null;
  leftCurveExtremePrice: number | null;
  smr: SmartMoneyReversal | null;
  /** Quantas expansoes/retracoes ja ocorreram no lado direito. */
  rightCurveLegs: number;
  /** Indice em que o modelo completou, se completou. */
  completedAtIndex: number | null;
  /** Nivel cuja perda invalida o modelo. */
  invalidationLevel: number | null;
  /** Alvo estrutural: a consolidacao original. */
  targetLevel: number;
  /** Confianca agregada do modelo em 0..1. */
  confidence: number;
  notes: string[];
}

export interface MmxmDetectionInput {
  candles: Candle[];
  swings: SwingPoint[];
  shifts: StructureShift[];
  pools: LiquidityPool[];
  consolidationOptions?: ConsolidationOptions;
  /** Quantas velas apos o extremo se aceita a confirmacao do SMR. */
  smrConfirmationWindow?: number;
  /**
   * Direcao da narrativa de timeframe superior.
   *
   * O checklist do eBook pergunta pelo fluxo institucional HTF (passo 2) ANTES
   * de definir o modelo de entrada (passo 7) — a narrativa vem primeiro e o
   * modelo e escolhido para a servir. Sem esta preferencia, o detector devolvia
   * simplesmente o MMXM mais recente, que muitas vezes aponta contra a
   * narrativa, e o checklist morria no passo 2 mesmo existindo um modelo
   * alinhado poucas velas atras.
   */
  preferDirection?: Direction | 'neutral';
}

/**
 * Detecta o MMXM ATIVO mais recente.
 *
 * Percorre as consolidacoes de tras para a frente e devolve o primeiro modelo
 * que ainda nao completou nem foi invalidado. Se todos completaram, devolve o
 * mais recente (util para relatorio historico).
 */
export function detectActiveMmxm(input: MmxmDetectionInput): MmxmModel | null {
  const models = detectAllMmxm(input);
  if (models.length === 0) return null;

  const active = models
    .filter((m) => m.phase !== 'completed' && m.phase !== 'invalidated')
    .sort((a, b) => b.consolidation.endIndex - a.consolidation.endIndex);

  // Entre os modelos vivos, prefere o que serve a narrativa HTF; so quando
  // nenhum a serve e que devolve o mais recente.
  const prefer = input.preferDirection;
  if (prefer && prefer !== 'neutral') {
    const aligned = active.find((m) => m.direction === prefer);
    if (aligned) return aligned;
  }

  return active[0] ?? models[models.length - 1] ?? null;
}

/** Constroi um MMXM para cada consolidacao com liquidez engenheirada. */
export function detectAllMmxm(input: MmxmDetectionInput): MmxmModel[] {
  const { candles, swings, shifts, pools } = input;
  const consolidations = detectConsolidations(candles, swings, input.consolidationOptions);
  const atr = computeAtr(candles);
  const out: MmxmModel[] = [];

  for (const consolidation of consolidations) {
    const direction = impliedModelDirection(consolidation);
    if (!direction) continue;

    const type: MmxmType = direction === 'bullish' ? 'MMBM' : 'MMSM';
    const leftDirection = oppositeDirection(direction);
    const notes: string[] = [];

    // --- Lado esquerdo da curva: procurar o extremo apos a consolidacao ------
    const searchStart = consolidation.endIndex + 1;
    if (searchStart >= candles.length) continue;

    const extreme = findCurveExtreme(candles, searchStart, leftDirection);
    if (!extreme) continue;

    // O extremo tem de sair mesmo do range — senao ainda estamos a consolidar.
    const reference = atr[extreme.index] ?? 0;
    const escaped =
      leftDirection === 'bearish'
        ? extreme.price < consolidation.low - reference * 0.5
        : extreme.price > consolidation.high + reference * 0.5;

    if (!escaped) {
      out.push(
        buildModel({
          type,
          direction,
          phase: 'original-consolidation',
          consolidation,
          extreme: null,
          smr: null,
          rightCurveLegs: 0,
          completedAtIndex: null,
          notes: ['Preco ainda dentro da consolidacao original — a aguardar o lado esquerdo da curva.'],
        }),
      );
      continue;
    }

    // --- Smart Money Reversal no extremo ------------------------------------
    const smr = detectSmartMoneyReversal({
      candles,
      shifts,
      pools,
      extremeIndex: extreme.index,
      extremePrice: extreme.price,
      newDirection: direction,
      sweepSide: leftDirection === 'bearish' ? 'sellside' : 'buyside',
      window: input.smrConfirmationWindow ?? 6,
    });

    if (!smr || smr.confirmation === null) {
      out.push(
        buildModel({
          type,
          direction,
          phase: 'left-curve',
          consolidation,
          extreme,
          smr,
          rightCurveLegs: 0,
          completedAtIndex: null,
          notes: [
            'Lado esquerdo da curva em desenvolvimento. Ainda sem confirmacao de ' +
              'Smart Money Reversal (falta CISD/MSS na direcao do modelo).',
          ],
        }),
      );
      continue;
    }

    // --- Lado direito da curva ---------------------------------------------
    const completion = isModelCompleted(consolidation, direction, candles, smr.index);
    const legs = countRightCurveLegs(swings, smr.index, direction);

    let phase: MmxmPhase;
    if (completion.completed) {
      phase = 'completed';
      notes.push(
        `Modelo completo: o preco atravessou a consolidacao original em ${new Date(
          candles[completion.atIndex ?? 0]?.time ?? 0,
        ).toISOString().slice(0, 10)}.`,
      );
    } else if (legs <= 0) {
      phase = 'right-curve-low-risk-entry';
      notes.push('Fase Low Risk Buy/Sell — primeira entrada apos o Smart Money Reversal.');
    } else if (legs === 1) {
      phase = 'right-curve-stage-1';
      notes.push(
        'Primeira fase de Acumulacao/Distribuicao — segundo swing intermediate a formar-se.',
      );
    } else {
      phase = 'right-curve-silver-bullet';
      notes.push(
        'Fase Silver Bullet — o preco ja esta proximo do draw on liquidity; ' +
          'entrega mais rapida esperada.',
      );
    }

    // Invalidacao: perder o extremo do lado esquerdo mata o modelo.
    const invalidationLevel = extreme.price;
    const invalidated = hasInvalidated(candles, smr.index, direction, invalidationLevel);
    if (invalidated && phase !== 'completed') {
      phase = 'invalidated';
      notes.push('Modelo invalidado: o preco fechou alem do extremo da curva esquerda.');
    }

    out.push(
      buildModel({
        type,
        direction,
        phase,
        consolidation,
        extreme,
        smr,
        rightCurveLegs: legs,
        completedAtIndex: completion.atIndex,
        notes,
      }),
    );
  }

  return out;
}

// ---------------------------------------------------------------------------

interface BuildModelInput {
  type: MmxmType;
  direction: Direction;
  phase: MmxmPhase;
  consolidation: Consolidation;
  extreme: { index: number; price: number } | null;
  smr: SmartMoneyReversal | null;
  rightCurveLegs: number;
  completedAtIndex: number | null;
  notes: string[];
}

function buildModel(input: BuildModelInput): MmxmModel {
  const entryStage = stageForPhase(input.phase);

  // O alvo estrutural e o lado da consolidacao para onde a curva direita entrega.
  const targetLevel =
    input.direction === 'bullish' ? input.consolidation.high : input.consolidation.low;

  return {
    type: input.type,
    direction: input.direction,
    phase: input.phase,
    entryStage,
    consolidation: input.consolidation,
    leftCurveExtremeIndex: input.extreme?.index ?? null,
    leftCurveExtremePrice: input.extreme?.price ?? null,
    smr: input.smr,
    rightCurveLegs: input.rightCurveLegs,
    completedAtIndex: input.completedAtIndex,
    invalidationLevel: input.extreme?.price ?? null,
    targetLevel,
    confidence: scoreModel(input),
    notes: input.notes,
  };
}

function stageForPhase(phase: MmxmPhase): EntryStage {
  switch (phase) {
    case 'right-curve-low-risk-entry':
      return 'low-risk-buy-sell';
    case 'right-curve-stage-1':
      return 'first-stage-acc-dist';
    case 'right-curve-silver-bullet':
      return 'silver-bullet';
    default:
      return null;
  }
}

/**
 * Confianca do modelo.
 *
 * Pondera a qualidade da consolidacao (liquidez engenheirada e compressao) e a
 * forca do Smart Money Reversal. Modelos sem SMR confirmado ficam abaixo de 0.5
 * e nunca produzem sinal executavel.
 */
function scoreModel(input: BuildModelInput): number {
  let score = 0;

  // Qualidade da consolidacao: quantos toques no nivel engenheirado.
  const touches = input.consolidation.engineeredTouches;
  score += Math.min(0.2, touches * 0.05);
  score += Math.min(0.1, input.consolidation.compression * 0.2);

  // Forca do SMR.
  if (input.smr) score += input.smr.confidence * 0.5;

  // Fase: quanto mais avancado o lado direito, mais o modelo se provou.
  switch (input.phase) {
    case 'right-curve-low-risk-entry':
      score += 0.12;
      break;
    case 'right-curve-stage-1':
      score += 0.16;
      break;
    case 'right-curve-silver-bullet':
      score += 0.2;
      break;
    case 'invalidated':
      return 0;
    default:
      break;
  }

  return Math.max(0, Math.min(1, score));
}

/** Extremo (minima ou maxima) alcancado a partir de `from`, na direcao dada. */
function findCurveExtreme(
  candles: Candle[],
  from: number,
  direction: Direction,
): { index: number; price: number } | null {
  let bestIndex = -1;
  let bestPrice = direction === 'bearish' ? Infinity : -Infinity;

  for (let i = from; i < candles.length; i++) {
    const c = candles[i];
    if (!c) continue;
    if (direction === 'bearish' ? c.low < bestPrice : c.high > bestPrice) {
      bestPrice = direction === 'bearish' ? c.low : c.high;
      bestIndex = i;
    }
  }

  return bestIndex >= 0 ? { index: bestIndex, price: bestPrice } : null;
}

interface SmrInput {
  candles: Candle[];
  shifts: StructureShift[];
  pools: LiquidityPool[];
  extremeIndex: number;
  extremePrice: number;
  newDirection: Direction;
  sweepSide: 'buyside' | 'sellside';
  window: number;
}

/**
 * Confirma (ou nao) um Smart Money Reversal no extremo da curva esquerda.
 *
 * Do eBook: "The Smart Money Reversal takes place at Key Price Levels during Key
 * Time Windows" e e confirmado pelas assinaturas — sweep de liquidez seguido de
 * change in the state of delivery.
 *
 * O alinhamento temporal NAO e avaliado aqui: e responsabilidade do modulo
 * `time/windows.ts`, para que a regra dos macros fique num so sitio.
 */
export function detectSmartMoneyReversal(input: SmrInput): SmartMoneyReversal | null {
  const { candles, shifts, pools, extremeIndex, extremePrice, newDirection, sweepSide } = input;
  const candle = candles[extremeIndex];
  if (!candle) return null;

  // 1. Houve varrimento de um poco de liquidez neste extremo?
  const sweptPool =
    pools.find(
      (p) =>
        p.side === sweepSide &&
        p.sweptAtIndex !== null &&
        Math.abs(p.sweptAtIndex - extremeIndex) <= input.window &&
        (sweepSide === 'sellside' ? extremePrice < p.price : extremePrice > p.price),
    ) ?? null;

  // 2. Houve CISD ou MSS na direcao do novo programa logo apos o extremo?
  const following = shifts.filter(
    (s) =>
      s.direction === newDirection &&
      s.index >= extremeIndex &&
      s.index <= extremeIndex + input.window,
  );

  const cisd = following.find((s) => s.type === 'cisd') ?? null;
  const mss = following.find((s) => s.type === 'mss') ?? null;
  // O MSS e mais forte que o CISD; se ambos existem, o MSS confirma.
  const confirmation = mss ?? cisd;

  const components = {
    liquiditySweep: sweptPool !== null,
    cisd: cisd !== null,
    mss: mss !== null,
    displacement: following.some((s) => s.withDisplacement),
  };

  // Confianca: o sweep e o CISD/MSS sao os dois pilares; displacement e bonus.
  let confidence = 0;
  if (components.liquiditySweep) confidence += 0.35;
  if (components.cisd) confidence += 0.25;
  if (components.mss) confidence += 0.3;
  if (components.displacement) confidence += 0.1;
  confidence = Math.min(1, confidence);

  return {
    index: confirmation?.index ?? extremeIndex,
    time: candles[confirmation?.index ?? extremeIndex]?.time ?? candle.time,
    price: extremePrice,
    direction: newDirection,
    sweptPool,
    confirmation,
    components,
    confidence,
  };
}

/**
 * Conta as pernas ja entregues no lado direito da curva.
 *
 * Uma "perna" e um swing intermediate na direcao do modelo formado apos o SMR.
 * O eBook diz que o lado direito costuma ter 1-3 expansoes seguidas de
 * retracoes — e este contador que decide se estamos no LRB/LRS, na 1a fase de
 * Acumulacao/Distribuicao ou no Silver Bullet.
 */
function countRightCurveLegs(
  swings: SwingPoint[],
  fromIndex: number,
  direction: Direction,
): number {
  // Num modelo bullish, as retracoes formam swing LOWS progressivamente mais
  // altos; cada um marca o fim de uma perna.
  const kind = direction === 'bullish' ? 'low' : 'high';
  return swings.filter(
    (s) => s.index > fromIndex && s.kind === kind && s.degree !== 'short',
  ).length;
}

/** True se o preco fechou alem do nivel de invalidacao apos o SMR. */
function hasInvalidated(
  candles: Candle[],
  fromIndex: number,
  direction: Direction,
  level: number,
): boolean {
  for (let i = fromIndex + 1; i < candles.length; i++) {
    const c = candles[i];
    if (!c) continue;
    if (direction === 'bullish' ? c.close < level : c.close > level) return true;
  }
  return false;
}
