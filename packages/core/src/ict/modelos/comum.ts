/**
 * ICT ALGO — o que todos os modelos partilham.
 *
 * Cada modelo do site tem a sua sequência própria (varrimento → SMT → MSS no
 * Venom, BOS → OTE no de continuação, breaker + FVG no Unicorn…), mas todos
 * acabam da mesma maneira: uma entrada, um stop estrutural, um alvo em
 * liquidez, dentro de uma killzone. Esse fim comum vive aqui, uma vez, para que
 * nenhum modelo o possa fazer de forma ligeiramente diferente dos outros.
 *
 * ── AS QUATRO VERIFICAÇÕES FINAIS ──────────────────────────────────────────
 *
 *   risco      o stop tem de estar a pelo menos RISCO_MINIMO_ATR do preço de
 *              entrada. Abaixo disso o spread come a operação antes de ela
 *              começar — foi o que matou os setups de 15M medidos antes.
 *   lado       uma ordem pendente só faz sentido com o preço ainda do lado
 *              certo da zona; se já lá está, chegou tarde.
 *   alvo       a liquidez mais PRÓXIMA no sentido da operação, e tem de pagar
 *              pelo menos RR_MINIMO. Não se escolhe um alvo mais longe para
 *              fazer o RR bater: "the nearest liquidity draw".
 *   tempo      dentro de uma killzone de Londres ou Nova Iorque.
 */

import type { Candle, Timeframe } from '../../types/market.js';
import { TIMEFRAME_MS } from '../../types/market.js';
import type {
  IctDireccao,
  LeituraRegime,
  ModeloIct,
  PassoTopDown,
  PdArray,
  PocaLiquidez,
  QuebraEstrutura,
  ResultadoModelo,
  SinalIct,
  Swing,
  Varrimento,
  ViesDiario,
} from '../types.js';
import type { VelaReferencia } from '../crt.js';
import { janelaDe, janelaPermiteEntrada } from '../tempo.js';

/** RR mínimo para um sinal sair. O site fala em "3:1 or better"; 2 é a fasquia mínima. */
export const RR_MINIMO = 2;
/** Distância mínima do stop, em ATR. */
export const RISCO_MINIMO_ATR = 0.25;
/** Velas depois do acontecimento em que a quebra estrutural ainda conta. */
export const JANELA_QUEBRA = 12;
/** Velas depois da quebra em que o primeiro FVG ainda conta. */
export const JANELA_FVG = 8;

/** Tudo o que um modelo pode ler numa vela. Tudo já calculado, nada novo. */
export interface ContextoModelo {
  simbolo: string;
  timeframe: Timeframe;
  velas: readonly Candle[];
  /** Vela FECHADA que está a ser avaliada. */
  i: number;
  atr: Float64Array;
  tendencias: Int8Array;
  vies: ViesDiario;
  regime: LeituraRegime;
  rc: VelaReferencia | null;
  swings: readonly Swing[];
  varrimentos: readonly Varrimento[];
  quebras: readonly QuebraEstrutura[];
  fvgs: readonly PdArray[];
  obs: readonly PdArray[];
  breakers: readonly PdArray[];
  pocas: readonly PocaLiquidez[];
  par: { simbolo: string; velas: readonly Candle[] } | null;
}

export type Avaliador = (ctx: ContextoModelo, direccao: IctDireccao) => ResultadoModelo;

export const passo = (
  numero: number,
  timeframe: Timeframe | 'tempo',
  titulo: string,
  veredicto: 'ok' | 'falhou' | 'espera',
  detalhe: string,
): PassoTopDown => ({ numero, timeframe, titulo, veredicto, detalhe });

export const falha = (modelo: ModeloIct, passos: PassoTopDown[], porqueNao: string): ResultadoModelo => ({
  modelo,
  sinal: null,
  passos,
  porqueNao,
});

export const nomeLado = (d: IctDireccao) => (d === 'bullish' ? 'alta' : 'baixa');
export const accao = (d: IctDireccao) => (d === 'bullish' ? 'compra' : 'venda');

/** Formata um preço com casas suficientes para qualquer instrumento. */
export function px(v: number): string {
  const a = Math.abs(v);
  const casas = a >= 1000 ? 2 : a >= 10 ? 3 : 5;
  return v.toFixed(casas);
}

/** O último varrimento conhecido em `i`, num lado, dentro de `maxVelas`. */
export function varrimentoRecente(
  vs: readonly Varrimento[],
  i: number,
  lado: IctDireccao,
  maxVelas: number,
  filtro: (v: Varrimento) => boolean = () => true,
): Varrimento | null {
  let lo = 0;
  let hi = vs.length;
  while (lo < hi) {
    const meio = (lo + hi) >> 1;
    if (vs[meio]!.index <= i) lo = meio + 1;
    else hi = meio;
  }
  for (let k = lo - 1; k >= 0; k--) {
    const v = vs[k]!;
    if (i - v.index > maxVelas) break;
    if (v.confirmadoEm > i || v.lado !== lado) continue;
    if (filtro(v)) return v;
  }
  return null;
}

/** Algum fecho entre `de` (exclusivo) e `ate` (inclusivo) passou do extremo? */
export function fechouAlem(
  velas: readonly Candle[],
  de: number,
  ate: number,
  extremo: number,
  lado: IctDireccao,
): boolean {
  for (let k = de + 1; k <= ate; k++) {
    const c = velas[k]!;
    if (lado === 'bullish' ? c.close < extremo : c.close > extremo) return true;
  }
  return false;
}

/** O PD array já foi tocado (a entrada já foi dada) até à vela `i`? */
export function jaTocado(a: PdArray, i: number): boolean {
  return a.tocadoEm !== null && a.tocadoEm <= i;
}

/** O PD array já foi mitigado (morto) até à vela `i`? */
export function jaMitigado(a: PdArray, i: number): boolean {
  return a.mitigadoEm !== null && a.mitigadoEm <= i;
}

export interface Alvo {
  preco: number;
  rotulo: string;
}

export interface PecasSinal {
  modelo: ModeloIct;
  direccao: IctDireccao;
  tipoEntrada: 'pendente' | 'mercado';
  entrada: number;
  zonaAlta: number;
  zonaBaixa: number;
  stop: number;
  rotuloStop: string;
  /** Candidatos a alvo; fica o mais próximo no sentido da operação. */
  alvos: Alvo[];
  varrimento: Varrimento | null;
  quebra: QuebraEstrutura | null;
  pdArray: PdArray;
  chave: string;
  avisos?: string[];
}

/**
 * O fim comum de todos os modelos: risco, lado, alvo e tempo.
 *
 * Recebe os passos já feitos pelo modelo e acrescenta os seus. Devolve o sinal
 * ou o primeiro passo que falhou — nunca um sinal com uma verificação saltada.
 */
export function fecharSinal(ctx: ContextoModelo, passos: PassoTopDown[], p: PecasSinal): ResultadoModelo {
  const { velas, i } = ctx;
  const agora = velas[i]!;
  const tf = ctx.timeframe;
  let n = passos.length + 1;
  const alta = p.direccao === 'bullish';
  const atr = ctx.atr[i] ?? 0;

  // ── Risco ─────────────────────────────────────────────────────────────────
  const risco = alta ? p.entrada - p.stop : p.stop - p.entrada;
  if (!(risco > 0)) {
    passos.push(passo(n, tf, 'Risco', 'falhou', 'Stop do lado errado da entrada — geometria impossível.'));
    return falha(p.modelo, passos, 'geometria de risco inválida');
  }
  if (atr > 0 && risco < RISCO_MINIMO_ATR * atr) {
    passos.push(
      passo(n, tf, 'Risco', 'falhou', `Stop a ${(risco / atr).toFixed(2)} ATR — tão curto que o spread come a operação.`),
    );
    return falha(p.modelo, passos, 'stop demasiado curto');
  }

  // ── Lado da ordem pendente ────────────────────────────────────────────────
  if (p.tipoEntrada === 'pendente') {
    const doLadoCerto = alta ? agora.close > p.entrada : agora.close < p.entrada;
    if (!doLadoCerto) {
      passos.push(passo(n, tf, 'Entrada', 'falhou', 'O preço já está na zona de entrada — a ordem pendente chegou tarde.'));
      return falha(p.modelo, passos, 'preço já dentro da zona de entrada');
    }
  }

  // ── Alvo: a liquidez mais próxima à frente ────────────────────────────────
  const validos = p.alvos.filter((a) => Number.isFinite(a.preco) && (alta ? a.preco > p.entrada : a.preco < p.entrada));
  if (validos.length === 0) {
    passos.push(passo(n, tf, 'Alvo', 'falhou', 'Não há liquidez por tomar à frente da entrada.'));
    return falha(p.modelo, passos, 'sem alvo à frente da entrada');
  }
  validos.sort((a, b) => (alta ? a.preco - b.preco : b.preco - a.preco));
  const alvo = validos[0]!;
  const rr = (alta ? alvo.preco - p.entrada : p.entrada - alvo.preco) / risco;
  if (rr < RR_MINIMO) {
    passos.push(
      passo(n, tf, 'Alvo', 'falhou', `${alvo.rotulo} em ${px(alvo.preco)} paga só ${rr.toFixed(1)}R — abaixo de ${RR_MINIMO}R.`),
    );
    return falha(p.modelo, passos, `RR insuficiente (${rr.toFixed(1)}R)`);
  }
  passos.push(passo(n++, tf, 'Alvo', 'ok', `${alvo.rotulo} em ${px(alvo.preco)} — ${rr.toFixed(1)}R.`));

  // ── Tempo ─────────────────────────────────────────────────────────────────
  // A decisão toma-se no FECHO da vela: é essa a hora que conta.
  const janela = janelaDe(agora.time + TIMEFRAME_MS[tf]);
  const hora = `${String(janela.horaNy).padStart(2, '0')}:${String(janela.minutoNy).padStart(2, '0')} NY`;
  if (!janelaPermiteEntrada(janela)) {
    passos.push(passo(n, 'tempo', 'Killzone', 'falhou', `${hora} — fora das killzones de Londres e Nova Iorque.`));
    return falha(p.modelo, passos, 'fora de killzone');
  }
  passos.push(passo(n, 'tempo', 'Killzone', 'ok', `${janela.killzones.join(', ')} — ${hora}.`));

  const avisos = [...(p.avisos ?? [])];
  if (janela.fase === 'manipulacao') {
    avisos.push('Ainda dentro da janela de manipulação de Londres: a entrega pode não ter começado.');
  }

  const sinal: SinalIct = {
    algoritmo: 'ICT ALGO',
    modelo: p.modelo,
    regime: ctx.regime.regime,
    simbolo: ctx.simbolo,
    timeframe: tf,
    direccao: p.direccao,
    chave: p.chave,
    index: i,
    time: agora.time,
    precoAnalise: agora.close,
    tipoEntrada: p.tipoEntrada,
    entrada: p.entrada,
    zonaEntradaAlta: p.zonaAlta,
    zonaEntradaBaixa: p.zonaBaixa,
    stop: p.stop,
    alvo: alvo.preco,
    rr,
    rotuloAlvo: alvo.rotulo,
    rotuloStop: p.rotuloStop,
    passos,
    varrimento: p.varrimento,
    quebra: p.quebra,
    pdArray: p.pdArray,
    vies: ctx.vies,
    janela,
    avisos,
  };
  return { modelo: p.modelo, sinal, passos, porqueNao: null };
}
