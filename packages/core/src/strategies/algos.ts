/**
 * Os dois "algos" como estratégias que geram sinais: ICT ALGO e Asia Range Algo.
 *
 * Os dois precisam de mais do que as velas do gráfico — velas diárias para o
 * viés e o par correlacionado para o SMT — e o ICT ALGO é pesado (percorre a
 * história para o placar dos modelos). Por isso só correm quando quem chama
 * lhes entrega `extra.algo`: o motor e o radar, no servidor. No cliente, que
 * corre as estratégias vela a vela sobre o gráfico, devolvem sempre vazio.
 *
 * Nenhum dos dois tem vantagem medida: a convicção é 0 e o aviso segue no texto.
 */

import type { Candle, Timeframe } from '../types/market.js';
import type { StrategySignal } from './types.js';
import { agregar, correrIctAlgo, sinalDaUltimaVela } from '../ict/algo.js';
import { NOME_MODELO } from '../ict/types.js';
import { AVISO_ASIA_RANGE, analisarAsiaRange } from './asia-range-algo.js';

/** Dados que só o servidor entrega aos algos. */
export interface DadosAlgo {
  /** Velas diárias FECHADAS do próprio instrumento. */
  diarias: readonly Candle[];
  /** Velas FECHADAS do par correlacionado, no mesmo timeframe. */
  par: { simbolo: string; velas: readonly Candle[] } | null;
}

interface Contexto {
  symbol: string;
  timeframe: Timeframe;
}

export const AVISO_ICT_ALGO =
  'ICT ALGO sem vantagem medida: no backtest 2022–2026 com custos nenhum modo de entrada ficou positivo nas duas metades.';

export function planIctAlgo(velas: readonly Candle[], ctx: Contexto, algo: DadosAlgo | undefined): StrategySignal[] {
  if (!algo || algo.diarias.length < 45) return [];
  const a = correrIctAlgo({
    simbolo: ctx.symbol,
    timeframe: ctx.timeframe,
    velas,
    diarias: algo.diarias,
    semanais: agregar(algo.diarias, '1w'),
    referencia: algo.diarias,
    timeframeReferencia: '1d',
    par: algo.par,
  });
  const s = sinalDaUltimaVela(a);
  if (!s) return [];
  const u = velas[velas.length - 1]!;
  const modelo = NOME_MODELO[s.modelo];
  return [
    {
      strategy: 'ict-algo',
      symbol: ctx.symbol,
      timeframe: ctx.timeframe,
      direction: s.direccao,
      regime: 'continuation',
      index: velas.length - 1,
      generatedAt: u.time,
      referencePrice: u.close,
      entryZoneLow: s.zonaEntradaBaixa,
      entryZoneHigh: s.zonaEntradaAlta,
      entryPrice: s.entrada,
      stopLoss: s.stop,
      targets: [{ price: s.alvo, rMultiple: s.rr, closeFraction: 1, rationale: s.rotuloAlvo }],
      maxRMultiple: s.rr,
      conviction: 0,
      rationale:
        `${modelo}: ${s.tipoEntrada === 'pendente' ? 'ordem pendente na zona' : 'entrada a mercado'}. ` +
        `Stop no ${s.rotuloStop}; alvo na ${s.rotuloAlvo} (${s.rr.toFixed(1)}R). ${AVISO_ICT_ALGO}`,
      assumptions: s.passos.filter((p) => p.veredicto === 'ok').map((p) => `${p.titulo}: ${p.detalhe}`),
      warnings: [...s.avisos, AVISO_ICT_ALGO],
    },
  ];
}

export function planAsiaRangeAlgo(velas: readonly Candle[], ctx: Contexto, algo: DadosAlgo | undefined): StrategySignal[] {
  if (!algo || ctx.timeframe !== '15m') return [];
  const a = analisarAsiaRange({ simbolo: ctx.symbol, velas, diarias: algo.diarias, par: algo.par });
  const s = a.sinal;
  if (!s || s.index !== velas.length - 1) return [];
  const u = velas[s.index]!;
  return [
    {
      strategy: 'asia-range-algo',
      symbol: ctx.symbol,
      timeframe: ctx.timeframe,
      direction: s.direccao,
      regime: 'continuation',
      index: s.index,
      generatedAt: u.time,
      referencePrice: u.close,
      entryZoneLow: s.entrada,
      entryZoneHigh: s.entrada,
      entryPrice: s.entrada,
      stopLoss: s.stop,
      targets: [{ price: s.alvo, rMultiple: s.rr, closeFraction: 1, rationale: s.rotuloAlvo }],
      maxRMultiple: s.rr,
      conviction: 0,
      rationale:
        `Londres varreu a ${s.direccao === 'bullish' ? 'mínima' : 'máxima'} da Ásia com SMT contra ${a.par} e fez MSS. ` +
        `Stop no extremo da manipulação; alvo na ${s.rotuloAlvo} (${s.rr.toFixed(1)}R). ${AVISO_ASIA_RANGE}`,
      assumptions: a.passos.filter((p) => p.veredicto === 'ok').map((p) => `${p.titulo}: ${p.detalhe}`),
      warnings: [AVISO_ASIA_RANGE],
    },
  ];
}
