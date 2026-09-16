/**
 * Perfil de volume / Market Profile — POC, Value Area High e Low.
 *
 * A TEORIA DO LEILÃO, EM UMA FRASE
 * ---------------------------------
 * Steidlmayer (CBOT, 1985) organizou o dia num histograma horizontal: quanto
 * tempo — ou quanto volume — passou em cada preço. A leitura é de teoria do
 * leilão: o mercado sobe e desce até encontrar o preço onde consegue facilitar
 * o máximo de negócio. Esse preço é o **POC** (Point Of Control). A faixa que
 * contém 70% da atividade é a **Value Area**; dentro dela o preço é "justo",
 * fora dela é "injusto" — e o mercado ou o rejeita depressa ou aceita o novo
 * nível e constrói ali uma value area nova.
 *
 * É a estrutura mais próxima de "onde é que o dinheiro grande transacionou" que
 * se consegue extrair sem livro de ordens. E é por isso que vale a pena — e por
 * isso mesmo é preciso ser rigoroso quanto ao que aqui é aproximação.
 *
 * TRÊS APROXIMAÇÕES QUE ESTE MÓDULO FAZ, E QUE IMPORTAM
 * ------------------------------------------------------
 * 1. **Volume por preço a partir de velas OHLC é inventado.** Um perfil de
 *    volume a sério precisa de dados tick a tick: cada negócio ao seu preço.
 *    Aqui só existe o volume TOTAL de cada vela e o seu intervalo. Este módulo
 *    distribui esse volume UNIFORMEMENTE pelo intervalo da vela. Isso é falso:
 *    na realidade o volume concentra-se perto da abertura e do fecho. Quanto
 *    maior o timeframe, pior a aproximação — num diário, distribuir volume
 *    uniformemente por uma vela de 2% de amplitude é quase ficção.
 * 2. **"70% ≈ 1σ" só vale se o perfil for gaussiano.** É a justificação
 *    habitual para o valor 70. Perfis reais são frequentemente bimodais (dois
 *    POCs, dias de tendência em "P" ou "b"), e nesses a analogia com o desvio-
 *    padrão não significa nada. `shape` marca os perfis onde isto acontece.
 * 3. **O volume que se vê não é o volume que existe.** No forex à vista não há
 *    volume nenhum. Nos futuros da CME há, mas é uma fração do mercado de
 *    balcão do mesmo subjacente. Um POC de futuros de euro não é o POC do EURUSD.
 *
 * OUTRAS SUPOSIÇÕES
 * -----------------
 * 4. **A janela do perfil é arbitrária.** Um perfil de 60 velas e um de 200
 *    dão POCs diferentes e sinais contraditórios. Não há critério objetivo para
 *    escolher — é um parâmetro livre, como a âncora do VWAP.
 * 5. **O número de bins é arbitrário.** Poucos bins escondem estrutura; muitos
 *    transformam ruído em "nós de baixo volume".
 * 6. **Estacionaridade do perfil.** Assume-se que a distribuição de negócio dos
 *    últimos N períodos informa o próximo. Após um choque (decisão de banco
 *    central, guerra, halving), a distribuição anterior descreve um mercado que
 *    já não existe.
 */

import type { Candle, Direction, Timeframe } from '../types/market.js';
import { clamp, volumeIsUsable, type StrategySignal } from './types.js';
import { estimateVolatility, sigmaToPriceDistance } from './volatility.js';

export interface ProfileBin {
  low: number;
  high: number;
  mid: number;
  volume: number;
  /** Fração do volume total nesta faixa. */
  fraction: number;
}

/**
 * Forma do perfil.
 * - 'normal': um único modo dominante — mercado em balanço, a value area informa.
 * - 'bimodal': dois modos separados por um vale — houve DOIS leilões distintos
 *   na janela e a value area agregada não descreve nenhum deles.
 * - 'flat': volume espalhado sem modo claro — dia/período de tendência; o POC
 *   não é um íman, é o meio de um movimento.
 */
export type ProfileShape = 'normal' | 'bimodal' | 'flat';

export interface VolumeProfile {
  bins: ProfileBin[];
  binWidth: number;
  /** Preço do Point Of Control (centro do bin de maior volume). */
  poc: number;
  pocBinIndex: number;
  /** Value Area High / Low. */
  vah: number;
  val: number;
  totalVolume: number;
  /** Fração efetivamente alcançada ao construir a value area (≈ alvo). */
  valueAreaFraction: number;
  /** Nós de volume alto (potenciais ímanes) e baixo (zonas de trânsito rápido). */
  highVolumeNodes: number[];
  lowVolumeNodes: number[];
  shape: ProfileShape;
  /** Índices da série cobertos pelo perfil. */
  fromIndex: number;
  toIndex: number;
  /** False quando não havia volume e o perfil usou tempo (TPO) em vez dele. */
  usedVolume: boolean;
  warnings: string[];
}

export interface ProfileOptions {
  /** Velas incluídas, a contar do fim da série. Por omissão 120. */
  lookback?: number;
  /** Número de faixas de preço. Por omissão 60. */
  bins?: number;
  /** Fração alvo da value area. Por omissão 0,7 (a convenção). */
  valueAreaFraction?: number;
}

/**
 * Constrói o perfil de volume da janela mais recente da série.
 *
 * Sem volume utilizável, cada vela contribui com peso 1 — o que produz um
 * Market Profile por TEMPO (a aproximação TPO), não por volume. `usedVolume`
 * distingue os dois casos.
 */
export function buildVolumeProfile(
  candles: readonly Candle[],
  options: ProfileOptions = {},
): VolumeProfile {
  const lookback = options.lookback ?? 120;
  const binCount = Math.max(10, options.bins ?? 60);
  const targetFraction = options.valueAreaFraction ?? 0.7;
  const warnings: string[] = [];

  const toIndex = candles.length - 1;
  const fromIndex = Math.max(0, candles.length - lookback);
  const window = candles.slice(fromIndex);

  const empty: VolumeProfile = {
    bins: [],
    binWidth: 0,
    poc: 0,
    pocBinIndex: -1,
    vah: 0,
    val: 0,
    totalVolume: 0,
    valueAreaFraction: 0,
    highVolumeNodes: [],
    lowVolumeNodes: [],
    shape: 'flat',
    fromIndex,
    toIndex,
    usedVolume: false,
    warnings: ['Série demasiado curta para construir um perfil.'],
  };

  if (window.length < 10) return empty;

  let minLow = Infinity;
  let maxHigh = -Infinity;
  for (const c of window) {
    if (c.low < minLow) minLow = c.low;
    if (c.high > maxHigh) maxHigh = c.high;
  }
  if (!(maxHigh > minLow)) return empty;

  const usedVolume = volumeIsUsable(window);
  if (!usedVolume) {
    warnings.push(
      'Sem volume utilizável — o perfil foi construído por TEMPO (aproximação TPO), não por ' +
        'volume. O POC passa a ser "onde o preço esteve mais tempo", que é uma grandeza diferente.',
    );
  }
  warnings.push(
    'O volume de cada vela foi distribuído uniformemente pelo seu intervalo. Um perfil real ' +
      'exige dados tick a tick; esta é uma aproximação que piora à medida que o timeframe sobe.',
  );

  const binWidth = (maxHigh - minLow) / binCount;
  const bins: ProfileBin[] = Array.from({ length: binCount }, (_, i) => ({
    low: minLow + i * binWidth,
    high: minLow + (i + 1) * binWidth,
    mid: minLow + (i + 0.5) * binWidth,
    volume: 0,
    fraction: 0,
  }));

  let totalVolume = 0;
  for (const c of window) {
    const weight = usedVolume ? c.volume : 1;
    if (!(weight > 0)) continue;
    const span = c.high - c.low;

    if (span <= 0) {
      const idx = clamp(Math.floor((c.close - minLow) / binWidth), 0, binCount - 1);
      const bin = bins[idx];
      if (bin) bin.volume += weight;
      totalVolume += weight;
      continue;
    }

    const firstBin = clamp(Math.floor((c.low - minLow) / binWidth), 0, binCount - 1);
    const lastBin = clamp(Math.floor((c.high - minLow) / binWidth), 0, binCount - 1);

    for (let i = firstBin; i <= lastBin; i++) {
      const bin = bins[i];
      if (!bin) continue;
      const overlap = Math.min(c.high, bin.high) - Math.max(c.low, bin.low);
      if (overlap <= 0) continue;
      bin.volume += weight * (overlap / span);
    }
    totalVolume += weight;
  }

  if (totalVolume <= 0) return { ...empty, warnings: [...warnings, 'Volume total nulo.'] };

  for (const b of bins) b.fraction = b.volume / totalVolume;

  // --- POC -----------------------------------------------------------------
  let pocBinIndex = 0;
  for (let i = 1; i < bins.length; i++) {
    if ((bins[i]?.volume ?? 0) > (bins[pocBinIndex]?.volume ?? 0)) pocBinIndex = i;
  }
  const pocBin = bins[pocBinIndex];
  if (!pocBin) return empty;

  // --- Value Area ----------------------------------------------------------
  // Algoritmo canónico do Market Profile: a partir do POC, comparar a soma dos
  // DOIS bins acima com a dos DOIS abaixo e absorver o par maior, até atingir a
  // fração alvo. Comparar dois de cada vez (e não um) evita que uma assimetria
  // local desloque a value area toda para um lado.
  const target = totalVolume * targetFraction;
  let upper = pocBinIndex;
  let lower = pocBinIndex;
  let accumulated = pocBin.volume;

  while (accumulated < target && (upper < bins.length - 1 || lower > 0)) {
    const up1 = bins[upper + 1]?.volume ?? 0;
    const up2 = bins[upper + 2]?.volume ?? 0;
    const dn1 = bins[lower - 1]?.volume ?? 0;
    const dn2 = bins[lower - 2]?.volume ?? 0;
    const upSum = up1 + up2;
    const dnSum = dn1 + dn2;
    if (upSum <= 0 && dnSum <= 0) break;

    if (upSum >= dnSum) {
      if (upper >= bins.length - 1) break;
      upper++;
      accumulated += up1;
      if (accumulated < target && upper < bins.length - 1) {
        upper++;
        accumulated += up2;
      }
    } else {
      if (lower <= 0) break;
      lower--;
      accumulated += dn1;
      if (accumulated < target && lower > 0) {
        lower--;
        accumulated += dn2;
      }
    }
  }

  const vah = bins[upper]?.high ?? maxHigh;
  const val = bins[lower]?.low ?? minLow;

  // --- Nós de volume -------------------------------------------------------
  const meanVolume = totalVolume / bins.length;
  const highVolumeNodes: number[] = [];
  const lowVolumeNodes: number[] = [];
  for (let i = 1; i < bins.length - 1; i++) {
    const prev = bins[i - 1];
    const cur = bins[i];
    const next = bins[i + 1];
    if (!prev || !cur || !next) continue;
    if (cur.volume > prev.volume && cur.volume > next.volume && cur.volume > meanVolume * 1.3) {
      highVolumeNodes.push(cur.mid);
    }
    if (cur.volume < prev.volume && cur.volume < next.volume && cur.volume < meanVolume * 0.5) {
      lowVolumeNodes.push(cur.mid);
    }
  }

  // --- Forma ---------------------------------------------------------------
  // Bimodal: existe um segundo modo com ≥60% do POC, separado dele por um vale
  // com ≤50% do POC. Plano: o POC mal se destaca da média.
  let shape: ProfileShape = 'normal';
  const pocVolume = pocBin.volume;
  if (pocVolume < meanVolume * 1.6) {
    shape = 'flat';
  } else {
    for (const nodePrice of highVolumeNodes) {
      const idx = clamp(Math.floor((nodePrice - minLow) / binWidth), 0, binCount - 1);
      if (Math.abs(idx - pocBinIndex) < 3) continue;
      const nodeVolume = bins[idx]?.volume ?? 0;
      if (nodeVolume < pocVolume * 0.6) continue;
      const from = Math.min(idx, pocBinIndex);
      const to = Math.max(idx, pocBinIndex);
      let valley = Infinity;
      for (let k = from + 1; k < to; k++) valley = Math.min(valley, bins[k]?.volume ?? 0);
      if (valley <= pocVolume * 0.5) {
        shape = 'bimodal';
        break;
      }
    }
  }

  if (shape === 'bimodal') {
    warnings.push(
      'Perfil BIMODAL: houve dois leilões distintos nesta janela. A value area agregada não ' +
        'descreve nenhum deles, e a analogia "70% ≈ 1σ" é inválida aqui.',
    );
  } else if (shape === 'flat') {
    warnings.push(
      'Perfil PLANO: o POC mal se destaca da média — período de tendência, não de balanço. ' +
        'Num perfil plano o POC não é um íman, é apenas o meio do caminho percorrido.',
    );
  }

  return {
    bins,
    binWidth,
    poc: pocBin.mid,
    pocBinIndex,
    vah,
    val,
    totalVolume,
    valueAreaFraction: accumulated / totalVolume,
    highVolumeNodes,
    lowVolumeNodes,
    shape,
    fromIndex,
    toIndex,
    usedVolume,
    warnings,
  };
}

export interface ProfilePlanOptions {
  symbol: string;
  timeframe: Timeframe;
  minRMultiple?: number;
  /** Fechos consecutivos fora da value area que contam como aceitação. Por omissão 2. */
  acceptanceBars?: number;
  /** Buffer do stop, em múltiplos de σ. Por omissão 0,75. */
  stopBufferSigma?: number;
  profile?: VolumeProfile;
}

/**
 * Produz sinais a partir da posição da ÚLTIMA vela fechada face à value area.
 *
 * **Rotação (mean-reversion)** — a vela negociou fora da value area mas FECHOU
 * de volta lá dentro: o leilão testou o preço injusto e rejeitou-o. Alvo: o POC.
 * Só é emitido em perfis com forma 'normal' — num perfil plano ou bimodal a
 * premissa de balanço não se verifica.
 *
 * **Aceitação (continuação)** — `acceptanceBars` fechos consecutivos fora da
 * value area: o mercado aceitou o novo nível e está a construir valor noutro
 * sítio. Alvo: o nó de baixo volume seguinte (zonas de trânsito rápido), ou o
 * extremo do perfil.
 */
export function planVolumeProfileTrades(
  candles: readonly Candle[],
  options: ProfilePlanOptions,
): StrategySignal[] {
  const list = candles as Candle[];
  if (list.length < 30) return [];

  const lastIndex = list.length - 1;
  const last = list[lastIndex];
  if (!last) return [];

  const profile = options.profile ?? buildVolumeProfile(list);
  if (profile.bins.length === 0 || profile.totalVolume <= 0) return [];

  const minR = options.minRMultiple ?? 2;
  const acceptanceBars = options.acceptanceBars ?? 2;
  const stopBufferSigma = options.stopBufferSigma ?? 0.75;

  const vol = estimateVolatility(list);
  const sigmaPrice = sigmaToPriceDistance(last.close, vol.recommended);
  const buffer = sigmaPrice * stopBufferSigma;

  const baseAssumptions = [
    'O volume por preço foi aproximado distribuindo o volume de cada vela uniformemente pelo seu intervalo — na realidade concentra-se perto da abertura e do fecho.',
    'A equivalência "value area de 70% ≈ 1σ" só vale se o perfil for aproximadamente gaussiano.',
    'A janela do perfil e o número de faixas são parâmetros livres: mudá-los muda o POC e, com ele, o sinal.',
    'Assume estacionaridade: que a distribuição de negócio do passado recente informa o próximo período.',
  ];
  if (!profile.usedVolume) {
    baseAssumptions.push(
      'Sem volume: o perfil é por tempo (TPO). "Onde o preço esteve mais tempo" não é "onde se transacionou mais".',
    );
  }

  const out: StrategySignal[] = [];

  // ------------------------------------------------------------------ rotação
  const tradedAbove = last.high > profile.vah;
  const tradedBelow = last.low < profile.val;
  const closedInside = last.close <= profile.vah && last.close >= profile.val;

  if (profile.shape === 'normal' && closedInside && (tradedAbove || tradedBelow)) {
    const direction: Direction = tradedAbove ? 'bearish' : 'bullish';
    const sign = direction === 'bullish' ? 1 : -1;
    const entryPrice = tradedAbove ? profile.vah : profile.val;
    const stopLoss = tradedAbove ? last.high + buffer : last.low - buffer;
    const risk = Math.abs(entryPrice - stopLoss);

    if (risk > 0) {
      const opposite = tradedAbove ? profile.val : profile.vah;
      const rOf = (p: number) => (sign * (p - entryPrice)) / risk;
      const raw = [
        {
          price: profile.poc,
          r: rOf(profile.poc),
          rationale:
            `POC em ${profile.poc.toFixed(5)} — o preço que facilitou mais negócio na janela. ` +
            'É o alvo natural de uma rotação dentro do balanço.',
        },
        {
          price: opposite,
          r: rOf(opposite),
          rationale: 'Extremo oposto da value area — a rotação completa do balanço.',
        },
      ].filter((t) => t.r > 0.3);

      if (raw.length > 0) {
        const fractions = raw.length === 1 ? [1] : [0.6, 0.4];
        const targets = raw.map((t, i) => ({
          price: t.price,
          rMultiple: t.r,
          closeFraction: fractions[i] ?? 0,
          rationale: t.rationale,
        }));
        const maxRMultiple = targets.reduce((m, t) => Math.max(m, t.rMultiple), 0);

        if (maxRMultiple >= minR) {
          out.push({
            strategy: 'volume-profile',
            symbol: options.symbol,
            timeframe: options.timeframe,
            direction,
            regime: 'mean-reversion',
            index: lastIndex,
            generatedAt: last.time,
            referencePrice: last.close,
            entryZoneLow: Math.min(entryPrice, last.close),
            entryZoneHigh: Math.max(entryPrice, last.close),
            entryPrice,
            stopLoss,
            targets,
            maxRMultiple,
            conviction: clamp(0.4 + (profile.valueAreaFraction - 0.6), 0, 1),
            rationale:
              `O preço negociou ${tradedAbove ? 'acima da VAH' : 'abaixo da VAL'} ` +
              `(${(tradedAbove ? profile.vah : profile.val).toFixed(5)}) e fechou de volta dentro da ` +
              `value area. Rejeição do preço injusto; perfil de forma ${profile.shape}.`,
            assumptions: [
              ...baseAssumptions,
              'Assume que o leilão continua em balanço. Se o período seguinte for de tendência, a value area desloca-se e o POC deixa de ser íman.',
            ],
            warnings: [...profile.warnings, ...vol.warnings],
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------- aceitação
  let closesAbove = 0;
  let closesBelow = 0;
  for (let i = lastIndex; i > lastIndex - acceptanceBars && i >= 0; i--) {
    const c = list[i];
    if (!c) break;
    if (c.close > profile.vah) closesAbove++;
    else if (c.close < profile.val) closesBelow++;
    else break;
  }

  if (closesAbove >= acceptanceBars || closesBelow >= acceptanceBars) {
    const direction: Direction = closesAbove >= acceptanceBars ? 'bullish' : 'bearish';
    const sign = direction === 'bullish' ? 1 : -1;
    // Entrada no reteste do bordo da value area, agora invertido.
    const entryPrice = direction === 'bullish' ? profile.vah : profile.val;
    const stopLoss = direction === 'bullish' ? profile.poc - buffer : profile.poc + buffer;
    const risk = Math.abs(entryPrice - stopLoss);

    if (risk > 0) {
      const firstBin = profile.bins[0];
      const lastBin = profile.bins[profile.bins.length - 1];
      const edge = direction === 'bullish' ? (lastBin?.high ?? last.close) : (firstBin?.low ?? last.close);
      const lvn = profile.lowVolumeNodes
        .filter((p) => (direction === 'bullish' ? p > entryPrice : p < entryPrice))
        .sort((a, b) => (direction === 'bullish' ? a - b : b - a))[0];

      const rOf = (p: number) => (sign * (p - entryPrice)) / risk;
      const raw: Array<{ price: number; r: number; rationale: string }> = [];
      if (lvn !== undefined) {
        raw.push({
          price: lvn,
          r: rOf(lvn),
          rationale:
            `Nó de baixo volume em ${lvn.toFixed(5)} — faixa que o preço atravessou depressa da ` +
            'última vez. Zonas de trânsito rápido são alvos plausíveis, não paragens.',
        });
      }
      raw.push({
        price: edge,
        r: rOf(edge),
        rationale: 'Extremo do perfil — o limite da distribuição observada na janela.',
      });

      const usable = raw.filter((t) => t.r > 0.3);
      if (usable.length > 0) {
        const fractions = usable.length === 1 ? [1] : [0.5, 0.5];
        const targets = usable.map((t, i) => ({
          price: t.price,
          rMultiple: t.r,
          closeFraction: fractions[i] ?? 0,
          rationale: t.rationale,
        }));
        const maxRMultiple = targets.reduce((m, t) => Math.max(m, t.rMultiple), 0);

        if (maxRMultiple >= minR) {
          out.push({
            strategy: 'volume-profile',
            symbol: options.symbol,
            timeframe: options.timeframe,
            direction,
            regime: 'continuation',
            index: lastIndex,
            generatedAt: last.time,
            referencePrice: last.close,
            entryZoneLow: Math.min(entryPrice, last.close),
            entryZoneHigh: Math.max(entryPrice, last.close),
            entryPrice,
            stopLoss,
            targets,
            maxRMultiple,
            conviction: clamp(0.35 + 0.1 * Math.max(closesAbove, closesBelow), 0, 1),
            rationale:
              `${Math.max(closesAbove, closesBelow)} fechos consecutivos ` +
              `${direction === 'bullish' ? 'acima da VAH' : 'abaixo da VAL'}: aceitação do novo nível. ` +
              'O leilão deslocou-se e vai construir valor mais à frente.',
            assumptions: [
              ...baseAssumptions,
              `Assume que ${acceptanceBars} fechos consecutivos distinguem aceitação de um varrimento — é uma convenção, não um resultado medido.`,
              'O stop no POC assume que o regresso ao POC invalida a aceitação. Num mercado volátil isso acontece com frequência sem que a tese esteja errada.',
            ],
            warnings: [...profile.warnings, ...vol.warnings],
          });
        }
      }
    }
  }

  return out;
}
