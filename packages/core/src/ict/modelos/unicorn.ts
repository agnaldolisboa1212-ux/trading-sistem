/**
 * ICT ALGO — modelo Unicorn.
 *
 * "A specific high-probability confluence: a breaker block overlapping a fair
 * value gap." É um modelo de REVERSÃO: o breaker só existe porque um order
 * block falhou — o preço fechou para lá dele —, e isso é por si só a prova de
 * que o controlo mudou de mãos.
 *
 *   1  MSS          o micro virou com deslocamento no sentido da operação
 *   2  Breaker      um order block do lado contrário que foi mitigado e passou
 *                   a valer ao contrário ("support that becomes resistance")
 *   3  FVG          um FVG no sentido da operação, nascido na perna da reversão
 *   4  Sobreposição a intersecção dos dois é a zona — mais apertada do que
 *                   qualquer um sozinho, e é essa a razão de ser do modelo
 *   5  Stop / alvo  além do extremo de onde a reversão partiu / a liquidez mais
 *                   próxima no sentido da operação
 */

import type { IctDireccao, ResultadoModelo } from '../types.js';
import { ultimaQuebraAte } from '../estrutura.js';
import { arraysVivosEm, unicorn } from '../arrays.js';
import { drawOnLiquidity } from '../liquidez.js';
import { type ContextoModelo, JANELA_QUEBRA, falha, fecharSinal, jaTocado, nomeLado, passo, px } from './comum.js';

/** Idade máxima do breaker, em velas: um breaker muito antigo já não é da reversão actual. */
const IDADE_BREAKER = 48;

export function avaliarUnicorn(ctx: ContextoModelo, d: IctDireccao): ResultadoModelo {
  const M = 'unicorn' as const;
  const { velas, i } = ctx;
  const tf = ctx.timeframe;
  const passos = [];

  // 1 — MSS recente no sentido da operação
  const mss = ultimaQuebraAte(ctx.quebras, i, JANELA_QUEBRA, (q) => q.tipo === 'mss' && q.lado === d);
  if (!mss) {
    passos.push(passo(1, tf, 'MSS', 'espera', `Sem mudança de estrutura de ${nomeLado(d)} com deslocamento.`));
    return falha(M, passos, 'sem MSS recente');
  }
  passos.push(passo(1, tf, 'MSS', 'ok', `MSS de ${nomeLado(d)} em ${px(mss.nivel)}, corpo ${mss.deslocamentoAtr.toFixed(1)} ATR.`));

  // O extremo de onde a reversão partiu: nas velas antes do MSS.
  let extremo = d === 'bullish' ? Infinity : -Infinity;
  for (let k = Math.max(0, mss.index - JANELA_QUEBRA); k <= mss.index; k++) {
    const c = velas[k]!;
    extremo = d === 'bullish' ? Math.min(extremo, c.low) : Math.max(extremo, c.high);
  }
  for (let k = mss.index + 1; k <= i; k++) {
    const c = velas[k]!;
    if (d === 'bullish' ? c.close < extremo : c.close > extremo) {
      passos.push(passo(1, tf, 'Invalidação', 'falhou', 'O preço fechou para lá da origem da reversão.'));
      return falha(M, passos, 'reversão invalidada');
    }
  }

  // 2 — Breakers vivos do lado da operação
  const breakers = arraysVivosEm(ctx.breakers, i, d, IDADE_BREAKER).filter((b) => !jaTocado(b, i));
  if (breakers.length === 0) {
    passos.push(passo(2, tf, 'Breaker', 'espera', 'Nenhum order block falhou e virou no sentido da operação.'));
    return falha(M, passos, 'sem breaker');
  }
  passos.push(passo(2, tf, 'Breaker', 'ok', `${breakers.length} breaker(s) de ${nomeLado(d)} vivos.`));

  // 3/4 — FVG da perna da reversão que se sobreponha a um breaker
  const fvgs = arraysVivosEm(ctx.fvgs, i, d, i - mss.index + JANELA_QUEBRA).filter(
    (f) => f.index >= mss.index - 2 && !jaTocado(f, i),
  );
  let melhor = null;
  for (const b of breakers) {
    for (const f of fvgs) {
      const z = unicorn(b, f);
      if (!z) continue;
      // O primeiro a ser tocado no regresso: o mais alto numa compra.
      if (!melhor || (d === 'bullish' ? z.alto > melhor.zona.alto : z.baixo < melhor.zona.baixo)) {
        melhor = { zona: z, breaker: b, fvg: f };
      }
    }
  }
  if (!melhor) {
    passos.push(passo(3, tf, 'Breaker + FVG', 'espera', 'Nenhum FVG da reversão se sobrepõe a um breaker.'));
    return falha(M, passos, 'sem sobreposição breaker/FVG');
  }
  const { zona, breaker, fvg } = melhor;
  passos.push(passo(3, tf, 'Breaker + FVG', 'ok', `Unicorn em ${px(zona.baixo)} – ${px(zona.alto)}.`));

  const entrada = d === 'bullish' ? zona.alto : zona.baixo;
  const dol = drawOnLiquidity(ctx.pocas, i, entrada, d);
  return fecharSinal(ctx, passos, {
    modelo: M,
    direccao: d,
    tipoEntrada: 'pendente',
    entrada,
    zonaAlta: zona.alto,
    zonaBaixa: zona.baixo,
    stop: extremo,
    rotuloStop: 'origem da reversão',
    alvos: dol ? [{ preco: dol.preco, rotulo: dol.rotulo }] : [],
    varrimento: null,
    quebra: mss,
    pdArray: zona,
    chave: `unicorn|${breaker.index}|${fvg.index}|${d}`,
  });
}
