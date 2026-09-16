/**
 * Sinais de SAIDA — a metade da estrategia que costuma ser ignorada.
 *
 * O eBook define a saida estruturalmente ("participate until the original
 * consolidation is reached") e pelo iman ("draw on liquidity"). Este modulo
 * acrescenta as saidas defensivas que qualquer operacao de semanas precisa:
 * quebra de estrutura contra a posicao, reversao do SMT e time stop.
 */

import { buildSwingLadder, classifyOrderFlow } from '../indicators/swings.js';
import { detectStructureShifts } from '../indicators/shifts.js';
import type { CandleSeries, Direction } from '../types/market.js';
import type { ExitSignal, TradeSignal } from '../types/signal.js';
import type { TargetPlan } from '../risk/sizing.js';
import type { SmtEvent } from '../smt/divergence.js';

/**
 * O que a avaliacao de saidas precisa de saber sobre a operacao.
 *
 * Deliberadamente MAIS ESTREITO que `TradeSignal`. A versao anterior exigia o
 * sinal inteiro — com o modelo MMXM, o checklist e os eventos SMT — o que
 * tornava impossivel avaliar saidas a partir do estado gravado na base de dados
 * sem reconstruir tudo isso primeiro.
 *
 * Este plano e FIXADO quando a posicao abre e nunca mais muda. Se dependesse do
 * modelo atual, uma reanalise podia mover a consolidacao ou os alvos por baixo
 * de uma posicao ja aberta.
 */
export interface ExitPlan {
  signalId: string;
  symbol: string;
  direction: Direction;
  /** Entrada PLANEADA — a base do calculo de R. */
  entryPrice: number;
  /** Stop inicial. O stop corrente vive na posicao, nao aqui. */
  stopLoss: number;
  targets: TargetPlan[];
  /** Range da consolidacao original, para a saida "modelo completo". */
  consolidationHigh: number;
  consolidationLow: number;
  expectedHorizonDays: number;
}

/** Extrai o plano de saida de um sinal acabado de gerar. */
export function exitPlanFromSignal(signal: TradeSignal): ExitPlan {
  return {
    signalId: signal.id,
    symbol: signal.symbol,
    direction: signal.direction,
    entryPrice: signal.entryPrice,
    stopLoss: signal.stopLoss,
    targets: signal.targets,
    consolidationHigh: signal.model.consolidation.high,
    consolidationLow: signal.model.consolidation.low,
    expectedHorizonDays: signal.expectedHorizonDays,
  };
}

export interface OpenPosition {
  plan: ExitPlan;
  /** Preco medio de entrada efetivo. */
  filledPrice: number;
  /** Fracao da posicao ainda aberta (1 = intacta). */
  remainingFraction: number;
  /** Stop atual — pode ter sido movido para break-even. */
  currentStop: number;
  /** Alvos ja atingidos, por indice no array de targets. */
  hitTargets: number[];
  openedAt: number;
}

export interface ExitEvaluationInput {
  position: OpenPosition;
  series: CandleSeries;
  /** SMT detetado agora, para verificar reversao contra a posicao. */
  currentSmt: SmtEvent[];
  now?: number;
  /** Dias apos os quais uma operacao parada e encerrada. */
  timeStopDays?: number;
}

/**
 * Avalia todas as condicoes de saida e devolve as que dispararam.
 *
 * Devolve uma LISTA porque varias podem ocorrer na mesma vela (ex.: atingiu o
 * alvo 1 e a estrutura quebrou). O consumidor aplica-as por ordem.
 */
export function evaluateExits(input: ExitEvaluationInput): ExitSignal[] {
  const { position, series } = input;
  const now = input.now ?? Date.now();
  const plan = position.plan;
  const candles = series.candles;
  const current = candles[candles.length - 1];
  if (!current) return [];

  const out: ExitSignal[] = [];
  const direction = plan.direction;
  const risk = Math.abs(plan.entryPrice - plan.stopLoss);
  const rOf = (price: number) =>
    risk > 0
      ? direction === 'bullish'
        ? (price - position.filledPrice) / risk
        : (position.filledPrice - price) / risk
      : 0;

  // --- 1. Stop atingido ----------------------------------------------------
  const stopHit =
    direction === 'bullish' ? current.low <= position.currentStop : current.high >= position.currentStop;

  if (stopHit) {
    return [
      {
        signalId: plan.signalId,
        symbol: plan.symbol,
        reason: 'stop-hit',
        closeFraction: position.remainingFraction,
        price: position.currentStop,
        time: current.time,
        newStopLoss: null,
        rMultipleRealized: rOf(position.currentStop),
        narrative:
          `Stop atingido em ${position.currentStop.toFixed(5)}. ` +
          'O modelo perdeu o extremo da curva esquerda — a tese esta invalidada.',
      },
    ];
  }

  // --- 2. Alvos atingidos --------------------------------------------------
  plan.targets.forEach((target, i) => {
    if (position.hitTargets.includes(i)) return;
    const reached =
      direction === 'bullish' ? current.high >= target.price : current.low <= target.price;
    if (!reached) return;

    // Ao atingir o primeiro alvo movemos o stop para break-even: a partir
    // daqui a operacao nao pode mais dar prejuizo.
    const newStop = i === 0 ? position.filledPrice : null;

    out.push({
      signalId: plan.signalId,
      symbol: plan.symbol,
      reason: 'target-hit',
      closeFraction: target.closeFraction,
      price: target.price,
      time: current.time,
      newStopLoss: newStop,
      rMultipleRealized: target.rMultiple,
      narrative:
        `Alvo ${i + 1} atingido em ${target.price.toFixed(5)} (${target.rMultiple.toFixed(1)}R). ` +
        `Fechar ${(target.closeFraction * 100).toFixed(0)}% da posicao. ${target.rationale}` +
        (newStop !== null ? ` Stop movido para break-even (${newStop.toFixed(5)}).` : ''),
    });
  });

  // --- 3. Modelo completo --------------------------------------------------
  const consolidationCrossed =
    direction === 'bullish'
      ? current.close > plan.consolidationHigh
      : current.close < plan.consolidationLow;

  if (consolidationCrossed && position.remainingFraction > 0) {
    out.push({
      signalId: plan.signalId,
      symbol: plan.symbol,
      reason: 'model-completed',
      // Nao fecha tudo: o runner segue ate ao draw on liquidity.
      closeFraction: Math.min(position.remainingFraction, 0.5),
      price: current.close,
      time: current.time,
      newStopLoss: direction === 'bullish' ? plan.consolidationLow : plan.consolidationHigh,
      rMultipleRealized: rOf(current.close),
      narrative:
        'O preco atravessou a consolidacao original — o Market Maker Model esta completo ' +
        'na definicao do eBook. Realizar metade do restante e proteger o resto atras do range.',
    });
  }

  // --- 4. Quebra de estrutura contra a posicao -----------------------------
  const swings = buildSwingLadder(candles);
  const flow = classifyOrderFlow(swings.intermediate);
  const shifts = detectStructureShifts(candles, swings.all);
  const recentShift = shifts.filter((s) => s.index >= candles.length - 3).pop();

  const structureAgainst =
    recentShift !== undefined &&
    recentShift.direction !== direction &&
    recentShift.type === 'mss' &&
    recentShift.withDisplacement;

  if (structureAgainst && position.remainingFraction > 0) {
    out.push({
      signalId: plan.signalId,
      symbol: plan.symbol,
      reason: 'structure-broken',
      closeFraction: position.remainingFraction,
      price: current.close,
      time: current.time,
      newStopLoss: null,
      rMultipleRealized: rOf(current.close),
      narrative:
        `MSS ${recentShift.direction} com displacement contra a posicao (fluxo atual: ${flow}). ` +
        'A entrega mudou de estado no sentido oposto — sair antes que o stop seja atingido.',
    });
  }

  // --- 5. SMT invertido ----------------------------------------------------
  const smtAgainst = input.currentSmt.filter(
    (e) => e.direction !== direction && e.primaryIndex >= candles.length - 5,
  );

  if (smtAgainst.length >= 2 && position.remainingFraction > 0) {
    out.push({
      signalId: plan.signalId,
      symbol: plan.symbol,
      reason: 'smt-reversed',
      closeFraction: Math.min(position.remainingFraction, 0.5),
      price: current.close,
      time: current.time,
      newStopLoss: null,
      rMultipleRealized: rOf(current.close),
      narrative:
        `SMT divergence agora aponta contra a posicao em ${smtAgainst.length} pares ` +
        `(${smtAgainst.map((e) => e.reference).join(', ')}). Reduzir exposicao.`,
    });
  }

  // --- 6. Time stop --------------------------------------------------------
  const timeStopDays = input.timeStopDays ?? plan.expectedHorizonDays * 2;
  const ageDays = (now - position.openedAt) / 86_400_000;

  if (ageDays > timeStopDays && position.hitTargets.length === 0) {
    out.push({
      signalId: plan.signalId,
      symbol: plan.symbol,
      reason: 'time-stop',
      closeFraction: position.remainingFraction,
      price: current.close,
      time: current.time,
      newStopLoss: null,
      rMultipleRealized: rOf(current.close),
      narrative:
        `${ageDays.toFixed(0)} dias em posicao sem atingir nenhum alvo (limite: ${timeStopDays.toFixed(0)}). ` +
        'O modelo nao entregou no horizonte previsto — libertar o capital.',
    });
  }

  return out;
}

/** Aplica uma saida a posicao, devolvendo o novo estado. */
export function applyExit(position: OpenPosition, exit: ExitSignal): OpenPosition {
  const targetIndex = position.plan.targets.findIndex((t) => t.price === exit.price);

  return {
    ...position,
    remainingFraction: Math.max(0, position.remainingFraction - exit.closeFraction),
    currentStop: exit.newStopLoss ?? position.currentStop,
    hitTargets:
      exit.reason === 'target-hit' && targetIndex >= 0
        ? [...position.hitTargets, targetIndex]
        : position.hitTargets,
  };
}

/** Direcao oposta, para leitura de sinais contrarios. */
export function against(direction: Direction): Direction {
  return direction === 'bullish' ? 'bearish' : 'bullish';
}
