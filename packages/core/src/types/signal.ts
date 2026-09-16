/**
 * Tipos do sinal — o produto final do motor.
 *
 * Um sinal e sempre AUDITAVEL: carrega o checklist completo, o modelo MMXM que
 * o gerou e os eventos SMT, para que qualquer decisao possa ser reconstruida
 * meses depois a partir do registo no Supabase.
 */

import type { Direction, Timeframe } from './market.js';
import type { ChecklistResult } from '../signal/checklist.js';
import type { EntryPattern } from '../signal/entries.js';
import type { MmxmModel, EntryStage } from '../mmxm/model.js';
import type { SmtEvent } from '../smt/divergence.js';
import type { TargetPlan, PositionSize } from '../risk/sizing.js';

export type SignalKind = 'entry' | 'exit' | 'update' | 'invalidation';

export type SignalStatus =
  | 'pending' // emitido, a aguardar preenchimento na zona de entrada
  | 'active' // posicao (paper) aberta
  | 'partial' // parcialmente fechada num alvo
  | 'closed-target' // fechada em alvo
  | 'closed-stop' // fechada no stop
  | 'closed-manual' // fechada por decisao do operador
  | 'expired' // zona de entrada nunca foi tocada dentro do prazo
  | 'invalidated'; // modelo morreu antes do preenchimento

export interface TradeSignal {
  /** Identificador estavel: symbol + timeframe + indice do SMR. */
  id: string;
  kind: SignalKind;
  symbol: string;
  timeframe: Timeframe;
  direction: Direction;
  status: SignalStatus;

  /** Instante em que o sinal foi gerado (fecho da vela que o produziu). */
  generatedAt: number;
  /** Preco no momento da geracao. */
  referencePrice: number;

  // --- Plano de execucao ---------------------------------------------------
  entryZoneLow: number;
  entryZoneHigh: number;
  entryPrice: number;
  stopLoss: number;
  targets: TargetPlan[];
  /** Melhor R alcancavel no plano. */
  maxRMultiple: number;
  positionSize: PositionSize | null;

  // --- Justificacao --------------------------------------------------------
  model: MmxmModel;
  entryStage: EntryStage;
  entryPattern: EntryPattern | null;
  smtEvents: SmtEvent[];
  checklist: ChecklistResult;
  /** Confianca final combinando checklist, modelo e qualidade da entrada. */
  confidence: number;

  /** Horizonte esperado da operacao, em dias. */
  expectedHorizonDays: number;
  /** Texto pronto para Telegram/dashboard. */
  narrative: string;
  warnings: string[];
}

export interface ExitSignal {
  signalId: string;
  symbol: string;
  reason:
    | 'target-hit'
    | 'stop-hit'
    | 'model-completed'
    | 'model-invalidated'
    | 'structure-broken'
    | 'smt-reversed'
    | 'time-stop';
  /** Fracao da posicao a fechar (1 = tudo). */
  closeFraction: number;
  price: number;
  time: number;
  /** Novo stop sugerido para o restante da posicao, se aplicavel. */
  newStopLoss: number | null;
  rMultipleRealized: number;
  narrative: string;
}
