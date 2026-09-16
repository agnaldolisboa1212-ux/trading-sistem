'use client';

/**
 * Mede o elemento em pixéis reais.
 *
 * PORQUÊ: os gráficos deste painel desenhavam-se num `viewBox` fixo de 1000
 * unidades e depois eram esticados com `width: 100%`. Isso amarra o gráfico a um
 * rácio: no telemóvel o texto encolhia até ficar ilegível (10px de fonte a 520
 * unidades ≈ 5px reais) e no computador a altura crescia com a largura, pelo que
 * o gráfico nunca podia simplesmente PREENCHER a caixa que lhe damos.
 *
 * Medindo a caixa, o `viewBox` passa a ser 1 unidade = 1 pixel: os tipos de
 * letra e as margens ficam constantes em qualquer largura e o tamanho passa a
 * ser decidido pelo CSS — que é onde as regras mobile-first vivem.
 *
 * A medição inicial acontece na callback do `ref`, que corre na fase de commit,
 * antes da pintura — não há um fotograma com a caixa vazia.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface Medida {
  w: number;
  h: number;
}

export function useMedida<T extends HTMLElement>(): [
  (node: T | null) => void,
  Medida,
] {
  const [medida, setMedida] = useState<Medida>({ w: 0, h: 0 });
  const alvo = useRef<T | null>(null);

  const registar = useCallback((node: T) => {
    const r = node.getBoundingClientRect();
    const w = Math.round(r.width);
    const h = Math.round(r.height);
    // Comparar antes de gravar evita um ciclo de render por cada notificação do
    // ResizeObserver quando o tamanho não mudou de facto.
    setMedida((m) => (m.w === w && m.h === h ? m : { w, h }));
  }, []);

  const ref = useCallback(
    (node: T | null) => {
      alvo.current = node;
      if (node) registar(node);
    },
    [registar],
  );

  useEffect(() => {
    const node = alvo.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observador = new ResizeObserver(() => registar(node));
    observador.observe(node);
    return () => observador.disconnect();
  }, [registar]);

  return [ref, medida];
}
