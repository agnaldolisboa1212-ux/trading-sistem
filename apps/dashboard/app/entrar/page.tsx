'use client';

/**
 * Entrada na plataforma — email e código de verificação.
 *
 * Dois passos no mesmo ecrã, sem navegação entre eles: pedir o código e
 * validá-lo. Separá-los em duas rotas obrigaria a carregar o email de uma para
 * a outra e perdê-lo-ia num refresh.
 *
 * Sem palavra-passe de propósito. Um código por email evita gerir recuperação,
 * força mínima e fugas — e quem entra já tem de ter acesso ao email de qualquer
 * maneira, por isso não acrescenta atrito real.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authConfigurada, pedirCodigo, sessaoAtual, validarCodigo, lerPerfil } from '@/lib/auth';
import '../onboarding.css';

type Passo = 'email' | 'codigo';

export default function Page() {
  const router = useRouter();
  const [passo, setPasso] = useState<Passo>('email');
  const [email, setEmail] = useState('');
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aVerificar, setAVerificar] = useState(true);

  // Já autenticado? Não faz sentido pedir de novo.
  useEffect(() => {
    void (async () => {
      const s = await sessaoAtual();
      if (s) {
        const p = await lerPerfil();
        router.replace(p?.onboarding_em ? '/' : '/onboarding');
        return;
      }
      setAVerificar(false);
    })();
  }, [router]);

  if (!authConfigurada) {
    return (
      <div className="wrap ob">
        <div className="setup">
          <p>
            O login precisa do Supabase. Defina <code>NEXT_PUBLIC_SUPABASE_URL</code> e{' '}
            <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> em{' '}
            <code>apps/dashboard/.env.local</code>.
          </p>
        </div>
      </div>
    );
  }

  if (aVerificar) {
    return (
      <div className="wrap ob">
        <div className="skeleton" style={{ height: 200 }} />
      </div>
    );
  }

  const enviar = async () => {
    setErro(null);
    setOcupado(true);
    const r = await pedirCodigo(email.trim());
    setOcupado(false);
    if (r.ok) setPasso('codigo');
    else setErro(r.erro ?? 'Não foi possível enviar o código.');
  };

  const confirmar = async () => {
    setErro(null);
    setOcupado(true);
    const r = await validarCodigo(email.trim(), codigo);
    if (!r.ok) {
      setOcupado(false);
      setErro(r.erro ?? 'Código inválido.');
      return;
    }
    // Perfil novo vai para o onboarding; quem já o fez vai direto ao painel.
    const p = await lerPerfil();
    setOcupado(false);
    router.replace(p?.onboarding_em ? '/' : '/onboarding');
  };

  return (
    <div className="wrap ob">
      <div className="ob__marca">
        <span className="ob__logo" aria-hidden="true">
          ◎
        </span>
        <div>
          <h1>Bem-vindo</h1>
          <p className="dim">Sinais MMXM &amp; SMT</p>
        </div>
      </div>

      {passo === 'email' ? (
        <div className="card">
          <label className="ob__label" htmlFor="email">
            O seu email
          </label>
          <input
            id="email"
            className="ob__input"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="nome@exemplo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && email.includes('@')) void enviar();
            }}
          />
          <p className="ob__ajuda">
            Enviamos um código de seis dígitos. Não é preciso palavra-passe.
          </p>

          <button
            type="button"
            className="btn primary block"
            onClick={() => void enviar()}
            disabled={ocupado || !email.includes('@')}
          >
            {ocupado ? 'a enviar…' : 'Receber código'}
          </button>
        </div>
      ) : (
        <div className="card">
          <label className="ob__label" htmlFor="codigo">
            Código enviado para {email}
          </label>
          <input
            id="codigo"
            className="ob__input ob__input--codigo"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            maxLength={6}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && codigo.length === 6) void confirmar();
            }}
          />

          <button
            type="button"
            className="btn primary block"
            onClick={() => void confirmar()}
            disabled={ocupado || codigo.length < 6}
          >
            {ocupado ? 'a validar…' : 'Entrar'}
          </button>

          <button
            type="button"
            className="ob__link"
            onClick={() => {
              setPasso('email');
              setCodigo('');
              setErro(null);
            }}
          >
            usar outro email
          </button>
        </div>
      )}

      {erro && <div className="ob__erro">{erro}</div>}

      <footer className="note">
        Modo paper. O sistema analisa e avisa; nenhuma ordem é enviada a nenhuma corretora.
      </footer>
    </div>
  );
}
