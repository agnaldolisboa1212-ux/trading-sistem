'use client';

/**
 * Recuperar a palavra-passe.
 *
 * O email traz um link e, se o modelo o incluir, um código. Os dois abrem uma
 * sessão de recuperação que só serve para definir a palavra-passe nova em
 * `/recuperar/nova`. A resposta é a mesma exista ou não a conta: dizer "não
 * existe" deixava qualquer pessoa descobrir quem está registado.
 */

import Link from 'next/link';
import { useState } from 'react';
import { authConfigurada, pedirRecuperacao, validarCodigo } from '@/lib/auth';
import { CampoCodigo, CampoTexto, Erro, Info, Marca, irPara } from '@/components/conta/Conta';
import '../onboarding.css';

export default function Page() {
  const [passo, setPasso] = useState<'email' | 'codigo'>('email');
  const [email, setEmail] = useState('');
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  if (!authConfigurada) {
    return (
      <div className="wrap ob">
        <Erro texto="A recuperação precisa do Supabase configurado." />
      </div>
    );
  }

  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const pedir = async () => {
    setErro(null);
    setOcupado(true);
    const r = await pedirRecuperacao(email);
    setOcupado(false);
    if (r.ok) setPasso('codigo');
    else setErro(r.erro);
  };

  const confirmar = async () => {
    setErro(null);
    setOcupado(true);
    const r = await validarCodigo(email, codigo, 'recovery');
    setOcupado(false);
    if (r.ok) irPara('/recuperar/nova');
    else setErro(r.erro);
  };

  return (
    <div className="wrap ob">
      <Marca titulo="Recuperar acesso" sub="Definir uma palavra-passe nova" />

      <div className="card">
        {passo === 'email' ? (
          <>
            <CampoTexto
              rotulo="Email da conta"
              tipo="email"
              autoComplete="email"
              placeholder="nome@exemplo.com"
              valor={email}
              mudar={setEmail}
              aoEnter={emailValido ? () => void pedir() : undefined}
            />
            <button
              type="button"
              className="btn primary block"
              onClick={() => void pedir()}
              disabled={ocupado || !emailValido}
            >
              {ocupado ? 'a enviar…' : 'Enviar instruções'}
            </button>
          </>
        ) : (
          <>
            <Info>
              Se existir uma conta com <strong>{email}</strong>, enviámos um link. Toque nele, ou
              escreva aqui o código de seis dígitos se o email o tiver.
            </Info>
            <CampoCodigo rotulo="Código" valor={codigo} mudar={setCodigo} aoCompletar={() => void confirmar()} />
            <button
              type="button"
              className="btn primary block"
              onClick={() => void confirmar()}
              disabled={ocupado || codigo.length < 6}
            >
              {ocupado ? 'a validar…' : 'Continuar'}
            </button>
            <button type="button" className="ob__link" onClick={() => setPasso('email')}>
              usar outro email
            </button>
          </>
        )}
      </div>

      <Erro texto={erro} />

      <p className="conta__rodape">
        Lembrou-se? <Link href="/entrar">Entrar</Link>
      </p>
    </div>
  );
}
