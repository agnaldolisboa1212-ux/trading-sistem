/**
 * ICT ALGO — modelo Silver Bullet.
 *
 * "A specific one-hour window where price reliably delivers a fair value gap
 * entry in the direction of the daily bias." Três janelas, em hora de Nova
 * Iorque: 03:00–04:00, 10:00–11:00 e 14:00–15:00.
 *
 *   1  Viés            a entrada é sempre no sentido do viés diário
 *   2  Janela          a vela está dentro de uma das três janelas
 *   3  Manipulação     "at the window's opening, price executes a sharp move
 *                      against the daily bias direction — sweeping stop orders"
 *   4  Deslocamento    "immediately after, price moves strongly with the daily
 *                      bias, leaving behind a Fair Value Gap"
 *   5  Entrada         "when price enters the FVG, that is the entry trigger" —
 *                      nunca no próprio deslocamento
 *   6  Stop / alvo     "below the sweep's extreme low" / "the nearest buy-side
 *                      liquidity draw for a long"
 *
 * Só existe em 15M ou menos. Em 1H a janela inteira é UMA vela: não há espaço
 * para varrimento, deslocamento e FVG caberem lá dentro, e fingir que cabem era
 * chamar Silver Bullet a outra coisa.
 */

import { TIMEFRAME_MS } from '../../types/market.js';
import type { IctDireccao, ResultadoModelo } from '../types.js';
import { MIN_DESLOCAMENTO } from '../estrutura.js';
import { primeiroFvgApos } from '../arrays.js';
import { drawOnLiquidity } from '../liquidez.js';
import { janelaSilverBullet } from '../tempo.js';
import {
  type ContextoModelo,
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

const HORA = 3_600_000;

export function avaliarSilverBullet(ctx: ContextoModelo, d: IctDireccao): ResultadoModelo {
  const M = 'silver-bullet' as const;
  const { velas, i, vies } = ctx;
  const tf = ctx.timeframe;
  const tfMs = TIMEFRAME_MS[tf];
  const passos = [];

  if (tfMs > 15 * 60_000) {
    passos.push(passo(1, tf, 'Timeframe', 'falhou', `O Silver Bullet é uma janela de uma hora — em ${tf.toUpperCase()} não cabe. Use 15M.`));
    return falha(M, passos, 'Silver Bullet só em 15M ou menos');
  }

  // 1 — Viés
  if (vies.direccao !== d) {
    passos.push(passo(1, '1d', 'Viés diário', 'falhou', `O Silver Bullet entra a favor do viés, que não é de ${nomeLado(d)}.`));
    return falha(M, passos, 'contra ou sem viés diário');
  }
  passos.push(passo(1, '1d', 'Viés diário', 'ok', `${nomeLado(d)}.`));

  // 2 — Janela
  const agora = velas[i]!;
  const janela = janelaSilverBullet(agora.time);
  if (!janela) {
    passos.push(passo(2, 'tempo', 'Janela Silver Bullet', 'espera', 'Fora das janelas 03–04, 10–11 e 14–15 de Nova Iorque.'));
    return falha(M, passos, 'fora da janela Silver Bullet');
  }
  // Início da janela: a primeira vela desta hora.
  const inicioJanela = agora.time - (agora.time % HORA);
  let iInicio = i;
  while (iInicio > 0 && velas[iInicio - 1]!.time >= inicioJanela) iInicio--;
  passos.push(passo(2, 'tempo', 'Janela Silver Bullet', 'ok', `Janela ${janela === 'londres' ? 'de Londres' : janela === 'ny-am' ? 'de Nova Iorque (manhã)' : 'de Nova Iorque (tarde)'}.`));

  // 3 — Manipulação: varrimento contra o viés, na abertura da janela (até uma
  // hora antes conta, porque é aí que a janela "abre" o movimento).
  const velasHora = Math.round(HORA / tfMs);
  const v = varrimentoRecente(ctx.varrimentos, i, d, i - iInicio + velasHora);
  if (!v) {
    passos.push(passo(3, tf, 'Manipulação', 'espera', 'A janela ainda não varreu liquidez contra o viés.'));
    return falha(M, passos, 'sem varrimento na abertura da janela');
  }
  if (fechouAlem(velas, v.index, i, v.extremo, d)) {
    passos.push(passo(3, tf, 'Manipulação', 'falhou', 'O extremo varrido foi ultrapassado em fecho.'));
    return falha(M, passos, 'varrimento invalidado');
  }
  passos.push(passo(3, tf, 'Manipulação', 'ok', `Varreu ${v.poca.rotulo} a ${px(v.extremo)}.`));

  // 4 — Deslocamento com FVG, dentro da janela, depois do varrimento
  const fvg = primeiroFvgApos(ctx.fvgs, Math.max(v.index, iInicio - 1), d, i - Math.max(v.index, iInicio - 1));
  if (!fvg || fvg.index > i || fvg.index < iInicio) {
    passos.push(passo(4, tf, 'Deslocamento + FVG', 'espera', 'O movimento a favor do viés ainda não deixou FVG dentro da janela.'));
    return falha(M, passos, 'sem FVG na janela');
  }
  const meio = velas[fvg.index - 1]!;
  const corpo = Math.abs(meio.close - meio.open) / (ctx.atr[fvg.index - 1] || Infinity);
  if (corpo < MIN_DESLOCAMENTO) {
    passos.push(passo(4, tf, 'Deslocamento + FVG', 'falhou', `O FVG nasceu de uma vela de ${corpo.toFixed(2)} ATR — não é deslocamento.`));
    return falha(M, passos, 'FVG sem deslocamento');
  }
  if (jaMitigado(fvg, i) || jaTocado(fvg, i)) {
    passos.push(passo(4, tf, 'Deslocamento + FVG', 'falhou', 'O preço já voltou a este FVG.'));
    return falha(M, passos, 'FVG já usado');
  }
  passos.push(passo(4, tf, 'Deslocamento + FVG', 'ok', `FVG ${px(fvg.baixo)} – ${px(fvg.alto)}, vela de ${corpo.toFixed(1)} ATR.`));

  // 5/6 — Entrada no regresso ao FVG; alvo na liquidez mais próxima
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
    rotuloStop: 'extremo varrido na abertura da janela',
    alvos: dol ? [{ preco: dol.preco, rotulo: dol.rotulo }] : [],
    varrimento: v,
    quebra: null,
    pdArray: fvg,
    chave: `silver-bullet|${fvg.index}|${d}`,
  });
}
