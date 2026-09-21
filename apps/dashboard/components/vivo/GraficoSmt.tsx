'use client';

import { useEffect, useState, useMemo } from 'react';
import { GraficoVivo } from './GraficoVivo';
import { TIMEFRAMES, type Timeframe, acharSimbolo } from '@/lib/deriv/simbolos';
import type { Vela } from '@/lib/deriv/live';

interface Props {
  codigo: string;
  tf: Timeframe;
  altura: number;
  aoMudarTimeframe?: (tf: Timeframe) => void;
  cheio?: boolean;
  aoAlternarCheio?: () => void;
}

export interface SmtDivergenceMark {
  index: number;
  prevIndex: number;
  at: 'high' | 'low';
  direction: 'bullish' | 'bearish';
  description: string;
  strength: number;
}

interface SmtData {
  times: number[];
  primarySymbol: string;
  referenceSymbol: string;
  correlation: 'positive' | 'inverse';
  primary: Vela[];
  reference: number[];
  primaryRaw: number[];
  referenceRaw: number[];
  marks: SmtDivergenceMark[];
  erro?: string;
}

export function GraficoSmt({ codigo, tf, altura, aoMudarTimeframe, cheio, aoAlternarCheio }: Props) {
  const [data, setData] = useState<SmtData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    
    fetch(`/api/smt-referencia?s=${encodeURIComponent(codigo)}&tf=${tf}`)
      .then(res => res.json())
      .then(json => {
        if (vivo) {
          setData(json);
          setLoading(false);
        }
      })
      .catch(() => {
        if (vivo) {
          setData({ erro: 'Falha ao buscar dados do par de referência' } as SmtData);
          setLoading(false);
        }
      });
      
    return () => { vivo = false; };
  }, [codigo, tf]);

  const graficoProps = useMemo(() => {
    if (!data || data.erro || data.primary.length === 0) return null;

    const curvas = [{
      tipo: 'banda1', // Usamos banda1 por ter uma cor visível
      rotulo: data.referenceSymbol,
      pontos: data.reference.map((val, idx) => ({ t: data.times[idx]!, p: val }))
    }];

    // Para gerar faixas verticais, usamos a funcionalidade "zonas"
    // Como o GraficoVivo requer `topo` e `base`, extraímos o min/max da série
    const pRaw = data.primaryRaw;
    const maxP = Math.max(...pRaw) + (Math.max(...pRaw) * 0.1);
    const minP = Math.min(...pRaw) - (Math.min(...pRaw) * 0.1);

    const zonas = data.marks.map(m => {
      const idx1 = Math.min(m.index, m.prevIndex);
      const idx2 = Math.max(m.index, m.prevIndex);
      return {
        de: data.times[idx1]!,
        ate: data.times[idx2]!,
        topo: maxP,
        base: minP,
        tipo: m.direction === 'bullish' ? 'bull' : 'bear',
        rotulo: `SMT ${m.at === 'high' ? '▲' : '▼'}`
      };
    });

    return { curvas, zonas };
  }, [data]);

  const simboloInfo = acharSimbolo(codigo);
  const casas = simboloInfo?.casas ?? 4;

  if (loading) {
    return (
      <div className={`grafico ${cheio ? 'grafico--cheio' : ''}`}>
        <div className="grafico__tela" style={{ height: cheio ? undefined : altura, display: 'flex', flexDirection: 'column' }}>
          <div className="empty" style={{ height: '100%', justifyContent: 'center' }}>
            <strong>A calcular Divergências SMT...</strong>
            A alinhar as duas séries temporais ({codigo} e o seu par)
          </div>
        </div>
      </div>
    );
  }

  if (!data || data.erro || !graficoProps) {
    return (
      <div className={`grafico ${cheio ? 'grafico--cheio' : ''}`}>
        <div className="grafico__tela" style={{ height: cheio ? undefined : altura, display: 'flex', flexDirection: 'column' }}>
          <div className="empty" style={{ height: '100%', justifyContent: 'center' }}>
            <strong>Não foi possível mostrar o SMT</strong>
            {data?.erro ?? 'Sem dados disponíveis'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <GraficoVivo
      velas={data.primary}
      casas={casas}
      timeframe={tf}
      curvas={graficoProps.curvas}
      zonas={graficoProps.zonas}
      titulo={`${codigo} · Divergência SMT com ${data.referenceSymbol}`}
      altura={altura}
      cheio={cheio}
      aoAlternarCheio={aoAlternarCheio}
      aoMudarTimeframe={aoMudarTimeframe}
    />
  );
}
