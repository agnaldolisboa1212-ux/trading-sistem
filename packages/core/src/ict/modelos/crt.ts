/**
 * ICT ALGO — modelo CRT (Candle Range Theory).
 *
 * A vela de timeframe superior define a faixa; o preço vai a um dos extremos,
 * varre a liquidez que lá está, é rejeitado, e entrega até ao outro extremo.
 *
 *   1  Reference Candle  "a clear body and defined wicks — not an indecision
 *                        doji"; a vela diária anterior quando se executa em 1H
 *                        ou 15M
 *   2  Seek & Destroy    o preço passa um extremo e o corpo da vela mais extrema
 *                        fecha de volta dentro da faixa. "An ICT Trader using
 *                        CRT does not enter during the Seek & Destroy phase."
 *   3  Confirmação       "A CHoCH or CISD must form after the RC extreme is
 *                        swept" — aqui aceita-se CHoCH, a única excepção do
 *                        algoritmo à exigência de MSS
 *   4  Entrada           "on a retracement into a Fair Value Gap or Order Block
 *                        aligned with the Delivery direction"
 *   5  Stop / alvo       "beyond the Seek & Destroy extreme" / "initially the
 *                        opposite RC extreme"
 *
 * Difere do Venom em duas coisas, ambas do site: não exige SMT, e o alvo é
 * sempre o extremo oposto da vela de referência — a geometria da faixa, fixada
 * antes da operação começar.
 */

import type { Candle } from '../../types/market.js';
import type { IctDireccao, PdArray, ResultadoModelo } from '../types.js';
import { quebraApos } from '../estrutura.js';
import { arraysVivosEm } from '../arrays.js';
import { faixaDe, referenciaUtilizavel, zonaCorrecta } from '../crt.js';
import {
  type ContextoModelo,
  JANELA_QUEBRA,
  falha,
  fecharSinal,
  fechouAlem,
  jaTocado,
  nomeLado,
  passo,
  px,
} from './comum.js';

/** Primeira vela com `time >= t`. */
function primeiraDesde(velas: readonly Candle[], t: number): number {
  let lo = 0;
  let hi = velas.length;
  while (lo < hi) {
    const meio = (lo + hi) >> 1;
    if (velas[meio]!.time < t) lo = meio + 1;
    else hi = meio;
  }
  return lo;
}

export function avaliarCrt(ctx: ContextoModelo, d: IctDireccao): ResultadoModelo {
  const M = 'crt' as const;
  const { velas, i, rc } = ctx;
  const tf = ctx.timeframe;
  const passos = [];

  // 1 — Vela de referência
  if (!rc) {
    passos.push(passo(1, '1d', 'Vela de referência', 'espera', 'Sem vela superior já fechada.'));
    return falha(M, passos, 'sem vela de referência');
  }
  if (!referenciaUtilizavel(rc)) {
    passos.push(passo(1, rc.timeframe, 'Vela de referência', 'falhou', `Doji (corpo ${(rc.corpo * 100).toFixed(0)}%) — não define faixa.`));
    return falha(M, passos, 'vela de referência é um doji');
  }
  const faixa = faixaDe(rc);
  passos.push(passo(1, rc.timeframe, 'Vela de referência', 'ok', `Faixa ${px(faixa.baixo)} – ${px(faixa.alto)}.`));

  // 2 — Seek & Destroy: o extremo da faixa foi passado, e a vela mais extrema
  // fechou de volta dentro dela.
  const desde = primeiraDesde(velas, rc.validaDe);
  const nivel = d === 'bullish' ? faixa.baixo : faixa.alto;
  let extremo = nivel;
  let iExtremo = -1;
  for (let k = desde; k <= i; k++) {
    const c = velas[k]!;
    if (d === 'bullish' ? c.low < extremo : c.high > extremo) {
      extremo = d === 'bullish' ? c.low : c.high;
      iExtremo = k;
    }
  }
  if (iExtremo < 0) {
    passos.push(
      passo(2, tf, 'Seek & Destroy', 'espera', `A ${d === 'bullish' ? 'mínima' : 'máxima'} da faixa (${px(nivel)}) ainda não foi atacada.`),
    );
    return falha(M, passos, 'extremo da faixa por atacar');
  }
  const velaExtrema = velas[iExtremo]!;
  const voltou = d === 'bullish' ? velaExtrema.close > nivel : velaExtrema.close < nivel;
  if (!voltou) {
    passos.push(passo(2, tf, 'Seek & Destroy', 'falhou', 'A vela mais extrema fechou fora da faixa — é rompimento, não varrimento.'));
    return falha(M, passos, 'extremo da faixa rompido, não varrido');
  }
  passos.push(passo(2, tf, 'Seek & Destroy', 'ok', `Foi a ${px(extremo)}, além de ${px(nivel)}, e fechou de volta dentro.`));

  // 3 — Confirmação estrutural: CHoCH ou MSS no sentido da entrega
  const q = quebraApos(ctx.quebras, iExtremo, d, JANELA_QUEBRA, ['mss', 'choch']);
  if (!q || q.index > i) {
    passos.push(passo(3, tf, 'CHoCH', 'espera', 'Ainda em Seek & Destroy — não se entra aqui.'));
    return falha(M, passos, 'Seek & Destroy sem confirmação');
  }
  if (fechouAlem(velas, iExtremo, i, extremo, d)) {
    passos.push(passo(3, tf, 'Invalidação', 'falhou', 'Fecho para lá do extremo do Seek & Destroy.'));
    return falha(M, passos, 'setup invalidado');
  }
  passos.push(passo(3, tf, 'CHoCH', 'ok', `${q.tipo.toUpperCase()} de ${nomeLado(d)} em ${px(q.nivel)} — começou a entrega.`));

  // 4 — Entrada: FVG ou order block da entrega, por tocar, na metade certa
  const candidatos: PdArray[] = [
    ...arraysVivosEm(ctx.fvgs, i, d, i - iExtremo),
    ...arraysVivosEm(ctx.obs, i, d, i - iExtremo + 3),
  ].filter((a) => a.index >= iExtremo - 3 && !jaTocado(a, i));
  // O primeiro a ser tocado no regresso: o mais alto numa compra.
  candidatos.sort((a, b) => (d === 'bullish' ? b.alto - a.alto : a.baixo - b.baixo));
  const pd = candidatos.find((a) => zonaCorrecta(faixa, d === 'bullish' ? a.alto : a.baixo, d));
  if (!pd) {
    passos.push(passo(4, tf, 'PD array da entrega', 'espera', 'Nenhum FVG ou order block por tocar na metade certa da faixa.'));
    return falha(M, passos, 'sem PD array de entrada');
  }
  passos.push(passo(4, tf, 'PD array da entrega', 'ok', `${pd.rotulo} ${px(pd.baixo)} – ${px(pd.alto)}.`));

  // 5 — Stop e alvo
  return fecharSinal(ctx, passos, {
    modelo: M,
    direccao: d,
    tipoEntrada: 'pendente',
    entrada: d === 'bullish' ? pd.alto : pd.baixo,
    zonaAlta: pd.alto,
    zonaBaixa: pd.baixo,
    stop: extremo,
    rotuloStop: 'extremo do Seek & Destroy',
    alvos: [{ preco: d === 'bullish' ? faixa.alto : faixa.baixo, rotulo: 'extremo oposto da vela de referência' }],
    varrimento: null,
    quebra: q,
    pdArray: pd,
    chave: `crt|${rc.time}|${d}`,
  });
}
