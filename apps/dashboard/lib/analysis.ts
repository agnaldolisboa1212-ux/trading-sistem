/**
 * Análise ao vivo de um instrumento, para a página de detalhe.
 *
 * Corre no SERVIDOR: busca as velas às APIs públicas e chama o mesmo
 * `analyzeInstrument` que o motor usa. Não é uma segunda implementação — é a
 * mesma função, pelo que o gráfico mostra exatamente aquilo que decidiu o
 * checklist.
 *
 * Alternativa rejeitada: persistir as estruturas no Supabase e desenhá-las a
 * partir daí. Seria mais rápido, mas obrigaria a versionar cada estrutura no
 * esquema e a análise passaria a existir em dois sítios com limiares que podem
 * divergir em silêncio.
 */

import {
  analyzeInstrument,
  getInstrument,
  requiredSymbolsFor,
  smtPairsFor,
  type AnalyzeResult,
  type Candle,
  type CandleSeries,
  type SmtPair,
  type Timeframe,
} from '@trading/core';
import { ProviderRegistry } from '@trading/data';

/**
 * Timeframe de execução → timeframe da narrativa.
 *
 * Cada nível olha para o imediatamente superior, que é como o ICT define a
 * relação HTF/LTF. Saltar dois níveis (ex.: 1h a olhar para 1w) daria um viés
 * que raramente muda e deixaria de discriminar seja o que for.
 */
export const HTF_FOR: Record<Timeframe, Timeframe> = {
  '1m': '15m',
  '5m': '1h',
  '15m': '1h',
  '30m': '4h',
  '1h': '4h',
  '4h': '1d',
  '1d': '1w',
  '1w': '1M',
  '1M': '1M',
};

/** Timeframes oferecidos no seletor. */
export const TIMEFRAMES: Timeframe[] = ['1h', '4h', '1d', '1w'];

export const TIMEFRAME_LABEL: Record<string, string> = {
  '1h': '1 hora',
  '4h': '4 horas',
  '1d': 'Diário',
  '1w': 'Semanal',
  '1M': 'Mensal',
};

/**
 * As janelas macro estão calibradas para escala swing (ciclos semanais e
 * mensais). Num timeframe intradiário elas continuam a responder, mas medem o
 * ciclo errado — o eBook usa janelas de XX:45–XX:15 para essa escala. A
 * interface avisa em vez de fingir que o resultado é comparável.
 */
export function macrosCalibratedFor(timeframe: Timeframe): boolean {
  return timeframe === '1d' || timeframe === '1w' || timeframe === '1M';
}

export interface InstrumentAnalysis {
  symbol: string;
  timeframe: Timeframe;
  higherTimeframe: Timeframe;
  name: string;
  result: AnalyzeResult;
  /** Série principal, para o gráfico de preço. */
  primary: CandleSeries;
  /** Séries de referência usadas no SMT, indexadas por símbolo. */
  references: Map<string, CandleSeries>;
  pairs: SmtPair[];
  /**
   * Vela ainda em formação, se existir.
   *
   * Fica FORA da análise e só é desenhada. É o que permite o gráfico atualizar
   * ao minuto: no diário, a última vela fechada não muda o dia inteiro, mas a
   * vela viva muda a cada tick.
   */
  forming: Candle | null;
  /** Falhas de dados, para não fingir que está tudo bem quando não está. */
  failures: Map<string, string>;
  loadedAt: number;
}

/** Quantas velas carregar. 400 dá ~18 meses de diário. */
const LIMIT = 400;

export async function analyzeSymbol(
  symbol: string,
  timeframe: Timeframe = '1d',
): Promise<InstrumentAnalysis | null> {
  const instrument = getInstrument(symbol);
  if (!instrument) return null;

  const higherTimeframe = HTF_FOR[timeframe];
  const registry = new ProviderRegistry();
  const needed = requiredSymbolsFor(symbol);
  const pairs = smtPairsFor(symbol);

  const [base, htf] = await Promise.all([
    // `includeForming` traz também a vela viva; ela é separada logo a seguir.
    registry.getMany(needed, timeframe, LIMIT, { includeForming: true }),
    registry.getMany([symbol], higherTimeframe, 200),
  ]);

  const withForming = base.series.get(symbol);
  const higher = htf.series.get(symbol);
  if (!withForming || !higher) return null;

  /*
   * Separar a vela viva ANTES de analisar. Deixá-la entrar produziria estrutura
   * (CISD, MSS, displacement) que desaparece na vela seguinte — sinais fantasma
   * que aparecem e somem enquanto se olha para o ecrã.
   */
  const { closed, forming } = splitForming(withForming, timeframe);
  const primary = closed;

  const references = new Map<string, CandleSeries>();
  for (const pair of pairs) {
    const ref = base.series.get(pair.reference);
    // As referências também vêm com a vela viva — recortar, senão o SMT
    // compararia um swing fechado com um ainda a formar-se.
    if (ref) references.set(pair.reference, splitForming(ref, timeframe).closed);
  }

  const result = analyzeInstrument({
    primary,
    higher,
    references,
    smtPairs: pairs,
  });

  return {
    symbol,
    timeframe,
    higherTimeframe,
    name: instrument.name,
    result,
    primary,
    references,
    pairs,
    forming,
    failures: base.failures,
    loadedAt: Date.now(),
  };
}

/** Duração de cada timeframe, para saber se a última vela já fechou. */
const SPAN: Record<Timeframe, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
  '1M': 2_592_000_000,
};

/** Separa a vela ainda aberta do resto da série. */
function splitForming(
  series: CandleSeries,
  timeframe: Timeframe,
  now = Date.now(),
): { closed: CandleSeries; forming: Candle | null } {
  const last = series.candles[series.candles.length - 1];
  if (!last) return { closed: series, forming: null };

  const aberta = now < last.time + SPAN[timeframe];
  if (!aberta) return { closed: series, forming: null };

  return {
    closed: { ...series, candles: series.candles.slice(0, -1) },
    forming: last,
  };
}

// ---------------------------------------------------------------------------
// Preparação de dados para os gráficos
// ---------------------------------------------------------------------------

export interface ChartCandle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** Reduz a série ao troço que interessa desenhar. */
export function toChartCandles(candles: Candle[], bars: number): ChartCandle[] {
  return candles
    .slice(-bars)
    .map((c) => ({ t: c.time, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume }));
}

export interface IndexedPoint {
  t: number;
  /** Valor reindexado a 100 no início da janela. */
  v: number;
  /** Preço original, para o tooltip. */
  raw: number;
}

/**
 * Reindexa uma série a 100 no início da janela.
 *
 * É isto que torna o gráfico de SMT legível e honesto. Comparar EURUSD (1,16)
 * com o DXY (98) no mesmo eixo é impossível em valor absoluto, e a solução
 * habitual — dois eixos verticais com escalas diferentes — permite exagerar ou
 * esconder qualquer divergência consoante onde se corta cada escala.
 *
 * Reindexar a uma base comum põe as duas séries no MESMO eixo, medindo o que a
 * comparação realmente quer dizer: variação relativa. Uma divergência no
 * gráfico passa a ser uma divergência a sério.
 */
export function indexToBase(candles: Candle[], bars: number, base = 100): IndexedPoint[] {
  const slice = candles.slice(-bars);
  const first = slice[0]?.close;
  if (!first || first === 0) return [];
  return slice.map((c) => ({ t: c.time, v: (c.close / first) * base, raw: c.close }));
}

/**
 * Alinha duas séries pelos timestamps que ambas têm.
 *
 * Necessário porque os mercados fecham em dias diferentes: o BTC negoceia ao
 * fim de semana, os futuros não; os feriados dos EUA não são os do Reino Unido.
 * Desenhar por índice de array em vez de por data faria as duas linhas
 * dessincronizarem-se ao longo do gráfico, inventando divergências.
 */
export function alignByTime(
  a: Candle[],
  b: Candle[],
  bars: number,
  timeframe: Timeframe = '1d',
): { times: number[]; a: number[]; b: number[] } {
  const key = keyFor(timeframe);
  const mapB = new Map(b.map((c) => [key(c.time), c.close]));
  const times: number[] = [];
  const va: number[] = [];
  const vb: number[] = [];

  for (const candle of a.slice(-bars)) {
    const match = mapB.get(key(candle.time));
    if (match === undefined) continue;
    times.push(candle.time);
    va.push(candle.close);
    vb.push(match);
  }
  return { times, a: va, b: vb };
}

/**
 * Chave de alinhamento adequada ao timeframe.
 *
 * Em diário e acima, agrupar por DIA absorve a diferença de minuto de abertura
 * entre fontes. Em intradiário isso seria errado — colapsaria as 24 velas de 1h
 * de um dia numa só chave e o alinhamento passaria a comparar a primeira vela de
 * um mercado com uma qualquer do outro.
 */
function keyFor(timeframe: Timeframe): (ms: number) => string {
  if (timeframe === '1h' || timeframe === '4h') {
    // Bucket horário: tolera segundos de diferença sem colapsar o dia.
    const span = timeframe === '1h' ? 3_600_000 : 14_400_000;
    return (ms) => String(Math.floor(ms / span) * span);
  }
  return (ms) => new Date(ms).toISOString().slice(0, 10);
}

/** Reindexa um array de preços já alinhado. */
export function reindex(values: number[], base = 100): number[] {
  const first = values[0];
  if (!first || first === 0) return values.map(() => base);
  return values.map((v) => (v / first) * base);
}
