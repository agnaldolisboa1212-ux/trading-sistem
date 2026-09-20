import type { EstrategiaValidada } from './validadas.js';

export interface EstatisticasVivo {
  operacoes: number;
  acerto: number;
  expectativaR: number;
}

export interface ResultadoConviccao {
  conviccao: number;
  alertas: string[];
}

/**
 * Calcula a convicção dinâmica usando atualização Bayesiana entre o backtest e os resultados ao vivo.
 * 
 * @param estrategia A estratégia validada com as estatísticas de backtest.
 * @param vivo As estatísticas medidas ao vivo.
 * @returns A convicção atualizada e eventuais alertas se o desempenho divergir muito.
 */
export function conviccaoDinamica(
  estrategia: EstrategiaValidada,
  vivo?: EstatisticasVivo,
): ResultadoConviccao {
  const st = estrategia.estatistica;
  const acertoBacktest = st.acerto;
  const nBacktest = st.operacoes;

  if (!vivo || vivo.operacoes === 0) {
    return { conviccao: acertoBacktest, alertas: [] };
  }

  const nVivo = vivo.operacoes;
  const acertoVivo = vivo.acerto;

  // Atualização Bayesiana (média ponderada pelo número de operações)
  const conviccao = (acertoBacktest * nBacktest + acertoVivo * nVivo) / (nBacktest + nVivo);

  const alertas: string[] = [];

  if (nVivo >= 20) {
    // Alerta se divergir mais de 15 pontos percentuais
    if (Math.abs(acertoVivo - acertoBacktest) > 0.15) {
      alertas.push(
        `Estratégia '${estrategia.id}': A taxa de acerto ao vivo (${Math.round(acertoVivo * 100)}%) ` +
        `diverge mais de 15pp do backtest (${Math.round(acertoBacktest * 100)}%).`
      );
    }

    // Alerta se estiver a perder dinheiro: expectativaR negativa
    if (vivo.expectativaR < 0) {
      alertas.push(
        `Estratégia '${estrategia.id}' está com expectativa negativa ao vivo ` +
        `(${vivo.expectativaR.toFixed(2)}R em ${nVivo} operações).`
      );
    }
  }

  return { conviccao, alertas };
}
