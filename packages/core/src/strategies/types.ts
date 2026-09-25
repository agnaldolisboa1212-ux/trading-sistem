/**
 * Tipos comuns das estratégias institucionais.
 *
 * COMO AS MESAS DECIDEM — e o que daqui é replicável
 * ---------------------------------------------------
 * Uma mesa institucional separa duas decisões que o retalho funde numa só:
 *
 *   1. **O quê e porquê** (o gestor de carteira / a mesa de risco). Vem de um
 *      modelo de valor, de um mandato, de uma cobertura ou de um sinal
 *      quantitativo. Não vem de um gráfico.
 *   2. **Onde e quando** (a mesa de execução). Aqui sim existe um vocabulário
 *      técnico, e é *medido*: a execução é avaliada contra referências como o
 *      VWAP, o preço de chegada (implementation shortfall) e o preço médio
 *      ponderado no intervalo. O VWAP é a referência dominante — é o número que
 *      diz se o trader executou bem ou mal.
 *
 * Este pacote só consegue reproduzir a camada (2), e mesmo essa parcialmente:
 * sem livro de ordens, sem fluxo por venue, sem dark pools. O que sobra é uma
 * família de estatísticas sobre OHLCV que descrevem **onde o preço passou tempo
 * e volume** e **onde saiu depressa** — que é a sombra observável do processo
 * institucional, não o processo.
 *
 * Nada aqui prova vantagem. Ver `docs/estrategias-institucionais.md`.
 *
 * PUREZA: nenhuma função deste diretório faz rede, toca em base de dados ou lê
 * o relógio. Tudo o que precisa de tempo usa `candle.time`.
 */

import type { Direction, Timeframe } from '../types/market.js';
import type { TargetPlan } from '../risk/sizing.js';

/** Identificador estável de cada estratégia — persistido e usado em filtros. */
export type StrategyId =
  | 'supply-demand'
  | 'support-resistance'
  | 'vwap-bands'
  | 'volume-profile';

/**
 * Regime que a estratégia está a assumir.
 *
 * Distinção importante: as mesmas estruturas produzem sinais opostos consoante
 * o regime. Uma resistência é um sítio para vender num mercado em balanço e um
 * sítio para comprar (na quebra) num mercado em tendência. Declarar o regime
 * torna essa suposição explícita em vez de escondida.
 */
export type StrategyRegime = 'mean-reversion' | 'continuation';

export interface StrategySignal {
  /** Estratégias institucionais (contexto) ou validadas (as que geram sinais). */
  strategy: StrategyId | import('./validadas.js').EstrategiaValidadaId | import('./em-teste.js').EstrategiaEmTesteId;
  symbol: string;
  timeframe: Timeframe;
  direction: Direction;
  regime: StrategyRegime;

  /** Índice da vela FECHADA que produziu o sinal. */
  index: number;
  /** Timestamp de abertura dessa vela (ms UTC). */
  generatedAt: number;
  /** Preço de referência (fecho da vela geradora). */
  referencePrice: number;

  // --- Plano de execução ---------------------------------------------------
  entryZoneLow: number;
  entryZoneHigh: number;
  entryPrice: number;
  stopLoss: number;
  targets: TargetPlan[];
  /** Maior múltiplo de R alcançável no plano. */
  maxRMultiple: number;
  /**
   * `limit`: ordem pendente no preço de entrada, à espera de que o preço volte
   * (o caso do ICT ALGO no FVG) — o preço afastado da entrada é o normal, não
   * "entrada perdida". Omisso = a mercado.
   */
  entryType?: 'market' | 'limit';

  /**
   * Convicção em 0..1.
   *
   * **NÃO é uma probabilidade.** É um ordenamento relativo *dentro da mesma
   * estratégia*, construído a partir das componentes que a técnica define
   * (número de toques, frescura da zona, distância em sigmas...). Comparar a
   * convicção de duas estratégias diferentes não tem significado estatístico
   * enquanto não houver uma calibração medida contra resultados reais.
   */
  conviction: number;

  /** Explicação legível de porque este sinal existe. Vai para Telegram/painel. */
  rationale: string;
  /** Suposições que esta técnica faz e que o mercado pode violar. */
  assumptions: string[];
  /** Problemas concretos detetados nesta série/instância. */
  warnings: string[];
}

/** Entrada partilhada por todos os planeadores de estratégia. */
export interface StrategyPlanContext {
  symbol: string;
  timeframe: Timeframe;
  /** R mínimo exigido para o sinal ser emitido. Abaixo disto devolve null. */
  minRMultiple?: number;
}

/** Média aritmética, 0 para série vazia. */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Desvio-padrão amostral (denominador n−1). 0 com menos de 2 amostras. */
export function stdDev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let acc = 0;
  for (const v of values) acc += (v - m) * (v - m);
  return Math.sqrt(acc / (values.length - 1));
}

/** Limita um valor ao intervalo [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Decaimento exponencial por idade, em velas.
 *
 * Serve para exprimir "um nível de há 300 velas informa menos que um de há 10"
 * sem o cortar abruptamente. `halfLife` é o número de velas ao fim do qual o
 * peso cai para metade.
 */
export function ageDecay(barsAgo: number, halfLife: number): number {
  if (halfLife <= 0) return 1;
  return Math.pow(0.5, Math.max(0, barsAgo) / halfLife);
}

/**
 * True quando a série não traz volume utilizável.
 *
 * O forex spot não tem volume consolidado — não existe bolsa central. As fontes
 * devolvem 0 ou tick-count. Toda a análise ponderada por volume (VWAP, perfil)
 * degenera silenciosamente em análise ponderada por tempo se isto não for
 * verificado.
 */
export function volumeIsUsable(candles: readonly { volume: number }[]): boolean {
  if (candles.length === 0) return false;
  let positive = 0;
  for (const c of candles) if (c.volume > 0) positive++;
  return positive / candles.length >= 0.9;
}
