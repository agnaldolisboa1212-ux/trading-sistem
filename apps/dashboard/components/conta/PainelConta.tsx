'use client';

/**
 * Conta e segurança, nas definições.
 *
 *   nome                 aparece no cabeçalho e nos avisos
 *   palavra-passe        mudar sem sair
 *   dois passos          activar com uma app de autenticação (QR), ou desactivar
 *   sessões              sair aqui, ou em todos os dispositivos
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Factor, User } from '@supabase/supabase-js';
import {
  authCliente,
  confirmar2fa,
  definirPalavraPasse,
  desactivar2fa,
  factores2fa,
  guardarPerfil,
  iniciar2fa,
  problemaPalavraPasse,
  sair,
  utilizadorAtual,
} from '@/lib/auth';
import { CampoCodigo, CampoPalavraPasse, CampoTexto, Erro, Info, irPara } from './Conta';

export function PainelConta() {
  const [utilizador, setUtilizador] = useState<User | null>(null);
  const [factores, setFactores] = useState<Factor[]>([]);
  const [carregado, setCarregado] = useState(false);

  const recarregar = async () => {
    const [u, f] = await Promise.all([utilizadorAtual(), factores2fa()]);
    setUtilizador(u);
    setFactores(f.filter((x) => x.status === 'verified'));
    setCarregado(true);
  };

  useEffect(() => {
    void recarregar();
  }, []);

  if (!carregado) return <div className="brilho" style={{ height: 180, borderRadius: 20 }} />;
  if (!utilizador) return null;

  return (
    <section>
      <h2>Conta e segurança</h2>
      <Nome utilizador={utilizador} />
      <PalavraPasse />
      <DoisPassos factores={factores} aoMudar={() => void recarregar()} />
      <Sessoes />
    </section>
  );
}

function Nome({ utilizador }: { utilizador: User }) {
  const inicial = (utilizador.user_metadata as { nome?: string } | undefined)?.nome ?? '';
  const [nome, setNome] = useState(inicial);
  const [estado, setEstado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const guardar = async () => {
    setErro(null);
    setEstado(null);
    const limpo = nome.trim();
    const r = await guardarPerfil({ nome: limpo || null });
    if (!r.ok) return setErro(r.erro);
    await authCliente()?.auth.updateUser({ data: { nome: limpo } });
    setEstado('Guardado.');
  };

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="rows" style={{ marginBottom: 12 }}>
        <div>
          <span className="k">Email</span>
          <span className="v">{utilizador.email}</span>
        </div>
      </div>
      <CampoTexto rotulo="Nome" autoComplete="name" valor={nome} mudar={setNome} />
      <button
        type="button"
        className="btn ghost block"
        onClick={() => void guardar()}
        disabled={nome.trim() === inicial.trim() || nome.trim().length < 2}
      >
        Guardar nome
      </button>
      {estado && <p className="ob__ajuda" style={{ marginTop: 8 }}>{estado}</p>}
      <Erro texto={erro} />
      <p className="ob__ajuda" style={{ marginTop: 12, marginBottom: 0 }}>
        Mercados, estratégia e objetivos: <Link href="/onboarding">mudar preferências</Link>.
      </p>
    </div>
  );
}

function PalavraPasse() {
  const [aberto, setAberto] = useState(false);
  const [nova, setNova] = useState('');
  const [repetir, setRepetir] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const pode = !problemaPalavraPasse(nova) && nova === repetir;

  const guardar = async () => {
    setErro(null);
    setOcupado(true);
    const r = await definirPalavraPasse(nova);
    setOcupado(false);
    if (!r.ok) return setErro(r.erro);
    setFeito(true);
    setAberto(false);
    setNova('');
    setRepetir('');
  };

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="section-head" style={{ margin: 0 }}>
        <strong>Palavra-passe</strong>
        <span className="grow" />
        {!aberto && (
          <button type="button" className="btn ghost" onClick={() => setAberto(true)}>
            Mudar
          </button>
        )}
      </div>
      {feito && <Info>Palavra-passe mudada.</Info>}
      {aberto && (
        <div style={{ marginTop: 12 }}>
          <CampoPalavraPasse rotulo="Nova" valor={nova} mudar={setNova} nova />
          {nova && problemaPalavraPasse(nova) && <p className="ob__ajuda">{problemaPalavraPasse(nova)}</p>}
          <CampoPalavraPasse rotulo="Repetir" valor={repetir} mudar={setRepetir} nova />
          <div className="ob__acoes">
            <button type="button" className="btn ghost" onClick={() => setAberto(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => void guardar()}
              disabled={!pode || ocupado}
            >
              {ocupado ? 'a guardar…' : 'Guardar'}
            </button>
          </div>
          <Erro texto={erro} />
        </div>
      )}
    </div>
  );
}

function DoisPassos({ factores, aoMudar }: { factores: Factor[]; aoMudar: () => void }) {
  const [activacao, setActivacao] = useState<{ factorId: string; qr: string; segredo: string } | null>(
    null,
  );
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const activo = factores[0] ?? null;

  const comecar = async () => {
    setErro(null);
    setOcupado(true);
    const r = await iniciar2fa();
    setOcupado(false);
    if (r.ok) setActivacao(r.valor);
    else setErro(r.erro);
  };

  const confirmar = async () => {
    if (!activacao) return;
    setErro(null);
    setOcupado(true);
    const r = await confirmar2fa(activacao.factorId, codigo);
    setOcupado(false);
    if (!r.ok) return setErro(r.erro);
    setActivacao(null);
    setCodigo('');
    aoMudar();
  };

  const desligar = async () => {
    if (!activo) return;
    if (!window.confirm('Desactivar a verificação em dois passos? A conta fica protegida só pela palavra-passe.')) {
      return;
    }
    setErro(null);
    setOcupado(true);
    const r = await desactivar2fa(activo.id);
    setOcupado(false);
    if (r.ok) aoMudar();
    else setErro(r.erro);
  };

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="section-head" style={{ margin: 0 }}>
        <strong>Verificação em dois passos</strong>
        <span className="grow" />
        <span className={activo ? 'bull-t' : 'faint'}>{activo ? 'activa' : 'desligada'}</span>
      </div>

      {!activo && !activacao && (
        <>
          <p className="ob__ajuda" style={{ marginTop: 8 }}>
            Além da palavra-passe, pede o código de uma app de autenticação (Google Authenticator,
            Microsoft Authenticator, 1Password…). Recomendado antes de ligar uma conta real.
          </p>
          <button type="button" className="btn primary block" onClick={() => void comecar()} disabled={ocupado}>
            {ocupado ? 'a preparar…' : 'Activar'}
          </button>
        </>
      )}

      {activacao && (
        <div style={{ marginTop: 12 }}>
          <p className="ob__ajuda">
            1. Na app de autenticação, adicione uma conta lendo este código QR — ou escreva a chave
            por baixo.
          </p>
          <div className="conta__qr">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={activacao.qr} alt="Código QR para a app de autenticação" />
          </div>
          <code className="conta__segredo">{activacao.segredo}</code>
          <p className="ob__ajuda">2. Escreva o código de seis dígitos que a app mostra.</p>
          <CampoCodigo rotulo="Código" valor={codigo} mudar={setCodigo} aoCompletar={() => void confirmar()} />
          <div className="ob__acoes">
            <button type="button" className="btn ghost" onClick={() => setActivacao(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => void confirmar()}
              disabled={codigo.length < 6 || ocupado}
            >
              Confirmar
            </button>
          </div>
        </div>
      )}

      {activo && (
        <>
          <p className="ob__ajuda" style={{ marginTop: 8 }}>
            Cada entrada nova pede o código da app. Guarde a app num telemóvel a que só você tem
            acesso.
          </p>
          <button type="button" className="btn ghost block" onClick={() => void desligar()} disabled={ocupado}>
            Desactivar
          </button>
        </>
      )}

      <Erro texto={erro} />
    </div>
  );
}

function Sessoes() {
  const [ocupado, setOcupado] = useState(false);
  const terminar = async (todos: boolean) => {
    setOcupado(true);
    await sair(todos);
    irPara('/entrar');
  };
  return (
    <div className="card">
      <strong>Sessão</strong>
      <p className="ob__ajuda" style={{ marginTop: 8 }}>
        Sair também desliga a conta Deriv deste dispositivo.
      </p>
      <div className="ob__acoes">
        <button type="button" className="btn ghost" onClick={() => void terminar(true)} disabled={ocupado}>
          Sair em todos
        </button>
        <button type="button" className="btn primary" onClick={() => void terminar(false)} disabled={ocupado}>
          Sair
        </button>
      </div>
    </div>
  );
}
