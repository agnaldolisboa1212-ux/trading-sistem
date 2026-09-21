/**
 * Matemática do desempenho — partilhada entre o Financeiro (servidor, todos os
 * sinais do sistema) e a vista pessoal por conta (cliente, só os marcados
 * como negociados). As duas leem os mesmos `resultado_r` de `sinais_tempo_real`;
 * só muda QUAIS linhas entram.
 */

import type { SinalTempoRealRow } from './supabase';

export interface Estatisticas {
  n: number;
  totalR: number;
  winRate: number;
  avgWin: number;
  expectancy: number;
  best: number;
  concentration: number;
}

export function calcularEstatisticas(rValues: number[]): Estatisticas {
  const totalR = rValues.reduce((a, b) => a + b, 0);
  const wins = rValues.filter((r) => r > 0.05);
  const winRate = rValues.length > 0 ? wins.length / rValues.length : 0;
  const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const expectancy = rValues.length > 0 ? winRate * avgWin - (1 - winRate) : 0;
  const best = rValues.length > 0 ? Math.max(...rValues) : 0;
  const concentration = totalR > 0 ? best / totalR : 0;
  return { n: rValues.length, totalR, winRate, avgWin, expectancy, best, concentration };
}

export interface Grupo {
  chave: string;
  n: number;
  vitorias: number;
  totalR: number;
  mediaR: number;
  /** Todas as operações deste grupo vêm de uma estratégia em teste. */
  emTeste?: boolean;
}

export function agrupar(
  fechados: readonly SinalTempoRealRow[],
  campo: 'simbolo' | 'timeframe' | 'estrategia',
  nomeEstrategia: (id: string) => string,
  emTesteId: (id: string) => boolean,
): Grupo[] {
  const mapa = new Map<string, { n: number; vitorias: number; totalR: number; emTeste: Set<boolean> }>();
  for (const r of fechados) {
    if (r.resultado_r === null) continue;
    const chave =
      campo === 'estrategia' ? nomeEstrategia(r.estrategia) : campo === 'timeframe' ? r.timeframe.toUpperCase() : r.simbolo;
    const g = mapa.get(chave) ?? { n: 0, vitorias: 0, totalR: 0, emTeste: new Set<boolean>() };
    g.n += 1;
    if (r.resultado_r > 0.05) g.vitorias += 1;
    g.totalR += r.resultado_r;
    g.emTeste.add(emTesteId(r.estrategia));
    mapa.set(chave, g);
  }
  return [...mapa.entries()]
    .map(([chave, g]) => ({
      chave,
      n: g.n,
      vitorias: g.vitorias,
      totalR: g.totalR,
      mediaR: g.totalR / g.n,
      emTeste: g.emTeste.size === 1 && g.emTeste.has(true),
    }))
    .sort((a, b) => b.totalR - a.totalR);
}

// ---------------------------------------------------------------------------
// Estatísticas em moeda real — para a conta Deriv conectada
// ---------------------------------------------------------------------------

export interface EstatisticasDeriv {
  totalTrades: number;
  vitorias: number;
  derrotas: number;
  winRate: number;
  lucroTotal: number;
  melhorTrade: number;
  piorTrade: number;
  mediaGanhos: number;
  mediaPerdas: number;
  expectativa: number;
  melhorStreak: number;
  piorStreak: number;
  factorLucro: number;
  moeda: string;
}

interface TradeDeriv {
  lucro: number;
  abertoEm: number;
  fechadoEm: number;
  simbolo: string;
  tipo: string;
}

export function calcularEstatisticasDeriv(trades: TradeDeriv[], moeda = 'USD'): EstatisticasDeriv {
  if (trades.length === 0) {
    return {
      totalTrades: 0, vitorias: 0, derrotas: 0, winRate: 0,
      lucroTotal: 0, melhorTrade: 0, piorTrade: 0,
      mediaGanhos: 0, mediaPerdas: 0, expectativa: 0,
      melhorStreak: 0, piorStreak: 0, factorLucro: 0, moeda,
    };
  }

  const ganhos = trades.filter((t) => t.lucro > 0);
  const perdas = trades.filter((t) => t.lucro <= 0);
  const somaGanhos = ganhos.reduce((a, t) => a + t.lucro, 0);
  const somaPerdas = Math.abs(perdas.reduce((a, t) => a + t.lucro, 0));

  const mediaGanhos = ganhos.length > 0 ? somaGanhos / ganhos.length : 0;
  const mediaPerdas = perdas.length > 0 ? somaPerdas / perdas.length : 0;
  const winRate = trades.length > 0 ? ganhos.length / trades.length : 0;

  // Streaks
  let melhorStreak = 0;
  let piorStreak = 0;
  let streakActual = 0;
  let ultimoGanhou: boolean | null = null;
  for (const t of trades) {
    const ganhou = t.lucro > 0;
    if (ganhou === ultimoGanhou) {
      streakActual++;
    } else {
      streakActual = 1;
      ultimoGanhou = ganhou;
    }
    if (ganhou && streakActual > melhorStreak) melhorStreak = streakActual;
    if (!ganhou && streakActual > piorStreak) piorStreak = streakActual;
  }

  return {
    totalTrades: trades.length,
    vitorias: ganhos.length,
    derrotas: perdas.length,
    winRate,
    lucroTotal: somaGanhos - somaPerdas,
    melhorTrade: trades.length > 0 ? Math.max(...trades.map((t) => t.lucro)) : 0,
    piorTrade: trades.length > 0 ? Math.min(...trades.map((t) => t.lucro)) : 0,
    mediaGanhos,
    mediaPerdas,
    expectativa: winRate * mediaGanhos - (1 - winRate) * mediaPerdas,
    melhorStreak,
    piorStreak,
    factorLucro: somaPerdas > 0 ? somaGanhos / somaPerdas : somaGanhos > 0 ? Infinity : 0,
    moeda,
  };
}

// ---------------------------------------------------------------------------
// Matching automático: trades da Deriv ↔ sinais do sistema
// ---------------------------------------------------------------------------

export interface TradeComMatch {
  /** Dados do trade Deriv. */
  trade: TradeDeriv & { id: number; compra: number; venda: number; descricao: string };
  /** O sinal do sistema que casou, se houver. */
  sinalId: string | null;
  sinalEstrategia: string | null;
  sinalDireccao: string | null;
  /** Confiança do match: 'exacto' | 'provavel' | null */
  confianca: 'exacto' | 'provavel' | null;
}

/**
 * Casa trades Deriv com sinais do sistema.
 *
 * O matching é por:
 *   1. Símbolo equivalente (normalizado sem prefixos Deriv)
 *   2. Direcção compatível (CALL ↔ bullish, PUT ↔ bearish)
 *   3. Proximidade temporal: o trade foi aberto dentro de uma janela do sinal
 *
 * Janela por omissão: ±4 horas. Razão: o sinal pode ser gerado no fecho da
 * vela de 4h e a pessoa só comprar na vela seguinte.
 */
export function matchTradesSinais(
  trades: Array<TradeDeriv & { id: number; compra: number; venda: number; descricao: string }>,
  sinais: readonly SinalTempoRealRow[],
  janelaMs = 4 * 60 * 60 * 1000,
): TradeComMatch[] {
  const sinaisOrdenados = [...sinais].sort(
    (a, b) => new Date(a.gerado_em).getTime() - new Date(b.gerado_em).getTime(),
  );

  return trades.map((trade) => {
    let melhorSinal: SinalTempoRealRow | null = null;
    let melhorDist = Infinity;
    let confianca: 'exacto' | 'provavel' | null = null;

    for (const s of sinaisOrdenados) {
      // Normalizar símbolos: Deriv usa "frxEURUSD" → "EURUSD", sistema usa "EURUSD"
      const simboloTrade = normalizarSimbolo(trade.simbolo);
      const simboloSinal = normalizarSimbolo(s.simbolo);
      if (simboloTrade !== simboloSinal) continue;

      // Direcção compatível
      const tradeDir = trade.tipo.toUpperCase().includes('CALL') || trade.tipo.toUpperCase().includes('MULTUP')
        ? 'bullish'
        : trade.tipo.toUpperCase().includes('PUT') || trade.tipo.toUpperCase().includes('MULTDOWN')
          ? 'bearish'
          : null;
      if (tradeDir && tradeDir !== s.direccao) continue;

      // Proximidade temporal
      const sinalTs = new Date(s.gerado_em).getTime();
      const dist = Math.abs(trade.abertoEm - sinalTs);
      if (dist <= janelaMs && dist < melhorDist) {
        melhorDist = dist;
        melhorSinal = s;
        confianca = dist <= 30 * 60 * 1000 ? 'exacto' : 'provavel';
      }
    }

    return {
      trade,
      sinalId: melhorSinal?.id ?? null,
      sinalEstrategia: melhorSinal?.estrategia ?? null,
      sinalDireccao: melhorSinal?.direccao ?? null,
      confianca: melhorSinal ? confianca : null,
    };
  });
}

/** Remove prefixos da Deriv (frx, OTC_, cry, etc.) e normaliza para maiúsculas. */
function normalizarSimbolo(s: string): string {
  return s
    .replace(/^frx/i, '')
    .replace(/^OTC_/i, '')
    .replace(/^cry/i, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}
