/**
 * VWAP e bandas de desvio-padrão.
 *
 * PORQUE É QUE O VWAP É A REFERÊNCIA INSTITUCIONAL
 * -------------------------------------------------
 * O VWAP não nasceu como sinal. Nasceu como **régua de avaliação de execução**.
 * Quando um gestor de carteira manda comprar 400 000 ações, a mesa de execução é
 * julgada por comparação: comprou acima ou abaixo do preço médio ponderado por
 * volume do intervalo? É o número que determina se o trader fez bem o trabalho,
 * e alimenta uma fatia enorme do volume executado por algoritmos.
 *
 * Daqui vem o único argumento honesto para o usar como sinal: se uma parte
 * material do fluxo tem por objetivo executar perto do VWAP, então existe
 * procura mecânica abaixo dele (para compradores) e oferta mecânica acima
 * (para vendedores) enquanto a ordem estiver a ser trabalhada.
 *
 * E aqui vem o contra-argumento, que é preciso dizer em voz alta: **essa procura
 * é indiferente à direção**. O algoritmo compra abaixo do VWAP porque tem de
 * comprar, não porque acha que o preço vai subir. Não há razão para que produza
 * retorno para quem estiver do outro lado. Usar o VWAP como preditor é uma
 * extrapolação que a sua função institucional NÃO sustenta.
 *
 * O QUE AS BANDAS SÃO E NÃO SÃO
 * ------------------------------
 * σ é o desvio-padrão ponderado por volume do preço típico em torno do VWAP
 * corrente. As bandas são VWAP ± k·σ.
 *
 *   - **Não são intervalos de confiança.** A distribuição do preço em torno do
 *     VWAP não é normal — tem caudas grossas e é frequentemente assimétrica.
 *     "2σ" aqui não significa 95%.
 *   - **São calculadas no mesmo caminho que avaliam.** O σ à vela `i` usa as
 *     velas 0..i, incluindo a que produz o sinal. É uma medida em amostra.
 *   - **São instáveis no início.** Com 3 ou 4 velas desde a âncora, o σ oscila
 *     violentamente. `minSamplesForBands` marca esses pontos.
 *
 * A ESCOLHA DA ÂNCORA É UM PARÂMETRO LIVRE
 * -----------------------------------------
 * Um VWAP acumulado desde o início da série mistura meses de regimes diferentes
 * e o σ deixa de significar o que quer que seja. Por isso existem dois modos:
 * `computeAnchoredVwap` (âncora explícita ou de calendário) e
 * `computeRollingVwap` (janela fixa). Escolher a âncora "onde o gráfico fica
 * bonito" é sobre-ajuste com outro nome.
 *
 * SEM VOLUME, ISTO NÃO É VWAP
 * ----------------------------
 * O forex à vista não tem volume consolidado — não existe bolsa central. Se a
 * série vier com volume 0, o cálculo degenera em TWAP (média ponderada por
 * tempo) e o nome "VWAP" passa a ser mentira. `usedVolume: false` e um aviso
 * explícito marcam esse caso em vez de o esconder.
 */

import { candleMidpoint, type Candle, type Direction, type Timeframe } from '../types/market.js';
import { clamp, volumeIsUsable, type StrategySignal } from './types.js';

export type VwapAnchorKind = 'index' | 'week' | 'month' | 'quarter' | 'year' | 'series';

export interface VwapPoint {
  index: number;
  time: number;
  vwap: number;
  /** Desvio-padrão ponderado por volume do preço típico em torno do VWAP. */
  sigma: number;
  upper1: number;
  lower1: number;
  upper2: number;
  lower2: number;
  upper3: number;
  lower3: number;
  cumulativeVolume: number;
  /** Velas incluídas desde a âncora. Abaixo de ~10 o σ não é utilizável. */
  samples: number;
}

export interface VwapResult {
  points: VwapPoint[];
  anchorIndex: number;
  anchorTime: number;
  anchorKind: VwapAnchorKind | 'rolling';
  /** False quando a série não tinha volume e o cálculo degenerou em TWAP. */
  usedVolume: boolean;
  warnings: string[];
}

export interface VwapOptions {
  anchor?: VwapAnchorKind;
  /** Obrigatório quando `anchor` é 'index'. */
  anchorIndex?: number;
  /** Abaixo deste número de velas o σ é considerado não fiável. Por omissão 10. */
  minSamplesForBands?: number;
  /**
   * Preço representativo de cada vela. 'typical' = (H+L+C)/3 é a convenção;
   * 'median' = (H+L)/2 ignora o fecho; 'close' é o mais simples e o menos fiel.
   */
  priceMode?: 'typical' | 'median' | 'close';
}

/** Preço típico: (H + L + C) / 3. É a convenção usada pelas mesas. */
export function typicalPrice(c: Candle): number {
  return (c.high + c.low + c.close) / 3;
}

function priceOf(c: Candle, mode: VwapOptions['priceMode']): number {
  if (mode === 'close') return c.close;
  if (mode === 'median') return candleMidpoint(c);
  return typicalPrice(c);
}

/** Último início de período de calendário (UTC) presente na série. */
function findCalendarAnchor(candles: readonly Candle[], kind: VwapAnchorKind): number {
  if (kind === 'series' || kind === 'index') return 0;

  const keyOf = (time: number): string => {
    const d = new Date(time);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    switch (kind) {
      case 'year':
        return `${y}`;
      case 'quarter':
        return `${y}-Q${Math.floor(m / 3)}`;
      case 'month':
        return `${y}-${m}`;
      case 'week': {
        // Semana ISO aproximada: início à segunda-feira UTC.
        const day = d.getUTCDay();
        const offset = (day + 6) % 7; // segunda = 0
        const monday = time - offset * 86_400_000;
        return `W${Math.floor(monday / 86_400_000)}`;
      }
      default:
        return `${y}`;
    }
  };

  const lastCandle = candles[candles.length - 1];
  if (!lastCandle) return 0;
  const targetKey = keyOf(lastCandle.time);

  for (let i = candles.length - 1; i >= 0; i--) {
    const c = candles[i];
    if (!c) continue;
    if (keyOf(c.time) !== targetKey) return i + 1;
  }
  return 0;
}

/**
 * VWAP ancorado, com bandas de σ, calculado de forma acumulada a partir da
 * âncora até ao fim da série.
 */
export function computeAnchoredVwap(
  candles: readonly Candle[],
  options: VwapOptions = {},
): VwapResult {
  const warnings: string[] = [];
  const anchorKind = options.anchor ?? 'series';
  const minSamples = options.minSamplesForBands ?? 10;

  if (candles.length === 0) {
    return {
      points: [],
      anchorIndex: 0,
      anchorTime: 0,
      anchorKind,
      usedVolume: false,
      warnings: ['Série vazia.'],
    };
  }

  let anchorIndex: number;
  if (anchorKind === 'index') {
    anchorIndex = clamp(options.anchorIndex ?? 0, 0, candles.length - 1);
  } else {
    anchorIndex = findCalendarAnchor(candles, anchorKind);
  }

  const usedVolume = volumeIsUsable(candles.slice(anchorIndex));
  if (!usedVolume) {
    warnings.push(
      'A série não traz volume utilizável — o cálculo degenerou em TWAP (média ponderada por ' +
        'tempo). Isto NÃO é um VWAP e não representa a referência de execução institucional. ' +
        'Típico do forex à vista, que não tem bolsa central nem volume consolidado.',
    );
  }

  if (anchorKind === 'series' && candles.length - anchorIndex > 250) {
    warnings.push(
      `VWAP acumulado sobre ${candles.length - anchorIndex} velas. Um acumulado tão longo mistura ` +
        'regimes de volatilidade diferentes e o σ deixa de ter significado estatístico. ' +
        'Preferir uma âncora de calendário ou `computeRollingVwap`.',
    );
  }

  const points: VwapPoint[] = [];
  let cumWeight = 0;
  let cumWeightedPrice = 0;
  let cumWeightedPriceSq = 0;
  let samples = 0;
  let unstableFlagged = false;

  for (let i = anchorIndex; i < candles.length; i++) {
    const c = candles[i];
    if (!c) continue;
    const p = priceOf(c, options.priceMode);
    const w = usedVolume ? c.volume : 1;
    if (!(w > 0) || !(p > 0)) continue;

    cumWeight += w;
    cumWeightedPrice += w * p;
    cumWeightedPriceSq += w * p * p;
    samples++;

    const vwap = cumWeightedPrice / cumWeight;
    // Variância ponderada na forma computacional E[p²] − E[p]².
    const rawVariance = cumWeightedPriceSq / cumWeight - vwap * vwap;
    const sigma = rawVariance > 0 ? Math.sqrt(rawVariance) : 0;

    if (samples < minSamples && !unstableFlagged) unstableFlagged = true;

    points.push({
      index: i,
      time: c.time,
      vwap,
      sigma,
      upper1: vwap + sigma,
      lower1: vwap - sigma,
      upper2: vwap + 2 * sigma,
      lower2: vwap - 2 * sigma,
      upper3: vwap + 3 * sigma,
      lower3: vwap - 3 * sigma,
      cumulativeVolume: cumWeight,
      samples,
    });
  }

  if (points.length > 0 && points.length < minSamples) {
    warnings.push(
      `Apenas ${points.length} velas desde a âncora. O σ está instável — as bandas nos primeiros ` +
        'pontos após uma âncora são ruído, não estrutura.',
    );
  }

  const anchorCandle = candles[anchorIndex];
  return {
    points,
    anchorIndex,
    anchorTime: anchorCandle?.time ?? 0,
    anchorKind,
    usedVolume,
    warnings,
  };
}

/**
 * VWAP de janela deslizante — sem acumulação desde uma âncora.
 *
 * Evita o problema do acumulado longo: cada ponto usa exatamente `period` velas,
 * pelo que o σ mede sempre a mesma quantidade de história. Em contrapartida
 * perde a interpretação institucional (nenhuma mesa é avaliada contra um VWAP
 * de 20 dias móveis).
 */
export function computeRollingVwap(
  candles: readonly Candle[],
  period = 20,
  options: VwapOptions = {},
): VwapResult {
  const warnings: string[] = [];
  const usedVolume = volumeIsUsable(candles);
  if (!usedVolume) {
    warnings.push(
      'Sem volume utilizável — o resultado é um TWAP de janela deslizante, não um VWAP.',
    );
  }

  const points: VwapPoint[] = [];

  for (let i = period - 1; i < candles.length; i++) {
    let cumWeight = 0;
    let cumWeightedPrice = 0;
    let cumWeightedPriceSq = 0;
    let samples = 0;

    for (let k = i - period + 1; k <= i; k++) {
      const c = candles[k];
      if (!c) continue;
      const p = priceOf(c, options.priceMode);
      const w = usedVolume ? c.volume : 1;
      if (!(w > 0) || !(p > 0)) continue;
      cumWeight += w;
      cumWeightedPrice += w * p;
      cumWeightedPriceSq += w * p * p;
      samples++;
    }
    if (cumWeight <= 0 || samples < 2) continue;

    const cur = candles[i];
    if (!cur) continue;
    const vwap = cumWeightedPrice / cumWeight;
    const rawVariance = cumWeightedPriceSq / cumWeight - vwap * vwap;
    const sigma = rawVariance > 0 ? Math.sqrt(rawVariance) : 0;

    points.push({
      index: i,
      time: cur.time,
      vwap,
      sigma,
      upper1: vwap + sigma,
      lower1: vwap - sigma,
      upper2: vwap + 2 * sigma,
      lower2: vwap - 2 * sigma,
      upper3: vwap + 3 * sigma,
      lower3: vwap - 3 * sigma,
      cumulativeVolume: cumWeight,
      samples,
    });
  }

  const first = points[0];
  return {
    points,
    anchorIndex: Math.max(0, period - 1),
    anchorTime: first?.time ?? 0,
    anchorKind: 'rolling',
    usedVolume,
    warnings,
  };
}

/**
 * Distância do preço ao VWAP em unidades de σ.
 *
 * É um z-score, mas NÃO é um z-score de uma distribuição normal — ver o cabeçalho.
 */
export function vwapZScore(point: VwapPoint, price: number): number {
  if (point.sigma <= 0) return 0;
  return (price - point.vwap) / point.sigma;
}

export interface VwapPlanOptions {
  symbol: string;
  timeframe: Timeframe;
  minRMultiple?: number;
  /** Bandas a partir das quais se considera extensão. Por omissão 2. */
  reversionSigma?: number;
  /** Multiplicador do stop, em σ além da banda de entrada. Por omissão 1. */
  stopSigmaBeyond?: number;
  /** VWAP já calculado; se omitido usa âncora mensal. */
  vwap?: VwapResult;
  /** Mínimo de velas desde a âncora para o sinal ser aceite. Por omissão 15. */
  minSamples?: number;
}

/**
 * Produz sinais a partir da posição da ÚLTIMA vela fechada face ao VWAP.
 *
 * **Reversão** — o fecho está para lá de ±kσ. Alvo: o VWAP. É a operação que a
 * literatura de retalho chama "fade the band"; funciona em mercado em balanço e
 * é atropelada em tendência, que é precisamente quando o preço fica dias
 * seguidos fora da banda.
 *
 * **Continuação** — o preço está do mesmo lado do VWAP, o VWAP tem inclinação
 * na mesma direção, e a vela regressou ao VWAP. É a réplica direta da lógica de
 * execução: quem tem de comprar compra abaixo da referência. Alvo: a banda
 * oposta a 1σ e 2σ.
 */
export function planVwapTrades(
  candles: readonly Candle[],
  options: VwapPlanOptions,
): StrategySignal[] {
  const list = candles as Candle[];
  if (list.length < 30) return [];

  const lastIndex = list.length - 1;
  const last = list[lastIndex];
  if (!last) return [];

  const result = options.vwap ?? computeAnchoredVwap(list, { anchor: 'month' });
  const point = result.points[result.points.length - 1];
  if (!point || point.index !== lastIndex || point.sigma <= 0) return [];

  const minSamples = options.minSamples ?? 15;
  if (point.samples < minSamples) return [];

  const minR = options.minRMultiple ?? 2;
  const kReversion = options.reversionSigma ?? 2;
  const stopBeyond = options.stopSigmaBeyond ?? 1;

  const z = vwapZScore(point, last.close);
  const baseAssumptions = [
    'O VWAP é uma régua de avaliação de execução, não um preditor. A procura algorítmica em torno dele é indiferente à direção.',
    'As bandas de σ não são intervalos de confiança: a distribuição do preço em torno do VWAP não é normal e tem caudas grossas.',
    'O σ é calculado com as mesmas velas que produzem o sinal — é uma medida em amostra.',
    'A escolha da âncora é um parâmetro livre com efeito grande no resultado.',
  ];
  const warnings = [...result.warnings];
  if (!result.usedVolume) {
    baseAssumptions.push(
      'Sem volume: isto é um TWAP. A justificação institucional do VWAP não se aplica de todo.',
    );
  }

  const out: StrategySignal[] = [];

  // ------------------------------------------------------------------ reversão
  if (Math.abs(z) >= kReversion) {
    const direction: Direction = z > 0 ? 'bearish' : 'bullish';
    const sign = direction === 'bullish' ? 1 : -1;
    const entryPrice = last.close;
    const stopLoss =
      z > 0
        ? point.vwap + (Math.abs(z) + stopBeyond) * point.sigma
        : point.vwap - (Math.abs(z) + stopBeyond) * point.sigma;
    const risk = Math.abs(entryPrice - stopLoss);

    if (risk > 0) {
      const tp1 = z > 0 ? point.upper1 : point.lower1;
      const tp2 = point.vwap;
      const rOf = (p: number) => (sign * (p - entryPrice)) / risk;
      const raw = [
        {
          price: tp1,
          r: rOf(tp1),
          rationale: 'Regresso à banda de 1σ — a primeira zona onde o preço deixa de estar estendido.',
        },
        {
          price: tp2,
          r: rOf(tp2),
          rationale:
            'VWAP — a referência de execução. É o nível para onde a mecânica de execução ' +
            'algorítmica empurra o preço enquanto houver ordens a ser trabalhadas.',
        },
      ].filter((t) => t.r > 0.3);

      if (raw.length > 0) {
        const fractions = raw.length === 1 ? [1] : [0.5, 0.5];
        const targets = raw.map((t, i) => ({
          price: t.price,
          rMultiple: t.r,
          closeFraction: fractions[i] ?? 0,
          rationale: t.rationale,
        }));
        const maxRMultiple = targets.reduce((m, t) => Math.max(m, t.rMultiple), 0);

        if (maxRMultiple >= minR) {
          out.push({
            strategy: 'vwap-bands',
            symbol: options.symbol,
            timeframe: options.timeframe,
            direction,
            regime: 'mean-reversion',
            index: lastIndex,
            generatedAt: last.time,
            referencePrice: last.close,
            entryZoneLow: Math.min(entryPrice, z > 0 ? point.upper2 : point.lower2),
            entryZoneHigh: Math.max(entryPrice, z > 0 ? point.upper2 : point.lower2),
            entryPrice,
            stopLoss,
            targets,
            maxRMultiple,
            conviction: clamp((Math.abs(z) - kReversion) / 2 + 0.4, 0, 1),
            rationale:
              `Fecho a ${z.toFixed(2)}σ do VWAP (${point.vwap.toFixed(5)}), âncora ${result.anchorKind} ` +
              `com ${point.samples} velas. Extensão face à referência de execução.`,
            assumptions: [
              ...baseAssumptions,
              'Assume regime de balanço. Numa tendência o preço permanece fora da banda durante dias e esta operação é atropelada repetidamente.',
            ],
            warnings,
          });
        }
      }
    }
  }

  // --------------------------------------------------------------- continuação
  const prevPoint = result.points[result.points.length - 6];
  if (prevPoint && Math.abs(z) < 0.75) {
    const slope = point.vwap - prevPoint.vwap;
    const slopeSigma = point.sigma > 0 ? slope / point.sigma : 0;

    if (Math.abs(slopeSigma) > 0.25) {
      const direction: Direction = slope > 0 ? 'bullish' : 'bearish';
      const sign = direction === 'bullish' ? 1 : -1;
      const entryPrice = point.vwap;
      const stopLoss =
        direction === 'bullish'
          ? point.vwap - stopBeyond * point.sigma
          : point.vwap + stopBeyond * point.sigma;
      const risk = Math.abs(entryPrice - stopLoss);

      if (risk > 0) {
        const t1 = direction === 'bullish' ? point.upper1 : point.lower1;
        const t2 = direction === 'bullish' ? point.upper2 : point.lower2;
        const rOf = (p: number) => (sign * (p - entryPrice)) / risk;
        const targets = [
          {
            price: t1,
            rMultiple: rOf(t1),
            closeFraction: 0.5,
            rationale: 'Banda de 1σ na direção da inclinação do VWAP.',
          },
          {
            price: t2,
            rMultiple: rOf(t2),
            closeFraction: 0.5,
            rationale: 'Banda de 2σ — extensão máxima antes de a reversão passar a ser o cenário base.',
          },
        ].filter((t) => t.rMultiple > 0.3);

        const maxRMultiple = targets.reduce((m, t) => Math.max(m, t.rMultiple), 0);
        if (targets.length > 0 && maxRMultiple >= minR) {
          out.push({
            strategy: 'vwap-bands',
            symbol: options.symbol,
            timeframe: options.timeframe,
            direction,
            regime: 'continuation',
            index: lastIndex,
            generatedAt: last.time,
            referencePrice: last.close,
            entryZoneLow: Math.min(point.vwap, last.low),
            entryZoneHigh: Math.max(point.vwap, last.high),
            entryPrice,
            stopLoss,
            targets,
            maxRMultiple,
            conviction: clamp(Math.abs(slopeSigma) * 0.6 + 0.2, 0, 1),
            rationale:
              `Preço regressou ao VWAP (${point.vwap.toFixed(5)}) com o VWAP inclinado ` +
              `${slopeSigma.toFixed(2)}σ nas últimas 5 velas. É a posição em que uma mesa com ordem de ` +
              `${direction === 'bullish' ? 'compra' : 'venda'} executa: ${direction === 'bullish' ? 'abaixo' : 'acima'} da referência.`,
            assumptions: [
              ...baseAssumptions,
              'Assume que a inclinação do VWAP persiste. A inclinação é uma média acumulada: reage tarde a viragens de regime.',
            ],
            warnings,
          });
        }
      }
    }
  }

  return out;
}
