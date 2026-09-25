/**
 * ICT ALGO — confirmação num timeframe menor (5M) antes de o sinal sair.
 *
 * O setup do ICT ALGO nasce em 15M, 1H ou 4H. Sem confirmação no timeframe de
 * baixo o sinal NÃO é enviado, nem aparece na lista como em curso: fica só como
 * análise, "à espera de confirmação 5M". Pedido do Agnaldo (25/09/2026): "o ICT
 * Algo deve ter uma confirmação, como BIAS, CHoCH ou MSS em 5 minutos".
 *
 * A regra, fixada antes de medir:
 *
 *   1  estrutura (o "bias" de 5M)  a última quebra de estrutura confirmada em
 *      5M — BOS, CHoCH ou MSS — é no sentido do sinal
 *   2  gatilho                      houve uma CHoCH ou um MSS no sentido do
 *      sinal nas últimas JANELA_CONFIRMACAO_LTF velas de 5M (3 horas)
 *
 * Só usa velas de 5M já FECHADAS no instante da decisão.
 */

import type { Candle } from '../types/market.js';
import type { IctDireccao, QuebraEstrutura } from './types.js';
import { quebrasDeEstrutura, serieAtrIct, swingsConfirmados } from './estrutura.js';

/** Velas de 5M em que a CHoCH/MSS de confirmação ainda conta: 3 horas. */
export const JANELA_CONFIRMACAO_LTF = 36;
const M5 = 300_000;

export interface ConfirmacaoLtf {
  ok: boolean;
  /** A quebra que confirmou (ou a última vista), se houver. */
  tipo: QuebraEstrutura['tipo'] | null;
  time: number | null;
  nivel: number | null;
  detalhe: string;
}

const nome = (t: QuebraEstrutura['tipo']) => (t === 'mss' ? 'MSS' : t === 'choch' ? 'CHoCH' : 'BOS');

/**
 * `agora`: instante da decisão (ms). Só entram velas de 5M que fecharam até lá.
 */
export function confirmacaoLtf(
  velas5m: readonly Candle[] | undefined,
  direccao: IctDireccao,
  agora: number,
): ConfirmacaoLtf {
  const semNada = (detalhe: string): ConfirmacaoLtf => ({ ok: false, tipo: null, time: null, nivel: null, detalhe });
  if (!velas5m || velas5m.length < 60) return semNada('sem velas de 5M suficientes para confirmar');
  const v = velas5m.filter((c) => c.time + M5 <= agora);
  if (v.length < 60) return semNada('sem velas de 5M fechadas suficientes para confirmar');

  const i = v.length - 1;
  const quebras = quebrasDeEstrutura(v, swingsConfirmados(v), serieAtrIct(v)).filter((q) => q.confirmadoEm <= i);
  const ultima = quebras[quebras.length - 1];
  if (!ultima) return semNada('sem quebra de estrutura em 5M');
  const lado = direccao === 'bullish' ? 'alta' : 'baixa';

  if (ultima.lado !== direccao) {
    return {
      ok: false,
      tipo: ultima.tipo,
      time: ultima.time,
      nivel: ultima.nivel,
      detalhe: `a estrutura de 5M está contra (último ${nome(ultima.tipo)} de ${ultima.lado === 'bullish' ? 'alta' : 'baixa'})`,
    };
  }
  const gatilho = [...quebras]
    .reverse()
    .find((q) => q.lado === direccao && (q.tipo === 'mss' || q.tipo === 'choch') && i - q.index <= JANELA_CONFIRMACAO_LTF);
  if (!gatilho) {
    return {
      ok: false,
      tipo: ultima.tipo,
      time: ultima.time,
      nivel: ultima.nivel,
      detalhe: `estrutura de 5M a favor, mas sem CHoCH/MSS de ${lado} nas últimas 3 horas`,
    };
  }
  const hora = new Date(gatilho.time).toISOString().slice(11, 16);
  return {
    ok: true,
    tipo: gatilho.tipo,
    time: gatilho.time,
    nivel: gatilho.nivel,
    detalhe: `${nome(gatilho.tipo)} de ${lado} em 5M às ${hora} UTC, estrutura de 5M a favor`,
  };
}
