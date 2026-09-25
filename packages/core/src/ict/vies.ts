/**
 * ICT ALGO — viés diário.
 *
 * "Before every session, answer these five questions in order." O site é
 * explícito em que esta é a decisão mais importante do dia, e igualmente
 * explícito em que se responde ANTES da sessão, com o que já fechou.
 *
 *   1  estrutura semanal      topos e fundos a subir ou a descer
 *   2  fecho do dia anterior  "a close in the upper half of the prior day's
 *                             range is a bullish signal for today"
 *   3  draw on liquidity      "the nearest one in the direction of the weekly
 *                             structure is the daily DOL"
 *   4  acumulação de stops    "which has the densest stop accumulation" entre
 *                             range asiático, máx/mín do dia e da semana
 *   5  PD array na zona certa "a PD array in the discount zone (for bullish
 *                             bias) or premium zone (for bearish bias)"
 *
 * ── O QUE ESTA FUNÇÃO NÃO FAZ ──────────────────────────────────────────────
 *
 * Não soma as cinco respostas num número e chama-lhe confiança. As cinco não são
 * independentes — a 1 e a 3 lêem a mesma estrutura, a 4 e a 5 lêem os mesmos
 * extremos — e somar coisas correlacionadas fabrica certeza. O que devolve é a
 * CONTAGEM e as respostas todas, para quem lê poder ver qual discordou.
 */

import type { Candle } from '../types/market.js';
import type { IctVies, PocaLiquidez, RespostaVies, Swing, ViesDiario } from './types.js';

import { tendenciaEm } from './estrutura.js';
import { drawOnLiquidity, pocasActivasEm } from './liquidez.js';

/** Pergunta 1 — estrutura semanal. */
function p1Semanal(swingsSemanais: readonly Swing[], iSemanal: number): RespostaVies {
  const t = tendenciaEm(swingsSemanais, iSemanal);
  return {
    pergunta: '1. A estrutura semanal é de alta ou de baixa?',
    resposta: t,
    detalhe:
      t === 'bullish'
        ? 'Topos e fundos semanais a subir.'
        : t === 'bearish'
          ? 'Topos e fundos semanais a descer.'
          : 'Topos e fundos semanais sem sentido único.',
  };
}

/** Pergunta 2 — onde fechou o dia anterior dentro do seu próprio intervalo. */
function p2FechoAnterior(diaAnterior: Candle | undefined): RespostaVies {
  if (!diaAnterior) {
    return { pergunta: '2. Onde fechou o dia anterior?', resposta: 'neutral', detalhe: 'Sem dia anterior.' };
  }
  const amplitude = diaAnterior.high - diaAnterior.low;
  if (!(amplitude > 0)) {
    return { pergunta: '2. Onde fechou o dia anterior?', resposta: 'neutral', detalhe: 'Dia sem amplitude.' };
  }
  const pos = (diaAnterior.close - diaAnterior.low) / amplitude;
  return {
    pergunta: '2. Onde fechou o dia anterior?',
    resposta: pos > 0.5 ? 'bullish' : 'bearish',
    detalhe: `Fechou a ${(pos * 100).toFixed(0)}% do intervalo do dia — metade ${pos > 0.5 ? 'de cima' : 'de baixo'}.`,
  };
}

/** Pergunta 3 — qual a poça mais próxima no sentido da estrutura semanal. */
function p3Dol(dol: PocaLiquidez | null, sentido: IctVies): RespostaVies {
  if (!dol || sentido === 'neutral') {
    return {
      pergunta: '3. Qual é o draw on liquidity do dia?',
      resposta: 'neutral',
      detalhe: dol ? 'Sem estrutura semanal que dê sentido à escolha.' : 'Nenhuma poça por tomar no sentido da semana.',
    };
  }
  return {
    pergunta: '3. Qual é o draw on liquidity do dia?',
    resposta: sentido,
    detalhe: `${dol.rotulo} em ${dol.preco.toFixed(5)} — é o destino e o alvo.`,
  };
}

/** Pergunta 4 — onde estão mais stops empilhados. */
function p4Stops(pocas: readonly PocaLiquidez[], i: number, preco: number): RespostaVies {
  // `pocasActivasEm` conta como intacta uma poça varrida DEPOIS desta vela —
  // agora ainda estava lá. Filtrar só por `varridaEm === null` seria excluir
  // poças com base no futuro, o mesmo erro que aqui já custou um t=13 imaginário.
  const vis = pocasActivasEm(pocas, i);
  if (vis.length === 0) {
    return { pergunta: '4. Onde está a maior acumulação de stops?', resposta: 'neutral', detalhe: 'Sem poças por tomar.' };
  }
  // A mais densa: mais toques primeiro, e em caso de empate a mais próxima.
  const melhor = [...vis].sort(
    (a, b) => b.toques - a.toques || Math.abs(a.preco - preco) - Math.abs(b.preco - preco),
  )[0]!;
  return {
    pergunta: '4. Onde está a maior acumulação de stops?',
    // A liquidez atrai o preço: stops acima puxam para cima.
    resposta: melhor.lado === 'buy-side' ? 'bullish' : 'bearish',
    detalhe: `${melhor.rotulo} em ${melhor.preco.toFixed(5)} (${melhor.toques} ${melhor.toques === 1 ? 'toque' : 'toques'}).`,
  };
}

/** Pergunta 5 — o preço está do lado barato ou caro do intervalo diário. */
function p5Zona(velasDiarias: readonly Candle[], iDia: number, preco: number): RespostaVies {
  // Intervalo dos últimos 20 dias fechados: a faixa de referência do dia.
  const de = Math.max(0, iDia - 19);
  let alto = -Infinity;
  let baixo = Infinity;
  for (let k = de; k <= iDia; k++) {
    const c = velasDiarias[k];
    if (!c) continue;
    alto = Math.max(alto, c.high);
    baixo = Math.min(baixo, c.low);
  }
  if (!(alto > baixo)) {
    return { pergunta: '5. O preço está em discount ou em premium?', resposta: 'neutral', detalhe: 'Sem faixa diária.' };
  }
  const eq = (alto + baixo) / 2;
  const emDiscount = preco <= eq;
  return {
    pergunta: '5. O preço está em discount ou em premium?',
    // Em discount compra-se; em premium vende-se.
    resposta: emDiscount ? 'bullish' : 'bearish',
    detalhe: `${preco.toFixed(5)} está ${emDiscount ? 'abaixo' : 'acima'} do equilíbrio de 20 dias (${eq.toFixed(5)}).`,
  };
}

/**
 * O viés diário completo.
 *
 * `iDia` é o índice da última vela diária FECHADA, e `preco` o último fecho
 * conhecido no timeframe de execução. A direcção sai por maioria simples das
 * cinco; havendo empate, fica neutral — e neutral trava o algoritmo no estágio
 * 1, que é o comportamento desejado: sem viés não se opera.
 */
export function viesDiario(input: {
  velasDiarias: readonly Candle[];
  iDia: number;
  swingsSemanais: readonly Swing[];
  iSemanal: number;
  pocas: readonly PocaLiquidez[];
  iExecucao: number;
  preco: number;
}): ViesDiario {
  const { velasDiarias, iDia, swingsSemanais, iSemanal, pocas, iExecucao, preco } = input;

  const r1 = p1Semanal(swingsSemanais, iSemanal);
  const estruturaSemanal = r1.resposta;
  const dol =
    estruturaSemanal === 'neutral'
      ? null
      : drawOnLiquidity(pocas, iExecucao, preco, estruturaSemanal);

  const respostas = [
    r1,
    p2FechoAnterior(velasDiarias[iDia]),
    p3Dol(dol, estruturaSemanal),
    p4Stops(pocas, iExecucao, preco),
    p5Zona(velasDiarias, iDia, preco),
  ];

  const alta = respostas.filter((r) => r.resposta === 'bullish').length;
  const baixa = respostas.filter((r) => r.resposta === 'bearish').length;
  const direccao: IctVies = alta > baixa ? 'bullish' : baixa > alta ? 'bearish' : 'neutral';

  return {
    direccao,
    aFavor: direccao === 'bullish' ? alta : direccao === 'bearish' ? baixa : 0,
    contra: direccao === 'bullish' ? baixa : direccao === 'bearish' ? alta : 0,
    respostas,
    dol,
    estruturaSemanal,
  };
}
