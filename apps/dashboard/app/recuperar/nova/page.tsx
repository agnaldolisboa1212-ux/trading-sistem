'use client';

/**
 * Palavra-passe nova, com a sessão aberta pelo email de recuperação (ou por
 * quem já entrou e a quer mudar). O middleware só deixa chegar aqui com sessão.
 */

import { useState } from 'react';
import { definirPalavraPasse, problemaPalavraPasse } from '@/lib/auth';
import { CampoPalavraPasse, Erro, Marca, irPara } from '@/components/conta/Conta';
import '../../onboarding.css';

export default function Page() {
  const [palavraPasse, setPalavraPasse] = useState('');
  const [repetir, setRepetir] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const problema = palavraPasse ? problemaPalavraPasse(palavraPasse) : null;
  const pode = !problemaPalavraPasse(palavraPasse) && repetir === palavraPasse;

  const guardar = async () => {
    setErro(null);
    setOcupado(true);
    const r = await definirPalavraPasse(palavraPasse);
    setOcupado(false);
    if (r.ok) irPara('/');
    else setErro(r.erro);
  };

  return (
    <div className="wrap ob">
      <Marca titulo="Palavra-passe nova" sub="Use uma que não use noutro sítio" />
      <div className="card">
        <CampoPalavraPasse rotulo="Palavra-passe nova" valor={palavraPasse} mudar={setPalavraPasse} nova />
        {problema && <p className="ob__ajuda">{problema}</p>}
        <CampoPalavraPasse
          rotulo="Repetir"
          valor={repetir}
          mudar={setRepetir}
          nova
          aoEnter={pode ? () => void guardar() : undefined}
        />
        {repetir.length > 0 && repetir !== palavraPasse && (
          <p className="ob__ajuda">As duas não são iguais.</p>
        )}
        <button
          type="button"
          className="btn primary block"
          onClick={() => void guardar()}
          disabled={ocupado || !pode}
        >
          {ocupado ? 'a guardar…' : 'Guardar e entrar'}
        </button>
      </div>
      <Erro texto={erro} />
    </div>
  );
}
