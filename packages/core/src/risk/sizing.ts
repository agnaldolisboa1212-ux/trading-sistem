/**
 * Dimensionamento de posicao, alvos em multiplos de R e expectativa.
 *
 * NOTA SOBRE O OBJETIVO 1:5 - 1:10
 * ---------------------------------
 * "entrar com 100 USD e sair com 500 a 1000 USD" so fecha a matematica se esses
 * 100 USD forem o valor EM RISCO (a perda total caso o stop seja atingido), e
 * nao a margem depositada. Com R:R 1:5, arriscar 100 USD gera 500 USD de lucro.
 *
 * Isso implica arriscar 100% do valor alocado numa unica operacao. Nenhum desk
 * institucional opera assim: o padrao e arriscar 0,5% a 2% do capital por
 * operacao, precisamente porque alvos de 5R a 10R tem taxa de acerto baixa
 * (tipicamente 20-35% neste tipo de setup) e e preciso sobreviver a sequencias
 * longas de perdas para que a expectativa positiva se materialize.
 *
 * Por isso este modulo dimensiona por PERCENTAGEM DE RISCO da conta e reporta a
 * expectativa. `simulateSequence` existe para mostrar, com numeros, o que uma
 * sequencia realista faz ao capital. A decisao final e do utilizador — o sistema
 * so garante que ela e tomada com a matematica a vista.
 */

import type { Direction } from '../types/market.js';

export interface RiskConfig {
  /** Saldo da conta na moeda de referencia. */
  accountBalance: number;
  /** Percentagem do saldo arriscada por operacao (1 = 1%). */
  riskPercentPerTrade: number;
  /** Risco maximo agregado em posicoes abertas simultaneamente (%). */
  maxPortfolioRiskPercent: number;
  /** Numero maximo de posicoes abertas ao mesmo tempo. */
  maxConcurrentPositions: number;
}

export const DEFAULT_RISK: RiskConfig = {
  accountBalance: 1000,
  riskPercentPerTrade: 1,
  maxPortfolioRiskPercent: 5,
  maxConcurrentPositions: 5,
};

export interface PositionSize {
  /** Valor monetario em risco se o stop for atingido. */
  riskAmount: number;
  /** Distancia entre entrada e stop, em unidades de preco. */
  stopDistance: number;
  /**
   * Tamanho da posicao em UNIDADES do ativo.
   * Multiplicar pelo valor do contrato do broker para obter lotes.
   */
  units: number;
  /** Valor nocional da posicao. */
  notional: number;
  /** Alavancagem implicita (nocional / saldo). */
  impliedLeverage: number;
  warnings: string[];
}

/**
 * Calcula o tamanho da posicao a partir do risco percentual.
 *
 * A formula e simples e deliberadamente independente do broker:
 *   unidades = (saldo x risco%) / distancia_do_stop
 */
export function calculatePositionSize(
  entry: number,
  stopLoss: number,
  config: RiskConfig,
): PositionSize {
  const warnings: string[] = [];
  const stopDistance = Math.abs(entry - stopLoss);

  if (stopDistance <= 0) {
    return {
      riskAmount: 0,
      stopDistance: 0,
      units: 0,
      notional: 0,
      impliedLeverage: 0,
      warnings: ['Distancia de stop igual a zero — operacao impossivel de dimensionar.'],
    };
  }

  const riskAmount = config.accountBalance * (config.riskPercentPerTrade / 100);
  const units = riskAmount / stopDistance;
  const notional = units * entry;
  const impliedLeverage = config.accountBalance > 0 ? notional / config.accountBalance : 0;

  if (config.riskPercentPerTrade > 2) {
    warnings.push(
      `Risco de ${config.riskPercentPerTrade}% por operacao esta acima do intervalo ` +
        'institucional de 0,5% a 2%. Uma sequencia de 5 perdas custaria ' +
        `${(config.riskPercentPerTrade * 5).toFixed(0)}% da conta.`,
    );
  }

  if (impliedLeverage > 30) {
    warnings.push(
      `Alavancagem implicita de ${impliedLeverage.toFixed(1)}x — verificar se o broker a permite ` +
        'e se a margem suporta oscilacoes de varias semanas.',
    );
  }

  return { riskAmount, stopDistance, units, notional, impliedLeverage, warnings };
}

export interface TargetPlan {
  /** Preco do alvo. */
  price: number;
  /** Multiplo de R que este alvo representa. */
  rMultiple: number;
  /** Fracao da posicao a fechar neste alvo (0..1). */
  closeFraction: number;
  rationale: string;
}

export interface TargetPlanInput {
  entry: number;
  stopLoss: number;
  direction: Direction;
  /** Alvo estrutural: a consolidacao original do MMXM. */
  consolidationTarget: number;
  /** Draw on liquidity — o alvo final, o "iman". */
  drawOnLiquidityTarget: number | null;
  /** R minimo exigido para o sinal ser emitido. */
  minRMultiple?: number;
}

/**
 * Constroi o plano de saidas.
 *
 * Escalonamento pensado para swing de semanas:
 *   - TP1 a 2R: fecha 30% e liberta pressao psicologica; move o stop para BE.
 *   - TP2 na consolidacao original: fecha 40% — e o alvo que o eBook define
 *     como conclusao do modelo ("until the original consolidation is reached").
 *   - TP3 no draw on liquidity: 30% restantes correm ate ao iman.
 *
 * O runner e o que produz os 1:5 a 1:10. Fechar tudo no TP1 mata precisamente a
 * parte da distribuicao de retornos que torna a estrategia lucrativa.
 */
export function buildTargetPlan(input: TargetPlanInput): {
  targets: TargetPlan[];
  maxR: number;
  blendedR: number;
  viable: boolean;
  reason: string;
} {
  const { entry, stopLoss, direction, consolidationTarget, drawOnLiquidityTarget } = input;
  const minR = input.minRMultiple ?? 3;
  const risk = Math.abs(entry - stopLoss);

  if (risk <= 0) {
    return { targets: [], maxR: 0, blendedR: 0, viable: false, reason: 'Risco nulo.' };
  }

  const rOf = (price: number) =>
    direction === 'bullish' ? (price - entry) / risk : (entry - price) / risk;

  const targets: TargetPlan[] = [];

  // TP1 — 2R fixo.
  const tp1Price = direction === 'bullish' ? entry + risk * 2 : entry - risk * 2;
  targets.push({
    price: tp1Price,
    rMultiple: 2,
    closeFraction: 0.3,
    rationale: 'Parcial a 2R: garante que a operacao deixa de poder virar perda. Stop para break-even.',
  });

  // TP2 — consolidacao original (conclusao estrutural do modelo).
  const r2 = rOf(consolidationTarget);
  if (r2 > 2) {
    targets.push({
      price: consolidationTarget,
      rMultiple: r2,
      closeFraction: 0.4,
      rationale:
        'Consolidacao original do MMXM — o eBook define este nivel como a conclusao do modelo ' +
        '("until the original consolidation is reached").',
    });
  }

  // TP3 — draw on liquidity (o runner).
  if (drawOnLiquidityTarget !== null) {
    const r3 = rOf(drawOnLiquidityTarget);
    if (r3 > (targets[targets.length - 1]?.rMultiple ?? 2)) {
      targets.push({
        price: drawOnLiquidityTarget,
        rMultiple: r3,
        closeFraction: 1 - targets.reduce((a, t) => a + t.closeFraction, 0),
        rationale:
          'Draw on liquidity — o "iman" do modelo. E este runner que produz os multiplos de ' +
          '5R a 10R; fechar antes elimina a cauda que sustenta a expectativa.',
      });
    }
  }

  // Normaliza fracoes para somarem exatamente 1.
  const totalFraction = targets.reduce((a, t) => a + t.closeFraction, 0);
  if (totalFraction > 0 && Math.abs(totalFraction - 1) > 1e-9) {
    for (const t of targets) t.closeFraction /= totalFraction;
  }

  const maxR = targets.reduce((max, t) => Math.max(max, t.rMultiple), 0);
  const blendedR = targets.reduce((acc, t) => acc + t.rMultiple * t.closeFraction, 0);
  const viable = maxR >= minR;

  return {
    targets,
    maxR,
    blendedR,
    viable,
    reason: viable
      ? `Alvo maximo de ${maxR.toFixed(1)}R (media ponderada ${blendedR.toFixed(1)}R).`
      : `Alvo maximo de apenas ${maxR.toFixed(1)}R, abaixo do minimo exigido de ${minR}R. ` +
        'Setup rejeitado: a distancia ate a liquidez nao compensa o risco.',
  };
}

/**
 * Expectativa matematica por operacao, em multiplos de R.
 *   E = (taxa_acerto x R_medio_ganho) - (1 - taxa_acerto)
 */
export function expectancy(winRate: number, averageWinR: number): number {
  return winRate * averageWinR - (1 - winRate);
}

/**
 * Taxa de acerto minima para nao perder dinheiro a um dado R.
 * Util para calibrar expectativas: a 5R bastam ~16,7% de acertos.
 */
export function breakEvenWinRate(averageWinR: number): number {
  return 1 / (1 + averageWinR);
}

export interface SequenceResult {
  finalBalance: number;
  peakBalance: number;
  maxDrawdownPercent: number;
  /** True se o capital caiu abaixo de 20% do inicial (ruina pratica). */
  ruined: boolean;
}

/**
 * Simula uma sequencia de operacoes com risco fixo percentual.
 *
 * Serve para responder, com numeros, a pergunta "e se eu arriscar tudo numa
 * operacao?" — basta correr com `riskPercentPerTrade: 100`.
 */
export function simulateSequence(
  outcomes: number[],
  config: RiskConfig,
): SequenceResult {
  let balance = config.accountBalance;
  let peak = balance;
  let maxDd = 0;

  for (const r of outcomes) {
    const risk = balance * (config.riskPercentPerTrade / 100);
    balance += risk * r;
    if (balance <= 0) {
      return { finalBalance: 0, peakBalance: peak, maxDrawdownPercent: 100, ruined: true };
    }
    peak = Math.max(peak, balance);
    maxDd = Math.max(maxDd, (peak - balance) / peak);
  }

  return {
    finalBalance: balance,
    peakBalance: peak,
    maxDrawdownPercent: maxDd * 100,
    ruined: balance < config.accountBalance * 0.2,
  };
}

/** Verifica se uma nova posicao cabe nos limites de risco do portfolio. */
export function canOpenPosition(
  openPositions: Array<{ riskAmount: number }>,
  newRiskAmount: number,
  config: RiskConfig,
): { allowed: boolean; reason: string } {
  if (openPositions.length >= config.maxConcurrentPositions) {
    return {
      allowed: false,
      reason: `Limite de ${config.maxConcurrentPositions} posicoes simultaneas ja atingido.`,
    };
  }

  const currentRisk = openPositions.reduce((a, p) => a + p.riskAmount, 0);
  const maxRisk = config.accountBalance * (config.maxPortfolioRiskPercent / 100);

  if (currentRisk + newRiskAmount > maxRisk) {
    return {
      allowed: false,
      reason:
        `Risco agregado passaria de ${(((currentRisk + newRiskAmount) / config.accountBalance) * 100).toFixed(1)}% ` +
        `(limite: ${config.maxPortfolioRiskPercent}%).`,
    };
  }

  return { allowed: true, reason: 'Dentro dos limites de risco.' };
}
