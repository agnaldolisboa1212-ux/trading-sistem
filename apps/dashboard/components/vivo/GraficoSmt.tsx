'use client';

import { useEffect, useState } from 'react';
import { SmtChart, type SmtDivergenceMark } from '../SmtChart';
import { type Timeframe } from '@/lib/deriv/simbolos';

interface Props {
  codigo: string;
  tf: Timeframe;
  altura: number;
}

interface SmtData {
  times: number[];
  primarySymbol: string;
  referenceSymbol: string;
  correlation: 'positive' | 'inverse';
  primary: number[];
  reference: number[];
  primaryRaw: number[];
  referenceRaw: number[];
  marks: SmtDivergenceMark[];
  erro?: string;
}

export function GraficoSmt({ codigo, tf, altura }: Props) {
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

  if (loading) {
    return (
      <div className="grafico-vivo" style={{ height: altura }}>
        <div className="empty" style={{ height: '100%', justifyContent: 'center' }}>
          <strong>A calcular Divergências SMT...</strong>
          A alinhar as duas séries temporais ({codigo} e o seu par)
        </div>
      </div>
    );
  }

  if (!data || data.erro) {
    return (
      <div className="grafico-vivo" style={{ height: altura }}>
        <div className="empty" style={{ height: '100%', justifyContent: 'center' }}>
          <strong>Não foi possível mostrar o SMT</strong>
          {data?.erro ?? 'Sem dados disponíveis'}
        </div>
      </div>
    );
  }

  return (
    <div className="grafico-vivo" style={{ height: altura, display: 'flex', flexDirection: 'column' }}>
      <SmtChart
        times={data.times}
        primarySymbol={data.primarySymbol}
        referenceSymbol={data.referenceSymbol}
        correlation={data.correlation}
        primary={data.primary}
        reference={data.reference}
        primaryRaw={data.primaryRaw}
        referenceRaw={data.referenceRaw}
        marks={data.marks}
        height={altura}
      />
    </div>
  );
}
