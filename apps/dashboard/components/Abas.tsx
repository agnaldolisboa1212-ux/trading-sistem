'use client';

/**
 * Abas — Overview / Statistics / History Data.
 *
 * OS PAINÉIS SÃO RENDERIZADOS NO SERVIDOR. Chegam aqui como `children` já
 * prontos, não como dados a transformar. Isso importa por duas razões:
 *
 *   1. A análise de um instrumento custa 1-2 segundos. Se as abas navegassem
 *      por query string (como o `TimeframeSwitch`), cada toque numa aba
 *      re-corria a análise inteira para mostrar números que já estavam
 *      calculados. Assim a troca é instantânea.
 *   2. Nada da análise atravessa para o cliente: o que viaja é HTML, não o
 *      resultado do motor. O `bundle` não cresce com o tamanho da análise.
 *
 * O painel inativo é DESMONTADO, não escondido. Os gráficos de SMT medem-se
 * contra a caixa que os contém e uma caixa com `display: none` mede zero — um
 * painel escondido acordaria com o gráfico colapsado.
 */

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface Aba {
  id: string;
  rotulo: string;
  painel: ReactNode;
}

export function Abas({ abas, inicial }: { abas: Aba[]; inicial?: string }) {
  const [ativa, setAtiva] = useState(() => inicial ?? abas[0]?.id ?? '');
  const tablist = useRef<HTMLDivElement | null>(null);

  const atual = abas.find((a) => a.id === ativa) ?? abas[0];
  if (!atual) return null;

  /*
   * Setas, Home e End: é o que o padrão de `tablist` exige e o que quem navega
   * por teclado espera. Sem isto, cada aba entraria na ordem de tabulação e
   * chegar ao conteúdo obrigaria a passar por todas.
   */
  const teclas = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = abas.findIndex((a) => a.id === ativa);
    let proximo = -1;
    if (e.key === 'ArrowRight') proximo = (i + 1) % abas.length;
    else if (e.key === 'ArrowLeft') proximo = (i - 1 + abas.length) % abas.length;
    else if (e.key === 'Home') proximo = 0;
    else if (e.key === 'End') proximo = abas.length - 1;
    if (proximo < 0) return;

    e.preventDefault();
    const alvo = abas[proximo];
    if (!alvo) return;
    setAtiva(alvo.id);
    // O foco segue a seleção — senão as setas seguintes voltariam a partir da
    // aba antiga.
    tablist.current?.querySelector<HTMLButtonElement>(`#aba-${alvo.id}`)?.focus();
  };

  return (
    <>
      <div
        className="segmented abas"
        role="tablist"
        aria-label="Detalhe do instrumento"
        ref={tablist}
        onKeyDown={teclas}
      >
        {abas.map((a) => (
          <button
            key={a.id}
            id={`aba-${a.id}`}
            type="button"
            role="tab"
            className={a.id === ativa ? 'active' : ''}
            aria-selected={a.id === ativa}
            aria-controls={`painel-${a.id}`}
            // Tabulação rotativa: só a aba ativa está na ordem de tabulação.
            tabIndex={a.id === ativa ? 0 : -1}
            onClick={() => setAtiva(a.id)}
          >
            {a.rotulo}
          </button>
        ))}
      </div>

      <div id={`painel-${atual.id}`} role="tabpanel" aria-labelledby={`aba-${atual.id}`}>
        {atual.painel}
      </div>
    </>
  );
}
