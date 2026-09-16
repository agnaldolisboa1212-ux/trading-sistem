'use client';

/**
 * Recarrega a análise a cada intervalo, com contagem visível.
 *
 * Usa `router.refresh()`, que re-executa o Server Component e substitui o HTML
 * sem perder o estado do cliente — o zoom e o pan do gráfico sobrevivem à
 * atualização. Um `location.reload()` faria o gráfico saltar para a vista
 * inicial a cada minuto, o que o tornaria inutilizável.
 *
 * Pausa quando o separador está escondido: manter uma análise a correr de minuto
 * a minuto num separador que ninguém está a ver desperdiça quota das APIs
 * públicas, que é o recurso mais escasso do sistema.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export function AutoRefresh({
  intervalMs = 60_000,
  updatedAt,
}: {
  intervalMs?: number;
  updatedAt: number;
}) {
  const router = useRouter();
  const [restante, setRestante] = useState(Math.round(intervalMs / 1000));
  const [ativo, setAtivo] = useState(true);
  const [aRecarregar, setARecarregar] = useState(false);
  const inicio = useRef(Date.now());

  // Nova renderização do servidor: reinicia a contagem.
  useEffect(() => {
    inicio.current = Date.now();
    setARecarregar(false);
    setRestante(Math.round(intervalMs / 1000));
  }, [updatedAt, intervalMs]);

  useEffect(() => {
    if (!ativo) return;

    const tick = setInterval(() => {
      if (document.hidden) return; // separador escondido: não gasta quota
      const passou = Date.now() - inicio.current;
      const falta = Math.max(0, Math.round((intervalMs - passou) / 1000));
      setRestante(falta);
      if (passou >= intervalMs) {
        inicio.current = Date.now();
        setARecarregar(true);
        router.refresh();
      }
    }, 1000);

    return () => clearInterval(tick);
  }, [ativo, intervalMs, router]);

  return (
    <div className="autorefresh">
      <span className={aRecarregar ? 'pulse' : ''} aria-live="polite">
        {aRecarregar ? 'a atualizar…' : ativo ? `atualiza em ${restante}s` : 'atualização pausada'}
      </span>
      <button type="button" onClick={() => setAtivo((v) => !v)}>
        {ativo ? 'pausar' : 'retomar'}
      </button>
      <button
        type="button"
        onClick={() => {
          inicio.current = Date.now();
          setARecarregar(true);
          router.refresh();
        }}
      >
        atualizar agora
      </button>
    </div>
  );
}
