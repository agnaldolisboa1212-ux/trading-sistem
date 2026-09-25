/**
 * ICT ALGO — modelo ICT 2022 Mentorship.
 *
 * O modelo de entrada que o ICT ensinou na mentoria pública de 2022, na sua
 * forma mecânica:
 *
 *   1  Viés HTF          o dia tem sentido; opera-se a favor dele
 *   2  Varrimento        o preço toma liquidez CONTRA o viés — um mínimo antigo
 *                        numa compra (sell-side), um máximo numa venda — e o
 *                        corpo fecha de volta
 *   3  MSS               a seguir, um deslocamento parte a estrutura no sentido
 *                        do viés (MSS: quebra com corpo de pelo menos
 *                        MIN_DESLOCAMENTO ATR)
 *   4  FVG               o deslocamento deixa um fair value gap; é aí a entrada,
 *                        no regresso do preço (ordem pendente)
 *   5  Desconto/prémio   numa compra a FVG tem de estar na metade de baixo da
 *                        perna varrimento→MSS (desconto); numa venda, na de cima
 *   6  Alvo              a liquidez mais próxima do outro lado (draw on
 *                        liquidity), com pelo menos 2R
 *
 * Stop no extremo varrido. Killzones de Londres e Nova Iorque (verificadas em
 * `fecharSinal`, como em todos os modelos).
 *
 * A diferença para o Venom: não exige SMT nem vela de referência — qualquer
 * poça de liquidez varrida serve. A diferença para o Silver Bullet: não depende
 * da janela horária de uma hora.
 */

import type { IctDireccao, ResultadoModelo } from '../types.js';
import { quebraApos } from '../estrutura.js';
import { primeiroFvgApos } from '../arrays.js';
import { drawOnLiquidity } from '../liquidez.js';
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

export function avaliarMentorship2022(ctx: ContextoModelo, d: IctDireccao): ResultadoModelo {
  const M = 'mentorship-2022' as const;
  const { velas, i, vies } = ctx;
  const tf = ctx.timeframe;
  const alta = d === 'bullish';
  const passos = [];

  // 1 — Viés
  if (vies.direccao !== d) {
    passos.push(passo(1, '1d', 'Viés HTF', 'falhou', `O modelo de 2022 opera a favor do viés diário, que não é de ${nomeLado(d)}.`));
    return falha(M, passos, 'contra ou sem viés diário');
  }
  passos.push(passo(1, '1d', 'Viés HTF', 'ok', `Viés de ${nomeLado(d)}, ${vies.aFavor} de 5.`));

  // 2 — Varrimento de liquidez contra o viés (qualquer poça)
  const v = varrimentoRecente(ctx.varrimentos, i, d, JANELA_QUEBRA + JANELA_FVG);
  if (!v) {
    passos.push(
      passo(2, tf, 'Varrimento de liquidez', 'espera', `Ainda ninguém tomou liquidez ${alta ? 'sell-side (mínimos)' : 'buy-side (máximos)'}.`),
    );
    return falha(M, passos, 'sem varrimento de liquidez');
  }
  passos.push(passo(2, tf, 'Varrimento de liquidez', 'ok', `${v.poca.rotulo} varrida: pavio a ${px(v.extremo)}.`));

  // 3 — MSS com deslocamento
  const q = quebraApos(ctx.quebras, v.index, d, JANELA_QUEBRA, ['mss']);
  if (!q || q.index > i) {
    passos.push(passo(3, tf, 'MSS', 'espera', 'Ainda sem deslocamento a partir a estrutura depois do varrimento.'));
    return falha(M, passos, 'varrimento sem MSS');
  }
  if (fechouAlem(velas, v.index, i, v.extremo, d)) {
    passos.push(passo(3, tf, 'Invalidação', 'falhou', 'Fecho para lá do extremo varrido — era rompimento, não varrimento.'));
    return falha(M, passos, 'setup invalidado: fecho além do extremo varrido');
  }
  passos.push(passo(3, tf, 'MSS', 'ok', `Quebra de ${px(q.nivel)} com corpo de ${q.deslocamentoAtr.toFixed(1)} ATR.`));

  // 4 — FVG deixada pelo deslocamento
  const fvg = primeiroFvgApos(ctx.fvgs, q.index - 1, d, JANELA_FVG);
  if (!fvg || fvg.index > i) {
    passos.push(passo(4, tf, 'FVG do deslocamento', 'espera', 'O deslocamento ainda não deixou FVG.'));
    return falha(M, passos, 'sem FVG no deslocamento');
  }
  if (jaMitigado(fvg, i) || jaTocado(fvg, i)) {
    passos.push(passo(4, tf, 'FVG do deslocamento', 'falhou', 'O preço já voltou a esta FVG — a entrada já foi dada.'));
    return falha(M, passos, 'FVG já usada');
  }

  // 5 — Desconto (compra) ou prémio (venda) da perna varrimento → agora
  let extremoPerna = alta ? -Infinity : Infinity;
  for (let k = v.index; k <= i; k++) {
    const c = velas[k]!;
    extremoPerna = alta ? Math.max(extremoPerna, c.high) : Math.min(extremoPerna, c.low);
  }
  const meio = (extremoPerna + v.extremo) / 2;
  const entrada = alta ? fvg.alto : fvg.baixo;
  const noLadoCerto = alta ? entrada <= meio : entrada >= meio;
  if (!noLadoCerto) {
    passos.push(
      passo(4, tf, 'FVG do deslocamento', 'falhou', `FVG em ${alta ? 'prémio' : 'desconto'} da perna (meio a ${px(meio)}) — o lado caro para esta operação.`),
    );
    return falha(M, passos, `FVG em ${alta ? 'prémio' : 'desconto'}`);
  }
  passos.push(
    passo(4, tf, 'FVG do deslocamento', 'ok', `${px(fvg.baixo)} – ${px(fvg.alto)}, em ${alta ? 'desconto' : 'prémio'} da perna.`),
  );

  // 6 — Alvo: a liquidez do outro lado
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
    alvos: dol ? [{ preco: dol.preco, rotulo: dol.rotulo }] : [],
    varrimento: v,
    quebra: q,
    pdArray: fvg,
    chave: `mentorship-2022|${v.index}|${d}`,
  });
}
