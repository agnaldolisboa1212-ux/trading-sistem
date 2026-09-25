/**
 * ICT ALGO — estrutura de mercado.
 *
 * Três afirmações diferentes, que o vocabulário corrente confunde:
 *
 *   BOS    "clean break of the prior swing" — a tendência CONTINUA
 *   CHoCH  "break of the most recent counter-trend swing" — a tendência MUDA
 *   MSS    "the specific structural break, backed by displacement, that signals
 *          the reversal is now underway" — o CHoCH com deslocamento, que é o
 *          único que se opera
 *
 * A diferença entre CHoCH e MSS é o deslocamento, e não é decorativa: é ela que
 * separa uma quebra por um tick numa vela morta de uma quebra com intenção
 * atrás. Sem deslocamento não há MSS.
 *
 * ── O QUE ESTE FICHEIRO SE RECUSA A FAZER ──────────────────────────────────
 *
 * Não usa um swing antes de ele ser conhecível. Um topo em `i` com lookback 2
 * só se sabe em `i+2`; até lá, para quem está a decidir, aquele topo não
 * existe. Todas as funções recebem a vela que estão a avaliar e filtram por
 * `confirmadoEm <= i`.
 */

import type { Candle } from '../types/market.js';
import type { IctDireccao, QuebraEstrutura, Swing } from './types.js';
import { visiveisEm } from './types.js';

/** Corpo mínimo da vela da quebra, em ATR, para contar como deslocamento. */
export const MIN_DESLOCAMENTO = 0.5;

/**
 * Swings fractais, com o instante em que passam a ser conhecíveis.
 *
 * Empates: estritamente maior à esquerda, maior ou igual à direita. Dois topos
 * exactamente ao mesmo nível não são dois swings — são liquidez (equal highs), e
 * quem trata disso é `liquidez.ts`.
 */
export function swingsConfirmados(velas: readonly Candle[], lookback = 2): Swing[] {
  const out: Swing[] = [];
  for (let i = lookback; i < velas.length - lookback; i++) {
    const c = velas[i];
    if (!c) continue;
    let alto = true;
    let baixo = true;
    for (let j = 1; j <= lookback; j++) {
      const e = velas[i - j];
      const d = velas[i + j];
      if (!e || !d) {
        alto = false;
        baixo = false;
        break;
      }
      if (!(c.high > e.high && c.high >= d.high)) alto = false;
      if (!(c.low < e.low && c.low <= d.low)) baixo = false;
    }
    // `confirmadoEm = i + lookback`: a vela em que o último vizinho à direita
    // fechou. Antes disso este swing não era conhecível por ninguém.
    if (alto) out.push({ index: i, confirmadoEm: i + lookback, time: c.time, kind: 'high', price: c.high });
    if (baixo) out.push({ index: i, confirmadoEm: i + lookback, time: c.time, kind: 'low', price: c.low });
  }
  return out;
}

/** Série de ATR de Wilder. */
export function serieAtrIct(velas: readonly Candle[], periodo = 14): Float64Array {
  const a = new Float64Array(velas.length);
  let x = 0;
  for (let i = 0; i < velas.length; i++) {
    const v = velas[i]!;
    const p = velas[i - 1];
    const tr =
      i === 0
        ? v.high - v.low
        : Math.max(v.high - v.low, Math.abs(v.high - p!.close), Math.abs(v.low - p!.close));
    x = i < periodo ? (x * i + tr) / (i + 1) : (x * (periodo - 1) + tr) / periodo;
    a[i] = x;
  }
  return a;
}

/**
 * A tendência estrutural conhecida na vela `i`.
 *
 * Topos e fundos a subir = alta; a descer = baixa; qualquer outra combinação é
 * indefinida, e indefinida quer mesmo dizer indefinida — não se arredonda para
 * o lado que dá jeito.
 */
export function tendenciaEm(swings: readonly Swing[], i: number): IctDireccao | 'neutral' {
  const vis = visiveisEm(swings, i);
  const topos = vis.filter((s) => s.kind === 'high');
  const fundos = vis.filter((s) => s.kind === 'low');
  if (topos.length < 2 || fundos.length < 2) return 'neutral';
  const t1 = topos[topos.length - 1]!;
  const t2 = topos[topos.length - 2]!;
  const f1 = fundos[fundos.length - 1]!;
  const f2 = fundos[fundos.length - 2]!;
  if (t1.price > t2.price && f1.price > f2.price) return 'bullish';
  if (t1.price < t2.price && f1.price < f2.price) return 'bearish';
  return 'neutral';
}

/**
 * Todas as quebras de estrutura da série.
 *
 * Percorre vela a vela e, em cada uma, só conhece o que já era conhecível.
 * Classifica:
 *
 *   quebra a favor da tendência conhecida        → BOS
 *   quebra contra a tendência, sem deslocamento  → CHoCH
 *   quebra contra a tendência, com deslocamento  → MSS
 *
 * O fecho é que conta, nunca o pavio: "confirma FECHO, não pavio".
 */
export function quebrasDeEstrutura(
  velas: readonly Candle[],
  swings: readonly Swing[],
  atr: Float64Array,
): QuebraEstrutura[] {
  const out: QuebraEstrutura[] = [];

  /*
   * Percurso incremental, não filtragem repetida.
   *
   * A versão óbvia — filtrar todos os swings em cada vela — é O(n²) e torna
   * impraticável tanto o backtest como o desenho do gráfico. Como os swings já
   * vêm ordenados por `index`, e `confirmadoEm = index + lookback` preserva
   * essa ordem, basta um ponteiro que avança e dois pares de extremos em
   * memória. O resultado é idêntico ao da filtragem; só o custo muda.
   */
  const ordenados = [...swings].sort((a, b) => a.confirmadoEm - b.confirmadoEm);
  let p = 0;
  let t1: Swing | undefined;
  let t2: Swing | undefined;
  let f1: Swing | undefined;
  let f2: Swing | undefined;

  for (let i = 1; i < velas.length; i++) {
    // Entra tudo o que passou a ser conhecível nesta vela.
    while (p < ordenados.length && ordenados[p]!.confirmadoEm <= i) {
      const s = ordenados[p]!;
      if (s.kind === 'high') {
        t2 = t1;
        t1 = s;
      } else {
        f2 = f1;
        f1 = s;
      }
      p++;
    }

    const c = velas[i]!;
    const a = atr[i] ?? 0;
    if (!(a > 0)) continue;
    const ultimoTopo = t1;
    const ultimoFundo = f1;
    const tend: IctDireccao | 'neutral' =
      t1 && t2 && f1 && f2
        ? t1.price > t2.price && f1.price > f2.price
          ? 'bullish'
          : t1.price < t2.price && f1.price < f2.price
            ? 'bearish'
            : 'neutral'
        : 'neutral';
    const corpo = Math.abs(c.close - c.open) / a;
    const anterior = velas[i - 1]!;

    // Quebra para cima: fecha acima do último topo conhecido, e a vela anterior
    // ainda não o tinha feito (senão contava a mesma quebra muitas vezes).
    if (ultimoTopo && c.close > ultimoTopo.price && anterior.close <= ultimoTopo.price) {
      const contra = tend === 'bearish';
      out.push({
        index: i,
        confirmadoEm: i, // a quebra sabe-se no fecho da própria vela
        time: c.time,
        tipo: contra ? (corpo >= MIN_DESLOCAMENTO ? 'mss' : 'choch') : 'bos',
        lado: 'bullish',
        nivel: ultimoTopo.price,
        fecho: c.close,
        deslocamentoAtr: corpo,
      });
    }

    if (ultimoFundo && c.close < ultimoFundo.price && anterior.close >= ultimoFundo.price) {
      const contra = tend === 'bullish';
      out.push({
        index: i,
        confirmadoEm: i,
        time: c.time,
        tipo: contra ? (corpo >= MIN_DESLOCAMENTO ? 'mss' : 'choch') : 'bos',
        lado: 'bearish',
        nivel: ultimoFundo.price,
        fecho: c.close,
        deslocamentoAtr: corpo,
      });
    }
  }
  return out;
}

/**
 * A quebra que serve de gatilho a um varrimento.
 *
 * O site é claro em duas coisas que esta função impõe:
 *
 *   1. "a sweep alone is not a trade signal — it needs structural confirmation
 *      (a CHoCH, MSS, or CISD) before it becomes tradeable"
 *   2. a confirmação vem LOGO A SEGUIR ("immediately following the sweep")
 *
 * `maxVelas` é esse "logo a seguir". Uma quebra vinte velas depois do
 * varrimento não é a confirmação daquele varrimento; é outra coisa qualquer que
 * aconteceu no mesmo gráfico.
 */
export function quebraApos(
  quebras: readonly QuebraEstrutura[],
  varrimentoIndex: number,
  lado: IctDireccao,
  maxVelas: number,
  aceitar: ReadonlyArray<QuebraEstrutura['tipo']> = ['mss'],
): QuebraEstrutura | null {
  for (let k = primeiraDepois(quebras, varrimentoIndex); k < quebras.length; k++) {
    const q = quebras[k]!;
    if (q.index - varrimentoIndex > maxVelas) break;
    if (q.lado !== lado) continue;
    // Por omissão só MSS: quebra sem deslocamento não conta. O CRT aceita
    // CHoCH, porque o site o diz ("a CHoCH or CISD must form after the RC
    // extreme is swept") — é a única excepção, e é explícita.
    if (!aceitar.includes(q.tipo)) continue;
    return q;
  }
  return null;
}

/**
 * Primeiro índice, numa lista ordenada por `index`, com `index > depoisDe`.
 *
 * Quebras, FVG e varrimentos saem todos ordenados por vela. Procurar a partir
 * do início em cada vela de um backtest de dez anos é o que o tornava
 * impraticável; a busca binária torna-o linear no total.
 */
export function primeiraDepois(lista: readonly { index: number }[], depoisDe: number): number {
  let lo = 0;
  let hi = lista.length;
  while (lo < hi) {
    const meio = (lo + hi) >> 1;
    if (lista[meio]!.index <= depoisDe) lo = meio + 1;
    else hi = meio;
  }
  return lo;
}

/**
 * A quebra mais recente conhecida na vela `i`, até `maxVelas` para trás.
 * `filtro` restringe o tipo ou o lado.
 */
export function ultimaQuebraAte(
  quebras: readonly QuebraEstrutura[],
  i: number,
  maxVelas: number,
  filtro: (q: QuebraEstrutura) => boolean = () => true,
): QuebraEstrutura | null {
  for (let k = primeiraDepois(quebras, i) - 1; k >= 0; k--) {
    const q = quebras[k]!;
    if (i - q.index > maxVelas) break;
    if (q.confirmadoEm > i) continue;
    if (filtro(q)) return q;
  }
  return null;
}

/**
 * A tendência estrutural em cada vela, de uma só passagem.
 *
 * `tendenciaEm` responde para UMA vela filtrando todos os swings; para o
 * regime, que é lido em todas as velas, isso é quadrático. Aqui percorre-se uma
 * vez com um ponteiro, e o valor em `i` é exactamente o que `tendenciaEm(i)`
 * daria: 1 alta, −1 baixa, 0 indefinida.
 */
export function tendenciasPorVela(n: number, swings: readonly Swing[]): Int8Array {
  const out = new Int8Array(n);
  const ordenados = [...swings].sort((a, b) => a.confirmadoEm - b.confirmadoEm);
  let p = 0;
  let t1: Swing | undefined;
  let t2: Swing | undefined;
  let f1: Swing | undefined;
  let f2: Swing | undefined;
  for (let i = 0; i < n; i++) {
    while (p < ordenados.length && ordenados[p]!.confirmadoEm <= i) {
      const s = ordenados[p]!;
      if (s.kind === 'high') {
        t2 = t1;
        t1 = s;
      } else {
        f2 = f1;
        f1 = s;
      }
      p++;
    }
    if (t1 && t2 && f1 && f2) {
      if (t1.price > t2.price && f1.price > f2.price) out[i] = 1;
      else if (t1.price < t2.price && f1.price < f2.price) out[i] = -1;
    }
  }
  return out;
}

/** O último swing de um tipo conhecido na vela `i`, com índice de pivô antes de `antesDe`. */
export function ultimoSwingAntes(
  swings: readonly Swing[],
  kind: 'high' | 'low',
  antesDe: number,
  i: number,
): Swing | null {
  for (let k = primeiraDepois(swings, antesDe - 1) - 1; k >= 0; k--) {
    const s = swings[k]!;
    if (s.kind !== kind) continue;
    if (s.confirmadoEm > i) continue;
    return s;
  }
  return null;
}
