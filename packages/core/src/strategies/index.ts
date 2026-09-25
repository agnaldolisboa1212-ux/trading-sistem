/**
 * Estratégias institucionais — ponto de entrada.
 *
 * Estas estratégias são COMPLEMENTARES ao MMXM/SMT que já existe em
 * `mmxm/` e `smt/`. Não o substituem, não o alteram e não partilham estado com
 * ele. São executadas sobre a mesma série e devolvem sinais no seu próprio
 * formato (`StrategySignal`), separado de `TradeSignal`.
 *
 * PORQUE É QUE NÃO EXISTE AQUI UMA "PONTUAÇÃO COMBINADA"
 * -------------------------------------------------------
 * Seria fácil somar as convicções de quatro estratégias e chamar-lhe confiança.
 * Seria errado, por uma razão concreta: **os sinais não são independentes**.
 * Uma zona de oferta, um nível de resistência, a banda superior do VWAP e a VAH
 * do perfil de volume caem frequentemente no mesmo sítio — não porque quatro
 * mecanismos distintos concordam, mas porque as quatro são transformações dos
 * MESMOS dados OHLCV. Tratar isso como quatro confirmações independentes é o
 * erro estatístico que faz sistemas de confluência parecerem muito melhores do
 * que são.
 *
 * `assessConfluence` conta e descreve o alinhamento. Não devolve probabilidade
 * conjunta nenhuma, e não a devolverá enquanto a correlação entre os sinais não
 * for medida sobre resultados reais.
 *
 * O README deste projeto já documenta que a estratégia existente não tem
 * vantagem demonstrada. Estas também não têm. Nenhuma foi submetida a backtest
 * neste momento. Ver `docs/estrategias-institucionais.md` para o que é preciso
 * fazer antes de qualquer uma poder ser levada a sério.
 */

import type { CandleSeries, Direction, Timeframe } from '../types/market.js';
import type { StrategyId, StrategySignal } from './types.js';

import { planSupplyDemandTrades } from './supply-demand.js';
import { planSupportResistanceTrades } from './support-resistance.js';
import { planVwapTrades } from './vwap.js';
import { planVolumeProfileTrades } from './volume-profile.js';
import { assessOhlcQuality } from '../indicators/quality.js';

export * from './types.js';
export * from './volatility.js';
export * from './support-resistance.js';
export * from './supply-demand.js';
export * from './vwap.js';
export * from './volume-profile.js';
export * from './contexto.js';
export * from './validadas.js';
export * from './em-teste.js';
export * from './conviccao-dinamica.js';

export interface RunStrategiesOptions {
  /** R mínimo exigido a qualquer sinal. Por omissão 2. */
  minRMultiple?: number;
  /** Estratégias a correr. Por omissão, todas. */
  only?: StrategyId[];
  /** 
   * [SEGURANÇA / Subagente 5] Lista estrita de símbolos autorizados. 
   * Se definido, qualquer tentativa de processar um símbolo fora da lista será rejeitada. 
   */
  allowedSymbols?: string[];
}

export interface RunStrategiesResult {
  symbol: string;
  timeframe: Timeframe;
  /** Todos os sinais, ordenados por convicção decrescente. */
  signals: StrategySignal[];
  byStrategy: Record<StrategyId, StrategySignal[]>;
  /** Problemas com os dados que afetam TODAS as estratégias. */
  dataWarnings: string[];
}

const ALL_STRATEGIES: StrategyId[] = [
  'supply-demand',
  'support-resistance',
  'vwap-bands',
  'volume-profile',
];

/**
 * Corre as estratégias institucionais sobre uma série e devolve os sinais.
 *
 * Função PURA: só lê a série que recebe. O instante do sinal vem sempre de
 * `candle.time` da última vela FECHADA — quem chama é responsável por não
 * passar uma vela em formação.
 */
export function runInstitutionalStrategies(
  series: CandleSeries,
  options: RunStrategiesOptions = {},
): RunStrategiesResult {
  const enabled = new Set(options.only ?? ALL_STRATEGIES);
  const context = {
    symbol: series.symbol,
    timeframe: series.timeframe,
    minRMultiple: options.minRMultiple ?? 2,
  };

  const byStrategy: Record<StrategyId, StrategySignal[]> = {
    'supply-demand': [],
    'support-resistance': [],
    'vwap-bands': [],
    'volume-profile': [],
  };

  const dataWarnings: string[] = [];

  // [Subagente 5] Segurança / Restrição de Portfólio
  if (options.allowedSymbols && !options.allowedSymbols.includes(series.symbol.toUpperCase())) {
    dataWarnings.push(`[SEGURANÇA] O ativo ${series.symbol} não faz parte do portfólio. O algoritmo ICT ALGO recusa-se a analisá-lo.`);
    return { symbol: series.symbol, timeframe: series.timeframe, signals: [], byStrategy, dataWarnings };
  }

  if (series.fidelity !== 'true-ohlc') {
    dataWarnings.push(
      `Série marcada como '${series.fidelity}': sem máxima e mínima reais, os estimadores de ` +
        'intervalo, o perfil de volume e a deteção de bases não têm significado.',
    );
    return { symbol: series.symbol, timeframe: series.timeframe, signals: [], byStrategy, dataWarnings };
  }

  const quality = assessOhlcQuality(series.candles);
  if (quality.degenerate) {
    dataWarnings.push(`OHLC degenerado: ${quality.reason}`);
    return { symbol: series.symbol, timeframe: series.timeframe, signals: [], byStrategy, dataWarnings };
  }

  if (enabled.has('supply-demand')) {
    byStrategy['supply-demand'] = planSupplyDemandTrades(series.candles, context);
  }
  if (enabled.has('support-resistance')) {
    byStrategy['support-resistance'] = planSupportResistanceTrades(series.candles, context);
  }
  if (enabled.has('vwap-bands')) {
    byStrategy['vwap-bands'] = planVwapTrades(series.candles, context);
  }
  if (enabled.has('volume-profile')) {
    byStrategy['volume-profile'] = planVolumeProfileTrades(series.candles, context);
  }

  const signals = ALL_STRATEGIES.flatMap((id) => byStrategy[id]).sort(
    (a, b) => b.conviction - a.conviction,
  );

  return { symbol: series.symbol, timeframe: series.timeframe, signals, byStrategy, dataWarnings };
}

export interface ConfluenceReport {
  direction: Direction | 'conflicted' | 'none';
  /** Quantas estratégias DISTINTAS apontam na direção dominante. */
  agreeingStrategies: number;
  /** Quantas apontam ao contrário. */
  opposingStrategies: number;
  bullish: StrategySignal['strategy'][];
  bearish: StrategySignal['strategy'][];
  /**
   * Convicção máxima entre os sinais alinhados. Deliberadamente o MÁXIMO e não
   * a soma nem a média: somar convicções de sinais correlacionados inventa
   * confiança que não existe.
   */
  maxConviction: number;
  /** Texto legível, incluindo o aviso de não-independência. */
  detail: string;
  caveats: string[];
}

/**
 * Descreve o alinhamento entre estratégias — sem inventar probabilidade conjunta.
 *
 * O que esta função devolve é uma CONTAGEM e uma descrição. Se três estratégias
 * concordam, isso é informação; mas quanto vale exige saber quão correlacionadas
 * são, e isso não está medido.
 */
export function assessConfluence(signals: readonly StrategySignal[]): ConfluenceReport {
  const bullish = [...new Set(signals.filter((s) => s.direction === 'bullish').map((s) => s.strategy))];
  const bearish = [...new Set(signals.filter((s) => s.direction === 'bearish').map((s) => s.strategy))];

  const caveats = [
    'As quatro estratégias são transformações dos MESMOS dados OHLCV. Concordarem não é o mesmo ' +
      'que quatro fontes independentes concordarem — zonas, níveis, bandas e value area coincidem ' +
      'por construção geométrica.',
    'A convicção reportada é o máximo entre os sinais alinhados, nunca a soma: somar convicções ' +
      'de sinais correlacionados sobrestima a confiança de forma sistemática.',
    'Nenhuma destas estratégias tem vantagem demonstrada neste projeto.',
  ];

  let direction: ConfluenceReport['direction'];
  if (bullish.length === 0 && bearish.length === 0) direction = 'none';
  else if (bullish.length > 0 && bearish.length > 0) direction = 'conflicted';
  else direction = bullish.length > 0 ? 'bullish' : 'bearish';

  const agreeing =
    direction === 'bullish' ? bullish.length : direction === 'bearish' ? bearish.length : 0;
  const opposing =
    direction === 'bullish' ? bearish.length : direction === 'bearish' ? bullish.length : 0;

  const aligned =
    direction === 'bullish' || direction === 'bearish'
      ? signals.filter((s) => s.direction === direction)
      : [];
  const maxConviction = aligned.reduce((m, s) => Math.max(m, s.conviction), 0);

  const detail =
    direction === 'none'
      ? 'Nenhuma estratégia institucional produziu sinal nesta vela.'
      : direction === 'conflicted'
        ? `Conflito: ${bullish.length} estratégia(s) em alta (${bullish.join(', ')}) contra ` +
          `${bearish.length} em baixa (${bearish.join(', ')}). Sem leitura.`
        : `${agreeing} estratégia(s) alinhadas em ${direction === 'bullish' ? 'alta' : 'baixa'} ` +
          `(${(direction === 'bullish' ? bullish : bearish).join(', ')}), convicção máxima ` +
          `${maxConviction.toFixed(2)}.`;

  return {
    direction,
    agreeingStrategies: agreeing,
    opposingStrategies: opposing,
    bullish,
    bearish,
    maxConviction,
    detail,
    caveats,
  };
}
