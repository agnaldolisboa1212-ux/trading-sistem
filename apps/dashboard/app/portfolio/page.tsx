'use client';

/**
 * Portfólio — a conta, o que está aberto, e os índices mundiais.
 *
 * ── PORQUÊ ESTA PÁGINA EXISTE SEPARADA DO FINANCEIRO ───────────────────────
 *
 * O Financeiro mede a ESTRATÉGIA: R realizado, expectativa, distribuição.
 * Unidades de risco, histórico, nada de dinheiro. Esta mede a CONTA: quanto lá
 * está, o que está aberto agora, quanto vale neste segundo.
 *
 * São perguntas diferentes feitas em momentos diferentes. Juntá-las numa página
 * obrigaria a rolar por uma curva de capital em múltiplos de R para descobrir
 * se uma posição está a ganhar.
 *
 * ── OS ÍNDICES ─────────────────────────────────────────────────────────────
 *
 * S&P 500, Nasdaq 100, Dow 30 e DAX estão primeiro porque foram os pedidos.
 * Os outros oito vieram no mesmo `active_symbols` da Deriv e não custam nada.
 *
 * Ao fim de semana as bolsas estão fechadas e estas linhas ficam paradas — por
 * isso os sintéticos, que negoceiam 24/7, aparecem logo a seguir em vez de
 * ficarem escondidos num submenu. Um painel que não se mexe ao sábado parece
 * avariado mesmo quando está correto.
 */

import Link from 'next/link';
import { ESTRATEGIAS_ACTIVAS, temEstrategiaEmTeste, temEstrategiaValidada } from '@trading/core';
import { useState } from 'react';
import { CartaoSaldo } from '@/components/vivo/CartaoSaldo';
import { SelectorMercado } from '@/components/vivo/SelectorMercado';
import { usarPortfolio } from '@/components/vivo/usarPortfolio';
import { ListaIndices } from '@/components/vivo/ListaIndices';
import { Ligacao } from '@/components/vivo/Preco';
import { Carteira } from '@/components/vivo/Negociar';
import { usarCtrader } from '@/components/vivo/usarCtrader';
import { INDICES, SINTETICOS, CRIPTO, METAIS } from '@/lib/deriv/simbolos';

type Aba = 'indices' | 'sinteticos' | 'materias';

const ABAS: Array<{ id: Aba; rotulo: string; icone: React.ReactNode }> = [
  {
    id: 'indices',
    rotulo: 'Índices',
    icone: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" /><path d="M18 9l-5 5-4-4-6 6" />
      </svg>
    ),
  },
  {
    id: 'sinteticos',
    rotulo: '24/7',
    icone: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
      </svg>
    ),
  },
  {
    id: 'materias',
    rotulo: 'Ouro e cripto',
    icone: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
      </svg>
    ),
  },
];

/** Os instrumentos que alguma estratégia cobre — os que vale a pena seguir. */
const CATALOGO = [...new Set(ESTRATEGIAS_ACTIVAS.flatMap((e) => e.instrumentos))].sort();

export default function Page() {
  const [aba, setAba] = useState<Aba>('indices');

  return (
    <div className="wrap">
      {/* Header premium com gradiente subtil */}
      <div className="cabeca portfolio-hero" style={{
        background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 8%, var(--surface)) 0%, var(--surface) 100%)',
        border: '1px solid color-mix(in srgb, var(--accent) 15%, var(--border))',
        animation: 'fadeSlideIn 0.5s ease-out both',
      }}>
        {/* Brilho decorativo animado */}
        <div style={{
          position: 'absolute', top: '-50%', right: '-20%',
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
            }}>A sua conta</p>
            <h1 style={{ fontWeight: 800, letterSpacing: '-0.03em', margin: 0 }}>Portfólio</h1>
          </div>
          <Ligacao rotulo={false} />
        </div>
      </div>

      {/* Métricas principais — com animação escalonada */}
      <div className="metrics-grid" style={{ animation: 'fadeSlideIn 0.5s ease-out 0.1s both' }}>
        <CartaoSaldo />
        <MeusInstrumentos />
      </div>

      {/* Posições */}
      <div style={{ animation: 'fadeSlideIn 0.5s ease-out 0.2s both' }}>
        <Posicoes />
      </div>

      {/* Mercados — tabs modernos */}
      <section className="card glass-panel" style={{
        padding: '28px',
        marginTop: '28px',
        borderRadius: '20px',
        animation: 'fadeSlideIn 0.5s ease-out 0.3s both',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Linha decorativa animada no topo */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '2px',
          background: 'linear-gradient(90deg, transparent, var(--accent), transparent)',
          animation: 'shimmerBar 3s ease-in-out infinite',
        }} />

        <div className="section-head" style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 20%, transparent), color-mix(in srgb, var(--accent) 8%, transparent))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            </div>
            <h2 style={{ fontSize: '18px', margin: 0, fontWeight: 700 }}>Mercados</h2>
          </div>
          <span className="grow" />
          <Link href="/mercados" className="btn ghost" style={{
            padding: '6px 14px',
            fontSize: '13px',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}>
            ver todos
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" /><path d="M12 5l7 7-7 7" />
            </svg>
          </Link>
        </div>

        {/* Tabs estilizados — classes CSS para responsividade */}
        <div className="portfolio-tabs" role="tablist" aria-label="Grupos de mercado">
          {ABAS.map((a) => (
            <button
              key={a.id}
              type="button"
              role="tab"
              aria-selected={aba === a.id}
              className={`portfolio-tab ${aba === a.id ? 'active' : ''}`}
              onClick={() => setAba(a.id)}
            >
              {a.icone}
              {a.rotulo}
            </button>
          ))}
        </div>

        <div key={aba} style={{ animation: 'fadeSlideIn 0.3s ease-out both' }}>
          {aba === 'indices' && (
            <>
              <p className="text-dim" style={{ fontSize: '13px', lineHeight: 1.5, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{
                  width: '6px', height: '6px', borderRadius: '50%',
                  background: 'var(--bull)', display: 'inline-block',
                  animation: 'pulseGlow 2s ease-in-out infinite',
                }} />
                Índices mundiais a vista. Fecham ao fim de semana e fora do horário da bolsa
                respetiva — quando isso acontece a linha diz <em>fech.</em> em vez de fingir um preço.
              </p>
              <ListaIndices simbolos={INDICES} />
            </>
          )}

          {aba === 'sinteticos' && (
            <>
              <p className="text-dim" style={{ fontSize: '13px', lineHeight: 1.5, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{
                  width: '6px', height: '6px', borderRadius: '50%',
                  background: 'var(--accent)', display: 'inline-block',
                  animation: 'pulseGlow 2s ease-in-out infinite',
                }} />
                Índices sintéticos da Deriv: <strong>não são mercados reais</strong>, são séries
                geradas com volatilidade fixa. Negoceiam 24 horas por dia, todos os dias.
              </p>
              <ListaIndices simbolos={SINTETICOS} />
            </>
          )}

          {aba === 'materias' && (
            <>
              <p className="text-dim" style={{ fontSize: '13px', lineHeight: 1.5, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{
                  width: '6px', height: '6px', borderRadius: '50%',
                  background: 'var(--warn)', display: 'inline-block',
                  animation: 'pulseGlow 2s ease-in-out infinite',
                }} />
                Metais preciosos e criptomoedas. A cripto negoceia 24/7; os metais seguem o horário
                do mercado à vista.
              </p>
              <ListaIndices simbolos={[...METAIS, ...CRIPTO]} />
            </>
          )}
        </div>
      </section>

      {/* CTA — Desempenho da estratégia */}
      <section className="card glass-panel" style={{
        padding: '28px',
        marginTop: '28px',
        borderRadius: '20px',
        animation: 'fadeSlideIn 0.5s ease-out 0.4s both',
        position: 'relative',
        overflow: 'hidden',
        background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 6%, var(--surface)) 0%, var(--surface) 100%)',
      }}>
        <div className="section-head" style={{ marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, color-mix(in srgb, var(--bull) 20%, transparent), color-mix(in srgb, var(--bull) 8%, transparent))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--bull)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20V10" /><path d="M18 20V4" /><path d="M6 20v-4" />
              </svg>
            </div>
            <h2 style={{ fontSize: '18px', margin: 0, fontWeight: 700 }}>Desempenho da estratégia</h2>
          </div>
          <span className="grow" />
          <Link href="/financeiro" className="btn primary" style={{
            padding: '8px 20px',
            fontSize: '14px',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontWeight: 600,
          }}>
            abrir
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" /><path d="M12 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
        <p className="text-dim" style={{ fontSize: '13px', lineHeight: 1.5, margin: 0 }}>
          O saldo diz quanto está na conta. Se a estratégia tem vantagem é outra pergunta, medida
          em múltiplos de risco e não em dinheiro — está no Financeiro.
        </p>
      </section>
    </div>
  );
}

/**
 * Os instrumentos que a conta segue.
 */
function MeusInstrumentos() {
  const p = usarPortfolio();
  const [escolher, setEscolher] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const correr = async (accao: Promise<string | null>) => {
    setErro(await accao);
  };

  return (
    <div className="card glass-panel" style={{
      display: 'flex', flexDirection: 'column', gap: '16px', flex: 1, padding: '24px',
      borderRadius: '20px', position: 'relative', overflow: 'hidden',
    }}>
      <div className="section-head" style={{ marginBottom: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '32px', height: '32px', borderRadius: '8px',
            background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 18%, transparent), color-mix(in srgb, var(--accent) 6%, transparent))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
              <line x1="7" y1="7" x2="7.01" y2="7" />
            </svg>
          </div>
          <h2 style={{ fontSize: '16px', margin: 0, fontWeight: 700 }}>Os meus instrumentos</h2>
        </div>
        <span className="grow" />
        <button type="button" className="btn primary" onClick={() => setEscolher(true)} style={{
          padding: '6px 14px', fontSize: '13px', borderRadius: '10px',
          display: 'flex', alignItems: 'center', gap: '4px',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14" /><path d="M5 12h14" />
          </svg>
          adicionar
        </button>
      </div>

      <p className="text-dim" style={{ fontSize: '12px', lineHeight: 1.4, margin: 0 }}>
        Só recebe sinais dos instrumentos desta lista que tenham estratégia com vantagem medida.
      </p>

      {p.instrumentos === null ? (
        <div className="brilho" style={{ height: 60, borderRadius: 16 }} />
      ) : p.instrumentos.length === 0 ? (
        <div className="empty">
          <strong>Ainda não segue nenhum instrumento.</strong>
          Adicione os mercados que quer acompanhar para começar a receber sinais.
        </div>
      ) : (
        <div className="chips-portfolio">
          {p.instrumentos.map((c, i) => {
            const validada = temEstrategiaValidada(c);
            const emTeste = !validada && temEstrategiaEmTeste(c);
            return (
              <span
                key={c}
                className={`chip-portfolio ${validada || emTeste ? '' : 'chip-portfolio--sem-sinais'}`}
                style={{ animation: `fadeSlideIn 0.3s ease-out ${i * 0.05}s both` }}
                title={
                  validada
                    ? 'Com estratégia validada'
                    : emTeste
                      ? 'Em teste ao vivo: sinais sem taxa de acerto medida ainda'
                      : 'Sem estratégia com vantagem medida: não gera sinais'
                }
              >
                <Link href={`/grafico?s=${encodeURIComponent(c)}`}>
                  {c}
                  {emTeste && <small> · sem taxa medida</small>}
                  {!validada && !emTeste && <small> · sem sinais</small>}
                </Link>
                <button type="button" aria-label={`Remover ${c} do portfólio`} onClick={() => void correr(p.remover(c))}>
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}
      {erro && <div className="ob__erro" style={{ marginTop: 'auto' }}>{erro}</div>}

      {escolher && (
        <SelectorMercado
          actual=""
          // Os instrumentos com estratégia que ainda não estão no portfólio:
          // é isso que se quer ver ao tocar em "adicionar".
          recomendados={CATALOGO.filter((c) => !(p.instrumentos ?? []).includes(c))}
          aoFechar={() => setEscolher(false)}
          aoEscolher={(c) => {
            setEscolher(false);
            void correr(p.adicionar(c));
          }}
        />
      )}
    </div>
  );
}

/**
 * Posições e ordens pendentes da conta cTrader, com lucro a mexer.
 */
function Posicoes() {
  const c = usarCtrader();
  if (!c.ligada) return null;
  return (
    <section style={{ marginTop: '28px' }}>
      <div className="section-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '32px', height: '32px', borderRadius: '8px',
            background: 'linear-gradient(135deg, color-mix(in srgb, var(--bear) 18%, transparent), color-mix(in srgb, var(--bear) 6%, transparent))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--bear)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
            </svg>
          </div>
          <h2 style={{ margin: 0 }}>Posições e ordens</h2>
        </div>
        <span className="grow" />
        <span style={{
          padding: '5px 12px', borderRadius: '10px', fontSize: '12px', fontWeight: 700,
          background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
          color: 'var(--accent-strong)',
          display: 'flex', alignItems: 'center', gap: '5px',
        }}>
          <span style={{
            width: '6px', height: '6px', borderRadius: '50%',
            background: 'var(--accent)',
            animation: 'pulseGlow 2s ease-in-out infinite',
          }} />
          {c.posicoes.length + c.ordens.length} ativas
        </span>
      </div>
      <div className="glass-panel" style={{ padding: '24px', borderRadius: '20px' }}>
        <Carteira />
      </div>
    </section>
  );
}
