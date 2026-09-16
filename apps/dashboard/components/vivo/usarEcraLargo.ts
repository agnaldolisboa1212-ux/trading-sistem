'use client';

import { useEffect, useState } from 'react';

/**
 * Ecrã largo (computador) e altura útil da janela.
 *
 * No computador o terminal passa a duas colunas e o gráfico cresce com a
 * janela; no telemóvel fica empilhado, com altura fixa para a análise aparecer
 * logo por baixo. Começa em "estreito" para o HTML do servidor coincidir com o
 * primeiro render do browser.
 */
export function usarEcraLargo(minimo = 1100): { largo: boolean; alturaJanela: number } {
  const [estado, setEstado] = useState({ largo: false, alturaJanela: 800 });
  useEffect(() => {
    const consulta = window.matchMedia(`(min-width: ${minimo}px)`);
    const ler = () => setEstado({ largo: consulta.matches, alturaJanela: window.innerHeight });
    ler();
    consulta.addEventListener('change', ler);
    window.addEventListener('resize', ler);
    return () => {
      consulta.removeEventListener('change', ler);
      window.removeEventListener('resize', ler);
    };
  }, [minimo]);
  return estado;
}
