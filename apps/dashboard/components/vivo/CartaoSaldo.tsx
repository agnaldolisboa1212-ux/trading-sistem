'use client';

/**
 * Cartão de saldo — o primeiro elemento do Início quando há conta ligada.
 *
 * O pedido era claro: depois de ligar a Deriv, o saldo deve estar à vista sem
 * ter de entrar no separador financeiro. É o que este componente faz.
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
import { dinheiro, usarConta } from './usarConta';
import { Ligacao } from './Preco';

export function CartaoSaldo({ nome }: { nome?: string | null }) {
  const c = usarConta();

  if (c.aCarregar) {
    return <div className="brilho" style={{ height: 230, borderRadius: 24 }} />;
  }

  if (!c.ligada) {
    return <ConviteLigar erro={c.erro} />;
  }

  const abertas = c.posicoes.length;
  const emAberto = c.posicoes.reduce((a, p) => a + p.lucro, 0);
  const taxa = c.operacoesFechadas > 0 ? (c.vitorias / c.operacoesFechadas) * 100 : null;

  return (
    <div className="saldo">
      <div className="saldo__topo">
        <span className="saldo__rotulo">
          {nome ? `Olá, ${nome}` : 'Saldo disponível'}
        </span>
        <span className="grow" />
        <span className={`saldo__selo ${c.tipo === 'real' ? 'real' : 'demo'}`}>
          {c.tipo === 'real' ? 'conta real' : 'demo'}
        </span>
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
        {taxa !== null && (
          <>
            <span>·</span>
            <span>
              {taxa.toFixed(0)}% de acerto em {c.operacoesFechadas}
            </span>
          </>
        )}
      </div>

      <div className="saldo__accoes">
        <Link href="/mercados" className="saldo__accao">
          <i aria-hidden="true">◈</i>
          Negociar
        </Link>
        <Link href="/portfolio" className="saldo__accao">
          <i aria-hidden="true">◱</i>
          Portfólio
        </Link>
        <Link href="/conta" className="saldo__accao">
          <i aria-hidden="true">≡</i>
          Movimentos
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
function ConviteLigar({ erro }: { erro: string | null }) {
  return (
    <div className="saldo">
      <div className="saldo__topo">
        <span className="saldo__rotulo">Corretora</span>
      </div>
      <div className="saldo__valor" style={{ fontSize: 24 }}>
        Ligar conta
      </div>
      <div className="saldo__linha" style={{ display: 'block', lineHeight: 1.5 }}>
        {erro
          ? `A Deriv respondeu: ${erro}`
          : 'Ligue a sua conta Deriv para ver o saldo, as posições e negociar a partir daqui.'}
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
  const c = usarConta();
  if (!c.ligada || c.saldo === null) return null;

  return (
    <Link href="/portfolio" className="saldo-mini" title="Ver conta">
      <span className={`saldo-mini__selo ${c.tipo === 'real' ? 'real' : 'demo'}`}>
        {c.tipo === 'real' ? 'REAL' : 'DEMO'}
      </span>
      <span className="num-vivo">{dinheiro(c.saldo, c.moeda)}</span>
    </Link>
  );
}
