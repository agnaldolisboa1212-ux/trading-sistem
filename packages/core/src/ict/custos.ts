/**
 * ICT ALGO — custo típico por operação, em unidades de preço.
 *
 * São os mesmos valores com que todas as regras deste projecto foram medidas
 * (spread de conta normal, arredondado para cima). Servem ao placar ao vivo, que
 * desconta custos exactamente como o backtest — um placar sem custos poria em
 * quarentena os modelos errados.
 *
 * Instrumento que não esteja na tabela: 2 pontos base do preço, que é da ordem
 * do spread de uma moeda secundária. Pior errar por excesso.
 */

const CUSTO: Readonly<Record<string, number>> = {
  EURUSD: 0.00012,
  GBPUSD: 0.00018,
  AUDUSD: 0.0002,
  NZDUSD: 0.0003,
  USDCAD: 0.00018,
  USDCHF: 0.00018,
  EURGBP: 0.00022,
  USDJPY: 0.012,
  EURJPY: 0.018,
  GBPJPY: 0.03,
  XAUUSD: 0.35,
  XAGUSD: 0.03,
  SP500: 0.6,
  US100: 1.8,
  US30: 3,
  GER30: 2,
  UK100: 2,
  FRA40: 2,
  EU50: 2,
  JP225: 12,
  BTCUSD: 30,
  ETHUSD: 2,
};

export function custoTipico(simbolo: string, preco: number): number {
  return CUSTO[simbolo.toUpperCase()] ?? Math.abs(preco) * 0.0002;
}
