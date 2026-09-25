/**
 * Estratégias SEM VANTAGEM MEDIDA — geram sinais, mas sem taxa de acerto.
 *
 * ── PORQUE EXISTEM ─────────────────────────────────────────────────────────
 *
 * Regras que correm ao vivo enquanto os resultados reais decidem se ficam.
 *
 * Uma delas já decidiu e SAIU: o `vwap-forex-teste`, desligado em 23/09/2026.
 * Medido em 14,5 anos deu −0,079R por operação (t=−5,5, negativo nas duas
 * metades, 5487 operações) — ~378 sinais por ano a perder, quase o mesmo que as
 * Bandas de VWAP. O que o apanhou foi o Agnaldo a reparar que comprava EURUSD e
 * GBPUSD em queda e, depois do stop, comprava outra vez mais abaixo.
 *
 *   tendencia-baixa-cripto o espelho, em venda, da tendência de 55 dias validada
 *                          na cripto — só entra abaixo da média de 200 dias
 *   abertura-dax-teste     GER30 em 30m: rompimento da 1.ª vela da abertura de
 *                          Londres (= abertura do DAX), a favor da EMA 20 diária
 *
 * O que o backtest disse (para quem ler os resultados com o contexto certo):
 *
 *   Tendência de baixa na cripto (Yahoo diário, 2014–2026)
 *       positiva nos dois períodos em TODAS as combinações de canal (20 a 100
 *       dias) e saída (10 a 30 dias) testadas — 36 no total — mas com t<1,4 em
 *       todas: a direcção é consistente, a confiança estatística não é forte
 *       o suficiente ainda para validar sem mais dados ao vivo. Vender ouro
 *       continua a perder dinheiro em todas as variantes: fica de fora.
 *   Abertura de Londres no DAX (HistData 1 min, 2022–ago/2026, custo 2,5 pts)
 *       +0,19R por operação em 611, positiva em 8 de 10 semestres, compras e
 *       vendas positivas. MAS: sensível ao custo (a 4 pts, 2022–2024 fica em
 *       zero), depende de mercados em tendência, e jul–ago/2026 deu −0,53R.
 *
 * A convicção destes sinais é 0: não há taxa de acerto medida para mostrar com
 * confiança, e um número inventado seria pior do que nenhum.
 *
 * PUREZA: sem rede nem relógio; só lê as velas FECHADAS que recebe.
 */

import type { Candle, Direction, Timeframe } from '../types/market.js';
import type { StrategySignal } from './types.js';
import { atrSerie, emaSerie, rsiSerie } from './contexto.js';
import { computeAnchoredVwap, vwapZScore } from './vwap.js';
import { sessaoDax } from '../time/europa.js';

export type EstrategiaEmTesteId = 'tendencia-baixa-cripto' | 'abertura-dax-teste' | 'ict-algo' | 'asia-range-algo';

export interface EstrategiaEmTeste {
  id: EstrategiaEmTesteId;
  nome: string;
  descricao: string;
  instrumentos: readonly string[];
  timeframes: readonly Timeframe[];
  entrada: string;
  saida: string;
  emTeste: {
    /** Início do teste ao vivo (AAAA-MM-DD). */
    desde: string;
    /** Data combinada para rever os resultados (AAAA-MM-DD). */
    revisao: string;
    /** O que o backtest disse antes do teste. */
    antes: string;
  };
}

export const FOREX_EM_TESTE: readonly string[] = ['EURUSD', 'GBPUSD', 'GBPJPY', 'USDJPY'];
export const CRIPTO_EM_TESTE: readonly string[] = ['BTCUSD', 'ETHUSD'];
export const DAX_EM_TESTE: readonly string[] = ['GER30'];
/** Os instrumentos que o ICT ALGO conhece bem (os que foram medidos) e os do journal. */
export const ICT_ALGO_EM_TESTE: readonly string[] = [
  'EURUSD',
  'GBPUSD',
  'USDJPY',
  'EURJPY',
  'GBPJPY',
  'XAUUSD',
  'US100',
  'SP500',
  'US30',
  'GER30',
];
/** Os pares do journal: JPY, com SMT entre eles. */
export const ASIA_RANGE_EM_TESTE: readonly string[] = ['GBPJPY', 'USDJPY', 'EURJPY'];

export const ESTRATEGIAS_EM_TESTE: readonly EstrategiaEmTeste[] = [
  {
    id: 'tendencia-baixa-cripto',
    nome: 'Tendência de baixa — cripto',
    descricao:
      'O espelho, em venda, da tendência de 55 dias validada na cripto: rompe o mínimo dos últimos 55 dias, abaixo da média de 200 — só quando o regime já é de baixa.',
    instrumentos: CRIPTO_EM_TESTE,
    timeframes: ['1d'],
    entrada: 'Fecho abaixo do mínimo dos 55 dias anteriores E abaixo da média móvel de 200 dias. Vende ao fecho.',
    saida: 'Stop inicial a 2 ATR; depois sai quando o preço recupera o máximo dos últimos 20 dias. Sem alvo fixo.',
    emTeste: {
      desde: '2026-09-18',
      // Sinal raro (a compra teve 57 em 10-12 anos): uma semana não chega
      // para ver um sinal sequer. Revisão trimestral.
      revisao: '2026-12-18',
      antes:
        'Backtest (Yahoo diário, 2014–2026): positiva nos dois períodos em 36 combinações de canal (20–100 dias) ' +
        'e saída (10–30 dias) — mas t<1,4 em todas. Direcção consistente, confiança estatística ainda fraca.',
    },
  },
  {
    id: 'abertura-dax-teste',
    nome: 'Abertura de Londres no DAX',
    descricao:
      'Rompimento da primeira vela de 30 minutos da abertura de Londres (que é também a abertura do DAX à vista), só a favor da tendência diária. Day trade: sai no fecho do DAX.',
    instrumentos: DAX_EM_TESTE,
    timeframes: ['30m'],
    entrada:
      'A 1.ª vela de 30m da abertura (07:00 UTC no verão, 08:00 no inverno) faz a faixa. Nas 3 horas seguintes, o primeiro fecho acima dela compra e abaixo dela vende — só se estiver do mesmo lado da EMA 20 diária.',
    saida: 'Stop no meio da faixa. Sem alvo fixo: sai no fecho do DAX à vista (15:30 UTC no verão, 16:30 no inverno).',
    emTeste: {
      desde: '2026-09-18',
      // ~2,5 operações por semana: 40 operações levam uns 4 meses.
      revisao: '2027-01-18',
      antes:
        'Backtest (HistData 1 min, 2022–ago/2026, custo 2,5 pts): +0,19R por operação em 611, positiva em 8 de 10 semestres. ' +
        'Sensível ao custo (a 4 pts, 2022–2024 fica em zero), depende de tendência, e jul–ago/2026 deu −0,53R. Só em conta demo.',
    },
  },
  {
    id: 'ict-algo',
    nome: 'ICT ALGO',
    descricao:
      'O algoritmo ICT de cima para baixo: viés diário, regime, e o modelo do site que corresponde (Venom, CRT, Reaper, Silver Bullet, Unicorn, Turtle Soup ou continuação por OTE).',
    instrumentos: ICT_ALGO_EM_TESTE,
    // Os três timeframes de execução do algoritmo (os medidos no backtest).
    timeframes: ['15m', '1h', '4h'],
    entrada: 'A do modelo escolhido: ordem pendente no PD array (FVG/OB) ou a mercado na vela de rejeição, dentro das killzones de Londres ou Nova Iorque.',
    saida: 'Stop estrutural do modelo (extremo varrido ou swing); alvo na liquidez mais próxima que pague pelo menos 2R.',
    emTeste: {
      desde: '2026-09-25',
      revisao: '2026-12-25',
      antes:
        'Backtest 2022–2026 com custos: nenhum modo de entrada ficou positivo nas duas metades; USDJPY e EURJPY foram os melhores mercados.',
    },
  },
  {
    id: 'asia-range-algo',
    nome: 'Asia Range Algo',
    descricao:
      'O modelo do journal: na abertura de Londres o par varre o extremo da Ásia contra o viés, o par correlacionado não acompanha (SMT), e o MSS confirma. Alvo no outro extremo da Ásia ou no POI de Londres.',
    instrumentos: ASIA_RANGE_EM_TESTE,
    timeframes: ['15m'],
    entrada: 'A mercado no primeiro fecho além do último swing antes do extremo da manipulação (MSS), entre as 08:00 e as 10:00 de Londres.',
    saida: 'Stop no extremo da manipulação; alvo no extremo oposto da Ásia ou no POI de Londres, o mais próximo que pague 2R.',
    emTeste: {
      desde: '2026-09-25',
      revisao: '2026-12-25',
      antes:
        'Backtest 15M 2022+ (entrada na confirmação, alvo 3,5R): +0,12R por operação, t=1,1, 71 operações. A versão com alvo na Ásia/POI ainda não foi medida.',
    },
  },
];

export function estrategiaEmTeste(id: string): EstrategiaEmTeste | undefined {
  return ESTRATEGIAS_EM_TESTE.find((e) => e.id === id);
}

export function temEstrategiaEmTeste(simbolo: string): boolean {
  const s = simbolo.toUpperCase();
  return ESTRATEGIAS_EM_TESTE.some((e) => e.instrumentos.includes(s));
}

interface Contexto {
  symbol: string;
  timeframe: Timeframe;
}

/** Dados de outros timeframes que algumas estratégias precisam. */
export interface DadosExtra {
  /** Velas diárias FECHADAS do próprio instrumento (EMA 20 da abertura do DAX). */
  velas1d?: readonly Candle[];
  /**
   * Só no servidor: diário e par correlacionado para o ICT ALGO e o Asia Range
   * Algo. Sem isto os dois não correm (ver `algos.ts`).
   */
  algo?: import('./algos.js').DadosAlgo;
}

const HORA = 3_600_000;
const DIA = 86_400_000;
const PASSO_MS: Readonly<Record<string, number>> = { '15m': 900_000, '1h': HORA, '4h': 4 * HORA };

/**
 * O aviso que segue no texto do sinal.
 *
 * Diz o que interessa — que esta regra ainda não tem taxa de acerto medida —
 * sem carimbos. O selo "EM TESTE" saiu de toda a aplicação em 23/09/2026: como
 * o Agnaldo notou, TUDO está permanentemente à prova, e um carimbo que está em
 * todo o lado não distingue nada. O que distingue é o número: as regras com
 * vantagem medida trazem a taxa, estas trazem esta frase.
 */
function aviso(id: EstrategiaEmTesteId): string {
  const e = estrategiaEmTeste(id)!;
  const dia = (iso: string) => iso.split('-').slice(1).reverse().join('/');
  return `Sem taxa de acerto medida (ao vivo desde ${dia(e.emTeste.desde)}, próxima revisão a ${dia(e.emTeste.revisao)}). ${e.emTeste.antes}`;
}

// ---------------------------------------------------------------------------
// Tendência de baixa — cripto
// ---------------------------------------------------------------------------

function mediaSimplesEmTeste(valores: readonly number[], fim: number, periodo: number): number {
  if (fim + 1 < periodo) return Number.NaN;
  let soma = 0;
  for (let k = fim - periodo + 1; k <= fim; k++) soma += valores[k] ?? 0;
  return soma / periodo;
}

/**
 * Venda no rompimento do mínimo de 55 dias, só abaixo da média de 200 — o
 * espelho da tendência de 55 dias validada na cripto (compra), com a
 * confluência extra que o backtest mostrou ajudar sem prejudicar a robustez.
 */
export function planTendenciaBaixaCripto(velas: readonly Candle[], ctx: Contexto): StrategySignal[] {
  const lista = velas as Candle[];
  const i = lista.length - 1;
  const u = lista[i];
  if (!u || lista.length < 210) return [];
  const fechos = lista.map((v) => v.close);
  const sma200 = mediaSimplesEmTeste(fechos, i, 200);
  if (!(u.close < sma200)) return [];

  let minimo = Infinity;
  for (let k = i - 55; k < i; k++) minimo = Math.min(minimo, lista[k]?.low ?? Infinity);
  // Só o PRIMEIRO fecho abaixo: se ontem já tinha fechado abaixo do seu mínimo, não é sinal novo.
  let minimoOntem = Infinity;
  for (let k = i - 56; k < i - 1; k++) minimoOntem = Math.min(minimoOntem, lista[k]?.low ?? Infinity);
  const atr = atrSerie(lista, 14)[i] ?? Number.NaN;
  if (!(u.close < minimo) || !(atr > 0)) return [];
  if ((lista[i - 1]?.close ?? Infinity) < minimoOntem) return [];

  const entrada = u.close;
  const stop = entrada + 2 * atr;
  let maximo20 = -Infinity;
  for (let k = i - 19; k <= i; k++) maximo20 = Math.max(maximo20, lista[k]?.high ?? -Infinity);
  const e = estrategiaEmTeste('tendencia-baixa-cripto')!;
  return [
    {
      strategy: 'tendencia-baixa-cripto',
      symbol: ctx.symbol,
      timeframe: ctx.timeframe,
      direction: 'bearish',
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
      conviction: 0,
      rationale:
        `Fecho abaixo do mínimo dos 55 dias anteriores (${minimo.toFixed(2)}) e abaixo da média de 200 dias ` +
        `(${sma200.toFixed(2)}). Sem alvo fixo: o stop desce para o máximo dos últimos 20 dias (hoje ${maximo20.toFixed(2)}) ` +
        `e é aí que se sai. ${aviso('tendencia-baixa-cripto')}`,
      assumptions: [e.descricao, e.saida],
      warnings: ['Em teste: direcção consistente no backtest, mas t<1,4 em todas as variantes — confiança ainda fraca.'],
    },
  ];
}

// ---------------------------------------------------------------------------
// Abertura de Londres no DAX (GER30, 30m)
// ---------------------------------------------------------------------------

const M30 = 30 * 60_000;
/** Até quando, depois da abertura, um rompimento ainda conta (medido com 3h). */
export const JANELA_ABERTURA_DAX_MS = 3 * HORA;
/** O risco tem de ser maior do que o custo usado no backtest (spread + deslize). */
export const CUSTO_ABERTURA_DAX_PONTOS = 2.5;

function fimDeSemana(tempoMs: number): boolean {
  const d = new Date(tempoMs).getUTCDay();
  return d === 0 || d === 6;
}

/**
 * Rompimento da 1.ª vela de 30m da abertura de Londres / DAX, a favor da EMA 20
 * diária — exactamente a variante medida (`orb30-meio`, filtro EMA 20, saída no
 * fecho). Precisa de `extra.velas1d`; sem elas não corre.
 */
export function planAberturaDaxTeste(
  velas: readonly Candle[],
  ctx: Contexto,
  extra: DadosExtra = {},
): StrategySignal[] {
  if (ctx.timeframe !== '30m') return [];
  const lista = velas as Candle[];
  const i = lista.length - 1;
  const u = lista[i];
  if (!u || fimDeSemana(u.time)) return [];
  const dia = Math.floor(u.time / DIA) * DIA;
  const { abre, fecha } = sessaoDax(dia);
  // A vela de rompimento começa depois da 1.ª vela, dentro da janela, e fecha antes do fecho do DAX.
  if (u.time < abre + M30 || u.time >= abre + JANELA_ABERTURA_DAX_MS || u.time + M30 > fecha) return [];

  let iPrimeira = -1;
  for (let k = i - 1; k >= 0 && lista[k]!.time >= abre; k--) if (lista[k]!.time === abre) iPrimeira = k;
  if (iPrimeira < 0) return [];
  const primeira = lista[iPrimeira]!;
  const hi = primeira.high;
  const lo = primeira.low;
  if (!(hi > lo)) return [];
  // Só o PRIMEIRO fecho fora da faixa conta: se uma vela anterior de hoje já saiu, o dia está feito.
  for (let k = iPrimeira + 1; k < i; k++) {
    if (lista[k]!.close > hi || lista[k]!.close < lo) return [];
  }
  const lado = u.close > hi ? 1 : u.close < lo ? -1 : 0;
  if (lado === 0) return [];

  // Tendência diária: EMA 20 dos fechos diários ATÉ ONTEM, sem fins de semana.
  const diarias = (extra.velas1d ?? []).filter((c) => c.time < dia && !fimDeSemana(c.time));
  if (diarias.length < 25) return [];
  const ema = emaSerie(diarias.map((c) => c.close), 20).at(-1) ?? Number.NaN;
  if (!Number.isFinite(ema)) return [];
  if (lado > 0 ? !(u.close > ema) : !(u.close < ema)) return [];

  const entrada = u.close;
  const stop = (hi + lo) / 2;
  const risco = (entrada - stop) * lado;
  if (!(risco > CUSTO_ABERTURA_DAX_PONTOS)) return [];

  const e = estrategiaEmTeste('abertura-dax-teste')!;
  const hora = (t: number) => new Date(t).toISOString().slice(11, 16);
  const direction: Direction = lado > 0 ? 'bullish' : 'bearish';
  return [
    {
      strategy: 'abertura-dax-teste',
      symbol: ctx.symbol,
      timeframe: ctx.timeframe,
      direction,
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
      conviction: 0,
      rationale:
        `Fecho ${lado > 0 ? 'acima' : 'abaixo'} da 1.ª vela da abertura (${lo.toFixed(1)}–${hi.toFixed(1)}, ${hora(abre)} UTC), ` +
        `${lado > 0 ? 'acima' : 'abaixo'} da EMA 20 diária (${ema.toFixed(1)}). Stop no meio da faixa; sem alvo fixo, ` +
        `sai no fecho do DAX às ${hora(fecha)} UTC. ${aviso('abertura-dax-teste')}`,
      assumptions: [e.descricao, e.saida],
      warnings: ['Em teste: só em conta demo. Sensível ao spread — confirme que o do GER30 à abertura é ≤ 2,5 pontos.'],
    },
  ];
}
