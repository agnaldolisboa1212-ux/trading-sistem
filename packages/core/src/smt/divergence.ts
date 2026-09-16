/**
 * SMT Divergence — "crack in correlation".
 *
 * Definicao do eBook:
 *  - Mercados ALTAMENTE CORRELACIONADOS (NQ/ES, EURUSD/GBPUSD) devem formar
 *    swing highs e swing lows ao mesmo tempo. Se um faz lower low enquanto o
 *    outro faz higher low, isso e uma rachadura na correlacao.
 *  - Mercados INVERSAMENTE CORRELACIONADOS (DXY/EURUSD) devem mover-se em
 *    sentidos opostos. Se ambos fazem higher high, ha rachadura.
 *
 * Aviso critico do eBook, implementado aqui como `significance`:
 *   "not every crack in correlation is significant. Only cracks that occur
 *    within our overall Narrative and Point Of Interest hold any significance."
 * Por isso a deteccao bruta e separada da avaliacao de relevancia — o motor de
 * sinais so aceita SMT alinhado com a narrativa HTF e num POI.
 */

import type { Candle, Direction } from '../types/market.js';
import type { SwingDegree, SwingPoint } from '../types/structure.js';

/** Sinal da correlacao esperada entre dois instrumentos. */
export type CorrelationSign = 'positive' | 'inverse';

export interface SmtPair {
  /** Instrumento principal (aquele em que vamos operar). */
  primary: string;
  /** Instrumento de referencia usado para confirmar a divergencia. */
  reference: string;
  correlation: CorrelationSign;
  /** Peso do par: quanto mais fiavel historicamente, maior. */
  weight: number;
  notes?: string;
}

export interface SmtEvent {
  primary: string;
  reference: string;
  correlation: CorrelationSign;
  /** Direcao implicada pela divergencia (para onde o preco deve ir). */
  direction: Direction;
  /** 'high' = divergencia formada em topos; 'low' = em fundos. */
  at: 'high' | 'low';
  degree: SwingDegree;
  time: number;
  primaryIndex: number;
  referenceIndex: number;
  primaryPrice: number;
  primaryPrevPrice: number;
  referencePrice: number;
  referencePrevPrice: number;
  /**
   * Qual dos dois mercados ficou para tras. Util para escolher onde entrar: o
   * lado que varreu a liquidez costuma oferecer o melhor preco de entrada.
   */
  weakSide: 'primary' | 'reference';
  /**
   * Forca da divergencia em 0..1: o quanto os dois mercados discordaram,
   * normalizado pela amplitude combinada dos dois movimentos.
   */
  strength: number;
  description: string;
}

export interface SmtOptions {
  /** Tolerancia temporal para considerar dois swings "simultaneos", em ms. */
  timeTolerance?: number;
  /** Grau minimo de swing considerado. */
  minDegree?: SwingDegree;
}

const DEGREE_RANK: Record<SwingDegree, number> = { short: 0, intermediate: 1, long: 2 };

/**
 * Emparelha swings dos dois instrumentos por proximidade temporal.
 *
 * O emparelhamento e por TEMPO e nao por indice porque as duas series podem ter
 * numeros de velas diferentes (feriados distintos, cripto 24/7 vs indices).
 *
 * O emparelhamento e UM-PARA-UM, por avanco de dois ponteiros. Uma versao
 * anterior escolhia, para cada swing do primario, o swing mais proximo do
 * secundario sem marcar consumo — varios swings do primario acabavam mapeados
 * ao MESMO swing de referencia, e a comparacao seguinte via `referenceDelta`
 * igual a zero e descartava o par silenciosamente. Resultado: quase nenhuma
 * divergencia era detetada.
 */
function pairSwingsByTime(
  a: SwingPoint[],
  b: SwingPoint[],
  kind: 'high' | 'low',
  tolerance: number,
): Array<[SwingPoint, SwingPoint]> {
  const left = a.filter((s) => s.kind === kind).sort((x, y) => x.time - y.time);
  const right = b.filter((s) => s.kind === kind).sort((x, y) => x.time - y.time);

  const pairs: Array<[SwingPoint, SwingPoint]> = [];
  let i = 0;
  let j = 0;

  while (i < left.length && j < right.length) {
    const sa = left[i];
    const sb = right[j];
    if (!sa || !sb) break;

    const delta = sb.time - sa.time;
    if (Math.abs(delta) <= tolerance) {
      pairs.push([sa, sb]);
      i++;
      j++;
    } else if (delta < 0) {
      j++; // o swing de referencia e antigo demais — avanca
    } else {
      i++; // o swing do primario e antigo demais — avanca
    }
  }

  return pairs;
}

/**
 * Detecta divergencias SMT entre dois instrumentos.
 *
 * Compara swings CONSECUTIVOS do mesmo tipo: se o primario faz um higher high
 * e o de referencia faz um lower high (correlacao positiva), ou se ambos fazem
 * higher high (correlacao inversa), registamos o evento.
 */
export function detectSmtDivergences(
  pair: SmtPair,
  primaryCandles: Candle[],
  primarySwings: SwingPoint[],
  referenceSwings: SwingPoint[],
  options: SmtOptions = {},
): SmtEvent[] {
  const tolerance = options.timeTolerance ?? 3 * 86_400_000;
  const minRank = DEGREE_RANK[options.minDegree ?? 'intermediate'];
  const out: SmtEvent[] = [];

  const primaryFiltered = primarySwings.filter((s) => DEGREE_RANK[s.degree] >= minRank);
  const referenceFiltered = referenceSwings.filter((s) => DEGREE_RANK[s.degree] >= minRank);

  for (const kind of ['high', 'low'] as const) {
    const pairs = pairSwingsByTime(primaryFiltered, referenceFiltered, kind, tolerance);

    for (let i = 1; i < pairs.length; i++) {
      const prev = pairs[i - 1];
      const cur = pairs[i];
      if (!prev || !cur) continue;

      const [pPrev, rPrev] = prev;
      const [pCur, rCur] = cur;

      const primaryDelta = pCur.price - pPrev.price;
      const referenceDelta = rCur.price - rPrev.price;
      if (primaryDelta === 0 || referenceDelta === 0) continue;

      const sameSign = primaryDelta > 0 === referenceDelta > 0;

      // Correlacao positiva: divergencia quando os sinais DIFEREM.
      // Correlacao inversa: divergencia quando os sinais COINCIDEM.
      const diverged = pair.correlation === 'positive' ? !sameSign : sameSign;
      if (!diverged) continue;

      /*
       * Direcao implicada pela divergencia.
       *
       * Uma rachadura formada em TOPOS significa que o movimento de subida
       * deixou de ser confirmado pelo mercado par: o topo esta feito, e a
       * leitura e BEARISH. Simetricamente, uma rachadura em FUNDOS significa
       * que a descida deixou de ser confirmada — leitura BULLISH.
       *
       * Isto vale independentemente de qual dos dois falhou: o sinal esta na
       * DISCORDANCIA em si, nao em quem discordou. Qual dos dois e o lado fraco
       * fica registado em `weakSide`, porque e util para escolher o instrumento
       * a operar — o que varreu a liquidez costuma dar o melhor preco.
       */
      const direction: Direction = kind === 'high' ? 'bearish' : 'bullish';

      const weakSide: 'primary' | 'reference' =
        kind === 'high'
          ? primaryDelta < referenceDelta
            ? 'primary'
            : 'reference'
          : primaryDelta > referenceDelta
            ? 'primary'
            : 'reference';

      const primaryMove = Math.abs(primaryDelta) / (pPrev.price || 1);
      const referenceMove = Math.abs(referenceDelta) / (rPrev.price || 1);
      const combined = primaryMove + referenceMove;
      const strength = combined > 0 ? Math.min(1, combined * 40) : 0;

      const candle = primaryCandles[pCur.index];
      out.push({
        primary: pair.primary,
        reference: pair.reference,
        correlation: pair.correlation,
        direction,
        at: kind,
        degree: pCur.degree,
        time: candle?.time ?? pCur.time,
        primaryIndex: pCur.index,
        referenceIndex: rCur.index,
        primaryPrice: pCur.price,
        primaryPrevPrice: pPrev.price,
        referencePrice: rCur.price,
        referencePrevPrice: rPrev.price,
        weakSide,
        strength,
        description: describeSmt(pair, kind, primaryDelta, referenceDelta),
      });
    }
  }

  return out.sort((a, b) => a.time - b.time);
}

function describeSmt(
  pair: SmtPair,
  kind: 'high' | 'low',
  primaryDelta: number,
  referenceDelta: number,
): string {
  const label = (delta: number) =>
    kind === 'high'
      ? delta > 0
        ? 'higher high'
        : 'lower high'
      : delta > 0
        ? 'higher low'
        : 'lower low';

  const rel = pair.correlation === 'positive' ? 'correlacionados' : 'inversamente correlacionados';
  return `${pair.primary} fez ${label(primaryDelta)} enquanto ${pair.reference} fez ${label(referenceDelta)} (${rel}) — crack in correlation em ${kind === 'high' ? 'topos' : 'fundos'}.`;
}

/**
 * Filtra eventos SMT pelos criterios de relevancia do eBook.
 *
 * Um SMT so conta se:
 *  - aponta na mesma direcao da narrativa HTF;
 *  - ocorre dentro da janela recente (nao e historia antiga);
 *  - o preco esta num Point Of Interest no momento do evento.
 */
export interface SmtRelevanceContext {
  narrative: Direction;
  /** Indice da vela atual na serie do primario. */
  currentIndex: number;
  /** Quantas velas para tras o SMT ainda e considerado "fresco". */
  freshnessWindow: number;
  /** Se o preco estava dentro de um POI quando o SMT se formou. */
  insidePointOfInterest: boolean;
}

export function filterRelevantSmt(
  events: SmtEvent[],
  ctx: SmtRelevanceContext,
): SmtEvent[] {
  if (!ctx.insidePointOfInterest) return [];
  return events.filter(
    (e) =>
      e.direction === ctx.narrative &&
      e.primaryIndex <= ctx.currentIndex &&
      e.primaryIndex >= ctx.currentIndex - ctx.freshnessWindow,
  );
}

/**
 * Confluencia de SMT: quando o mesmo instrumento diverge contra VARIOS pares de
 * referencia ao mesmo tempo, a leitura e muito mais forte. Devolve a pontuacao
 * agregada ponderada pelo peso de cada par.
 */
export function aggregateSmtConfluence(
  events: SmtEvent[],
  pairs: SmtPair[],
): { score: number; references: string[]; direction: Direction | null } {
  if (events.length === 0) return { score: 0, references: [], direction: null };

  const weightOf = new Map(pairs.map((p) => [`${p.primary}|${p.reference}`, p.weight]));
  const byDirection = new Map<Direction, { score: number; refs: Set<string> }>();

  /*
   * Uma divergencia entre swings de grau superior pesa mais: um crack entre dois
   * topos long-term diz algo sobre a estrutura semanal, enquanto um entre dois
   * short-term pode ser apenas ruido de dois dias.
   */
  const degreeWeight: Record<string, number> = { short: 0.6, intermediate: 1, long: 1.3 };

  for (const e of events) {
    const w = weightOf.get(`${e.primary}|${e.reference}`) ?? 1;
    const entry = byDirection.get(e.direction) ?? { score: 0, refs: new Set<string>() };
    entry.score += w * e.strength * (degreeWeight[e.degree] ?? 1);
    entry.refs.add(e.reference);
    byDirection.set(e.direction, entry);
  }

  let bestDirection: Direction | null = null;
  let bestScore = 0;
  let bestRefs: string[] = [];

  for (const [direction, entry] of byDirection) {
    if (entry.score > bestScore) {
      bestScore = entry.score;
      bestDirection = direction;
      bestRefs = [...entry.refs];
    }
  }

  return { score: bestScore, references: bestRefs, direction: bestDirection };
}
