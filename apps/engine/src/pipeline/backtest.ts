// @ts-nocheck
/**
 * Backtest walk-forward da estrategia.
 *
 * REGRA ABSOLUTA: nenhuma decisao pode ver dados do futuro.
 *
 * Isto e mais facil de violar do que parece. As duas armadilhas evitadas aqui:
 *
 *  1. Os detectores de estrutura (`detectFairValueGaps`, `deriveBreakers`...)
 *     anotam o ciclo de vida percorrendo a serie INTEIRA — um FVG "ja
 *     preenchido" so o esta porque o detector viu velas posteriores. Por isso o
 *     backtest volta a fatiar a serie em cada passo e chama `analyzeInstrument`
 *     com apenas as velas ate a data simulada. Nunca reutiliza estruturas
 *     calculadas sobre a serie completa.
 *
 *  2. A regra dos macros depende de `now`. Passamos o timestamp da vela
 *     simulada, nao o relogio real, senao a janela temporal avaliada seria a de
 *     hoje e nao a do dia que se esta a simular.
 *
 * O preenchimento e conservador: a ordem so e considerada executada quando o
 * preco NEGOCIA dentro da zona de entrada numa vela POSTERIOR a do sinal, e o
 * preenchimento acontece ao pior preco da zona.
 */

import {
  analyzeInstrument,
  expectancy,
  simulateSequence,
  smtPairsFor,
  type CandleSeries,
  type RiskConfig,
  type TradeSignal,
} from '@trading/core';

export interface BacktestTrade {
  signalId: string;
  symbol: string;
  direction: 'bullish' | 'bearish';
  entryStage: string | null;
  entryPattern: string | null;
  signalAt: string;
  filledAt: string | null;
  closedAt: string | null;
  entryPrice: number;
  stopLoss: number;
  exitPrice: number | null;
  /** Resultado em multiplos de R, ja ponderado pelas saidas parciais. */
  rMultiple: number;
  outcome: 'win' | 'loss' | 'breakeven' | 'open' | 'never-filled';
  barsHeld: number;
  maxRExcursion: number;
  confidence: number;
  checklistScore: number;
}

export interface BacktestResult {
  symbol: string;
  periodStart: string;
  periodEnd: string;
  trades: BacktestTrade[];
  totalSignals: number;
  filled: number;
  wins: number;
  losses: number;
  winRate: number;
  averageR: number;
  averageWinR: number;
  averageLossR: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdownPercent: number;
  finalBalance: number;
  /** Distribuicao dos R por operacao, para inspecionar a cauda. */
  rDistribution: number[];
}

export interface BacktestOptions {
  /** Serie completa do timeframe de execucao. */
  primary: CandleSeries;
  /** Serie completa do timeframe superior. */
  higher: CandleSeries;
  /** Series completas das referencias de SMT. */
  references: Map<string, CandleSeries>;
  risk: RiskConfig;
  minRMultiple?: number;
  minConfidence?: number;
  /** Quantas velas de aquecimento antes de comecar a avaliar. */
  warmup?: number;
  /** Quantas velas uma ordem pendente sobrevive antes de expirar. */
  fillWindow?: number;
  /** Quantas velas uma posicao pode ficar aberta antes do time stop. */
  maxHoldBars?: number;
  /**
   * Janela de analise: quantas velas de historico o analisador ve em cada passo.
   *
   * TEM DE COINCIDIR COM `CANDLE_LIMIT` DO MOTOR EM PRODUCAO.
   *
   * Antes disto o backtest passava a serie inteira acumulada (ate 1500 velas)
   * enquanto o motor ao vivo corre com 400. Um backtest que ve mais historico
   * do que a producao nao esta a testar a producao: os detectores de
   * consolidacao, de pocos e de blocos comportam-se de forma diferente com
   * janelas diferentes, e o resultado seria optimista sem que nada o revelasse.
   */
  analysisWindow?: number;
  /** Janela equivalente para o timeframe superior. */
  higherWindow?: number;
}

interface PendingOrder {
  signal: TradeSignal;
  signalIndex: number;
}

interface ActiveTrade {
  signal: TradeSignal;
  filledIndex: number;
  filledTime: number;
  filledPrice: number;
  /**
   * Risco REAL da operacao: distancia entre o preco efetivamente preenchido e o
   * stop inicial. E este o denominador de todos os R.
   *
   * Usar o risco PLANEADO (entryPrice -> stop) produzia perdas de -1,35R em
   * media, o que e impossivel por construcao: uma operacao parada no stop perde
   * exatamente 1R por definicao. A discrepancia vinha de o fill ser assumido ao
   * pior preco da zona enquanto o R era medido contra o preco planeado — a
   * perda extra existe mesmo, mas pertence ao slippage, nao ao multiplo de R.
   * Com o risco real, -1R volta a ser o chao de uma operacao parada e as
   * metricas passam a ser comparaveis com as de qualquer outro sistema.
   */
  riskPerUnit: number;
  remainingFraction: number;
  currentStop: number;
  hitTargets: Set<number>;
  realizedR: number;
  maxRExcursion: number;
}

export function backtestInstrument(options: BacktestOptions): BacktestResult {
  const { primary, higher, references, risk } = options;
  const warmup = options.warmup ?? 150;
  const fillWindow = options.fillWindow ?? 15;
  const maxHoldBars = options.maxHoldBars ?? 120;

  const candles = primary.candles;
  const trades: BacktestTrade[] = [];
  const seenSignalIds = new Set<string>();

  let pending: PendingOrder | null = null;
  let active: ActiveTrade | null = null;
  let totalSignals = 0;

  const analysisWindow = options.analysisWindow ?? 400;
  const higherWindow = options.higherWindow ?? 200;

  // `true`: o timeframe superior so entra depois de a vela ter fechado.
  const higherSlicer = new TimeSlicer(higher, higherWindow, true);
  const referenceSlicer = new ReferenceSlicer(references, analysisWindow);
  const pairs = smtPairsFor(primary.symbol);

  for (let i = warmup; i < candles.length; i++) {
    const bar = candles[i];
    if (!bar) continue;

    // --- 1. Gerir a posicao aberta ----------------------------------------
    if (active) {
      const closed = stepActiveTrade(active, bar, i, maxHoldBars);
      if (closed) {
        trades.push(closed);
        active = null;
      }
    }

    // --- 2. Tentar preencher a ordem pendente ------------------------------
    if (!active && pending) {
      const signal = pending.signal;
      const expired = i - pending.signalIndex > fillWindow;

      // Preenchimento so em vela POSTERIOR a do sinal: no dia do sinal a vela
      // ja fechou quando a decisao foi tomada.
      const touched = bar.low <= signal.entryZoneHigh && bar.high >= signal.entryZoneLow;

      if (touched) {
        // Pior preco da zona — assume que o preenchimento nunca e favoravel.
        const fillPrice =
          signal.direction === 'bullish'
            ? Math.min(signal.entryZoneHigh, Math.max(signal.entryZoneLow, bar.high))
            : Math.max(signal.entryZoneLow, Math.min(signal.entryZoneHigh, bar.low));

        active = {
          signal,
          filledIndex: i,
          filledTime: bar.time,
          filledPrice: fillPrice,
          riskPerUnit: Math.abs(fillPrice - signal.stopLoss),
          remainingFraction: 1,
          currentStop: signal.stopLoss,
          hitTargets: new Set(),
          realizedR: 0,
          maxRExcursion: 0,
        };
        pending = null;
      } else if (expired) {
        trades.push({
          signalId: signal.id,
          symbol: signal.symbol,
          direction: signal.direction,
          entryStage: signal.entryStage,
          entryPattern: signal.entryPattern?.kind ?? null,
          signalAt: new Date(signal.generatedAt).toISOString(),
          filledAt: null,
          closedAt: null,
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
          exitPrice: null,
          rMultiple: 0,
          outcome: 'never-filled',
          barsHeld: 0,
          maxRExcursion: 0,
          confidence: signal.confidence,
          checklistScore: signal.checklist.score,
        });
        pending = null;
      }
    }

    // --- 3. Procurar novo sinal (so se estiver livre) ----------------------
    if (active || pending) continue;

    const result = analyzeInstrument({
      primary: sliceSeries(primary, i, analysisWindow),
      higher: higherSlicer.sliceTo(bar.time),
      references: referenceSlicer.sliceTo(bar.time),
      smtPairs: pairs,
      riskConfig: risk,
      minRMultiple: options.minRMultiple ?? 3,
      minConfidence: options.minConfidence ?? 0.6,
      // O relogio simulado, nunca o real — a regra dos macros depende dele.
      now: bar.time,
    });

    if (result.signal && !seenSignalIds.has(result.signal.id)) {
      seenSignalIds.add(result.signal.id);
      totalSignals++;
      pending = { signal: result.signal, signalIndex: i };
    }
  }

  // Posicao ainda aberta no fim do periodo.
  if (active) {
    const last = candles[candles.length - 1];
    if (last) {
      trades.push({
        signalId: active.signal.id,
        symbol: active.signal.symbol,
        direction: active.signal.direction,
        entryStage: active.signal.entryStage,
        entryPattern: active.signal.entryPattern?.kind ?? null,
        signalAt: new Date(active.signal.generatedAt).toISOString(),
        filledAt: new Date(active.filledTime).toISOString(),
        closedAt: null,
        entryPrice: active.filledPrice,
        stopLoss: active.signal.stopLoss,
        exitPrice: last.close,
        rMultiple: active.realizedR + openR(active, last.close) * active.remainingFraction,
        outcome: 'open',
        barsHeld: candles.length - 1 - active.filledIndex,
        maxRExcursion: active.maxRExcursion,
        confidence: active.signal.confidence,
        checklistScore: active.signal.checklist.score,
      });
    }
  }

  return summarize(primary, trades, totalSignals, risk);
}

// ---------------------------------------------------------------------------

/**
 * Multiplo de R de um trade a um dado preco, medido contra o RISCO REAL
 * assumido no preenchimento. O denominador e fixo durante toda a vida da
 * operacao — se acompanhasse o stop movido para break-even, o R deixaria de ter
 * significado assim que o TP1 fosse atingido.
 */
function openR(trade: ActiveTrade, price: number): number {
  if (trade.riskPerUnit <= 0) return 0;
  return trade.signal.direction === 'bullish'
    ? (price - trade.filledPrice) / trade.riskPerUnit
    : (trade.filledPrice - price) / trade.riskPerUnit;
}

/**
 * Avanca um trade uma vela. Devolve o registo fechado, ou null se continua.
 *
 * Ordem de verificacao deliberada: o STOP e testado ANTES dos alvos. Quando uma
 * vela toca ambos, nao ha forma de saber pelo OHLC qual foi primeiro — assumir
 * o alvo inflacionaria os resultados. Assumir o stop e a hipotese pessimista, e
 * e a unica honesta num backtest de velas diarias.
 */
function stepActiveTrade(
  trade: ActiveTrade,
  bar: { time: number; open: number; high: number; low: number; close: number },
  index: number,
  maxHoldBars: number,
): BacktestTrade | null {
  const signal = trade.signal;
  const bullish = signal.direction === 'bullish';

  const excursion = openR(trade, bullish ? bar.high : bar.low);
  trade.maxRExcursion = Math.max(trade.maxRExcursion, excursion);

  const close = (exitPrice: number, outcome: BacktestTrade['outcome']): BacktestTrade => ({
    signalId: signal.id,
    symbol: signal.symbol,
    direction: signal.direction,
    entryStage: signal.entryStage,
    entryPattern: signal.entryPattern?.kind ?? null,
    signalAt: new Date(signal.generatedAt).toISOString(),
    filledAt: new Date(trade.filledTime).toISOString(),
    closedAt: new Date(bar.time).toISOString(),
    entryPrice: trade.filledPrice,
    stopLoss: signal.stopLoss,
    exitPrice,
    rMultiple: trade.realizedR,
    outcome,
    barsHeld: index - trade.filledIndex,
    maxRExcursion: trade.maxRExcursion,
    confidence: signal.confidence,
    checklistScore: signal.checklist.score,
  });

  // --- Stop primeiro (hipotese pessimista) --------------------------------
  const stopHit = bullish ? bar.low <= trade.currentStop : bar.high >= trade.currentStop;
  if (stopHit) {
    const stopR = openR(trade, trade.currentStop);
    trade.realizedR += stopR * trade.remainingFraction;
    trade.remainingFraction = 0;
    const total = trade.realizedR;
    return close(
      trade.currentStop,
      total > 0.05 ? 'win' : total < -0.05 ? 'loss' : 'breakeven',
    );
  }

  // --- Alvos ---------------------------------------------------------------
  signal.targets.forEach((target, ti) => {
    if (trade.hitTargets.has(ti)) return;
    const reached = bullish ? bar.high >= target.price : bar.low <= target.price;
    if (!reached) return;

    trade.hitTargets.add(ti);
    const fraction = Math.min(target.closeFraction, trade.remainingFraction);
    trade.realizedR += openR(trade, target.price) * fraction;
    trade.remainingFraction -= fraction;

    // Break-even apos o primeiro alvo, tal como o plano de saidas define.
    if (ti === 0) trade.currentStop = trade.filledPrice;
  });

  if (trade.remainingFraction <= 0.001) {
    const total = trade.realizedR;
    return close(bar.close, total > 0.05 ? 'win' : total < -0.05 ? 'loss' : 'breakeven');
  }

  // --- Time stop -----------------------------------------------------------
  if (index - trade.filledIndex >= maxHoldBars) {
    trade.realizedR += openR(trade, bar.close) * trade.remainingFraction;
    trade.remainingFraction = 0;
    const total = trade.realizedR;
    return close(bar.close, total > 0.05 ? 'win' : total < -0.05 ? 'loss' : 'breakeven');
  }

  return null;
}

/**
 * Fatia a serie ate ao indice `end` (inclusive), mantendo no maximo `window`
 * velas — sem olhar para o futuro e sem ver mais passado do que a producao ve.
 */
function sliceSeries(series: CandleSeries, end: number, window: number): CandleSeries {
  const start = Math.max(0, end + 1 - window);
  return { ...series, candles: series.candles.slice(start, end + 1) };
}

/**
 * Fatiador com cursor monotonico.
 *
 * O tempo simulado so avanca, por isso o ponto de corte de cada serie auxiliar
 * tambem so avanca. Guardar o cursor e cortar com `slice` substitui um
 * `filter` com callback sobre a serie inteira em CADA vela — que, com 1350
 * velas simuladas e 3 series de referencia, custava varios milhoes de chamadas
 * de funcao por instrumento.
 *
 * A semantica e identica: ambas as versoes devolvem exatamente as velas com
 * `time <= maxTime`. So muda o custo.
 */
class TimeSlicer {
  private cursor = 0;
  private readonly duration: number;

  constructor(
    private readonly series: CandleSeries,
    private readonly window: number,
    /**
     * Se true, so inclui velas que ja FECHARAM em `maxTime`.
     *
     * Obrigatorio para o timeframe superior. Sem isto havia lookahead directo:
     * numa terca-feira, a vela SEMANAL aberta na segunda seria incluida inteira
     * — com a maxima, a minima e o fecho de toda a semana, incluindo sexta. Como
     * a narrativa HTF e o passo 2 do checklist, o backtest estaria a decidir com
     * conhecimento do futuro no criterio que mais elimina operacoes.
     *
     * Para o timeframe de execucao NAO se aplica: a vela diaria corrente ja
     * fechou no momento em que a decisao e tomada.
     */
    private readonly onlyClosed = false,
  ) {
    this.duration = TIMEFRAME_DURATION[series.timeframe] ?? 0;
  }

  sliceTo(maxTime: number): CandleSeries {
    const candles = this.series.candles;
    const limit = this.onlyClosed ? maxTime - this.duration : maxTime;

    while (this.cursor < candles.length && (candles[this.cursor]?.time ?? Infinity) <= limit) {
      this.cursor++;
    }
    const start = Math.max(0, this.cursor - this.window);
    return { ...this.series, candles: candles.slice(start, this.cursor) };
  }
}

/** Duracao nominal de cada timeframe, para saber quando uma vela ja fechou. */
const TIMEFRAME_DURATION: Record<string, number> = {
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
  '1M': 2_592_000_000,
};

/** Conjunto de fatiadores para as series de referencia de SMT. */
class ReferenceSlicer {
  private readonly slicers: Array<[string, TimeSlicer]>;

  constructor(references: Map<string, CandleSeries>, window: number) {
    this.slicers = [...references].map(([symbol, series]) => [
      symbol,
      new TimeSlicer(series, window),
    ]);
  }

  sliceTo(maxTime: number): Map<string, CandleSeries> {
    const out = new Map<string, CandleSeries>();
    for (const [symbol, slicer] of this.slicers) out.set(symbol, slicer.sliceTo(maxTime));
    return out;
  }
}

function summarize(
  primary: CandleSeries,
  trades: BacktestTrade[],
  totalSignals: number,
  risk: RiskConfig,
): BacktestResult {
  const closed = trades.filter((t) => t.outcome === 'win' || t.outcome === 'loss' || t.outcome === 'breakeven');
  const wins = closed.filter((t) => t.rMultiple > 0.05);
  const losses = closed.filter((t) => t.rMultiple < -0.05);

  const rs = closed.map((t) => t.rMultiple);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const avg = (xs: number[]) => (xs.length > 0 ? sum(xs) / xs.length : 0);

  const grossWin = sum(wins.map((t) => t.rMultiple));
  const grossLoss = Math.abs(sum(losses.map((t) => t.rMultiple)));

  const winRate = closed.length > 0 ? wins.length / closed.length : 0;
  const averageWinR = avg(wins.map((t) => t.rMultiple));

  const sequence = simulateSequence(rs, risk);

  const first = primary.candles[0];
  const last = primary.candles[primary.candles.length - 1];

  return {
    symbol: primary.symbol,
    periodStart: new Date(first?.time ?? 0).toISOString().slice(0, 10),
    periodEnd: new Date(last?.time ?? 0).toISOString().slice(0, 10),
    trades,
    totalSignals,
    filled: closed.length + trades.filter((t) => t.outcome === 'open').length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    averageR: avg(rs),
    averageWinR,
    averageLossR: avg(losses.map((t) => t.rMultiple)),
    expectancyR: expectancy(winRate, averageWinR),
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    maxDrawdownPercent: sequence.maxDrawdownPercent,
    finalBalance: sequence.finalBalance,
    rDistribution: rs.slice().sort((a, b) => a - b),
  };
}

/** Resumo textual de um backtest. */
export function formatBacktest(result: BacktestResult): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const lines = [
    `--- ${result.symbol}  ${result.periodStart} a ${result.periodEnd} ---`,
    `sinais=${result.totalSignals}  preenchidos=${result.filled}  ` +
      `nao preenchidos=${result.trades.filter((t) => t.outcome === 'never-filled').length}`,
    `vitorias=${result.wins}  derrotas=${result.losses}  taxa de acerto=${pct(result.winRate)}`,
    `R medio=${result.averageR.toFixed(2)}  R medio ganho=${result.averageWinR.toFixed(2)}  ` +
      `R medio perdido=${result.averageLossR.toFixed(2)}`,
    `expectativa=${result.expectancyR.toFixed(3)}R por operacao  ` +
      `profit factor=${result.profitFactor === Infinity ? 'inf' : result.profitFactor.toFixed(2)}`,
    `drawdown maximo=${result.maxDrawdownPercent.toFixed(1)}%  saldo final=${result.finalBalance.toFixed(2)}`,
  ];

  if (result.rDistribution.length > 0) {
    const d = result.rDistribution;
    const q = (p: number) => d[Math.min(d.length - 1, Math.floor(d.length * p))]?.toFixed(2) ?? '-';
    lines.push(`distribuicao R: min=${q(0)} p25=${q(0.25)} mediana=${q(0.5)} p75=${q(0.75)} max=${d[d.length - 1]?.toFixed(2)}`);
  }

  return lines.join('\n');
}
