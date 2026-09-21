/**
 * Financeiro: o que as estratégias ACTIVAS realmente produziram.
 *
 * Três camadas:
 *
 *   1. DERIV — histórico real da conta conectada: trades fechados, curva de
 *      capital em dinheiro, métricas de desempenho. Com matching automático
 *      contra os sinais do sistema para saber quais trades vieram de cá.
 *   2. SISTEMA — "Resultado acumulado" mede TODOS os sinais gerados, como
 *      referência macro de como as estratégias activas estão a sair.
 *   3. PESSOAL — `FinanceiroContas` deixa marcar, sinal a sinal, quais foram
 *      REALMENTE negociados (a pessoa só entra nalguns, com o toque manual no
 *      terminal), por conta — uma pessoa pode ter várias, uma por corretora.
 *      Também aceita trades manuais de prop firms e corretoras externas.
 *
 * As métricas do sistema continuam em **R** (múltiplos de risco); as da
 * conta Deriv estão em dinheiro real.
 */

import Link from 'next/link';
import { FinanceiroContas } from '@/components/FinanceiroContas';
import { HistoricoContaConectada } from '@/components/HistoricoContaConectada';
import { EstatisticasCard } from '@/components/EstatisticasCard';
import { calcularEstatisticas } from '@/lib/desempenho';
import { estrategiaActiva, estrategiaEmTeste } from '@trading/core';
import { fetchSinaisTempoReal, isConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const ABERTO = new Set(['a-aguardar-entrada', 'em-curso', 'protegida']);

export default async function Page() {
  if (!isConfigured) {
    return (
      <div className="wrap">
        <Nav />
        <div className="setup">
          <p>
            O financeiro precisa do Supabase — é lá que o motor de tempo real grava cada sinal e o
            seu resultado.
          </p>
        </div>
      </div>
    );
  }

  // Só estratégias activas (validadas e em teste). Os sinais das estratégias
  // antigas (oferta/procura, perfil de volume…) continuam na tabela mas já não
  // são acompanhados — ficariam para sempre "abertos" sem estado.
  const sinais = (await fetchSinaisTempoReal(1000)).filter((r) => estrategiaActiva(r.estrategia) !== undefined);
  const fechados = sinais.filter((r) => r.estado === 'fechada');
  const abertos = sinais.filter((r) => r.estado === null || ABERTO.has(r.estado));

  const validadas = fechados.filter((r) => estrategiaEmTeste(r.estrategia) === undefined);
  const emTeste = fechados.filter((r) => estrategiaEmTeste(r.estrategia) !== undefined);
  const estValidadas = calcularEstatisticas(validadas.map((r) => Number(r.resultado_r)).filter(Number.isFinite));
  const estEmTeste = calcularEstatisticas(emTeste.map((r) => Number(r.resultado_r)).filter(Number.isFinite));

  return (
    <div className="wrap">
      <Nav />

      {/* Header premium com gradiente e informações dinâmicas */}
      <header style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: '24px',
        padding: '32px 28px',
        marginBottom: '32px',
        background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 10%, var(--surface)) 0%, var(--surface) 100%)',
        border: '1px solid color-mix(in srgb, var(--accent) 15%, var(--border))',
        animation: 'fadeSlideIn 0.5s ease-out both',
      }}>
        {/* Glow decorativo */}
        <div style={{
          position: 'absolute',
          top: '-40%',
          right: '-15%',
          width: '280px',
          height: '280px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, color-mix(in srgb, var(--accent) 15%, transparent) 0%, transparent 70%)',
          animation: 'pulseGlow 6s ease-in-out infinite',
          pointerEvents: 'none',
        }} />

        <div style={{ position: 'relative' }}>
          <h1 style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '-0.03em', margin: '0 0 16px 0' }}>
            Financeiro
          </h1>

          {/* Badges dinâmicos */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '6px 14px', borderRadius: '10px', fontSize: '12px', fontWeight: 600,
              background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
              color: 'var(--accent-strong)',
              animation: 'fadeSlideIn 0.4s ease-out 0.1s both',
            }}>
              <span style={{
                width: '6px', height: '6px', borderRadius: '50%',
                background: 'var(--accent)',
                animation: 'pulseGlow 2s ease-in-out infinite',
              }} />
              {abertos.length} abertas
            </span>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '6px 14px', borderRadius: '10px', fontSize: '12px', fontWeight: 600,
              background: 'color-mix(in srgb, var(--bull) 12%, transparent)',
              color: 'var(--bull)',
              animation: 'fadeSlideIn 0.4s ease-out 0.15s both',
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              {fechados.length} fechadas
            </span>
            {emTeste.length > 0 && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '6px 14px', borderRadius: '10px', fontSize: '12px', fontWeight: 600,
                background: 'color-mix(in srgb, var(--warn) 12%, transparent)',
                color: 'var(--warn)',
                animation: 'fadeSlideIn 0.4s ease-out 0.2s both',
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                </svg>
                {emTeste.length} em teste
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Secção: Conta Deriv conectada — histórico real */}
      <section className="glass-panel" style={{
        padding: '28px',
        borderRadius: '20px',
        marginBottom: '28px',
        animation: 'fadeSlideIn 0.5s ease-out 0.05s both',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Barra decorativa */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
          background: 'linear-gradient(90deg, transparent, var(--accent), transparent)',
          animation: 'shimmerBar 3s ease-in-out infinite',
        }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: '10px',
            background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 20%, transparent), color-mix(in srgb, var(--accent) 8%, transparent))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <div>
            <h2 style={{ fontSize: '18px', margin: 0, fontWeight: 700 }}>Conta conectada</h2>
          </div>
        </div>
        <p className="section-cap" style={{ marginLeft: '46px' }}>
          Histórico de negociações reais da conta ligada ao sistema (cTrader ou Deriv standard). 
          Os trades são automaticamente cruzados com os sinais gerados pelas estratégias — os que 
          casam aparecem com a estratégia correspondente.
        </p>
        <HistoricoContaConectada sinais={sinais} />
      </section>

      {/* Secção: Estratégias validadas */}
      <section className="glass-panel" style={{
        padding: '28px',
        borderRadius: '20px',
        marginBottom: '28px',
        animation: 'fadeSlideIn 0.5s ease-out 0.1s both',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Barra decorativa */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
          background: 'linear-gradient(90deg, transparent, var(--bull), transparent)',
          animation: 'shimmerBar 3s ease-in-out infinite',
        }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: '10px',
            background: 'linear-gradient(135deg, color-mix(in srgb, var(--bull) 20%, transparent), color-mix(in srgb, var(--bull) 8%, transparent))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--bull)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="M22 4L12 14.01l-3-3" />
            </svg>
          </div>
          <div>
            <h2 style={{ fontSize: '18px', margin: 0, fontWeight: 700 }}>Resultado acumulado — estratégias validadas</h2>
          </div>
        </div>
        <p className="section-cap" style={{ marginLeft: '46px' }}>
          TODOS os sinais gerados, negociados ou não — a referência macro de como as estratégias
          activas estão a sair. Para o SEU desempenho real, veja &quot;Desempenho pessoal&quot; abaixo.
        </p>
        <EstatisticasCard e={estValidadas} />
      </section>

      {/* Secção: Em teste */}
      {estEmTeste.n > 0 && (
        <section className="glass-panel" style={{
          padding: '28px',
          borderRadius: '20px',
          marginBottom: '28px',
          animation: 'fadeSlideIn 0.5s ease-out 0.2s both',
          position: 'relative',
          overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
            background: 'linear-gradient(90deg, transparent, var(--warn), transparent)',
            animation: 'shimmerBar 3s ease-in-out infinite',
          }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <div style={{
              width: '36px', height: '36px', borderRadius: '10px',
              background: 'linear-gradient(135deg, color-mix(in srgb, var(--warn) 20%, transparent), color-mix(in srgb, var(--warn) 8%, transparent))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--warn)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
              </svg>
            </div>
            <div>
              <h2 style={{ fontSize: '18px', margin: 0, fontWeight: 700 }}>Resultado acumulado — em teste ao vivo</h2>
            </div>
          </div>
          <p className="section-cap" style={{ marginLeft: '46px' }}>
            Sem taxa de acerto medida no backtest: é exactamente para medir isto ao vivo que estas
            operações contam à parte.
          </p>
          <EstatisticasCard e={estEmTeste} />
        </section>
      )}

      {/* Secção: As minhas contas */}
      <section className="glass-panel" style={{
        padding: '28px',
        borderRadius: '20px',
        marginBottom: '28px',
        animation: 'fadeSlideIn 0.5s ease-out 0.3s both',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
          background: 'linear-gradient(90deg, transparent, var(--accent), transparent)',
          animation: 'shimmerBar 3s ease-in-out infinite',
        }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: '10px',
            background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 20%, transparent), color-mix(in srgb, var(--accent) 8%, transparent))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <div>
            <h2 style={{ fontSize: '18px', margin: 0, fontWeight: 700 }}>As minhas contas</h2>
          </div>
        </div>
        <p className="section-cap" style={{ marginLeft: '46px' }}>
          Marque, nas tabelas abaixo, os sinais que realmente negociou — numa conta (pode ter
          várias, uma por corretora). Só o marcado entra no desempenho pessoal e na curva de
          capital dessa conta.
        </p>
        <FinanceiroContas sinais={sinais} />
      </section>

      {/* Footer */}
      <footer style={{
        padding: '20px 24px',
        borderRadius: '16px',
        fontSize: '12px',
        lineHeight: 1.6,
        color: 'var(--text-faint)',
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        animation: 'fadeSlideIn 0.5s ease-out 0.4s both',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '2px' }}>
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <span>
          Nenhuma ordem é enviada sem um toque seu: os sinais do sistema acima são os anunciados
          pelo motor; o desempenho pessoal é só o que marcou como negociado.
        </span>
      </footer>
    </div>
  );
}

function Nav() {
  return (
    <nav className="nav" style={{
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      marginBottom: '24px',
      padding: '4px',
      background: 'var(--surface-2)',
      borderRadius: '12px',
      width: 'fit-content',
    }}>
      <Link href="/" style={{
        padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 500,
        color: 'var(--text-dim)', textDecoration: 'none', transition: 'all 200ms ease',
      }}>Radar</Link>
      <Link href="/financeiro" style={{
        padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 700,
        background: 'var(--surface)', color: 'var(--text)', textDecoration: 'none',
        boxShadow: 'var(--elevacao-1)',
      }}>
        Financeiro
      </Link>
    </nav>
  );
}
