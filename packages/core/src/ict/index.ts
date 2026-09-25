/**
 * ICT ALGO — ponto de entrada.
 *
 * Algoritmo independente, construído a partir da mecânica publicada em
 * theinnercircletraders.com (cluster avançado). Lê o mercado do semanal à vela
 * de execução, decide o regime do momento e monta o setup com o modelo do site
 * que corresponde a esse regime: Venom, CRT, Reaper IFVG, Silver Bullet,
 * Unicorn, Turtle Soup ou continuação por OTE.
 *
 * Não partilha estado, tipos de sinal nem contabilidade com as estratégias
 * validadas do sistema: um sinal marcado `ICT ALGO` vem daqui e de mais lado
 * nenhum. Ver `docs/ICT-ALGO.md`.
 */

export * from './types.js';
export * from './tempo.js';
export * from './estrutura.js';
export * from './liquidez.js';
export * from './arrays.js';
export * from './crt.js';
export * from './vies.js';
export * from './regime.js';
export * from './simular.js';
export * from './custos.js';
export * from './seletor.js';
export * from './motor.js';
export * from './algo.js';
export * from './entrada.js';
export * from './poi.js';
export { smtNoVarrimento } from './modelos/venom.js';
export {
  RR_MINIMO,
  RISCO_MINIMO_ATR,
  JANELA_QUEBRA,
  JANELA_FVG,
  type ContextoModelo,
  type Avaliador,
} from './modelos/comum.js';
