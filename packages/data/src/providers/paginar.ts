/**
 * Velas da Deriv por páginas — o servidor (`deriv.ts`) e o browser
 * (`velas-browser.ts`) usam as duas esta função.
 *
 * ── O QUE FOI MEDIDO (29/09/2026, endpoint público, `count: 5000`) ─────────
 *
 * `ticks_history` não devolve a quantidade pedida: devolve uma JANELA de
 * 1000 × granularidade segundos que acaba em `end` — no máximo 1000 velas, e
 * menos onde o mercado fecha:
 *
 *   1M   1000 velas (~17 h)
 *   15M  620 no EURUSD, 374 no Nasdaq (~10 dias)
 *   1H   695 no EURUSD, 439 no Nasdaq, 1000 no BTC e no V75 (~6 semanas)
 *   4H   713 no EURUSD (~5,5 meses)
 *   1D   260 no EURUSD — e não há mais: nada para lá de UM ANO, em nenhuma
 *        granularidade, e um `end` anterior a isso devolve a janela mais recente
 *
 * Quem pedia mais recebia menos, sem aviso: o ICT ALGO pedia 3500 velas de 1H e
 * corria sobre 695 — o placar dos modelos e a quarentena sobre seis semanas,
 * não sobre os meses dos backtests.
 *
 * A janela recua: com `end` = a primeira vela − 1 s vem a anterior, e assim até
 * haver as que se pediram. Três cuidados, os três medidos:
 *   · a primeira vela de uma janela cortada a meio vem PARCIAL, com o epoch do
 *     corte, fora da grelha (10:55 numa vela de 15M). Deita-se fora; a página
 *     seguinte traz a vela inteira (10:45);
 *   · um `end` com o mercado fechado recua sozinho até à última vela
 *     (`adjust_start_time`): o fim de semana não dá páginas vazias;
 *   · a história acaba a um ano (o diário pede 400 e há ~260), ou antes, num
 *     instrumento mais novo: quando uma página não traz nenhuma vela mais
 *     antiga. No limite do ano pára sem pedir; no resto, esse pedido é o aviso.
 *
 * Com uma cópia guardada, a primeira página só vai até à última vela guardada e
 * o resto vem da cópia — velas fechadas não mudam. Refrescar 3500 velas de 1H
 * custa um pedido, não seis.
 */

import type { Candle } from '@trading/core';

/** Uma página: até `count` velas que acabam em `end` (epoch em segundos) ou na mais recente. */
export type PedirPagina = (count: number, end: number | 'latest') => Promise<Candle[]>;

/** 5000 velas de 15M num índice (~370 por janela) são 14 páginas; mais do que isto é avaria. */
export const MAX_PAGINAS = 16;

/** A Deriv pública não serve mais de um ano (medido no 1D, 1H e 15M: todos param aos 365 dias). */
export const HISTORIA_MS = 365 * 86_400_000;

export interface VelasPaginadas {
  /** Da mais antiga para a mais recente, só velas inteiras; no máximo `count`. */
  velas: Candle[];
  /** Pedidos feitos — cada página é um. */
  pedidos: number;
}

export interface OpcoesPaginacao {
  /**
   * A cópia de um pedido anterior da mesma série (ordenada, só velas inteiras).
   * A sua última vela pode ter sido apanhada a formar-se: é substituída pela
   * que vier agora.
   */
  guardadas?: readonly Candle[];
  /**
   * A cópia ainda é actual (nenhuma vela fechou desde que chegou): o recente
   * não se volta a pedir, só o que falta para trás dela. É o caso de quem pede
   * 1500 logo depois de outro ter pedido 1000.
   */
  fresca?: boolean;
  agora?: number;
}

/** Até `count` velas, recuando de janela em janela. */
export async function paginarVelas(
  pedir: PedirPagina,
  granularidade: number,
  count: number,
  { guardadas = [], fresca = false, agora = Date.now() }: OpcoesPaginacao = {},
): Promise<VelasPaginadas> {
  const passo = granularidade * 1000;
  let velas: Candle[] = fresca ? [...guardadas] : [];
  let pedidos = 0;
  // Até onde é preciso chegar para ligar à cópia guardada (null: sem cópia, ou já ligada).
  let ligar = !fresca && guardadas.length > 0 ? guardadas[guardadas.length - 1]!.time : null;
  // A vela anterior à primeira já cai fora do ano que a Deriv serve: não vale um pedido.
  const semHistoria = (): boolean => velas.length > 0 && velas[0]!.time - passo < agora - HISTORIA_MS;

  while (velas.length < count && pedidos < MAX_PAGINAS && !semHistoria()) {
    const primeira = velas[0];
    // +1: a vela parcial do início da janela, que se deita fora.
    let quantas = count - velas.length + 1;
    // Até à cópia chegam as velas que cabem no tempo que falta, mais uma.
    if (ligar !== null) quantas = Math.min(quantas, Math.floor(((primeira?.time ?? agora) - ligar) / passo) + 2);
    const pagina = await pedir(Math.min(5000, Math.max(2, quantas)), primeira ? primeira.time / 1000 - 1 : 'latest');
    pedidos++;

    const inteiras = pagina.length > 0 && pagina[0]!.time % passo !== 0 ? pagina.slice(1) : pagina;
    const novas = primeira ? inteiras.filter((c) => c.time < primeira.time) : inteiras;
    // Nenhuma vela mais antiga: a história acabou antes do ano (um instrumento mais novo).
    if (novas.length === 0) break;
    velas = [...novas, ...velas];

    if (ligar !== null && velas[0]!.time <= ligar) {
      const inicio = velas[0]!.time;
      velas = [...guardadas.filter((c) => c.time < inicio), ...velas];
      ligar = null;
    }
  }
  return { velas: velas.slice(-count), pedidos };
}
