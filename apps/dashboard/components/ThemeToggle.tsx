'use client';

/**
 * Alternador de tema: sistema → claro → escuro → sistema.
 *
 * Três estados, não dois. Um simples interruptor claro/escuro obriga a escolher
 * um deles para sempre; "sistema" deixa o painel seguir a preferência do
 * telemóvel, que é o que a maioria das pessoas quer — e continua a permitir
 * fixar um tema quando se quer o contrário do sistema.
 *
 * O estado vive em `data-theme` no `<html>`, exatamente como o CSS espera:
 *   ausente        → segue prefers-color-scheme
 *   data-theme=... → vence a preferência do sistema nos dois sentidos
 */

import { useEffect, useState } from 'react';

type Modo = 'system' | 'light' | 'dark';

const CHAVE = 'tema';
const SEQUENCIA: Modo[] = ['system', 'light', 'dark'];

const ROTULO: Record<Modo, string> = {
  system: 'sistema',
  light: 'claro',
  dark: 'escuro',
};

const ICONE: Record<Modo, string> = {
  system: '◐',
  light: '☀',
  dark: '☾',
};

function aplicar(modo: Modo): void {
  const root = document.documentElement;
  if (modo === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', modo);
}

export function ThemeToggle() {
  const [modo, setModo] = useState<Modo>('system');
  // Só depois de montar é que sabemos o que está no localStorage; até lá o
  // ícone renderizado no servidor não corresponderia ao do cliente.
  const [montado, setMontado] = useState(false);

  useEffect(() => {
    let guardado: Modo = 'system';
    try {
      const v = localStorage.getItem(CHAVE);
      if (v === 'light' || v === 'dark' || v === 'system') guardado = v;
    } catch {
      /* localStorage bloqueado — fica em 'system' */
    }
    setModo(guardado);
    setMontado(true);
  }, []);

  const avancar = () => {
    const proximo = SEQUENCIA[(SEQUENCIA.indexOf(modo) + 1) % SEQUENCIA.length]!;
    setModo(proximo);
    aplicar(proximo);
    try {
      localStorage.setItem(CHAVE, proximo);
    } catch {
      /* sem persistência, mas o tema aplica-se na mesma nesta sessão */
    }
  };

  return (
    <button
      type="button"
      className="iconbtn"
      onClick={avancar}
      title={`Tema: ${ROTULO[modo]}`}
      aria-label={`Tema: ${ROTULO[modo]}. Tocar para mudar.`}
    >
      {montado ? ICONE[modo] : ICONE.system}
    </button>
  );
}

/**
 * Script que corre ANTES da primeira pintura.
 *
 * Sem isto o painel pinta no tema por omissão e só depois salta para o
 * escolhido — o "flash" branco que se vê nos sites mal configurados. Tem de ser
 * uma string injetada, porque qualquer componente React já corre tarde demais.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${CHAVE}');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}})()`;
