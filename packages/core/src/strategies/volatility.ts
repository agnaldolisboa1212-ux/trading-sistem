/**
 * Volatilidade realizada — estimadores de intervalo (range-based).
 *
 * PORQUE É QUE ISTO SUBSTITUI O "ATR × 1,5"
 * ------------------------------------------
 * Uma mesa não escolhe stops por hábito: dimensiona-os em unidades de
 * volatilidade, porque só assim o risco de duas posições em instrumentos
 * diferentes é comparável. Arriscar 1% do capital no BTCUSD e 1% no EURUSD só
 * é a mesma coisa se a distância do stop for medida na escala de cada um.
 *
 * O estimador clássico usa apenas fechos (close-to-close) e desperdiça a
 * informação da máxima e da mínima. Os estimadores de intervalo usam o OHLC
 * completo e são muito mais eficientes — precisam de menos amostras para a mesma
 * precisão:
 *
 *   | Estimador        | Eficiência vs close-to-close | Robusto a drift | Cobre gaps |
 *   |------------------|------------------------------|-----------------|------------|
 *   | Close-to-close   | 1×                           | sim (remove μ)  | sim        |
 *   | Parkinson (1980) | ~5×                          | NÃO             | não        |
 *   | Garman-Klass(80) | ~7×                          | NÃO             | não        |
 *   | Rogers-Satchell  | ~6×                          | SIM             | não        |
 *   | Yang-Zhang(2000) | ~14×                         | SIM             | SIM        |
 *
 * AS SUPOSIÇÕES, E QUANDO O MERCADO AS VIOLA
 * -------------------------------------------
 * 1. **Movimento browniano geométrico sem drift.** Parkinson e Garman-Klass
 *    derivam-se assumindo μ = 0. Num instrumento em tendência forte (ouro em
 *    2024-25, cripto em bull run) a amplitude alta-baixa contém drift e os dois
 *    SOBRESTIMAM a volatilidade. `estimateVolatility` mede isso e avisa.
 * 2. **Negociação contínua.** As máximas e mínimas observadas vêm de um número
 *    finito de prints. A amplitude observada é sempre ≤ à amplitude contínua
 *    verdadeira, logo Parkinson e Garman-Klass SUBESTIMAM sistematicamente em
 *    instrumentos pouco líquidos ou em timeframes altos com poucos negócios.
 *    Os dois enviesamentos (1) e (2) têm sinais opostos e não se cancelam de
 *    forma conhecida.
 * 3. **Sem gaps de abertura.** Parkinson, Garman-Klass e Rogers-Satchell
 *    ignoram o salto entre o fecho anterior e a abertura. No diário de forex e
 *    índices há gap de fim de semana; no XAUUSD e nos futuros há gap diário.
 *    Só Yang-Zhang o incorpora.
 * 4. **σ escala com √t.** `sqrt(horizonte)` só vale se os retornos forem iid.
 *    Não são: há aglomeração de volatilidade (GARCH) e autocorrelação a curto
 *    prazo. Em regime de calma o √t sobrestima; num choque subestima.
 *
 * O QUE O R:R **NÃO** É
 * ----------------------
 * Ver `bracketExpectancyUnderRandomWalk()`. Num passeio aleatório sem drift,
 * qualquer geometria de stop/alvo tem expectativa exatamente ZERO antes de
 * custos, e negativa depois. Escolher 1:3 em vez de 1:1 não cria vantagem —
 * apenas troca taxa de acerto por tamanho do ganho. A vantagem, se existir, tem
 * de vir do drift condicional à entrada, e isso é o que é preciso medir.
 */

import type { Candle, Direction } from '../types/market.js';
import type { TargetPlan } from '../risk/sizing.js';
import { mean } from './types.js';

const LN2 = Math.LN2;
/** Constante do Garman-Klass: 2·ln2 − 1 ≈ 0,3863. */
const GK_C = 2 * LN2 - 1;

/** Últimas `period` velas com OHLC estritamente positivo e high > low. */
function usableWindow(candles: readonly Candle[], period: number): Candle[] {
  const slice = candles.slice(Math.max(0, candles.length - period));
  return slice.filter(
    (c) => c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0 && c.high >= c.low,
  );
}

/**
 * Volatilidade close-to-close: desvio-padrão amostral dos log-retornos.
 * É o único que remove a média (o drift) de forma explícita.
 */
export function closeToCloseVolatility(candles: readonly Candle[], period = 20): number {
  const win = usableWindow(candles, period + 1);
  if (win.length < 3) return 0;

  const returns: number[] = [];
  for (let i = 1; i < win.length; i++) {
    const prev = win[i - 1];
    const cur = win[i];
    if (!prev || !cur) continue;
    returns.push(Math.log(cur.close / prev.close));
  }
  if (returns.length < 2) return 0;

  const m = mean(returns);
  let acc = 0;
  for (const r of returns) acc += (r - m) * (r - m);
  return Math.sqrt(acc / (returns.length - 1));
}

/**
 * Parkinson (1980): σ² = (1 / (4·n·ln2)) · Σ (ln(H/L))²
 *
 * Usa só a amplitude. Assume drift zero e negociação contínua.
 */
export function parkinsonVolatility(candles: readonly Candle[], period = 20): number {
  const win = usableWindow(candles, period);
  if (win.length < 2) return 0;

  let acc = 0;
  for (const c of win) {
    const hl = Math.log(c.high / c.low);
    acc += hl * hl;
  }
  return Math.sqrt(acc / (4 * win.length * LN2));
}

/**
 * Garman-Klass (1980), forma prática:
 *   σ² = (1/n) · Σ [ ½·(ln(H/L))² − (2·ln2 − 1)·(ln(C/O))² ]
 *
 * Acrescenta abertura e fecho ao Parkinson. O termo subtraído corrige a parte da
 * amplitude que é explicada pelo movimento direcional do corpo.
 *
 * Nota: o estimador do artigo original é a forma quadrática
 * `0,511(u−d)² − 0,019[c(u+d) − 2ud] − 0,383c²` com u=ln(H/O), d=ln(L/O),
 * c=ln(C/O). A forma acima é a aproximação de uso corrente e difere pouco na
 * prática; a diferença é irrelevante face ao enviesamento por drift.
 *
 * A soma pode ficar negativa em amostras pequenas com corpos grandes — nesse
 * caso devolve 0 em vez de NaN.
 */
export function garmanKlassVolatility(candles: readonly Candle[], period = 20): number {
  const win = usableWindow(candles, period);
  if (win.length < 2) return 0;

  let acc = 0;
  for (const c of win) {
    const hl = Math.log(c.high / c.low);
    const co = Math.log(c.close / c.open);
    acc += 0.5 * hl * hl - GK_C * co * co;
  }
  const variance = acc / win.length;
  return variance > 0 ? Math.sqrt(variance) : 0;
}

/**
 * Rogers-Satchell (1991):
 *   σ² = (1/n) · Σ [ ln(H/C)·ln(H/O) + ln(L/C)·ln(L/O) ]
 *
 * Construído para ser INDEPENDENTE DO DRIFT — é o estimador a usar quando o
 * instrumento está em tendência. Continua a ignorar gaps de abertura.
 */
export function rogersSatchellVolatility(candles: readonly Candle[], period = 20): number {
  const win = usableWindow(candles, period);
  if (win.length < 2) return 0;

  let acc = 0;
  for (const c of win) {
    acc +=
      Math.log(c.high / c.close) * Math.log(c.high / c.open) +
      Math.log(c.low / c.close) * Math.log(c.low / c.open);
  }
  const variance = acc / win.length;
  return variance > 0 ? Math.sqrt(variance) : 0;
}

/**
 * Yang-Zhang (2000): σ² = σ²_overnight + k·σ²_open-to-close + (1−k)·σ²_RS
 * com k = 0,34 / (1,34 + (n+1)/(n−1)).
 *
 * É o único aqui que trata drift E gaps de abertura. Precisa de mais amostras
 * (usa duas variâncias amostrais) — abaixo de ~10 velas é ruído.
 */
export function yangZhangVolatility(candles: readonly Candle[], period = 20): number {
  const win = usableWindow(candles, period + 1);
  const n = win.length - 1;
  if (n < 4) return 0;

  const overnight: number[] = [];
  const openToClose: number[] = [];
  for (let i = 1; i < win.length; i++) {
    const prev = win[i - 1];
    const cur = win[i];
    if (!prev || !cur) continue;
    overnight.push(Math.log(cur.open / prev.close));
    openToClose.push(Math.log(cur.close / cur.open));
  }
  if (overnight.length < 4) return 0;

  const sampleVar = (xs: number[]): number => {
    const m = mean(xs);
    let acc = 0;
    for (const x of xs) acc += (x - m) * (x - m);
    return acc / (xs.length - 1);
  };

  const varOvernight = sampleVar(overnight);
  const varOpenClose = sampleVar(openToClose);
  const rs = rogersSatchellVolatility(win.slice(1), n);
  const k = 0.34 / (1.34 + (n + 1) / (n - 1));

  const variance = varOvernight + k * varOpenClose + (1 - k) * rs * rs;
  return variance > 0 ? Math.sqrt(variance) : 0;
}

export interface VolatilityEstimate {
  /** Número de velas efetivamente usadas. */
  samples: number;
  /** Todos os valores são σ por PERÍODO (uma vela), em log-retorno. */
  closeToClose: number;
  parkinson: number;
  garmanKlass: number;
  rogersSatchell: number;
  yangZhang: number;
  /**
   * O estimador recomendado para esta série, já escolhido pelos diagnósticos
   * abaixo. É este que `buildVolatilityBracket` deve receber.
   */
  recommended: number;
  recommendedName: 'close-to-close' | 'parkinson' | 'garman-klass' | 'rogers-satchell' | 'yang-zhang';
  /** Estatística t do drift: |média| / (σ/√n). Acima de 2 o drift é material. */
  driftTStat: number;
  /** Fração das velas cujo salto de abertura excede 25% da amplitude da vela. */
  gapFraction: number;
  warnings: string[];
}

export interface VolatilityOptions {
  period?: number;
  /**
   * Forçar um estimador em vez de deixar o diagnóstico escolher. Útil para
   * comparar num backtest — mas o valor por omissão é o que se deve usar.
   */
  force?: VolatilityEstimate['recommendedName'];
}

/**
 * Calcula os cinco estimadores e escolhe um, justificando a escolha.
 *
 * Regra de escolha (explícita, para poder ser contestada):
 *   - gaps materiais (>15% das velas)      → Yang-Zhang
 *   - drift material (|t| > 2), sem gaps   → Rogers-Satchell
 *   - caso contrário                       → Garman-Klass (o mais eficiente)
 *   - amostra curta (<10 velas úteis)      → close-to-close, e avisa
 */
export function estimateVolatility(
  candles: readonly Candle[],
  options: VolatilityOptions = {},
): VolatilityEstimate {
  const period = options.period ?? 20;
  const warnings: string[] = [];
  const win = usableWindow(candles, period + 1);

  const closeToClose = closeToCloseVolatility(candles, period);
  const parkinson = parkinsonVolatility(candles, period);
  const garmanKlass = garmanKlassVolatility(candles, period);
  const rogersSatchell = rogersSatchellVolatility(candles, period);
  const yangZhang = yangZhangVolatility(candles, period);

  // --- Diagnóstico de drift ------------------------------------------------
  const returns: number[] = [];
  for (let i = 1; i < win.length; i++) {
    const prev = win[i - 1];
    const cur = win[i];
    if (!prev || !cur) continue;
    returns.push(Math.log(cur.close / prev.close));
  }
  const n = returns.length;
  const driftTStat =
    n >= 2 && closeToClose > 0 ? Math.abs(mean(returns)) / (closeToClose / Math.sqrt(n)) : 0;

  // --- Diagnóstico de gaps -------------------------------------------------
  let gaps = 0;
  let gapCandidates = 0;
  for (let i = 1; i < win.length; i++) {
    const prev = win[i - 1];
    const cur = win[i];
    if (!prev || !cur) continue;
    const range = cur.high - cur.low;
    if (range <= 0) continue;
    gapCandidates++;
    if (Math.abs(cur.open - prev.close) > range * 0.25) gaps++;
  }
  const gapFraction = gapCandidates > 0 ? gaps / gapCandidates : 0;

  // --- Escolha -------------------------------------------------------------
  let recommendedName: VolatilityEstimate['recommendedName'];
  if (options.force) {
    recommendedName = options.force;
  } else if (n < 10) {
    recommendedName = 'close-to-close';
    warnings.push(
      `Apenas ${n} retornos utilizáveis. Nenhum estimador de intervalo é fiável ` +
        'com esta amostra; a estimativa serve para escalar ordens de grandeza, não para dimensionar risco.',
    );
  } else if (gapFraction > 0.15) {
    recommendedName = 'yang-zhang';
    warnings.push(
      `${(gapFraction * 100).toFixed(0)}% das velas abrem com salto material face ao fecho anterior. ` +
        'Parkinson, Garman-Klass e Rogers-Satchell ignoram esse salto e subestimam o risco real — ' +
        'usado Yang-Zhang.',
    );
  } else if (driftTStat > 2) {
    recommendedName = 'rogers-satchell';
    warnings.push(
      `Drift estatisticamente material (t = ${driftTStat.toFixed(1)}). Parkinson e Garman-Klass ` +
        'assumem drift zero e sobrestimam a volatilidade em tendência — usado Rogers-Satchell.',
    );
  } else {
    recommendedName = 'garman-klass';
  }

  const byName: Record<VolatilityEstimate['recommendedName'], number> = {
    'close-to-close': closeToClose,
    parkinson,
    'garman-klass': garmanKlass,
    'rogers-satchell': rogersSatchell,
    'yang-zhang': yangZhang,
  };
  let recommended = byName[recommendedName];

  if (recommended <= 0) {
    // Degeneração possível: GK/RS podem sair ≤ 0 em amostras patológicas.
    recommended = closeToClose;
    warnings.push(
      `O estimador ${recommendedName} degenerou (≤ 0) nesta amostra — usado close-to-close como recurso.`,
    );
    recommendedName = 'close-to-close';
  }

  return {
    samples: n,
    closeToClose,
    parkinson,
    garmanKlass,
    rogersSatchell,
    yangZhang,
    recommended,
    recommendedName,
    driftTStat,
    gapFraction,
    warnings,
  };
}

/**
 * Converte σ (log) para uma distância em unidades de PREÇO a partir de um nível.
 *
 * Usa a forma exata `preço · (e^σ − 1)` em vez da aproximação `preço · σ`. Para
 * σ = 1% a diferença é 0,5 pontos base; para cripto com σ diário de 6% já são
 * ~18 pontos base, e o stop fica no sítio errado.
 */
export function sigmaToPriceDistance(price: number, sigmaLog: number): number {
  return price * (Math.exp(Math.abs(sigmaLog)) - 1);
}

/** Escala σ de um período para um horizonte de `periods` velas: σ·√t. */
export function scaleSigma(sigmaPerPeriod: number, periods: number): number {
  return sigmaPerPeriod * Math.sqrt(Math.max(1, periods));
}

/**
 * Probabilidade de tocar o alvo antes do stop, sob passeio aleatório SEM drift.
 *
 * Para um movimento browniano sem drift com barreiras absorventes em −a e +b,
 * P(atingir +b antes de −a) = a / (a + b). É um resultado exato, não uma
 * aproximação — e é a razão pela qual "R:R alto" não é, por si só, vantagem.
 */
export function barrierHitProbability(stopDistance: number, targetDistance: number): number {
  const total = stopDistance + targetDistance;
  if (total <= 0) return 0;
  return stopDistance / total;
}

/**
 * Expectativa em R de um bracket sob passeio aleatório sem drift.
 *
 * Devolve sempre ~0 (a menos de erro de vírgula flutuante). Existe para ser
 * chamada em testes e no painel: qualquer afirmação do tipo "esta estratégia é
 * boa porque tem 1:3" pode ser confrontada com este número.
 */
export function bracketExpectancyUnderRandomWalk(
  stopDistance: number,
  targetDistances: readonly number[],
  closeFractions: readonly number[],
): number {
  if (stopDistance <= 0) return 0;
  let expectancy = 0;
  for (let i = 0; i < targetDistances.length; i++) {
    const d = targetDistances[i] ?? 0;
    const f = closeFractions[i] ?? 0;
    const p = barrierHitProbability(stopDistance, d);
    const r = d / stopDistance;
    expectancy += f * (p * r - (1 - p) * 1);
  }
  return expectancy;
}

export interface VolatilityBracketInput {
  entry: number;
  direction: Direction;
  /** σ por período (log), tipicamente `estimateVolatility().recommended`. */
  sigmaLogPerPeriod: number;
  /** Horizonte esperado da operação, em velas. */
  horizonPeriods: number;
  /** Stop a k σ do horizonte. Por omissão 1,0. */
  stopSigmaMultiple?: number;
  /** Alvos em múltiplos de σ do horizonte. Por omissão [1, 2, 3]. */
  targetSigmaMultiples?: number[];
  /** Fração fechada em cada alvo. Normalizada para somar 1. */
  closeFractions?: number[];
}

export interface VolatilityBracket {
  /** σ escalado para o horizonte, em unidades de preço. */
  horizonSigmaPrice: number;
  stopLoss: number;
  stopDistance: number;
  targets: TargetPlan[];
  maxR: number;
  /** Expectativa deste bracket sob passeio aleatório — deve ser ≈ 0. */
  randomWalkExpectancyR: number;
  warnings: string[];
}

/**
 * Constrói stop e alvos em unidades de volatilidade em vez de em pontos fixos.
 *
 * A vantagem prática: o mesmo `stopSigmaMultiple` produz um stop "igualmente
 * apertado" no EURUSD e no BTCUSD, e ajusta-se sozinho quando o regime muda.
 * A desvantagem: quando a volatilidade sobe, o stop afasta-se e — a risco
 * percentual constante — a posição encolhe. Isso é o comportamento correto, mas
 * significa que a mesma convicção dá posições de tamanhos muito diferentes.
 */
export function buildVolatilityBracket(input: VolatilityBracketInput): VolatilityBracket {
  const warnings: string[] = [];
  const stopMult = input.stopSigmaMultiple ?? 1;
  const targetMults = input.targetSigmaMultiples ?? [1, 2, 3];
  const fractions = input.closeFractions ?? [0.4, 0.35, 0.25];

  const sigmaHorizon = scaleSigma(input.sigmaLogPerPeriod, input.horizonPeriods);
  const horizonSigmaPrice = sigmaToPriceDistance(input.entry, sigmaHorizon);

  if (horizonSigmaPrice <= 0) {
    return {
      horizonSigmaPrice: 0,
      stopLoss: input.entry,
      stopDistance: 0,
      targets: [],
      maxR: 0,
      randomWalkExpectancyR: 0,
      warnings: ['Volatilidade estimada nula — impossível dimensionar o bracket.'],
    };
  }

  if (input.horizonPeriods > 20) {
    warnings.push(
      `Horizonte de ${input.horizonPeriods} velas: a escala √t assume retornos iid. ` +
        'Com aglomeração de volatilidade, o erro desta extrapolação cresce com o horizonte.',
    );
  }

  const sign = input.direction === 'bullish' ? 1 : -1;
  const stopDistance = horizonSigmaPrice * stopMult;
  const stopLoss = input.entry - sign * stopDistance;

  const totalFraction = fractions.reduce((a, f) => a + f, 0) || 1;
  const targets: TargetPlan[] = [];
  const targetDistances: number[] = [];
  const usedFractions: number[] = [];

  for (let i = 0; i < targetMults.length; i++) {
    const mult = targetMults[i] ?? 0;
    if (mult <= 0) continue;
    const distance = horizonSigmaPrice * mult;
    const price = input.entry + sign * distance;
    const fraction = (fractions[i] ?? 0) / totalFraction;
    targetDistances.push(distance);
    usedFractions.push(fraction);
    targets.push({
      price,
      rMultiple: distance / stopDistance,
      closeFraction: fraction,
      rationale:
        `${mult}σ do horizonte (${input.horizonPeriods} velas). Distância dimensionada pela ` +
        'volatilidade realizada, não por um múltiplo fixo.',
    });
  }

  const maxR = targets.reduce((m, t) => Math.max(m, t.rMultiple), 0);
  const randomWalkExpectancyR = bracketExpectancyUnderRandomWalk(
    stopDistance,
    targetDistances,
    usedFractions,
  );

  return {
    horizonSigmaPrice,
    stopLoss,
    stopDistance,
    targets,
    maxR,
    randomWalkExpectancyR,
    warnings,
  };
}
