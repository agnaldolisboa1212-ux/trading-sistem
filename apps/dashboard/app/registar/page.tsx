'use client';

/**
 * Criar conta.
 *
 * Com a confirmação de email ligada no Supabase (o recomendado), a conta só
 * entra depois de confirmar: pelo link do email ou pelo código de seis dígitos,
 * se o modelo do email o incluir (o modelo por omissão só traz o link).
 *
 * O link pode ser aberto noutro dispositivo — no Gmail do telemóvel, por
 * exemplo — e aí a sessão abre-se lá, não aqui. Por isso este ecrã tenta entrar
 * com o email e a palavra-passe que acabaram de ser escritos, de poucos em
 * poucos segundos e sempre que a pessoa volta à app: assim que o email estiver
 * confirmado, entra sozinho.
 *
 * Sem confirmação, o registo já devolve sessão e segue para o onboarding.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  authConfigurada,
  entrar,
  problemaPalavraPasse,
  reenviarConfirmacao,
  registar,
  validarCodigo,
} from '@/lib/auth';
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

export default function Page() {
  const [passo, setPasso] = useState<'dados' | 'confirmar'>('dados');
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [palavraPasse, setPalavraPasse] = useState('');
  const [repetir, setRepetir] = useState('');
  const [aceita, setAceita] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [espera, setEspera] = useState(0);

  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  const [verCodigo, setVerCodigo] = useState(false);

  /*
   * Espera pela confirmação: tenta entrar de 8 em 8 segundos, e logo que a app
   * volta a ficar visível (a pessoa foi ao email e voltou). Pára ao fim de 20
   * minutos — o link do email também expira.
   */
  useEffect(() => {
    if (passo !== 'confirmar' || !palavraPasse) return;
    let parado = false;
    let aTentar = false;
    const inicio = Date.now();
    const tentar = async () => {
      if (parado || aTentar || document.hidden) return;
      if (Date.now() - inicio > 20 * 60_000) return;
      aTentar = true;
      const r = await entrar(email, palavraPasse);
      aTentar = false;
      if (r.ok && !parado) irPara('/onboarding');
    };
    const intervalo = setInterval(() => void tentar(), 8_000);
    const aoVoltar = () => void tentar();
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('focus', aoVoltar);
    return () => {
      parado = true;
      clearInterval(intervalo);
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('focus', aoVoltar);
    };
  }, [passo, email, palavraPasse]);

  if (!authConfigurada) {
    return (
      <div className="wrap ob">
        <Erro texto="O registo precisa do Supabase configurado." />
      </div>
    );
  }

  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const problema = palavraPasse ? problemaPalavraPasse(palavraPasse) : null;
  const diferentes = repetir.length > 0 && repetir !== palavraPasse;
  const pode =
    nome.trim().length >= 2 && emailValido && !problemaPalavraPasse(palavraPasse) && repetir === palavraPasse && aceita;

  const criar = async () => {
    setErro(null);
    setOcupado(true);
    const r = await registar({ nome, email, palavraPasse });
    setOcupado(false);
    if (!r.ok) {
      setErro(r.erro);
      return;
    }
    if (!r.valor.precisaConfirmar) {
      irPara('/onboarding');
      return;
    }
    setPasso('confirmar');
    setEspera(60);
  };

  const confirmar = async () => {
    setErro(null);
    setOcupado(true);
    const r = await validarCodigo(email, codigo, 'signup');
    setOcupado(false);
    if (r.ok) irPara('/onboarding');
    else setErro(r.erro);
  };

  const reenviar = async () => {
    setErro(null);
    setInfo(null);
    const r = await reenviarConfirmacao(email);
    if (r.ok) {
      setInfo('Enviámos outro email.');
      setEspera(60);
    } else {
      setErro(r.erro);
    }
  };

  if (passo === 'confirmar') {
    return (
      <div className="wrap ob">
        <Marca titulo="Confirme o email" sub={email} />
        <div className="card">
          <Info>
            Enviámos uma mensagem para <strong>{email}</strong>. Abra-a e toque no botão de
            confirmar — pode ser noutro telemóvel ou computador. <strong>Esta página entra
            sozinha</strong> assim que o email estiver confirmado. Veja também o spam.
          </Info>
          <div className="conta__espera" aria-live="polite">
            <span className="analise-viva__pulso" aria-hidden="true" />à espera da confirmação…
          </div>
          {verCodigo ? (
            <>
              <CampoCodigo rotulo="Código do email" valor={codigo} mudar={setCodigo} aoCompletar={() => void confirmar()} />
              <button
                type="button"
                className="btn primary block"
                onClick={() => void confirmar()}
                disabled={ocupado || codigo.length < 6}
              >
                {ocupado ? 'a confirmar…' : 'Confirmar'}
              </button>
            </>
          ) : (
            <button type="button" className="ob__link" onClick={() => setVerCodigo(true)}>
              o email trouxe um código de 6 dígitos?
            </button>
          )}
          <button
            type="button"
            className="ob__link"
            onClick={() => void reenviar()}
            disabled={espera > 0}
          >
            {espera > 0 ? `reenviar dentro de ${espera}s` : 'reenviar o email'}
          </button>
        </div>
        {info && <Info>{info}</Info>}
        <Erro texto={erro} />
        <p className="conta__rodape">
          Já confirmou? <Link href="/entrar">Entrar</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="wrap ob">
      <Marca titulo="Criar conta" sub="Leva um minuto" />

      <div className="card">
        <CampoTexto rotulo="Nome" autoComplete="name" valor={nome} mudar={setNome} placeholder="O seu nome" />
        <CampoTexto
          rotulo="Email"
          tipo="email"
          autoComplete="email"
          placeholder="nome@exemplo.com"
          valor={email}
          mudar={setEmail}
        />
        <CampoPalavraPasse rotulo="Palavra-passe" valor={palavraPasse} mudar={setPalavraPasse} nova />
        {problema && <p className="ob__ajuda">{problema}</p>}
        <CampoPalavraPasse
          rotulo="Repetir palavra-passe"
          valor={repetir}
          mudar={setRepetir}
          nova
          aoEnter={pode ? () => void criar() : undefined}
        />
        {diferentes && <p className="ob__ajuda">As duas não são iguais.</p>}

        <label className="conta__aceitar">
          <input type="checkbox" checked={aceita} onChange={(e) => setAceita(e.target.checked)} />
          <span>
            Percebo que os sinais são análise automática, sem garantia de resultado, e que operar
            com dinheiro real pode causar perdas.
          </span>
        </label>

        <button
          type="button"
          className="btn primary block"
          onClick={() => void criar()}
          disabled={ocupado || !pode}
        >
          {ocupado ? 'a criar…' : 'Criar conta'}
        </button>
      </div>

      <Erro texto={erro} />

      <p className="conta__rodape">
        Já tem conta? <Link href="/entrar">Entrar</Link>
      </p>
    </div>
  );
}
