'use client';

/**
 * "Entrar com a Deriv" — um só botão, usado no onboarding e nas definições.
 *
 * Diz para onde vai antes de ir: a página de login é da Deriv, e a senha nunca
 * passa por esta aplicação. Quem vai confiar uma conta com dinheiro a um botão
 * tem direito a saber isso sem ter de perguntar.
 */

import Link from 'next/link';
import { useState } from 'react';
import { ligarContaDeriv } from '@/lib/api';

export function BotaoLigarDeriv({ texto = 'Entrar com a Deriv' }: { texto?: string }) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const ligar = async () => {
    setErro(null);
    setOcupado(true);
    const falha = await ligarContaDeriv();
    // Sem falha, o browser já está a caminho da Deriv: não reativar o botão.
    if (falha) {
      setErro(falha);
      setOcupado(false);
    }
  };

  return (
    <>
      <button type="button" className="btn primary block" disabled={ocupado} onClick={() => void ligar()}>
        {ocupado ? 'a abrir a Deriv…' : texto}
      </button>
      {erro && (
        <div className="ob__erro">
          {erro}
          {/plataforma|sessão/i.test(erro) && (
            <>
              {' '}
              <Link href="/entrar">Entrar</Link>
            </>
          )}
        </div>
      )}
    </>
  );
}
