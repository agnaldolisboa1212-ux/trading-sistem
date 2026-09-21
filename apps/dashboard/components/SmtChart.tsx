'use client';
import { useMemo } from 'react';
import { GraficoVivo } from './vivo/GraficoVivo';
import { acharSimbolo } from '@/lib/deriv/simbolos';
import type { Vela } from '@/lib/deriv/live';

export interface SmtDivergenceMark {
  index: number;
  prevIndex: number;
  at: 'high' | 'low';
  direction: 'bullish' | 'bearish';
  description: string;
  strength: number;
}

interface Props {
  times: number[];
  primarySymbol: string;
  referenceSymbol: string;
  correlation: 'positive' | 'inverse';
  primaryVelas: Vela[]; 
  referenceScaled: number[];
  marks?: SmtDivergenceMark[];
  height?: number;
}

export function SmtChart({
  times,
  primarySymbol,
  referenceSymbol,
  primaryVelas,
  referenceScaled,
  marks = [],
  height = 340,
}: Props) {
  const graficoProps = useMemo(() => {
    const curvas = [{
      tipo: 'banda1',
      rotulo: referenceSymbol,
      pontos: referenceScaled.map((val, idx) => ({ t: times[idx]!, p: val }))
    }];

    const pRaw = primaryVelas.map(v => v.c);
    if (pRaw.length === 0) return { curvas, zonas: [] };

    const maxP = Math.max(...pRaw) + (Math.max(...pRaw) * 0.1);
    const minP = Math.min(...pRaw) - (Math.min(...pRaw) * 0.1);

    const zonas = marks.map(m => {
      const idx1 = Math.min(m.index, m.prevIndex);
      const idx2 = Math.max(m.index, m.prevIndex);
      return {
        de: times[idx1]!,
        ate: times[idx2]!,
        topo: maxP,
        base: minP,
        tipo: m.direction === 'bullish' ? 'bull' : 'bear',
        rotulo: `SMT ${m.at === 'high' ? '▲' : '▼'}`
      };
    });
    return { curvas, zonas };
  }, [times, referenceSymbol, primaryVelas, referenceScaled, marks]);

  const simboloInfo = acharSimbolo(primarySymbol);
  const casas = simboloInfo?.casas ?? 4;

  return (
    <GraficoVivo
      velas={primaryVelas}
      casas={casas}
      timeframe="1d"
      curvas={graficoProps.curvas}
      zonas={graficoProps.zonas}
      titulo={`${primarySymbol} · Divergência SMT com ${referenceSymbol}`}
      altura={height}
    />
  );
}
