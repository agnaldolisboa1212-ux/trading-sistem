/**
 * Orquestrador do motor: de velas a sinal.
 *
 * Fluxo, na ordem exata do framework do eBook:
 *
 *   velas HTF  -> estrutura HTF  -> narrativa + draw on liquidity + POIs
 *   velas LTF  -> estrutura LTF  -> consolidacao -> MMXM -> SMR
 *   referencias -> SMT divergence (filtrado por narrativa e POI)
 *   tempo      -> regra dos macros (reversal vs expansion)
 *   tudo       -> checklist de 10 pontos -> sinal
 *
 * Nada aqui inventa criterios novos: cada passo mapeia para uma pergunta do
 * checklist da pagina 27.
 */

import { computeAtr, detectFairValueGaps } from '../indicators/fvg.js';
import {
  deriveBreakers,
  deriveMitigationBlocks,
  detectOrderBlocks,
} from '../indicators/blocks.js';
import {
  detectEqualLevels,
  detectTimeBasedPools,
  selectDrawOnLiquidity,
} from '../indicators/liquidity.js';
import { detectStructureShifts } from '../indicators/shifts.js';
import { buildSwingLadder, readOrderFlow } from '../indicators/swings.js';
import { assessOhlcQuality } from '../indicators/quality.js';
import { detectActiveMmxm } from '../mmxm/model.js';
import {
  aggregateSmtConfluence,
  detectSmtDivergences,
  filterRelevantSmt,
  type SmtEvent,
  type SmtPair,
} from '../smt/divergence.js';
import { evaluateMacroExecution } from '../time/windows.js';
import { buildTargetPlan, calculatePositionSize, DEFAULT_RISK, type RiskConfig } from '../risk/sizing.js';
import { runInstitutionalStrategies, assessConfluence, type ConfluenceReport } from '../strategies/index.js';
import type { StrategySignal } from '../strategies/types.js';
import type { CandleSeries, Direction, Timeframe } from '../types/market.js';
import type {
  FairValueGap,
  LiquidityPool,
  PriceBlock,
  SwingPoint,
} from '../types/structure.js';
import type { DrawOnLiquidity } from '../indicators/liquidity.js';
import type { MacroExecutionVerdict } from '../time/windows.js';
import type { MmxmModel } from '../mmxm/model.js';
import type { PointOfInterest } from './entries.js';
import type { TradeSignal } from '../types/signal.js';
import { evaluateChecklist } from './checklist.js';
import {
  buildPointsOfInterest,
  detectEntryPatterns,
  priceInPointOfInterest,
  type EntryPattern,
} from './entries.js';

export interface AnalyzeInput {
  /** Serie do timeframe de execucao (tipicamente '1d'). */
  primary: CandleSeries;
  /** Serie do timeframe superior para a narrativa (tipicamente '1w'). */
  higher: CandleSeries;
  /** Series dos instrumentos de referencia para SMT, indexadas por simbolo. */
  references: Map<string, CandleSeries>;
  /** Pares SMT aplicaveis a este instrumento. */
  smtPairs: SmtPair[];
  riskConfig?: RiskConfig;
  /** R minimo para o sinal ser emitido. */
  minRMultiple?: number;
  /** Confianca minima para o sinal ser emitido. */
  minConfidence?: number;
  /** Instante da avaliacao (injetavel para backtest determinista). */
  now?: number;
}

/**
 * Estruturas intermedias da analise.
 *
 * Existe para que a interface possa DESENHAR exatamente o que o motor viu. A
 * alternativa — recalcular a estrutura no dashboard — criaria duas fontes de
 * verdade que divergem em silencio assim que um limiar mudar de um lado so.
 *
 * Sao referencias para arrays ja calculados, por isso nao custam nada a montar.
 */
export interface AnalysisDetail {
  model: MmxmModel | null;
  swings: SwingPoint[];
  fvgs: FairValueGap[];
  blocks: PriceBlock[];
  pools: LiquidityPool[];
  /** SMT que sobreviveu ao filtro de narrativa e POI. */
  smtRelevant: SmtEvent[];
  /** SMT bruto, antes do filtro — util para mostrar o que quase contou. */
  smtAll: SmtEvent[];
  drawOnLiquidity: DrawOnLiquidity | null;
  pointsOfInterest: PointOfInterest[];
  entryPatterns: EntryPattern[];
  macroVerdict: MacroExecutionVerdict;
  htfOrderFlowDetail: string;
  atr: number;
  institutionalSignals: StrategySignal[];
  institutionalConfluence: ConfluenceReport | null;
}

export interface AnalyzeResult {
  symbol: string;
  timeframe: Timeframe;
  /** Sinal emitido, ou null se o checklist nao passou. */
  signal: TradeSignal | null;
  /** Estruturas calculadas. Ausente quando a analise abortou cedo. */
  detail?: AnalysisDetail;
  /** Diagnostico sempre presente, mesmo sem sinal — util para o dashboard. */
  diagnostics: {
    htfOrderFlow: Direction | 'neutral';
    modelType: string | null;
    modelPhase: string | null;
    checklistScore: number;
    failedAtStep: number | null;
    summary: string;
    smtCount: number;
  };
}

/** Numero minimo de velas para a analise ser fiavel. */
const MIN_CANDLES = 60;

export function analyzeInstrument(input: AnalyzeInput): AnalyzeResult {
  const { primary, higher } = input;
  const now = input.now ?? Date.now();
  const riskConfig = input.riskConfig ?? DEFAULT_RISK;

  const empty = (summary: string): AnalyzeResult => ({
    symbol: primary.symbol,
    timeframe: primary.timeframe,
    signal: null,
    diagnostics: {
      htfOrderFlow: 'neutral',
      modelType: null,
      modelPhase: null,
      checklistScore: 0,
      failedAtStep: null,
      summary,
      smtCount: 0,
    },
  });

  // --- Guardas de qualidade de dados ---------------------------------------
  if (primary.fidelity !== 'true-ohlc') {
    return empty(
      `Serie de ${primary.symbol} veio de fonte "${primary.source}" com OHLC sintetico. ` +
        'A estrutura ICT exige maximas e minimas reais — analise abortada.',
    );
  }
  if (primary.candles.length < MIN_CANDLES) {
    return empty(
      `Apenas ${primary.candles.length} velas para ${primary.symbol}; minimo ${MIN_CANDLES}.`,
    );
  }

  // Guarda contra fontes que sintetizam a abertura. Sem esta verificacao, series
  // degeneradas atravessam todo o pipeline sem erro e produzem zero estrutura.
  const quality = assessOhlcQuality(primary.candles);
  if (quality.degenerate) {
    return empty(`Qualidade de OHLC insuficiente em ${primary.symbol} (${primary.source}): ${quality.reason}`);
  }

  const candles = primary.candles;
  const currentIndex = candles.length - 1;
  const current = candles[currentIndex];
  if (!current) return empty('Serie sem vela corrente.');

  const atr = computeAtr(candles);
  const atrNow = atr[currentIndex] ?? 0;

  // --- 1. Narrativa de timeframe superior ----------------------------------
  const htfSwings = buildSwingLadder(higher.candles);
  // Prefere swings intermediate; recorre aos short quando o historico semanal
  // ainda nao produziu escada fractal suficiente.
  const htfReading = readOrderFlow(
    htfSwings.intermediate.length >= 4 ? htfSwings.intermediate : htfSwings.short,
  );
  const htfOrderFlow = htfReading.direction;

  const htfFvgs = detectFairValueGaps(higher.candles);
  const htfOrderBlocks = detectOrderBlocks(higher.candles);
  const htfBreakers = deriveBreakers(htfOrderBlocks, higher.candles);

  // --- 2. Estrutura do timeframe de execucao -------------------------------
  const swings = buildSwingLadder(candles);
  const fvgs = detectFairValueGaps(candles);
  const orderBlocks = detectOrderBlocks(candles);
  const breakers = deriveBreakers(orderBlocks, candles);
  const shifts = detectStructureShifts(candles, swings.all);

  const pools = [
    ...detectEqualLevels(candles, swings.all),
    ...detectTimeBasedPools(candles),
  ];

  // --- 3. MMXM -------------------------------------------------------------
  const model = detectActiveMmxm({
    candles,
    swings: swings.all,
    shifts,
    pools,
    preferDirection: htfOrderFlow,
  });

  if (!model) {
    return {
      ...empty('Nenhum Market Maker Model identificavel na serie.'),
      diagnostics: {
        htfOrderFlow,
        modelType: null,
        modelPhase: null,
        checklistScore: 0,
        failedAtStep: null,
        summary: 'Nenhum MMXM identificavel — sem consolidacao com liquidez engenheirada.',
        smtCount: 0,
      },
    };
  }

  const direction = model.direction;

  // Mitigation blocks: so fazem sentido depois de conhecido o ponto de viragem.
  const mitigationBlocks = model.smr
    ? deriveMitigationBlocks(orderBlocks, model.smr.index)
    : [];
  const allBlocks = [...orderBlocks, ...breakers, ...mitigationBlocks];

  // --- 4. Draw on liquidity ------------------------------------------------
  const drawOnLiquidity = selectDrawOnLiquidity(
    pools,
    current.close,
    direction === 'bullish' ? 'buyside' : 'sellside',
    atrNow,
  );

  // --- 5. Points of interest HTF -------------------------------------------
  const pois = buildPointsOfInterest(
    htfFvgs,
    [...htfOrderBlocks, ...htfBreakers],
    higher.timeframe,
    direction,
    higher.candles.length - 1,
  );
  const poiCheck = priceInPointOfInterest(current.close, pois);

  // --- 6. SMT --------------------------------------------------------------
  const rawSmt: SmtEvent[] = [];
  for (const pair of input.smtPairs) {
    const reference = input.references.get(pair.reference);
    if (!reference || reference.fidelity !== 'true-ohlc') continue;
    if (reference.candles.length < MIN_CANDLES) continue;

    const referenceSwings = buildSwingLadder(reference.candles);
    rawSmt.push(
      /*
       * Grau minimo 'short' de proposito. Restringir a 'intermediate' produzia
       * 0-3 eventos em 400 velas diarias — praticamente nenhum dentro da janela
       * de frescura, e o checklist morria sempre no passo 5. A relevancia e
       * reposta a jusante: `aggregateSmtConfluence` pondera cada evento pelo
       * grau do swing, por isso um crack short-term conta, mas conta pouco.
       */
      ...detectSmtDivergences(pair, candles, swings.all, referenceSwings.all, {
        minDegree: 'short',
      }),
    );
  }

  const relevantSmt = filterRelevantSmt(rawSmt, {
    narrative: direction,
    currentIndex,
    freshnessWindow: 15,
    insidePointOfInterest: poiCheck.inside,
  });
  const smtConfluence = aggregateSmtConfluence(relevantSmt, input.smtPairs);

  // --- 7. Regra dos macros (Time & Price) ----------------------------------
  const smrTime = model.smr?.time ?? current.time;
  const macroVerdict = evaluateMacroExecution(smrTime, now);

  // --- 8. Padrao de entrada ------------------------------------------------
  const patterns = detectEntryPatterns({
    candles,
    blocks: allBlocks,
    fvgs,
    direction,
    fromIndex: model.smr?.index ?? model.consolidation.endIndex,
    currentIndex,
  });
  const entryPattern: EntryPattern | null = patterns[0] ?? null;

  // --- Estratégias Institucionais ------------------------------------------
  const institutional = runInstitutionalStrategies(primary);
  const institutionalConfluence = institutional.signals.length > 0 ? assessConfluence(institutional.signals) : null;

  // --- 9. Plano de risco ---------------------------------------------------
  const entryPrice = entryPattern?.entry ?? current.close;
  const stopLoss = computeStopLoss(model, entryPattern, atrNow, direction);
  const plan = buildTargetPlan({
    entry: entryPrice,
    stopLoss,
    direction,
    consolidationTarget: model.targetLevel,
    drawOnLiquidityTarget: drawOnLiquidity?.pool.price ?? null,
    minRMultiple: input.minRMultiple ?? 3,
  });

  // --- 10. Checklist -------------------------------------------------------
  const checklist = evaluateChecklist({
    model,
    htfOrderFlow,
    drawOnLiquidity,
    pointOfInterest: poiCheck.poi,
    priceInsidePoi: poiCheck.inside,
    macroVerdict,
    smtEvents: relevantSmt,
    smtConfluence,
    entryPattern,
    invalidationLevel: stopLoss,
    targets: plan.targets.map((t) => t.price),
    currentPrice: current.close,
  });

  const diagnostics = {
    htfOrderFlow,
    modelType: model.type,
    modelPhase: model.phase,
    checklistScore: checklist.score,
    failedAtStep: checklist.failedAtStep,
    summary: checklist.summary,
    smtCount: relevantSmt.length,
  };

  const detail: AnalysisDetail = {
    model,
    swings: swings.all,
    fvgs,
    blocks: allBlocks,
    pools,
    smtRelevant: relevantSmt,
    smtAll: rawSmt,
    drawOnLiquidity,
    pointsOfInterest: pois,
    entryPatterns: patterns,
    macroVerdict,
    htfOrderFlowDetail: htfReading.detail,
    atr: atrNow,
    institutionalSignals: institutional.signals,
    institutionalConfluence,
  };

  if (!checklist.passed || !plan.viable) {
    return {
      symbol: primary.symbol,
      timeframe: primary.timeframe,
      signal: null,
      detail,
      diagnostics: {
        ...diagnostics,
        summary: checklist.passed ? plan.reason : checklist.summary,
      },
    };
  }

  /*
   * --- Confianca final ---------------------------------------------------
   *
   * NAO entra aqui o `checklist.score`.
   *
   * Os pesos do checklist somam exatamente 1,0 e este ponto do codigo so e
   * alcancado quando `checklist.passed` e verdadeiro — ou seja, `score` vale
   * SEMPRE 1,0 aqui. Incluir esse termo adicionava uma constante de 0,5 que nao
   * distinguia sinal nenhum de outro: a confianca ficava confinada a [0,5; 1,0]
   * e qualquer limiar ate ~0,68 era inerte.
   *
   * Isso foi medido: uma analise de sensibilidade com MIN_CONFIDENCE a 0,40,
   * 0,50, 0,60 e 0,70 devolveu resultados byte-a-byte identicos nas quatro
   * configuracoes. O botao existia mas nao estava ligado a nada.
   *
   * A confianca passa a medir apenas o que varia entre sinais que ja passaram o
   * checklist — a forca do modelo e a qualidade do padrao de entrada — mantendo
   * a proporcao relativa original entre os dois (0,3:0,2 = 0,6:0,4) e voltando a
   * ocupar a escala completa de 0 a 1.
   */
  const confidence = model.confidence * 0.6 + (entryPattern?.quality ?? 0) * 0.4;

  const minConfidence = input.minConfidence ?? 0.6;
  if (confidence < minConfidence) {
    return {
      symbol: primary.symbol,
      timeframe: primary.timeframe,
      signal: null,
      detail,
      diagnostics: {
        ...diagnostics,
        summary:
          `Checklist passou mas a confianca combinada e ${(confidence * 100).toFixed(0)}%, ` +
          `abaixo do minimo de ${(minConfidence * 100).toFixed(0)}%.`,
      },
    };
  }

  const positionSize = calculatePositionSize(entryPrice, stopLoss, riskConfig);

  const signal: TradeSignal = {
    id: `${primary.symbol}-${primary.timeframe}-${model.smr?.index ?? currentIndex}`,
    kind: 'entry',
    symbol: primary.symbol,
    timeframe: primary.timeframe,
    direction,
    status: 'pending',
    generatedAt: current.time,
    referencePrice: current.close,
    entryZoneLow: entryPattern?.low ?? entryPrice,
    entryZoneHigh: entryPattern?.high ?? entryPrice,
    entryPrice,
    stopLoss,
    targets: plan.targets,
    maxRMultiple: plan.maxR,
    positionSize,
    model,
    entryStage: model.entryStage,
    entryPattern,
    smtEvents: relevantSmt,
    checklist,
    confidence,
    expectedHorizonDays: estimateHorizonDays(model, primary.timeframe),
    narrative: buildNarrative(primary.symbol, model, checklist, plan.maxR, entryPattern),
    warnings: [...positionSize.warnings, ...model.notes],
  };

  return { symbol: primary.symbol, timeframe: primary.timeframe, signal, detail, diagnostics };
}

/**
 * Stop loss: alem do extremo da curva esquerda, com folga de ATR.
 *
 * O eBook coloca a invalidacao no ponto que mata o modelo. Se houver padrao de
 * entrada, usa-se o extremo da zona de entrada quando este for mais apertado —
 * mas nunca dentro da propria zona, senao o stop e caçado pelo ruido normal.
 */
function computeStopLoss(
  model: { leftCurveExtremePrice: number | null },
  pattern: EntryPattern | null,
  atrValue: number,
  direction: Direction,
): number {
  const buffer = atrValue * 0.3;
  const structural = model.leftCurveExtremePrice;

  const patternStop = pattern
    ? direction === 'bullish'
      ? pattern.low - buffer
      : pattern.high + buffer
    : null;

  const structuralStop =
    structural !== null
      ? direction === 'bullish'
        ? structural - buffer
        : structural + buffer
      : null;

  if (patternStop !== null && structuralStop !== null) {
    // O mais apertado dos dois que continue a ser estruturalmente valido.
    return direction === 'bullish'
      ? Math.max(patternStop, structuralStop)
      : Math.min(patternStop, structuralStop);
  }
  return patternStop ?? structuralStop ?? 0;
}

/** Horizonte esperado: o eBook nao o define, mas a fase do modelo informa-o. */
function estimateHorizonDays(model: { phase: string }, timeframe: Timeframe): number {
  const base = timeframe === '1w' ? 60 : timeframe === '1d' ? 21 : 5;
  switch (model.phase) {
    case 'right-curve-low-risk-entry':
      return base * 1.5; // ainda falta toda a curva direita
    case 'right-curve-stage-1':
      return base;
    case 'right-curve-silver-bullet':
      return Math.round(base * 0.5); // entrega rapida em direcao ao iman
    default:
      return base;
  }
}

function buildNarrative(
  symbol: string,
  model: { type: string; direction: Direction; phase: string; entryStage: string | null },
  checklist: { steps: Array<{ step: number; detail: string; passed: boolean }> },
  maxR: number,
  pattern: EntryPattern | null,
): string {
  const side = model.direction === 'bullish' ? 'COMPRA' : 'VENDA';
  const stageLabel: Record<string, string> = {
    'low-risk-buy-sell': model.direction === 'bullish' ? 'Low Risk Buy' : 'Low Risk Sell',
    'first-stage-acc-dist':
      model.direction === 'bullish' ? '1a fase de Acumulacao' : '1a fase de Distribuicao',
    'silver-bullet': 'Silver Bullet (2a fase)',
  };

  const lines = [
    `${side} ${symbol} — ${model.type}, fase: ${stageLabel[model.entryStage ?? ''] ?? model.phase}.`,
    `Padrao de entrada: ${pattern?.kind ?? 'n/d'}. Alvo maximo: ${maxR.toFixed(1)}R.`,
    '',
    'Checklist:',
    ...checklist.steps.map((s) => `  ${s.passed ? 'OK' : 'X'} ${s.step}. ${s.detail}`),
  ];

  return lines.join('\n');
}
