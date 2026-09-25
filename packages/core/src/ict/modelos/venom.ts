/**
 * ICT ALGO — modelo Venom.
 *
 * O modelo mais completo do cluster avançado, e o único que exige informação de
 * FORA do instrumento. É um encadeamento de filtros: cada estágio só é avaliado
 * se o anterior confirmou.
 *
 *   1  Viés HTF          o dia tem sentido; o modelo trabalha a favor dele
 *   2  Vela de referência a vela diária anterior define a faixa; "for bullish
 *                        setups, the low is the target" da manipulação
 *   3  Varrimento        "price must sweep the reference candle extreme" — o
 *                        pavio passa o extremo da vela de referência e o corpo
 *                        fecha de volta dentro dela
 *   4  SMT               "when NQ makes a new high but ES fails to confirm, SMT
 *                        is present" — no instante do varrimento, o par
 *                        correlacionado não acompanhou
 *   5  CHoCH             "then produce a change-of-character (CHoCH) followed by
 *                        an FVG" — aceita-se CHoCH ou MSS
 *   6  First presented   o primeiro FVG depois da quebra, na metade certa da
 *      FVG               faixa (discount para comprar, premium para vender)
 *   7  Alvo              "the opposite CRT boundary or MMXM distribution level,
 *                        whichever is structurally nearer"
 *
 * Stop: "above the swept extreme (bearish) or below (bullish)".
 *
 * Sem par correlacionado o estágio 4 não pode ser avaliado, e o Venom não
 * emite. Não se promove análise a sinal por falta de contraditório.
 */

import type { Candle } from '../../types/market.js';
import type { IctDireccao, ResultadoModelo, Varrimento } from '../types.js';
import { quebraApos } from '../estrutura.js';
import { primeiroFvgApos } from '../arrays.js';
import { drawOnLiquidity } from '../liquidez.js';
import { faixaDe, referenciaUtilizavel, zonaCorrecta, zonaDe } from '../crt.js';
import {
  type ContextoModelo,
  JANELA_FVG,
  JANELA_QUEBRA,
  falha,
  fecharSinal,
  fechouAlem,
  jaMitigado,
  jaTocado,
  nomeLado,
  passo,
  px,
  varrimentoRecente,
} from './comum.js';

/**
 * Divergência SMT no instante do varrimento.
 *
 * No momento em que ESTE instrumento fez um extremo novo, o par correlacionado
 * acompanhou? Se não acompanhou, os dois discordam — e a discordância é a
 * assinatura de que o extremo foi fabricado para apanhar stops. Alinha-se por
 * tempo, nunca por índice: dois instrumentos não têm o mesmo número de velas.
 */
export function smtNoVarrimento(
  velas: readonly Candle[],
  parVelas: readonly Candle[],
  v: Varrimento,
  janelaVelas = 20,
): { ha: boolean; detalhe: string } {
  const agora = velas[v.index];
  const passoMs = velas.length > 1 ? velas[1]!.time - velas[0]!.time : 0;
  if (!agora || !(passoMs > 0)) return { ha: false, detalhe: 'série sem tempo' };
  const inicioJanela = agora.time - janelaVelas * passoMs;

  const desde = (cs: readonly Candle[], t: number) => {
    let lo = 0;
    let hi = cs.length;
    while (lo < hi) {
      const meio = (lo + hi) >> 1;
      if (cs[meio]!.time < t) lo = meio + 1;
      else hi = meio;
    }
    return lo;
  };
  const extremos = (cs: readonly Candle[]) => {
    let alto = -Infinity;
    let baixo = Infinity;
    let n = 0;
    for (let k = desde(cs, inicioJanela); k < cs.length && cs[k]!.time < agora.time; k++) {
      alto = Math.max(alto, cs[k]!.high);
      baixo = Math.min(baixo, cs[k]!.low);
      n++;
    }
    return { alto, baixo, n };
  };

  const prim = extremos(velas);
  const par = extremos(parVelas);
  if (prim.n < 3 || par.n < 3) return { ha: false, detalhe: 'sem histórico alinhado suficiente no par' };
  // A vela do par no MESMO instante; sem ela não há comparação honesta.
  const k = desde(parVelas, agora.time);
  const parAgora = parVelas[k];
  if (!parAgora || parAgora.time !== agora.time) {
    return { ha: false, detalhe: 'o par não tem vela no instante do varrimento' };
  }

  if (v.lado === 'bullish') {
    const novoPrim = agora.low < prim.baixo;
    const novoPar = parAgora.low < par.baixo;
    if (novoPrim && !novoPar) return { ha: true, detalhe: 'fez mínimo novo e o correlacionado não acompanhou' };
    return {
      ha: false,
      detalhe: novoPrim ? 'o correlacionado fez o mesmo mínimo novo — não há divergência' : 'não houve mínimo novo',
    };
  }
  const novoPrim = agora.high > prim.alto;
  const novoPar = parAgora.high > par.alto;
  if (novoPrim && !novoPar) return { ha: true, detalhe: 'fez máximo novo e o correlacionado não acompanhou' };
  return {
    ha: false,
    detalhe: novoPrim ? 'o correlacionado fez o mesmo máximo novo — não há divergência' : 'não houve máximo novo',
  };
}

export function avaliarVenom(ctx: ContextoModelo, d: IctDireccao): ResultadoModelo {
  const M = 'venom' as const;
  const { velas, i, vies, rc } = ctx;
  const tf = ctx.timeframe;
  const passos = [];

  // 1 — Viés
  if (vies.direccao !== d) {
    passos.push(passo(1, '1d', 'Viés HTF', 'falhou', `O Venom trabalha a favor do viés diário, que não é de ${nomeLado(d)}.`));
    return falha(M, passos, 'contra ou sem viés diário');
  }
  passos.push(passo(1, '1d', 'Viés HTF', 'ok', `Viés de ${nomeLado(d)}, ${vies.aFavor} de 5.`));

  // 2 — Vela de referência
  if (!rc) {
    passos.push(passo(2, '1d', 'Vela de referência', 'espera', 'Sem vela superior já fechada.'));
    return falha(M, passos, 'sem vela de referência');
  }
  if (!referenciaUtilizavel(rc)) {
    passos.push(passo(2, rc.timeframe, 'Vela de referência', 'falhou', `Doji (corpo ${(rc.corpo * 100).toFixed(0)}%) — não define faixa.`));
    return falha(M, passos, 'vela de referência é um doji');
  }
  const faixa = faixaDe(rc);
  passos.push(passo(2, rc.timeframe, 'Vela de referência', 'ok', `Faixa ${px(faixa.baixo)} – ${px(faixa.alto)}.`));

  // 3 — Varrimento do extremo da vela de referência, corpo de volta dentro
  const extremoRc = d === 'bullish' ? rc.baixo : rc.alto;
  const v = varrimentoRecente(ctx.varrimentos, i, d, JANELA_QUEBRA + JANELA_FVG, (x) => {
    const c = velas[x.index]!;
    const passou = d === 'bullish' ? x.extremo < extremoRc : x.extremo > extremoRc;
    const voltou = d === 'bullish' ? c.close > extremoRc : c.close < extremoRc;
    return passou && voltou;
  });
  if (!v) {
    passos.push(
      passo(3, tf, 'Varrimento do extremo', 'espera', `Ninguém varreu a ${d === 'bullish' ? 'mínima' : 'máxima'} da vela de referência (${px(extremoRc)}).`),
    );
    return falha(M, passos, 'extremo da vela de referência por varrer');
  }
  passos.push(
    passo(3, tf, 'Varrimento do extremo', 'ok', `Pavio a ${px(v.extremo)}, além de ${px(extremoRc)}, e fecho de volta dentro da faixa.`),
  );

  // 4 — SMT
  if (!ctx.par || ctx.par.velas.length < 30) {
    passos.push(passo(4, tf, 'Divergência SMT', 'espera', 'Sem par correlacionado — o Venom exige este contraditório.'));
    return falha(M, passos, 'sem par correlacionado para confirmar SMT');
  }
  const smt = smtNoVarrimento(velas, ctx.par.velas, v);
  if (!smt.ha) {
    passos.push(passo(4, tf, 'Divergência SMT', 'falhou', `Contra ${ctx.par.simbolo}: ${smt.detalhe}.`));
    return falha(M, passos, 'sem divergência SMT no varrimento');
  }
  passos.push(passo(4, tf, 'Divergência SMT', 'ok', `Contra ${ctx.par.simbolo}: ${smt.detalhe}.`));

  // 5 — CHoCH / MSS
  const q = quebraApos(ctx.quebras, v.index, d, JANELA_QUEBRA, ['mss', 'choch']);
  if (!q || q.index > i) {
    passos.push(passo(5, tf, 'CHoCH', 'espera', 'Ainda sem mudança de carácter depois do varrimento.'));
    return falha(M, passos, 'varrimento sem CHoCH a confirmar');
  }
  if (fechouAlem(velas, v.index, i, v.extremo, d)) {
    passos.push(passo(5, tf, 'Invalidação', 'falhou', 'Fecho para lá do extremo varrido — era rompimento, não manipulação.'));
    return falha(M, passos, 'setup invalidado: fecho além do extremo varrido');
  }
  passos.push(passo(5, tf, 'CHoCH', 'ok', `${q.tipo.toUpperCase()} em ${px(q.nivel)}, corpo ${q.deslocamentoAtr.toFixed(1)} ATR.`));

  // 6 — First presented FVG na metade certa da faixa
  const fvg = primeiroFvgApos(ctx.fvgs, q.index - 1, d, JANELA_FVG);
  if (!fvg || fvg.index > i) {
    passos.push(passo(6, tf, 'First presented FVG', 'espera', 'O deslocamento ainda não deixou FVG.'));
    return falha(M, passos, 'sem FVG a seguir à quebra');
  }
  if (jaMitigado(fvg, i) || jaTocado(fvg, i)) {
    passos.push(passo(6, tf, 'First presented FVG', 'falhou', 'O preço já voltou a este FVG — a entrada já foi dada.'));
    return falha(M, passos, 'FVG já usado');
  }
  const entrada = d === 'bullish' ? fvg.alto : fvg.baixo;
  if (!zonaCorrecta(faixa, entrada, d)) {
    passos.push(passo(6, tf, 'First presented FVG', 'falhou', `FVG em ${zonaDe(faixa, entrada)} — o lado caro da faixa para esta operação.`));
    return falha(M, passos, 'FVG do lado errado da faixa');
  }
  passos.push(passo(6, tf, 'First presented FVG', 'ok', `${px(fvg.baixo)} – ${px(fvg.alto)}, em ${zonaDe(faixa, entrada)}.`));

  // 7 — Alvo: extremo oposto da faixa ou DOL, o mais próximo
  const dol = drawOnLiquidity(ctx.pocas, i, entrada, d);
  return fecharSinal(ctx, passos, {
    modelo: M,
    direccao: d,
    tipoEntrada: 'pendente',
    entrada,
    zonaAlta: fvg.alto,
    zonaBaixa: fvg.baixo,
    stop: v.extremo,
    rotuloStop: 'extremo varrido',
    alvos: [
      { preco: d === 'bullish' ? faixa.alto : faixa.baixo, rotulo: 'extremo oposto da vela de referência' },
      ...(dol ? [{ preco: dol.preco, rotulo: dol.rotulo }] : []),
    ],
    varrimento: v,
    quebra: q,
    pdArray: fvg,
    chave: `venom|${v.index}|${d}`,
  });
}
