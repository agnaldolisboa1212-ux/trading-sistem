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
import { temEstrategiaEmTeste, temEstrategiaValidada } from '@trading/core';
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

const ABAS: Array<{ id: Aba; rotulo: string }> = [
  { id: 'indices', rotulo: 'Índices' },
  { id: 'sinteticos', rotulo: '24/7' },
  { id: 'materias', rotulo: 'Ouro e cripto' },
];

export default function Page() {
  const [aba, setAba] = useState<Aba>('indices');

  return (
    <div className="wrap">
      <div className="cabeca">
        <div className="cabeca__id">
          <p className="cabeca__saudacao">A sua conta</p>
          <h1>Portfólio</h1>
        </div>
        <Ligacao rotulo={false} />
      </div>

      <div className="metrics-grid">
        <CartaoSaldo />
        <MeusInstrumentos />
      </div>

      <Posicoes />

      <section className="card glass-panel" style={{ padding: '24px', marginTop: '32px' }}>
        <div className="section-head" style={{ marginBottom: '16px' }}>
          <h2 style={{ fontSize: '18px', margin: 0 }}>Mercados</h2>
          <span className="grow" />
          <Link href="/mercados" className="btn ghost" style={{ padding: '4px 8px', fontSize: '14px' }}>ver todos</Link>
        </div>

        <div className="abas" role="tablist" aria-label="Grupos de mercado" style={{ marginBottom: '24px' }}>
          {ABAS.map((a) => (
            <button
              key={a.id}
              type="button"
              role="tab"
              aria-selected={aba === a.id}
              className={aba === a.id ? 'active' : ''}
              onClick={() => setAba(a.id)}
            >
              {a.rotulo}
            </button>
          ))}
        </div>

        {aba === 'indices' && (
          <>
            <p className="text-dim" style={{ fontSize: '13px', lineHeight: 1.4, marginBottom: '16px' }}>
              Índices mundiais a vista. Fecham ao fim de semana e fora do horário da bolsa
              respetiva — quando isso acontece a linha diz <em>fech.</em> em vez de fingir um preço.
            </p>
            <ListaIndices simbolos={INDICES} />
          </>
        )}

        {aba === 'sinteticos' && (
          <>
            <p className="text-dim" style={{ fontSize: '13px', lineHeight: 1.4, marginBottom: '16px' }}>
              Índices sintéticos da Deriv: <strong>não são mercados reais</strong>, são séries
              geradas com volatilidade fixa. Negoceiam 24 horas por dia, todos os dias — é o que
              se mexe quando as bolsas estão fechadas.
            </p>
            <ListaIndices simbolos={SINTETICOS} />
          </>
        )}

        {aba === 'materias' && (
          <>
            <p className="text-dim" style={{ fontSize: '13px', lineHeight: 1.4, marginBottom: '16px' }}>
              Metais preciosos e criptomoedas. A cripto negoceia 24/7; os metais seguem o horário
              do mercado à vista.
            </p>
            <ListaIndices simbolos={[...METAIS, ...CRIPTO]} />
          </>
        )}
      </section>

      <section className="card glass-panel" style={{ padding: '24px', marginTop: '32px' }}>
        <div className="section-head" style={{ marginBottom: '8px' }}>
          <h2 style={{ fontSize: '18px', margin: 0 }}>Desempenho da estratégia</h2>
          <span className="grow" />
          <Link href="/financeiro" className="btn primary" style={{ padding: '4px 12px', fontSize: '14px' }}>abrir</Link>
        </div>
        <p className="text-dim" style={{ fontSize: '13px', lineHeight: 1.4, margin: 0 }}>
          O saldo diz quanto está na conta. Se a estratégia tem vantagem é outra pergunta, medida
          em múltiplos de risco e não em dinheiro — está no Financeiro.
        </p>
      </section>
    </div>
  );
}

/**
 * Os instrumentos que a conta segue.
 *
 * É daqui que saem os sinais: só chegam ao telemóvel e ao início os dos
 * instrumentos desta lista.
 */
function MeusInstrumentos() {
  const p = usarPortfolio();
  const [escolher, setEscolher] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const correr = async (accao: Promise<string | null>) => {
    setErro(await accao);
  };

  return (
    <div className="card glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1, padding: '24px' }}>
      <div className="section-head" style={{ marginBottom: 0 }}>
        <h2 style={{ fontSize: '18px', margin: 0 }}>Os meus instrumentos</h2>
        <span className="grow" />
        <button type="button" className="btn primary" onClick={() => setEscolher(true)} style={{ padding: '6px 12px', fontSize: '14px' }}>
          + adicionar
        </button>
      </div>
      <p className="text-dim" style={{ fontSize: '13px', lineHeight: 1.4, margin: 0 }}>
        Só recebe sinais — no telemóvel e no início — dos instrumentos desta lista, e só dos que têm
        uma estratégia com vantagem medida: índices (US100, SP500, US30, GER30) e cripto (BTC, ETH).
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
          {p.instrumentos.map((c) => {
            const validada = temEstrategiaValidada(c);
            const emTeste = !validada && temEstrategiaEmTeste(c);
            return (
              <span
                key={c}
                className={`chip-portfolio ${validada || emTeste ? '' : 'chip-portfolio--sem-sinais'}`}
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
                  {emTeste && <small> · em teste</small>}
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
 *
 * É a mesma carteira do terminal, sem filtro de instrumento: modificar SL/TP,
 * fechar tudo ou parte e cancelar pendentes, cada acção com confirmação.
 */
function Posicoes() {
  const c = usarCtrader();
  if (!c.ligada) return null;
  return (
    <section style={{ marginTop: '32px' }}>
      <div className="section-head">
        <h2>Posições e ordens</h2>
        <span className="grow" />
        <span className="chip-estado bear-bg" style={{ padding: '4px 8px', borderRadius: '8px', fontSize: '13px' }}>
          {c.posicoes.length + c.ordens.length} ativas
        </span>
      </div>
      <div className="glass-panel" style={{ padding: '24px', borderRadius: '16px' }}>
        <Carteira />
      </div>
    </section>
  );
}
