/**
 * Entry Checklist do eBook, transformado em avaliador deterministico.
 *
 * As 10 perguntas da pagina 27, pela ordem original:
 *   1. Is the HTF draw on liquidity obvious?
 *   2. Is the HTF institutional order flow obvious?
 *   3. Has price reached a HTF point of interest where you anticipate an SMR?
 *   4. Does time meet price?
 *   5. Is there SMT?
 *   6. Is there a change in the state of delivery (CSD)?
 *   7. Is my entry model defined?
 *   8. Is my invalidation level defined?
 *   9. Is my target(s) defined?
 *  10. Execute.
 *
 * Regra do eBook: "If at any point the answer to one of these questions is no,
 * go back to step 1." Implementado literalmente — o checklist PARA no primeiro
 * passo que falha, e `passed` so e true quando os nove primeiros passam.
 */

import type { DrawOnLiquidity } from '../indicators/liquidity.js';
import type { SmtEvent } from '../smt/divergence.js';
import type { MacroExecutionVerdict } from '../time/windows.js';
import type { Direction } from '../types/market.js';
import type { MmxmModel } from '../mmxm/model.js';
import type { EntryPattern, PointOfInterest } from './entries.js';

export interface ChecklistStep {
  step: number;
  question: string;
  passed: boolean;
  /** Explicacao legivel do porque passou ou falhou — vai para o Telegram. */
  detail: string;
  /** Contribuicao para a pontuacao final (0..1). */
  weight: number;
}

export interface ChecklistResult {
  steps: ChecklistStep[];
  /** True quando os 9 primeiros passos passaram. */
  passed: boolean;
  /** Primeiro passo que falhou, ou null. */
  failedAtStep: number | null;
  /** Pontuacao ponderada 0..1 dos passos avaliados. */
  score: number;
  summary: string;
}

export interface ChecklistInput {
  model: MmxmModel;
  /** Narrativa HTF (vies do timeframe superior). */
  htfOrderFlow: Direction | 'neutral';
  drawOnLiquidity: DrawOnLiquidity | null;
  pointOfInterest: PointOfInterest | null;
  priceInsidePoi: boolean;
  macroVerdict: MacroExecutionVerdict;
  smtEvents: SmtEvent[];
  smtConfluence: { score: number; references: string[]; direction: Direction | null };
  entryPattern: EntryPattern | null;
  invalidationLevel: number | null;
  targets: number[];
  currentPrice: number;
}

/** Peso de cada passo na pontuacao final. Somam 1.0. */
const WEIGHTS: Record<number, number> = {
  1: 0.15, // draw on liquidity
  2: 0.15, // order flow HTF
  3: 0.12, // point of interest
  4: 0.15, // time meets price
  5: 0.18, // SMT — o diferenciador da estrategia
  6: 0.15, // change in state of delivery
  7: 0.05, // entry model
  8: 0.03, // invalidacao
  9: 0.02, // alvos
};

export function evaluateChecklist(input: ChecklistInput): ChecklistResult {
  const steps: ChecklistStep[] = [];
  const direction = input.model.direction;

  // --- 1. HTF draw on liquidity -------------------------------------------
  {
    const dol = input.drawOnLiquidity;
    const passed = dol !== null;
    steps.push({
      step: 1,
      question: 'O draw on liquidity de timeframe superior e obvio?',
      passed,
      detail: passed
        ? `Sim — ${dol!.pool.side === 'buyside' ? 'buyside' : 'sellside'} liquidity em ` +
          `${dol!.pool.price.toFixed(5)} (origem: ${dol!.pool.origin}, ${dol!.pool.touches} toque(s)). ` +
          `Distancia: ${dol!.distance.toFixed(5)}.`
        : 'Nao — nenhum poco de liquidez por varrer na direcao da narrativa. Sem iman, sem alvo.',
      weight: WEIGHTS[1]!,
    });
    if (!passed) return finish(steps, 1);
  }

  // --- 2. HTF institutional order flow ------------------------------------
  {
    const aligned = input.htfOrderFlow === direction;
    steps.push({
      step: 2,
      question: 'O fluxo institucional de timeframe superior e obvio?',
      passed: aligned,
      detail: aligned
        ? `Sim — fluxo HTF ${input.htfOrderFlow} alinhado com o modelo ${input.model.type}.`
        : `Nao — fluxo HTF e "${input.htfOrderFlow}" mas o modelo ${input.model.type} exige ` +
          `"${direction}". Operar contra o fluxo superior e o erro mais caro do framework.`,
      weight: WEIGHTS[2]!,
    });
    if (!aligned) return finish(steps, 2);
  }

  // --- 3. Point of interest HTF -------------------------------------------
  {
    const passed = input.priceInsidePoi && input.pointOfInterest !== null;
    steps.push({
      step: 3,
      question: 'O preco chegou a um point of interest HTF onde se antecipa o SMR?',
      passed,
      detail: passed
        ? `Sim — preco dentro de ${input.pointOfInterest!.description}.`
        : 'Nao — o preco ainda nao alcancou uma zona HTF (FVG ou breaker) onde faca sentido ' +
          'antecipar um Smart Money Reversal.',
      weight: WEIGHTS[3]!,
    });
    if (!passed) return finish(steps, 3);
  }

  // --- 4. Does time meet price? -------------------------------------------
  {
    const verdict = input.macroVerdict;
    steps.push({
      step: 4,
      question: 'O tempo encontra o preco (alinhamento Time & Price)?',
      passed: verdict.canExecute,
      detail: `${verdict.canExecute ? 'Sim' : 'Nao'} — ${verdict.reason} [regra: ${verdict.rule}]`,
      weight: WEIGHTS[4]!,
    });
    if (!verdict.canExecute) return finish(steps, 4);
  }

  // --- 5. SMT --------------------------------------------------------------
  {
    const conf = input.smtConfluence;
    const passed = input.smtEvents.length > 0 && conf.direction === direction;
    steps.push({
      step: 5,
      question: 'Existe SMT divergence (crack in correlation)?',
      passed,
      detail: passed
        ? `Sim — divergencia contra ${conf.references.join(', ')} ` +
          `(forca agregada ${conf.score.toFixed(2)}). ` +
          input.smtEvents.map((e) => e.description).join(' ')
        : input.smtEvents.length === 0
          ? 'Nao — nenhuma rachadura na correlacao dentro do POI e da janela recente. ' +
            'O eBook e claro: so SMT dentro da narrativa e do POI tem significado.'
          : `Nao — ha SMT mas aponta para "${conf.direction}", contra o modelo "${direction}".`,
      weight: WEIGHTS[5]!,
    });
    if (!passed) return finish(steps, 5);
  }

  // --- 6. Change in state of delivery -------------------------------------
  {
    const smr = input.model.smr;
    const passed = smr !== null && smr.confirmation !== null;
    steps.push({
      step: 6,
      question: 'Houve change in the state of delivery (CISD/MSS)?',
      passed,
      detail: passed
        ? `Sim — ${smr!.confirmation!.type.toUpperCase()} ${smr!.confirmation!.direction} em ` +
          `${smr!.confirmation!.level.toFixed(5)}` +
          `${smr!.confirmation!.withDisplacement ? ' com displacement' : ' sem displacement'}. ` +
          `Sweep de liquidez: ${smr!.components.liquiditySweep ? 'sim' : 'nao'}. ` +
          `Confianca do SMR: ${(smr!.confidence * 100).toFixed(0)}%.`
        : 'Nao — o Smart Money Reversal ainda nao foi confirmado por CISD nem MSS.',
      weight: WEIGHTS[6]!,
    });
    if (!passed) return finish(steps, 6);
  }

  // --- 7. Entry model ------------------------------------------------------
  {
    const pattern = input.entryPattern;
    const passed = pattern !== null;
    steps.push({
      step: 7,
      question: 'O meu modelo de entrada esta definido?',
      passed,
      detail: passed
        ? `Sim — ${pattern!.kind} em ${pattern!.low.toFixed(5)} - ${pattern!.high.toFixed(5)}, ` +
          `entrada em ${pattern!.entry.toFixed(5)} (qualidade ${(pattern!.quality * 100).toFixed(0)}%). ` +
          pattern!.description
        : 'Nao — nenhum padrao de entrada valido (unicorn, breaker, FVG) na direcao do modelo.',
      weight: WEIGHTS[7]!,
    });
    if (!passed) return finish(steps, 7);
  }

  // --- 8. Invalidacao ------------------------------------------------------
  {
    const level = input.invalidationLevel;
    const passed = level !== null && Number.isFinite(level);
    steps.push({
      step: 8,
      question: 'O meu nivel de invalidacao esta definido?',
      passed,
      detail: passed
        ? `Sim — invalidacao em ${level!.toFixed(5)} (extremo da curva esquerda do ${input.model.type}).`
        : 'Nao — sem nivel de invalidacao nao ha operacao.',
      weight: WEIGHTS[8]!,
    });
    if (!passed) return finish(steps, 8);
  }

  // --- 9. Alvos ------------------------------------------------------------
  {
    const passed = input.targets.length > 0;
    steps.push({
      step: 9,
      question: 'Os meus alvos estao definidos?',
      passed,
      detail: passed
        ? `Sim — ${input.targets.length} alvo(s): ${input.targets.map((t) => t.toFixed(5)).join(', ')}.`
        : 'Nao — sem alvo definido.',
      weight: WEIGHTS[9]!,
    });
    if (!passed) return finish(steps, 9);
  }

  // --- 10. Execute ---------------------------------------------------------
  steps.push({
    step: 10,
    question: 'Executar.',
    passed: true,
    detail:
      'Todos os nove criterios do checklist passaram. Sinal valido para o modo ' +
      'configurado (paper por omissao).',
    weight: 0,
  });

  return finish(steps, null);
}

function finish(steps: ChecklistStep[], failedAtStep: number | null): ChecklistResult {
  // A pontuacao considera apenas os passos avaliados; passos nao alcancados
  // valem zero, o que penaliza naturalmente as falhas precoces.
  const score = steps.filter((s) => s.passed).reduce((acc, s) => acc + s.weight, 0);

  const passed = failedAtStep === null;
  const summary = passed
    ? 'Checklist completo — 10/10.'
    : `Checklist parou no passo ${failedAtStep}: ${steps[steps.length - 1]?.question ?? ''}`;

  return { steps, passed, failedAtStep, score, summary };
}
