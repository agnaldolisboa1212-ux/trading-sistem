'use client';

import { useState } from 'react';
import { calculatePositionSize } from '@trading/core';

export function FolhaCalculadoraLote({
  saldoCtrader,
  precoEntrada,
  stopLoss,
  aoCalcular,
  aoFechar,
}: {
  saldoCtrader: number | null;
  precoEntrada: number | null;
  stopLoss: number | null;
  aoCalcular: (lotes: number) => void;
  aoFechar: () => void;
}) {
  const [saldo, setSaldo] = useState(saldoCtrader ? String(saldoCtrader) : '1000');
  const [riscoPerc, setRiscoPerc] = useState('1.0');
  const [tamanhoContrato, setTamanhoContrato] = useState('100000'); // 100k for standard lot
  const [preco, setPreco] = useState(precoEntrada !== null ? String(precoEntrada) : '');
  const [sl, setSl] = useState(stopLoss !== null ? String(stopLoss) : '');

  const p = Number(preco.replace(',', '.'));
  const s = Number(sl.replace(',', '.'));
  const saldoNum = Number(saldo.replace(',', '.'));
  const riscoNum = Number(riscoPerc.replace(',', '.'));
  const contratoNum = Number(tamanhoContrato.replace(',', '.'));

  let lotesSugeridos: number | null = null;
  let riscoDinheiro: number | null = null;
  let erro = '';
  let avisos: string[] = [];

  if (p > 0 && s > 0 && saldoNum > 0 && riscoNum > 0 && contratoNum > 0) {
    const r = calculatePositionSize(p, s, {
      accountBalance: saldoNum,
      riskPercentPerTrade: riscoNum,
      maxPortfolioRiskPercent: 100,
      maxConcurrentPositions: 100,
    });
    
    if (r.units > 0) {
      riscoDinheiro = r.riskAmount;
      lotesSugeridos = r.units / contratoNum;
      // Os avisos (risco acima de 2%, alavancagem) valem sobretudo quando a
      // conta DÁ resultado — era aí que estavam a ser deitados fora.
      avisos = r.warnings;
    } else {
      erro = r.warnings[0] ?? 'Valores inválidos.';
    }
  }

  return (
    <div
      className="folha-fundo"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <div className="folha">
        <div className="folha__puxador" />
        <h2>Calculadora de Lotes</h2>

        <div className="bilhete__campos">
          <label className="campo">
            <span>Saldo da Conta</span>
            <input inputMode="decimal" value={saldo} onChange={(e) => setSaldo(e.target.value)} />
            <small className="dim">Usa o saldo cTrader, se ligado.</small>
          </label>
          <label className="campo">
            <span>Risco (%)</span>
            <input inputMode="decimal" value={riscoPerc} onChange={(e) => setRiscoPerc(e.target.value)} />
          </label>
          <label className="campo">
            <span>Tamanho do Contrato</span>
            <input inputMode="decimal" value={tamanhoContrato} onChange={(e) => setTamanhoContrato(e.target.value)} />
            <small className="dim">Ex: 100000 (Forex Padrão), 1 (Cripto), 10 (Índices)</small>
          </label>
          <div className="campo-group" style={{ display: 'flex', gap: '8px' }}>
            <label className="campo" style={{ flex: 1 }}>
              <span>Entrada</span>
              <input inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} />
            </label>
            <label className="campo" style={{ flex: 1 }}>
              <span>Stop Loss</span>
              <input inputMode="decimal" value={sl} onChange={(e) => setSl(e.target.value)} />
            </label>
          </div>
        </div>

        {lotesSugeridos !== null && riscoDinheiro !== null ? (
          <div className="notice" style={{ marginTop: '16px' }}>
            <div>Risco planeado: <strong>{riscoDinheiro.toFixed(2)}</strong></div>
            <div>Lotes calculados: <strong className="bull-t">{lotesSugeridos.toFixed(2)}</strong></div>
            <small className="dim">
              Conta feita na moeda em que o par está cotado. Num par que não acabe na moeda da conta
              (USDJPY, EURGBP…), converta antes de usar.
            </small>
            {avisos.map((a) => (
              <div key={a} className="nt-aviso" style={{ marginTop: '8px' }}>
                {a}
              </div>
            ))}
          </div>
        ) : erro ? (
          <div className="nt-erro" style={{ marginTop: '16px' }}>{erro}</div>
        ) : null}

        <div className="nt-acoes" style={{ marginTop: '16px' }}>
          <button type="button" className="btn ghost" onClick={aoFechar}>
            Cancelar
          </button>
          <button 
            type="button" 
            className="btn primary" 
            disabled={lotesSugeridos === null}
            onClick={() => {
              if (lotesSugeridos !== null) aoCalcular(lotesSugeridos);
            }}
          >
            Usar Lotes
          </button>
        </div>
      </div>
    </div>
  );
}
