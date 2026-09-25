'use client';

/**
 * Análise ao vivo, com uma visão por estratégia.
 *
 * ── PORQUE HÁ UM SELECTOR ──────────────────────────────────────────────────
 *
 * Antes o gráfico mostrava uma só coisa: o melhor sinal nascido na última vela
 * fechada. Sem sinal nessa vela, nada — mesmo com zonas activas, níveis
 * testados e um sinal de há três velas ainda por entrar. E o sinal que chegou
 * ao telemóvel desaparecia do gráfico uma vela depois.
 *
 * Agora cada estratégia tem a sua visão (ver `lib/visoes.ts`): as estruturas
 * que detecta, desenhadas, e o seu sinal mais recente com o que lhe aconteceu.
 * "Resumo" é o plano vivo mais relevante; "MMXM" é a análise do modelo
 * principal, que corre no servidor.
 *
 * ── QUANDO RECALCULA ───────────────────────────────────────────────────────
 *
 * Quando FECHA uma vela — não a cada tick. As estratégias decidem sobre velas
 * fechadas; recalcular sobre a vela em formação produziria zonas que aparecem e
 * desaparecem enquanto se olha para o ecrã. Um relógio mostra quanto falta.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { Candle, Timeframe as TimeframeCore } from '@trading/core';
import { velasUnicas, type Vela } from '@/lib/deriv/live';
import { acharSimbolo, formatarPreco, segundosDe, type Timeframe } from '@/lib/deriv/simbolos';
import type { PlanoParaOrdem } from './Negociar';
import { quandoNoticia, usarNoticias } from './usarNoticias';
import { VisaoIct, desenhoIct, usarIct } from './VisaoIct';
import { VisaoAsiaRange, desenhoAsiaRange, usarAsiaRange } from './VisaoAsiaRange';
import { ASIA_RANGE_EM_TESTE, estrategiaEmTeste, estrategiasPara } from '@trading/core';
import {
  analisarVisoes,
  DESENHO_VAZIO,
  estadoDoSinal,
  linhasDoSinal,
  nomeVisao,
  NOTA_CONTEXTO,
  RECENTE_VELAS,
  ROTULO_ESTADO,
  sinalVivo,
  VISOES,
  VISOES_DO_SERVIDOR,
  type Desenho,
  type SinalVisao,
  type Visao,
  type VisaoId,
} from '@/lib/visoes';

/** Compatibilidade: quem só quer linhas horizontais. */
export interface LinhaAnalise {
  preco: number;
  rotulo: string;
  tipo: string;
}

/** Abaixo disto as estratégias recusam-se a opinar. */
const MIN_VELAS = 60;

/** Análise MMXM já calculada no servidor (página do instrumento). */
export interface MmxmPronto {
  titulo: string;
  linhas: string[];
  desenho: Desenho;
  sinal: { direccao: string; entrada: number; stop: number; rMaximo: number } | null;
}

/** Próximo fecho de vela. Semanal alinha a segunda-feira UTC, como a agregação. */
function proximoFecho(tf: Timeframe, agora: number): number {
  if (tf === '1w') {
    const d = new Date(agora);
    const dia = d.getUTCDay();
    const ateSegunda = dia === 1 ? 7 : (8 - dia) % 7 || 7;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + ateSegunda);
  }
  const passo = segundosDe(tf) * 1000;
  return (Math.floor(agora / passo) + 1) * passo;
}

function relogio(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const seg = s % 60;
  const dois = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${dois(m)}:${dois(seg)}` : `${dois(m)}:${dois(seg)}`;
}

/**
 * A ordem das abas do gráfico.
 *
 * Primeiro o Resumo, depois as estratégias que REALMENTE se aplicam a este
 * instrumento e timeframe, depois as outras medidas, e o contexto no fim.
 * Antes era uma ordem fixa: num gráfico de ouro a 4h, a primeira aba depois do
 * resumo era o VWAP dos índices, que ali não gera nada, e o rompimento — que é
 * a regra daquele gráfico — nem sequer existia.
 */
function visoesOrdenadas(codigo: string, tf: string) {
  const daqui = new Set<string>(estrategiasPara(codigo, tf).map((e) => e.id as string));
  const peso = (v: (typeof VISOES)[number]) => {
    if (v.id === 'resumo') return 0;
    // O ICT ALGO é um algoritmo à parte e aplica-se a qualquer instrumento do
    // portfólio: fica logo a seguir ao Resumo.
    if (v.id === 'ict-algo') return 0.5;
    // O Asia Range Algo só existe nos pares do journal: logo a seguir ali, no fim nos outros.
    if (v.id === 'asia-range-algo') return daqui.has('asia-range-algo') || ASIA_RANGE_EM_TESTE.includes(codigo) ? 0.6 : 2.5;
    if (v.contexto) return 3;
    const ids: string[] = [...daqui];
    return ids.includes(v.id) || (v.id === 'tendencia-cripto' && ids.some((i) => i.startsWith('tendencia')))
      ? 1
      : 2;
  };
  return [...VISOES].sort((a, b) => peso(a) - peso(b));
}

export function AnaliseAoVivo({
  codigo,
  tf,
  velas,
  casas,
  visao,
  aoMudarVisao,
  aoMudarDesenho,
  aoNegociar,
  mmxm,
  compacto = false,
}: {
  codigo: string;
  tf: Timeframe;
  velas: Vela[];
  casas: number;
  visao: VisaoId;
  aoMudarVisao: (v: VisaoId) => void;
  aoMudarDesenho: (d: Desenho) => void;
  /** Abre o painel de ordem com este plano pronto a colar. */
  aoNegociar?: (plano: PlanoParaOrdem) => void;
  /** Se vier, a visão MMXM usa-a em vez de perguntar ao servidor. */
  mmxm?: MmxmPronto | null;
  /**
   * Ecrã inteiro: só o selector e uma linha com o plano da visão escolhida. O
   * gráfico precisa do espaço; o detalhe está no ecrã normal.
   */
  compacto?: boolean;
}) {
  /*
   * 0 até montar: o servidor e o browser calculariam horas diferentes para o
   * relógio, e o React recusa um HTML que não coincide ("Hydration failed").
   */
  const [agora, setAgora] = useState(0);
  useEffect(() => {
    setAgora(Date.now());
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const passo = segundosDe(tf) * 1000;
  const ultima = velas[velas.length - 1];
  // A última vela está aberta enquanto o relógio não passar do seu fecho.
  const nFechadas = ultima && (agora === 0 || agora < ultima.t + passo) ? velas.length - 1 : velas.length;
  const ultimaFechada = velas[nFechadas - 1];

  /*
   * A chave só muda quando fecha uma vela ou troca o instrumento/timeframe. É
   * ela, e não o array de velas (que muda a cada segundo), que decide recalcular.
   */
  const chave = `${codigo}|${tf}|${nFechadas}|${ultimaFechada?.t ?? 0}`;

  const candles = useMemo(() => {
    return velas.slice(0, nFechadas).map((v) => ({
      time: v.t,
      open: v.o,
      high: v.h,
      low: v.l,
      close: v.c,
      volume: 0,
    }));
  }, [velas, nFechadas]);

  // O VWAP dos índices precisa das diárias para confirmar o regime.
  const diarias = usarDiarias(codigo, estrategiasPara(codigo, tf).some((e) => e.id === 'compra-vwap-indices'));

  const analise = useMemo(() => {
    if (candles.length < MIN_VELAS) return { pronta: false as const, velas: candles.length };
    return {
      pronta: true as const,
      calculadaEm: Date.now(),
      ...analisarVisoes(candles, codigo, tf as TimeframeCore, diarias),
    };
    // `chave` resume velas/nFechadas: recalcular ao tick seria o erro a evitar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, candles, diarias]);

  const sinaisServidor = usarSinaisServidor(codigo, tf, analise.pronta ? candles : []);
  const mmxmServidor = usarMmxm(codigo, visao === 'mmxm' && mmxm === undefined);
  const mmxmActivo = mmxm ?? mmxmServidor;
  // O ICT ALGO corre no servidor: só se pede quando a secção está aberta.
  const ict = usarIct(codigo, tf, visao === 'ict-algo');
  const asia = usarAsiaRange(codigo, visao === 'asia-range-algo');
  const doServidor = VISOES_DO_SERVIDOR.includes(visao);

  // Injectar os sinais do servidor nas visões que não conseguem calcular sozinhas
  // (ex: a abertura do DAX, que precisa das velas diárias).
  const visoesComServidor = useMemo(() => {
    if (!analise.pronta) return null;
    const v = { ...analise.visoes };
    for (const [id, sv] of Object.entries(sinaisServidor)) {
      const k = id as keyof typeof v;
      if (v[k]) {
        const visaoAntiga = v[k]!;
        // Só substitui se o cliente não tiver um sinal, ou se o do servidor for mais recente
        if (!visaoAntiga.sinal || sv.sinal.sinal.generatedAt > visaoAntiga.sinal.sinal.generatedAt) {
          v[k] = {
            ...visaoAntiga,
            sinal: sv.sinal,
            desenho: {
              zonas: [...visaoAntiga.desenho.zonas, ...sv.desenho.zonas],
              linhas: [...visaoAntiga.desenho.linhas, ...sv.desenho.linhas],
              curvas: [...visaoAntiga.desenho.curvas, ...sv.desenho.curvas],
            },
          };
        }
      }
    }
    return v;
  }, [analise, sinaisServidor]);

  const actual: Visao | null =
    visoesComServidor && !doServidor ? visoesComServidor[visao as keyof typeof visoesComServidor] : null;

  // Desenha a visão escolhida — ou limpa.
  const assinatura =
    visao === 'mmxm'
      ? `mmxm|${mmxmActivo?.titulo ?? ''}|${mmxmActivo?.desenho.linhas.length ?? 0}`
      : visao === 'ict-algo'
        ? `ict|${ict?.chave ?? ''}|${ict?.em ?? 0}|${chave}`
        : visao === 'asia-range-algo'
          ? `asia|${asia?.codigo ?? ''}|${asia?.em ?? 0}|${chave}`
          : `${chave}|${visao}`;
  useEffect(() => {
    if (visao === 'mmxm') aoMudarDesenho(mmxmActivo?.desenho ?? DESENHO_VAZIO);
    else if (visao === 'ict-algo') aoMudarDesenho(desenhoIct(ict?.analise ?? null, candles, tf));
    else if (visao === 'asia-range-algo') aoMudarDesenho(desenhoAsiaRange(asia?.analise ?? null, candles, tf));
    else aoMudarDesenho(actual?.desenho ?? DESENHO_VAZIO);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura]);

  // Ao desmontar (trocar de instrumento pelo URL), não deixar desenhos órfãos.
  useEffect(() => () => aoMudarDesenho(DESENHO_VAZIO), [aoMudarDesenho]);

  const falta = proximoFecho(tf, agora) - agora;
  const fmt = (v: number) => formatarPreco(v, casas);

  /** Ponto de cor no botão: há um plano vivo nesta estratégia? */
  const marca = (id: VisaoId): string => {
    if (id === 'ict-algo') {
      const s = ict?.analise?.sinal;
      return s ? (s.direccao === 'bullish' ? 'compra' : 'venda') : '';
    }
    if (id === 'asia-range-algo') {
      const s = asia?.analise?.sinal;
      return s ? (s.direccao === 'bullish' ? 'compra' : 'venda') : '';
    }
    if (!visoesComServidor || id === 'mmxm') return '';
    const sv = visoesComServidor[id as keyof typeof visoesComServidor]?.sinal;
    if (!sv || !sinalVivo(sv.estado)) return '';
    return sv.sinal.direction === 'bullish' ? 'compra' : 'venda';
  };

  if (compacto) {
    const sv = doServidor ? null : (actual?.sinal ?? null);
    const sa = visao === 'asia-range-algo' ? (asia?.analise?.sinal ?? null) : null;
    const si = visao === 'ict-algo' ? (ict?.analise?.sinal ?? null) : null;
    const m = visao === 'mmxm' ? mmxmActivo : null;
    return (
      <div className="analise-viva analise-viva--compacta">
        <div className="visoes" role="tablist" aria-label="Estratégia desenhada no gráfico">
          {visoesOrdenadas(codigo, tf).map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={visao === v.id}
              className={`visoes__botao ${visao === v.id ? 'activo' : ''}`}
              onClick={() => aoMudarVisao(v.id)}
            >
              {marca(v.id) && <i className={`visoes__ponto ${marca(v.id)}`} aria-label="plano vivo" />}
              {v.curto}
            </button>
          ))}
          <span className="analise-viva__relogio visoes__relogio" aria-live="off">
            {agora === 0 ? tf : `${tf} · ${relogio(falta)}`}
          </span>
        </div>
        <div className="analise-compacta__linha">
          {si ? (
            <>
              <span className={`lado-pill ${si.direccao === 'bullish' ? 'compra' : 'venda'}`}>
                {si.direccao === 'bullish' ? 'COMPRA' : 'VENDA'}
              </span>
              <span className="grow">
                ICT ALGO · entrada <b>{fmt(si.entrada)}</b> · stop <b className="bear-t">{fmt(si.stop)}</b> · alvo{' '}
                <b className="bull-t">{fmt(si.alvo)}</b>
                <em>{si.rr.toFixed(1)}R · {si.modelo}</em>
              </span>
            </>
          ) : visao === 'ict-algo' ? (
            <span className="grow">
              <b>ICT ALGO</b>
              <em>{ict?.analise ? (ict.analise.porqueNao ?? 'sem setup') : 'a pedir a análise ao servidor…'}</em>
            </span>
          ) : sa ? (
            <>
              <span className={`lado-pill ${sa.direccao === 'bullish' ? 'compra' : 'venda'}`}>
                {sa.direccao === 'bullish' ? 'COMPRA' : 'VENDA'}
              </span>
              <span className="grow">
                Asia Range · entrada <b>{fmt(sa.entrada)}</b> · stop <b className="bear-t">{fmt(sa.stop)}</b> · alvo{' '}
                <b className="bull-t">{fmt(sa.alvo)}</b>
                <em>{sa.rr.toFixed(1)}R</em>
              </span>
            </>
          ) : visao === 'asia-range-algo' ? (
            <span className="grow">
              <b>Asia Range Algo</b>
              <em>{asia?.analise ? (asia.analise.porqueNao ?? 'sem setup') : (asia?.erro ?? 'a pedir a análise ao servidor…')}</em>
            </span>
          ) : sv ? (
            <>
              <span className={`lado-pill ${sv.sinal.direction === 'bullish' ? 'compra' : 'venda'}`}>
                {sv.sinal.direction === 'bullish' ? 'COMPRA' : 'VENDA'}
              </span>
              <span className="grow">
                entrada <b>{fmt(sv.sinal.entryPrice)}</b> · stop <b className="bear-t">{fmt(sv.sinal.stopLoss)}</b>
                {sv.sinal.targets[0] && (
                  <>
                    {' '}· TP1 <b className="bull-t">{fmt(sv.sinal.targets[0].price)}</b>
                  </>
                )}
                <em>
                  {sv.velasAtras === 0 ? 'nesta vela' : `há ${sv.velasAtras} velas`} · {ROTULO_ESTADO[sv.estado]}
                </em>
              </span>
              {estrategiaEmTeste(sv.sinal.strategy) ? null : (
                <b title="acerto medido no backtest">{Math.round(sv.sinal.conviction * 100)}%</b>
              )}
            </>
          ) : m ? (
            <span className="grow">
              <b>{m.titulo}</b>
              <em>{m.linhas[0]}</em>
            </span>
          ) : (
            <span className="grow">
              <em>
                {!analise.pronta
                  ? 'a carregar histórico…'
                  : visao === 'mmxm'
                    ? 'a pedir a análise MMXM…'
                    : `sem sinal recente${visao === 'resumo' ? '' : ' nesta estratégia'} · estruturas no gráfico`}
              </em>
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="analise-viva">
      <div className="analise-viva__topo">
        <span className="analise-viva__pulso" aria-hidden="true" />
        <strong>Análise</strong>
        <span className="grow" />
        <span className="analise-viva__relogio" aria-live="off">
          {agora === 0 ? `vela de ${tf}` : `próxima vela ${tf} em ${relogio(falta)}`}
        </span>
      </div>

      <div className="visoes" role="tablist" aria-label="Estratégia desenhada no gráfico">
        {VISOES.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={visao === v.id}
            className={`visoes__botao ${visao === v.id ? 'activo' : ''}`}
            onClick={() => aoMudarVisao(v.id)}
          >
            {marca(v.id) && <i className={`visoes__ponto ${marca(v.id)}`} aria-label="plano vivo" />}
            {v.curto}
          </button>
        ))}
      </div>

      <div className="analise-viva__corpo">
        {visao === 'ict-algo' ? (
          <VisaoIct estado={ict} tf={tf} casas={casas} aoNegociar={aoNegociar} />
        ) : visao === 'asia-range-algo' ? (
          <VisaoAsiaRange estado={asia} casas={casas} aoNegociar={aoNegociar} />
        ) : visao === 'mmxm' ? (
          <VisaoMmxm codigo={codigo} mmxm={mmxmActivo} casas={casas} aoCarregar={mmxm === undefined} />
        ) : !analise.pronta ? (
          <div className="empty">
            <strong>A carregar histórico…</strong>
            {analise.velas} de {MIN_VELAS} velas fechadas. As estratégias precisam de pelo menos{' '}
            {MIN_VELAS} para detectar zonas e níveis.
          </div>
        ) : visao === 'resumo' ? (
          <>
            {actual?.sinal ? (
              <CartaoSinal sv={actual.sinal} fmt={fmt} aoNegociar={aoNegociar} />
            ) : (
              <div className="empty">
                <strong>Nenhum plano vivo nas últimas velas.</strong>
                Toque numa estratégia para ver as zonas e os níveis que ela está a vigiar.
              </div>
            )}
            {actual?.nota && <p className="analise-viva__nota">{actual.nota}</p>}
            <div className="visoes__lista">
              <button type="button" className="visoes__linha" onClick={() => aoMudarVisao('ict-algo')}>
                <span className="grow">
                  <strong>ICT ALGO</strong>
                  <em>algoritmo independente · análise do semanal à vela, com o setup do momento</em>
                </span>
                <span aria-hidden="true">›</span>
              </button>
              <button type="button" className="visoes__linha" onClick={() => aoMudarVisao('asia-range-algo')}>
                <span className="grow">
                  <strong>Asia Range Algo</strong>
                  <em>o modelo do journal · Ásia, varrimento em Londres, SMT e MSS (GBPJPY, USDJPY, EURJPY)</em>
                </span>
                <span aria-hidden="true">›</span>
              </button>
              {VISOES.filter((v) => v.id !== 'resumo' && !VISOES_DO_SERVIDOR.includes(v.id)).map((v) => {
                const sv = analise.visoes[v.id as keyof typeof analise.visoes].sinal;
                return (
                  <button
                    key={v.id}
                    type="button"
                    className={`visoes__linha ${v.contexto ? 'visoes__linha--contexto' : ''}`}
                    onClick={() => aoMudarVisao(v.id)}
                  >
                    <span className="grow">
                      <strong>{v.nome}</strong>
                      <em>
                        {v.contexto
                          ? 'só contexto · não gera sinais'
                          : sv
                            ? `compra ${sv.velasAtras === 0 ? 'nesta vela' : `há ${sv.velasAtras} vela${sv.velasAtras === 1 ? '' : 's'}`} · ${ROTULO_ESTADO[sv.estado]}`
                            : 'estratégia validada · sem sinal recente'}
                      </em>
                    </span>
                    <span aria-hidden="true">›</span>
                  </button>
                );
              })}
            </div>
          </>
        ) : actual ? (
          <>
            {actual.sinal ? (
              <CartaoSinal sv={actual.sinal} fmt={fmt} aoNegociar={aoNegociar} />
            ) : (
              <div className="empty">
                {VISOES.find((v) => v.id === visao)?.contexto ? (
                  <>
                    <strong>Leitura de contexto — não gera sinais.</strong>
                    {NOTA_CONTEXTO.replace('Só contexto: esta leitura não gera sinais. ', '')}
                  </>
                ) : (
                  <>
                    <strong>
                      Sem sinal de {actual.nome.toLowerCase()} nas últimas {RECENTE_VELAS} velas.
                    </strong>
                    Os níveis que a regra vigia estão no gráfico e aqui em baixo.
                  </>
                )}
              </div>
            )}
            <Estruturas visao={actual} fmt={fmt} />
          </>
        ) : null}
      </div>

      <NoticiasDoInstrumento codigo={codigo} agora={agora} />

      {analise.pronta && !doServidor && (
        <div className="analise-viva__rodape">
          Calculada neste dispositivo sobre {analise.velas} velas {tf} fechadas da Deriv, às{' '}
          {new Date(analise.calculadaEm).toLocaleTimeString('pt-PT')}. Os planos vêm só das
          estratégias com vantagem medida em backtest, com custos; a percentagem é o acerto medido,
          não uma garantia.
          {analise.avisos[0] ? ` ${analise.avisos[0]}` : ''}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function CartaoSinal({
  sv,
  fmt,
  aoNegociar,
}: {
  sv: SinalVisao;
  fmt: (v: number) => string;
  aoNegociar?: (plano: PlanoParaOrdem) => void;
}) {
  const s = sv.sinal;
  const compra = s.direction === 'bullish';
  const vivo = sinalVivo(sv.estado);
  return (
    <div className={`analise-viva__sinal ${compra ? 'compra' : 'venda'} ${vivo ? '' : 'terminado'}`}>
      <div className="analise-viva__cab">
        <span className={`lado-pill ${compra ? 'compra' : 'venda'}`}>{compra ? 'COMPRA' : 'VENDA'}</span>
        <strong>{nomeVisao(s.strategy)}</strong>
        <span className="grow" />
        {estrategiaEmTeste(s.strategy) ? null : (
          <span className="analise-viva__r" title="acerto medido no backtest">
            {Math.round(s.conviction * 100)}% acerto
          </span>
        )}
      </div>

      <div className={`analise-viva__estado ${vivo ? 'vivo' : ''}`}>
        {sv.velasAtras === 0 ? 'Nesta vela' : `Há ${sv.velasAtras} vela${sv.velasAtras === 1 ? '' : 's'}`} ·{' '}
        {ROTULO_ESTADO[sv.estado]}
      </div>

      <div className="analise-viva__niveis">
        <div>
          <span>entrada</span>
          <b>{fmt(s.entryPrice)}</b>
        </div>
        <div className="stop">
          <span>stop</span>
          <b>{fmt(s.stopLoss)}</b>
        </div>
        {s.targets.slice(0, 3).map((t, i) => (
          <div key={i} className="alvo">
            <span>
              TP{i + 1} · {t.rMultiple.toFixed(1)}R
            </span>
            <b>{fmt(t.price)}</b>
          </div>
        ))}
      </div>

      <p className="analise-viva__razao">{s.rationale}</p>
      <div className="analise-viva__meta">
        {s.targets.length === 0 ? 'sem alvo fixo · saída pela regra' : `até ${s.maxRMultiple.toFixed(1)}R`} ·{' '}
        {s.regime === 'mean-reversion' ? 'reversão à média' : 'continuação'}
      </div>

      {aoNegociar && vivo && (
        <button
          type="button"
          className="btn ghost block"
          style={{ marginTop: 12 }}
          onClick={() =>
            aoNegociar({
              direccao: s.direction,
              entrada: s.entryPrice,
              stop: s.stopLoss,
              alvos: s.targets.map((t) => ({ preco: t.price, r: t.rMultiple })),
              origem: nomeVisao(s.strategy),
            })
          }
        >
          Levar este plano para a ordem
        </button>
      )}
    </div>
  );
}

function Estruturas({ visao, fmt }: { visao: Visao; fmt: (v: number) => string }) {
  if (visao.estruturas.length === 0 && !visao.nota) return null;
  return (
    <div className="visoes__estruturas">
      <div className="visoes__subtitulo">No gráfico agora</div>
      {visao.estruturas.map((e, i) => (
        <div key={i} className={`visoes__estrutura ${e.tipo}`}>
          <i aria-hidden="true" />
          <span className="visoes__estrutura-texto">
            <span>{e.rotulo}</span>
            <b>{e.alto !== undefined ? `${fmt(e.baixo)} – ${fmt(e.alto)}` : fmt(e.baixo)}</b>
          </span>
        </div>
      ))}
      {visao.nota && <p className="analise-viva__nota">{visao.nota}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MMXM — corre no servidor (precisa de pares correlacionados e de dados diários)
// ---------------------------------------------------------------------------

interface RespostaRadar {
  metodo?: 'mmxm' | 'institucional';
  analisado?: string;
  pontuacao?: number;
  modelo?: string | null;
  fase?: string | null;
  fluxo?: string;
  passoFalhado?: number | null;
  resumo?: string;
  sinal?: {
    direccao: string;
    entrada: number;
    stop: number;
    rMaximo: number;
    alvos?: Array<{ preco: number; r: number }>;
  } | null;
  erro?: string;
}

function usarMmxm(codigo: string, activo: boolean): MmxmPronto | null {
  const [estado, setEstado] = useState<{ codigo: string; valor: MmxmPronto | null } | null>(null);

  useEffect(() => {
    if (!activo || estado?.codigo === codigo) return;
    let cancelado = false;
    void (async () => {
      try {
        const r = await fetch(`/api/radar/${encodeURIComponent(codigo)}?tf=1d`, { cache: 'no-store' });
        const j = (await r.json()) as RespostaRadar;
        if (cancelado) return;
        if (j.metodo !== 'mmxm') {
          setEstado({
            codigo,
            valor: {
              titulo: 'MMXM indisponível para este instrumento',
              linhas: [
                'O MMXM compara o instrumento com pares correlacionados (SMT). Este não tem pares definidos — as quatro estratégias institucionais continuam disponíveis nos outros separadores.',
              ],
              desenho: DESENHO_VAZIO,
              sinal: null,
            },
          });
          return;
        }
        const s = j.sinal ?? null;
        const desenho: Desenho = s
          ? {
              zonas: [],
              curvas: [],
              linhas: [
                { preco: s.entrada, rotulo: 'entrada · MMXM diário', tipo: 'entrada' },
                { preco: s.stop, rotulo: 'stop', tipo: 'stop' },
                ...(s.alvos ?? []).slice(0, 3).map((a, i) => ({
                  preco: a.preco,
                  rotulo: `TP${i + 1} · ${a.r.toFixed(1)}R`,
                  tipo: 'alvo',
                })),
              ],
            }
          : DESENHO_VAZIO;
        setEstado({
          codigo,
          valor: {
            titulo: j.modelo ? `${j.modelo} · ${j.fase ?? ''}` : 'Nenhum Market Maker Model identificável',
            linhas: [
              `Checklist ${Math.round((j.pontuacao ?? 0) * 100)}%${j.passoFalhado ? ` · parou no passo ${j.passoFalhado} de 9` : ' · 9 de 9'}`,
              j.fluxo ? `Fluxo do timeframe superior: ${j.fluxo}` : '',
              j.resumo ?? '',
              j.analisado ? `Analisado sobre ${j.analisado} (o mesmo mercado noutro contrato).` : '',
            ].filter(Boolean),
            // Com outro contrato os preços não coincidem: não se desenham.
            desenho: j.analisado ? DESENHO_VAZIO : desenho,
            sinal: s ? { direccao: s.direccao, entrada: s.entrada, stop: s.stop, rMaximo: s.rMaximo } : null,
          },
        });
      } catch {
        if (!cancelado) setEstado({ codigo, valor: null });
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [codigo, activo, estado?.codigo]);

  return estado?.codigo === codigo ? estado.valor : null;
}

function VisaoMmxm({
  codigo,
  mmxm,
  casas,
  aoCarregar,
}: {
  codigo: string;
  mmxm: MmxmPronto | null;
  casas: number;
  aoCarregar: boolean;
}) {
  if (!mmxm) {
    return aoCarregar ? (
      <div className="empty">
        <strong>A pedir a análise MMXM ao servidor…</strong>
        Corre sobre velas diárias e pares correlacionados; demora alguns segundos.
      </div>
    ) : null;
  }
  const s = mmxm.sinal;
  return (
    <>
      {s ? (
        <div className={`analise-viva__sinal ${s.direccao === 'bullish' ? 'compra' : 'venda'}`}>
          <div className="analise-viva__cab">
            <span className={`lado-pill ${s.direccao === 'bullish' ? 'compra' : 'venda'}`}>
              {s.direccao === 'bullish' ? 'COMPRA' : 'VENDA'}
            </span>
            <strong>MMXM + SMT</strong>
            <span className="grow" />
            <span className="analise-viva__r">{s.rMaximo.toFixed(1)}R</span>
          </div>
          <div className="analise-viva__niveis">
            <div>
              <span>entrada</span>
              <b>{formatarPreco(s.entrada, casas)}</b>
            </div>
            <div className="stop">
              <span>stop</span>
              <b>{formatarPreco(s.stop, casas)}</b>
            </div>
          </div>
        </div>
      ) : null}
      <div className="visoes__estruturas">
        <div className="visoes__subtitulo">{mmxm.titulo}</div>
        {mmxm.linhas.map((l, i) => (
          <p key={i} className="analise-viva__nota">
            {l}
          </p>
        ))}
        <Link className="btn ghost block" href={`/instrumento/${encodeURIComponent(codigo)}?tf=1d`}>
          Análise MMXM completa
        </Link>
      </div>
    </>
  );
}

/**
 * Notícias de alto impacto que movem este instrumento nas próximas 48 horas.
 * Um sinal de 1h não sai nos 30 minutos antes e depois de uma delas.
 */
function NoticiasDoInstrumento({ codigo, agora }: { codigo: string; agora: number }) {
  const { dados } = usarNoticias();
  if (!dados || agora === 0) return null;
  const alvo = codigo.toUpperCase();
  const proximas = dados.eventos
    .filter((e) => e.instrumentos.includes(alvo) && e.em >= agora - 30 * 60_000 && e.em <= agora + 48 * 3_600_000)
    .slice(0, 4);
  if (proximas.length === 0) return null;
  return (
    <div className="analise-noticias">
      <div className="visoes__subtitulo">Notícias de alto impacto · 48 h</div>
      {proximas.map((e, i) => {
        const falta = e.em - agora;
        const colada = Math.abs(falta) <= 30 * 60_000;
        return (
          <div key={`${e.em}-${i}`} className={`analise-noticias__linha ${colada ? 'colada' : ''}`}>
            <b>{e.moeda}</b>
            <span className="grow">{e.titulo}</span>
            <em>{colada ? (falta > 0 ? `em ${Math.round(falta / 60_000)} min` : 'agora') : quandoNoticia(e.em, agora)}</em>
          </div>
        );
      })}
      <a className="analise-noticias__mais" href="/noticias">
        ver todas as notícias ›
      </a>
    </div>
  );
}

/**
 * Velas diárias do próprio instrumento, para o VWAP confirmar o regime.
 *
 * Sem elas a regra não dispara — de propósito, é a leitura conservadora — e o
 * gráfico deixaria de desenhar os sinais do VWAP sem dizer porquê. Pede-se uma
 * vez por instrumento; um dia de velas diárias não muda a cada minuto.
 */
function usarDiarias(codigo: string, precisa: boolean) {
  const [estado, setEstado] = useState<{ codigo: string; velas: Candle[] } | null>(null);
  useEffect(() => {
    if (!precisa) return;
    let cancelado = false;
    void (async () => {
      try {
        const sim = acharSimbolo(codigo);
        if (!sim) return;
        const v = await velasUnicas(sim.deriv, '1d', 260);
        if (cancelado) return;
        setEstado({
          codigo,
          velas: v.map((c) => ({ time: c.t, open: c.o, high: c.h, low: c.l, close: c.c, volume: 0 })),
        });
      } catch {
        /* sem diárias: o VWAP não dispara, que é o comportamento pretendido */
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [codigo, precisa]);
  return estado?.codigo === codigo ? estado.velas : undefined;
}

/**
 * Sinais que o servidor anunciou para este instrumento, para as visões que o
 * cliente não consegue calcular sozinho (o SMT precisa de velas de outros
 * instrumentos, a abertura do DAX precisa das diárias).
 */
const SEM_SINAIS: Record<string, { sinal: SinalVisao; desenho: Desenho }> = {};

function usarSinaisServidor(codigo: string, tf: string, candles: readonly Candle[]) {
  /*
   * O estado guarda A QUE INSTRUMENTO pertence, e só é devolvido se a chave
   * ainda bater certo.
   *
   * Sem isto, o plano do instrumento anterior ficava desenhado por cima do
   * novo: o efeito saía cedo quando as velas ainda não tinham chegado (e não
   * limpava), a falha do pedido era silenciosa (e não limpava), e o `tf` nem
   * sequer estava nas dependências — trocar de 15m para 4h mantinha o plano
   * de 15m. Medido: um plano do V75 (entrada ~46 500) desenhado num gráfico do
   * EURUSD a 1,14, que esticava a escala e deixava o gráfico ilegível.
   *
   * Guardar a chave COM os dados fecha também a janela entre o render e o
   * efeito, onde nenhuma limpeza dentro do `useEffect` chegaria a tempo.
   */
  const chave = `${codigo}|${tf}`;
  const [estado, setEstado] = useState<{
    chave: string;
    mapa: Record<string, { sinal: SinalVisao; desenho: Desenho }>;
  }>({ chave, mapa: {} });

  useEffect(() => {
    if (candles.length === 0) return;
    let cancelado = false;
    void (async () => {
      try {
        const r = await fetch('/api/sinais', { cache: 'no-store' });
        const j = (await r.json()) as { sinais?: Array<any> };
        if (cancelado || !j.sinais) return;

        // Só deste instrumento E deste timeframe: um sinal de 4h desenhado
        // num gráfico de 15m aponta para uma vela que não é a dele.
        const puros = j.sinais.filter(
          (s) => s.simbolo.toUpperCase() === codigo && s.timeframe === tf && s.estrategia !== 'mmxm',
        );
        const mapa: Record<string, { sinal: SinalVisao; desenho: Desenho }> = {};

        for (const s of puros) {
          if (mapa[s.estrategia]) continue; // Só queremos o mais recente de cada estratégia

          const geradoEm = new Date(s.geradoEm).getTime();
          // A vela MAIS PRÓXIMA do sinal. Com `findIndex` e uma janela de 24h
          // apanhava-se a primeira vela dentro do dia — em 15m, 96 velas ao lado.
          let index = -1;
          let melhor = Infinity;
          for (let k = candles.length - 1; k >= 0; k--) {
            const d = Math.abs((candles[k]?.time ?? 0) - geradoEm);
            if (d < melhor) {
              melhor = d;
              index = k;
            } else if (d > melhor) {
              break; // as velas estão ordenadas: a partir daqui só se afasta
            }
          }
          
          const rawSignal: any = {
            strategy: s.estrategia,
            direction: s.direccao,
            entryPrice: s.entrada,
            stopLoss: s.stop,
            targets: s.alvos.map((a: any) => ({ price: a.preco, rMultiple: a.r })),
            entryZoneLow: s.direccao === 'bullish' ? s.stop : s.entrada,
            entryZoneHigh: s.direccao === 'bullish' ? s.entrada : s.stop,
            maxRMultiple: s.rMaximo,
            conviction: s.conviccao,
            index: index >= 0 ? index : candles.length - 1,
            generatedAt: geradoEm,
            rationale: s.razao,
            assumptions: [],
            warnings: [],
            symbol: s.simbolo,
            timeframe: s.timeframe,
            regime: 'range',
            referencePrice: s.entrada
          };

          const estado = estadoDoSinal(rawSignal, candles);
          const velasAtras = candles.length - 1 - rawSignal.index;
          
          const sv = { sinal: rawSignal, velasAtras: Math.max(0, velasAtras), estado };
          mapa[s.estrategia] = { sinal: sv, desenho: linhasDoSinal(sv, nomeVisao(s.estrategia)) };
        }

        setEstado({ chave, mapa });
      } catch {
        // Falhou o pedido: fica sem sinais do servidor, nunca com os do
        // instrumento anterior.
        if (!cancelado) setEstado({ chave, mapa: {} });
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [chave, codigo, tf, candles.length > 0]);

  // Só os sinais DESTE instrumento e timeframe; os antigos não passam.
  return estado.chave === chave ? estado.mapa : SEM_SINAIS;
}
