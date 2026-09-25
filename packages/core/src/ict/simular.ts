/**
 * ICT ALGO — o que aconteceu a um sinal nas velas seguintes.
 *
 * Uma só função, usada em dois sítios que TÊM de medir a mesma coisa:
 *
 *   · o backtest, que diz se o algoritmo tem vantagem;
 *   · o placar ao vivo, que diz ao algoritmo que modelos andam a perder neste
 *     instrumento.
 *
 * Se fossem duas funções, bastava uma diferença de uma linha para o placar ao
 * vivo contar uma história e o backtest outra.
 *
 * ── AS HIPÓTESES, TODAS DO LADO PESSIMISTA ─────────────────────────────────
 *
 *   · Stop e alvo na mesma vela: conta STOP. Sem ticks não se sabe a ordem, e
 *     supor a favorável é a forma mais barata de inventar um sistema lucrativo.
 *   · Na vela em que a ordem pendente é preenchida, só conta o stop — um alvo
 *     tocado nessa vela pode ter sido tocado ANTES do preenchimento.
 *   · Se o preço chegar ao alvo sem nunca ter tocado na entrada, a operação não
 *     existiu: não se conta como ganho o movimento que se viu passar.
 *   · O custo (spread + comissão, em preço) desconta-se sempre, em R.
 */

import type { Candle } from '../types/market.js';
import type { SinalIct } from './types.js';

export interface OpcoesSimulacao {
  /** Velas de espera pelo preenchimento da ordem pendente. */
  espera: number;
  /** Velas máximas em operação; ao fim, sai ao fecho. */
  horizonte: number;
  /** Custo por operação, em unidades de preço. */
  custo: number;
}

export type SaidaSimulada = 'alvo' | 'stop' | 'tempo' | 'expirou' | 'fugiu';

export interface ResultadoSimulado {
  /** A ordem chegou a ser preenchida? */
  preenchida: boolean;
  entradaEm: number | null;
  /** Vela em que a operação (ou a espera) terminou. */
  fechoEm: number;
  /** Resultado líquido em R; null se nunca houve operação. */
  r: number | null;
  saida: SaidaSimulada;
}

/**
 * Simula um sinal a partir da vela `desde` (a vela em que foi emitido ou em que
 * foi escolhido — pode não ser a mesma).
 */
export function simularSinal(
  velas: readonly Candle[],
  s: SinalIct,
  desde: number,
  o: OpcoesSimulacao,
): ResultadoSimulado {
  const alta = s.direccao === 'bullish';
  const risco = Math.abs(s.entrada - s.stop);
  if (!(risco > 0)) return { preenchida: false, entradaEm: null, fechoEm: desde, r: null, saida: 'expirou' };
  const custoR = o.custo / risco;
  const ultimo = velas.length - 1;

  // ── Preenchimento ─────────────────────────────────────────────────────────
  let entradaEm = -1;
  if (s.tipoEntrada === 'mercado') {
    entradaEm = desde; // no fecho da vela de rejeição
  } else {
    for (let k = desde + 1; k <= Math.min(desde + o.espera, ultimo); k++) {
      const c = velas[k]!;
      const tocou = alta ? c.low <= s.entrada : c.high >= s.entrada;
      if (tocou) {
        entradaEm = k;
        // Na própria vela do preenchimento, só o stop conta.
        const stopJa = alta ? c.low <= s.stop : c.high >= s.stop;
        if (stopJa) return { preenchida: true, entradaEm: k, fechoEm: k, r: -1 - custoR, saida: 'stop' };
        break;
      }
      const fugiu = alta ? c.high >= s.alvo : c.low <= s.alvo;
      if (fugiu) return { preenchida: false, entradaEm: null, fechoEm: k, r: null, saida: 'fugiu' };
    }
    if (entradaEm < 0) {
      return { preenchida: false, entradaEm: null, fechoEm: Math.min(desde + o.espera, ultimo), r: null, saida: 'expirou' };
    }
  }

  // ── Gestão ────────────────────────────────────────────────────────────────
  const fim = Math.min(entradaEm + o.horizonte, ultimo);
  for (let k = entradaEm + 1; k <= fim; k++) {
    const c = velas[k]!;
    if (alta ? c.low <= s.stop : c.high >= s.stop) {
      return { preenchida: true, entradaEm, fechoEm: k, r: -1 - custoR, saida: 'stop' };
    }
    if (alta ? c.high >= s.alvo : c.low <= s.alvo) {
      return { preenchida: true, entradaEm, fechoEm: k, r: s.rr - custoR, saida: 'alvo' };
    }
  }
  const c = velas[fim]!;
  const r = ((c.close - s.entrada) * (alta ? 1 : -1)) / risco;
  return { preenchida: true, entradaEm, fechoEm: fim, r: r - custoR, saida: 'tempo' };
}

/** Espera e horizonte por timeframe: operações intradiárias, fechadas em menos de 2 dias. */
export function opcoesPorTimeframe(tf: string, custo: number): OpcoesSimulacao {
  if (tf === '15m' || tf === '5m' || tf === '1m') return { espera: 16, horizonte: 96, custo };
  if (tf === '4h') return { espera: 3, horizonte: 12, custo };
  return { espera: 6, horizonte: 36, custo };
}
