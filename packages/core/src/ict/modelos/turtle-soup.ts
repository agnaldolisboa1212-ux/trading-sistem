/**
 * ICT ALGO — modelo Turtle Soup.
 *
 * "The failed-breakout reversal: price sweeps a relative equal high or low,
 * fails to follow through, and reverses." O rompimento que o retalho compra é a
 * liquidez que o movimento real vai usar.
 *
 *   1  Varrimento  de uma poça de máximos ou mínimos IGUAIS (dois ou mais
 *                  toques) — é isso que distingue este modelo de um varrimento
 *                  qualquer: o nível óbvio onde os stops se empilham
 *   2  Falha       o corpo fecha de volta (regra do varrimento) e segue-se uma
 *                  quebra de estrutura no sentido contrário — "a sweep alone is
 *                  not a trade signal"
 *   3  Entrada     o primeiro FVG depois da quebra
 *   4  Stop / alvo além do extremo varrido / a liquidez do outro lado
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
  passo,
  px,
  varrimentoRecente,
} from './comum.js';

export function avaliarTurtleSoup(ctx: ContextoModelo, d: IctDireccao): ResultadoModelo {
  const M = 'turtle-soup' as const;
  const { velas, i } = ctx;
  const tf = ctx.timeframe;
  const passos = [];

  // 1 — Varrimento de máximos/mínimos iguais
  const v = varrimentoRecente(
    ctx.varrimentos,
    i,
    d,
    JANELA_QUEBRA + JANELA_FVG,
    (x) => x.poca.origem === 'equal-highs' || x.poca.origem === 'equal-lows',
  );
  if (!v) {
    passos.push(
      passo(1, tf, 'Varrimento de iguais', 'espera', `Nenhum ${d === 'bullish' ? 'grupo de mínimos' : 'grupo de máximos'} iguais varrido recentemente.`),
    );
    return falha(M, passos, 'sem varrimento de máximos/mínimos iguais');
  }
  passos.push(passo(1, tf, 'Varrimento de iguais', 'ok', `Varreu ${v.poca.rotulo} em ${px(v.poca.preco)}; pavio a ${px(v.extremo)}.`));

  // 2 — A falha: quebra no sentido contrário, sem fecho além do extremo
  const q = quebraApos(ctx.quebras, v.index, d, JANELA_QUEBRA, ['mss', 'choch']);
  if (!q || q.index > i) {
    passos.push(passo(2, tf, 'Falha do rompimento', 'espera', 'Ainda sem quebra de estrutura a confirmar a falha.'));
    return falha(M, passos, 'varrimento sem quebra a confirmar');
  }
  if (fechouAlem(velas, v.index, i, v.extremo, d)) {
    passos.push(passo(2, tf, 'Falha do rompimento', 'falhou', 'O rompimento seguiu em fecho — não falhou.'));
    return falha(M, passos, 'o rompimento não falhou');
  }
  passos.push(passo(2, tf, 'Falha do rompimento', 'ok', `${q.tipo.toUpperCase()} em ${px(q.nivel)}.`));

  // 3 — Primeiro FVG depois da quebra
  const fvg = primeiroFvgApos(ctx.fvgs, q.index - 1, d, JANELA_FVG);
  if (!fvg || fvg.index > i) {
    passos.push(passo(3, tf, 'FVG', 'espera', 'A reversão ainda não deixou FVG.'));
    return falha(M, passos, 'sem FVG a seguir à quebra');
  }
  if (jaMitigado(fvg, i) || jaTocado(fvg, i)) {
    passos.push(passo(3, tf, 'FVG', 'falhou', 'O preço já voltou a este FVG.'));
    return falha(M, passos, 'FVG já usado');
  }
  passos.push(passo(3, tf, 'FVG', 'ok', `${px(fvg.baixo)} – ${px(fvg.alto)}.`));

  const entrada = d === 'bullish' ? fvg.alto : fvg.baixo;
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
    chave: `turtle-soup|${v.index}|${d}`,
  });
}
