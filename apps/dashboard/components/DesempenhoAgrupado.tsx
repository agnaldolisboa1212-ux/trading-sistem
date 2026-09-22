'use client';

/**
 * O log de desempenho — que pares, timeframes e estratégias estão mesmo a dar
 * resultado, ordenados pelo R total, mais lucrativo primeiro.
 */

import { useState } from 'react';
import type { Grupo } from '@/lib/desempenho';

export type { Grupo };

const ABAS = [
  { id: 'par', rotulo: 'Por par', coluna: 'Símbolo' },
  { id: 'timeframe', rotulo: 'Por timeframe', coluna: 'Timeframe' },
  { id: 'estrategia', rotulo: 'Por estratégia', coluna: 'Estratégia' },
] as const;

export function DesempenhoAgrupado({
  porPar,
  porTimeframe,
  porEstrategia,
}: {
  porPar: Grupo[];
  porTimeframe: Grupo[];
  porEstrategia: Grupo[];
}) {
  const [aba, setAba] = useState<(typeof ABAS)[number]['id']>('par');
  const grupos = aba === 'par' ? porPar : aba === 'timeframe' ? porTimeframe : porEstrategia;
  const activa = ABAS.find((a) => a.id === aba)!;

  return (
    <div>
      <div className="desempenho-tabs" role="tablist">
        {ABAS.map((a) => (
          <button key={a.id} type="button" role="tab" aria-pressed={aba === a.id} onClick={() => setAba(a.id)}>
            {a.rotulo}
          </button>
        ))}
      </div>

      {grupos.length === 0 ? (
        <div className="empty">Ainda não há operações fechadas para agrupar.</div>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>{activa.coluna}</th>
                <th className="num">Operações</th>
                <th className="num">Acerto</th>
                <th className="num">R total</th>
                <th className="num">R médio</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => (
                <tr key={g.chave}>
                  <td>
                    {g.chave}
                  </td>
                  <td className="num">{g.n}</td>
                  <td className="num">{Math.round((g.vitorias / g.n) * 100)}%</td>
                  <td className={`num ${g.totalR >= 0 ? 'bull-t' : 'bear-t'}`}>
                    {g.totalR >= 0 ? '+' : ''}
                    {g.totalR.toFixed(2)}R
                  </td>
                  <td className={`num ${g.mediaR >= 0 ? 'bull-t' : 'bear-t'}`}>
                    {g.mediaR >= 0 ? '+' : ''}
                    {g.mediaR.toFixed(2)}R
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
