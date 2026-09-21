'use client';

/**
 * Histórico da conta conectada (cTrader ou Deriv standard) — mostra no Financeiro.
 *
 * Três fontes de dados, três camadas:
 *
 *   1. CORRETORA — trades reais (via /api/ctrader/historico ou /api/deriv/historico)
 *   2. SISTEMA — sinais gerados pelas estratégias (props `sinais`)
 *   3. MANUAL — trades inseridos à mão (prop firms, outras corretoras)
 *
 * O matching automático cruza (1) com (2) por símbolo, direcção e
 * proximidade temporal. Os manuais (3) vivem no mesmo fluxo das contas
 * existentes — este componente mostra os dois lado a lado.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { EquityChart, type EquityPoint } from '@/components/FinanceCharts';
import { estrategiaActiva } from '@trading/core';
import { matchTradesSinais, type TradeComMatch, type EstatisticasDeriv } from '@/lib/desempenho';
import type { SinalTempoRealRow } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface TradeDeriv {
  id: number;
  simbolo: string;
  tipo: string;
  compra: number;
  venda: number;
  lucro: number;
  abertoEm: number;
  fechadoEm: number;
  descricao: string;
}

interface Transaccao {
  id: number;
  tipo: string;
  montante: number;
  saldoDepois: number;
  em: number;
}

interface ContaInfo {
  id: string;
  tipo: string;
  moeda: string;
  corretora?: string;
}

interface SaldoInfo {
  saldo: number;
  moeda: string;
  loginid: string;
}

type Periodo = '7d' | '30d' | '90d' | 'tudo';

const PERIODOS: Array<{ id: Periodo; rotulo: string }> = [
  { id: '7d', rotulo: '7 dias' },
  { id: '30d', rotulo: '30 dias' },
  { id: '90d', rotulo: '90 dias' },
  { id: 'tudo', rotulo: 'Tudo' },
];

function filtrarPorPeriodo<T extends { fechadoEm?: number; abertoEm?: number }>(
  items: T[],
  periodo: Periodo,
): T[] {
  if (periodo === 'tudo') return items;
  const agora = Date.now();
  const dias = periodo === '7d' ? 7 : periodo === '30d' ? 30 : 90;
  const limite = agora - dias * 24 * 60 * 60 * 1000;
  return items.filter((t) => (t.fechadoEm ?? t.abertoEm ?? 0) >= limite);
}

function dinheiro(v: number, moeda = 'USD'): string {
  return v.toLocaleString('pt-PT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + ` ${moeda}`;
}

function dataFormatada(ts: number): string {
  if (!ts) return '—';
  return new Date(ts).toISOString().slice(0, 10);
}

function nomeEstrategia(id: string): string {
  return estrategiaActiva(id)?.nome ?? id;
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export function HistoricoContaConectada({ sinais }: { sinais: SinalTempoRealRow[] }) {
  const [trades, setTrades] = useState<TradeDeriv[] | null>(null);
  const [transaccoes, setTransaccoes] = useState<Transaccao[]>([]);
  const [resumo, setResumo] = useState<EstatisticasDeriv | null>(null);
  const [conta, setConta] = useState<ContaInfo | null>(null);
  const [saldo, setSaldo] = useState<SaldoInfo | null>(null);
  const [ligada, setLigada] = useState(false);
  const [aCarregar, setACarregar] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState<Periodo>('30d');

  const carregar = useCallback(async () => {
    try {
      // Tentar a cTrader primeiro
      let r = await fetch('/api/ctrader/historico', { cache: 'no-store' });
      let j = (await r.json()) as Record<string, unknown>;

      // Se a cTrader não estiver ligada, tentar a Deriv standard
      if (!j['ligada']) {
        r = await fetch('/api/deriv/historico', { cache: 'no-store' });
        j = (await r.json()) as Record<string, unknown>;
      }

      if (!j['ligada']) {
        setLigada(false);
        setErro((j['erro'] as string) ?? null);
        return;
      }

      setLigada(true);
      setConta(j['conta'] as ContaInfo);
      setSaldo(j['saldo'] as SaldoInfo);
      setTrades((j['trades'] as TradeDeriv[]) ?? []);
      setTransaccoes((j['transaccoes'] as Transaccao[]) ?? []);
      setResumo(j['resumo'] as EstatisticasDeriv);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setACarregar(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Matching automático
  const tradesComMatch = useMemo<TradeComMatch[]>(() => {
    if (!trades) return [];
    return matchTradesSinais(trades, sinais);
  }, [trades, sinais]);

  // Filtrar por período
  const tradesFiltrados = useMemo(() => {
    return filtrarPorPeriodo(
      tradesComMatch.map((m) => ({ ...m, fechadoEm: m.trade.fechadoEm, abertoEm: m.trade.abertoEm })),
      periodo,
    );
  }, [tradesComMatch, periodo]);

  // Curva de capital a partir do statement
  const pontosCurva = useMemo<EquityPoint[]>(() => {
    if (transaccoes.length === 0) return [];
    return [...transaccoes]
      .sort((a, b) => a.em - b.em)
      .map((t) => ({ t: t.em, balance: t.saldoDepois }));
  }, [transaccoes]);

  // Estado sem ligação
  if (!aCarregar && !ligada) {
    return (
      <div className="empty" style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '20px 24px', borderRadius: '16px',
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
      }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
        <div>
          <strong>Nenhuma conta conectada</strong>
          <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-faint)', marginTop: '2px' }}>
            {erro ?? 'Ligue a sua conta cTrader ou Deriv nas definições para ver o histórico de negociação real.'}
          </span>
        </div>
      </div>
    );
  }

  if (aCarregar) {
    return <div className="brilho" style={{ height: 320, borderRadius: 20 }} />;
  }

  const real = conta?.tipo === 'real';
  const matchados = tradesFiltrados.filter((m) => m.confianca !== null).length;
  const corretora = conta?.corretora ?? 'Deriv';

  return (
    <div>
      {/* Cartão de resumo da conta */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '12px',
        marginBottom: '20px',
      }}>
        {/* Saldo */}
        <div className="metric-card" style={{ position: 'relative', overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
            background: `linear-gradient(90deg, transparent, ${real ? 'var(--bull)' : 'var(--accent)'}, transparent)`,
          }} />
          <div className="m-label">
            Saldo
            <span style={{
              marginLeft: '8px',
              padding: '2px 8px',
              borderRadius: '6px',
              fontSize: '10px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              background: real
                ? 'color-mix(in srgb, var(--bull) 15%, transparent)'
                : 'color-mix(in srgb, var(--accent) 15%, transparent)',
              color: real ? 'var(--bull)' : 'var(--accent)',
            }}>
              {real ? 'real' : 'demo'}
            </span>
          </div>
          <div className="m-value">
            {saldo ? dinheiro(saldo.saldo, saldo.moeda) : '—'}
          </div>
        </div>

        {/* Lucro total */}
        <div className={`metric-card ${resumo && resumo.lucroTotal > 0 ? 'positive' : resumo && resumo.lucroTotal < 0 ? 'negative' : ''}`}>
          <div className="m-label">Lucro total</div>
          <div className={`m-value ${resumo && resumo.lucroTotal >= 0 ? 'bull-t' : 'bear-t'}`}>
            {resumo ? `${resumo.lucroTotal >= 0 ? '+' : ''}${dinheiro(resumo.lucroTotal, resumo.moeda)}` : '—'}
          </div>
        </div>

        {/* Win rate */}
        <div className="metric-card">
          <div className="m-label">Taxa de acerto</div>
          <div className="m-value">
            {resumo && resumo.totalTrades > 0 ? `${(resumo.winRate * 100).toFixed(0)}%` : '—'}
          </div>
        </div>

        {/* Total trades */}
        <div className="metric-card">
          <div className="m-label">Operações</div>
          <div className="m-value">{resumo?.totalTrades ?? 0}</div>
        </div>

        {/* Expectativa */}
        <div className={`metric-card ${resumo && resumo.expectativa > 0 ? 'positive' : resumo && resumo.expectativa < 0 ? 'negative' : ''}`}>
          <div className="m-label">Expectativa</div>
          <div className={`m-value ${resumo && resumo.expectativa >= 0 ? 'bull-t' : 'bear-t'}`}>
            {resumo && resumo.totalTrades > 0
              ? `${resumo.expectativa >= 0 ? '+' : ''}${dinheiro(resumo.expectativa, resumo.moeda)}`
              : '—'}
          </div>
        </div>

        {/* Factor de lucro */}
        <div className="metric-card">
          <div className="m-label">Factor de lucro</div>
          <div className={`m-value ${resumo && resumo.factorLucro >= 1 ? 'bull-t' : resumo && resumo.factorLucro < 1 ? 'bear-t' : ''}`}>
            {resumo && resumo.totalTrades > 0
              ? resumo.factorLucro === Infinity ? '∞' : resumo.factorLucro.toFixed(2)
              : '—'}
          </div>
        </div>
      </div>

      {/* Streaks e matching */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '20px',
      }}>
        {resumo && resumo.melhorStreak > 0 && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '5px',
            padding: '5px 12px', borderRadius: '10px', fontSize: '12px', fontWeight: 600,
            background: 'color-mix(in srgb, var(--bull) 12%, transparent)',
            color: 'var(--bull)',
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            Melhor série: {resumo.melhorStreak} vitórias
          </span>
        )}
        {resumo && resumo.piorStreak > 0 && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '5px',
            padding: '5px 12px', borderRadius: '10px', fontSize: '12px', fontWeight: 600,
            background: 'color-mix(in srgb, var(--bear) 12%, transparent)',
            color: 'var(--bear)',
          }}>
            Pior série: {resumo.piorStreak} derrotas
          </span>
        )}
        {matchados > 0 && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '5px',
            padding: '5px 12px', borderRadius: '10px', fontSize: '12px', fontWeight: 600,
            background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
            color: 'var(--accent-strong)',
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            {matchados} trade{matchados !== 1 ? 's' : ''} casado{matchados !== 1 ? 's' : ''} com sinais
          </span>
        )}
      </div>

      {/* Curva de capital */}
      {pontosCurva.length >= 2 && (
        <div className="card pad-chart" style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-dim)' }}>
            Evolução do saldo
          </div>
          <EquityChart points={pontosCurva} />
        </div>
      )}

      {/* Filtros de período */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <div className="desempenho-tabs" role="tablist" aria-label="Período">
          {PERIODOS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-pressed={periodo === p.id}
              onClick={() => setPeriodo(p.id)}
            >
              {p.rotulo}
            </button>
          ))}
        </div>
        <span className="grow" />
        <span style={{ fontSize: '12px', color: 'var(--text-faint)' }}>
          {tradesFiltrados.length} de {tradesComMatch.length} trades
        </span>
      </div>

      {/* Tabela de trades */}
      {tradesFiltrados.length === 0 ? (
        <div className="empty">Nenhuma operação fechada neste período.</div>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Símbolo</th>
                <th>Tipo</th>
                <th className="num">Compra</th>
                <th className="num">Venda</th>
                <th className="num">Lucro</th>
                <th>Data</th>
                <th>Sinal</th>
              </tr>
            </thead>
            <tbody>
              {tradesFiltrados.map((m) => (
                <tr key={m.trade.id}>
                  <td style={{ fontWeight: 600 }}>{m.trade.simbolo || '—'}</td>
                  <td className="dim">
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: '4px',
                      padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                      background: m.trade.tipo.includes('CALL') || m.trade.tipo.includes('MULTUP')
                        ? 'color-mix(in srgb, var(--bull) 15%, transparent)'
                        : 'color-mix(in srgb, var(--bear) 15%, transparent)',
                      color: m.trade.tipo.includes('CALL') || m.trade.tipo.includes('MULTUP')
                        ? 'var(--bull)' : 'var(--bear)',
                    }}>
                      {m.trade.tipo.includes('CALL') || m.trade.tipo.includes('MULTUP') ? '▲' : '▼'}
                      {m.trade.tipo}
                    </span>
                  </td>
                  <td className="num">{dinheiro(m.trade.compra, resumo?.moeda)}</td>
                  <td className="num">{dinheiro(m.trade.venda, resumo?.moeda)}</td>
                  <td className={`num ${m.trade.lucro >= 0 ? 'bull-t' : 'bear-t'}`}>
                    <span className={`pill ${m.trade.lucro >= 0 ? 'bull' : 'bear'}`}>
                      {m.trade.lucro >= 0 ? '+' : ''}{dinheiro(m.trade.lucro, resumo?.moeda)}
                    </span>
                  </td>
                  <td className="dim">{dataFormatada(m.trade.fechadoEm)}</td>
                  <td>
                    {m.confianca ? (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        padding: '3px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: 600,
                        background: m.confianca === 'exacto'
                          ? 'color-mix(in srgb, var(--bull) 12%, transparent)'
                          : 'color-mix(in srgb, var(--warn) 12%, transparent)',
                        color: m.confianca === 'exacto' ? 'var(--bull)' : 'var(--warn)',
                      }} title={`Sinal: ${m.sinalEstrategia} · ${m.sinalDireccao}`}>
                        {m.confianca === 'exacto' ? (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        ) : (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                          </svg>
                        )}
                        {m.sinalEstrategia ? nomeEstrategia(m.sinalEstrategia) : 'casado'}
                      </span>
                    ) : (
                      <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>
                        —
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Avisos */}
      {resumo && resumo.totalTrades > 0 && resumo.totalTrades < 20 && (
        <div className="notice" style={{ marginTop: '16px' }}>
          <strong>Amostra pequena.</strong> {resumo.totalTrades} operação(ões) na conta {corretora}.
          As métricas ainda não distinguem estratégia de ruído com esta dimensão.
        </div>
      )}

      {erro && <div className="ob__erro" style={{ marginTop: '12px' }}>{erro}</div>}
    </div>
  );
}
