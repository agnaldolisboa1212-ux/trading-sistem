'use client';

import { useState, useEffect } from 'react';
import { formatarPreco } from '@/lib/deriv/simbolos';

export function ICTPanel({ codigo }: { codigo: string }) {
  const [sinal, setSinal] = useState<any>(null);

  useEffect(() => {
    // Simulando a busca do sinal ICT do backend
    // Em produção, isso bateria numa API que consome a runInstitutionalStrategies com 'ict-advanced'
    const timer = setTimeout(() => {
      setSinal({
        ativo: codigo,
        direcao: 'bullish',
        precoEntrada: 15420.50,
        stopLoss: 15400.00,
        alvo: 15500.00,
        status: 'Aguardando Entrada',
        justificativa: '[ICT ALGO] Estrutura Avançada: HTF Sweep detectado, seguido de LTF MSS e FVG alinhados.',
      });
    }, 1500);
    return () => clearTimeout(timer);
  }, [codigo]);

  return (
    <div className="ict-panel" style={{ marginTop: '20px', border: '1px solid #D8D8D8', borderRadius: '8px', padding: '16px', background: '#FAFAFA' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: '18px', color: '#0A0A0A' }}>
          Análise Avançada ICT Algo
        </h3>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', background: '#0A0A0A', color: '#FFF', padding: '4px 8px', borderRadius: '4px' }}>
          SINAL INDEPENDENTE
        </span>
      </div>

      {!sinal ? (
        <div style={{ padding: '20px', textAlign: 'center', color: '#7A7A7A', fontSize: '13px' }}>
          A analisar múltiplos timeframes (Top-Down)...
        </div>
      ) : (
        <div>
          <div style={{ marginBottom: '12px', fontSize: '14px', color: '#3D3D3D', lineHeight: '1.6' }}>
            <strong>Explicação Estratégica:</strong><br />
            {sinal.justificativa}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
            <div style={{ background: '#FFF', border: '1px solid #D8D8D8', padding: '10px', borderRadius: '4px' }}>
              <span style={{ fontSize: '11px', color: '#7A7A7A', textTransform: 'uppercase', display: 'block' }}>Entrada ({sinal.direcao})</span>
              <strong style={{ fontSize: '16px', color: sinal.direcao === 'bullish' ? '#00b894' : '#d63031' }}>
                {sinal.precoEntrada}
              </strong>
            </div>
            <div style={{ background: '#FFF', border: '1px solid #D8D8D8', padding: '10px', borderRadius: '4px' }}>
              <span style={{ fontSize: '11px', color: '#7A7A7A', textTransform: 'uppercase', display: 'block' }}>Alvo (Liquidez)</span>
              <strong style={{ fontSize: '16px', color: '#0A0A0A' }}>
                {sinal.alvo}
              </strong>
            </div>
          </div>

          <button 
            style={{
              width: '100%',
              padding: '12px',
              background: '#0A0A0A',
              color: '#FFF',
              border: 'none',
              borderRadius: '4px',
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: '12px',
              cursor: 'pointer',
              textTransform: 'uppercase'
            }}
            onClick={() => alert(`Sinal de ${sinal.direcao} enviado para a boleta.`)}
          >
            Preparar Ordem
          </button>
        </div>
      )}
    </div>
  );
}
