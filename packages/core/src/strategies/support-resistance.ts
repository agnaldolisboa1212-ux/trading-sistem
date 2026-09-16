/**
 * Suporte e resistência — níveis horizontais, com o mecanismo que os explica.
 *
 * A BASE, E PORQUE NÃO É MÁGICA
 * ------------------------------
 * A explicação séria de porque níveis horizontais têm poder preditivo não é
 * "memória do mercado": é **aglomeração de ordens em repouso**. Carol Osler,
 * com o livro de ordens completo do Royal Bank of Scotland (1999-2000, ~9 655
 * ordens, >55 mil M USD, em USDJPY, GBPUSD e EURUSD), mediu duas coisas
 * distintas:
 *
 *   - as ordens de **take-profit** aglomeram-se EM números redondos → o preço
 *     tende a inverter aí, porque há um muro de ordens limitadas contrárias;
 *   - as ordens de **stop-loss** aglomeram-se LOGO ALÉM dos números redondos →
 *     quando o nível cede, os stops disparam em cascata e o movimento acelera.
 *
 * Isto é importante para o desenho: o **mesmo nível** justifica dois sinais
 * opostos, e qual deles vale depende de o preço ter ou não atravessado. Por isso
 * este módulo produz sinais em dois regimes explícitos (`mean-reversion` e
 * `continuation`) em vez de decidir por nós qual é "o certo".
 *
 * SUPOSIÇÕES, E QUANDO O MERCADO AS VIOLA
 * ----------------------------------------
 * 1. **Há liquidez em repouso no nível.** Falso em notícia macro (NFP, CPI,
 *    decisões de bancos centrais): os criadores de mercado retiram as ordens e o
 *    nível deixa de existir segundos antes de o preço lá chegar.
 * 2. **A aglomeração medida no forex de balcão transfere-se para outros ativos.**
 *    Não demonstrado. O estudo é sobre três pares de forex à vista com um único
 *    dealer. Cripto, índices e metais têm microestruturas diferentes.
 * 3. **O nível é estável no tempo.** Os níveis são estimados a partir dos
 *    mesmos dados em que são testados. Um nível "com 5 toques" só tem 5 toques
 *    PORQUE olhámos para trás — é seleção pós-facto, e é exatamente o mecanismo
 *    que faz gráficos parecerem mais previsíveis do que são.
 * 4. **Um toque é um evento identificável.** Não é. A tolerância que decide o
 *    que conta como "o mesmo nível" é um parâmetro livre; apertá-la ou alargá-la
 *    muda o número de toques e, com ele, toda a pontuação.
 *
 * Nada disto está validado neste projeto. Ver `docs/estrategias-institucionais.md`.
 */

import type { Candle, Direction, Timeframe } from '../types/market.js';
import type { SwingPoint } from '../types/structure.js';
import { computeAtr } from '../indicators/fvg.js';
import { buildSwingLadder } from '../indicators/swings.js';
import { ageDecay, clamp, type StrategySignal } from './types.js';
import { estimateVolatility, sigmaToPriceDistance } from './volatility.js';

export type LevelKind = 'support' | 'resistance' | 'flip';

export interface SupportResistanceLevel {
  /** Preço central do nível (média dos pivôs do cluster). */
  price: number;
  /** Limites da zona — um nível é uma faixa, nunca uma linha. */
  zoneLow: number;
  zoneHigh: number;
  kind: LevelKind;
  /** Número de pivôs distintos que formam o cluster. */
  touches: number;
  /** Índices das velas dos pivôs. */
  memberIndices: number[];
  /** Índice do pivô mais recente. */
  lastTouchIndex: number;
  /** Índice em que um FECHO atravessou o nível de forma material, se ocorreu. */
  brokenAtIndex: number | null;
  /**
   * Reação média após cada toque, em múltiplos do ATR local. Mede quanto o
   * preço se afastou — um nível com muitos toques e reação nula é um nível que
   * o preço atravessa, não um nível que o suporta.
   */
  averageReactionAtr: number;
  /** Múltiplo redondo a que o nível corresponde, ou null. */
  roundNumberIncrement: number | null;
  /**
   * Força em 0..1. Combinação de toques, frescura, reação e roundness.
   * NÃO é probabilidade — ver a nota em `StrategySignal.conviction`.
   */
  strength: number;
  /** Explicação legível da composição da força. */
  detail: string;
}

export interface LevelDetectionOptions {
  /** Tolerância do cluster, em múltiplos do ATR local. Por omissão 0,35. */
  toleranceAtrRatio?: number;
  /** Mínimo de pivôs para o cluster contar como nível. Por omissão 2. */
  minTouches?: number;
  /** Meia-vida da frescura, em velas. Por omissão 120. */
  ageHalfLife?: number;
  /** Fecho tem de exceder a zona em k×ATR para o nível contar como quebrado. */
  breakAtrRatio?: number;
  /** Velas a olhar após cada toque para medir a reação. Por omissão 5. */
  reactionLookahead?: number;
  /** Lookback dos swings. */
  swingLookback?: number;
}

/**
 * Incremento "redondo" adequado à escala do preço.
 *
 * Devolve os candidatos do mais fino ao mais grosso. Para 1,0850 → [0,01; 0,1; 1];
 * para 2 400 → [10; 100; 1 000]; para 62 000 → [100; 1 000; 10 000].
 * A quotação de forex chama "figura" ao primeiro destes.
 */
export function roundIncrementsFor(price: number): number[] {
  if (!(price > 0)) return [];
  const magnitude = Math.pow(10, Math.floor(Math.log10(price)));
  return [magnitude / 100, magnitude / 10, magnitude];
}

/**
 * Maior incremento redondo de que o preço dista menos que `tolerance`, ou null.
 * Quanto maior o incremento, mais "redondo" — 2 000,00 é mais redondo que 2 010,00.
 */
export function detectRoundNumber(price: number, tolerance: number): number | null {
  let best: number | null = null;
  for (const inc of roundIncrementsFor(price)) {
    if (inc <= 0) continue;
    const nearest = Math.round(price / inc) * inc;
    // Devolve o NIVEL, nao o incremento que o gerou. A versao anterior
    // atribuia `inc` aqui, pelo que um preco de 1.10004 respondia 0.1 — um
    // valor que nem sequer esta perto do preco. O consumidor usa isto como
    // nivel de suporte/resistencia, por isso o erro punha ordens no sitio errado.
    if (Math.abs(price - nearest) <= tolerance) best = nearest;
  }
  return best;
}

/**
 * Deteta níveis horizontais agrupando pivôs de swing por proximidade de preço.
 *
 * O agrupamento é feito por preço (não por tempo) e a tolerância acompanha o
 * ATR, para que o mesmo parâmetro funcione no EURUSD e no BTCUSD.
 */
export function detectSupportResistanceLevels(
  candles: readonly Candle[],
  options: LevelDetectionOptions = {},
): SupportResistanceLevel[] {
  const tolRatio = options.toleranceAtrRatio ?? 0.35;
  const minTouches = options.minTouches ?? 2;
  const halfLife = options.ageHalfLife ?? 120;
  const breakRatio = options.breakAtrRatio ?? 0.5;
  const lookahead = options.reactionLookahead ?? 5;

  if (candles.length < 20) return [];

  const list = candles as Candle[];
  const atr = computeAtr(list);
  const lastIndex = list.length - 1;
  const referenceAtr = atr[lastIndex] ?? 0;
  if (referenceAtr <= 0) return [];

  const ladder = buildSwingLadder(list, { lookback: options.swingLookback ?? 2 });
  // Só pivôs intermediate/long: os short-term são ruído para níveis horizontais.
  const pivots = [...ladder.intermediate, ...ladder.long].sort((a, b) => a.price - b.price);
  if (pivots.length < minTouches) return [];

  const clusters: SwingPoint[][] = [];
  let current: SwingPoint[] = [];

  for (const p of pivots) {
    if (current.length === 0) {
      current = [p];
      continue;
    }
    const ref = current[current.length - 1];
    if (!ref) continue;
    const tolerance = (atr[p.index] ?? referenceAtr) * tolRatio;
    if (Math.abs(p.price - ref.price) <= tolerance) {
      current.push(p);
    } else {
      if (current.length >= minTouches) clusters.push(current);
      current = [p];
    }
  }
  if (current.length >= minTouches) clusters.push(current);

  const out: SupportResistanceLevel[] = [];

  for (const cluster of clusters) {
    const prices = cluster.map((p) => p.price);
    const price = prices.reduce((a, b) => a + b, 0) / prices.length;
    const rawLow = Math.min(...prices);
    const rawHigh = Math.max(...prices);
    const minHalfWidth = referenceAtr * tolRatio * 0.5;
    const zoneLow = Math.min(rawLow, price - minHalfWidth);
    const zoneHigh = Math.max(rawHigh, price + minHalfWidth);

    const memberIndices = cluster.map((p) => p.index).sort((a, b) => a - b);
    const lastTouchIndex = memberIndices[memberIndices.length - 1] ?? 0;
    const highs = cluster.filter((p) => p.kind === 'high').length;
    const lows = cluster.length - highs;

    // --- Quebra por fecho ---------------------------------------------------
    let brokenAtIndex: number | null = null;
    for (let i = lastTouchIndex + 1; i <= lastIndex; i++) {
      const c = list[i];
      if (!c) continue;
      const margin = (atr[i] ?? referenceAtr) * breakRatio;
      if (c.close > zoneHigh + margin || c.close < zoneLow - margin) {
        brokenAtIndex = i;
        break;
      }
    }

    // --- Reação média após cada toque --------------------------------------
    let reactionSum = 0;
    let reactionCount = 0;
    for (const p of cluster) {
      const localAtr = atr[p.index] ?? referenceAtr;
      if (localAtr <= 0) continue;
      let extreme = p.price;
      for (let i = p.index + 1; i <= Math.min(lastIndex, p.index + lookahead); i++) {
        const c = list[i];
        if (!c) continue;
        // Um topo deve empurrar o preço para BAIXO; um fundo, para CIMA.
        if (p.kind === 'high') extreme = Math.min(extreme, c.low);
        else extreme = Math.max(extreme, c.high);
      }
      reactionSum += Math.abs(extreme - p.price) / localAtr;
      reactionCount++;
    }
    const averageReactionAtr = reactionCount > 0 ? reactionSum / reactionCount : 0;

    // --- Papel atual --------------------------------------------------------
    const lastClose = list[lastIndex]?.close ?? price;
    let kind: LevelKind;
    if (brokenAtIndex !== null) {
      // Polaridade invertida: resistência quebrada passa a suporte, e vice-versa.
      kind = 'flip';
    } else if (highs > 0 && lows > 0) {
      kind = 'flip';
    } else if (lastClose < price) {
      kind = 'resistance';
    } else {
      kind = 'support';
    }

    // --- Pontuação ----------------------------------------------------------
    const roundTolerance = referenceAtr * tolRatio;
    const roundNumberIncrement = detectRoundNumber(price, roundTolerance);
    const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(price, 1e-12))));
    const roundBonus =
      roundNumberIncrement === null
        ? 0
        : roundNumberIncrement >= magnitude
          ? 0.2
          : roundNumberIncrement >= magnitude / 10
            ? 0.12
            : 0.06;

    const touchScore = clamp((cluster.length - 1) / 3, 0, 1); // 2 toques→0,33  5→1
    const freshness = ageDecay(lastIndex - lastTouchIndex, halfLife);
    const reactionScore = clamp(averageReactionAtr / 2, 0, 1); // 2 ATR de reação → 1

    const strength = clamp(
      touchScore * 0.35 + freshness * 0.25 + reactionScore * 0.3 + roundBonus,
      0,
      1,
    );

    const detail =
      `${cluster.length} pivôs (${highs}H/${lows}L), último há ${lastIndex - lastTouchIndex} velas, ` +
      `reação média ${averageReactionAtr.toFixed(2)}×ATR` +
      (roundNumberIncrement !== null ? `, alinhado com múltiplo redondo de ${roundNumberIncrement}` : '') +
      (brokenAtIndex !== null ? `, quebrado por fecho no índice ${brokenAtIndex}` : '');

    out.push({
      price,
      zoneLow,
      zoneHigh,
      kind,
      touches: cluster.length,
      memberIndices,
      lastTouchIndex,
      brokenAtIndex,
      averageReactionAtr,
      roundNumberIncrement,
      strength,
      detail,
    });
  }

  return out.sort((a, b) => a.price - b.price);
}

/** Níveis acima (bullish) ou abaixo (bearish) de um preço, já ordenados. */
export function levelsBeyond(
  levels: readonly SupportResistanceLevel[],
  price: number,
  direction: Direction,
): SupportResistanceLevel[] {
  const filtered =
    direction === 'bullish'
      ? levels.filter((l) => l.zoneLow > price)
      : levels.filter((l) => l.zoneHigh < price);
  return direction === 'bullish'
    ? filtered.sort((a, b) => a.price - b.price)
    : filtered.sort((a, b) => b.price - a.price);
}

export interface SrPlanOptions {
  symbol: string;
  timeframe: Timeframe;
  /** R mínimo para emitir o sinal. Por omissão 2. */
  minRMultiple?: number;
  /** σ (log) por vela. Se omitido, é estimado da própria série. */
  sigmaLogPerPeriod?: number;
  /** Buffer do stop para lá da zona, em múltiplos de σ. Por omissão 0,5. */
  stopBufferSigma?: number;
  /** Força mínima do nível. Por omissão 0,3. */
  minStrength?: number;
  /** Níveis já detetados; se omitidos, são calculados. */
  levels?: SupportResistanceLevel[];
}

/**
 * Produz sinais a partir da interação da ÚLTIMA vela fechada com os níveis.
 *
 * Dois regimes, deliberadamente separados:
 *
 * **Reversão** — a vela tocou a zona e fechou de volta do lado de origem. É o
 * caso "take-profit orders aglomeradas no nível" de Osler. Entra-se na zona,
 * stop além dela, alvo no nível oposto seguinte.
 *
 * **Continuação** — a vela FECHOU de forma material para lá da zona. É o caso
 * "stop-loss orders aglomeradas logo além". Entra-se no reteste da zona
 * invertida, stop de volta para dentro, alvo no nível seguinte.
 *
 * Devolve os dois se ambos se qualificarem — nunca escolhe por nós.
 */
export function planSupportResistanceTrades(
  candles: readonly Candle[],
  options: SrPlanOptions,
): StrategySignal[] {
  const list = candles as Candle[];
  if (list.length < 30) return [];

  const lastIndex = list.length - 1;
  const last = list[lastIndex];
  if (!last) return [];

  const levels = options.levels ?? detectSupportResistanceLevels(list);
  if (levels.length === 0) return [];

  const minR = options.minRMultiple ?? 2;
  const minStrength = options.minStrength ?? 0.3;
  const stopBufferSigma = options.stopBufferSigma ?? 0.5;

  const vol = estimateVolatility(list);
  const sigmaLog = options.sigmaLogPerPeriod ?? vol.recommended;
  const sigmaPrice = sigmaToPriceDistance(last.close, sigmaLog);
  const buffer = sigmaPrice * stopBufferSigma;

  const baseAssumptions = [
    'Existe liquidez em repouso no nível — falso em janelas de notícia macro, onde os criadores de mercado a retiram.',
    'A aglomeração de ordens medida por Osler (2003) no forex de balcão transfere-se para este instrumento — não demonstrado.',
    'O nível foi estimado nos mesmos dados em que é avaliado: a contagem de toques é seleção pós-facto.',
    'A tolerância que define "o mesmo nível" é um parâmetro livre; alterá-la altera a pontuação.',
  ];

  const out: StrategySignal[] = [];

  for (const level of levels) {
    if (level.strength < minStrength) continue;

    const oslerNote =
      level.roundNumberIncrement !== null
        ? ` O nível coincide com um múltiplo redondo de ${level.roundNumberIncrement}; Osler (2003) mediu ` +
          'que as ordens de take-profit se aglomeram nestes preços e as de stop-loss logo além deles.'
        : '';

    // ---------------------------------------------------------------- reversão
    const touchedFromAbove = last.low <= level.zoneHigh && last.close > level.zoneHigh;
    const touchedFromBelow = last.high >= level.zoneLow && last.close < level.zoneLow;

    if (level.brokenAtIndex === null && (touchedFromAbove || touchedFromBelow)) {
      const direction: Direction = touchedFromAbove ? 'bullish' : 'bearish';
      const entryPrice = touchedFromAbove ? level.zoneHigh : level.zoneLow;
      const stopLoss = touchedFromAbove ? level.zoneLow - buffer : level.zoneHigh + buffer;
      const risk = Math.abs(entryPrice - stopLoss);

      const signal = buildLevelSignal({
        strategy: 'support-resistance',
        regime: 'mean-reversion',
        symbol: options.symbol,
        timeframe: options.timeframe,
        direction,
        index: lastIndex,
        candle: last,
        entryZoneLow: Math.min(level.zoneLow, entryPrice),
        entryZoneHigh: Math.max(level.zoneHigh, entryPrice),
        entryPrice,
        stopLoss,
        risk,
        targets: levelsBeyond(levels, entryPrice, direction).slice(0, 3),
        minR,
        conviction: clamp(level.strength * 0.8 + (vol.samples >= 20 ? 0.1 : 0), 0, 1),
        rationale:
          `Preço testou ${touchedFromAbove ? 'suporte' : 'resistência'} em ${level.price.toFixed(5)} ` +
          `e fechou do lado de origem. ${level.detail}.${oslerNote}`,
        assumptions: [
          ...baseAssumptions,
          'Regime de balanço: assume que o nível segura. Num mercado em tendência esta é a operação errada — é a continuação que paga.',
        ],
        warnings: vol.warnings,
      });
      if (signal) out.push(signal);
    }

    // ------------------------------------------------------------- continuação
    if (level.brokenAtIndex !== null && level.brokenAtIndex >= lastIndex - 5) {
      const direction: Direction = last.close > level.zoneHigh ? 'bullish' : 'bearish';
      // Entra-se no RETESTE da zona invertida, não na quebra — a quebra é o
      // sítio onde os stops dos outros são executados, e o pior preço possível.
      const entryPrice = direction === 'bullish' ? level.zoneHigh : level.zoneLow;
      const stopLoss = direction === 'bullish' ? level.zoneLow - buffer : level.zoneHigh + buffer;
      const risk = Math.abs(entryPrice - stopLoss);

      const signal = buildLevelSignal({
        strategy: 'support-resistance',
        regime: 'continuation',
        symbol: options.symbol,
        timeframe: options.timeframe,
        direction,
        index: lastIndex,
        candle: last,
        entryZoneLow: level.zoneLow,
        entryZoneHigh: level.zoneHigh,
        entryPrice,
        stopLoss,
        risk,
        targets: levelsBeyond(levels, entryPrice, direction).slice(0, 3),
        minR,
        conviction: clamp(level.strength * 0.7, 0, 1),
        rationale:
          `Fecho atravessou ${level.price.toFixed(5)} no índice ${level.brokenAtIndex}; polaridade invertida. ` +
          `Entrada no reteste, não na quebra. ${level.detail}.${oslerNote}`,
        assumptions: [
          ...baseAssumptions,
          'Assume que a quebra é aceitação e não um varrimento de stops seguido de regresso — distinguir os dois exige mais que o fecho de uma vela.',
          'O reteste pode nunca acontecer: neste caso o sinal expira sem operação, e isso tem de ser contabilizado no backtest.',
        ],
        warnings: vol.warnings,
      });
      if (signal) out.push(signal);
    }
  }

  return out.sort((a, b) => b.conviction - a.conviction);
}

interface LevelSignalInput {
  strategy: StrategySignal['strategy'];
  regime: StrategySignal['regime'];
  symbol: string;
  timeframe: Timeframe;
  direction: Direction;
  index: number;
  candle: Candle;
  entryZoneLow: number;
  entryZoneHigh: number;
  entryPrice: number;
  stopLoss: number;
  risk: number;
  targets: SupportResistanceLevel[];
  minR: number;
  conviction: number;
  rationale: string;
  assumptions: string[];
  warnings: string[];
}

/** Converte níveis-alvo num plano de saída, ou devolve null se o R não chega. */
function buildLevelSignal(input: LevelSignalInput): StrategySignal | null {
  if (input.risk <= 0) return null;

  const sign = input.direction === 'bullish' ? 1 : -1;
  const rOf = (price: number) => (sign * (price - input.entryPrice)) / input.risk;

  const planned = input.targets
    .map((l) => ({ level: l, r: rOf(input.direction === 'bullish' ? l.zoneLow : l.zoneHigh) }))
    .filter((t) => t.r > 0.5)
    .slice(0, 3);

  if (planned.length === 0) return null;

  const fractions = planned.length === 1 ? [1] : planned.length === 2 ? [0.5, 0.5] : [0.4, 0.35, 0.25];

  const targets = planned.map((t, i) => ({
    price: input.direction === 'bullish' ? t.level.zoneLow : t.level.zoneHigh,
    rMultiple: t.r,
    closeFraction: fractions[i] ?? 0,
    rationale:
      `Próximo nível oposto em ${t.level.price.toFixed(5)} (${t.level.touches} toques, ` +
      `força ${t.level.strength.toFixed(2)}). Alvo estrutural, não múltiplo arbitrário.`,
  }));

  const maxRMultiple = targets.reduce((m, t) => Math.max(m, t.rMultiple), 0);
  if (maxRMultiple < input.minR) return null;

  return {
    strategy: input.strategy,
    symbol: input.symbol,
    timeframe: input.timeframe,
    direction: input.direction,
    regime: input.regime,
    index: input.index,
    generatedAt: input.candle.time,
    referencePrice: input.candle.close,
    entryZoneLow: input.entryZoneLow,
    entryZoneHigh: input.entryZoneHigh,
    entryPrice: input.entryPrice,
    stopLoss: input.stopLoss,
    targets,
    maxRMultiple,
    conviction: input.conviction,
    rationale: input.rationale,
    assumptions: input.assumptions,
    warnings: input.warnings,
  };
}
