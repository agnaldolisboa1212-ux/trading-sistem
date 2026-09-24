import React, { useEffect, useState } from 'react';

/**
 * Subagent 3: UI/UX Masterpiece
 * Implementação Figma/Framer style: Glassmorphism.
 * O painel renderiza os resultados da Master Engine "ICT ALGO: INSTITUTIONAL FLOW".
 */
export function ICTPanel({ codigo }: { codigo: string }) {
  const [signal, setSignal] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulação da emissão aleatória de um dos modelos poderosos da Engine
    const timer = setTimeout(() => {
      const models = [
        {
          model: 'ICT ALGO: MMXM (Buy Model)',
          direction: 'bullish',
          bias: 'Bullish (Smart Money Accumulation)',
          setup: 'Original Consolidation ➔ Smart Money Reversal ➔ Buy Model',
          entry: 1.1025,
          target: 1.1100,
          stop: 1.1005,
          explanation: 'O algoritmo detetou um ciclo MMXM completo. O preço manipulou abaixo da consolidação original (SMR) e iniciou um perfil de acumulação agressivo. O alvo é o topo da consolidação original.'
        },
        {
          model: 'ICT ALGO: SILVER BULLET',
          direction: 'bearish',
          bias: 'Bearish (Time-Based Algorithmic Execution)',
          setup: 'NY AM Killzone (10:00 EST) ➔ MSS (M5) ➔ FVG Retracement',
          entry: 1.1085,
          target: 1.1020,
          stop: 1.1095,
          explanation: 'Acionado pela janela temporal de alta probabilidade (Silver Bullet). Um Displacement violento no M5 quebrou estrutura deixando um Fair Value Gap perfeitamente alinhado com o fluxo diário.'
        },
        {
          model: 'ICT ALGO: OTE (70.5%)',
          direction: 'bullish',
          bias: 'Bullish (Fibonacci Institutional Level)',
          setup: 'Impulso H4 ➔ Retração a 70.5% (Sweet Spot) ➔ Rejeição',
          entry: 1.1050,
          target: 1.1120,
          stop: 1.1030,
          explanation: 'Preço retraiu exatamente para o Sweet Spot do Optimal Trade Entry (70.5%) do último impulso de alta. O desconto institucional foi ativado.'
        }
      ];
      
      const randomModel = models[Math.floor(Math.random() * models.length)];
      setSignal(randomModel);
      setLoading(false);
    }, 4500);

    return () => clearTimeout(timer);
  }, [codigo]);

  return (
    <div style={{
      background: 'rgba(12, 12, 16, 0.85)',
      backdropFilter: 'blur(30px)',
      WebkitBackdropFilter: 'blur(30px)',
      border: '1px solid rgba(255, 255, 255, 0.05)',
      borderRadius: '24px',
      padding: '32px',
      color: '#FAFAFA',
      fontFamily: '"Inter", -apple-system, sans-serif',
      marginTop: '24px',
      boxShadow: '0 32px 80px rgba(0, 0, 0, 0.7), inset 0 1px 1px rgba(255, 255, 255, 0.1)',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Background glow effects - Dinâmico */}
      <div style={{
        position: 'absolute',
        top: '-70px',
        right: '-70px',
        width: '200px',
        height: '200px',
        background: signal?.direction === 'bullish' ? 'rgba(0, 200, 83, 0.15)' : 'rgba(255, 23, 68, 0.15)',
        filter: 'blur(80px)',
        borderRadius: '50%',
        zIndex: 0,
        transition: 'background 0.5s ease-in-out'
      }} />

      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '28px' }}>
          <h3 style={{ margin: 0, fontSize: '22px', fontWeight: 800, letterSpacing: '-0.04em', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#E0E0E0' }}>
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
            Master Engine ICT
          </h3>
          <span style={{
            background: 'rgba(255, 255, 255, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            padding: '6px 14px',
            borderRadius: '20px',
            fontSize: '11px',
            fontWeight: 800,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: loading ? '#FFF' : '#00E676',
            boxShadow: loading ? 'none' : '0 0 10px rgba(0, 230, 118, 0.2)'
          }}>
            {loading ? 'A Varrer 4 Modelos...' : 'Ativa'}
          </span>
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{ height: '28px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', animation: 'pulse 2s infinite ease-in-out' }} />
            ))}
            <style>{`
              @keyframes pulse {
                0% { opacity: 0.3; }
                50% { opacity: 0.8; }
                100% { opacity: 0.3; }
              }
            `}</style>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#888', fontSize: '15px' }}>Modelo Estratégico</span>
              <span style={{ fontWeight: 800, color: '#FBC02D', fontSize: '16px', letterSpacing: '-0.02em', textShadow: '0 0 10px rgba(251, 192, 45, 0.2)' }}>{signal.model}</span>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#888', fontSize: '15px' }}>Bias Institucional</span>
              <span style={{ fontWeight: 600, fontSize: '16px', color: signal.direction === 'bullish' ? '#00E676' : '#FF1744' }}>
                {signal.bias}
              </span>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <span style={{ color: '#888', fontSize: '15px' }}>Sequência Operacional</span>
              <span style={{ fontWeight: 500, fontSize: '14px', textAlign: 'right', maxWidth: '220px', lineHeight: '1.4' }}>{signal.setup}</span>
            </div>

            {/* Painel de Continuidade Top-Down (Multi-Timeframe) */}
            <div style={{
              background: 'rgba(255,255,255,0.02)',
              borderRadius: '12px',
              padding: '12px',
              marginTop: '4px',
              border: '1px solid rgba(255,255,255,0.04)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div style={{ textAlign: 'center', flex: 1, borderRight: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ fontSize: '10px', color: '#888', textTransform: 'uppercase' }}>Daily</div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: signal.direction === 'bullish' ? '#00E676' : '#FF1744' }}>Order Flow</div>
              </div>
              <div style={{ textAlign: 'center', flex: 1, borderRight: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ fontSize: '10px', color: '#888', textTransform: 'uppercase' }}>H4</div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#FBC02D' }}>Sweep/Liq</div>
              </div>
              <div style={{ textAlign: 'center', flex: 1 }}>
                <div style={{ fontSize: '10px', color: '#888', textTransform: 'uppercase' }}>M15/M5</div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#00B0FF' }}>Displacement</div>
              </div>
            </div>

            <div style={{ 
              background: 'rgba(0,0,0,0.4)', 
              borderRadius: '16px', 
              padding: '20px', 
              marginTop: '12px',
              border: '1px solid rgba(255,255,255,0.06)'
            }}>
              <p style={{ margin: 0, fontSize: '14px', lineHeight: '1.7', color: '#B0B0B0' }}>
                <strong style={{ color: '#FFF' }}>Relatório do Algoritmo:</strong> {signal.explanation}
              </p>
            </div>

            {/* Price Levels Grid Premium */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginTop: '16px' }}>
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '16px', textAlign: 'center', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>Entrada Exata</div>
                <div style={{ fontSize: '18px', fontWeight: 800 }}>{signal.entry}</div>
              </div>
              <div style={{ background: 'rgba(255, 23, 68, 0.08)', padding: '16px', borderRadius: '16px', textAlign: 'center', border: '1px solid rgba(255, 23, 68, 0.15)' }}>
                <div style={{ fontSize: '11px', color: '#FF5252', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>Invalidação (SL)</div>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#FF5252' }}>{signal.stop}</div>
              </div>
              <div style={{ background: 'rgba(0, 230, 118, 0.08)', padding: '16px', borderRadius: '16px', textAlign: 'center', border: '1px solid rgba(0, 230, 118, 0.15)' }}>
                <div style={{ fontSize: '11px', color: '#00E676', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>Alvo (TP)</div>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#00E676' }}>{signal.target}</div>
              </div>
            </div>

            <button 
              style={{
                width: '100%',
                background: signal.direction === 'bullish' 
                  ? 'linear-gradient(135deg, #00C853, #009624)' 
                  : 'linear-gradient(135deg, #FF1744, #D50000)',
                color: 'white',
                border: 'none',
                borderRadius: '16px',
                padding: '20px',
                fontWeight: 800,
                fontSize: '16px',
                letterSpacing: '0.02em',
                cursor: 'pointer',
                marginTop: '16px',
                boxShadow: signal.direction === 'bullish' 
                  ? '0 12px 32px rgba(0, 200, 83, 0.3)' 
                  : '0 12px 32px rgba(255, 23, 68, 0.3)',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.filter = 'brightness(1.15)';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.filter = 'brightness(1)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
              onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.97)'}
              onMouseUp={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
            >
              EXECUTAR ORDEM DE {signal.direction === 'bullish' ? 'COMPRA' : 'VENDA'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
