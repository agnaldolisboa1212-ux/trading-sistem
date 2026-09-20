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
    <div className="painel-automacao">
      <div className="cabecalho-seccao" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h2>Automação (cTrader)</h2>
        <div className="toggle-geral">
          <label className="switch">
            <input type="checkbox" checked={activa} onChange={(e) => setActiva(e.target.checked)} />
            <span className="slider round"></span>
          </label>
          <span style={{ marginLeft: '8px', fontWeight: 'bold', color: activa ? 'var(--bull)' : 'var(--text-faint)' }}>
            {activa ? 'ACTIVA' : 'DESLIGADA'}
          </span>
        </div>
      </div>

      <div className="card-automacao" style={{ opacity: activa ? 1 : 0.6, pointerEvents: activa ? 'auto' : 'none' }}>
        
        <div className="grupo-opcoes">
          <h3>Estratégias a Executar</h3>
          <div className="lista-checkbox">
            {ESTRATEGIAS_VALIDADAS.map(e => (
              <label key={e.id} className="checkbox-item" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <input 
                  type="checkbox" 
                  checked={estrategias.has(e.id)} 
                  onChange={() => alternarEstrategia(e.id)} 
                />
                <span>{e.nome}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="grupo-opcoes" style={{ marginTop: '24px' }}>
          <h3>Tamanho da Posição</h3>
          <div className="tabs-mini" style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
            <label>
              <input type="radio" name="modolote" checked={modoLote === 'risco'} onChange={() => setModoLote('risco')} />
              {' '}Risco (%)
            </label>
            <label>
              <input type="radio" name="modolote" checked={modoLote === 'fixo'} onChange={() => setModoLote('fixo')} />
              {' '}Lote Fixo
            </label>
          </div>
          
          <div className="input-linha" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {modoLote === 'risco' ? (
              <>
                <input 
                  type="number" 
                  step="0.1" 
                  value={riscoPct} 
                  onChange={(e) => setRiscoPct(e.target.value)} 
                  style={{ width: '80px', padding: '4px' }}
                />
                <span>% da conta por operação</span>
              </>
            ) : (
              <>
                <input 
                  type="number" 
                  step="0.01" 
                  value={loteFixo} 
                  onChange={(e) => setLoteFixo(e.target.value)} 
                  style={{ width: '80px', padding: '4px' }}
                />
                <span>lotes</span>
              </>
            )}
          </div>
        </div>

        <div className="grupo-opcoes" style={{ marginTop: '24px' }}>
          <h3>Gestão de Risco Global</h3>
          <div className="tabs-mini" style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
            <label>
              <input type="radio" name="modolimite" checked={modoLimite === 'pct'} onChange={() => setModoLimite('pct')} />
              {' '}Porcentagem (%)
            </label>
            <label>
              <input type="radio" name="modolimite" checked={modoLimite === 'usd'} onChange={() => setModoLimite('usd')} />
              {' '}Valor (USD)
            </label>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div className="input-linha" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '120px' }}>Perda máx. diária:</span>
              <input 
                type="number" 
                step={modoLimite === 'pct' ? '0.5' : '10'} 
                value={limiteDiario} 
                onChange={(e) => setLimiteDiario(e.target.value)} 
                style={{ width: '80px', padding: '4px' }}
              />
              <span>{modoLimite === 'pct' ? '%' : 'USD'}</span>
            </div>
            
            <div className="input-linha" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '120px' }}>Perda máx. total:</span>
              <input 
                type="number" 
                step={modoLimite === 'pct' ? '1' : '50'} 
                value={limiteTotal} 
                onChange={(e) => setLimiteTotal(e.target.value)} 
                style={{ width: '80px', padding: '4px' }}
              />
              <span>{modoLimite === 'pct' ? '%' : 'USD'}</span>
            </div>
          </div>
        </div>
        
        <div className="preview-caixa" style={{ marginTop: '24px', padding: '16px', background: 'var(--bg-faint)', borderRadius: '8px' }}>
          <h4>Preview da Automação</h4>
          <p style={{ margin: '8px 0 0 0', fontSize: '14px', color: 'var(--text-faint)' }}>
            Se surgir um sinal hoje, o sistema abrirá <strong>{modoLote === 'risco' ? `${riscoPct}% de risco` : `${loteFixo} lotes`}</strong>. 
            A automação será suspensa para o dia se perder <strong>{limiteDiario}{modoLimite === 'pct' ? '%' : ' USD'}</strong>, e desligada completamente se a conta cair <strong>{limiteTotal}{modoLimite === 'pct' ? '%' : ' USD'}</strong>.
          </p>
        </div>

        <button className="btn principal" style={{ marginTop: '24px', width: '100%' }}>
          Guardar Definições
        </button>

      </div>
    </div>
  );
}
