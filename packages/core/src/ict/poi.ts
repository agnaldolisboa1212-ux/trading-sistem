/**
 * ICT ALGO — a faixa asiática em hora de Londres e o POI de Londres.
 *
 * ── DE ONDE VEM ────────────────────────────────────────────────────────────
 *
 * Do "Trader's Master Journal" do Agnaldo (export de 25/09/2026). Nos prints de
 * TradingView há sempre duas coisas marcadas ANTES da abertura de Londres:
 *
 *   · a caixa da Ásia (00:00–08:00 de Londres), cujos extremos Londres varre
 *   · um ponto de interesse À FRENTE — "SESSION HIGH", o máximo de uma sessão
 *     anterior, ou uma zona onde o preço já tinha reagido — para onde Londres
 *     vai depois de varrer a Ásia
 *
 * O `rangeAsiatico` de `tempo.ts` usa a killzone asiática do site (20:00–02:00
 * de Nova Iorque). Esta usa a do journal, que é a que foi medida em
 * `scripts/backtest/jpy-londres.mjs`.
 *
 * ── O POI, EM REGRA ────────────────────────────────────────────────────────
 *
 * Numa compra: o destino mais próximo ACIMA do máximo da Ásia (e do preço) —
 * uma poça buy-side ainda por tomar (máximo de sessão, dia anterior, máximos
 * iguais, swing) ou a base de um PD array de venda ainda não mitigado, onde o
 * preço tende a reagir. O espelho numa venda. Sem nada disso, não há POI.
 *
 * PUREZA: só lê velas até `i` e objectos com `confirmadoEm <= i`.
 */

import type { Candle } from '../types/market.js';
import type { IctDireccao, PdArray, PocaLiquidez } from './types.js';
import { drawOnLiquidity } from './liquidez.js';
import { relogioLondres } from './tempo.js';
import { smtPairsFor } from '../universe.js';

const DIA = 86_400_000;
/** Velas de 15M mínimas para a Ásia contar (metade das 32 de 8 horas). */
const MIN_VELAS_ASIA_15M = 16;

/** Dia de calendário de LONDRES a que o instante pertence (número de dias desde 1970). */
export function diaLondres(t: number): number {
  const l = relogioLondres(t);
  const d = new Date(t);
  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes();
  const desvio = (((l.minutos - utcMin) % 1440) + 1440) % 1440;
  return Math.floor((t + desvio * 60_000) / DIA);
}

export interface FaixaAsiatica {
  alto: number;
  baixo: number;
  iAlto: number;
  iBaixo: number;
  /** Índice da primeira vela da Ásia. */
  i0: number;
  /** Índice da última vela da Ásia. */
  i1: number;
  dia: number;
}

/**
 * A faixa asiática (00:00–08:00 de Londres) do dia de Londres da vela `i`.
 *
 * Null antes das 08:00 (a faixa ainda se está a formar) ou com poucas velas.
 */
export function faixaAsiaticaLondres(velas: readonly Candle[], i: number): FaixaAsiatica | null {
  const agora = velas[i];
  if (!agora) return null;
  if (relogioLondres(agora.time).minutos < 8 * 60) return null;
  const dia = diaLondres(agora.time);
  const passo = velas.length > 1 ? velas[1]!.time - velas[0]!.time : 0;
  let alto = -Infinity;
  let baixo = Infinity;
  let iAlto = -1;
  let iBaixo = -1;
  let i0 = -1;
  let i1 = -1;
  let n = 0;
  for (let k = i; k >= 0; k--) {
    const c = velas[k]!;
    if (agora.time - c.time > DIA) break;
    if (diaLondres(c.time) !== dia) continue;
    if (relogioLondres(c.time).minutos >= 8 * 60) continue;
    if (c.high > alto) {
      alto = c.high;
      iAlto = k;
    }
    if (c.low < baixo) {
      baixo = c.low;
      iBaixo = k;
    }
    if (i1 < 0) i1 = k;
    i0 = k;
    n++;
  }
  // O mínimo de velas escala com o timeframe: 16 em 15M, 4 em 1H.
  const minimo = passo > 0 ? Math.max(3, Math.round((MIN_VELAS_ASIA_15M * 900_000) / passo)) : MIN_VELAS_ASIA_15M;
  if (n < minimo) return null;
  return { alto, baixo, iAlto, iBaixo, i0, i1, dia };
}

export interface PoiLondres {
  /** Preço do POI: o nível (poça) ou a borda mais próxima da zona (PD array). */
  preco: number;
  /** Zona do POI; igual a `preco` nas duas pontas quando é uma poça. */
  alto: number;
  baixo: number;
  rotulo: string;
  origem: 'liquidez' | 'pd-array';
  /** Instante onde o POI nasceu, para o desenho começar aí. */
  desde: number;
}

/**
 * O ponto de interesse para onde Londres vai, a partir de `referencia` (o
 * extremo oposto da Ásia, ou o preço se já o passou).
 */
export function poiLondres(input: {
  velas: readonly Candle[];
  i: number;
  direccao: IctDireccao;
  referencia: number;
  pocas: readonly PocaLiquidez[];
  pdArrays: readonly PdArray[];
}): PoiLondres | null {
  const { velas, i, direccao, referencia, pocas, pdArrays } = input;
  const alta = direccao === 'bullish';
  const candidatos: PoiLondres[] = [];

  const poca = drawOnLiquidity(pocas, i, referencia, direccao);
  if (poca) {
    candidatos.push({
      preco: poca.preco,
      alto: poca.preco,
      baixo: poca.preco,
      rotulo: poca.rotulo,
      origem: 'liquidez',
      desde: poca.time,
    });
  }

  // PD array CONTRÁRIO à operação, à frente: numa compra, uma zona de venda acima.
  for (const a of pdArrays) {
    if (a.confirmadoEm > i || (a.mitigadoEm !== null && a.mitigadoEm <= i)) continue;
    if (a.lado === direccao) continue;
    const borda = alta ? a.baixo : a.alto;
    if (alta ? borda <= referencia : borda >= referencia) continue;
    candidatos.push({
      preco: borda,
      alto: a.alto,
      baixo: a.baixo,
      rotulo: a.rotulo,
      origem: 'pd-array',
      desde: velas[a.index]?.time ?? a.time,
    });
  }

  if (candidatos.length === 0) return null;
  candidatos.sort((x, y) => (alta ? x.preco - y.preco : y.preco - x.preco));
  return candidatos[0]!;
}

/**
 * Pares correlacionados para o SMT do ICT ALGO, por ordem de preferência.
 *
 * O `smtPairsFor` do universo MMXM não dá par ao GBPJPY nem ao EURJPY, e ao
 * USDJPY dá o DXY — que a Deriv não serve. Resultado: nos três pares que o
 * journal operou o SMT nunca podia ser verificado. As notas usam "a divergência
 * entre GBPJPY e USDJPY"; o EURJPY compara com o USDJPY (a mesma escolha do
 * `jpy-londres.mjs`). Quem chama fica com o primeiro que tiver dados.
 */
const PARES_DO_JOURNAL: Readonly<Record<string, readonly string[]>> = {
  GBPJPY: ['USDJPY'],
  USDJPY: ['GBPJPY'],
  EURJPY: ['USDJPY', 'GBPJPY'],
  // O USDCAD do journal: o DXY (a referência do universo) não existe na Deriv;
  // o USDCHF tem o mesmo dólar na base e anda no mesmo sentido.
  USDCAD: ['USDCHF'],
};

export function paresSmtIct(simbolo: string): string[] {
  const s = simbolo.toUpperCase();
  const lista = [...(PARES_DO_JOURNAL[s] ?? []), ...smtPairsFor(s).map((p) => p.reference)];
  return [...new Set(lista)];
}

/**
 * O stop para lá do POI de entrada — a zona de onde o preço reagiu.
 *
 * Pedido do Agnaldo (25/09/2026): "os stops devem ser abaixo da POI; a sniper
 * entry apenas é para ter confirmação". Os modelos punham o stop no próprio
 * extremo (varrido, do impulso, da zona) sem margem — um toque de spread
 * levava-o, mesmo com a zona de reacção intacta.
 *
 * Regra, igual para o ICT ALGO e o Asia Range Algo:
 *
 *   POI      a zona (OB, FVG, breaker) A FAVOR da operação, confirmada e não
 *            mitigada, que fica entre o stop do modelo e a entrada — ou que o
 *            cobre (numa compra: o seu topo está a menos de ½ ATR abaixo do stop)
 *   stop     para lá do fundo do POI mais fundo (numa compra; topo numa venda),
 *            com uma margem de 0,1 ATR, e nunca mais de 3 ATR além do stop do
 *            modelo; sem POI, o stop do modelo com a mesma margem
 */
export function stopAlemDoPoi(input: {
  direccao: IctDireccao;
  entrada: number;
  stop: number;
  zonas: readonly PdArray[];
  i: number;
  atr: number;
}): { stop: number; poi: PdArray | null } {
  const { direccao, entrada, stop, zonas, i } = input;
  const alta = direccao === 'bullish';
  const atr = input.atr > 0 ? input.atr : Math.abs(entrada - stop);
  const margem = 0.1 * atr;
  const limite = alta ? stop - 3 * atr : stop + 3 * atr;
  let poi: PdArray | null = null;
  for (const z of zonas) {
    if (z.lado !== direccao || z.confirmadoEm > i) continue;
    if (z.mitigadoEm !== null && z.mitigadoEm <= i) continue;
    const perto = alta
      ? z.baixo < entrada && z.alto >= stop - 0.5 * atr && z.baixo >= limite
      : z.alto > entrada && z.baixo <= stop + 0.5 * atr && z.alto <= limite;
    if (!perto) continue;
    if (!poi || (alta ? z.baixo < poi.baixo : z.alto > poi.alto)) poi = z;
  }
  const base = poi ? (alta ? Math.min(stop, poi.baixo) : Math.max(stop, poi.alto)) : stop;
  return { stop: alta ? base - margem : base + margem, poi };
}
