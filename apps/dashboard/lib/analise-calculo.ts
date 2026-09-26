/**
 * Os cálculos das análises, sem rede nem ecrã: recebem velas e devolvem o
 * resultado. Correm no Web Worker (`analise.worker.ts`) e, se o browser não o
 * tiver, na thread principal — por isso ficam num módulo à parte, sem efeitos
 * ao ser importado.
 *
 * São as MESMAS funções do motor e das rotas que existiam no servidor.
 */

import {
  agregar,
  confirmacaoLtf,
  correrIctAlgo,
  executarEstrategiasValidadas,
  type AnaliseIct,
  type Candle,
  type DadosExtra,
  type Timeframe,
} from '@trading/core';

export type Trabalho =
  | {
      tipo: 'ict';
      simbolo: string;
      timeframe: Timeframe;
      granS: number;
      execucao: Candle[];
      diarias: Candle[];
      par: { simbolo: string; velas: Candle[] } | null;
      velas5m: Candle[];
      portfolio: string[];
    }
  | {
      tipo: 'estrategias';
      simbolo: string;
      timeframe: Timeframe;
      velas: Candle[];
      extra: DadosExtra;
      ids: string[];
    };

export function fazer(t: Trabalho): unknown {
  if (t.tipo === 'ict') {
    const analise: AnaliseIct = correrIctAlgo({
      simbolo: t.simbolo,
      timeframe: t.timeframe,
      velas: t.execucao,
      diarias: t.diarias,
      // A Deriv não serve velas semanais: agregam-se das diárias.
      semanais: agregar(t.diarias, '1w'),
      referencia: t.diarias,
      timeframeReferencia: '1d',
      par: t.par,
      portfolio: t.portfolio,
    });
    if (analise.sinal) {
      const ult = t.execucao[t.execucao.length - 1];
      analise.confirmacao = confirmacaoLtf(t.velas5m, analise.sinal.direccao, (ult?.time ?? Date.now()) + t.granS * 1000);
    }
    return analise;
  }
  return executarEstrategiasValidadas(t.velas, { symbol: t.simbolo, timeframe: t.timeframe }, t.extra, t.ids);
}
