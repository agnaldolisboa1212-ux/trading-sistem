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
 * A escolha é gravada na sessão cTrader cifrada, num cookie `httpOnly`, e não
 * no `localStorage`. Um valor que o JavaScript da página consegue reescrever não é
 * sítio para guardar qual das contas recebe as ordens.
 */

import { useEffect, useState } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { usarAvisos, usarInstalacao } from './Pwa';
import {
  desligarCtrader,
  dinheiroConta,
  escolherContaCtrader,
  ligarCtrader,
  usarCtrader,
  type ContaCtrader,
} from './usarCtrader';

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

/**
 * A conta Deriv cTrader (CFD) de QUEM está a ver.
 *
 * Liga com o cTrader ID da pessoa — nunca com a conta do dono do servidor — e
 * mostra as contas que esse login autorizou. Passar para uma conta real pede
 * confirmação; voltar para a demo não.
 */
function Corretora() {
  const c = usarCtrader();
  const [aTrocar, setATrocar] = useState<number | null>(null);
  const [confirmar, setConfirmar] = useState<ContaCtrader | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [aLigar, setALigar] = useState(false);

  useEffect(() => {
    // Regresso da autorização cTrader: `?ctrader=ligada` ou `?ctrader=erro&motivo=…`.
    const q = new URLSearchParams(window.location.search);
    const resultado = q.get('ctrader');
    if (resultado === 'ligada') {
      setAviso({ ok: true, texto: 'Conta cTrader ligada. Escolha abaixo a conta que recebe as ordens.' });
    } else if (resultado === 'erro') {
      setAviso({ ok: false, texto: `Não foi possível ligar a conta: ${q.get('motivo') ?? 'erro desconhecido'}` });
    }
    // Tira os parâmetros do endereço para um recarregar não repetir a mensagem.
    if (resultado) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const trocar = async (conta: ContaCtrader) => {
    setFalha(null);
    setATrocar(conta.id);
    const erro = await escolherContaCtrader(conta.id, conta.real);
    setATrocar(null);
    if (erro) setFalha(erro);
    else setConfirmar(null);
  };

  const ligar = async () => {
    setFalha(null);
    setALigar(true);
    const erro = await ligarCtrader();
    if (erro) {
      setFalha(erro);
      setALigar(false);
    }
  };

  if (c.aCarregar) {
    return (
      <section>
        <h2>Corretora</h2>
        <div className="brilho" style={{ height: 120, borderRadius: 16 }} />
      </section>
    );
  }

  return (
    <section>
      <h2>Corretora · Deriv cTrader</h2>

      {aviso && (
        <div className={aviso.ok ? 'notice' : 'ob__erro'} style={{ marginBottom: 10 }}>
          {aviso.texto}
        </div>
      )}

      {!c.configurado ? (
        <div className="empty" style={{ textAlign: 'left' }}>
          <strong>A negociação CFD ainda não está configurada no servidor.</strong>
          Falta registar a aplicação na cTrader Open API e definir <code>CTRADER_CLIENT_ID</code>,{' '}
          <code>CTRADER_CLIENT_SECRET</code> e <code>CTRADER_REDIRECT</code>.
        </div>
      ) : c.ligada ? (
        <>
          <div className="grupo__caixa">
            {c.contas.map((conta) => {
              const on = c.conta?.id === conta.id;
              return (
                <button
                  key={conta.id}
                  type="button"
                  className="conta-linha"
                  aria-pressed={on}
                  disabled={aTrocar !== null}
                  onClick={() => {
                    if (on) return;
                    // Só a passagem para real pára para confirmar.
                    if (conta.real) setConfirmar(conta);
                    else void trocar(conta);
                  }}
                >
                  <span className={`conta-linha__selo ${conta.real ? 'real' : 'demo'}`}>
                    {conta.real ? 'REAL' : 'DEMO'}
                  </span>
                  <span className="conta-linha__id">
                    <strong>#{conta.login ?? conta.id}</strong>
                    <em>
                      {on && c.saldo !== null ? `${dinheiroConta(c.saldo, c.moeda)} · ` : ''}
                      {conta.corretora || 'Deriv'} · CFD
                    </em>
                  </span>
                  <span className="conta-linha__marca" aria-hidden="true">
                    {aTrocar === conta.id ? '…' : on ? '✓' : ''}
                  </span>
                </button>
              );
            })}
          </div>

          {c.contas.length === 0 && (
            <div className="empty" style={{ textAlign: 'left' }}>
              <strong>Nenhuma conta cTrader neste login.</strong>
              Crie uma conta Deriv cTrader (comece pela demo) no painel da Deriv e ligue de novo.
            </div>
          )}

          <p className="section-cap">
            A conta marcada recebe as ordens que confirmar no terminal. Comece pela demo: preços e
            execução são reais, só o dinheiro é que não. Os tokens ficam cifrados no servidor e
            nunca chegam ao browser.
          </p>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn ghost" onClick={() => void ligar()} disabled={aLigar}>
              Autorizar outras contas
            </button>
            <button type="button" className="btn ghost" onClick={() => void desligarCtrader()}>
              Desligar a cTrader
            </button>
          </div>
        </>
      ) : (
        <div className="empty" style={{ textAlign: 'left' }}>
          <strong>Conta cTrader não ligada.</strong>
          {c.erro ??
            'Entre com o seu cTrader ID para ver o saldo, as posições e negociar CFD a partir daqui — abrir, modificar e fechar ordens, ou colar a ordem de um sinal.'}
          <div style={{ marginTop: 12 }}>
            <button type="button" className="btn primary" onClick={() => void ligar()} disabled={aLigar}>
              {aLigar ? 'a abrir…' : 'Ligar conta Deriv cTrader'}
            </button>
          </div>
          <p className="section-cap" style={{ marginTop: 10 }}>
            Abre a página da própria cTrader. A sua palavra-passe nunca passa por esta aplicação,
            e cada utilizador liga a sua própria conta.
          </p>
        </div>
      )}

      {confirmar && (
        <div className="notice" role="alertdialog" aria-label="Confirmar conta real" style={{ marginTop: 10 }}>
          <strong>Passar para a conta real #{confirmar.login ?? confirmar.id}?</strong>
          <div style={{ marginTop: 6, marginBottom: 10, lineHeight: 1.55 }}>
            A partir daí, cada ordem que confirmar arrisca dinheiro verdadeiro.
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
