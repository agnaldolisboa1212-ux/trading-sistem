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
import type { Vela } from '@/lib/deriv/live';
import { formatarPreco, segundosDe, type Timeframe } from '@/lib/deriv/simbolos';
import type { PlanoParaOrdem } from './Negociar';
import { quandoNoticia, usarNoticias } from './usarNoticias';
import {
  analisarVisoes,
  DESENHO_VAZIO,
  nomeVisao,
  NOTA_CONTEXTO,
  RECENTE_VELAS,
  ROTULO_ESTADO,
  sinalVivo,
  VISOES,
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

  const analise = useMemo(() => {
    const fechadas = velas.slice(0, nFechadas);
    if (fechadas.length < MIN_VELAS) return { pronta: false as const, velas: fechadas.length };
    const candles: Candle[] = fechadas.map((v) => ({
      time: v.t,
      open: v.o,
      high: v.h,
      low: v.l,
      close: v.c,
      volume: 0,
    }));
    return {
      pronta: true as const,
      calculadaEm: Date.now(),
      ...analisarVisoes(candles, codigo, tf as TimeframeCore),
    };
    // `chave` resume velas/nFechadas: recalcular ao tick seria o erro a evitar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  const mmxmServidor = usarMmxm(codigo, visao === 'mmxm' && mmxm === undefined);
  const mmxmActivo = mmxm ?? mmxmServidor;

  const actual: Visao | null =
    analise.pronta && visao !== 'mmxm' ? analise.visoes[visao] : null;

  // Desenha a visão escolhida — ou limpa.
  const assinatura =
    visao === 'mmxm'
      ? `mmxm|${mmxmActivo?.titulo ?? ''}|${mmxmActivo?.desenho.linhas.length ?? 0}`
      : `${chave}|${visao}`;
  useEffect(() => {
    if (visao === 'mmxm') aoMudarDesenho(mmxmActivo?.desenho ?? DESENHO_VAZIO);
    else aoMudarDesenho(actual?.desenho ?? DESENHO_VAZIO);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura]);

  // Ao desmontar (trocar de instrumento pelo URL), não deixar desenhos órfãos.
  useEffect(() => () => aoMudarDesenho(DESENHO_VAZIO), [aoMudarDesenho]);

  const falta = proximoFecho(tf, agora) - agora;
  const fmt = (v: number) => formatarPreco(v, casas);

  /** Ponto de cor no botão: há um plano vivo nesta estratégia? */
  const marca = (id: VisaoId): string => {
    if (!analise.pronta || id === 'mmxm') return '';
    const sv = analise.visoes[id as keyof typeof analise.visoes]?.sinal;
    if (!sv || !sinalVivo(sv.estado)) return '';
    return sv.sinal.direction === 'bullish' ? 'compra' : 'venda';
  };

  if (compacto) {
    const sv = visao === 'mmxm' ? null : (actual?.sinal ?? null);
    const m = visao === 'mmxm' ? mmxmActivo : null;
    return (
      <div className="analise-viva analise-viva--compacta">
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
          <span className="analise-viva__relogio visoes__relogio" aria-live="off">
            {agora === 0 ? tf : `${tf} · ${relogio(falta)}`}
          </span>
        </div>
        <div className="analise-compacta__linha">
          {sv ? (
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
              <b title="acerto medido no backtest">{Math.round(sv.sinal.conviction * 100)}%</b>
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
        {visao === 'mmxm' ? (
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
              {VISOES.filter((v) => v.id !== 'resumo' && v.id !== 'mmxm').map((v) => {
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

      {analise.pronta && visao !== 'mmxm' && (
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
        <span className="analise-viva__r" title="acerto medido no backtest">
          {Math.round(s.conviction * 100)}% acerto
        </span>
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
