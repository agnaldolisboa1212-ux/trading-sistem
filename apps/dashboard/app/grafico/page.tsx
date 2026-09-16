'use client';

/**
 * Terminal — gráfico ao vivo, selector de mercado e painel de ordem.
 *
 * ── O QUE ESTA PÁGINA RESOLVE ──────────────────────────────────────────────
 *
 * A queixa era concreta: "no TradingView os gráficos mexem-se ao segundo, quero
 * a mesma coisa". A versão anterior sondava uma rota HTTP de 10 em 10 segundos
 * e cada sondagem re-corria a análise inteira. Daí o atraso.
 *
 * Aqui o browser liga-se DIRETAMENTE ao WebSocket público da Deriv. Não há
 * servidor no meio, não há token envolvido (o fluxo de mercado é público), e a
 * vela em formação chega uma vez por segundo. Medido: `ticks_history` com
 * `subscribe:1` devolve uma mensagem `ohlc` por segundo com open/high/low/close
 * da vela atual.
 *
 * ── PORQUE É UM CLIENT COMPONENT INTEIRO ───────────────────────────────────
 *
 * Porque tudo o que está aqui muda em resposta ao utilizador ou ao fluxo: o
 * símbolo, o timeframe, o preço, o painel de ordem. Não sobra nada que valha a
 * pena renderizar no servidor, e a fronteira serviria só para complicar.
 *
 * A escolha de símbolo, timeframe e estratégia vai para o URL
 * (`?s=…&tf=…&v=…`) para que partilhar o link abra o mesmo ecrã, o "voltar" do
 * browser funcione, e um aviso de sinal abra já na estratégia que o deu.
 */

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { GraficoVivo } from '@/components/vivo/GraficoVivo';
import { Negociar } from '@/components/vivo/Negociar';
import { Ligacao, Variacao } from '@/components/vivo/Preco';
import { SelectorMercado } from '@/components/vivo/SelectorMercado';
import { rotuloHorario, usarHorario } from '@/lib/deriv/horarios';
import { AnaliseAoVivo } from '@/components/vivo/AnaliseAoVivo';
import { DESENHO_VAZIO, visaoValida, type Desenho, type VisaoId } from '@/lib/visoes';
import { usarPreco, usarVelas, variacao } from '@/components/vivo/usarPreco';
import { SaldoCompacto } from '@/components/vivo/CartaoSaldo';
import {
  acharSimbolo,
  formatarPreco,
  TIMEFRAMES,
  type Timeframe,
} from '@/lib/deriv/simbolos';
import { lerPreferenciasCliente } from '@/lib/preferencias';

export default function Page() {
  return (
    <Suspense fallback={<div className="wrap"><div className="brilho" style={{ height: 420, borderRadius: 20 }} /></div>}>
      <Terminal />
    </Suspense>
  );
}

function Terminal() {
  const router = useRouter();
  const params = useSearchParams();

  const codigo = (params.get('s') ?? 'V75').toUpperCase();
  const tf = (params.get('tf') ?? '5m') as Timeframe;
  const visao = visaoValida(params.get('v'));

  const [selector, setSelector] = useState(false);
  const [cheio, setCheio] = useState(false);
  const [aba, setAba] = useState<'analise' | 'ordem' | 'info'>('analise');
  /** O que a estratégia escolhida desenha por cima das velas. */
  const [desenho, setDesenho] = useState<Desenho>(DESENHO_VAZIO);

  const s = acharSimbolo(codigo);
  const velas = usarVelas(codigo, tf, 300);
  const preco = usarPreco(codigo);
  const horario = usarHorario(codigo);

  const navegar = useCallback(
    (novoS: string, novoTf: Timeframe, novaVisao: VisaoId = visao) => {
      router.replace(
        `/grafico?s=${encodeURIComponent(novoS)}&tf=${novoTf}${novaVisao === 'resumo' ? '' : `&v=${novaVisao}`}`,
        { scroll: false },
      );
    },
    [router, visao],
  );

  /*
   * Sem `?s=` no URL, abre no primeiro mercado escolhido no onboarding. Abrir
   * sempre no mesmo símbolo fixo ignoraria a única coisa que a pessoa disse ao
   * sistema sobre o que lhe interessa.
   */
  useEffect(() => {
    if (params.get('s')) return;
    const prefs = lerPreferenciasCliente();
    const primeiro = prefs.instrumentos.find((i) => acharSimbolo(i));
    if (primeiro && primeiro !== codigo) navegar(primeiro, tf);
    // Só na montagem: depois disto o URL manda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sair do ecrã inteiro com Escape, como qualquer overlay.
  useEffect(() => {
    if (!cheio) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCheio(false);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [cheio]);

  const valor = preco.preco ?? velas.actual?.c ?? null;
  const pct = useMemo(() => variacao(velas.velas, valor), [velas.velas, valor]);

  if (!s) {
    return (
      <div className="wrap">
        <div className="empty">
          <strong>Instrumento desconhecido: {codigo}</strong>
          <div>
            <button type="button" className="btn ghost" onClick={() => setSelector(true)}>
              Escolher outro
            </button>
          </div>
        </div>
        {selector && (
          <SelectorMercado
            actual={codigo}
            aoFechar={() => setSelector(false)}
            aoEscolher={(c) => {
              setSelector(false);
              navegar(c, tf);
            }}
          />
        )}
      </div>
    );
  }

  const grafico = (
    <GraficoVivo
      velas={velas.velas}
      casas={s.casas}
      timeframe={tf}
      zonas={desenho.zonas}
      linhas={desenho.linhas}
      curvas={desenho.curvas}
      altura={cheio ? 0 : 360}
      cheio={cheio}
      titulo={`${s.codigo} · ${s.nome}`}
      aoMudarTimeframe={(novo) => navegar(codigo, novo)}
      aoAlternarCheio={() => setCheio((v) => !v)}
    />
  );

  if (cheio) {
    return (
      <div className="terminal--cheio" role="dialog" aria-modal="true" aria-label={s.nome}>
        {grafico}
      </div>
    );
  }

  return (
    <div className="wrap wrap--terminal">
      {/* Barra do instrumento: toca para trocar, como no MetaTrader. */}
      <div className="terminal__barra">
        <button
          type="button"
          className="terminal__simbolo"
          onClick={() => setSelector(true)}
          aria-haspopup="dialog"
        >
          <span className="terminal__codigo">{s.codigo}</span>
          <span className="terminal__nome">{s.nome}</span>
          <span className="terminal__seta" aria-hidden="true">
            ▾
          </span>
        </button>
        <div className="grow" />
        <SaldoCompacto />
      </div>

      <div className="terminal__preco">
        <div
          key={preco.geracao}
          className={`terminal__valor ${preco.direccao ? `preco--${preco.direccao}` : ''}`}
        >
          {valor === null ? '—' : formatarPreco(valor, s.casas)}
        </div>
        <Variacao pct={pct} tamanho={13} />
        <div className="grow" />
        {(horario ? !horario.aberto : !s.continuo && !preco.preco && velas.pronto) && (
          <span className="fechado" title="Horário da própria Deriv">
            mercado fechado
            {rotuloHorario(horario) ? ` · ${rotuloHorario(horario)}` : ''}
          </span>
        )}
        <Ligacao />
      </div>

      {grafico}

      <div className="abas" role="tablist" aria-label="Painel">
        <button
          type="button"
          role="tab"
          aria-selected={aba === 'analise'}
          className={aba === 'analise' ? 'active' : ''}
          onClick={() => setAba('analise')}
        >
          Análise
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={aba === 'ordem'}
          className={aba === 'ordem' ? 'active' : ''}
          onClick={() => setAba('ordem')}
        >
          Negociar
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={aba === 'info'}
          className={aba === 'info' ? 'active' : ''}
          onClick={() => setAba('info')}
        >
          Instrumento
        </button>
      </div>

      {/*
        Montada sempre, mostrada só no seu separador: é ela que desenha entrada,
        stop e alvos no gráfico, e essas linhas não devem desaparecer quando se
        passa para o painel de ordem — é precisamente aí que fazem falta.
      */}
      <div hidden={aba !== 'analise'}>
        <AnaliseAoVivo
          codigo={codigo}
          tf={tf}
          velas={velas.velas}
          casas={s.casas}
          visao={visao}
          aoMudarVisao={(v) => navegar(codigo, tf, v)}
          aoMudarDesenho={setDesenho}
          aoNegociar={() => setAba('ordem')}
        />
      </div>

      {aba === 'ordem' && <Negociar codigo={codigo} />}

      {aba === 'info' && (
        <Informacao codigo={codigo} nome={s.nome} continuo={s.continuo} casas={s.casas} tf={tf} />
      )}

      {selector && (
        <SelectorMercado
          actual={codigo}
          aoFechar={() => setSelector(false)}
          aoEscolher={(c) => {
            setSelector(false);
            navegar(c, tf);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Informacao({
  codigo,
  nome,
  continuo,
  casas,
  tf,
}: {
  codigo: string;
  nome: string;
  continuo: boolean;
  casas: number;
  tf: Timeframe;
}) {
  const v = usarVelas(codigo, tf, 300);
  const fechadas = v.velas.slice(0, -1);
  const max = fechadas.length ? Math.max(...fechadas.map((c) => c.h)) : null;
  const min = fechadas.length ? Math.min(...fechadas.map((c) => c.l)) : null;
  const rotuloTf = TIMEFRAMES.find((t) => t.id === tf)?.rotulo ?? tf;

  return (
    <div className="rows">
      <div>
        <span className="k">Instrumento</span>
        <span className="v">{nome}</span>
      </div>
      <div>
        <span className="k">Horário</span>
        <span className="v">{continuo ? '24 horas, todos os dias' : 'horário da bolsa'}</span>
      </div>
      <div>
        <span className="k">Máximo ({fechadas.length} velas {rotuloTf})</span>
        <span className="v">{max === null ? '—' : formatarPreco(max, casas)}</span>
      </div>
      <div>
        <span className="k">Mínimo ({fechadas.length} velas {rotuloTf})</span>
        <span className="v">{min === null ? '—' : formatarPreco(min, casas)}</span>
      </div>
      <div>
        <span className="k">Análise MMXM completa</span>
        <span className="v">
          <Link href={`/instrumento/${codigo}?tf=1d`}>abrir</Link>
        </span>
      </div>
    </div>
  );
}
