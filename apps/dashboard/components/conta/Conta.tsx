'use client';

/**
 * Peças comuns aos ecrãs de conta: entrar, criar conta, recuperar, código de
 * dois passos. Todas usam os mesmos campos, o mesmo cabeçalho e os mesmos avisos
 * — uma app que muda de aspecto entre o login e o registo parece duas apps.
 */

import { useId, useState } from 'react';
import { forcaPalavraPasse } from '@/lib/auth';

export function Marca({ titulo, sub }: { titulo: string; sub: string }) {
  return (
    <div className="ob__marca">
      <span className="ob__logo" aria-hidden="true">
        ◎
      </span>
      <div>
        <h1>{titulo}</h1>
        <p className="dim">{sub}</p>
      </div>
    </div>
  );
}

export function CampoTexto(p: {
  rotulo: string;
  valor: string;
  mudar: (v: string) => void;
  tipo?: 'text' | 'email';
  autoComplete?: string;
  placeholder?: string;
  aoEnter?: () => void;
}) {
  const id = useId();
  return (
    <>
      <label className="ob__label" htmlFor={id}>
        {p.rotulo}
      </label>
      <input
        id={id}
        className="ob__input"
        type={p.tipo ?? 'text'}
        inputMode={p.tipo === 'email' ? 'email' : undefined}
        autoComplete={p.autoComplete}
        autoCapitalize={p.tipo === 'email' ? 'none' : undefined}
        spellCheck={false}
        placeholder={p.placeholder}
        value={p.valor}
        onChange={(e) => p.mudar(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') p.aoEnter?.();
        }}
      />
    </>
  );
}

/**
 * Palavra-passe com botão de mostrar. `nova` liga o `autoComplete` certo para o
 * gestor de palavras-passe do telemóvel propor uma forte, e mostra a barra.
 */
export function CampoPalavraPasse(p: {
  rotulo: string;
  valor: string;
  mudar: (v: string) => void;
  nova?: boolean;
  aoEnter?: () => void;
}) {
  const id = useId();
  const [ver, setVer] = useState(false);
  return (
    <>
      <label className="ob__label" htmlFor={id}>
        {p.rotulo}
      </label>
      <div className="conta__senha">
        <input
          id={id}
          className="ob__input"
          type={ver ? 'text' : 'password'}
          autoComplete={p.nova ? 'new-password' : 'current-password'}
          value={p.valor}
          onChange={(e) => p.mudar(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') p.aoEnter?.();
          }}
        />
        <button
          type="button"
          className="conta__ver"
          onClick={() => setVer((v) => !v)}
          aria-label={ver ? 'Esconder palavra-passe' : 'Mostrar palavra-passe'}
          aria-pressed={ver}
        >
          {ver ? 'esconder' : 'mostrar'}
        </button>
      </div>
      {p.nova && p.valor.length > 0 && <BarraForca valor={p.valor} />}
    </>
  );
}

const ROTULOS_FORCA = ['muito fraca', 'fraca', 'razoável', 'boa', 'forte'];

function BarraForca({ valor }: { valor: string }) {
  const f = forcaPalavraPasse(valor);
  return (
    <div className="conta__forca" data-forca={f} aria-live="polite">
      <span className="conta__forca-barra" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <i key={i} className={i < f ? 'cheio' : ''} />
        ))}
      </span>
      <span className="conta__forca-rotulo">{ROTULOS_FORCA[f]}</span>
    </div>
  );
}

/** Seis dígitos — do email ou da app de autenticação. */
export function CampoCodigo(p: {
  rotulo: string;
  valor: string;
  mudar: (v: string) => void;
  aoCompletar?: () => void;
}) {
  const id = useId();
  return (
    <>
      <label className="ob__label" htmlFor={id}>
        {p.rotulo}
      </label>
      <input
        id={id}
        className="ob__input ob__input--codigo"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="000000"
        maxLength={6}
        value={p.valor}
        onChange={(e) => p.mudar(e.target.value.replace(/\D/g, '').slice(0, 6))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && p.valor.length === 6) p.aoCompletar?.();
        }}
      />
    </>
  );
}

export function Erro({ texto }: { texto: string | null }) {
  if (!texto) return null;
  return (
    <div className="ob__erro" role="alert">
      {texto}
    </div>
  );
}

export function Info({ children }: { children: React.ReactNode }) {
  return (
    <div className="conta__info" role="status">
      {children}
    </div>
  );
}

/** Navegação completa, e não do router: a sessão mudou e o middleware tem de a ver. */
export function irPara(caminho: string): void {
  window.location.assign(caminho);
}
