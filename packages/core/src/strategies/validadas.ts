/**
 * Estratégias com vantagem MEDIDA — as únicas que geram sinais.
 *
 * ── PORQUE AS OUTRAS SAÍRAM ────────────────────────────────────────────────
 *
 * Backtest walk-forward (vela a vela, sem ver o futuro, com spread) de todas as
 * estratégias que o motor anunciava, sobre um ano de velas da Deriv em 11
 * instrumentos e 4 timeframes, dividido em dentro da amostra (até 20/07/2026) e
 * fora dela:
 *
 *   oferta/procura         −0,10R a −0,43R por operação
 *   suporte/resistência    −0,08R a −0,51R
 *   perfil de volume       −0,11R a −0,23R
 *   VWAP (tudo junto)      ≈ 0R
 *   pullback em tendência  −0,09R a −0,16R   (candidata, rejeitada)
 *   RSI(2) intradiário     −0,03R a −0,06R   (candidata, rejeitada)
 *
 * Os 114 sinais reais anunciados deram 15 ganhos e 32 perdas. No forex e na
 * cripto de 15m/1h o spread come 0,16–0,19R por operação: nenhuma geometria de
 * stop e alvo sobrevive a isso sem vantagem real.
 *
 * ── O QUE FICOU, E COM QUE NÚMEROS ─────────────────────────────────────────
 *
 * Três regras que passaram dentro E fora da amostra, com custos, e que não
 * dependem de um valor exacto de parâmetro (todas as variantes vizinhas também
 * são positivas). Todas compram: vender índices ou ouro não tem vantagem, com
 * ou sem confluência extra (ver docs/estrategias-validadas.md).
 *
 *   compra-vwap-indices    US100, SP500, US30, GER30 · 1h e 4h
 *   connors-rsi2-indices   US100, SP500, US30, GER30, JP225, BTCUSD · 1d
 *   tendencia-cripto       BTCUSD, ETHUSD · 1d
 *   tendencia-ouro         XAUUSD · 1d (a mesma regra, medida à parte)
 *   tendencia-indices      JP225 · 1d (idem)
 *   rompimento-4h          XAUUSD, USDJPY · 4h — day trade de 24 horas
 *
 * O `rompimento-4h` é a única intradiária que sobreviveu a uma procura sistemática
 * (geometria do payoff → famílias de entrada → robustez → instrumentos de fora):
 * 14,5 anos, t=4,0, 11 de 15 anos positivos. O `compra-vwap-indices` tem um aviso
 * sério em docs/estrategias-validadas.md — os seus 68% vêm de UM ano de dados.
 *
 * Os números de cada uma estão em `ESTRATEGIAS_VALIDADAS` e seguem no texto do
 * sinal. Forex, prata e o ouro intradiário NÃO têm estratégia validada; recebem
 * sinais só das estratégias EM TESTE (`em-teste.ts`), marcadas como tal e sem
 * taxa de acerto — e a cripto ganhou aí um lado de VENDA (`tendencia-baixa-cripto`),
 * o espelho da tendência de compra: positivo no backtest mas ainda com confiança
 * estatística fraca. Os sintéticos da Deriv são gerados por um gerador aleatório:
 * nenhuma análise de gráfico tem vantagem sobre eles por construção.
 *
 * Nada disto garante o futuro. É o melhor que os dados disponíveis mostram, e a
 * convicção de cada sinal é a taxa medida, não uma opinião.
 *
 * PUREZA: sem rede nem relógio; só lê as velas FECHADAS que recebe.
 */

import type { Candle, Timeframe } from '../types/market.js';
import type { StrategySignal } from './types.js';
import { atrSerie, emaSerie, rsiSerie } from './contexto.js';
import { computeAnchoredVwap, vwapZScore } from './vwap.js';
import {
  ESTRATEGIAS_EM_TESTE,
  planAberturaDaxTeste,
  planTendenciaBaixaCripto,
  planVwapForexTeste,
  type DadosExtra,
  type EstrategiaEmTeste,
} from './em-teste.js';

export type EstrategiaValidadaId =
  | 'compra-vwap-indices'
  | 'connors-rsi2-indices'
  | 'tendencia-cripto'
  | 'tendencia-ouro'
  | 'tendencia-indices'
  | 'rompimento-4h';

/** Estratégias de tendência de 55 dias (mesma regra, instrumentos diferentes). */
export const TENDENCIA_55D: readonly string[] = ['tendencia-cripto', 'tendencia-ouro', 'tendencia-indices'];

export interface EstatisticaValidada {
  /** O que foi medido, em linguagem simples. */
  resumo: string;
  operacoes: number;
  /** Fracção de operações com resultado positivo (0..1). */
  acerto: number;
  /** Resultado médio por operação, em R, já com spread. */
  expectativaR: number;
  /** Fora da amostra (período mais recente, nunca usado para escolher). */
  foraDaAmostra: { periodo: string; operacoes: number; acerto: number; expectativaR: number };
  dados: string;
}

export interface EstrategiaValidada {
  id: EstrategiaValidadaId;
  nome: string;
  descricao: string;
  instrumentos: readonly string[];
  timeframes: readonly Timeframe[];
  entrada: string;
  saida: string;
  estatistica: EstatisticaValidada;
}

/**
 * Cada estratégia tem a SUA lista: um instrumento só entra onde foi medido.
 * O VWAP intradiário e o Connors diário partilhavam a mesma lista, e assim um
 * instrumento aprovado no diário entrava sem querer no intradiário, onde nunca
 * foi testado.
 */
export const INDICES_VALIDADOS: readonly string[] = ['US100', 'SP500', 'US30', 'GER30'];
/** Connors: os mesmos índices, mais o Nikkei, o bitcoin e o paládio (15 anos de diário). */
export const CONNORS_VALIDADO: readonly string[] = [...INDICES_VALIDADOS, 'JP225', 'BTCUSD', 'XPDUSD'];
export const CRIPTO_VALIDADA: readonly string[] = ['BTCUSD', 'ETHUSD'];
export const OURO_VALIDADO: readonly string[] = ['XAUUSD'];
/** Tendência de 55 dias em índices: só o Nikkei passou. */
export const INDICES_TENDENCIA: readonly string[] = ['JP225'];
/**
 * Rompimento de 4h: dos doze mercados medidos, só estes dois passaram sozinhos.
 * EURUSD e GBPUSD deram ≈0R; USDCAD e USDCHF, que não participaram na escolha,
 * deram NEGATIVO — é por isso que a lista é curta.
 */
export const ROMPIMENTO_VALIDADO: readonly string[] = ['XAUUSD', 'USDJPY'];

export const ESTRATEGIAS_VALIDADAS: readonly EstrategiaValidada[] = [
  {
    id: 'compra-vwap-indices',
    nome: 'Compra na banda −2σ do VWAP (índices)',
    descricao:
      'Os índices de acções têm deriva positiva e reversão de curto prazo: quando fecham 2σ abaixo do VWAP do mês, voltam para cima mais vezes do que continuam a cair.',
    instrumentos: INDICES_VALIDADOS,
    timeframes: ['1h', '4h'],
    entrada: 'Fecho abaixo de VWAP − 2σ, com RSI(14) < 30 ou σ do mês > 2 ATR. Compra ao fecho.',
    saida: 'Stop 1σ abaixo. Metade em +1R, o resto em +2R com o stop na entrada depois do primeiro alvo.',
    estatistica: {
      resumo: '68% das operações chegaram a +1R antes do stop',
      operacoes: 135,
      acerto: 0.68,
      expectativaR: 0.41,
      foraDaAmostra: { periodo: '20/07–16/09/2026', operacoes: 31, acerto: 0.68, expectativaR: 0.36 },
      dados: 'Deriv, 1h e 4h, set/2025–set/2026; em diário (15 anos) a mesma compra dá +0,15R nas duas metades.',
    },
  },
  {
    id: 'connors-rsi2-indices',
    nome: 'RSI(2) de Connors',
    descricao:
      'Comprar a correcção curta de um mercado que está acima da média de 200 dias. Documentada por Connors e Alvarez; vale em todas as variantes de parâmetros testadas.',
    instrumentos: CONNORS_VALIDADO,
    timeframes: ['1d'],
    entrada: 'Fecho acima da média de 200 dias com RSI(2) < 10. Compra ao fecho.',
    saida: 'Sai no primeiro fecho acima da média de 5 dias (ou ao fim de 10 dias). Stop de protecção a 2 ATR.',
    estatistica: {
      resumo: '69% das operações fecharam a ganhar',
      operacoes: 804,
      acerto: 0.69,
      expectativaR: 0.13,
      foraDaAmostra: { periodo: '2021–2026', operacoes: 335, acerto: 0.72, expectativaR: 0.18 },
      dados:
        'Diário, 2011–2026 (15 anos), US100, SP500, US30, DAX, Nikkei, bitcoin e paládio, com spread e ' +
        'financiamento overnight (verificar-validadas.mjs): +0,09R até 2020 e +0,18R de 2021 em diante. ' +
        'Nikkei: 68% em 110 operações, +0,16R (t=2,3). Bitcoin: 71% em 118, +0,10R (t=1,7). Paládio: 68% em ' +
        '74, +0,16R (t=1,5) — passa na barra por pouco e com o spread a dobrar cai para +0,11R (t=1,1), por ' +
        'isso confirme o spread antes de o operar. Todo o universo negociável foi testado; os outros 21 ' +
        'instrumentos ficaram de fora.',
    },
  },
  {
    id: 'tendencia-cripto',
    nome: 'Tendência (máximo de 55 dias) na cripto',
    descricao:
      'Seguimento de tendência ao estilo dos fundos CTA (sistema Turtle): a cripto tem momentum persistente. Acerta metade das vezes, mas os ganhos são muitas vezes maiores que as perdas.',
    instrumentos: CRIPTO_VALIDADA,
    timeframes: ['1d'],
    entrada: 'Fecho acima do máximo dos 55 dias anteriores. Compra ao fecho.',
    saida: 'Stop inicial a 2 ATR; depois sai quando o preço perde o mínimo dos últimos 20 dias. Sem alvo fixo.',
    estatistica: {
      resumo: '54% das operações fecharam a ganhar, com +1,0R por operação em 2021–2026',
      operacoes: 57,
      acerto: 0.54,
      expectativaR: 1.0,
      foraDaAmostra: { periodo: '2021–2026', operacoes: 33, acerto: 0.52, expectativaR: 1.0 },
      dados: 'Diário, BTC desde 2014 e ETH desde 2017, com spread e financiamento overnight.',
    },
  },
  {
    id: 'tendencia-ouro',
    nome: 'Tendência (máximo de 55 dias) no ouro',
    descricao:
      'O ouro tem tendências longas e persistentes. Só compras: vender o ouro perdeu dinheiro em todas as variantes testadas, nos dois períodos.',
    instrumentos: OURO_VALIDADO,
    timeframes: ['1d'],
    entrada: 'Fecho acima do máximo dos 55 dias anteriores. Compra ao fecho.',
    saida: 'Stop inicial a 2 ATR; depois sai quando o preço perde o mínimo dos últimos 20 dias. Sem alvo fixo.',
    estatistica: {
      resumo: '48% das operações fecharam a ganhar, com +0,70R por operação em 2016–2025',
      operacoes: 42,
      acerto: 0.48,
      expectativaR: 0.8,
      foraDaAmostra: { periodo: '2016–2025', operacoes: 24, acerto: 0.5, expectativaR: 0.7 },
      dados:
        'Diário Dukascopy 2006–2025 com spread e financiamento; confirmado no ouro do Yahoo 2011–2026. Amostra pequena: poucas operações por ano.',
    },
  },
  {
    id: 'rompimento-4h',
    nome: 'Rompimento de 20 velas a favor da tendência (4h)',
    descricao:
      'Day trade: compra o rompimento do máximo das 20 velas de 4h anteriores, só quando a EMA 50 está acima da EMA 200. A operação vive no máximo 24 horas.',
    instrumentos: ROMPIMENTO_VALIDADO,
    timeframes: ['4h'],
    entrada:
      'Fecho acima do máximo das 20 velas anteriores, com EMA 50 acima da EMA 200. Compra ao fecho. Não há segundo sinal enquanto não passarem 6 velas.',
    saida: 'Stop a 1,5 ATR. Alvo a +2R. Se em 6 velas (24 horas) não tocar nenhum dos dois, sai ao fecho.',
    estatistica: {
      resumo: '53% das operações fecharam a ganhar, com +0,16R por operação',
      operacoes: 734,
      acerto: 0.53,
      expectativaR: 0.16,
      foraDaAmostra: { periodo: 'jul/2024–ago/2026', operacoes: 138, acerto: 0.64, expectativaR: 0.42 },
      dados:
        'HistData de 1 minuto agregada em 4h, 2012–2026 (14,5 anos), com spread, medido com o código de produção ' +
        '(scripts/backtest/verificar-rompimento-4h.mjs): t=4,0 e 11 de 15 anos positivos. O OURO é que carrega ' +
        '(+0,25R, t=4,4, aguenta o spread a triplicar); o USDJPY dá +0,07R (t=1,3). Nos outros dez mercados ' +
        'testados: índices −0,04R, EURUSD e GBPUSD ≈0R, e USDCAD e USDCHF — que não participaram na escolha — ' +
        'deram NEGATIVO. A vantagem não é universal: vive onde as tendências são fortes.',
    },
  },
  {
    id: 'tendencia-indices',
    nome: 'Tendência (máximo de 55 dias) no Nikkei',
    descricao:
      'A mesma regra de seguimento de tendência da cripto e do ouro. De todos os índices testados, só o Nikkei a aguentou nos dois períodos — o Japão saiu de trinta anos de lado e passou a ter tendências longas.',
    instrumentos: INDICES_TENDENCIA,
    timeframes: ['1d'],
    entrada: 'Fecho acima do máximo dos 55 dias anteriores. Compra ao fecho.',
    saida: 'Stop inicial a 2 ATR; depois sai quando o preço perde o mínimo dos últimos 20 dias. Sem alvo fixo.',
    estatistica: {
      resumo: '37% das operações fecharam a ganhar, mas as que ganham são muito maiores',
      operacoes: 35,
      acerto: 0.37,
      expectativaR: 1.07,
      foraDaAmostra: { periodo: '2021–2026', operacoes: 11, acerto: 0.36, expectativaR: 1.37 },
      dados:
        'Diário Yahoo 2011–2026 com spread e financiamento overnight, t=1,5, 9 de 15 anos positivos. Amostra ' +
        'pequena (2 a 3 operações por ano) e acerto baixo: a média vem de poucas tendências grandes. CAC, ' +
        'AUS200, SMI, NL25 e EU50 foram testados com a mesma regra e perderam dinheiro.',
    },
  },
];

export function estrategiaValidada(id: string): EstrategiaValidada | undefined {
  return ESTRATEGIAS_VALIDADAS.find((e) => e.id === id);
}

/** Uma estratégia que gera sinais: validada, ou em teste ao vivo (tem `emTeste`). */
export type EstrategiaActiva = EstrategiaValidada | EstrategiaEmTeste;

export const ESTRATEGIAS_ACTIVAS: readonly EstrategiaActiva[] = [...ESTRATEGIAS_VALIDADAS, ...ESTRATEGIAS_EM_TESTE];

/** Validada ou em teste: as estratégias cujos sinais se anunciam e acompanham. */
export function estrategiaActiva(id: string): EstrategiaActiva | undefined {
  return ESTRATEGIAS_ACTIVAS.find((e) => e.id === id);
}

/**
 * Estratégias que já não geram sinais, mas cujos sinais antigos ainda aparecem
 * (ficaram na base de dados, ou o motor antigo ainda os anuncia). Sem estes
 * nomes, a interface mostrava o identificador cru — "volume-profile" a uma
 * pessoa que só quer saber o que é aquilo.
 */
const NOMES_ANTIGOS: Readonly<Record<string, string>> = {
  mmxm: 'MMXM institucional (antiga)',
  'supply-demand': 'Oferta e procura (antiga)',
  'support-resistance': 'Suporte/resistência (antiga)',
  'vwap-bands': 'Bandas de VWAP (antiga)',
  'volume-profile': 'Perfil de volume (antiga)',
  'smt-teste': 'SMT Divergence (antiga)',
};

/** Nome legível de uma estratégia, activa ou já retirada. Fonte única. */
export function nomeDeEstrategia(id: string): string {
  return estrategiaActiva(id)?.nome ?? NOMES_ANTIGOS[id] ?? id;
}

/** Estratégias que geram sinais neste instrumento e timeframe (validadas e em teste). */
export function estrategiasPara(simbolo: string, timeframe: string): EstrategiaActiva[] {
  const s = simbolo.toUpperCase();
  return ESTRATEGIAS_ACTIVAS.filter(
    (e) => e.instrumentos.includes(s) && (e.timeframes as readonly string[]).includes(timeframe),
  );
}

/** O instrumento tem alguma estratégia validada, em qualquer timeframe? */
export function temEstrategiaValidada(simbolo: string): boolean {
  const s = simbolo.toUpperCase();
  return ESTRATEGIAS_VALIDADAS.some((e) => e.instrumentos.includes(s));
}

// ---------------------------------------------------------------------------

function mediaSimples(valores: readonly number[], fim: number, periodo: number): number {
  if (fim + 1 < periodo) return Number.NaN;
  let soma = 0;
  for (let k = fim - periodo + 1; k <= fim; k++) soma += valores[k] ?? 0;
  return soma / periodo;
}

function texto(e: EstrategiaValidada): string {
  const st = e.estatistica;
  return (
    `${st.resumo} (${st.operacoes} operações; ${Math.round(st.foraDaAmostra.acerto * 100)}% fora da amostra, ` +
    `${st.foraDaAmostra.periodo}). ${st.dados}`
  );
}

interface Contexto {
  symbol: string;
  timeframe: Timeframe;
}

/** Compra na banda −2σ do VWAP mensal, em índices, 1h e 4h. */
export function planCompraVwapIndices(velas: readonly Candle[], ctx: Contexto): StrategySignal[] {
  const lista = velas as Candle[];
  const i = lista.length - 1;
  const u = lista[i];
  if (!u || lista.length < 60) return [];
  const vwap = computeAnchoredVwap(lista, { anchor: 'month' });
  const p = vwap.points[vwap.points.length - 1];
  if (!p || p.index !== i || p.sigma <= 0 || p.samples < 15) return [];
  const z = vwapZScore(p, u.close);
  if (z > -2) return [];

  const atr = atrSerie(lista, 14)[i] ?? Number.NaN;
  const rsi = rsiSerie(lista, 14)[i] ?? Number.NaN;
  if (!(atr > 0) || !Number.isFinite(rsi)) return [];
  const sobrevendido = rsi < 30;
  const deslocado = p.sigma > 2 * atr;
  // Sem nenhuma das duas, a vantagem medida cai para +0,06R (54%): não chega.
  if (!sobrevendido && !deslocado) return [];

  const entrada = u.close;
  const stop = p.vwap - (Math.abs(z) + 1) * p.sigma;
  const risco = entrada - stop;
  if (!(risco > 0)) return [];

  const e = estrategiaValidada('compra-vwap-indices')!;
  // Taxa de +1R antes do stop medida em cada caso (41, 37 e 57 operações).
  const conviccao = sobrevendido && deslocado ? 0.71 : deslocado ? 0.68 : 0.67;
  return [
    {
      strategy: 'compra-vwap-indices',
      symbol: ctx.symbol,
      timeframe: ctx.timeframe,
      direction: 'bullish',
      regime: 'mean-reversion',
      index: i,
      generatedAt: u.time,
      referencePrice: u.close,
      entryZoneLow: entrada,
      entryZoneHigh: entrada,
      entryPrice: entrada,
      stopLoss: stop,
      targets: [
        { price: entrada + risco, rMultiple: 1, closeFraction: 0.5, rationale: '+1R: fecha metade e passa o stop para a entrada.' },
        { price: entrada + 2 * risco, rMultiple: 2, closeFraction: 0.5, rationale: '+2R: fecha o resto.' },
      ],
      maxRMultiple: 2,
      conviction: conviccao,
      rationale:
        `Fecho a ${z.toFixed(1)}σ do VWAP do mês${sobrevendido ? `, RSI(14) ${rsi.toFixed(0)}` : ''}` +
        `${deslocado ? `, σ do mês ${(p.sigma / atr).toFixed(1)}× o ATR` : ''}. ${texto(e)}`,
      assumptions: [e.descricao, e.saida],
      warnings: vwap.usedVolume ? [] : ['Sem volume da Deriv: VWAP ponderado pelo tempo (é assim que foi medido).'],
    },
  ];
}

/** RSI(2) de Connors em índices, diário. */
export function planConnorsIndices(velas: readonly Candle[], ctx: Contexto): StrategySignal[] {
  const lista = velas as Candle[];
  const i = lista.length - 1;
  const u = lista[i];
  if (!u || lista.length < 210) return [];
  const fechos = lista.map((v) => v.close);
  const sma200 = mediaSimples(fechos, i, 200);
  const sma5 = mediaSimples(fechos, i, 5);
  const rsi2 = rsiSerie(lista, 2)[i] ?? Number.NaN;
  const atr = atrSerie(lista, 14)[i] ?? Number.NaN;
  if (!(u.close > sma200) || !(rsi2 < 10) || !(atr > 0)) return [];

  const entrada = u.close;
  const stop = entrada - 2 * atr;
  const risco = entrada - stop;
  const e = estrategiaValidada('connors-rsi2-indices')!;
  const alvo = sma5 > entrada ? sma5 : null;
  return [
    {
      strategy: 'connors-rsi2-indices',
      symbol: ctx.symbol,
      timeframe: ctx.timeframe,
      direction: 'bullish',
      regime: 'mean-reversion',
      index: i,
      generatedAt: u.time,
      referencePrice: u.close,
      entryZoneLow: entrada,
      entryZoneHigh: entrada,
      entryPrice: entrada,
      stopLoss: stop,
      targets: alvo
        ? [
            {
              price: alvo,
              rMultiple: (alvo - entrada) / risco,
              closeFraction: 1,
              rationale: 'Média de 5 dias hoje. A saída é o primeiro FECHO acima dela — o nível acompanha a média.',
            },
          ]
        : [],
      maxRMultiple: alvo ? (alvo - entrada) / risco : 0,
      conviction: 0.7,
      rationale:
        `RSI(2) em ${rsi2.toFixed(1)} com o preço acima da média de 200 dias (${sma200.toFixed(2)}). ` +
        `Sai no primeiro fecho acima da média de 5 dias ou ao fim de 10 dias. ${texto(e)}`,
      assumptions: [e.descricao, e.saida],
      warnings: [],
    },
  ];
}

/** Tendência na cripto: fecho acima do máximo de 55 dias, diário. */
export function planTendenciaCripto(velas: readonly Candle[], ctx: Contexto): StrategySignal[] {
  return planTendencia55d(velas, ctx, 'tendencia-cripto', 0.54);
}

/** Tendência no ouro: a mesma regra, com a taxa medida no ouro. */
export function planTendenciaOuro(velas: readonly Candle[], ctx: Contexto): StrategySignal[] {
  return planTendencia55d(velas, ctx, 'tendencia-ouro', 0.48);
}

/** A mesma tendência de 55 dias, no Nikkei. */
export function planTendenciaIndices(velas: readonly Candle[], ctx: Contexto): StrategySignal[] {
  return planTendencia55d(velas, ctx, 'tendencia-indices', 0.37);
}

// ---------------------------------------------------------------------------
// Rompimento de 20 velas a favor da tendência — 4h, day trade
// ---------------------------------------------------------------------------

/** Velas de arrefecimento: depois de um sinal, não há outro enquanto durarem. */
const ARREFECIMENTO_4H = 6;
const VELAS_ROMPIMENTO = 20;
const STOP_ATR_4H = 1.5;

/** A entrada disparava nesta vela? Usa-se também para o arrefecimento. */
function disparaRompimento4h(lista: readonly Candle[], i: number, ema50: readonly number[], ema200: readonly number[]): boolean {
  const u = lista[i];
  if (!u || i < VELAS_ROMPIMENTO) return false;
  if (!((ema50[i] ?? Number.NaN) > (ema200[i] ?? Number.NaN))) return false;
  let maximo = -Infinity;
  for (let k = i - VELAS_ROMPIMENTO; k < i; k++) maximo = Math.max(maximo, lista[k]?.high ?? -Infinity);
  return Number.isFinite(maximo) && u.close > maximo;
}

/**
 * Compra o rompimento do máximo das 20 velas anteriores, em 4h, só a favor da
 * tendência (EMA 50 acima da EMA 200). Stop a 1,5 ATR, alvo a +2R, e sai ao
 * fim de 6 velas (24 horas) se não tocar nenhum dos dois — day trade.
 *
 * O arrefecimento de 6 velas é parte da regra, não um detalhe: sem ele entram
 * operações sobrepostas no mesmo movimento e a vantagem medida cai para metade
 * (+0,035R em vez de +0,076R no grupo onde foi escolhida).
 */
export function planRompimento4h(velas: readonly Candle[], ctx: Contexto): StrategySignal[] {
  if (ctx.timeframe !== '4h') return [];
  const lista = velas as Candle[];
  const i = lista.length - 1;
  const u = lista[i];
  if (!u || lista.length < 210) return [];
  const fechos = lista.map((v) => v.close);
  const ema50 = emaSerie(fechos, 50);
  const ema200 = emaSerie(fechos, 200);
  if (!disparaRompimento4h(lista, i, ema50, ema200)) return [];
  for (let k = Math.max(0, i - ARREFECIMENTO_4H); k < i; k++) {
    if (disparaRompimento4h(lista, k, ema50, ema200)) return [];
  }
  const atr = atrSerie(lista, 14)[i] ?? Number.NaN;
  if (!(atr > 0)) return [];

  const entrada = u.close;
  const stop = entrada - STOP_ATR_4H * atr;
  const risco = entrada - stop;
  if (!(risco > 0)) return [];
  const alvo = entrada + 2 * risco;
  const e = ESTRATEGIAS_VALIDADAS.find((x) => x.id === 'rompimento-4h')!;
  let maximo = -Infinity;
  for (let k = i - VELAS_ROMPIMENTO; k < i; k++) maximo = Math.max(maximo, lista[k]?.high ?? -Infinity);

  return [
    {
      strategy: 'rompimento-4h',
      symbol: ctx.symbol,
      timeframe: ctx.timeframe,
      direction: 'bullish',
      regime: 'continuation',
      index: i,
      generatedAt: u.time,
      referencePrice: entrada,
      entryZoneLow: entrada,
      entryZoneHigh: entrada,
      entryPrice: entrada,
      stopLoss: stop,
      targets: [
        { price: alvo, rMultiple: 2, closeFraction: 1, rationale: '+2R: fecha tudo. Sem alvo parcial.' },
      ],
      maxRMultiple: 2,
      conviction: e.estatistica.acerto,
      rationale:
        `Fecho acima do máximo das 20 velas anteriores (${maximo.toFixed(2)}), com a EMA 50 acima da EMA 200. ` +
        `Stop a 1,5 ATR (${stop.toFixed(2)}), alvo a +2R (${alvo.toFixed(2)}); se em 24 horas não tocar nenhum, ` +
        `sai ao fecho. ${texto(e)}`,
      assumptions: [e.descricao, e.saida],
      warnings: [],
    },
  ];
}

function planTendencia55d(
  velas: readonly Candle[],
  ctx: Contexto,
  id: 'tendencia-cripto' | 'tendencia-ouro' | 'tendencia-indices',
  conviccao: number,
): StrategySignal[] {
  const lista = velas as Candle[];
  const i = lista.length - 1;
  const u = lista[i];
  if (!u || lista.length < 60) return [];
  let maximo = -Infinity;
  for (let k = i - 55; k < i; k++) maximo = Math.max(maximo, lista[k]?.high ?? -Infinity);
  // Só o PRIMEIRO fecho acima: se ontem já tinha fechado acima do seu máximo, não é sinal novo.
  let maximoOntem = -Infinity;
  for (let k = i - 56; k < i - 1; k++) maximoOntem = Math.max(maximoOntem, lista[k]?.high ?? -Infinity);
  const atr = atrSerie(lista, 14)[i] ?? Number.NaN;
  if (!(u.close > maximo) || !(atr > 0)) return [];
  if ((lista[i - 1]?.close ?? 0) > maximoOntem) return [];

  const entrada = u.close;
  const stop = entrada - 2 * atr;
  let minimo20 = Infinity;
  for (let k = i - 19; k <= i; k++) minimo20 = Math.min(minimo20, lista[k]?.low ?? Infinity);
  const e = estrategiaValidada(id)!;
  return [
    {
      strategy: id,
      symbol: ctx.symbol,
      timeframe: ctx.timeframe,
      direction: 'bullish',
      regime: 'continuation',
      index: i,
      generatedAt: u.time,
      referencePrice: u.close,
      entryZoneLow: entrada,
      entryZoneHigh: entrada,
      entryPrice: entrada,
      stopLoss: stop,
      targets: [],
      maxRMultiple: 0,
      conviction: conviccao,
      rationale:
        `Fecho acima do máximo dos 55 dias anteriores (${maximo.toFixed(2)}). Sem alvo fixo: o stop sobe ` +
        `para o mínimo dos últimos 20 dias (hoje ${minimo20.toFixed(2)}) e é aí que se sai. ${texto(e)}`,
      assumptions: [e.descricao, e.saida],
      warnings: [],
    },
  ];
}

/**
 * Corre as estratégias validadas e em teste que se aplicam a este instrumento e
 * timeframe sobre velas FECHADAS. Devolve só sinais nascidos na última vela.
 * O SMT precisa de `extra` (velas das referências e de 4h); sem elas não corre.
 */
export function executarEstrategiasValidadas(
  velas: readonly Candle[],
  ctx: Contexto,
  extra: DadosExtra = {},
): StrategySignal[] {
  const out: StrategySignal[] = [];
  for (const e of estrategiasPara(ctx.symbol, ctx.timeframe)) {
    if (e.id === 'compra-vwap-indices') out.push(...planCompraVwapIndices(velas, ctx));
    if (e.id === 'connors-rsi2-indices') out.push(...planConnorsIndices(velas, ctx));
    if (e.id === 'tendencia-cripto') out.push(...planTendenciaCripto(velas, ctx));
    if (e.id === 'tendencia-ouro') out.push(...planTendenciaOuro(velas, ctx));
    if (e.id === 'tendencia-indices') out.push(...planTendenciaIndices(velas, ctx));
    if (e.id === 'rompimento-4h') out.push(...planRompimento4h(velas, ctx));
    if (e.id === 'vwap-forex-teste') out.push(...planVwapForexTeste(velas, ctx));
    if (e.id === 'tendencia-baixa-cripto') out.push(...planTendenciaBaixaCripto(velas, ctx));
    if (e.id === 'abertura-dax-teste') out.push(...planAberturaDaxTeste(velas, ctx, extra));
  }
  return out;
}

/**
 * Nível de saída dinâmico das estratégias sem alvo fixo, na última vela.
 *
 *   connors-rsi2-indices  sair quando FECHA acima da média de 5 dias
 *   tendencia-cripto      stop sobe para o mínimo dos últimos 20 dias
 */
export function saidaDinamica(
  estrategia: string,
  velas: readonly Candle[],
): { tipo: 'fecho-acima' | 'stop-movel'; nivel: number } | null {
  const lista = velas as Candle[];
  const i = lista.length - 1;
  if (i < 20) return null;
  if (estrategia === 'connors-rsi2-indices') {
    const media = mediaSimples(lista.map((v) => v.close), i, 5);
    return Number.isFinite(media) ? { tipo: 'fecho-acima', nivel: media } : null;
  }
  if (TENDENCIA_55D.includes(estrategia)) {
    let minimo = Infinity;
    // Mínimo dos 20 dias ANTERIORES à vela actual: é o nível que vale para a próxima.
    for (let k = i - 19; k <= i; k++) minimo = Math.min(minimo, lista[k]?.low ?? Infinity);
    return Number.isFinite(minimo) ? { tipo: 'stop-movel', nivel: minimo } : null;
  }
  return null;
}
