/**
 * ICT ALGO — modelo de continuação (tendência).
 *
 * Em tendência, o site não manda procurar reversões: manda seguir a estrutura.
 *
 *   BOS        "confirms trend continuation via clean break of the prior swing"
 *   impulso    a perna que fez o BOS, do swing que a originou até ao extremo
 *              que atingiu
 *   OTE        "the 62%–79% Fibonacci retracement of an impulsive leg" — o
 *              desconto dentro da própria perna
 *   PD array   "OTE refines PD array into precise price": um FVG ou order
 *              block da perna que caia dentro da janela OTE
 *   IRL → ERL  entra-se na liquidez INTERNA (o FVG/OB) e sai-se na EXTERNA: o
 *              extremo do impulso
 *
 * Stop: abaixo do swing que originou o impulso. Se esse mínimo cair, o BOS
 * deixou de valer e a leitura de tendência também.
 *
 * Nota de geometria, porque explica os números: com stop na origem e alvo no
 * extremo, uma entrada a 62% paga 1,6R, a 70,5% paga 2,4R e a 79% paga 3,8R. A
 * exigência de 2R deixa passar só a metade mais funda do OTE — que é a que o
 * site chama "sweet spot".
 */

import type { IctDireccao, PdArray, ResultadoModelo } from '../types.js';
import { MIN_DESLOCAMENTO, ultimaQuebraAte, ultimoSwingAntes } from '../estrutura.js';
import { arraysVivosEm } from '../arrays.js';
import { ote } from '../crt.js';
import { JANELA_TENDENCIA } from '../regime.js';
import { type ContextoModelo, falha, fecharSinal, jaTocado, nomeLado, passo, px } from './comum.js';

export function avaliarContinuacao(ctx: ContextoModelo, d: IctDireccao): ResultadoModelo {
  const M = 'continuacao' as const;
  const { velas, i, vies, tendencias } = ctx;
  const tf = ctx.timeframe;
  const passos = [];
  const oposto: IctDireccao = d === 'bullish' ? 'bearish' : 'bullish';

  // 1 — Alinhamento top-down
  const micro = tendencias[i] === 1 ? 'bullish' : tendencias[i] === -1 ? 'bearish' : 'neutral';
  if (vies.direccao !== d || micro !== d || vies.estruturaSemanal === oposto) {
    passos.push(
      passo(1, tf, 'Alinhamento', 'falhou', `Diário ${vies.direccao}, ${tf.toUpperCase()} ${micro}, semanal ${vies.estruturaSemanal} — não estão alinhados para ${nomeLado(d)}.`),
    );
    return falha(M, passos, 'sem alinhamento semanal/diário/micro');
  }
  passos.push(passo(1, tf, 'Alinhamento', 'ok', `Diário e ${tf.toUpperCase()} de ${nomeLado(d)}, semanal não contra.`));

  // 2 — BOS com deslocamento, sem quebra contrária depois
  const bos = ultimaQuebraAte(
    ctx.quebras,
    i,
    JANELA_TENDENCIA,
    (q) => q.tipo === 'bos' && q.lado === d && q.deslocamentoAtr >= MIN_DESLOCAMENTO,
  );
  if (!bos) {
    passos.push(passo(2, tf, 'BOS', 'espera', 'Sem quebra de estrutura limpa, com deslocamento, nas últimas velas.'));
    return falha(M, passos, 'sem BOS recente');
  }
  const contra = ultimaQuebraAte(ctx.quebras, i, i - bos.index, (q) => q.index > bos.index && q.lado === oposto);
  if (contra) {
    passos.push(passo(2, tf, 'BOS', 'falhou', `Depois do BOS houve ${contra.tipo.toUpperCase()} contrário.`));
    return falha(M, passos, 'BOS anulado por quebra contrária');
  }
  passos.push(passo(2, tf, 'BOS', 'ok', `Fechou além de ${px(bos.nivel)} com corpo de ${bos.deslocamentoAtr.toFixed(1)} ATR.`));

  // 3 — O impulso: da origem ao extremo atingido desde o BOS
  const origem = ultimoSwingAntes(ctx.swings, d === 'bullish' ? 'low' : 'high', bos.index, i);
  if (!origem) {
    passos.push(passo(3, tf, 'Impulso', 'espera', 'Sem swing de origem conhecido antes do BOS.'));
    return falha(M, passos, 'impulso sem origem');
  }
  let extremo = d === 'bullish' ? -Infinity : Infinity;
  let rompeuOrigem = false;
  for (let k = origem.index + 1; k <= i; k++) {
    const c = velas[k]!;
    extremo = d === 'bullish' ? Math.max(extremo, c.high) : Math.min(extremo, c.low);
    if (d === 'bullish' ? c.close < origem.price : c.close > origem.price) rompeuOrigem = true;
  }
  if (rompeuOrigem) {
    passos.push(passo(3, tf, 'Impulso', 'falhou', 'O preço fechou para lá da origem do impulso — a perna morreu.'));
    return falha(M, passos, 'origem do impulso rompida');
  }
  const o = ote(origem.price, extremo);
  const oteAlto = Math.max(o.inicio, o.fim);
  const oteBaixo = Math.min(o.inicio, o.fim);
  passos.push(
    passo(3, tf, 'Impulso e OTE', 'ok', `Perna ${px(origem.price)} → ${px(extremo)}; OTE (62–79%) em ${px(oteBaixo)} – ${px(oteAlto)}.`),
  );

  // 4 — Um PD array da perna, por tocar, que caia dentro do OTE
  const idade = i - origem.index;
  const candidatos: PdArray[] = [...arraysVivosEm(ctx.fvgs, i, d, idade), ...arraysVivosEm(ctx.obs, i, d, idade)].filter(
    (a) => a.index >= origem.index && !jaTocado(a, i) && a.alto >= oteBaixo && a.baixo <= oteAlto,
  );
  if (candidatos.length === 0) {
    passos.push(passo(4, tf, 'PD array no OTE', 'espera', 'Nenhum FVG ou order block da perna dentro da janela OTE.'));
    return falha(M, passos, 'sem PD array no OTE');
  }
  // O primeiro a ser tocado no regresso (o mais alto numa compra).
  candidatos.sort((a, b) => (d === 'bullish' ? b.alto - a.alto : a.baixo - b.baixo));
  const pd = candidatos[0]!;
  // A zona de entrada é a sobreposição do array com o OTE.
  const zonaAlta = Math.min(pd.alto, oteAlto);
  const zonaBaixa = Math.max(pd.baixo, oteBaixo);
  passos.push(passo(4, tf, 'PD array no OTE', 'ok', `${pd.rotulo}: entrada em ${px(zonaBaixa)} – ${px(zonaAlta)}.`));

  return fecharSinal(ctx, passos, {
    modelo: M,
    direccao: d,
    tipoEntrada: 'pendente',
    entrada: d === 'bullish' ? zonaAlta : zonaBaixa,
    zonaAlta,
    zonaBaixa,
    stop: origem.price,
    rotuloStop: 'origem do impulso',
    alvos: [{ preco: extremo, rotulo: d === 'bullish' ? 'máximo do impulso (liquidez externa)' : 'mínimo do impulso (liquidez externa)' }],
    varrimento: null,
    quebra: bos,
    pdArray: pd,
    chave: `continuacao|${bos.index}|${d}`,
  });
}
