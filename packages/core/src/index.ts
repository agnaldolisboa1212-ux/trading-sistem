/**
 * @trading/core — motor de estrategia MMXM + SMT.
 *
 * Este pacote e PURO: nao faz rede, nao toca em base de dados e nao le o
 * relogio a nao ser onde recebe `now` injetado. Isso torna cada decisao
 * reproduzivel num backtest e testavel sem infraestrutura.
 */

// Tipos
export * from './types/market.js';
export * from './types/structure.js';
export * from './types/signal.js';

// Indicadores ICT
export * from './indicators/swings.js';
export * from './indicators/fvg.js';
export * from './indicators/blocks.js';
export * from './indicators/shifts.js';
export * from './indicators/liquidity.js';
export * from './indicators/quality.js';

// SMT
export * from './smt/divergence.js';

// MMXM
export * from './mmxm/consolidation.js';
export * from './mmxm/model.js';

// Tempo (macros em escala swing)
export * from './time/windows.js';

// Sinal
export * from './signal/entries.js';
export * from './signal/checklist.js';
export * from './signal/analyze.js';
export * from './signal/exits.js';
export * from './signal/estado-plano.js';
export * from './signal/perfil-sinais.js';
export * from './signal/acompanhamento.js';

// Noticias de alto impacto (regra de prudencia, nao vantagem medida)
export * from './noticias/risco.js';

// Estrategias institucionais (complementares ao MMXM/SMT, nao substitutas)
export * from './strategies/index.js';

// Risco
export * from './risk/sizing.js';

// Universo
export * from './universe.js';
