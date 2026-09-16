'use client';

/**
 * Segundo passo: o código da app de autenticação.
 *
 * O middleware manda para aqui quem entrou com palavra-passe (ou código por
 * email) numa conta com verificação em dois passos. Até confirmar, nenhuma
 * página nem rota de dados abre.
 */

import { useEffect, useState } from 'react';
import type { Factor } from '@supabase/supabase-js';
import { confirmar2fa, factores2fa, sair } from '@/lib/auth';
import { CampoCodigo, Erro, Marca, irPara } from '@/components/conta/Conta';
import '../../onboarding.css';

export default function Page() {
  const [factor, setFactor] = useState<Factor | null>(null);
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    void factores2fa().then((lista) => {
      const verificado = lista.find((f) => f.status === 'verified') ?? null;
      setFactor(verificado);
      if (!verificado) setErro('Esta conta não tem verificação em dois passos activa.');
    });
  }, []);

  const confirmar = async () => {
    if (!factor) return;
    setErro(null);
    setOcupado(true);
    const r = await confirmar2fa(factor.id, codigo);
    setOcupado(false);
    if (r.ok) irPara('/');
    else {
      setErro(r.erro);
      setCodigo('');
    }
  };

  return (
    <div className="wrap ob">
      <Marca titulo="Verificação em dois passos" sub="Abra a sua app de autenticação" />
      <div className="card">
        <CampoCodigo
          rotulo="Código de seis dígitos"
          valor={codigo}
          mudar={setCodigo}
          aoCompletar={() => void confirmar()}
        />
        <button
          type="button"
          className="btn primary block"
          onClick={() => void confirmar()}
          disabled={ocupado || !factor || codigo.length < 6}
        >
          {ocupado ? 'a verificar…' : 'Verificar'}
        </button>
        <button
          type="button"
          className="ob__link"
          onClick={() => void sair().then(() => irPara('/entrar'))}
        >
          sair e entrar com outra conta
        </button>
      </div>
      <Erro texto={erro} />
      <p className="ob__ajuda" style={{ marginTop: 16 }}>
        Perdeu o telemóvel com a app? Peça ao administrador para desactivar a verificação da sua
        conta no Supabase.
      </p>
    </div>
  );
}
