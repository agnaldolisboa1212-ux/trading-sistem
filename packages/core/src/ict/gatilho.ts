/**
 * ICT ALGO — o SETUP FIXO de 1H e o TIRO CERTEIRO em 15M (29/09/2026).
 *
 * Pedido do Agnaldo: "quando dão um sinal devem fixar-se naquele setup e
 * procurar pontos para o melhorar — em vez de só disparar agora, disparar
 * tiros certeiros, com justificação, do timeframe alto para o baixo".
 *
 *   1H   o setup: modelo, zona de entrada, stop e alvo (a análise top-down de
 *        sempre). Fica FIXO — o algoritmo não o troca por outro — até disparar,
 *        ser invalidado ou expirar.
 *   15M  o gatilho: o preço entra na zona do 1H e o 15M confirma a reversão
 *        (a última quebra de estrutura a favor e uma CHoCH/MSS depois do
 *        toque — `confirmacaoLtf` com passo de 15M). Aí sai o tiro: entrada no
 *        fecho dessa vela de 15M, stop no extremo feito desde o toque (mais
 *        curto do que o do 1H), alvo o do 1H.
 *
 * Invalida-se se o preço tocar o stop do 1H antes do disparo, ou se for ao
 * alvo sem ter passado pela zona; expira ao fim de `validade` (24 h).
 *
 * PUREZA: sem rede nem relógio — `agora` vem de quem chama; só lê velas de 15M
 * FECHADAS até `agora`.
 */

import type { Candle } from '../types/market.js';
import type { IctDireccao, PassoTopDown } from './types.js';
import { confirmacaoLtf } from './confirmacao.js';
import { serieAtrIct } from './estrutura.js';

const M15 = 900_000;
/** Validade de um setup fixo de 1H: 24 horas. */
export const VALIDADE_SETUP_MS = 24 * 3_600_000;
/** RR mínimo do tiro (o do ICT ALGO). */
export const RR_MINIMO_TIRO = 2;
/** O stop do tiro fica a pelo menos ¼ de ATR de 15M da entrada. */
const RISCO_MINIMO_ATR15 = 0.25;

export interface SetupFixo {
  simbolo: string;
  direccao: IctDireccao;
  /** Nome do modelo do site que montou o setup. */
  modelo: string;
  zonaBaixa: number;
  zonaAlta: number;
  stop: number;
  alvo: number;
  rotuloAlvo: string;
  /** Fecho da vela de 1H em que o setup nasceu (ms). */
  formadoEm: number;
  expiraEm: number;
  chave: string;
  /** A leitura de cima para baixo que o justifica (semanal → diário → 1H). */
  passos: PassoTopDown[];
}

export interface TiroIct {
  /** Abertura da vela de 15M do disparo (ms). */
  time: number;
  entrada: number;
  stop: number;
  alvo: number;
  rr: number;
  /** A confirmação em 15M, em palavras. */
  detalhe: string;
}

export type EstadoSetup =
  | { estado: 'a-espera-da-zona' }
  | { estado: 'na-zona'; tocadoEm: number; extremo: number; detalhe: string }
  | { estado: 'disparado'; tocadoEm: number; tiro: TiroIct }
  | { estado: 'invalidado'; em: number; motivo: string }
  | { estado: 'expirado'; em: number };

const hora = (t: number) => new Date(t).toISOString().slice(11, 16);

/**
 * Onde está o setup fixo às `agora`, com as velas de 15M (fechadas) dadas.
 * O disparo, quando existe, é o PRIMEIRO — não se procura outro depois.
 */
export function estadoDoSetup(setup: SetupFixo, velas15m: readonly Candle[], agora: number): EstadoSetup {
  const alta = setup.direccao === 'bullish';
  const atr = serieAtrIct(velas15m);
  let tocadoEm = -1;
  let extremo = alta ? Infinity : -Infinity;
  let ultimaConf = '';
  for (let k = 0; k < velas15m.length; k++) {
    const c = velas15m[k]!;
    const fecho = c.time + M15;
    if (c.time < setup.formadoEm) continue;
    if (fecho > agora) break;
    if (fecho > setup.expiraEm) return { estado: 'expirado', em: setup.expiraEm };

    // O stop do 1H tocado antes do disparo invalida o setup (na vela do toque também).
    if (alta ? c.low <= setup.stop : c.high >= setup.stop) {
      return { estado: 'invalidado', em: c.time, motivo: `o preço tocou o stop do 1H (${setup.stop}) antes de confirmar` };
    }
    if (tocadoEm < 0) {
      // Foi ao alvo sem passar pela zona: o movimento fez-se sem nós.
      if (alta ? c.high >= setup.alvo : c.low <= setup.alvo) {
        return { estado: 'invalidado', em: c.time, motivo: 'o preço foi ao alvo sem passar pela zona' };
      }
      const toca = alta ? c.low <= setup.zonaAlta : c.high >= setup.zonaBaixa;
      if (!toca) continue;
      tocadoEm = c.time;
    }
    extremo = alta ? Math.min(extremo, c.low) : Math.max(extremo, c.high);

    // O gatilho: CHoCH/MSS de 15M a favor, depois do toque, com a estrutura de 15M a favor.
    const conf = confirmacaoLtf(velas15m, setup.direccao, fecho, M15);
    ultimaConf = conf.detalhe;
    if (!conf.ok || conf.time === null || conf.time < tocadoEm) continue;
    const entrada = c.close;
    const minimo = RISCO_MINIMO_ATR15 * (atr[k] ?? 0);
    const stop = alta ? Math.min(extremo, entrada - minimo) : Math.max(extremo, entrada + minimo);
    const risco = Math.abs(entrada - stop);
    if (!(risco > 0)) continue;
    // Do lado certo do alvo, e a pagar pelo menos 2R — senão espera-se por melhor.
    if (alta ? setup.alvo <= entrada : setup.alvo >= entrada) continue;
    const rr = Math.abs(setup.alvo - entrada) / risco;
    if (rr < RR_MINIMO_TIRO) continue;
    return {
      estado: 'disparado',
      tocadoEm,
      tiro: {
        time: c.time,
        entrada,
        stop,
        alvo: setup.alvo,
        rr,
        detalhe: `zona do 1H tocada às ${hora(tocadoEm)} UTC; ${conf.detalhe}`,
      },
    };
  }
  if (tocadoEm >= 0) {
    return {
      estado: 'na-zona',
      tocadoEm,
      extremo,
      detalhe: `na zona desde as ${hora(tocadoEm)} UTC — à espera da reversão em 15M (${ultimaConf || 'sem quebra ainda'})`,
    };
  }
  if (agora > setup.expiraEm) return { estado: 'expirado', em: setup.expiraEm };
  return { estado: 'a-espera-da-zona' };
}

/**
 * Arma um setup fixo a partir da análise de 1H — só quando o setup NASCEU na
 * última vela de 1H fechada (um setup antigo já teve a sua vez).
 */
export function armarSetupIct(
  a: {
    simbolo: string;
    sinal: {
      direccao: IctDireccao;
      modelo: string;
      index: number;
      timeframe: string;
      zonaEntradaBaixa: number;
      zonaEntradaAlta: number;
      stop: number;
      alvo: number;
      rotuloAlvo: string;
      chave: string;
    } | null;
    lidas: Partial<Record<string, number>>;
    passos: PassoTopDown[];
  },
  fechoUltima1h: number,
  nomeModelo: (m: string) => string = (m) => m,
): SetupFixo | null {
  const s = a.sinal;
  if (!s) return null;
  const lidas = a.lidas[s.timeframe];
  if (typeof lidas !== 'number' || s.index !== lidas - 1) return null;
  return {
    simbolo: a.simbolo,
    direccao: s.direccao,
    modelo: nomeModelo(s.modelo),
    zonaBaixa: Math.min(s.zonaEntradaBaixa, s.zonaEntradaAlta),
    zonaAlta: Math.max(s.zonaEntradaBaixa, s.zonaEntradaAlta),
    stop: s.stop,
    alvo: s.alvo,
    rotuloAlvo: s.rotuloAlvo,
    formadoEm: fechoUltima1h,
    expiraEm: fechoUltima1h + VALIDADE_SETUP_MS,
    chave: s.chave,
    passos: a.passos,
  };
}
