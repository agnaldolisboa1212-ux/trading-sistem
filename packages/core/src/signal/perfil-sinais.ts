/**
 * Que timeframes de sinal cada pessoa quer, a partir do que escolheu no
 * onboarding.
 *
 * A queixa que isto resolve: quem escolheu "horas e dias" (intradiário e swing)
 * recebia só sinais de 15 minutos, porque o motor analisava sempre 15m e 1h,
 * fosse qual fosse o perfil, e o aviso só filtrava por instrumento.
 *
 *   day        day trading, minutos a horas      15m
 *   intraday   abrir e fechar no mesmo dia       1h
 *   swing      segurar dias a semanas            4h, 1d
 *   investir   meses                             1d
 *
 * Função pura, partilhada pelo motor (o que analisar) e pelo painel (o que
 * mostrar e a quem avisar).
 */

import type { Timeframe } from '../types/market.js';

/** Timeframes em que o motor de tempo real gera sinais, do mais curto ao mais longo. */
export const TIMEFRAMES_SINAIS: readonly Timeframe[] = ['15m', '1h', '4h', '1d'];

const POR_OBJETIVO: Readonly<Record<string, readonly Timeframe[]>> = {
  day: ['15m'],
  'day-trading': ['15m'],
  intraday: ['1h'],
  intradiario: ['1h'],
  swing: ['4h', '1d'],
  investir: ['1d'],
};

/** Sem objetivos escolhidos: horas, o meio-termo que não inunda nem cala. */
export const TIMEFRAMES_SINAIS_OMISSAO: readonly Timeframe[] = ['1h', '4h'];

/** Os timeframes de sinal de um perfil, ordenados do mais curto ao mais longo. */
export function timeframesDosObjetivos(objetivos: readonly string[] | null | undefined): Timeframe[] {
  const escolhidos = new Set<Timeframe>();
  for (const o of objetivos ?? []) {
    for (const tf of POR_OBJETIVO[o.trim().toLowerCase()] ?? []) escolhidos.add(tf);
  }
  const base = escolhidos.size > 0 ? escolhidos : new Set(TIMEFRAMES_SINAIS_OMISSAO);
  return TIMEFRAMES_SINAIS.filter((tf) => base.has(tf));
}

/** Um objetivo e os timeframes de sinal que lhe correspondem, para mostrar no ecrã. */
export function timeframesDoObjetivo(objetivo: string): Timeframe[] {
  return [...(POR_OBJETIVO[objetivo] ?? [])];
}

/**
 * Os timeframes de sinal de um perfil: os que a pessoa escolheu nas Definições,
 * ou — se ainda não escolheu nenhum — os que o objetivo do onboarding sugere.
 * Quem opera sabe em que timeframe opera; o objetivo é só o ponto de partida.
 */
export function timeframesDoPerfil(
  objetivos: readonly string[] | null | undefined,
  escolhidos: readonly string[] | null | undefined,
): Timeframe[] {
  const validos = new Set((escolhidos ?? []).map((t) => t.trim().toLowerCase()));
  const lista = TIMEFRAMES_SINAIS.filter((tf) => validos.has(tf));
  return lista.length > 0 ? lista : timeframesDosObjetivos(objetivos);
}
