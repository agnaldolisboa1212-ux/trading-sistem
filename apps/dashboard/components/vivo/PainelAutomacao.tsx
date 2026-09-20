'use client';

import { useState } from 'react';
import { ESTRATEGIAS_VALIDADAS } from '@trading/core';

export function PainelAutomacao() {
  const [activa, setActiva] = useState(false);
  const [estrategias, setEstrategias] = useState<Set<string>>(new Set(ESTRATEGIAS_VALIDADAS.map(e => e.id)));
  
  const [modoLote, setModoLote] = useState<'fixo' | 'risco'>('risco');
  const [loteFixo, setLoteFixo] = useState('0.01');
  const [riscoPct, setRiscoPct] = useState('1.0');
  
  const [limiteDiario, setLimiteDiario] = useState('5.0');
  const [limiteTotal, setLimiteTotal] = useState('20.0');
  const [modoLimite, setModoLimite] = useState<'usd' | 'pct'>('pct');

  const alternarEstrategia = (id: string) => {
    const novas = new Set(estrategias);
    if (novas.has(id)) novas.delete(id);
    else novas.add(id);
    setEstrategias(novas);
  };

  return (
    <>
      <h2>Automação</h2>
      <div className="rows">
        <div>
          <span className="k">Estado da automação</span>
          <span className="v">
            <button 
              type="button"
              className="switch" 
              aria-checked={activa} 
              onClick={() => setActiva(!activa)}
              aria-label={activa ? 'Desligar automação' : 'Ligar automação'}
            />
          </span>
        </div>
      </div>
      
      {activa && (
        <>
          <h3 style={{ marginTop: '24px', fontSize: '14px', marginBottom: '12px' }}>Estratégias a executar</h3>
          <div className="grupo__caixa">
            {ESTRATEGIAS_VALIDADAS.map(e => {
              const on = estrategias.has(e.id);
              return (
                <button 
                  key={e.id} 
                  type="button" 
                  className="conta-linha" 
                  aria-pressed={on} 
                  onClick={() => alternarEstrategia(e.id)}
                >
                  <span className="conta-linha__id">
                    <strong>{e.nome}</strong>
                  </span>
                  <span className="conta-linha__marca" aria-hidden="true">
                    {on ? '✓' : ''}
                  </span>
                </button>
              );
            })}
          </div>

          <h3 style={{ marginTop: '24px', fontSize: '14px', marginBottom: '12px' }}>Tamanho da posição</h3>
          <div className="rows">
            <div>
              <span className="k">Modo de cálculo</span>
              <span className="v">
                <div className="segmentos">
                  <button type="button" aria-pressed={modoLote === 'risco'} onClick={() => setModoLote('risco')}>Risco (%)</button>
                  <button type="button" aria-pressed={modoLote === 'fixo'} onClick={() => setModoLote('fixo')}>Lote Fixo</button>
                </div>
              </span>
            </div>
            {modoLote === 'risco' ? (
              <div>
                <span className="k">Risco por operação</span>
                <span className="v" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input 
                    type="number" 
                    step="0.1" 
                    value={riscoPct} 
                    onChange={(e) => setRiscoPct(e.target.value)} 
                    style={{ width: '80px', padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}
                  />
                  <span className="faint">%</span>
                </span>
              </div>
            ) : (
              <div>
                <span className="k">Lotes fixos</span>
                <span className="v" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input 
                    type="number" 
                    step="0.01" 
                    value={loteFixo} 
                    onChange={(e) => setLoteFixo(e.target.value)} 
                    style={{ width: '80px', padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}
                  />
                  <span className="faint">lotes</span>
                </span>
              </div>
            )}
          </div>

          <h3 style={{ marginTop: '24px', fontSize: '14px', marginBottom: '12px' }}>Gestão de risco global</h3>
          <div className="rows">
            <div>
              <span className="k">Modo do limite</span>
              <span className="v">
                <div className="segmentos">
                  <button type="button" aria-pressed={modoLimite === 'pct'} onClick={() => setModoLimite('pct')}>Percentagem (%)</button>
                  <button type="button" aria-pressed={modoLimite === 'usd'} onClick={() => setModoLimite('usd')}>Valor (USD)</button>
                </div>
              </span>
            </div>
            <div>
              <span className="k">Perda máx. diária</span>
              <span className="v" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input 
                  type="number" 
                  step={modoLimite === 'pct' ? '0.5' : '10'} 
                  value={limiteDiario} 
                  onChange={(e) => setLimiteDiario(e.target.value)} 
                  style={{ width: '80px', padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}
                />
                <span className="faint">{modoLimite === 'pct' ? '%' : 'USD'}</span>
              </span>
            </div>
            <div>
              <span className="k">Perda máx. total</span>
              <span className="v" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input 
                  type="number" 
                  step={modoLimite === 'pct' ? '1' : '50'} 
                  value={limiteTotal} 
                  onChange={(e) => setLimiteTotal(e.target.value)} 
                  style={{ width: '80px', padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}
                />
                <span className="faint">{modoLimite === 'pct' ? '%' : 'USD'}</span>
              </span>
            </div>
          </div>
          
          <div className="notice" style={{ marginTop: '24px' }}>
            <strong>Preview da Automação</strong>
            <div style={{ marginTop: 6, lineHeight: 1.55 }}>
              Se surgir um sinal hoje, o sistema abrirá <strong>{modoLote === 'risco' ? `${riscoPct}% de risco` : `${loteFixo} lotes`}</strong>. 
              A automação será suspensa para o dia se perder <strong>{limiteDiario}{modoLimite === 'pct' ? '%' : ' USD'}</strong>, e desligada completamente se a conta cair <strong>{limiteTotal}{modoLimite === 'pct' ? '%' : ' USD'}</strong>.
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
            <button className="btn primary">
              Guardar definições
            </button>
          </div>
        </>
      )}
    </>
  );
}
