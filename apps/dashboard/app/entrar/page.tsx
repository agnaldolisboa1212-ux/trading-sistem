'use client';

/**
 * Entrar — email e palavra-passe, ou um código por email.
 *
 * Quem chega aqui vindo de outra página traz `?voltar=` (posto pelo
 * middleware) e volta para lá depois de entrar. O destino passa por
 * `destinoSeguro`: só caminhos desta app.
 *
 * As duas formas partilham o ecrã. O código serve a quem esqueceu a
 * palavra-passe e não a quer mudar agora, e a quem entra num dispositivo que não
 * é seu.
 */

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { authConfigurada, entrar, pedirCodigoEntrada, validarCodigo } from '@/lib/auth';
import { destinoSeguro } from '@/lib/acesso';
import {
  CampoCodigo,
  CampoPalavraPasse,
  CampoTexto,
  Erro,
  Info,
  Marca,
  irPara,
} from '@/components/conta/Conta';
import '../onboarding.css';

type Modo = 'palavra-passe' | 'pedir-codigo' | 'codigo';

export default function Page() {
  return (
    <Suspense fallback={<div className="wrap ob" />}>
      <Entrar />
    </Suspense>
  );
}

function Entrar() {
  const parametros = useSearchParams();
  const destino = destinoSeguro(parametros.get('voltar'));
  const [modo, setModo] = useState<Modo>('palavra-passe');
  const [email, setEmail] = useState('');
  const [palavraPasse, setPalavraPasse] = useState('');
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(parametros.get('erro'));
  const [ocupado, setOcupado] = useState(false);

  if (!authConfigurada) {
    return (
      <div className="wrap ob">
        <Erro texto="O login precisa do Supabase: defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY." />
      </div>
    );
  }

  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const correr = async (accao: () => Promise<{ ok: boolean; erro?: string }>, depois: () => void) => {
    setErro(null);
    setOcupado(true);
    const r = await accao();
    setOcupado(false);
    if (r.ok) depois();
    else setErro(r.erro ?? 'Ocorreu um erro.');
  };

  const comPalavraPasse = () =>
    void correr(() => entrar(email, palavraPasse), () => irPara(destino));

  const pedirCodigo = () =>
    void correr(() => pedirCodigoEntrada(email), () => setModo('codigo'));

  const comCodigo = () =>
    void correr(() => validarCodigo(email, codigo, 'email'), () => irPara(destino));

  return (
    <div className="wrap ob">
      <Marca titulo="Entrar" sub="Sistema de Trading" />

      <div className="card">
        {modo !== 'codigo' && (
          <CampoTexto
            rotulo="Email"
            tipo="email"
            autoComplete="email"
            placeholder="nome@exemplo.com"
            valor={email}
            mudar={setEmail}
            aoEnter={modo === 'pedir-codigo' && emailValido ? pedirCodigo : undefined}
          />
        )}

        {modo === 'palavra-passe' && (
          <>
            <CampoPalavraPasse
              rotulo="Palavra-passe"
              valor={palavraPasse}
              mudar={setPalavraPasse}
              aoEnter={emailValido && palavraPasse ? comPalavraPasse : undefined}
            />
            <div className="conta__linha">
              <span />
              <Link href="/recuperar">Esqueci-me da palavra-passe</Link>
            </div>
            <button
              type="button"
              className="btn primary block"
              onClick={comPalavraPasse}
              disabled={ocupado || !emailValido || !palavraPasse}
            >
              {ocupado ? 'a entrar…' : 'Entrar'}
            </button>

            <div className="conta__separador">ou</div>
            <button
              type="button"
              className="btn ghost block"
              onClick={() => {
                setErro(null);
                setModo('pedir-codigo');
              }}
            >
              Entrar com código por email
            </button>
          </>
        )}

        {modo === 'pedir-codigo' && (
          <>
            <p className="ob__ajuda">
              Enviamos um código de seis dígitos para o email da sua conta.
            </p>
            <button
              type="button"
              className="btn primary block"
              onClick={pedirCodigo}
              disabled={ocupado || !emailValido}
            >
              {ocupado ? 'a enviar…' : 'Receber código'}
            </button>
            <button type="button" className="ob__link" onClick={() => setModo('palavra-passe')}>
              usar a palavra-passe
            </button>
          </>
        )}

        {modo === 'codigo' && (
          <>
            <Info>
              Se existir uma conta com <strong>{email}</strong>, o código chegou agora. Veja também o
              spam.
            </Info>
            <CampoCodigo
              rotulo="Código"
              valor={codigo}
              mudar={setCodigo}
              aoCompletar={comCodigo}
            />
            <button
              type="button"
              className="btn primary block"
              onClick={comCodigo}
              disabled={ocupado || codigo.length < 6}
            >
              {ocupado ? 'a validar…' : 'Entrar'}
            </button>
            <button
              type="button"
              className="ob__link"
              onClick={() => {
                setCodigo('');
                setModo('pedir-codigo');
              }}
            >
              pedir outro código
            </button>
          </>
        )}
      </div>

      <Erro texto={erro} />

      <p className="conta__rodape">
        Ainda não tem conta? <Link href="/registar">Criar conta</Link>
      </p>
    </div>
  );
}
