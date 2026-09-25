/**
 * ICT ALGO — o modelo de entrada.
 *
 * O setup (o quê e em que sentido) e a entrada (a que preço) são decisões
 * separadas, e o site trata-as separadamente: o estágio 4, "Refining the
 * Entry", existe precisamente para escolher o preço dentro de um setup já
 * válido. Aqui estão as quatro maneiras que o site descreve:
 *
 *   borda     o limite do PD array — "when price enters the FVG, that is the
 *             entry trigger". É a regra de base dos modelos.
 *   meio      o meio da zona (50%) — o Enigma FVG: "enter at the 50% midpoint
 *             level"
 *   ote       o ponto doce do OTE, 70,5% da perna que vai do stop ao extremo
 *             atingido — "OTE refines PD array into precise price with optimal
 *             risk-to-reward"
 *   mercado   no fecho da vela que completou o setup — sem esperar recuo
 *
 * ── PORQUE É QUE ISTO É UMA ESCOLHA E NÃO UM DETALHE ───────────────────────
 *
 * Medido em 15M: 44% dos setups com ordem na borda do FVG nunca a enchem — o
 * preço vai ao alvo sem voltar à zona —, e os que enchem perdem. É a selecção
 * adversa das ordens limite: enchem-se os que vão falhar. Quanto mais fundo o
 * preço de entrada, melhor o RR no papel e pior essa selecção. Qual das quatro
 * compensa não se decide por argumento — mede-se.
 *
 * O Reaper IFVG não muda: o site manda entrar a mercado no fecho da vela de
 * rejeição, e isso já é a sua entrada.
 */

import type { Candle } from '../types/market.js';
import type { SinalIct } from './types.js';
import { RISCO_MINIMO_ATR, RR_MINIMO } from './modelos/comum.js';

export type ModoEntrada = 'borda' | 'meio' | 'ote' | 'mercado';

export const MODOS_ENTRADA: readonly ModoEntrada[] = ['borda', 'meio', 'ote', 'mercado'];

export const NOME_ENTRADA: Readonly<Record<ModoEntrada, string>> = {
  borda: 'limite do PD array',
  meio: 'meio da zona (50%)',
  ote: 'OTE 70,5%',
  mercado: 'a mercado no fecho',
};

/**
 * Reescreve a entrada de um sinal segundo o modo pedido, e volta a verificar
 * as regras que dependem do preço: lado da ordem, risco mínimo e RR mínimo.
 * Devolve null (com a razão) se, com esta entrada, o setup deixa de cumprir.
 */
export function aplicarEntrada(
  s: SinalIct,
  modo: ModoEntrada,
  velas: readonly Candle[],
  atr: Float64Array,
): { sinal: SinalIct | null; porqueNao: string | null } {
  if (modo === 'borda' || s.modelo === 'reaper-ifvg') return { sinal: s, porqueNao: null };
  const i = s.index;
  const agora = velas[i]!;
  const alta = s.direccao === 'bullish';

  let entrada: number;
  let zonaAlta = s.zonaEntradaAlta;
  let zonaBaixa = s.zonaEntradaBaixa;
  let tipoEntrada: SinalIct['tipoEntrada'] = 'pendente';

  if (modo === 'meio') {
    entrada = (s.zonaEntradaAlta + s.zonaEntradaBaixa) / 2;
  } else if (modo === 'mercado') {
    entrada = agora.close;
    tipoEntrada = 'mercado';
  } else {
    // OTE da perna que vai do stop ao extremo atingido desde o início do setup.
    const inicio = Math.min(
      s.varrimento?.index ?? Infinity,
      s.quebra?.index ?? Infinity,
      s.pdArray.index,
    );
    let extremo = alta ? -Infinity : Infinity;
    for (let k = Math.max(0, inicio); k <= i; k++) {
      extremo = alta ? Math.max(extremo, velas[k]!.high) : Math.min(extremo, velas[k]!.low);
    }
    const perna = Math.abs(extremo - s.stop);
    entrada = alta ? extremo - 0.705 * perna : extremo + 0.705 * perna;
    zonaAlta = alta ? extremo - 0.62 * perna : extremo + 0.79 * perna;
    zonaBaixa = alta ? extremo - 0.79 * perna : extremo + 0.62 * perna;
  }

  // As mesmas verificações que `fecharSinal` faz, agora com o preço novo.
  const risco = alta ? entrada - s.stop : s.stop - entrada;
  const a = atr[i] ?? 0;
  if (!(risco > 0)) return { sinal: null, porqueNao: `com entrada ${NOME_ENTRADA[modo]}, o stop fica do lado errado` };
  if (a > 0 && risco < RISCO_MINIMO_ATR * a) {
    return { sinal: null, porqueNao: `com entrada ${NOME_ENTRADA[modo]}, o stop fica curto demais` };
  }
  if (tipoEntrada === 'pendente' && !(alta ? agora.close > entrada : agora.close < entrada)) {
    return { sinal: null, porqueNao: `o preço já passou a entrada ${NOME_ENTRADA[modo]}` };
  }
  const rr = (alta ? s.alvo - entrada : entrada - s.alvo) / risco;
  if (rr < RR_MINIMO) {
    return { sinal: null, porqueNao: `com entrada ${NOME_ENTRADA[modo]}, o alvo paga só ${rr.toFixed(1)}R` };
  }
  return {
    sinal: { ...s, entrada, zonaEntradaAlta: zonaAlta, zonaEntradaBaixa: zonaBaixa, tipoEntrada, rr },
    porqueNao: null,
  };
}
