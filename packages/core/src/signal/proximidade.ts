/**
 * O que falta para cada regra disparar — o aviso de "fica atento".
 *
 * Um sinal é um instante; o que lhe chega antes é um caminho. Esta função lê as
 * mesmas velas que as estratégias lêem e responde à pergunta que a pessoa faz
 * quando não há sinais: *o que é que está quase a acontecer, e onde?*
 *
 * Duas regras de casa, para isto não virar horóscopo:
 *
 *   1. Cada condição em falta é dita com o NÚMERO que a satisfaz — "falta fechar
 *      acima de 4402,15", não "está a aproximar-se da resistência". Quem lê tem
 *      de poder pôr um alerta na corretora com o que está escrito.
 *   2. A distância mede-se em ATR, não em por cento, porque é assim que os
 *      instrumentos se comparam: 0,3 ATR no ouro e 0,3 ATR no EURJPY são a
 *      mesma proximidade real.
 *
 * PUREZA: sem rede nem relógio; só lê as velas FECHADAS que recebe.
 */

import type { Candle, Timeframe } from '../types/market.js';
import { atrSerie, emaSerie, rsiSerie } from '../strategies/contexto.js';
import { computeAnchoredVwap, vwapZScore } from '../strategies/vwap.js';
import {
  CONNORS_VALIDADO,
  CRIPTO_VALIDADA,
  INDICES_TENDENCIA,
  OURO_VALIDADO,
  ROMPIMENTO_VALIDADO,
  VWAP_VALIDADO,
  nomeDeEstrategia,
} from '../strategies/validadas.js';
import type { DadosExtra } from '../strategies/em-teste.js';

export interface Proximidade {
  estrategia: string;
  simbolo: string;
  timeframe: Timeframe;
  /** O que falta, em português e com o número que o satisfaz. */
  falta: string;
  /** O que acontece se acontecer — o plano provável, em uma linha. */
  entao: string;
  /** Distância à condição, em ATR. 0 = já está lá. */
  distanciaAtr: number;
  /** Condições que JÁ estão satisfeitas: dá contexto a quem lê. */
  jaTem: string[];
  /** O que trava o sinal mesmo que o preço chegue lá (regime contra, etc.). */
  trava: string | null;
}

const num = (v: number, casas: number) => v.toFixed(casas);

/** Média simples das últimas `p` velas fechadas. */
function media(velas: readonly Candle[], fim: number, p: number): number {
  if (fim + 1 < p) return Number.NaN;
  let s = 0;
  for (let k = fim - p + 1; k <= fim; k++) s += velas[k]!.close;
  return s / p;
}

function extremo(velas: readonly Candle[], de: number, ate: number, alto: boolean): number {
  let m = alto ? -Infinity : Infinity;
  for (let k = Math.max(0, de); k <= ate; k++) {
    m = alto ? Math.max(m, velas[k]!.high) : Math.min(m, velas[k]!.low);
  }
  return m;
}

/**
 * Quão perto está cada regra aplicável a este instrumento e timeframe.
 *
 * Devolve só as que fazem sentido avisar: as que já dispararam não entram (para
 * isso há o sinal), e as impossíveis por agora dizem-no em `trava`.
 */
export function proximidadeDosSinais(
  velas: readonly Candle[],
  ctx: { symbol: string; timeframe: Timeframe; casas?: number },
  extra: DadosExtra = {},
): Proximidade[] {
  const lista = velas as Candle[];
  const i = lista.length - 1;
  const u = lista[i];
  // Cada regra tem a sua exigência de história; a global é a menor delas.
  if (!u || lista.length < 60) return [];
  const casas = ctx.casas ?? 2;
  const atr = atrSerie(lista, 14)[i] ?? Number.NaN;
  if (!(atr > 0)) return [];
  const out: Proximidade[] = [];
  const base = { simbolo: ctx.symbol, timeframe: ctx.timeframe };

  // --- VWAP −2σ (índices e GBPUSD), 1h e 4h ---------------------------------
  if (VWAP_VALIDADO.includes(ctx.symbol) && (ctx.timeframe === '1h' || ctx.timeframe === '4h')) {
    const vwap = computeAnchoredVwap(lista, { anchor: 'month' });
    const p = vwap.points[vwap.points.length - 1];
    if (p && p.index === i && p.sigma > 0 && p.samples >= 15) {
      const gatilho = p.vwap - 2 * p.sigma;
      const z = vwapZScore(p, u.close);
      const rsi = rsiSerie(lista, 14)[i] ?? Number.NaN;
      const jaTem: string[] = [];
      if (rsi < 30) jaTem.push(`RSI ${rsi.toFixed(0)} (sobrevendido)`);
      if (p.sigma > 2 * atr) jaTem.push('volatilidade do mês acima de 2 ATR');
      // O regime é a condição que mais vezes trava esta regra.
      const d1 = extra.velas1d;
      let trava: string | null = null;
      if (!d1 || d1.length < 201) trava = 'sem velas diárias para confirmar o regime';
      else {
        let fim = -1;
        for (let k = d1.length - 1; k >= 0; k--) {
          if (d1[k]!.time < u.time) {
            fim = k;
            break;
          }
        }
        const m200 = fim >= 200 ? media(d1, fim, 200) : Number.NaN;
        if (!(fim >= 200)) trava = 'sem 200 dias de história';
        else if (!(d1[fim]!.close > m200)) {
          trava = `${ctx.symbol} está ABAIXO da média de 200 dias (${num(m200, casas)}) — a regra não compra aqui`;
        }
      }
      if (z > -2) {
        out.push({
          ...base,
          estrategia: 'compra-vwap-indices',
          falta: `fechar abaixo de ${num(gatilho, casas)} (−2σ do VWAP do mês; está a ${z.toFixed(1)}σ)`,
          entao: `compra ao fecho, stop ~${num(p.vwap - 3 * p.sigma, casas)}, metade em +1R e o resto em +2R`,
          distanciaAtr: Math.max(0, (u.close - gatilho) / atr),
          jaTem,
          trava,
        });
      }
    }
  }

  // --- Rompimento de 20 velas a favor da tendência, 4h -----------------------
  // A EMA 200 precisa de história a sério: sem ela o filtro de tendência mente.
  if (ROMPIMENTO_VALIDADO.includes(ctx.symbol) && ctx.timeframe === '4h' && lista.length >= 210) {
    const fechos = lista.map((c) => c.close);
    const e50 = emaSerie(fechos, 50)[i] ?? Number.NaN;
    const e200 = emaSerie(fechos, 200)[i] ?? Number.NaN;
    const maximo = extremo(lista, i - 20, i - 1, true);
    if (Number.isFinite(maximo) && u.close <= maximo) {
      const risco = 1.5 * atr;
      out.push({
        ...base,
        estrategia: 'rompimento-4h',
        falta: `fechar acima de ${num(maximo, casas)} (máximo das 20 velas)`,
        entao: `compra ao fecho, stop a 1,5 ATR (~${num(maximo - risco, casas)}), alvo +3R, sai em 24h`,
        distanciaAtr: (maximo - u.close) / atr,
        jaTem: e50 > e200 ? ['tendência a favor (EMA 50 acima da EMA 200)'] : [],
        trava: e50 > e200 ? null : 'EMA 50 abaixo da EMA 200 — a regra só compra a favor da tendência',
      });
    }
  }

  // --- RSI(2) de Connors, diário ---------------------------------------------
  if (CONNORS_VALIDADO.includes(ctx.symbol) && ctx.timeframe === '1d' && lista.length >= 201) {
    const rsi2 = rsiSerie(lista, 2)[i] ?? Number.NaN;
    const m200 = media(lista, i, 200);
    if (Number.isFinite(rsi2) && rsi2 >= 10) {
      out.push({
        ...base,
        estrategia: 'connors-rsi2-indices',
        falta: `o RSI(2) cair abaixo de 10 (está em ${rsi2.toFixed(0)})`,
        entao: 'compra ao fecho; sai no primeiro fecho acima da média de 5 dias',
        // Em RSI não há preço: a distância vem da queda típica de uma vela.
        distanciaAtr: Math.min(3, (rsi2 - 10) / 30),
        jaTem: u.close > m200 ? ['acima da média de 200 dias'] : [],
        trava:
          u.close > m200
            ? null
            : `${ctx.symbol} está abaixo da média de 200 dias (${num(m200, casas)}) — a regra não compra aqui`,
      });
    }
  }

  // --- Tendência de 55 dias (cripto, ouro, Nikkei), diário -------------------
  const tendencia =
    CRIPTO_VALIDADA.includes(ctx.symbol) || OURO_VALIDADO.includes(ctx.symbol) || INDICES_TENDENCIA.includes(ctx.symbol);
  if (tendencia && ctx.timeframe === '1d' && lista.length >= 56) {
    const maximo = extremo(lista, i - 55, i - 1, true);
    if (Number.isFinite(maximo) && u.close <= maximo) {
      out.push({
        ...base,
        estrategia: CRIPTO_VALIDADA.includes(ctx.symbol)
          ? 'tendencia-cripto'
          : OURO_VALIDADO.includes(ctx.symbol)
            ? 'tendencia-ouro'
            : 'tendencia-indices',
        falta: `fechar acima de ${num(maximo, casas)} (máximo dos 55 dias)`,
        entao: `compra ao fecho, stop a 2 ATR (~${num(maximo - 2 * atr, casas)}); depois segue o mínimo de 20 dias`,
        distanciaAtr: (maximo - u.close) / atr,
        jaTem: [],
        trava: null,
      });
    }
  }

  return out.filter((p) => Number.isFinite(p.distanciaAtr)).sort((a, b) => a.distanciaAtr - b.distanciaAtr);
}

/**
 * A frase que vai para o Telegram, por instrumento.
 *
 * Diz três coisas pela mesma ordem com que se pensa: onde estamos, o que falta,
 * e o que se faz se acontecer.
 */
export function frasesDeAtencao(p: Proximidade): { titulo: string; corpo: string } {
  const perto = p.distanciaAtr <= 0.25 ? 'muito perto' : p.distanciaAtr <= 0.75 ? 'perto' : 'a caminho';
  return {
    titulo: `${p.simbolo} ${p.timeframe} · ${perto} (${p.distanciaAtr.toFixed(2)} ATR)`,
    corpo:
      `Falta ${p.falta}.` +
      (p.jaTem.length > 0 ? ` Já tem: ${p.jaTem.join(', ')}.` : '') +
      (p.trava ? ` MAS: ${p.trava}.` : ` Se acontecer: ${p.entao}.`) +
      ` — ${nomeDeEstrategia(p.estrategia)}`,
  };
}
