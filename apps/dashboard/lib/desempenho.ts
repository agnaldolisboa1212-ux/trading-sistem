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
