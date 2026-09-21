'use client';

/**
 * Mercados — a lista completa, com preço ao vivo.
 *
 * ── O QUE MUDOU, E PORQUÊ ──────────────────────────────────────────────────
 *
 * A versão anterior listava 17 instrumentos com a percentagem do checklist
 * MMXM como número principal. Isso responde a "onde está a análise", que é uma
 * pergunta de motor. Num separador chamado "Mercados", num app de finanças, a
 * pergunta é "a quanto está" — e a resposta era um número entre 0 e 100 que não
 * é preço nenhum.
 *
 * Agora a linha mostra preço, variação do dia e a curva das últimas 40 sessões.
 * A pontuação do checklist continua a existir, como distintivo secundário, para
 * os instrumentos que o motor cobre.
 *
 * ── PORQUE É TUDO CLIENTE ──────────────────────────────────────────────────
 *
 * Os preços chegam por WebSocket ao browser. Um Server Component teria de
 * escolher entre servir preços já velhos no HTML ou não servir nenhum — e em
 * qualquer dos casos o valor real só apareceria depois da hidratação. Sem
 * servidor no meio, o primeiro preço é o primeiro tick.
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ListaIndices } from '@/components/vivo/ListaIndices';
import { Ligacao } from '@/components/vivo/Preco';
import { SaldoCompacto } from '@/components/vivo/CartaoSaldo';
import {
  CRIPTO,
  FOREX,
  INDICES,
  METAIS,
  SINTETICOS,
  TODOS,
  type SimboloDeriv,
} from '@/lib/deriv/simbolos';
import { lerPreferenciasCliente } from '@/lib/preferencias';

type Grupo = 'meus' | 'indices' | 'forex' | 'metais' | 'cripto' | 'sinteticos' | 'todos';

const GRUPOS: Array<{
  id: Grupo;
  rotulo: string;
  lista: readonly SimboloDeriv[];
  icone: React.ReactNode;
}> = [
  {
    id: 'meus',
    rotulo: 'Os meus',
    lista: [],
    icone: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    ),
  },
  {
    id: 'indices',
    rotulo: 'Índices',
    lista: INDICES,
    icone: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" /><path d="M18 9l-5 5-4-4-6 6" />
      </svg>
    ),
  },
  {
    id: 'forex',
    rotulo: 'Forex',
    lista: FOREX,
    icone: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
  {
    id: 'sinteticos',
    rotulo: '24/7',
    lista: SINTETICOS,
    icone: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
      </svg>
    ),
  },
  {
    id: 'metais',
    rotulo: 'Metais',
    lista: METAIS,
    icone: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
      </svg>
    ),
  },
  {
    id: 'cripto',
    rotulo: 'Cripto',
    lista: CRIPTO,
    icone: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
  },
  {
    id: 'todos',
    rotulo: 'Todos',
    lista: TODOS,
    icone: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
  },
];

export default function Page() {
  const [grupo, setGrupo] = useState<Grupo>('meus');
  const [procura, setProcura] = useState('');

  const meus = useMemo(() => {
    const prefs = lerPreferenciasCliente();
    const escolhidos = prefs.instrumentos
      .map((c) => TODOS.find((t) => t.codigo === c))
      .filter((s): s is SimboloDeriv => Boolean(s));
    return escolhidos.length > 0 ? escolhidos : INDICES.slice(0, 6);
  }, []);

  const lista = useMemo((): readonly SimboloDeriv[] => {
    const termo = procura.trim().toLowerCase();
    if (termo) {
      return TODOS.filter(
        (s) => s.codigo.toLowerCase().includes(termo) || s.nome.toLowerCase().includes(termo),
      );
    }
    if (grupo === 'meus') return meus;
    return GRUPOS.find((g) => g.id === grupo)?.lista ?? TODOS;
  }, [grupo, procura, meus]);

  return (
    <div className="wrap">
      {/* Header premium */}
      <div className="portfolio-hero" style={{
        background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 8%, var(--surface)) 0%, var(--surface) 100%)',
        border: '1px solid color-mix(in srgb, var(--accent) 15%, var(--border))',
        animation: 'fadeSlideIn 0.5s ease-out both',
      }}>
        {/* Glow decorativo */}
        <div style={{
          position: 'absolute', top: '-40%', right: '-15%',
          width: '250px', height: '250px', borderRadius: '50%',
          background: 'radial-gradient(circle, color-mix(in srgb, var(--accent) 12%, transparent) 0%, transparent 70%)',
          animation: 'pulseGlow 6s ease-in-out infinite',
          pointerEvents: 'none',
        }} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <p className="cabeca__saudacao" style={{
              fontSize: '13px', opacity: 0.6, letterSpacing: '0.08em',
              textTransform: 'uppercase', fontWeight: 600, marginBottom: '4px',
            }}>{TODOS.length} instrumentos</p>
            <h1 style={{ fontWeight: 800, letterSpacing: '-0.03em', margin: 0 }}>Mercados</h1>
          </div>
          <SaldoCompacto />
        </div>
      </div>

      {/* Conteúdo principal */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: '16px',
        animation: 'fadeSlideIn 0.5s ease-out 0.1s both',
      }}>
        {/* Barra de procura premium */}
        <div className="mercados-search" style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '0 20px', height: '52px',
          background: 'var(--vidro)', backdropFilter: 'var(--desfoque)',
          WebkitBackdropFilter: 'var(--desfoque)',
          border: '1px solid var(--anel)', borderRadius: '16px',
          boxShadow: 'var(--elevacao-1)',
          transition: 'box-shadow 200ms ease, border-color 200ms ease',
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="search"
            inputMode="search"
            placeholder="Procurar símbolo ou nome"
            value={procura}
            onChange={(e) => setProcura(e.target.value)}
            aria-label="Procurar mercado"
            style={{
              border: 'none', background: 'transparent', flex: 1,
              padding: '12px 4px', outline: 'none', color: 'var(--text)',
              fontSize: '15px',
            }}
          />
          {procura && (
            <button
              type="button"
              onClick={() => setProcura('')}
              aria-label="Limpar procura"
              style={{
                background: 'var(--surface-3)', border: 'none', color: 'var(--text)',
                cursor: 'pointer', padding: '4px', borderRadius: '50%',
                width: '26px', height: '26px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.2s ease', fontSize: '12px',
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Tabs modernos */}
        {!procura && (
          <div className="portfolio-tabs" role="tablist" aria-label="Grupos de mercado">
            {GRUPOS.map((g) => (
              <button
                key={g.id}
                type="button"
                role="tab"
                aria-selected={grupo === g.id}
                className={`portfolio-tab ${grupo === g.id ? 'active' : ''}`}
                onClick={() => setGrupo(g.id)}
              >
                {g.icone}
                {g.rotulo}
              </button>
            ))}
          </div>
        )}

        {/* Estado da ligação + contagem */}
        <div style={{
          display: 'flex', alignItems: 'center', padding: '0 4px',
          animation: 'fadeSlideIn 0.4s ease-out 0.15s both',
        }}>
          <Ligacao />
          <span className="grow" />
          <span className="badge-count" style={{
            background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
            color: 'var(--accent-strong)',
          }}>
            <span className="live-dot" style={{ background: 'var(--accent)' }} />
            {lista.length} instrumento{lista.length === 1 ? '' : 's'}
          </span>
        </div>

        {/* Lista ou vazio */}
        {lista.length === 0 ? (
          <div className="glass-panel" style={{
            padding: '48px 24px', textAlign: 'center',
            borderRadius: '20px', animation: 'fadeSlideIn 0.4s ease-out both',
          }}>
            <div style={{ marginBottom: '12px' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
              </svg>
            </div>
            <strong style={{ display: 'block', marginBottom: '4px' }}>Nada corresponde a &ldquo;{procura}&rdquo;.</strong>
            <span className="text-dim" style={{ fontSize: '13px' }}>Experimente o código (EURUSD) ou o nome (Nasdaq).</span>
          </div>
        ) : (
          <div className="glass-panel" style={{
            borderRadius: '20px', overflow: 'hidden',
            padding: '8px 0',
            animation: 'fadeSlideIn 0.4s ease-out 0.2s both',
            position: 'relative',
          }}>
            {/* Shimmer bar */}
            <div className="section-shimmer" />
            <ListaIndices simbolos={lista} href={(c) => `/grafico?s=${encodeURIComponent(c)}`} />
          </div>
        )}
      </div>

      {/* Footer */}
      <footer style={{
        padding: '16px 20px', marginTop: '24px',
        borderRadius: '14px', fontSize: '12px', lineHeight: 1.6,
        color: 'var(--text-faint)',
        background: 'var(--surface-2)', border: '1px solid var(--border)',
        animation: 'fadeSlideIn 0.5s ease-out 0.3s both',
        display: 'flex', alignItems: 'flex-start', gap: '8px',
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '2px' }}>
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <span>
          Tocar num mercado abre o terminal, com o gráfico ao vivo e o painel de ordem. Para a
          análise MMXM completa de um dos 17 instrumentos do motor, use o{' '}
          <Link href="/" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>Início</Link>.
        </span>
      </footer>
    </div>
  );
}
