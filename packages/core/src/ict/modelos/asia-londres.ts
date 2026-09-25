/**
 * ICT ALGO — modelo Asia Range · Londres (o modelo do journal do Agnaldo).
 *
 * O "Model # ASIA RANGE" do "Trader's Master Journal" (119 das 126 operações
 * registadas), com as regras das notas "Estudos do JPY" tal como foram fixadas
 * e medidas em `scripts/backtest/jpy-londres.mjs` — a "entrada 2", a da
 * confirmação, que foi a única com resultado positivo (+0,117R, t=1,1, 71
 * operações em 15M 2022+). Sem vantagem estatística provada: corre ao vivo para
 * os resultados reais decidirem.
 *
 *   1  Viés        a favor do viés diário; sem viés não se opera
 *   2  Ásia        a faixa das 00:00 às 08:00 de Londres
 *   3  Londres     entre as 08:00 e as 10:00 de Londres o par passa o extremo
 *                  asiático CONTRA o viés (numa compra, o mínimo)
 *   4  SMT         nesse intervalo o par correlacionado NÃO passa o seu extremo
 *                  asiático — "divergência entre GBPJPY e USDJPY"
 *   5  MSS         o primeiro fecho além do último swing confirmado antes do
 *                  extremo da manipulação. Entrada a mercado nesse fecho
 *   6  Alvo        o extremo OPOSTO da Ásia ("capturar a alta da sessão
 *                  asiática") ou o POI de Londres, o mais próximo que pague
 *                  pelo menos 2R
 *
 * Stop no extremo da manipulação. Um setup por dia e sentido. Nada às sextas.
 * Só em 15M (as operações do journal foram em 5M e 15M; a Deriv serve 15M ao
 * motor). O fecho às 10:00 de Londres coincide com o fim da killzone de
 * Londres do site, que `fecharSinal` verifica.
 */

import type { Candle } from '../../types/market.js';
import type { IctDireccao, PdArray, PocaLiquidez, QuebraEstrutura, ResultadoModelo, Varrimento } from '../types.js';
import { relogioLondres } from '../tempo.js';
import { faixaAsiaticaLondres, poiLondres } from '../poi.js';
import { type ContextoModelo, falha, fecharSinal, nomeLado, passo, px } from './comum.js';

const M = 'asia-londres' as const;
const INICIO_LONDRES = 8 * 60;
const FIM_JANELA = 10 * 60;

/** Aviso que acompanha todos os sinais deste modelo. */
export const AVISO_ASIA_LONDRES =
  'Modelo do journal, sem vantagem medida: no backtest 15M 2022+ a entrada na confirmação deu +0,12R por operação ' +
  '(t=1,1, 71 operações) com alvo a 3,5R; a versão com alvo na Ásia/POI ainda não foi medida.';

export function avaliarAsiaLondres(ctx: ContextoModelo, d: IctDireccao): ResultadoModelo {
  const { velas, i, vies } = ctx;
  const tf = ctx.timeframe;
  const passos = [];
  const alta = d === 'bullish';
  const agora = velas[i]!;

  if (tf !== '15m') {
    passos.push(passo(1, tf, 'Timeframe', 'espera', 'O modelo Asia Range corre em 15M.'));
    return falha(M, passos, 'só corre em 15M');
  }

  // 1 — Viés
  if (vies.direccao !== d) {
    passos.push(passo(1, '1d', 'Viés HTF', 'falhou', `O modelo trabalha a favor do viés diário, que não é de ${nomeLado(d)}.`));
    return falha(M, passos, 'contra ou sem viés diário');
  }
  passos.push(passo(1, '1d', 'Viés HTF', 'ok', `Viés de ${nomeLado(d)}, ${vies.aFavor} de 5.`));

  // Janela: a vela abre depois das 08:00 e FECHA antes das 10:00 de Londres — a
  // killzone de Londres do site acaba às 05:00 de Nova Iorque (= 10:00 de
  // Londres), exclusive, e é com ela que `fecharSinal` decide. O backtest
  // aceitava também a vela das 09:45; aqui não entra.
  const l = relogioLondres(agora.time);
  const passoMs = velas.length > 1 ? velas[1]!.time - velas[0]!.time : 900_000;
  if (l.diaSemana === 5) {
    passos.push(passo(2, 'tempo', 'Dia', 'falhou', 'Sexta-feira — as notas não operam às sextas.'));
    return falha(M, passos, 'sexta-feira');
  }
  if (l.minutos < INICIO_LONDRES || l.minutos + passoMs / 60_000 >= FIM_JANELA) {
    passos.push(passo(2, 'tempo', 'Abertura de Londres', 'espera', 'Fora das 08:00–10:00 de Londres.'));
    return falha(M, passos, 'fora da janela de Londres');
  }

  // 2 — Faixa asiática
  const asia = faixaAsiaticaLondres(velas, i);
  if (!asia) {
    passos.push(passo(2, tf, 'Faixa asiática', 'espera', 'Sem velas asiáticas suficientes hoje.'));
    return falha(M, passos, 'sem faixa asiática');
  }
  passos.push(passo(2, tf, 'Faixa asiática', 'ok', `${px(asia.baixo)} – ${px(asia.alto)} (00:00–08:00 de Londres).`));

  // 3 — Manipulação: o extremo asiático contra o viés foi passado desde as 08:00.
  const extremoAsia = alta ? asia.baixo : asia.alto;
  let iLon0 = -1;
  let extremo = alta ? Infinity : -Infinity;
  let iExtremo = -1;
  for (let k = asia.i1 + 1; k <= i; k++) {
    const c = velas[k]!;
    if (relogioLondres(c.time).minutos < INICIO_LONDRES) continue;
    if (iLon0 < 0) iLon0 = k;
    if (alta ? c.low < extremo : c.high > extremo) {
      extremo = alta ? c.low : c.high;
      iExtremo = k;
    }
  }
  const varreu = iExtremo >= 0 && (alta ? extremo < extremoAsia : extremo > extremoAsia);
  if (!varreu) {
    passos.push(
      passo(3, tf, 'Varrimento da Ásia', 'espera', `Londres ainda não passou a ${alta ? 'mínima' : 'máxima'} da Ásia (${px(extremoAsia)}).`),
    );
    return falha(M, passos, 'extremo asiático por varrer');
  }
  passos.push(passo(3, tf, 'Varrimento da Ásia', 'ok', `Pavio a ${px(extremo)}, além de ${px(extremoAsia)}.`));

  // 4 — SMT: o par não passou o seu extremo asiático, até agora.
  if (!ctx.par || ctx.par.velas.length < 30) {
    passos.push(passo(4, tf, 'Divergência SMT', 'espera', 'Sem par correlacionado — o modelo exige SMT.'));
    return falha(M, passos, 'sem par correlacionado para confirmar SMT');
  }
  const smt = smtAsiatico(ctx.par.velas, velas[asia.i0]!.time, velas[asia.i1]!.time, velas[iLon0]!.time, agora.time, alta);
  if (!smt.ha) {
    passos.push(passo(4, tf, 'Divergência SMT', 'falhou', `Contra ${ctx.par.simbolo}: ${smt.detalhe}.`));
    return falha(M, passos, 'sem divergência SMT na abertura de Londres');
  }
  passos.push(passo(4, tf, 'Divergência SMT', 'ok', `Contra ${ctx.par.simbolo}: ${smt.detalhe}.`));

  // 5 — MSS: primeiro fecho além do último swing confirmado antes do extremo.
  if (i <= iExtremo) {
    passos.push(passo(5, tf, 'MSS', 'espera', 'A manipulação ainda está a fazer o extremo.'));
    return falha(M, passos, 'sem MSS depois do varrimento');
  }
  let nivel: number | null = null;
  for (let s = ctx.swings.length - 1; s >= 0; s--) {
    const w = ctx.swings[s]!;
    if (w.index >= iExtremo || w.confirmadoEm > i) continue;
    if (w.kind === (alta ? 'high' : 'low')) {
      nivel = w.price;
      break;
    }
  }
  if (nivel === null) {
    passos.push(passo(5, tf, 'MSS', 'espera', 'Sem swing confirmado antes do extremo para quebrar.'));
    return falha(M, passos, 'sem swing para o MSS');
  }
  const alem = (c: Candle) => (alta ? c.close > nivel! : c.close < nivel!);
  if (!alem(agora)) {
    passos.push(passo(5, tf, 'MSS', 'espera', `Ainda sem fecho ${alta ? 'acima' : 'abaixo'} de ${px(nivel)}.`));
    return falha(M, passos, 'à espera do MSS');
  }
  for (let k = iExtremo + 1; k < i; k++) {
    if (alem(velas[k]!)) {
      passos.push(passo(5, tf, 'MSS', 'falhou', 'O MSS já tinha acontecido numa vela anterior — a entrada já foi dada.'));
      return falha(M, passos, 'MSS já usado');
    }
  }
  const atr = ctx.atr[i] ?? 0;
  const deslocamento = atr > 0 ? Math.abs(agora.close - agora.open) / atr : 0;
  passos.push(passo(5, tf, 'MSS', 'ok', `Fecho em ${px(agora.close)}, além de ${px(nivel)}.`));

  // 6 — Alvo: extremo oposto da Ásia ou POI de Londres.
  const oposto = alta ? asia.alto : asia.baixo;
  const poi = poiLondres({
    velas,
    i,
    direccao: d,
    referencia: alta ? Math.max(oposto, agora.close) : Math.min(oposto, agora.close),
    pocas: ctx.pocas,
    pdArrays: [...ctx.obs, ...ctx.fvgs, ...ctx.breakers],
  });

  const pocaAsia: PocaLiquidez = {
    index: alta ? asia.iBaixo : asia.iAlto,
    confirmadoEm: asia.i1,
    time: velas[alta ? asia.iBaixo : asia.iAlto]!.time,
    lado: alta ? 'sell-side' : 'buy-side',
    preco: extremoAsia,
    origem: 'range-asiatico',
    toques: 1,
    rotulo: alta ? 'mínima da Ásia' : 'máxima da Ásia',
    varridaEm: iExtremo,
    substituidaEm: null,
  };
  const varrimento: Varrimento = {
    index: iExtremo,
    confirmadoEm: iExtremo,
    time: velas[iExtremo]!.time,
    lado: d,
    poca: pocaAsia,
    extremo,
    penetracaoAtr: atr > 0 ? Math.abs(extremo - extremoAsia) / atr : 0,
  };
  const quebra: QuebraEstrutura = {
    index: i,
    confirmadoEm: i,
    time: agora.time,
    tipo: 'mss',
    lado: d,
    nivel,
    fecho: agora.close,
    deslocamentoAtr: deslocamento,
  };
  // A zona de entrada é o corpo da vela do MSS: a entrada é a mercado, no fecho.
  const zona: PdArray = {
    index: i,
    confirmadoEm: i,
    time: agora.time,
    tipo: 'order-block',
    lado: d,
    alto: Math.max(agora.open, agora.close),
    baixo: Math.min(agora.open, agora.close),
    mitigadoEm: null,
    tocadoEm: null,
    rotulo: 'vela do MSS',
  };

  return fecharSinal(ctx, passos, {
    modelo: M,
    direccao: d,
    tipoEntrada: 'mercado',
    entrada: agora.close,
    zonaAlta: zona.alto,
    zonaBaixa: zona.baixo,
    stop: extremo,
    rotuloStop: 'extremo da manipulação de Londres',
    alvos: [
      { preco: oposto, rotulo: alta ? 'máxima da Ásia' : 'mínima da Ásia' },
      ...(poi ? [{ preco: poi.preco, rotulo: `POI de Londres · ${poi.rotulo}` }] : []),
    ],
    varrimento,
    quebra,
    pdArray: zona,
    chave: `asia-londres|${asia.dia}|${d}`,
    avisos: [AVISO_ASIA_LONDRES],
  });
}

/**
 * SMT na abertura de Londres: o par correlacionado passou o SEU extremo
 * asiático entre o início de Londres e agora? Se não passou, há divergência.
 * Só lê velas do par até `ate` — o mesmo instante da vela a decidir.
 */
function smtAsiatico(
  par: readonly Candle[],
  asiaDe: number,
  asiaAte: number,
  londresDe: number,
  ate: number,
  alta: boolean,
): { ha: boolean; detalhe: string } {
  let alto = -Infinity;
  let baixo = Infinity;
  let nAsia = 0;
  let extremo = alta ? Infinity : -Infinity;
  let nLondres = 0;
  let lo = 0;
  let hi = par.length;
  while (lo < hi) {
    const meio = (lo + hi) >> 1;
    if (par[meio]!.time < asiaDe) lo = meio + 1;
    else hi = meio;
  }
  for (let k = lo; k < par.length; k++) {
    const c = par[k]!;
    if (c.time > ate) break;
    if (c.time <= asiaAte) {
      alto = Math.max(alto, c.high);
      baixo = Math.min(baixo, c.low);
      nAsia++;
    } else if (c.time >= londresDe) {
      extremo = alta ? Math.min(extremo, c.low) : Math.max(extremo, c.high);
      nLondres++;
    }
  }
  if (nAsia < 8 || nLondres === 0) return { ha: false, detalhe: 'sem velas alinhadas do par na Ásia e em Londres' };
  const passou = alta ? extremo < baixo : extremo > alto;
  return passou
    ? { ha: false, detalhe: `também passou a sua ${alta ? 'mínima' : 'máxima'} da Ásia — não há divergência` }
    : { ha: true, detalhe: `não passou a sua ${alta ? 'mínima' : 'máxima'} da Ásia (${px(alta ? baixo : alto)})` };
}
