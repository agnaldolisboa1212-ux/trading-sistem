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
import type { EstadoSetup, SetupFixo } from '../ict/gatilho.js';
import { AVISO_ASIA_RANGE, analisarAsiaRange } from './asia-range-algo.js';

/** Dados que só o servidor entrega aos algos. */
export interface DadosAlgo {
  /** Velas diárias FECHADAS do próprio instrumento. */
  diarias: readonly Candle[];
  /** Velas FECHADAS do par correlacionado, no mesmo timeframe. */
  par: { simbolo: string; velas: readonly Candle[] } | null;
  /**
   * Velas de 5M do próprio instrumento: a confirmação do ICT ALGO (CHoCH/MSS e
   * estrutura de 5M a favor). Sem elas o ICT ALGO não envia sinal.
   */
  ltf?: readonly Candle[];
  /** Velas de 1M do próprio instrumento: a confirmação do Asia Range Algo. */
  ltf1?: readonly Candle[];
  /** O setup fixo de 1H do ICT ALGO e o seu estado agora (o motor guarda-o entre passagens). */
  ictFixo?: { setup: SetupFixo; estado: EstadoSetup };
}

interface Contexto {
  symbol: string;
  timeframe: Timeframe;
}

export const AVISO_ICT_ALGO =
  'ICT ALGO sem vantagem medida: no backtest 2022–2026 com custos nenhum modo de entrada ficou positivo nas duas metades.';

export function planIctAlgo(velas: readonly Candle[], ctx: Contexto, algo: DadosAlgo | undefined): StrategySignal[] {
  /*
   * O tiro do SETUP FIXO (29/09/2026). O setup lê-se em 1H e fica fixo (o motor
   * guarda-o entre passagens — `pipeline/ict-fixo.ts`); aqui só sai o tiro, na
   * vela de 15M em que `estadoDoSetup` o dispara: preço na zona do 1H e
   * CHoCH/MSS de 15M a favor. Uma vez por setup.
   */
  if (ctx.timeframe !== '15m') return [];
  const f = algo?.ictFixo;
  const u = velas[velas.length - 1];
  if (!f || !u || f.estado.estado !== 'disparado' || f.estado.tiro.time !== u.time) return [];
  const { setup } = f;
  const tiro = f.estado.tiro;
  const venda = setup.direccao === 'bearish';
  const leitura = setup.passos.filter((p) => p.veredicto === 'ok').map((p) => `${p.timeframe.toUpperCase()} ${p.titulo}: ${p.detalhe}`);
  return [
    {
      strategy: 'ict-algo',
      symbol: ctx.symbol,
      timeframe: ctx.timeframe,
      direction: setup.direccao,
      regime: 'continuation',
      index: velas.length - 1,
      generatedAt: u.time,
      referencePrice: u.close,
      entryZoneLow: tiro.entrada,
      entryZoneHigh: tiro.entrada,
      entryPrice: tiro.entrada,
      stopLoss: tiro.stop,
      targets: [{ price: tiro.alvo, rMultiple: tiro.rr, closeFraction: 1, rationale: setup.rotuloAlvo }],
      maxRMultiple: tiro.rr,
      entryType: 'market',
      conviction: 0,
      rationale:
        `Setup de 1H fixo (${setup.modelo}): ${venda ? 'venda' : 'compra'} na zona ${setup.zonaBaixa}–${setup.zonaAlta}, ` +
        `alvo na ${setup.rotuloAlvo}. Tiro em 15M: ${tiro.detalhe}. Stop no extremo feito na zona. ${AVISO_ICT_ALGO}`,
      assumptions: [...leitura, `15M: ${tiro.detalhe}`],
      warnings: [AVISO_ICT_ALGO],
    },
  ];
}

export function planAsiaRangeAlgo(velas: readonly Candle[], ctx: Contexto, algo: DadosAlgo | undefined): StrategySignal[] {
  if (!algo || ctx.timeframe !== '15m') return [];
  const a = analisarAsiaRange({ simbolo: ctx.symbol, velas, par: algo.par, ltf: algo.ltf1 });
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
        `O preço chegou ao POI de ${s.direccao === 'bullish' ? 'compra' : 'venda'} (${s.zonaBaixa}–${s.zonaAlta}, topo/fundo de 15M por tocar) ` +
        `na janela de Londres e fez MSS em 1M. Stop além do POI; alvo na ${s.rotuloAlvo} (${s.rr.toFixed(1)}R).` +
        `${s.smt === true ? ` SMT a favor contra ${a.par}.` : ''} ${AVISO_ASIA_RANGE}`,
      assumptions: a.passos.filter((p) => p.veredicto === 'ok').map((p) => `${p.titulo}: ${p.detalhe}`),
      warnings: [AVISO_ASIA_RANGE],
    },
  ];
}
