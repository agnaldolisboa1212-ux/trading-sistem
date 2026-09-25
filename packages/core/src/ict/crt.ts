/**
 * ICT ALGO — CRT (Candle Range Theory) e a faixa de negociação.
 *
 * O CRT é o esqueleto do modelo avançado: uma vela de timeframe SUPERIOR ao da
 * entrada define uma faixa, e tudo o que se segue acontece dentro dela.
 *
 *   Fase 1  Reference Candle    a vela superior fecha; máxima e mínima passam a
 *                               ser os níveis de referência
 *   Fase 2  Seek & Destroy      o preço vai a um dos extremos, varre a liquidez
 *                               e é rejeitado. "An ICT Trader using CRT does
 *                               not enter during the Seek & Destroy phase."
 *   Fase 3  Delivery            depois da confirmação estrutural, o preço vira
 *                               para o extremo OPOSTO — que é o alvo
 *
 * A vela de referência tem de ter "a clear body and defined wicks — not an
 * indecision doji", e um extremo ainda por testar. Um doji não define faixa
 * nenhuma: se o corpo é nada, não há intenção para ler.
 *
 * ── PREMIUM E DISCOUNT VIVEM AQUI ──────────────────────────────────────────
 *
 * A faixa do CRT é o que dá sentido a "caro" e "barato": acima de 50% é premium,
 * abaixo é discount, e o modelo só compra em discount e só vende em premium.
 * Sem uma faixa definida, premium/discount não são afirmações sobre nada.
 */

import type { Candle, Timeframe } from '../types/market.js';
import type { IctDireccao } from './types.js';
import { ultimaFechadaAte } from './tempo.js';

/** Corpo mínimo da vela de referência, em fracção do seu intervalo total. */
const MIN_CORPO_RC = 0.25;

export interface VelaReferencia {
  /** Timeframe de onde a vela veio (sempre superior ao da entrada). */
  timeframe: Timeframe;
  time: number;
  alto: number;
  baixo: number;
  abertura: number;
  fecho: number;
  /** Corpo em fracção do intervalo: abaixo de MIN_CORPO_RC é doji e não serve. */
  corpo: number;
  /** Primeira vela de entrada a partir da qual esta referência é utilizável. */
  validaDe: number;
}

export interface FaixaNegociacao {
  alto: number;
  baixo: number;
  equilibrio: number;
  amplitude: number;
}

/**
 * A vela de referência: a última vela FECHADA do timeframe superior.
 *
 * "The Reference Candle comes from a higher timeframe than your entry
 * timeframe." Recebe as velas do timeframe superior e o instante da vela de
 * entrada que está a ser avaliada, e devolve a última que já tinha fechado
 * nesse instante — nunca a que está em formação.
 */
export function velaReferencia(
  superiores: readonly Candle[],
  timeframeSuperior: Timeframe,
  duracaoMs: number,
  instante: number,
): VelaReferencia | null {
  // Uma vela só serve de referência depois de FECHAR.
  const k = ultimaFechadaAte(superiores, duracaoMs, instante);
  const escolhida: Candle | null = k >= 0 ? superiores[k]! : null;
  if (!escolhida) return null;
  const amplitude = escolhida.high - escolhida.low;
  if (!(amplitude > 0)) return null;
  const corpo = Math.abs(escolhida.close - escolhida.open) / amplitude;
  return {
    timeframe: timeframeSuperior,
    time: escolhida.time,
    alto: escolhida.high,
    baixo: escolhida.low,
    abertura: escolhida.open,
    fecho: escolhida.close,
    corpo,
    validaDe: escolhida.time + duracaoMs,
  };
}

/** A vela de referência serve? Rejeita dojis, que não definem faixa. */
export function referenciaUtilizavel(rc: VelaReferencia): boolean {
  return rc.corpo >= MIN_CORPO_RC;
}

/** A faixa de negociação de uma vela de referência. */
export function faixaDe(rc: VelaReferencia): FaixaNegociacao {
  return {
    alto: rc.alto,
    baixo: rc.baixo,
    equilibrio: (rc.alto + rc.baixo) / 2,
    amplitude: rc.alto - rc.baixo,
  };
}

/**
 * Premium ou discount?
 *
 * "Above 50% equilibrium = premium (expensive); below = discount (cheap)."
 * Smart money compra barato e vende caro — por isso uma compra em premium é,
 * pela definição do próprio modelo, uma compra no sítio errado.
 */
export function zonaDe(faixa: FaixaNegociacao, preco: number): 'premium' | 'discount' {
  return preco > faixa.equilibrio ? 'premium' : 'discount';
}

/**
 * A zona está correcta para este sentido?
 *
 * Compra só em discount, venda só em premium. É o filtro que o site aponta como
 * o que separa o modelo de "beginner range-trading errors".
 */
export function zonaCorrecta(faixa: FaixaNegociacao, preco: number, direccao: IctDireccao): boolean {
  return direccao === 'bullish' ? zonaDe(faixa, preco) === 'discount' : zonaDe(faixa, preco) === 'premium';
}

export interface Ote {
  /** Extremos do impulso medido. */
  de: number;
  para: number;
  /** 62% — o início da janela. */
  inicio: number;
  /** 79% — o fim da janela. */
  fim: number;
  /** 70,5% — o "sweet spot". */
  doce: number;
}

/**
 * Optimal Trade Entry: "the 62%–79% Fibonacci retracement of an impulsive leg".
 *
 * Mede-se sobre o impulso, do seu início ao seu extremo. Numa compra, o impulso
 * vai de um mínimo a um máximo e a janela fica na parte de baixo do movimento —
 * é uma retracção, não uma extensão.
 */
export function ote(de: number, para: number): Ote {
  const amplitude = para - de;
  return {
    de,
    para,
    inicio: para - amplitude * 0.62,
    fim: para - amplitude * 0.79,
    doce: para - amplitude * 0.705,
  };
}

/** O preço está dentro da janela OTE? A ordem dos limites depende do sentido. */
export function dentroDoOte(o: Ote, preco: number): boolean {
  const alto = Math.max(o.inicio, o.fim);
  const baixo = Math.min(o.inicio, o.fim);
  return preco >= baixo && preco <= alto;
}

export type FaseCrt = 'referencia' | 'seek-and-destroy' | 'delivery' | 'fora';

/**
 * Em que fase do CRT está o preço, na vela `i`.
 *
 * `varridoEm` é a vela em que um dos extremos da faixa foi varrido, e
 * `confirmadoEm` a vela da quebra estrutural que fechou o Seek & Destroy. Antes
 * do varrimento estamos à espera; entre o varrimento e a confirmação estamos em
 * Seek & Destroy e NÃO se entra; depois da confirmação é Delivery.
 */
export function faseCrt(i: number, varridoEm: number | null, confirmadoEm: number | null): FaseCrt {
  if (varridoEm === null) return 'referencia';
  if (confirmadoEm === null) return i >= varridoEm ? 'seek-and-destroy' : 'referencia';
  return i >= confirmadoEm ? 'delivery' : 'seek-and-destroy';
}

/**
 * O alvo do CRT: o extremo oposto ao que foi varrido.
 *
 * "Target: initially the opposite RC extreme, potentially extending to the next
 * liquidity draw." O alvo primário é geométrico e está definido antes de a
 * operação começar — não é um múltiplo de R escolhido depois de ver o stop.
 */
export function alvoCrt(faixa: FaixaNegociacao, direccao: IctDireccao): number {
  return direccao === 'bullish' ? faixa.alto : faixa.baixo;
}
