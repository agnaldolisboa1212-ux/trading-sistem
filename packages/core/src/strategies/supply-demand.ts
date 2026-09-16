/**
 * Zonas de oferta e procura (supply & demand).
 *
 * O QUE É MEDIDO E O QUE É NARRATIVA
 * -----------------------------------
 * A história habitual é: "um banco deixou ordens limitadas por preencher nesta
 * vela; quando o preço voltar, o resto da ordem executa e o preço reage". Essa
 * história **não é verificável a partir de OHLC**. Os mercados são anónimos, as
 * mesas fatiam as ordens propositadamente e usam venues opacos precisamente para
 * não deixar pegada. Afirmar que um banco tem ordens *nesta vela* é
 * interpretação, não medição.
 *
 * O que É medido, e que este módulo deteta, é geometricamente simples:
 *
 *   1. **uma base** — um punhado de velas de corpo pequeno: o preço parou de se
 *      mover porque compradores e vendedores estavam em equilíbrio;
 *   2. **uma partida** — um movimento imediatamente a seguir, grande face à
 *      volatilidade local, que se afasta dessa base;
 *   3. **desequilíbrio na partida** — a partida foi tão rápida que deixou um
 *      Fair Value Gap: houve preços por onde mal se negociou.
 *
 * A inferência razoável não é "há ordens ali". É: **naquela faixa de preços o
 * equilíbrio quebrou de forma abrupta**, e não sabemos se isso se repete. Tudo o
 * resto — "smart money", "ordens institucionais" — é decoração.
 *
 * TAXONOMIA
 * ---------
 *   Drop-Base-Rally (DBR) → PROCURA, reversão      (caiu, parou, subiu)
 *   Rally-Base-Rally (RBR) → PROCURA, continuação  (subiu, parou, subiu)
 *   Rally-Base-Drop  (RBD) → OFERTA,  reversão     (subiu, parou, caiu)
 *   Drop-Base-Drop   (DBD) → OFERTA,  continuação  (caiu, parou, caiu)
 *
 * SUPOSIÇÕES, E QUANDO O MERCADO AS VIOLA
 * ----------------------------------------
 * 1. **A zona "guarda" liquidez que sobrevive ao tempo.** Se a razão original
 *    era uma ordem de um fundo, essa ordem foi cancelada, ajustada ou preenchida
 *    noutro sítio há muito. A frescura da zona é usada como aproximação da
 *    validade, mas é uma aproximação sem base medida.
 * 2. **A base é identificável.** "Corpo pequeno" depende de um limiar face ao
 *    ATR. Mexer nesse limiar de 0,5 para 0,7 muda o conjunto de zonas — e a
 *    tentação de o afinar até o backtest melhorar é exatamente sobre-ajuste.
 * 3. **Sobrevivência.** Só se veem as zonas que ainda existem no gráfico. As que
 *    o preço atravessou sem reagir continuam lá, mas o olho não as regista, e um
 *    detetor que só pontue as "boas" reproduz esse viés.
 * 4. **Reação ≠ causalidade.** Uma zona antiga em tendência é atravessada pelo
 *    preço a caminho de outro sítio. Atribuir a paragem à zona quando ela
 *    coincide com o VWAP, com uma média móvel e com um número redondo é
 *    inventar um mecanismo onde há três candidatos.
 */

import { candleBody, type Candle, type Direction, type Timeframe } from '../types/market.js';
import { computeAtr, detectFairValueGaps } from '../indicators/fvg.js';
import { ageDecay, clamp, type StrategySignal } from './types.js';
import { estimateVolatility, sigmaToPriceDistance } from './volatility.js';

export type ZonePattern = 'drop-base-rally' | 'rally-base-rally' | 'rally-base-drop' | 'drop-base-drop';

export interface SupplyDemandZone {
  /** 'bullish' = zona de PROCURA (compra); 'bearish' = zona de OFERTA (venda). */
  direction: Direction;
  pattern: ZonePattern;
  /** True para RBD/DBR (reversão); false para RBR/DBD (continuação). */
  isReversal: boolean;

  /** Índices da base, inclusive. */
  baseStartIndex: number;
  baseEndIndex: number;
  time: number;

  /** Extremos da base (mechas incluídas). */
  zoneLow: number;
  zoneHigh: number;
  /** Bordo da zona voltado para o preço — onde se entra. */
  proximal: number;
  /** Bordo oposto — onde a zona deixa de existir e o stop vai para lá. */
  distal: number;

  /** Amplitude da partida, em múltiplos do ATR local. */
  departureAtr: number;
  /** Preço extremo atingido pela partida — o alvo natural do regresso. */
  departureExtreme: number;
  /** True se a partida deixou um FVG na mesma direção. */
  hasImbalance: boolean;

  /** Quantas vezes o preço reentrou na zona desde que se formou. */
  tests: number;
  firstTestIndex: number | null;
  /** Índice em que um FECHO atravessou a linha distal — a zona morreu. */
  invalidatedAtIndex: number | null;

  /** Força em 0..1. Não é probabilidade. */
  strength: number;
  detail: string;
}

export interface ZoneDetectionOptions {
  /** Corpo máximo de uma vela de base, em múltiplos do ATR. Por omissão 0,5. */
  baseMaxBodyAtr?: number;
  /** Máximo de velas na base. Por omissão 5. */
  maxBaseLength?: number;
  /** Amplitude mínima da partida, em ATR. Por omissão 1,5. */
  minDepartureAtr?: number;
  /** Velas em que a partida tem de acontecer. Por omissão 3. */
  departureBars?: number;
  /** Velas usadas para classificar a aproximação. Por omissão 3. */
  approachBars?: number;
  /** Meia-vida da frescura, em velas. Por omissão 90. */
  ageHalfLife?: number;
}

/**
 * Deteta zonas de oferta e procura na série.
 *
 * Complexidade O(n × maxBaseLength) — linear na prática. Zonas sobrepostas são
 * resolvidas mantendo a mais forte.
 */
export function detectSupplyDemandZones(
  candles: readonly Candle[],
  options: ZoneDetectionOptions = {},
): SupplyDemandZone[] {
  const baseMaxBodyAtr = options.baseMaxBodyAtr ?? 0.5;
  const maxBaseLength = options.maxBaseLength ?? 5;
  const minDepartureAtr = options.minDepartureAtr ?? 1.5;
  const departureBars = options.departureBars ?? 3;
  const approachBars = options.approachBars ?? 3;
  const halfLife = options.ageHalfLife ?? 90;

  const list = candles as Candle[];
  if (list.length < 30) return [];

  const atr = computeAtr(list);
  const lastIndex = list.length - 1;
  const fvgs = detectFairValueGaps(list, { minSizeAtrRatio: 0.1 });

  const found: SupplyDemandZone[] = [];

  for (let i = approachBars + 1; i <= lastIndex - departureBars; i++) {
    const localAtr = atr[i] ?? 0;
    if (localAtr <= 0) continue;

    // --- 1. A base: velas consecutivas de corpo pequeno ---------------------
    let baseEnd = i - 1;
    for (let k = i; k < Math.min(list.length, i + maxBaseLength); k++) {
      const c = list[k];
      if (!c) break;
      if (candleBody(c) > localAtr * baseMaxBodyAtr) break;
      baseEnd = k;
    }
    if (baseEnd < i) continue; // nem uma vela de base

    // A base tem de começar aqui — se a vela anterior também era base, esta
    // janela é uma repetição da anterior.
    const prevCandle = list[i - 1];
    if (prevCandle && candleBody(prevCandle) <= localAtr * baseMaxBodyAtr) continue;

    const baseLength = baseEnd - i + 1;
    const baseCandles = list.slice(i, baseEnd + 1);
    const zoneHigh = Math.max(...baseCandles.map((c) => c.high));
    const zoneLow = Math.min(...baseCandles.map((c) => c.low));
    const baseMid = (zoneHigh + zoneLow) / 2;

    // --- 2. A partida -------------------------------------------------------
    const departureStart = baseEnd + 1;
    const departureEnd = Math.min(lastIndex, departureStart + departureBars - 1);
    if (departureStart > lastIndex) continue;

    let upExtreme = baseMid;
    let downExtreme = baseMid;
    for (let k = departureStart; k <= departureEnd; k++) {
      const c = list[k];
      if (!c) continue;
      upExtreme = Math.max(upExtreme, c.high);
      downExtreme = Math.min(downExtreme, c.low);
    }
    const upMove = (upExtreme - zoneHigh) / localAtr;
    const downMove = (zoneLow - downExtreme) / localAtr;

    let direction: Direction;
    let departureAtrValue: number;
    let departureExtreme: number;
    if (upMove >= downMove) {
      direction = 'bullish';
      departureAtrValue = upMove;
      departureExtreme = upExtreme;
    } else {
      direction = 'bearish';
      departureAtrValue = downMove;
      departureExtreme = downExtreme;
    }
    if (departureAtrValue < minDepartureAtr) continue;

    // O fecho tem de confirmar a partida — uma mecha longa não é partida.
    const departureCloseCandle = list[departureEnd];
    if (!departureCloseCandle) continue;
    if (direction === 'bullish' && departureCloseCandle.close <= zoneHigh) continue;
    if (direction === 'bearish' && departureCloseCandle.close >= zoneLow) continue;

    // --- 3. A aproximação, para classificar o padrão ------------------------
    const approachFrom = list[Math.max(0, i - approachBars)];
    const approachTo = list[i - 1];
    if (!approachFrom || !approachTo) continue;
    const approachUp = approachTo.close >= approachFrom.open;

    let pattern: ZonePattern;
    if (direction === 'bullish') pattern = approachUp ? 'rally-base-rally' : 'drop-base-rally';
    else pattern = approachUp ? 'rally-base-drop' : 'drop-base-drop';
    const isReversal = pattern === 'drop-base-rally' || pattern === 'rally-base-drop';

    const proximal = direction === 'bullish' ? zoneHigh : zoneLow;
    const distal = direction === 'bullish' ? zoneLow : zoneHigh;

    // --- 4. Desequilíbrio deixado pela partida ------------------------------
    const hasImbalance = fvgs.some(
      (g) => g.direction === direction && g.index >= departureStart && g.index <= departureEnd + 1,
    );

    // --- 5. Testes posteriores e invalidação --------------------------------
    let tests = 0;
    let firstTestIndex: number | null = null;
    let invalidatedAtIndex: number | null = null;
    let inside = false;
    for (let k = departureEnd + 1; k <= lastIndex; k++) {
      const c = list[k];
      if (!c) continue;
      const closedBeyondDistal =
        direction === 'bullish' ? c.close < distal : c.close > distal;
      if (closedBeyondDistal) {
        invalidatedAtIndex = k;
        break;
      }
      const touching = c.low <= zoneHigh && c.high >= zoneLow;
      if (touching && !inside) {
        tests++;
        if (firstTestIndex === null) firstTestIndex = k;
        inside = true;
      } else if (!touching) {
        inside = false;
      }
    }

    // --- 6. Pontuação -------------------------------------------------------
    const departureScore = clamp(departureAtrValue / 4, 0, 1);
    const tightnessScore = clamp(1 - (zoneHigh - zoneLow) / (localAtr * 2), 0, 1);
    const freshnessScore = tests === 0 ? 1 : tests === 1 ? 0.45 : tests === 2 ? 0.2 : 0.05;
    const recency = ageDecay(lastIndex - baseEnd, halfLife);
    const imbalanceBonus = hasImbalance ? 0.12 : 0;
    const baseLengthPenalty = baseLength <= 3 ? 0 : 0.05 * (baseLength - 3);

    const strength = clamp(
      departureScore * 0.3 +
        tightnessScore * 0.15 +
        freshnessScore * 0.25 +
        recency * 0.2 +
        imbalanceBonus -
        baseLengthPenalty,
      0,
      1,
    );

    const baseTime = list[i]?.time ?? 0;

    found.push({
      direction,
      pattern,
      isReversal,
      baseStartIndex: i,
      baseEndIndex: baseEnd,
      time: baseTime,
      zoneLow,
      zoneHigh,
      proximal,
      distal,
      departureAtr: departureAtrValue,
      departureExtreme,
      hasImbalance,
      tests,
      firstTestIndex,
      invalidatedAtIndex,
      strength,
      detail:
        `${pattern.toUpperCase()} · base de ${baseLength} vela(s) · partida de ` +
        `${departureAtrValue.toFixed(1)}×ATR · ${tests} teste(s)` +
        (hasImbalance ? ' · partida deixou FVG' : ' · sem FVG na partida') +
        (invalidatedAtIndex !== null ? ` · invalidada no índice ${invalidatedAtIndex}` : ''),
    });
  }

  return dedupeOverlapping(found);
}

/**
 * Resolve zonas sobrepostas mantendo a mais forte.
 *
 * Sem isto, uma base de 5 velas produz até 5 zonas quase idênticas e a contagem
 * de "confluência" fica inflacionada por construção.
 */
function dedupeOverlapping(zones: SupplyDemandZone[]): SupplyDemandZone[] {
  const sorted = [...zones].sort((a, b) => b.strength - a.strength);
  const kept: SupplyDemandZone[] = [];

  for (const z of sorted) {
    const overlaps = kept.some(
      (k) => k.direction === z.direction && z.zoneLow <= k.zoneHigh && z.zoneHigh >= k.zoneLow,
    );
    if (!overlaps) kept.push(z);
  }

  return kept.sort((a, b) => a.baseStartIndex - b.baseStartIndex);
}

/** Zonas ainda vivas (não invalidadas) até um dado índice. */
export function activeZonesAt(
  zones: readonly SupplyDemandZone[],
  index: number,
): SupplyDemandZone[] {
  return zones.filter(
    (z) =>
      z.baseEndIndex <= index &&
      (z.invalidatedAtIndex === null || z.invalidatedAtIndex > index),
  );
}

export interface SupplyDemandPlanOptions {
  symbol: string;
  timeframe: Timeframe;
  /** R mínimo para emitir. Por omissão 2. */
  minRMultiple?: number;
  /** Força mínima da zona. Por omissão 0,35. */
  minStrength?: number;
  /** Buffer do stop para lá do distal, em múltiplos de σ. Por omissão 0,5. */
  stopBufferSigma?: number;
  /** Aceitar zonas já testadas. Por omissão false — só zonas frescas. */
  allowTested?: boolean;
  zones?: SupplyDemandZone[];
}

/**
 * Produz sinais para as zonas que a ÚLTIMA vela fechada está a tocar.
 *
 * Entrada no bordo proximal, stop além do distal com folga de volatilidade,
 * alvos: (1) o extremo que a partida atingiu — o movimento que "veio daqui" —
 * e (2) a zona oposta mais próxima para lá desse extremo.
 */
export function planSupplyDemandTrades(
  candles: readonly Candle[],
  options: SupplyDemandPlanOptions,
): StrategySignal[] {
  const list = candles as Candle[];
  if (list.length < 30) return [];

  const lastIndex = list.length - 1;
  const last = list[lastIndex];
  if (!last) return [];

  const minR = options.minRMultiple ?? 2;
  const minStrength = options.minStrength ?? 0.35;
  const stopBufferSigma = options.stopBufferSigma ?? 0.5;
  const allowTested = options.allowTested ?? false;

  const zones = options.zones ?? detectSupplyDemandZones(list);
  const active = activeZonesAt(zones, lastIndex);
  if (active.length === 0) return [];

  const vol = estimateVolatility(list);
  const sigmaPrice = sigmaToPriceDistance(last.close, vol.recommended);
  const buffer = sigmaPrice * stopBufferSigma;

  const out: StrategySignal[] = [];

  for (const zone of active) {
    if (zone.strength < minStrength) continue;
    if (!allowTested && zone.tests > 0) continue;
    if (zone.baseEndIndex >= lastIndex - 1) continue; // a zona ainda está a formar-se

    // O preço tem de estar a interagir com a zona nesta vela.
    const touching = last.low <= zone.zoneHigh && last.high >= zone.zoneLow;
    if (!touching) continue;

    const entryPrice = zone.proximal;
    const stopLoss =
      zone.direction === 'bullish' ? zone.distal - buffer : zone.distal + buffer;
    const risk = Math.abs(entryPrice - stopLoss);
    if (risk <= 0) continue;

    const sign = zone.direction === 'bullish' ? 1 : -1;
    const rOf = (price: number) => (sign * (price - entryPrice)) / risk;

    // TP1 — o extremo que a partida atingiu.
    const candidateTargets: Array<{ price: number; rationale: string }> = [
      {
        price: zone.departureExtreme,
        rationale:
          'Extremo atingido pela partida original. É o alvo com significado estrutural: ' +
          'o preço percorreu esta distância a partir daqui uma vez.',
      },
    ];

    // TP2 — zona oposta mais próxima para lá do extremo.
    const opposing = active
      .filter((z) => z.direction !== zone.direction)
      .filter((z) =>
        zone.direction === 'bullish'
          ? z.proximal > zone.departureExtreme
          : z.proximal < zone.departureExtreme,
      )
      .sort((a, b) =>
        zone.direction === 'bullish' ? a.proximal - b.proximal : b.proximal - a.proximal,
      );
    const nextOpposing = opposing[0];
    if (nextOpposing) {
      candidateTargets.push({
        price: nextOpposing.proximal,
        rationale:
          `Bordo proximal da zona oposta em ${nextOpposing.proximal.toFixed(5)} ` +
          `(${nextOpposing.pattern}, força ${nextOpposing.strength.toFixed(2)}) — onde a pressão contrária começa.`,
      });
    }

    const usable = candidateTargets
      .map((t) => ({ ...t, r: rOf(t.price) }))
      .filter((t) => t.r > 0.5);
    if (usable.length === 0) continue;

    const fractions = usable.length === 1 ? [1] : [0.5, 0.5];
    const targets = usable.map((t, i) => ({
      price: t.price,
      rMultiple: t.r,
      closeFraction: fractions[i] ?? 0,
      rationale: t.rationale,
    }));

    const maxRMultiple = targets.reduce((m, t) => Math.max(m, t.rMultiple), 0);
    if (maxRMultiple < minR) continue;

    out.push({
      strategy: 'supply-demand',
      symbol: options.symbol,
      timeframe: options.timeframe,
      direction: zone.direction,
      regime: zone.isReversal ? 'mean-reversion' : 'continuation',
      index: lastIndex,
      generatedAt: last.time,
      referencePrice: last.close,
      entryZoneLow: zone.zoneLow,
      entryZoneHigh: zone.zoneHigh,
      entryPrice,
      stopLoss,
      targets,
      maxRMultiple,
      conviction: clamp(zone.strength, 0, 1),
      rationale:
        `Zona de ${zone.direction === 'bullish' ? 'procura' : 'oferta'} formada no índice ` +
        `${zone.baseStartIndex}: ${zone.detail}. O preço regressou à zona nesta vela. ` +
        'O que está medido é que o equilíbrio quebrou abruptamente nesta faixa de preços — ' +
        'não que existam ordens institucionais aqui.',
      assumptions: [
        'Assume que a razão que interrompeu o equilíbrio nesta faixa ainda está presente. Não é verificável em OHLC.',
        'O limiar de "corpo pequeno" que define a base é um parâmetro livre; ajustá-lo até o backtest melhorar é sobre-ajuste.',
        'Viés de sobrevivência: as zonas que o preço atravessou sem reagir não aparecem no ecrã, mas existem na amostra.',
        zone.isReversal
          ? 'Padrão de reversão: assume que a tendência de aproximação cede. Em tendência forte, a zona é atravessada.'
          : 'Padrão de continuação: assume que a tendência prossegue. Numa viragem de regime, é a pior entrada possível.',
      ],
      warnings: [
        ...vol.warnings,
        ...(zone.hasImbalance
          ? []
          : ['A partida não deixou FVG — a evidência de desequilíbrio é mais fraca.']),
      ],
    });
  }

  return out.sort((a, b) => b.conviction - a.conviction);
}
