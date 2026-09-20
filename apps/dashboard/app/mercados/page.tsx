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

const GRUPOS: Array<{ id: Grupo; rotulo: string; lista: readonly SimboloDeriv[] }> = [
  { id: 'meus', rotulo: 'Os meus', lista: [] },
  { id: 'indices', rotulo: 'Índices', lista: INDICES },
  { id: 'forex', rotulo: 'Forex', lista: FOREX },
  { id: 'sinteticos', rotulo: '24/7', lista: SINTETICOS },
  { id: 'metais', rotulo: 'Metais', lista: METAIS },
  { id: 'cripto', rotulo: 'Cripto', lista: CRIPTO },
  { id: 'todos', rotulo: 'Todos', lista: TODOS },
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
      <div className="cabeca">
        <div className="cabeca__id">
          <p className="cabeca__saudacao">{TODOS.length} instrumentos</p>
          <h1>Mercados</h1>
        </div>
        <SaldoCompacto />
      </div>

      <div className="card glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', border: 'none', background: 'transparent', boxShadow: 'none' }}>
        <div className="procura glass-pill" style={{ margin: 0, padding: '0 20px', display: 'flex', alignItems: 'center', height: '52px' }}>
          <span aria-hidden="true" style={{ color: 'var(--text-faint)', fontSize: '20px' }}>⌕</span>
          <input
            type="search"
            inputMode="search"
            placeholder="Procurar símbolo ou nome"
            value={procura}
            onChange={(e) => setProcura(e.target.value)}
            aria-label="Procurar mercado"
            style={{ border: 'none', background: 'transparent', flex: 1, padding: '12px 8px', outline: 'none', color: 'var(--text)' }}
          />
          {procura && (
            <button type="button" onClick={() => setProcura('')} aria-label="Limpar procura" style={{ background: 'var(--surface-3)', border: 'none', color: 'var(--text)', cursor: 'pointer', padding: '6px', borderRadius: '50%', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s ease' }}>
              ✕
            </button>
          )}
        </div>

        {!procura && (
          <div className="abas" role="tablist" aria-label="Grupos de mercado" style={{ margin: 0 }}>
            {GRUPOS.map((g) => (
              <button
                key={g.id}
                type="button"
                role="tab"
                aria-selected={grupo === g.id}
                className={grupo === g.id ? 'active' : ''}
                onClick={() => setGrupo(g.id)}
              >
                {g.rotulo}
              </button>
            ))}
          </div>
        )}

        <div className="mercados__contagem" style={{ display: 'flex', alignItems: 'center', margin: 0, padding: '0 8px' }}>
          <Ligacao />
          <span className="grow" />
          <span className="text-dim" style={{ fontSize: '13px' }}>
            {lista.length} instrumento{lista.length === 1 ? '' : 's'}
          </span>
        </div>

        {lista.length === 0 ? (
          <div className="empty" style={{ margin: 0, padding: '48px 0' }}>
            <strong>Nada corresponde a “{procura}”.</strong>
            Experimente o código (EURUSD) ou o nome (Nasdaq).
          </div>
        ) : (
          <div style={{ margin: '0 -8px' }}>
            <ListaIndices simbolos={lista} href={(c) => `/grafico?s=${encodeURIComponent(c)}`} />
          </div>
        )}
      </div>

      <footer className="note">
        Tocar num mercado abre o terminal, com o gráfico ao vivo e o painel de ordem. Para a
        análise MMXM completa de um dos 17 instrumentos do motor, use o{' '}
        <Link href="/">Início</Link>.
      </footer>
    </div>
  );
}
