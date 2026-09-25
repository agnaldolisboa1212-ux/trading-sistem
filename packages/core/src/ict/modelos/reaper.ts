/**
 * ICT ALGO — modelo Reaper IFVG.
 *
 * Um FVG rompido costuma inverter de papel (IFVG): o FVG de baixa atravessado
 * de baixo para cima passa a suporte. O Reaper é o caso em que esse rompimento
 * foi, ele próprio, a manipulação: "that initial bullish breach is itself the
 * manipulation — the Reaper IFVG then acts as resistance". O retalho compra o
 * "suporte"; o preço regressa à zona e cai por ela.
 *
 * O site dá um teste de três perguntas, e só com as três é Reaper:
 *
 *   1  "Did breach occur at BSL/SSL pool?" — o rompimento tomou liquidez
 *   2  "Did breach coincide with liquidity sweep/SMT divergence?" — houve um
 *      varrimento (pavio passa, corpo volta) logo a seguir
 *   3  "Was the breaching candle unusually large?" — corpo de deslocamento
 *
 * Entrada: "wait for price to retrace into the Reaper IFVG zone and show
 * rejection (candle closing in original FVG's delivery direction), then enter
 * at that rejection candle's close" — é o único modelo que entra A MERCADO.
 * Stop: além do limite da zona. Alvo: a liquidez mais próxima no sentido do FVG
 * original.
 *
 * A direcção da operação é a do FVG ORIGINAL, não a do IFVG: o Reaper diz que a
 * inversão era falsa.
 */

import type { IctDireccao, PdArray, ResultadoModelo } from '../types.js';
import { pocasActivasEm, drawOnLiquidity } from '../liquidez.js';
import { type ContextoModelo, falha, fecharSinal, nomeLado, passo, px, varrimentoRecente } from './comum.js';

/** Velas desde o rompimento em que o regresso à zona ainda conta. */
const JANELA_REGRESSO = 24;
/** Corpo mínimo, em ATR, para o rompimento ser "unusually large". */
const CORPO_GRANDE = 1.0;

export function avaliarReaper(ctx: ContextoModelo, d: IctDireccao): ResultadoModelo {
  const M = 'reaper-ifvg' as const;
  const { velas, i } = ctx;
  const tf = ctx.timeframe;
  const passos = [];
  const agora = velas[i]!;

  // FVG do lado da operação, rompidos (mitigados) há pouco — o candidato a Reaper.
  let lo = 0;
  let hi = ctx.fvgs.length;
  while (lo < hi) {
    const meio = (lo + hi) >> 1;
    if (ctx.fvgs[meio]!.index < i - JANELA_REGRESSO - 60) lo = meio + 1;
    else hi = meio;
  }
  const rompidos: PdArray[] = [];
  for (let k = lo; k < ctx.fvgs.length; k++) {
    const f = ctx.fvgs[k]!;
    if (f.index > i) break;
    if (f.lado !== d || f.mitigadoEm === null) continue;
    if (f.mitigadoEm >= i || i - f.mitigadoEm > JANELA_REGRESSO) continue;
    rompidos.push(f);
  }
  if (rompidos.length === 0) {
    passos.push(passo(1, tf, 'FVG rompido', 'espera', `Nenhum FVG de ${nomeLado(d)} rompido recentemente.`));
    return falha(M, passos, 'sem FVG rompido');
  }

  // Do mais recente para o mais antigo: o primeiro que passe as três perguntas.
  let ultimaRazao = '';
  for (let r = rompidos.length - 1; r >= 0; r--) {
    const f = rompidos[r]!;
    const m = f.mitigadoEm!;
    const quebra = velas[m]!;
    const atrM = ctx.atr[m] ?? 0;

    // P1 — o rompimento tomou liquidez do lado para onde rompeu
    const ladoCacado = d === 'bearish' ? 'buy-side' : 'sell-side';
    // `min(m + 2, i)`: uma poça tomada DEPOIS da vela actual ainda não o foi.
    const limite = Math.min(m + 2, i);
    const tomou = pocasActivasEm(ctx.pocas, Math.max(0, m - 3)).some(
      (p) => p.lado === ladoCacado && p.varridaEm !== null && p.varridaEm >= m - 2 && p.varridaEm <= limite,
    );
    // P2 — houve varrimento (pavio passa, corpo volta) em torno do rompimento
    const varreu = varrimentoRecente(ctx.varrimentos, Math.min(i, m + 3), d, 5, (v) => v.index >= m - 2);
    // P3 — vela de rompimento grande
    const corpo = atrM > 0 ? Math.abs(quebra.close - quebra.open) / atrM : 0;
    const grande = corpo >= CORPO_GRANDE;
    if (!(tomou && varreu && grande)) {
      ultimaRazao = `rompimento em ${px(f.baixo)} – ${px(f.alto)}: liquidez ${tomou ? 'sim' : 'não'}, varrimento ${varreu ? 'sim' : 'não'}, vela grande ${grande ? 'sim' : 'não'} (${corpo.toFixed(1)} ATR)`;
      continue;
    }

    // Regresso à zona com rejeição — e tem de ser o PRIMEIRO regresso.
    const tocou = (k: number) => (d === 'bearish' ? velas[k]!.low <= f.alto : velas[k]!.high >= f.baixo);
    let anterior = false;
    for (let k = m + 1; k < i; k++) if (tocou(k)) anterior = true;
    if (anterior) {
      ultimaRazao = 'o preço já tinha regressado à zona antes — a entrada já foi dada (ou a zona segurou)';
      continue;
    }
    const rejeitou =
      tocou(i) &&
      (d === 'bearish'
        ? agora.close < agora.open && agora.close < f.alto
        : agora.close > agora.open && agora.close > f.baixo);
    if (!rejeitou) {
      passos.push(
        passo(1, tf, 'Teste das três perguntas', 'ok', 'O rompimento tomou liquidez, coincidiu com um varrimento e foi feito por uma vela grande.'),
      );
      passos.push(passo(2, tf, 'Regresso e rejeição', 'espera', `À espera do regresso a ${px(f.baixo)} – ${px(f.alto)} com vela de ${nomeLado(d)}.`));
      return falha(M, passos, 'Reaper armado, à espera da rejeição');
    }

    passos.push(
      passo(1, tf, 'Teste das três perguntas', 'ok', `Liquidez tomada, varrimento e vela de ${corpo.toFixed(1)} ATR — é Reaper, não IFVG normal.`),
    );
    passos.push(passo(2, tf, 'Regresso e rejeição', 'ok', `Voltou a ${px(f.baixo)} – ${px(f.alto)} e fechou de ${nomeLado(d)} em ${px(agora.close)}.`));

    const dol = drawOnLiquidity(ctx.pocas, i, agora.close, d);
    return fecharSinal(ctx, passos, {
      modelo: M,
      direccao: d,
      tipoEntrada: 'mercado',
      entrada: agora.close,
      zonaAlta: f.alto,
      zonaBaixa: f.baixo,
      stop: d === 'bearish' ? f.alto : f.baixo,
      rotuloStop: 'limite da zona Reaper',
      alvos: dol ? [{ preco: dol.preco, rotulo: dol.rotulo }] : [],
      varrimento: varreu,
      quebra: null,
      pdArray: f,
      chave: `reaper-ifvg|${f.index}|${d}`,
    });
  }

  passos.push(passo(1, tf, 'Teste das três perguntas', 'falhou', `Nenhum rompimento passa as três: ${ultimaRazao}.`));
  return falha(M, passos, 'rompimento sem as três marcas de manipulação');
}
