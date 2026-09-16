'use client';

/**
 * Selector de mercado — a folha que sobe quando se toca no símbolo.
 *
 * ── PORQUÊ UMA FOLHA E NÃO UMA PÁGINA ──────────────────────────────────────
 *
 * Trocar de instrumento é a coisa mais frequente que se faz num terminal. Se
 * for uma navegação, cada troca desmonta o gráfico, perde o estado do painel de
 * ordem e obriga a voltar. Como folha por cima, o que está por baixo continua
 * lá — é o comportamento do MetaTrader e da Exness, e é o certo.
 *
 * Os preços de cada linha estão ao vivo: quem procura um mercado quer ver como
 * está antes de o abrir. Só as linhas visíveis é que subscrevem, por causa do
 * `IntersectionObserver` dentro de `ListaIndices`.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ListaIndices } from './ListaIndices';
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

type Grupo = 'meus' | 'indices' | 'forex' | 'sinteticos' | 'outros';

const GRUPOS: Array<{ id: Grupo; rotulo: string }> = [
  { id: 'meus', rotulo: 'Os meus' },
  { id: 'indices', rotulo: 'Índices' },
  { id: 'forex', rotulo: 'Forex' },
  { id: 'sinteticos', rotulo: '24/7' },
  { id: 'outros', rotulo: 'Metais e cripto' },
];

export function SelectorMercado({
  actual,
  aoEscolher,
  aoFechar,
}: {
  actual: string;
  aoEscolher: (codigo: string) => void;
  aoFechar: () => void;
}) {
  const [grupo, setGrupo] = useState<Grupo>('meus');
  const [procura, setProcura] = useState('');
  const campo = useRef<HTMLInputElement | null>(null);

  // Escape fecha, como qualquer overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') aoFechar();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [aoFechar]);

  const meus = useMemo(() => {
    const prefs = lerPreferenciasCliente();
    const escolhidos = prefs.instrumentos
      .map((c) => TODOS.find((t) => t.codigo === c))
      .filter((s): s is SimboloDeriv => Boolean(s));
    // Se o onboarding não deu nada utilizável, mostra os índices em vez de um
    // separador vazio que parece avaria.
    return escolhidos.length > 0 ? escolhidos : INDICES.slice(0, 6);
  }, []);

  const lista = useMemo((): readonly SimboloDeriv[] => {
    const termo = procura.trim().toLowerCase();
    if (termo) {
      return TODOS.filter(
        (s) =>
          s.codigo.toLowerCase().includes(termo) || s.nome.toLowerCase().includes(termo),
      );
    }
    switch (grupo) {
      case 'meus':
        return meus;
      case 'indices':
        return INDICES;
      case 'forex':
        return FOREX;
      case 'sinteticos':
        return SINTETICOS;
      case 'outros':
        return [...METAIS, ...CRIPTO];
    }
  }, [grupo, procura, meus]);

  return (
    <div className="folha" role="dialog" aria-modal="true" aria-label="Escolher mercado">
      {/* O fundo escuro é um botão real: tocar fora fecha, e leitores de ecrã
          anunciam-no em vez de o ignorarem como uma div decorativa. */}
      <button type="button" className="folha__fundo" onClick={aoFechar} aria-label="Fechar" />

      <div className="folha__corpo">
        <div className="folha__pega" aria-hidden="true" />

        <div className="folha__topo">
          <input
            ref={campo}
            className="folha__procura"
            type="search"
            inputMode="search"
            placeholder="Procurar mercado…"
            value={procura}
            onChange={(e) => setProcura(e.target.value)}
            aria-label="Procurar mercado"
          />
          <button type="button" className="folha__fechar" onClick={aoFechar} aria-label="Fechar">
            ✕
          </button>
        </div>

        {!procura && (
          <div className="abas abas--folha" role="tablist" aria-label="Grupos">
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

        <div className="folha__lista">
          {lista.length === 0 ? (
            <div className="empty">
              <strong>Nada corresponde a “{procura}”.</strong>
              Experimente o código (EURUSD) ou o nome (Nasdaq).
            </div>
          ) : (
            <ListaIndices
              simbolos={lista}
              aoTocar={(c) => aoEscolher(c)}
              activo={actual}
            />
          )}
        </div>
      </div>
    </div>
  );
}
