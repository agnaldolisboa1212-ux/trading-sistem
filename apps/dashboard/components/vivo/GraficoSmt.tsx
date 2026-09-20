'use client';

import { useEffect, useState } from 'react';
import { SmtChart, type SmtDivergenceMark } from '../SmtChart';
import { TIMEFRAMES, type Timeframe } from '@/lib/deriv/simbolos';

interface Props {
  codigo: string;
  tf: Timeframe;
  altura: number;
  aoMudarTimeframe?: (tf: Timeframe) => void;
  cheio?: boolean;
  aoAlternarCheio?: () => void;
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

  return (
    <div className={`grafico ${cheio ? 'grafico--cheio' : ''}`}>
      <div className="grafico__barra">
        <div className="segmentos grafico__tfs">
          {TIMEFRAMES.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={t.id === tf}
              onClick={() => aoMudarTimeframe?.(t.id)}
              disabled={!aoMudarTimeframe}
            >
              {t.rotulo}
            </button>
          ))}
        </div>
        <div className="grafico__accoes">
          {aoAlternarCheio && (
            <button
              type="button"
              onClick={aoAlternarCheio}
              aria-label={cheio ? 'Sair do ecrã inteiro' : 'Ecrã inteiro'}
              title={cheio ? 'Sair (Esc)' : 'Ecrã inteiro'}
            >
              {cheio ? '✕' : '⛶'}
            </button>
          )}
        </div>
      </div>
      <div className="grafico__leitura">
        <strong className="grafico__titulo">{codigo} · Divergência SMT</strong>
      </div>
      <div className="grafico__tela" style={{ height: cheio ? undefined : altura, display: 'flex', flexDirection: 'column' }}>
        {loading ? (
          <div className="empty" style={{ height: '100%', justifyContent: 'center' }}>
            <strong>A calcular Divergências SMT...</strong>
            A alinhar as duas séries temporais ({codigo} e o seu par)
          </div>
        ) : !data || data.erro ? (
          <div className="empty" style={{ height: '100%', justifyContent: 'center' }}>
            <strong>Não foi possível mostrar o SMT</strong>
            {data?.erro ?? 'Sem dados disponíveis'}
          </div>
        ) : (
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
        )}
      </div>
    </div>
  );
}
