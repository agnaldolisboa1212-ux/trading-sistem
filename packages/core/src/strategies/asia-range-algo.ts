/**
 * Asia Range Algo — a estratégia do journal do Agnaldo, à parte do ICT ALGO.
 *
 * O "Model # ASIA RANGE" do "Trader's Master Journal" (119 das 126 operações
 * registadas), com as regras das notas "Estudos do JPY" tal como foram fixadas
 * e medidas em `scripts/backtest/jpy-londres.mjs` — a "entrada 2", a da
 * confirmação, a única com resultado positivo (+0,117R, t=1,1, 71 operações em
 * 15M 2022+). Sem vantagem estatística provada: corre ao vivo, EM TESTE, para
 * os resultados reais decidirem.
 *
 *   1  Viés        as cinco perguntas do viés diário (as do ICT ALGO); sem
 *                  viés não se opera
 *   2  Ásia        a faixa das 00:00 às 08:00 de Londres
 *   3  Londres     o par passa o extremo asiático CONTRA o viés (numa compra,
 *                  o mínimo), a partir das 08:00
 *   4  SMT         o par correlacionado NÃO passa o seu extremo asiático —
 *                  "divergência entre GBPJPY e USDJPY"
 *   5  MSS         o primeiro fecho além do último swing confirmado antes do
 *                  extremo da manipulação
 *   5b Confirmação CHoCH/MSS e estrutura de 3M a favor (as "sniper entries" do
 *                  journal); pode chegar até 45 min depois do MSS. Entrada a
 *                  mercado no fecho da vela de 15M em que fica confirmado
 *   6  Alvo        o extremo OPOSTO da Ásia ("capturar a alta da sessão
 *                  asiática") ou o POI de Londres, o mais próximo que pague 2R
 *
 * Stop para lá do POI de entrada que cobre o extremo da manipulação (ou do
 * próprio extremo), com margem de 0,1 ATR — `stopAlemDoPoi` — e a pelo menos
 * ¼ de ATR. A vela do MSS tem de
 * fechar antes das 10:00 de Londres — o fim da killzone de Londres. Um setup por
 * dia e sentido. Opera também às sextas (a pedido, 25/09/2026 — as notas
 * originais não operavam). Só 15M.
 *
 * Usa as PEÇAS do ICT ALGO (estruturas, viés, POI) como biblioteca, mas não é
 * um modelo dele: tem o seu nome, os seus sinais e a sua contabilidade.
 *
 * PUREZA: sem rede nem relógio; só lê velas fechadas até à última.
 */

import type { Candle } from '../types/market.js';
import { agregar } from '../ict/algo.js';
import { prepararEstruturas, type EstruturasIct } from '../ict/motor.js';
import { viesDiario } from '../ict/vies.js';
import { relogioLondres, ultimaFechadaAte } from '../ict/tempo.js';
import { confirmacaoLtf } from '../ict/confirmacao.js';
import { faixaAsiaticaLondres, poiLondres, stopAlemDoPoi, type FaixaAsiatica, type PoiLondres } from '../ict/poi.js';
import type { IctDireccao, PassoTopDown } from '../ict/types.js';

const DIA = 86_400_000;
const SEMANA = 7 * DIA;
const INICIO_LONDRES = 8 * 60;
const FIM_JANELA = 10 * 60;
/** O RR mínimo do ICT ALGO ("3:1 or better"; 2 é a fasquia). */
export const RR_MINIMO_ASIA = 2;
/** Distância mínima do stop, em ATR: abaixo disto o spread come a operação. */
const RISCO_MINIMO_ATR = 0.25;
const M15 = 900_000;
const M3 = 180_000;
/** Velas de 15M depois do MSS em que a confirmação de 3M ainda pode chegar (45 min). */
const ATRASO_MAXIMO = 3;

/** Aviso que acompanha todos os sinais desta estratégia. */
export const AVISO_ASIA_RANGE =
  'Estratégia do journal, sem vantagem medida: no backtest 15M 2022+ a entrada na confirmação deu +0,12R por operação ' +
  '(t=1,1, 71 operações) com alvo a 3,5R; a versão com alvo na Ásia/POI ainda não foi medida.';

export interface SinalAsiaRange {
  direccao: IctDireccao;
  /** Abertura da vela do MSS (ms). */
  time: number;
  index: number;
  entrada: number;
  stop: number;
  alvo: number;
  rr: number;
  rotuloAlvo: string;
  /** Zona de entrada: o corpo da vela do MSS. */
  zonaAlta: number;
  zonaBaixa: number;
  /** O varrimento: do extremo asiático (nível) ao pavio (extremo). */
  varrimento: { nivel: number; nivelTime: number; extremo: number; time: number };
  mss: { nivel: number; time: number };
  chave: string;
}

export interface AnaliseAsiaRange {
  simbolo: string;
  par: string | null;
  vies: { direccao: IctDireccao | 'neutral'; aFavor: number } | null;
  asia: (FaixaAsiatica & { de: number; ate: number }) | null;
  poi: PoiLondres | null;
  passos: PassoTopDown[];
  sinal: SinalAsiaRange | null;
  porqueNao: string | null;
}

const passo = (
  numero: number,
  timeframe: PassoTopDown['timeframe'],
  titulo: string,
  veredicto: PassoTopDown['veredicto'],
  detalhe: string,
): PassoTopDown => ({ numero, timeframe, titulo, veredicto, detalhe });

function px(v: number): string {
  const a = Math.abs(v);
  return v.toFixed(a >= 1000 ? 2 : a >= 10 ? 3 : 5);
}

/** As estruturas do ICT para a série de 15M. */
function estruturas(simbolo: string, velas: readonly Candle[], diarias: readonly Candle[], par: EntradaAsia['par']): EstruturasIct {
  return prepararEstruturas({
    simbolo,
    timeframe: '15m',
    velas,
    diarias,
    semanais: agregar(diarias, '1w'),
    referencia: diarias,
    timeframeReferencia: '1d',
    par,
  });
}

export interface EntradaAsia {
  simbolo: string;
  /** Velas FECHADAS de 15M. A decisão é na última. */
  velas: readonly Candle[];
  /** Velas diárias FECHADAS do próprio instrumento (viés). */
  diarias: readonly Candle[];
  par: { simbolo: string; velas: readonly Candle[] } | null;
  /** Velas FECHADAS de 3M do próprio instrumento: a confirmação. Sem elas não há sinal. */
  ltf?: readonly Candle[];
  /** Substitui o viés calculado — só para testes com cenários construídos. */
  viesForcado?: { direccao: IctDireccao; aFavor: number };
}

/**
 * A leitura completa na última vela: os passos, o sinal se houver, a faixa
 * asiática e o POI — para o motor, para o radar e para a aba do gráfico.
 */
export function analisarAsiaRange(input: EntradaAsia): AnaliseAsiaRange {
  const { simbolo, velas, diarias } = input;
  const base: AnaliseAsiaRange = {
    simbolo,
    par: input.par?.simbolo ?? null,
    vies: null,
    asia: null,
    poi: null,
    passos: [],
    sinal: null,
    porqueNao: null,
  };
  const acabar = (porque: string): AnaliseAsiaRange => ({ ...base, porqueNao: porque });
  if (velas.length < 120) return acabar(`Só ${velas.length} velas de 15M; são precisas 120.`);
  if (diarias.length < 45) return acabar('Sem velas diárias suficientes para o viés.');

  const e = estruturas(simbolo, velas, diarias, input.par);
  const i = velas.length - 1;
  const agora = velas[i]!;
  const passos = base.passos;

  // Faixa asiática e POI: desenham-se sempre, haja setup ou não.
  const asia = faixaAsiaticaLondres(velas, i);
  if (asia) base.asia = { ...asia, de: velas[asia.i0]!.time, ate: velas[asia.i1]!.time };

  // 1 — Viés
  const instante = agora.time + 900_000;
  const iDia = ultimaFechadaAte(e.diarias, DIA, instante);
  const iSem = ultimaFechadaAte(e.semanais, SEMANA, instante);
  if (iDia < 20 || iSem < 4) return acabar('História diária ou semanal insuficiente para o viés.');
  const vies =
    input.viesForcado ??
    viesDiario({
      velasDiarias: e.diarias,
      iDia,
      swingsSemanais: e.swingsSemanais,
      iSemanal: iSem,
      pocas: e.pocas,
      iExecucao: i,
      preco: agora.close,
    });
  base.vies = { direccao: vies.direccao, aFavor: vies.aFavor };
  if (vies.direccao === 'neutral') {
    passos.push(passo(1, '1d', 'Viés diário', 'falhou', 'Empate nas cinco perguntas — sem viés não se opera.'));
    return acabar('sem viés diário');
  }
  const d = vies.direccao;
  const alta = d === 'bullish';
  passos.push(passo(1, '1d', 'Viés diário', 'ok', `${alta ? 'Alta' : 'Baixa'}, ${vies.aFavor} de 5.`));

  if (asia) {
    const oposto = alta ? asia.alto : asia.baixo;
    base.poi = poiLondres({
      velas,
      i,
      direccao: d,
      referencia: alta ? Math.max(oposto, agora.close) : Math.min(oposto, agora.close),
      pocas: e.pocas,
      pdArrays: [...e.obs, ...e.fvgs, ...e.breakers],
    });
  }

  // 2 — Janela e faixa asiática
  const l = relogioLondres(agora.time);
  if (!asia) {
    passos.push(passo(2, '15m', 'Faixa asiática', 'espera', 'A Ásia (00:00–08:00 de Londres) ainda não acabou ou tem poucas velas.'));
    return acabar('sem faixa asiática');
  }
  passos.push(passo(2, '15m', 'Faixa asiática', 'ok', `${px(asia.baixo)} – ${px(asia.alto)} (00:00–08:00 de Londres).`));
  // A vela abre depois das 08:00 e FECHA antes das 10:00 de Londres (fim da killzone).
  if (l.minutos < INICIO_LONDRES || l.minutos + 15 >= FIM_JANELA) {
    passos.push(passo(3, 'tempo', 'Abertura de Londres', 'espera', 'Fora das 08:00–10:00 de Londres.'));
    return acabar('fora da janela de Londres');
  }

  // 3 — Manipulação
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
    passos.push(passo(3, '15m', 'Varrimento da Ásia', 'espera', `Londres ainda não passou a ${alta ? 'mínima' : 'máxima'} da Ásia (${px(extremoAsia)}).`));
    return acabar('extremo asiático por varrer');
  }
  passos.push(passo(3, '15m', 'Varrimento da Ásia', 'ok', `Pavio a ${px(extremo)}, além de ${px(extremoAsia)}.`));

  // 4 — SMT
  if (!input.par || input.par.velas.length < 30) {
    passos.push(passo(4, '15m', 'Divergência SMT', 'espera', 'Sem par correlacionado — a estratégia exige SMT.'));
    return acabar('sem par correlacionado para confirmar SMT');
  }
  const smt = smtAsiatico(input.par.velas, velas[asia.i0]!.time, velas[asia.i1]!.time, velas[iLon0]!.time, agora.time, alta);
  if (!smt.ha) {
    passos.push(passo(4, '15m', 'Divergência SMT', 'falhou', `Contra ${input.par.simbolo}: ${smt.detalhe}.`));
    return acabar('sem divergência SMT na abertura de Londres');
  }
  passos.push(passo(4, '15m', 'Divergência SMT', 'ok', `Contra ${input.par.simbolo}: ${smt.detalhe}.`));

  // 5 — MSS
  if (i <= iExtremo) {
    passos.push(passo(5, '15m', 'MSS', 'espera', 'A manipulação ainda está a fazer o extremo.'));
    return acabar('sem MSS depois do varrimento');
  }
  let nivel: number | null = null;
  for (let s = e.swings.length - 1; s >= 0; s--) {
    const w = e.swings[s]!;
    if (w.index >= iExtremo || w.confirmadoEm > i) continue;
    if (w.kind === (alta ? 'high' : 'low')) {
      nivel = w.price;
      break;
    }
  }
  if (nivel === null) {
    passos.push(passo(5, '15m', 'MSS', 'espera', 'Sem swing confirmado antes do extremo para quebrar.'));
    return acabar('sem swing para o MSS');
  }
  const alem = (c: Candle) => (alta ? c.close > nivel! : c.close < nivel!);
  let iMss = -1;
  for (let k = iExtremo + 1; k <= i; k++) {
    if (alem(velas[k]!)) {
      iMss = k;
      break;
    }
  }
  if (iMss < 0 || !alem(agora)) {
    passos.push(passo(5, '15m', 'MSS', 'espera', `Ainda sem fecho ${alta ? 'acima' : 'abaixo'} de ${px(nivel)}.`));
    return acabar('à espera do MSS');
  }
  passos.push(passo(5, '15m', 'MSS', 'ok', `Fecho em ${px(velas[iMss]!.close)}, além de ${px(nivel)}.`));

  // 6 — Confirmação em 3M (CHoCH/MSS e estrutura de 3M a favor). Pode chegar
  // até ATRASO_MAXIMO velas de 15M depois do MSS; o sinal sai na PRIMEIRA vela
  // em que está confirmado, e nunca outra vez.
  if (i - iMss > ATRASO_MAXIMO) {
    passos.push(passo(6, '3m', 'Confirmação 3M', 'falhou', 'A confirmação não chegou a tempo depois do MSS.'));
    return acabar('sem confirmação 3M a tempo');
  }
  const confEm = (k: number) => confirmacaoLtf(input.ltf, d, velas[k]!.time + M15, M3);
  for (let k = iMss; k < i; k++) {
    if (confEm(k).ok) {
      passos.push(passo(6, '3m', 'Confirmação 3M', 'falhou', 'Já confirmado numa vela anterior — a entrada já foi dada.'));
      return acabar('entrada já dada');
    }
  }
  const conf = confEm(i);
  if (!conf.ok) {
    passos.push(passo(6, '3m', 'Confirmação 3M', 'espera', `À espera: ${conf.detalhe}. Sem ela o sinal não é enviado.`));
    return acabar('à espera de confirmação 3M');
  }
  passos.push(passo(6, '3m', 'Confirmação 3M', 'ok', `${conf.detalhe}.`));

  // 6 — Risco e alvo
  // O stop vai para lá do POI de onde o preço reagiu (OB/FVG/breaker a favor
  // que cobre o extremo da manipulação); a confirmação de 3M só decide a entrada.
  const entrada = agora.close;
  const atr = e.atr[i] ?? 0;
  const alemDoPoi = stopAlemDoPoi({ direccao: d, entrada, stop: extremo, zonas: [...e.obs, ...e.fvgs, ...e.breakers], i, atr });
  const stop = alemDoPoi.stop;
  const risco = alta ? entrada - stop : stop - entrada;
  if (!(risco > 0) || (atr > 0 && risco < RISCO_MINIMO_ATR * atr)) {
    passos.push(passo(7, '15m', 'Risco', 'falhou', 'Stop demasiado curto — o spread come a operação.'));
    return acabar('stop demasiado curto');
  }
  const oposto = alta ? asia.alto : asia.baixo;
  const alvos = [
    { preco: oposto, rotulo: alta ? 'máxima da Ásia' : 'mínima da Ásia' },
    ...(base.poi ? [{ preco: base.poi.preco, rotulo: `POI de Londres · ${base.poi.rotulo}` }] : []),
  ]
    .filter((a) => (alta ? a.preco > entrada : a.preco < entrada))
    .sort((a, b) => (alta ? a.preco - b.preco : b.preco - a.preco));
  const alvo = alvos[0];
  if (!alvo) {
    passos.push(passo(7, '15m', 'Alvo', 'falhou', 'Não há liquidez por tomar à frente da entrada.'));
    return acabar('sem alvo à frente da entrada');
  }
  const rr = Math.abs(alvo.preco - entrada) / risco;
  if (rr < RR_MINIMO_ASIA) {
    passos.push(passo(7, '15m', 'Alvo', 'falhou', `${alvo.rotulo} em ${px(alvo.preco)} paga só ${rr.toFixed(1)}R — abaixo de ${RR_MINIMO_ASIA}R.`));
    return acabar(`RR insuficiente (${rr.toFixed(1)}R)`);
  }
  passos.push(passo(7, '15m', 'Alvo', 'ok', `${alvo.rotulo} em ${px(alvo.preco)} — ${rr.toFixed(1)}R.`));

  const iNivelAsia = alta ? asia.iBaixo : asia.iAlto;
  return {
    ...base,
    sinal: {
      direccao: d,
      time: agora.time,
      index: i,
      entrada,
      stop,
      alvo: alvo.preco,
      rr,
      rotuloAlvo: alvo.rotulo,
      zonaAlta: Math.max(agora.open, agora.close),
      zonaBaixa: Math.min(agora.open, agora.close),
      varrimento: { nivel: extremoAsia, nivelTime: velas[iNivelAsia]!.time, extremo, time: velas[iExtremo]!.time },
      mss: { nivel, time: velas[iMss]!.time },
      chave: `asia-range-algo|${asia.dia}|${d}`,
    },
  };
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
