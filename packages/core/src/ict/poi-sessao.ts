/**
 * POI de sessão — os pontos de interesse do setup Asia Range do journal, para
 * ALERTAS (não para sinais).
 *
 * O Agnaldo marcava, em 15M, os topos e fundos de sessões anteriores (2–3 dias)
 * que o preço ainda não tinha voltado a tocar: a vela do extremo, do pavio ao
 * corpo (os retângulos roxo/azul dos prints, cinzentos no Notion). Depois da
 * Ásia, na janela de Londres antes da sobreposição com Nova Iorque, o preço às
 * vezes vai a um deles; aí procurava a reversão em 1M (MSS + OB), a favor da
 * estrutura de mercado, com o alvo na liquidez do lado oposto.
 *
 * Medido em `scripts/backtest/asia-range-poi.mjs` (26/09/2026): as regras
 * mecânicas de entrada não tiveram vantagem. O que fica é a parte que a máquina
 * faz bem — marcar os POI e avisar quando o preço lá chega — e a decisão fica
 * com quem opera. As regras dos POI são as do backtest:
 *
 *   · swings de 15M com 8 velas (2 h) de cada lado, dos 3 dias de negociação
 *     anteriores, por tocar às 08:00 de Londres;
 *   · zona: topo → [max(abertura, fecho), máximo]; fundo → [mínimo,
 *     min(abertura, fecho)];
 *   · viés: o lado da última quebra de estrutura de 15M (BOS/CHoCH/MSS)
 *     confirmada até às 08:00. Baixa → POI acima do preço (vendas); alta →
 *     POI abaixo (compras);
 *   · janela: 08:00–11:00 de Londres.
 *
 * PUREZA: sem rede nem relógio — o instante vem de quem chama.
 */

import type { Candle } from '../types/market.js';
import type { IctDireccao, QuebraEstrutura } from './types.js';
import { quebrasDeEstrutura, serieAtrIct, swingsConfirmados } from './estrutura.js';
import { relogioLondres, ultimaFechadaAte } from './tempo.js';
import { diaLondres } from './poi.js';

const M15 = 900_000;
const MIN = 60_000;
/** Velas de 15M de cada lado para um topo/fundo contar como POI. */
export const LOOKBACK_POI = 8;
/** Dias de negociação para trás onde se procuram POI. */
export const DIAS_POI = 3;
/** Janela dos alertas, em minutos de Londres: 08:00–11:00. */
export const JANELA_POI = { de: 8 * 60, ate: 11 * 60 } as const;
/** Um POI deixa de valer se o preço o passar em mais de ½ ATR de 15M. */
export const INVALIDA_POI_ATR = 0.5;

export interface ZonaPoi {
  /** 'venda': um topo acima do preço; 'compra': um fundo abaixo. */
  lado: 'venda' | 'compra';
  baixo: number;
  alto: number;
  /** O pavio: o máximo do topo ou o mínimo do fundo. */
  extremo: number;
  /** Abertura da vela de 15M do extremo (ms). */
  origem: number;
  /** Identificador estável: dia de Londres, lado e extremo. */
  chave: string;
}

export interface LeituraPoi {
  /** Dia de Londres (dias desde 1970). */
  dia: number;
  /** 08:00 de Londres deste dia (ms). */
  inicio: number;
  /** 11:00 de Londres deste dia (ms). */
  fim: number;
  /** Antes das 08:00 a leitura é provisória: o viés e os POI ainda podem mudar. */
  provisoria: boolean;
  vies: IctDireccao;
  estrutura: { tipo: QuebraEstrutura['tipo']; nivel: number; time: number };
  asia: { alto: number; baixo: number; de: number; ate: number } | null;
  /** POI do lado do viés, à frente do preço, do mais próximo ao mais longe. */
  pois: ZonaPoi[];
  /** Liquidez do lado oposto por tomar (extremo da Ásia e topos/fundos), do mais próximo ao mais longe. */
  liquidezOposta: Array<{ preco: number; rotulo: string }>;
  /** Preço de referência (fecho da última vela de 15M fechada até às 08:00, ou até agora). */
  preco: number;
  atr: number;
}

/**
 * A leitura do dia de Londres em que cai `agora`. `v15`: velas FECHADAS de 15M,
 * com pelo menos ~4 dias (400 velas chegam; o viés e o ATR estabilizam melhor
 * com mais).
 */
export function poisDeSessao(v15: readonly Candle[], agora: number): LeituraPoi | null {
  if (v15.length < 120) return null;
  const l = relogioLondres(agora);
  const dia = diaLondres(agora);
  // 08:00 de Londres deste dia: o fuso de Londres é sempre um número inteiro de horas.
  const inicio = Math.floor(agora / MIN) * MIN - (l.minutos - JANELA_POI.de) * MIN;
  const fim = inicio + (JANELA_POI.ate - JANELA_POI.de) * MIN;
  const provisoria = agora < inicio;
  // A leitura é a das 08:00 — ou a de agora, se ainda não são 08:00.
  const j = ultimaFechadaAte(v15, M15, provisoria ? agora : inicio);
  if (j < 60) return null;

  const atrSerie = serieAtrIct(v15);
  const atr = atrSerie[j] ?? 0;
  if (!(atr > 0)) return null;

  // Viés: a última quebra de estrutura confirmada até j.
  const quebras = quebrasDeEstrutura(v15, swingsConfirmados(v15), atrSerie).filter((q) => q.confirmadoEm <= j);
  const q = quebras[quebras.length - 1];
  if (!q) return null;
  const venda = q.lado === 'bearish';

  // Ásia (00:00–08:00 de Londres) deste dia, em 15M.
  let asiaAlto = -Infinity;
  let asiaBaixo = Infinity;
  let asiaDe = Infinity;
  let asiaAte = -Infinity;
  for (let k = j; k >= 0; k--) {
    const c = v15[k]!;
    if (diaLondres(c.time) !== dia) {
      if (c.time < inicio - 24 * 3_600_000) break;
      continue;
    }
    if (relogioLondres(c.time).minutos >= JANELA_POI.de) continue;
    asiaAlto = Math.max(asiaAlto, c.high);
    asiaBaixo = Math.min(asiaBaixo, c.low);
    asiaDe = Math.min(asiaDe, c.time);
    asiaAte = Math.max(asiaAte, c.time + M15);
  }
  const asia = Number.isFinite(asiaAlto) ? { alto: asiaAlto, baixo: asiaBaixo, de: asiaDe, ate: asiaAte } : null;

  // Os 3 dias de negociação anteriores a este.
  const dias: number[] = [];
  for (let k = j; k >= 0 && dias.length < DIAS_POI + 1; k--) {
    const d = diaLondres(v15[k]!.time);
    if (d < dia && dias[dias.length - 1] !== d) dias.push(d);
  }
  if (dias.length < DIAS_POI) return null;
  const desdeDia = dias[DIAS_POI - 1]!;

  const tocadoAte = (idx: number, kind: 'high' | 'low', preco: number): boolean => {
    for (let k = idx + 1; k <= j; k++) {
      if (kind === 'high' ? v15[k]!.high >= preco : v15[k]!.low <= preco) return true;
    }
    return false;
  };

  const preco = v15[j]!.close;
  const pois: ZonaPoi[] = [];
  const opostos: Array<{ preco: number; rotulo: string }> = [];
  const swings = swingsConfirmados(v15, LOOKBACK_POI);
  for (let s = swings.length - 1; s >= 0; s--) {
    const w = swings[s]!;
    if (w.confirmadoEm > j) continue;
    const c = v15[w.index]!;
    const dw = diaLondres(c.time);
    if (dw < desdeDia) break;
    if (dw >= dia) continue;
    if (tocadoAte(w.index, w.kind, w.price)) continue;
    if (w.kind === 'high') {
      if (venda && Math.max(c.open, c.close) > preco) {
        pois.push({ lado: 'venda', baixo: Math.max(c.open, c.close), alto: c.high, extremo: c.high, origem: c.time, chave: `${dia}|venda|${c.high}` });
      } else if (!venda && c.high > preco) {
        opostos.push({ preco: c.high, rotulo: 'topo por tomar' });
      }
    } else if (!venda && Math.min(c.open, c.close) < preco) {
      pois.push({ lado: 'compra', baixo: c.low, alto: Math.min(c.open, c.close), extremo: c.low, origem: c.time, chave: `${dia}|compra|${c.low}` });
    } else if (venda && c.low < preco) {
      opostos.push({ preco: c.low, rotulo: 'fundo por tomar' });
    }
  }
  pois.sort((a, b) => (venda ? a.baixo - b.baixo : b.alto - a.alto));

  if (asia) {
    const op = venda ? asia.baixo : asia.alto;
    if (venda ? op < preco : op > preco) opostos.push({ preco: op, rotulo: venda ? 'mínimo da Ásia' : 'máximo da Ásia' });
  }
  opostos.sort((a, b) => (venda ? b.preco - a.preco : a.preco - b.preco));
  // Dois swings com o mesmo extremo são a mesma liquidez: um só nível.
  const liquidezOposta = opostos.filter((o, i) => i === 0 || o.preco !== opostos[i - 1]!.preco);
  // O mesmo para os POI com o mesmo extremo no mesmo dia.
  const unicos = pois.filter((z, i) => pois.findIndex((x) => x.chave === z.chave) === i);

  return {
    dia,
    inicio,
    fim,
    provisoria,
    vies: q.lado,
    estrutura: { tipo: q.tipo, nivel: q.nivel, time: q.time },
    asia,
    pois: unicos,
    liquidezOposta,
    preco,
    atr,
  };
}

export interface ToquePoi {
  zona: ZonaPoi;
  /** Abertura da vela que tocou primeiro (ms). */
  em: number;
  /** Preço do toque: a borda da zona. */
  preco: number;
  /** O extremo feito desde o toque, até à última vela dada. */
  extremoFeito: number;
  /** Passou o POI em mais de ½ ATR: já não é uma reacção no POI. */
  invalido: boolean;
}

/**
 * Os POI que o preço tocou entre as 08:00 e as 11:00 de Londres, com as velas
 * dadas (de qualquer timeframe; 1M para alertar cedo). Só lê velas até `agora`.
 */
export function toquesPoi(leitura: LeituraPoi, velas: readonly Candle[], agora: number): ToquePoi[] {
  const out: ToquePoi[] = [];
  for (const zona of leitura.pois) {
    const venda = zona.lado === 'venda';
    let toque: ToquePoi | null = null;
    for (const c of velas) {
      if (c.time < leitura.inicio || c.time >= leitura.fim || c.time > agora) continue;
      if (!toque) {
        if (venda ? c.high >= zona.baixo : c.low <= zona.alto) {
          toque = { zona, em: c.time, preco: venda ? zona.baixo : zona.alto, extremoFeito: venda ? c.high : c.low, invalido: false };
        } else continue;
      } else {
        toque.extremoFeito = venda ? Math.max(toque.extremoFeito, c.high) : Math.min(toque.extremoFeito, c.low);
      }
      if (venda ? toque.extremoFeito > zona.extremo + INVALIDA_POI_ATR * leitura.atr : toque.extremoFeito < zona.extremo - INVALIDA_POI_ATR * leitura.atr) {
        toque.invalido = true;
      }
    }
    if (toque) out.push(toque);
  }
  return out;
}

export interface PlanoPoi {
  direccao: 'compra' | 'venda';
  /** Possível entrada: o meio da zona do POI (50%). */
  entrada: number;
  /** Além do extremo do POI, a pelo menos ¼ de ATR de 15M da entrada. */
  stop: number;
  /** A primeira liquidez oposta que pague ≥ 2R; se nenhuma pagar, a mais longe (com o R que dá). */
  alvo: { preco: number; rotulo: string; r: number } | null;
}

/** O R mínimo do alvo de referência de um POI. */
export const RR_ALVO_POI = 2;
/** Distância mínima do stop à entrada, em ATR de 15M. */
export const RISCO_MINIMO_POI_ATR = 0.25;

/**
 * Um plano de REFERÊNCIA para um POI — para o alerta dizer compra/venda, uma
 * possível entrada e um alvo. Não é o plano de uma regra medida: a entrada real
 * (reversão em 1M, MSS + OB) é decisão de quem opera.
 */
export function planoPoi(zona: ZonaPoi, liquidez: ReadonlyArray<{ preco: number; rotulo: string }>, atr: number): PlanoPoi {
  const venda = zona.lado === 'venda';
  const entrada = (zona.baixo + zona.alto) / 2;
  const stop = venda
    ? Math.max(zona.extremo, entrada + RISCO_MINIMO_POI_ATR * atr)
    : Math.min(zona.extremo, entrada - RISCO_MINIMO_POI_ATR * atr);
  const risco = Math.abs(entrada - stop);
  const niveis = liquidez
    .filter((l) => (venda ? l.preco < entrada : l.preco > entrada))
    .map((l) => ({ ...l, r: risco > 0 ? Math.abs(entrada - l.preco) / risco : 0 }))
    .sort((a, b) => (venda ? b.preco - a.preco : a.preco - b.preco));
  const alvo = niveis.find((l) => l.r >= RR_ALVO_POI) ?? niveis[niveis.length - 1] ?? null;
  return { direccao: zona.lado, entrada, stop, alvo };
}

// ---------------------------------------------------------------------------
// O tiro no POI — a entrada do Asia Range (29/09/2026)
// ---------------------------------------------------------------------------

/**
 * A entrada do setup do journal, tal como o Agnaldo a descreveu e como foi
 * medida em `scripts/backtest/asia-range-poi.mjs` (versão A):
 *
 *   toque   o preço entra num POI do dia na janela de Londres (08:00–11:00)
 *   MSS     reversão em 1M: o primeiro fecho de 1M além do último swing de 1M
 *           (2 velas de cada lado) do lado oposto, confirmado antes do extremo
 *           feito no POI. Entrada no fecho dessa vela
 *   stop    além do POI: o mais afastado entre o extremo da zona e o extremo
 *           que o preço fez; pelo menos ¼ de ATR de 15M
 *   alvo    a liquidez do lado oposto por tomar — o extremo oposto da Ásia ou
 *           um topo/fundo de 15M para lá dele — o mais próximo que pague 2R
 *
 * Um POI passado em mais de ½ ATR deixa de valer. O SMT não é condição (no
 * journal era confluência em metade das operações): mede-se e diz-se.
 *
 * O primeiro tiro do dia é o único. Só lê velas de 1M fechadas até `agora`.
 */
export interface TiroPoi {
  zona: ZonaPoi;
  /** Abertura da vela de 1M do MSS (ms). */
  time: number;
  entrada: number;
  stop: number;
  alvo: { preco: number; rotulo: string; r: number };
  /** O extremo feito no POI, e a abertura da vela de 1M que o fez. */
  extremo: number;
  extremoEm: number;
  /** Primeira vela de 1M que tocou o POI. */
  tocadoEm: number;
  /** O swing de 1M quebrado (o MSS). */
  nivelMss: number;
  /** O par correlacionado andou ao contrário das 08:00 ao extremo (SMT)? null = sem dados. */
  smt: boolean | null;
}

export interface LeituraTiroPoi {
  tiro: TiroPoi | null;
  estado: 'antes-da-janela' | 'sem-toque' | 'na-zona' | 'invalidado' | 'sem-alvo' | 'disparado';
  detalhe: string;
}

const HORA = 3_600_000;
const hhmm = (t: number): string => {
  const l = relogioLondres(t);
  return `${String(l.hora).padStart(2, '0')}:${String(l.minuto).padStart(2, '0')}`;
};
const px5 = (v: number): string => {
  const a = Math.abs(v);
  return v.toFixed(a >= 1000 ? 2 : a >= 10 ? 3 : 5);
};

export function tiroPoi(
  leitura: LeituraPoi,
  v1: readonly Candle[],
  agora: number,
  par?: readonly Candle[] | null,
): LeituraTiroPoi {
  const venda = leitura.vies === 'bearish';
  // Velas de 1M fechadas até agora, da janela e das 5 horas antes (os swings).
  const velas = v1.filter((c) => c.time >= leitura.inicio - 5 * HORA && c.time < leitura.fim && c.time + MIN <= agora);
  const k0 = velas.findIndex((c) => c.time >= leitura.inicio);
  if (k0 < 0) return { tiro: null, estado: 'antes-da-janela', detalhe: 'Londres ainda não abriu (08:00).' };
  const swings = swingsConfirmados(velas);
  // A liquidez do outro lado: o extremo oposto da Ásia, ou para lá dele.
  const asiaOposto = leitura.asia ? (venda ? leitura.asia.baixo : leitura.asia.alto) : null;
  const liquidez = leitura.liquidezOposta.filter((l) => asiaOposto === null || (venda ? l.preco <= asiaOposto : l.preco >= asiaOposto));

  const pois = leitura.pois.map((zona) => ({ zona, tocadoEm: -1, invalido: false, ext: venda ? -Infinity : Infinity, iExt: -1, avaliado: -1 }));
  let maxDesde = -Infinity;
  let minDesde = Infinity;
  let semAlvo: string | null = null;
  for (let q = k0; q < velas.length; q++) {
    const c = velas[q]!;
    maxDesde = Math.max(maxDesde, c.high);
    minDesde = Math.min(minDesde, c.low);
    for (const p of pois) {
      if (p.invalido) continue;
      if (p.tocadoEm < 0 && (venda ? c.high >= p.zona.baixo : c.low <= p.zona.alto)) p.tocadoEm = c.time;
      if (p.tocadoEm < 0) continue;
      if (venda ? c.high > p.ext : c.low < p.ext) {
        p.ext = venda ? c.high : c.low;
        p.iExt = q;
      }
      if (venda ? p.ext > p.zona.extremo + INVALIDA_POI_ATR * leitura.atr : p.ext < p.zona.extremo - INVALIDA_POI_ATR * leitura.atr) {
        p.invalido = true;
        continue;
      }
      if (q <= p.iExt || p.avaliado === p.iExt) continue;
      // O MSS: o último swing do lado oposto, confirmado, antes do extremo.
      let nivel: number | null = null;
      for (let s = swings.length - 1; s >= 0; s--) {
        const w = swings[s]!;
        if (w.index >= p.iExt || w.confirmadoEm > q) continue;
        if (w.kind === (venda ? 'low' : 'high')) {
          nivel = w.price;
          break;
        }
      }
      if (nivel === null || !(venda ? c.close < nivel : c.close > nivel)) continue;
      p.avaliado = p.iExt;
      const entrada = c.close;
      const stop = venda ? Math.max(p.zona.extremo, p.ext) : Math.min(p.zona.extremo, p.ext);
      const risco = venda ? stop - entrada : entrada - stop;
      if (!(risco >= RISCO_MINIMO_POI_ATR * leitura.atr)) continue;
      const alvos = liquidez
        // Por tomar: Londres ainda não lá chegou, e à frente da entrada.
        .filter((l) => (venda ? l.preco < minDesde && l.preco < entrada : l.preco > maxDesde && l.preco > entrada))
        .map((l) => ({ ...l, r: Math.abs(entrada - l.preco) / risco }))
        .filter((l) => l.r >= RR_ALVO_POI)
        .sort((a, b) => (venda ? b.preco - a.preco : a.preco - b.preco));
      const alvo = alvos[0];
      if (!alvo) {
        semAlvo = `MSS de 1M às ${hhmm(c.time)}, mas nenhuma liquidez por tomar paga ${RR_ALVO_POI}R`;
        continue;
      }
      // SMT (confluência): das 08:00 ao extremo, o par andou ao contrário?
      let smt: boolean | null = null;
      if (par && par.length > 0) {
        const tExt = velas[p.iExt]!.time;
        const pa = par.find((x) => x.time >= leitura.inicio);
        const pb = [...par].reverse().find((x) => x.time <= tExt);
        if (pa && pb && pb.time >= pa.time) {
          const nosso = velas[p.iExt]!.close - velas[k0]!.open;
          const dele = pb.close - pa.open;
          smt = Math.sign(nosso) !== 0 && Math.sign(dele) === -Math.sign(nosso);
        }
      }
      const tiro: TiroPoi = {
        zona: p.zona,
        time: c.time,
        entrada,
        stop,
        alvo,
        extremo: p.ext,
        extremoEm: velas[p.iExt]!.time,
        tocadoEm: p.tocadoEm,
        nivelMss: nivel,
        smt,
      };
      return {
        tiro,
        estado: 'disparado',
        detalhe:
          `POI de ${venda ? 'venda' : 'compra'} ${px5(p.zona.baixo)}–${px5(p.zona.alto)} tocado às ${hhmm(p.tocadoEm)}; ` +
          `MSS de 1M às ${hhmm(c.time)} (fecho além de ${px5(nivel)}); alvo ${alvo.rotulo} a ${alvo.r.toFixed(1)}R` +
          (smt === true ? '; SMT a favor' : smt === false ? '; sem SMT' : ''),
      };
    }
  }
  if (semAlvo) return { tiro: null, estado: 'sem-alvo', detalhe: semAlvo };
  const tocados = pois.filter((p) => p.tocadoEm >= 0);
  if (tocados.length === 0) return { tiro: null, estado: 'sem-toque', detalhe: 'O preço ainda não chegou a nenhum POI do dia.' };
  const vivos = tocados.filter((p) => !p.invalido);
  if (vivos.length === 0) return { tiro: null, estado: 'invalidado', detalhe: `O preço passou o POI em mais de ${INVALIDA_POI_ATR} ATR — deixou de valer.` };
  const p = vivos[0]!;
  return {
    tiro: null,
    estado: 'na-zona',
    detalhe: `No POI ${px5(p.zona.baixo)}–${px5(p.zona.alto)} desde as ${hhmm(p.tocadoEm)} — à espera do MSS de 1M.`,
  };
}
