'use client';

/**
 * A parte das definições que MUDA coisas.
 *
 * Três controlos, por ordem de consequência:
 *
 *   1. conta da corretora — decide para onde vai dinheiro real
 *   2. notificações       — pede permissão ao browser
 *   3. instalar / tema    — cosmético
 *
 * ── A TROCA DEMO / REAL ────────────────────────────────────────────────────
 *
 * Passar para a conta real pede confirmação escrita; voltar para a demo não.
 * A assimetria é deliberada: o erro caro só acontece numa direção. Ninguém se
 * arruinou por carregar sem querer em "demo".
 *
 * A escolha é gravada num cookie `httpOnly` pelo servidor, não no
 * `localStorage`. Um valor que o JavaScript da página consegue reescrever não é
 * sítio para guardar qual das contas recebe as ordens.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch, desligarContaDeriv } from '@/lib/api';
import { BotaoLigarDeriv } from './BotaoLigarDeriv';
import { ThemeToggle } from '@/components/ThemeToggle';
import { usarAvisos, usarInstalacao } from './Pwa';
import { actualizarConta } from './usarConta';

export interface ContaResumo {
  id: string;
  tipo: 'demo' | 'real';
  saldo: string;
  moeda: string;
}

export function PainelDefinicoes({ pushDisponivel }: { pushDisponivel: boolean }) {
  return (
    <>
      <Corretora />
      <Avisos disponivel={pushDisponivel} />
      <Aparencia />
    </>
  );
}

// ---------------------------------------------------------------------------

interface EstadoDerivApi {
  configurada: boolean;
  ligada: boolean;
  contas: Array<{ account_id: string; account_type: string; balance: string; currency: string }>;
  erro: string | null;
  codigo: string;
  origem: 'oauth' | 'dono' | null;
  expiraEm: number | null;
  contaActiva: string | null;
  podeLigar: boolean;
}

/**
 * A corretora de QUEM está a ver.
 *
 * Pede o estado ao servidor com a sessão da plataforma e mostra um de cinco
 * ecrãs: ligada (com a origem e as contas), sem sessão, sem login Deriv,
 * sessão Deriv expirada, ou servidor por configurar. Cada um tem uma ação
 * diferente, e "não está a funcionar" não serve a nenhum.
 */
function Corretora() {
  const [estado, setEstado] = useState<EstadoDerivApi | null>(null);
  const [aTrocar, setATrocar] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<ContaResumo | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await apiFetch('/api/deriv/estado');
      setEstado((await r.json()) as EstadoDerivApi);
    } catch (e) {
      setFalha(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void carregar();
    // Regresso do login da Deriv: `?deriv=ligada` ou `?deriv=erro&motivo=…`.
    const q = new URLSearchParams(window.location.search);
    const resultado = q.get('deriv');
    if (resultado === 'ligada') {
      setAviso({ ok: true, texto: 'Conta Deriv ligada. Já pode ver o saldo e negociar.' });
    } else if (resultado === 'erro') {
      setAviso({ ok: false, texto: `Não foi possível ligar a conta: ${q.get('motivo') ?? 'erro desconhecido'}` });
    }
    // Tira os parâmetros do endereço para um recarregar não repetir a mensagem.
    if (resultado) window.history.replaceState(null, '', window.location.pathname);
  }, [carregar]);

  const contas: ContaResumo[] = (estado?.contas ?? []).map((c) => ({
    id: c.account_id,
    tipo: c.account_type === 'real' ? 'real' : 'demo',
    saldo: c.balance,
    moeda: c.currency,
  }));

  const trocar = async (c: ContaResumo) => {
    setFalha(null);
    setATrocar(c.id);
    try {
      const r = await apiFetch('/api/deriv/conta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // `confirmar` só é enviado depois do diálogo de confirmação da conta real.
        body: JSON.stringify({ accountId: c.id, confirmar: c.tipo === 'real' }),
      });
      const j = (await r.json()) as { erro?: string };
      if (!r.ok) throw new Error(j.erro ?? `HTTP ${r.status}`);
      setConfirmar(null);
      await Promise.all([carregar(), actualizarConta()]);
    } catch (e) {
      setFalha(e instanceof Error ? e.message : String(e));
    } finally {
      setATrocar(null);
    }
  };

  const desligar = async () => {
    await desligarContaDeriv();
    await Promise.all([carregar(), actualizarConta()]);
  };

  if (!estado) {
    return (
      <section>
        <h2>Corretora</h2>
        <div className="brilho" style={{ height: 120, borderRadius: 16 }} />
      </section>
    );
  }

  const expira = estado.expiraEm
    ? new Date(estado.expiraEm).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <section>
      <h2>Corretora</h2>

      {aviso && (
        <div className={aviso.ok ? 'notice' : 'ob__erro'} style={{ marginBottom: 10 }}>
          {aviso.texto}
        </div>
      )}

      {estado.ligada ? (
        <>
          <div className="rows" style={{ marginBottom: 10 }}>
            <div>
              <span className="k">Ligação</span>
              <span className="v">
                {estado.origem === 'oauth'
                  ? `a sua conta Deriv${expira ? ` · até às ${expira}` : ''}`
                  : 'token do servidor (dono)'}
              </span>
            </div>
          </div>

          <div className="grupo__caixa">
            {contas.map((c) => {
              const on = estado.contaActiva === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  className="conta-linha"
                  aria-pressed={on}
                  disabled={aTrocar !== null}
                  onClick={() => {
                    if (on) return;
                    // Só a passagem para real pára para confirmar.
                    if (c.tipo === 'real') setConfirmar(c);
                    else void trocar(c);
                  }}
                >
                  <span className={`conta-linha__selo ${c.tipo}`}>
                    {c.tipo === 'real' ? 'REAL' : 'DEMO'}
                  </span>
                  <span className="conta-linha__id">
                    <strong>{c.id}</strong>
                    <em>
                      {c.saldo} {c.moeda}
                    </em>
                  </span>
                  <span className="conta-linha__marca" aria-hidden="true">
                    {on ? '✓' : ''}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="section-cap">
            A conta escolhida recebe as ordens que confirmar no gráfico. Comece pela demo: os
            preços, o preenchimento e o resultado são reais, só o dinheiro é que não.
          </p>

          {estado.origem === 'oauth' && (
            <button type="button" className="btn ghost" onClick={() => void desligar()}>
              Desligar a conta Deriv
            </button>
          )}
          {estado.origem === 'dono' && estado.podeLigar && (
            <>
              <p className="section-cap">
                Está a usar o token do servidor. Para usar a sua própria conta, entre com a Deriv.
              </p>
              <BotaoLigarDeriv texto="Entrar com a minha conta Deriv" />
            </>
          )}
        </>
      ) : estado.codigo === 'SemSessao' ? (
        <div className="empty" style={{ textAlign: 'left' }}>
          <strong>Entre na plataforma primeiro.</strong>
          A conta de trading fica associada ao seu utilizador, por isso é preciso ter sessão
          iniciada antes de a ligar.
          <div>
            <Link href="/entrar" className="btn primary">
              Entrar
            </Link>
          </div>
        </div>
      ) : estado.codigo === 'DerivNaoConfigurada' || !estado.podeLigar ? (
        <div className="empty" style={{ textAlign: 'left' }}>
          <strong>O login com a Deriv não está configurado no servidor.</strong>
          Faltam <code>DERIV_APP_ID</code> e <code>COFRE_CHAVE</code> em{' '}
          <code>apps/dashboard/.env.local</code>.
        </div>
      ) : (
        <div className="empty" style={{ textAlign: 'left' }}>
          <strong>
            {estado.codigo === 'DerivExpirou' ? 'A sessão Deriv expirou.' : 'Conta Deriv não ligada.'}
          </strong>
          {estado.codigo === 'DerivExpirou'
            ? 'A Deriv dá sessões de uma hora. Ligar de novo é um toque — com a sessão da Deriv ainda aberta, nem volta a pedir a senha.'
            : (estado.erro ??
              'Entre com a sua conta Deriv para ver o saldo, as posições e negociar a partir daqui.')}
          <div style={{ marginTop: 12 }}>
            <BotaoLigarDeriv
              texto={estado.codigo === 'DerivExpirou' ? 'Ligar de novo' : 'Entrar com a Deriv'}
            />
          </div>
          <p className="section-cap" style={{ marginTop: 10 }}>
            Abre a página de login da própria Deriv. A sua senha nunca passa por esta aplicação.
          </p>
        </div>
      )}

      {confirmar && (
        <div className="notice" role="alertdialog" aria-label="Confirmar conta real">
          <strong>Passar para a conta real {confirmar.id}?</strong>
          <div style={{ marginTop: 6, marginBottom: 10, lineHeight: 1.55 }}>
            A partir daí, cada ordem que confirmar gasta dinheiro verdadeiro. Saldo atual:{' '}
            <strong>
              {confirmar.saldo} {confirmar.moeda}
            </strong>
            .
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn ghost" onClick={() => setConfirmar(null)}>
              Ficar na demo
            </button>
            <button
              type="button"
              className="btn perigo-btn"
              onClick={() => void trocar(confirmar)}
              disabled={aTrocar !== null}
            >
              {aTrocar ? 'a mudar…' : 'Sim, usar a conta real'}
            </button>
          </div>
        </div>
      )}

      {falha && <div className="ob__erro">{falha}</div>}
    </section>
  );
}

// ---------------------------------------------------------------------------

function Avisos({ disponivel }: { disponivel: boolean }) {
  const { estado, ligar, desligar, testar } = usarAvisos();
  const [msg, setMsg] = useState<string | null>(null);

  const rotulo: Record<typeof estado, string> = {
    'sem-suporte': 'este browser não suporta',
    desligado: 'desligadas',
    ligado: 'ligadas',
    bloqueado: 'bloqueadas no browser',
    'a-tratar': 'a tratar…',
  };

  return (
    <section>
      <h2>Notificações</h2>
      <div className="rows">
        <div>
          <span className="k">Avisos neste dispositivo</span>
          <span className={`v ${estado === 'ligado' ? 'bull-t' : 'faint'}`}>{rotulo[estado]}</span>
        </div>
      </div>

      {!disponivel ? (
        <p className="section-cap">
          Faltam as chaves VAPID no servidor. Corra <code>npm run push:chaves</code> na raiz e cole
          o resultado no <code>.env</code> — sem elas o browser não aceita a subscrição.
        </p>
      ) : estado === 'bloqueado' ? (
        <p className="section-cap">
          O browser recusou. Tem de reabrir a permissão no cadeado ao lado do endereço — nenhuma
          página pode voltar a perguntar depois de um &quot;bloquear&quot;.
        </p>
      ) : estado === 'sem-suporte' ? (
        <p className="section-cap">
          Este browser não tem <code>PushManager</code>. No iPhone, os avisos só funcionam depois
          de adicionar a app ao ecrã principal.
        </p>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {estado === 'ligado' ? (
            <>
              <button
                type="button"
                className="btn ghost"
                onClick={() => void desligar().then(() => setMsg(null))}
              >
                Desligar
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => void testar().then((e) => setMsg(e ?? 'Enviado — veja o aviso.'))}
              >
                Enviar um de teste
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn primary"
              disabled={estado === 'a-tratar'}
              onClick={() => void ligar().then((e) => setMsg(e))}
            >
              {estado === 'a-tratar' ? 'a pedir permissão…' : 'Ligar avisos'}
            </button>
          )}
        </div>
      )}

      {msg && <p className="section-cap">{msg}</p>}

      <p className="section-cap">
        Recebe um aviso quando um sinal completa os 9 passos do checklist, e outro quando uma
        posição fecha. Nunca são avisos de propaganda.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------

function Aparencia() {
  const { estado, instalar } = usarInstalacao();

  return (
    <section>
      <h2>Aplicação</h2>
      <div className="rows">
        <div>
          <span className="k">Tema</span>
          <span className="v">
            <ThemeToggle />
          </span>
        </div>
        <div>
          <span className="k">Instalar no dispositivo</span>
          <span className="v">
            {estado === 'instalada' ? (
              <span className="bull-t">já instalada</span>
            ) : estado === 'pronta' ? (
              <button type="button" className="mini-btn" onClick={() => void instalar()}>
                instalar
              </button>
            ) : estado === 'ios' ? (
              <span className="faint">Partilhar → Adicionar ao ecrã principal</span>
            ) : (
              <span className="faint">use o menu do browser</span>
            )}
          </span>
        </div>
      </div>
      <p className="section-cap">
        Instalada, a app abre em ecrã inteiro, sem barra de endereço, e os avisos chegam com a
        aplicação fechada.
      </p>
    </section>
  );
}
