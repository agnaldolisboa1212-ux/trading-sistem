'use client';

/**
 * Cartão de saldo — o primeiro elemento do Início quando há conta ligada.
 *
 * A conta é a Deriv cTrader (CFD) da pessoa: saldo, capital com o lucro das
 * posições abertas, e o selo demo/real.
 *
 * ── O QUE ELE MOSTRA CONFORME O ESTADO ─────────────────────────────────────
 *
 *   sem ligação   -> convite a ligar, com o caminho exato
 *   a carregar    -> esqueleto com o mesmo tamanho do cartão final, para o
 *                    conteúdo por baixo não saltar quando chegar
 *   ligado        -> saldo, tipo de conta, posições abertas e resultado
 *
 * ── O SELO DEMO / REAL ─────────────────────────────────────────────────────
 *
 * Está sempre visível e nunca é subtil. Quem olha para um saldo tem de saber,
 * sem pensar, se aquilo é dinheiro. A conta demo desta ligação tem 10 000 USD e
 * a real tem 0 — confundir as duas é exatamente o erro que arruína alguém.
 */

import Link from 'next/link';
import { dinheiroConta, usarCtrader } from './usarCtrader';
import { Ligacao } from './Preco';

export function CartaoSaldo({ nome }: { nome?: string | null }) {
  const c = usarCtrader();

  if (c.aCarregar) {
    return <div className="brilho" style={{ height: 230, borderRadius: 24 }} />;
  }

  if (!c.ligada) {
    return <ConviteLigar erro={c.erro} configurado={c.configurado} />;
  }

  const real = c.conta?.real === true;
  const abertas = c.posicoes.length;
  const emAberto = c.posicoes.reduce((a, p) => a + p.lucro, 0);

  return (
    <div className="saldo card glass-panel" style={{ flex: 1, padding: '24px' }}>
      <div className="saldo__topo">
        <span className="saldo__rotulo">
          {nome ? `Olá, ${nome}` : 'Saldo disponível'}
        </span>
        <span className="grow" />
        <span className={`saldo__selo ${real ? 'real' : 'demo'}`}>{real ? 'conta real' : 'demo'}</span>
      </div>

      <div className="saldo__valor">
        {c.saldo === null
          ? '—'
          : c.saldo.toLocaleString('pt-PT', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
        <span className="saldo__moeda">{c.moeda}</span>
      </div>

      <div className="saldo__linha">
        <Ligacao />
        <span>·</span>
        <span>
          {abertas} posiç{abertas === 1 ? 'ão' : 'ões'} aberta{abertas === 1 ? '' : 's'}
        </span>
        {abertas > 0 && (
          <>
            <span>·</span>
            <span className={emAberto >= 0 ? 'bull-t' : 'bear-t'}>
              {emAberto >= 0 ? '+' : ''}
              {emAberto.toFixed(2)} em aberto
            </span>
          </>
        )}
        {c.ordens.length > 0 && (
          <>
            <span>·</span>
            <span>
              {c.ordens.length} pendente{c.ordens.length === 1 ? '' : 's'}
            </span>
          </>
        )}
        {abertas > 0 && (
          <>
            <span>·</span>
            <span>capital {dinheiroConta(c.capital, c.moeda)}</span>
          </>
        )}
      </div>

      <div className="saldo__accoes" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <Link href="/mercados" className="saldo__accao">
          <i aria-hidden="true">◈</i>
          Negociar
        </Link>
        <Link href="/portfolio" className="saldo__accao">
          <i aria-hidden="true">◱</i>
          Portfólio
        </Link>
        <Link href="/definicoes" className="saldo__accao">
          <i aria-hidden="true">⚙</i>
          Definições
        </Link>
      </div>
    </div>
  );
}

/**
 * Estado "sem ligação".
 *
 * Diz o que fazer, e não apenas que falta alguma coisa. A mensagem de erro da
 * corretora aparece por extenso porque é a única informação que distingue "o
 * token expirou" de "a rede está em baixo" — e as duas pedem ações diferentes.
 */
function ConviteLigar({ erro, configurado }: { erro: string | null; configurado: boolean }) {
  return (
    <div className="saldo card glass-panel" style={{ flex: 1, padding: '24px' }}>
      <div className="saldo__topo">
        <span className="saldo__rotulo">Corretora</span>
      </div>
      <div className="saldo__valor" style={{ fontSize: 24 }}>
        Ligar conta
      </div>
      <div className="saldo__linha" style={{ display: 'block', lineHeight: 1.5 }}>
        {!configurado
          ? 'A negociação CFD ainda não está disponível neste servidor.'
          : erro
            ? `A cTrader respondeu: ${erro}`
            : 'Ligue a sua conta Deriv cTrader para ver o saldo, as posições e negociar a partir daqui.'}
      </div>
      <div className="saldo__accoes" style={{ gridTemplateColumns: '1fr' }}>
        <Link href="/definicoes" className="saldo__accao">
          <i aria-hidden="true">⚡</i>
          Configurar ligação
        </Link>
      </div>
    </div>
  );
}

/** Versão compacta, para o cabeçalho de outras páginas. */
export function SaldoCompacto() {
  const c = usarCtrader();
  if (!c.ligada || c.saldo === null) return null;
  const real = c.conta?.real === true;

  return (
    <Link href="/portfolio" className="saldo-mini" title="Ver conta">
      <span className={`saldo-mini__selo ${real ? 'real' : 'demo'}`}>{real ? 'REAL' : 'DEMO'}</span>
      <span className="num-vivo">{dinheiroConta(c.capital ?? c.saldo, c.moeda)}</span>
    </Link>
  );
}
