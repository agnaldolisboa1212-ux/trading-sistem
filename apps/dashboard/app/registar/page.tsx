'use client';

/**
 * Criar conta.
 *
 * Com a confirmação de email ligada no Supabase (o recomendado), a conta só
 * entra depois de confirmar: pelo link do email ou pelo código de seis dígitos,
 * se o modelo do email o incluir. O código é o que funciona dentro da app
 * instalada — o link abre no browser, que é outra sessão.
 *
 * Sem confirmação, o registo já devolve sessão e segue para o onboarding.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  authConfigurada,
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
            Enviámos uma mensagem para <strong>{email}</strong>. Toque no link, ou escreva aqui o
            código de seis dígitos se o email o tiver. Veja também o spam.
          </Info>
          <CampoCodigo rotulo="Código" valor={codigo} mudar={setCodigo} aoCompletar={() => void confirmar()} />
          <button
            type="button"
            className="btn primary block"
            onClick={() => void confirmar()}
            disabled={ocupado || codigo.length < 6}
          >
            {ocupado ? 'a confirmar…' : 'Confirmar'}
          </button>
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
