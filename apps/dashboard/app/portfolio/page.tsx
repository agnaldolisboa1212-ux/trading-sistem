'use client';

/**
 * Portfólio — a conta, o que está aberto, e os índices mundiais.
 *
 * ── PORQUÊ ESTA PÁGINA EXISTE SEPARADA DO FINANCEIRO ───────────────────────
 *
 * O Financeiro mede a ESTRATÉGIA: R realizado, expectativa, distribuição.
 * Unidades de risco, histórico, nada de dinheiro. Esta mede a CONTA: quanto lá
 * está, o que está aberto agora, quanto vale neste segundo.
 *
 * São perguntas diferentes feitas em momentos diferentes. Juntá-las numa página
 * obrigaria a rolar por uma curva de capital em múltiplos de R para descobrir
 * se uma posição está a ganhar.
 *
 * ── OS ÍNDICES ─────────────────────────────────────────────────────────────
 *
 * S&P 500, Nasdaq 100, Dow 30 e DAX estão primeiro porque foram os pedidos.
 * Os outros oito vieram no mesmo `active_symbols` da Deriv e não custam nada.
 *
 * Ao fim de semana as bolsas estão fechadas e estas linhas ficam paradas — por
 * isso os sintéticos, que negoceiam 24/7, aparecem logo a seguir em vez de
 * ficarem escondidos num submenu. Um painel que não se mexe ao sábado parece
 * avariado mesmo quando está correto.
 */

import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useState } from 'react';
import { CartaoSaldo } from '@/components/vivo/CartaoSaldo';
import { SelectorMercado } from '@/components/vivo/SelectorMercado';
import { usarPortfolio } from '@/components/vivo/usarPortfolio';
import { ListaIndices } from '@/components/vivo/ListaIndices';
import { Ligacao } from '@/components/vivo/Preco';
import { dinheiro, usarConta } from '@/components/vivo/usarConta';
import { INDICES, SINTETICOS, CRIPTO, METAIS } from '@/lib/deriv/simbolos';

type Aba = 'indices' | 'sinteticos' | 'materias';

const ABAS: Array<{ id: Aba; rotulo: string }> = [
  { id: 'indices', rotulo: 'Índices' },
  { id: 'sinteticos', rotulo: '24/7' },
  { id: 'materias', rotulo: 'Ouro e cripto' },
];

export default function Page() {
  const [aba, setAba] = useState<Aba>('indices');

  return (
    <div className="wrap">
      <div className="cabeca">
        <div className="cabeca__id">
          <p className="cabeca__saudacao">A sua conta</p>
          <h1>Portfólio</h1>
        </div>
        <Ligacao rotulo={false} />
      </div>

      <CartaoSaldo />

      <MeusInstrumentos />

      <Posicoes />

      <section>
        <div className="section-head">
          <h2>Mercados</h2>
          <span className="grow" />
          <Link href="/mercados">ver todos</Link>
        </div>

        <div className="abas" role="tablist" aria-label="Grupos de mercado">
          {ABAS.map((a) => (
            <button
              key={a.id}
              type="button"
              role="tab"
              aria-selected={aba === a.id}
              className={aba === a.id ? 'active' : ''}
              onClick={() => setAba(a.id)}
            >
              {a.rotulo}
            </button>
          ))}
        </div>

        {aba === 'indices' && (
          <>
            <p className="section-cap">
              Índices mundiais a vista. Fecham ao fim de semana e fora do horário da bolsa
              respetiva — quando isso acontece a linha diz <em>fech.</em> em vez de fingir um preço.
            </p>
            <ListaIndices simbolos={INDICES} />
          </>
        )}

        {aba === 'sinteticos' && (
          <>
            <p className="section-cap">
              Índices sintéticos da Deriv: <strong>não são mercados reais</strong>, são séries
              geradas com volatilidade fixa. Negoceiam 24 horas por dia, todos os dias — é o que
              se mexe quando as bolsas estão fechadas.
            </p>
            <ListaIndices simbolos={SINTETICOS} />
          </>
        )}

        {aba === 'materias' && (
          <>
            <p className="section-cap">
              Metais preciosos e criptomoedas. A cripto negoceia 24/7; os metais seguem o horário
              do mercado à vista.
            </p>
            <ListaIndices simbolos={[...METAIS, ...CRIPTO]} />
          </>
        )}
      </section>

      <section>
        <div className="section-head">
          <h2>Desempenho da estratégia</h2>
          <span className="grow" />
          <Link href="/financeiro">abrir</Link>
        </div>
        <p className="section-cap">
          O saldo diz quanto está na conta. Se a estratégia tem vantagem é outra pergunta, medida
          em múltiplos de risco e não em dinheiro — está no Financeiro.
        </p>
      </section>
    </div>
  );
}

/**
 * Os instrumentos que a conta segue.
 *
 * É daqui que saem os sinais: só chegam ao telemóvel e ao início os dos
 * instrumentos desta lista.
 */
function MeusInstrumentos() {
  const p = usarPortfolio();
  const [escolher, setEscolher] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const correr = async (accao: Promise<string | null>) => {
    setErro(await accao);
  };

  return (
    <section>
      <div className="section-head">
        <h2>Os meus instrumentos</h2>
        <span className="grow" />
        <button type="button" className="btn ghost" onClick={() => setEscolher(true)}>
          + adicionar
        </button>
      </div>
      <p className="section-cap">
        Só recebe sinais — no telemóvel e no início — dos instrumentos desta lista.
      </p>

      {p.instrumentos === null ? (
        <div className="brilho" style={{ height: 60, borderRadius: 16 }} />
      ) : p.instrumentos.length === 0 ? (
        <div className="empty">
          <strong>Ainda não segue nenhum instrumento.</strong>
          Adicione os mercados que quer acompanhar para começar a receber sinais.
        </div>
      ) : (
        <div className="chips-portfolio">
          {p.instrumentos.map((c) => (
            <span key={c} className="chip-portfolio">
              <Link href={`/grafico?s=${encodeURIComponent(c)}&tf=15m`}>{c}</Link>
              <button type="button" aria-label={`Remover ${c} do portfólio`} onClick={() => void correr(p.remover(c))}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {erro && <div className="ob__erro">{erro}</div>}

      {escolher && (
        <SelectorMercado
          actual=""
          aoFechar={() => setEscolher(false)}
          aoEscolher={(c) => {
            setEscolher(false);
            void correr(p.adicionar(c));
          }}
        />
      )}
    </section>
  );
}

/**
 * Posições abertas, com lucro a mexer.
 *
 * O valor vem do `portfolio` da Deriv de 20 em 20 segundos. Não é ao segundo de
 * propósito: cada leitura custa uma sessão autenticada com OTP, e o número que
 * muda ao segundo é o preço do instrumento — esse tem fluxo próprio, público.
 */
function Posicoes() {
  const c = usarConta();
  const [aFechar, setAFechar] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  if (!c.ligada) return null;

  const fechar = async (id: number) => {
    setErro(null);
    setAFechar(id);
    try {
      const r = await apiFetch('/api/deriv/fechar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractId: id }),
      });
      const j = (await r.json()) as { erro?: string };
      if (!r.ok) throw new Error(j.erro ?? `HTTP ${r.status}`);
      await c.actualizar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setAFechar(null);
    }
  };

  return (
    <section>
      <div className="section-head">
        <h2>Posições abertas</h2>
        <span className="grow" />
        <span className="section-note">{c.posicoes.length}</span>
      </div>

      {c.posicoes.length === 0 ? (
        <div className="empty">
          <strong>Nada aberto.</strong>
          Quando comprar um contrato ele aparece aqui com o valor atual e o botão de vender.
        </div>
      ) : (
        <div className="grupo__caixa">
          {c.posicoes.map((p) => (
            <div key={p.contract_id} className="posicao">
              <div className="posicao__id">
                <div className="posicao__nome">{p.simbolo}</div>
                <div className="posicao__sub">{p.descricao}</div>
              </div>
              <div
                className={`posicao__valor ${p.lucro >= 0 ? 'bull-t' : 'bear-t'}`}
                aria-label="Resultado atual"
              >
                {p.lucro >= 0 ? '+' : ''}
                {dinheiro(p.lucro, c.moeda)}
              </div>
              <button
                type="button"
                className="posicao__fechar"
                onClick={() => void fechar(p.contract_id)}
                disabled={aFechar === p.contract_id}
              >
                {aFechar === p.contract_id ? '…' : 'vender'}
              </button>
            </div>
          ))}
        </div>
      )}

      {erro && <div className="ob__erro">{erro}</div>}
    </section>
  );
}
