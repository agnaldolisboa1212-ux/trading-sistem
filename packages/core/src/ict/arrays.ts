/**
 * ICT ALGO — PD arrays.
 *
 * "PD Array: any specific institutional price level within a range — order
 * blocks, fair value gaps, breaker blocks and more."
 *
 * Todos partilham forma: uma ZONA (nunca um preço), um lado, e um estado. O que
 * os distingue é como nascem e o que os mata.
 *
 * ── AS QUATRO FORMAS QUE ESTE ALGORITMO USA ────────────────────────────────
 *
 *   FVG        "a three-candle imbalance — a gap left when price moves so fast
 *              the market skips a price range"
 *   Enigma     duas velas adjacentes com folga de pavio a pavio, SEM vela do
 *              meio: "the high of one candle and the low of the immediately
 *              following candle leave a gap between them, with no wicks
 *              overlapping"
 *   Order block "the origin candle of a strong move — the last opposing candle
 *              before displacement"
 *   Breaker    "an order block that failed and flipped — support that becomes
 *              resistance, or the reverse"
 *
 * ── MITIGAÇÃO É POR FECHO, NÃO POR TOQUE ───────────────────────────────────
 *
 * "A bullish order block is mitigated when price closes below its low." E, uma
 * vez mitigado, acabou: "never re-enter from a mitigated order block". Esta
 * distinção entre TOCAR (entrada) e FECHAR ALÉM (morte) é o que impede o
 * algoritmo de insistir num nível que o mercado já atravessou — que foi
 * exactamente a queixa sobre os sinais que repetiam a compra depois do stop.
 */

import type { Candle } from '../types/market.js';
import type { IctDireccao, PdArray, QuebraEstrutura } from './types.js';

/** Deslocamento mínimo, em ATR, para a vela anterior contar como order block. */
const MIN_DESLOCAMENTO_OB = 1.0;
/** Velas à frente onde se procura o deslocamento que valida um order block. */
const VELAS_DESLOCAMENTO = 3;

/**
 * Fair value gaps de três velas.
 *
 * Alta: a mínima da vela `i` fica acima da máxima da vela `i−2`; o vazio entre
 * as duas é a zona. Nasce e é conhecível no fecho da vela `i` — não há aqui
 * nenhum look-ahead, e é por isso que o FVG é o PD array mais honesto do
 * conjunto: sabe-se no instante em que existe.
 */
export function fairValueGaps(velas: readonly Candle[]): PdArray[] {
  const out: PdArray[] = [];
  for (let i = 2; i < velas.length; i++) {
    const a = velas[i - 2]!;
    const c = velas[i]!;
    if (c.low > a.high) {
      out.push({
        index: i,
        confirmadoEm: i,
        time: c.time,
        tipo: 'fvg',
        lado: 'bullish',
        alto: c.low,
        baixo: a.high,
        mitigadoEm: null,
        tocadoEm: null,
        rotulo: 'FVG de alta',
      });
    }
    if (c.high < a.low) {
      out.push({
        index: i,
        confirmadoEm: i,
        time: c.time,
        tipo: 'fvg',
        lado: 'bearish',
        alto: a.low,
        baixo: c.high,
        mitigadoEm: null,
        tocadoEm: null,
        rotulo: 'FVG de baixa',
      });
    }
  }
  return out;
}

/**
 * Enigma FVG: a folga de duas velas, sem vela de deslocamento pelo meio.
 *
 * A exigência que o distingue é a ausência total de sobreposição de pavios —
 * "any wick overlap between the two candles retroactively disqualifies the
 * formation". Como não há vela do meio, a zona é mais apertada, e o site nota
 * que isso dá um stop mais curto do que um FVG normal.
 */
export function enigmaFvgs(velas: readonly Candle[]): PdArray[] {
  const out: PdArray[] = [];
  for (let i = 1; i < velas.length; i++) {
    const a = velas[i - 1]!;
    const c = velas[i]!;
    if (c.low > a.high) {
      out.push({
        index: i,
        confirmadoEm: i,
        time: c.time,
        tipo: 'fvg',
        lado: 'bullish',
        alto: c.low,
        baixo: a.high,
        mitigadoEm: null,
        tocadoEm: null,
        rotulo: 'Enigma FVG de alta',
      });
    }
    if (c.high < a.low) {
      out.push({
        index: i,
        confirmadoEm: i,
        time: c.time,
        tipo: 'fvg',
        lado: 'bearish',
        alto: a.low,
        baixo: c.high,
        mitigadoEm: null,
        tocadoEm: null,
        rotulo: 'Enigma FVG de baixa',
      });
    }
  }
  return out;
}

/**
 * Order blocks: a última vela de cor oposta antes do deslocamento.
 *
 * O site exige que o deslocamento tenha quebrado estrutura — "large-bodied
 * candles that broke a structural swing point", não uma deriva qualquer. Por
 * isso esta função recebe as quebras e só valida um bloco cujo deslocamento
 * coincida com uma delas.
 *
 * `confirmadoEm` é a vela do DESLOCAMENTO, não a do bloco: no instante em que
 * a vela oposta fecha, ninguém sabe ainda que ela era a última antes de um
 * movimento forte. Este detalhe é o que separa −0,04R de um t=13 imaginário.
 */
export function orderBlocks(
  velas: readonly Candle[],
  atr: Float64Array,
  quebras: readonly QuebraEstrutura[],
): PdArray[] {
  const out: PdArray[] = [];
  const quebraEm = new Map<number, QuebraEstrutura>();
  for (const q of quebras) quebraEm.set(q.index, q);

  for (let i = 1; i < velas.length - VELAS_DESLOCAMENTO; i++) {
    const v = velas[i]!;
    const a = atr[i] ?? 0;
    if (!(a > 0)) continue;
    const baixa = v.close < v.open;
    const alta = v.close > v.open;
    if (!baixa && !alta) continue;

    // Procura um deslocamento nas velas seguintes que também tenha quebrado
    // estrutura no sentido certo.
    for (let k = i + 1; k <= i + VELAS_DESLOCAMENTO; k++) {
      const d = velas[k];
      if (!d) break;
      const q = quebraEm.get(k);
      if (!q) continue;
      const corpo = Math.abs(d.close - d.open) / a;
      if (corpo < MIN_DESLOCAMENTO_OB) continue;

      // Vela de baixa seguida de deslocamento para cima = bloco de alta.
      if (baixa && q.lado === 'bullish') {
        out.push({
          index: i,
          confirmadoEm: k,
          time: v.time,
          tipo: 'order-block',
          lado: 'bullish',
          alto: v.high,
          baixo: v.low,
          mitigadoEm: null,
          tocadoEm: null,
          rotulo: 'order block de alta',
        });
        break;
      }
      if (alta && q.lado === 'bearish') {
        out.push({
          index: i,
          confirmadoEm: k,
          time: v.time,
          tipo: 'order-block',
          lado: 'bearish',
          alto: v.high,
          baixo: v.low,
          mitigadoEm: null,
          tocadoEm: null,
          rotulo: 'order block de baixa',
        });
        break;
      }
    }
  }
  return out;
}

/**
 * Marca toque e mitigação de cada array, percorrendo as velas uma vez.
 *
 *   tocadoEm    primeira vela cujo intervalo entra na zona — a entrada
 *   mitigadoEm  primeira vela que FECHA para lá do extremo — a morte
 *
 * Um array de alta morre quando o preço fecha abaixo do seu mínimo; o de baixa,
 * quando fecha acima do seu máximo. Nada é marcado antes de `confirmadoEm`,
 * porque antes disso o array não existia para ninguém.
 */
export function marcarEstados(arrays: PdArray[], velas: readonly Candle[]): void {
  for (const a of arrays) {
    // Começa na vela SEGUINTE à confirmação: a vela que cria um FVG de alta tem
    // a mínima exactamente no topo da zona, e contá-la como "toque" dava todos
    // os FVG por usados no instante em que nascem.
    for (let i = a.confirmadoEm + 1; i < velas.length; i++) {
      const c = velas[i]!;
      if (a.tocadoEm === null && c.low <= a.alto && c.high >= a.baixo) a.tocadoEm = i;
      if (a.lado === 'bullish' ? c.close < a.baixo : c.close > a.alto) {
        a.mitigadoEm = i;
        break;
      }
    }
  }
}

/**
 * Inversion FVG: um FVG que foi atravessado e mudou de papel.
 *
 * "An IFVG is when a bearish FVG gets breached from below and inverts to become
 * a support zone." Ou seja: o array mitigado não desaparece do gráfico — passa
 * a valer ao contrário, e é essa a matéria-prima do modelo Reaper.
 *
 * Devolve-se um array NOVO, do lado oposto, a nascer na vela em que o original
 * foi mitigado.
 */
export function inversionFvgs(fvgs: readonly PdArray[]): PdArray[] {
  const out: PdArray[] = [];
  for (const f of fvgs) {
    if (f.tipo !== 'fvg' || f.mitigadoEm === null) continue;
    out.push({
      index: f.mitigadoEm,
      confirmadoEm: f.mitigadoEm,
      time: f.time,
      tipo: 'breaker',
      lado: f.lado === 'bullish' ? 'bearish' : 'bullish',
      alto: f.alto,
      baixo: f.baixo,
      mitigadoEm: null,
      tocadoEm: null,
      rotulo: `IFVG (${f.lado === 'bullish' ? 'FVG de alta invertido' : 'FVG de baixa invertido'})`,
    });
  }
  return out;
}

/**
 * O "first presented FVG": o primeiro FVG depois de um acontecimento estrutural.
 *
 * "institutional orders placed during a displacement are concentrated closest
 * to where the move began — at the first FVG". Os seguintes contam como
 * diluídos e o modelo ignora-os de propósito.
 *
 * `desde` é o acontecimento (o varrimento, a quebra, a abertura da sessão);
 * `limite` é quantas velas depois ainda conta como "logo a seguir".
 */
export function primeiroFvgApos(
  fvgs: readonly PdArray[],
  desde: number,
  lado: IctDireccao,
  limite: number,
): PdArray | null {
  // Os FVG saem ordenados por vela: salta directamente para o primeiro depois
  // de `desde` em vez de percorrer a série desde o início.
  let lo = 0;
  let hi = fvgs.length;
  while (lo < hi) {
    const meio = (lo + hi) >> 1;
    if (fvgs[meio]!.index <= desde) lo = meio + 1;
    else hi = meio;
  }
  for (let k = lo; k < fvgs.length; k++) {
    const f = fvgs[k]!;
    if (f.index - desde > limite) return null;
    if (f.lado !== lado) continue;
    return f;
  }
  return null;
}

/**
 * Breaker blocks: order blocks que falharam e mudaram de papel.
 *
 * "An order block that failed and flipped — support that becomes resistance, or
 * the reverse." Um order block de alta mitigado (o preço FECHOU abaixo do seu
 * mínimo) passa a ser resistência: um breaker de baixa, a nascer na vela da
 * mitigação. `marcarEstados` tem de ter corrido antes sobre os order blocks.
 */
export function breakerBlocks(obs: readonly PdArray[]): PdArray[] {
  const out: PdArray[] = [];
  for (const ob of obs) {
    if (ob.tipo !== 'order-block' || ob.mitigadoEm === null) continue;
    const lado: IctDireccao = ob.lado === 'bullish' ? 'bearish' : 'bullish';
    out.push({
      index: ob.mitigadoEm,
      confirmadoEm: ob.mitigadoEm,
      time: ob.time,
      tipo: 'breaker',
      lado,
      alto: ob.alto,
      baixo: ob.baixo,
      mitigadoEm: null,
      tocadoEm: null,
      rotulo: `breaker de ${lado === 'bullish' ? 'alta' : 'baixa'} (order block que falhou)`,
    });
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * Os PD arrays vivos na vela `i`: já conhecíveis, por mitigar, e com no máximo
 * `idade` velas. `lista` tem de vir ordenada por `index`.
 */
export function arraysVivosEm(
  lista: readonly PdArray[],
  i: number,
  lado: IctDireccao,
  idade: number,
): PdArray[] {
  const out: PdArray[] = [];
  let lo = 0;
  let hi = lista.length;
  while (lo < hi) {
    const meio = (lo + hi) >> 1;
    if (lista[meio]!.index < i - idade) lo = meio + 1;
    else hi = meio;
  }
  for (let k = lo; k < lista.length; k++) {
    const a = lista[k]!;
    if (a.index > i) break;
    if (a.confirmadoEm > i) continue;
    if (a.lado !== lado) continue;
    if (a.mitigadoEm !== null && a.mitigadoEm <= i) continue;
    out.push(a);
  }
  return out;
}

/**
 * Unicorn: um breaker sobreposto a um FVG.
 *
 * "a specific high-probability confluence: a breaker block overlapping a fair
 * value gap" — dois PD arrays independentes no mesmo preço. Devolve a
 * intersecção, que é uma zona mais apertada do que qualquer um deles sozinho.
 */
export function unicorn(a: PdArray, b: PdArray): PdArray | null {
  if (a.lado !== b.lado) return null;
  const alto = Math.min(a.alto, b.alto);
  const baixo = Math.max(a.baixo, b.baixo);
  if (!(alto > baixo)) return null;
  return {
    index: Math.max(a.index, b.index),
    confirmadoEm: Math.max(a.confirmadoEm, b.confirmadoEm),
    time: Math.max(a.time, b.time),
    tipo: 'breaker',
    lado: a.lado,
    alto,
    baixo,
    mitigadoEm: null,
    tocadoEm: null,
    rotulo: 'Unicorn (breaker sobre FVG)',
  };
}
