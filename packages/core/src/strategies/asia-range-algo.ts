/**
 * Asia Range Algo — a estratégia do journal do Agnaldo (reescrita a 29/09/2026).
 *
 * A versão anterior exigia que Londres varresse o extremo da Ásia E que houvesse
 * SMT, com MSS de 15M e confirmação de 1M: deu 0 sinais nas duas semanas de
 * 14–25/09/2026 e 8 em 4,7 anos de backtest. O journal ("Trader's Master
 * Journal") tem 46 operações ASIA RANGE em 12 semanas seguidas (jul–set 2025),
 * ~4 por semana, e o Agnaldo descreveu-a assim (26/09/2026):
 *
 *   1  Estrutura  o viés é a estrutura de mercado de 15M — o lado da última
 *                 quebra (BOS/CHoCH/MSS) confirmada até às 08:00 de Londres
 *   2  POI        os topos e fundos de 15M dos 3 dias anteriores ainda por
 *                 tocar (as caixas roxas/cinzentas), do lado da estrutura: numa
 *                 venda acima do preço, numa compra abaixo
 *   3  Ásia       00:00–08:00 de Londres
 *   4  Janela     08:00–11:00 de Londres (antes da sobreposição com Nova Iorque)
 *   5  Toque      o preço entra num POI
 *   6  1M         a reversão em 1M no POI (MSS) — é o sinal
 *   7  Stop/alvo  além do POI; a liquidez oposta por tomar a pelo menos 2R
 *
 * O SMT é confluência (no journal, em metade das operações): diz-se, não trava.
 *
 * As peças são `poisDeSessao` e `tiroPoi` (ict/poi-sessao.ts) — as regras da
 * versão A de `scripts/backtest/asia-range-poi.mjs` (26/09/2026): 730 operações
 * em 2022+ em 8 pares, −0,16R por operação com custos (t=−2,1), ~0 sem custos.
 * Sem vantagem medida: sai como ALERTA (`SO_ALERTA`), a decisão é de quem opera.
 *
 * PUREZA: sem rede nem relógio; só lê velas fechadas até à última.
 */

import type { Candle } from '../types/market.js';
import { relogioLondres } from '../ict/tempo.js';
import { faixaAsiaticaLondres, type FaixaAsiatica, type PoiEntrada, type PoiLondres } from '../ict/poi.js';
import { poisDeSessao, tiroPoi, type LeituraPoi, type ZonaPoi } from '../ict/poi-sessao.js';
import type { IctDireccao, PassoTopDown } from '../ict/types.js';

const M15 = 900_000;
/** O RR mínimo do alvo (o do setup do journal). */
export const RR_MINIMO_ASIA = 2;

/** Aviso que acompanha todos os sinais desta estratégia. */
export const AVISO_ASIA_RANGE =
  'Setup do journal (POI de 15M + reversão em 1M), sem vantagem medida: no backtest 2022+ (730 operações em 8 pares) ' +
  'deu −0,16R por operação com custos e ~0 sem custos. É um alerta: a decisão é sua.';

export interface SinalAsiaRange {
  direccao: IctDireccao;
  /** Abertura da vela de 1M do MSS (ms). */
  time: number;
  /** Índice da vela de 15M em que o MSS de 1M aconteceu. */
  index: number;
  entrada: number;
  stop: number;
  alvo: number;
  rr: number;
  rotuloAlvo: string;
  /** Zona de entrada: o POI. */
  zonaAlta: number;
  zonaBaixa: number;
  /** Do POI (borda e vela de origem) ao extremo que o preço fez nele. */
  varrimento: { nivel: number; nivelTime: number; extremo: number; time: number };
  mss: { nivel: number; time: number };
  /** O par correlacionado andou ao contrário (confluência); null = sem dados. */
  smt?: boolean | null;
  chave: string;
}

export interface AnaliseAsiaRange {
  simbolo: string;
  par: string | null;
  /** A estrutura de 15M (aFavor: sempre 1 — um só voto, o da estrutura). */
  vies: { direccao: IctDireccao | 'neutral'; aFavor: number } | null;
  asia: (FaixaAsiatica & { de: number; ate: number }) | null;
  /** Os POI do dia, do lado da estrutura (as caixas do journal). */
  pois: ZonaPoi[];
  /** A quebra de estrutura de 15M que dá o viés. */
  estrutura: LeituraPoi['estrutura'] | null;
  /** Já não se usam (versão anterior); ficam para o desenho antigo não partir. */
  poi: PoiLondres | null;
  poiEntrada: PoiEntrada | null;
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
const hhmm = (t: number): string => {
  const l = relogioLondres(t);
  return `${String(l.hora).padStart(2, '0')}:${String(l.minuto).padStart(2, '0')}`;
};
const NOME_QUEBRA: Record<string, string> = { bos: 'BOS', choch: 'CHoCH', mss: 'MSS' };

export interface EntradaAsia {
  simbolo: string;
  /** Velas FECHADAS de 15M (pelo menos ~4 dias). A decisão é na última. */
  velas: readonly Candle[];
  /** Não se usa desde 29/09/2026 (o viés é a estrutura de 15M); fica por compatibilidade. */
  diarias?: readonly Candle[];
  /** Velas de 15M do par correlacionado: só para dizer se há SMT (confluência). */
  par: { simbolo: string; velas: readonly Candle[] } | null;
  /** Velas FECHADAS de 1M do próprio instrumento: a reversão. Sem elas não há sinal. */
  ltf?: readonly Candle[];
}

/**
 * A leitura completa na última vela de 15M: os passos, os POI, a Ásia e o sinal
 * se o MSS de 1M aconteceu dentro dela — para o motor, o radar e a aba do gráfico.
 */
export function analisarAsiaRange(input: EntradaAsia): AnaliseAsiaRange {
  const { simbolo, velas } = input;
  const base: AnaliseAsiaRange = {
    simbolo,
    par: input.par?.simbolo ?? null,
    vies: null,
    asia: null,
    pois: [],
    estrutura: null,
    poi: null,
    poiEntrada: null,
    passos: [],
    sinal: null,
    porqueNao: null,
  };
  const acabar = (porque: string): AnaliseAsiaRange => ({ ...base, porqueNao: porque });
  if (velas.length < 120) return acabar(`Só ${velas.length} velas de 15M; são precisas 120.`);

  const i = velas.length - 1;
  const agora = velas[i]!;
  const fecho = agora.time + M15;
  const passos = base.passos;

  const asia = faixaAsiaticaLondres(velas, i);
  if (asia) base.asia = { ...asia, de: velas[asia.i0]!.time, ate: velas[asia.i1]!.time };

  // 1 — Estrutura de 15M (o viés) e os POI do dia.
  const leitura = poisDeSessao(velas, fecho);
  if (!leitura) {
    passos.push(passo(1, '15m', 'Estrutura de 15M', 'espera', 'Sem quebra de estrutura de 15M, ou sem 3 dias de história para os POI.'));
    return acabar('sem estrutura de 15M para o viés');
  }
  const venda = leitura.vies === 'bearish';
  base.vies = { direccao: leitura.vies, aFavor: 1 };
  base.estrutura = leitura.estrutura;
  base.pois = leitura.pois;
  passos.push(
    passo(
      1,
      '15m',
      'Estrutura de 15M',
      'ok',
      `${NOME_QUEBRA[leitura.estrutura.tipo] ?? leitura.estrutura.tipo} de ${venda ? 'baixa' : 'alta'} em ${px(leitura.estrutura.nivel)} — ` +
        `só ${venda ? 'vendas em POI acima do preço' : 'compras em POI abaixo do preço'}.${leitura.provisoria ? ' Leitura provisória até às 08:00.' : ''}`,
    ),
  );

  // 2 — Ásia
  if (leitura.asia) {
    passos.push(passo(2, '15m', 'Ásia', 'ok', `${px(leitura.asia.baixo)} – ${px(leitura.asia.alto)} (00:00–08:00 de Londres).`));
  } else {
    passos.push(passo(2, '15m', 'Ásia', 'espera', 'Ainda sem velas da Ásia deste dia.'));
  }

  // 3 — POI
  if (leitura.pois.length === 0) {
    passos.push(passo(3, '15m', 'POI', 'falhou', `Nenhum ${venda ? 'topo' : 'fundo'} de 15M dos 3 dias anteriores por tocar do lado da estrutura.`));
    return acabar('sem POI por tocar do lado da estrutura');
  }
  const lista = leitura.pois
    .slice(0, 3)
    .map((z) => `${px(z.baixo)}–${px(z.alto)}`)
    .join(' · ');
  passos.push(passo(3, '15m', 'POI', 'ok', `${leitura.pois.length} ${venda ? 'topo(s)' : 'fundo(s)'} por tocar: ${lista}.`));

  // 4 — Janela de Londres
  if (fecho <= leitura.inicio) {
    passos.push(passo(4, 'tempo', 'Janela de Londres', 'espera', 'Antes das 08:00 — o viés e os POI ainda podem mudar.'));
    return acabar('antes da janela de Londres');
  }
  if (!input.ltf || input.ltf.length === 0) {
    passos.push(passo(4, '1m', 'Reversão em 1M', 'espera', 'Sem velas de 1M — sem a reversão em 1M não há sinal.'));
    return acabar('sem velas de 1M para a reversão');
  }
  const fechada = fecho >= leitura.fim;
  passos.push(passo(4, 'tempo', 'Janela de Londres', fechada ? 'espera' : 'ok', fechada ? '08:00–11:00 de Londres — já fechou.' : '08:00–11:00 de Londres.'));

  // 5 — Toque no POI e reversão em 1M
  const r = tiroPoi(leitura, input.ltf, fecho, input.par?.velas ?? null);
  if (!r.tiro) {
    const veredicto = r.estado === 'invalidado' || r.estado === 'sem-alvo' || fechada ? 'falhou' : 'espera';
    passos.push(passo(5, '1m', 'POI e reversão em 1M', veredicto, r.detalhe));
    const porque: Record<string, string> = {
      'antes-da-janela': 'antes da janela de Londres',
      'sem-toque': fechada ? 'Londres não chegou ao POI' : 'Londres ainda não chegou ao POI',
      'na-zona': fechada ? 'tocou o POI sem MSS de 1M' : 'no POI, à espera do MSS de 1M',
      invalidado: 'o preço passou o POI (invalidado)',
      'sem-alvo': `nenhum alvo paga ${RR_MINIMO_ASIA}R`,
    };
    return acabar(porque[r.estado] ?? r.detalhe);
  }
  const t = r.tiro;
  passos.push(passo(5, '1m', 'Toque no POI', 'ok', `${px(t.zona.baixo)}–${px(t.zona.alto)} às ${hhmm(t.tocadoEm)}; extremo ${px(t.extremo)} às ${hhmm(t.extremoEm)}.`));
  passos.push(passo(6, '1m', 'Reversão em 1M (MSS)', 'ok', `Fecho de 1M em ${px(t.entrada)} às ${hhmm(t.time)}, além do swing de ${px(t.nivelMss)}.`));
  passos.push(passo(7, '15m', 'Stop e alvo', 'ok', `Stop em ${px(t.stop)}, além do POI; alvo ${t.alvo.rotulo} em ${px(t.alvo.preco)} — ${t.alvo.r.toFixed(1)}R.`));
  passos.push(
    passo(
      8,
      '15m',
      'SMT (confluência)',
      t.smt ? 'ok' : 'espera',
      t.smt === true
        ? `${input.par?.simbolo} andou ao contrário até ao POI — divergência a favor.`
        : t.smt === false
          ? `Sem divergência com ${input.par?.simbolo} (não é condição).`
          : 'Sem par correlacionado para medir (não é condição).',
    ),
  );

  // A vela de 15M em que o MSS de 1M aconteceu.
  let k = i;
  while (k > 0 && velas[k]!.time > t.time) k--;
  return {
    ...base,
    sinal: {
      direccao: leitura.vies,
      time: t.time,
      index: k,
      entrada: t.entrada,
      stop: t.stop,
      alvo: t.alvo.preco,
      rr: t.alvo.r,
      rotuloAlvo: t.alvo.rotulo,
      zonaAlta: t.zona.alto,
      zonaBaixa: t.zona.baixo,
      varrimento: { nivel: venda ? t.zona.baixo : t.zona.alto, nivelTime: t.zona.origem, extremo: t.extremo, time: t.extremoEm },
      mss: { nivel: t.nivelMss, time: t.time },
      smt: t.smt,
      chave: `asia-range-algo|${leitura.dia}|${leitura.vies}`,
    },
  };
}
