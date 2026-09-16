'use client';

/**
 * Análise em tempo real, calculada no browser.
 *
 * ── PORQUE NO BROWSER ──────────────────────────────────────────────────────
 *
 * As quatro estratégias institucionais são funções puras de `@trading/core`: não
 * tocam em rede, ficheiros nem relógio. As velas já chegam ao browser pelo
 * WebSocket público da Deriv, uma atualização por segundo. Mandá-las ao
 * servidor para as analisar lá e devolver o resultado seria acrescentar um
 * salto de rede a uma conta que demora milissegundos.
 *
 * ── QUANDO RECALCULA ───────────────────────────────────────────────────────
 *
 * Quando FECHA uma vela — não a cada tick. As estratégias decidem sobre velas
 * fechadas; recalcular sobre a vela em formação produziria zonas que aparecem e
 * desaparecem enquanto se olha para o ecrã, que é exatamente o sinal falso que
 * o corte da vela viva existe para evitar. Um relógio mostra quanto falta.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  assessConfluence,
  runInstitutionalStrategies,
  type Candle,
  type StrategySignal,
  type Timeframe as TimeframeCore,
} from '@trading/core';
import type { Vela } from '@/lib/deriv/live';
import { formatarPreco, segundosDe, type Timeframe } from '@/lib/deriv/simbolos';

export interface LinhaAnalise {
  preco: number;
  rotulo: string;
  tipo: string;
}

const ESTRATEGIAS: Array<{ id: string; nome: string }> = [
  { id: 'supply-demand', nome: 'Oferta e procura' },
  { id: 'support-resistance', nome: 'Suporte/resistência' },
  { id: 'vwap-bands', nome: 'Bandas de VWAP' },
  { id: 'volume-profile', nome: 'Perfil de volume' },
];

const NOME = Object.fromEntries(ESTRATEGIAS.map((e) => [e.id, e.nome])) as Record<string, string>;

/** Abaixo disto as estratégias recusam-se a opinar. */
const MIN_VELAS = 60;

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
  aoMudarLinhas,
  aoNegociar,
}: {
  codigo: string;
  tf: Timeframe;
  velas: Vela[];
  casas: number;
  aoMudarLinhas: (linhas: LinhaAnalise[]) => void;
  aoNegociar?: () => void;
}) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const passo = segundosDe(tf) * 1000;
  const ultima = velas[velas.length - 1];
  // A última vela está aberta enquanto o relógio não passar do seu fecho.
  const nFechadas = ultima && agora < ultima.t + passo ? velas.length - 1 : velas.length;
  const ultimaFechada = velas[nFechadas - 1];

  /*
   * A chave só muda quando fecha uma vela ou troca o instrumento/timeframe. É
   * ela, e não o array de velas (que muda a cada segundo), que decide recalcular.
   */
  const chave = `${codigo}|${tf}|${nFechadas}|${ultimaFechada?.t ?? 0}`;

  const analise = useMemo(() => {
    const fechadas = velas.slice(0, nFechadas);
    if (fechadas.length < MIN_VELAS) {
      return { pronta: false as const, velas: fechadas.length };
    }

    const candles: Candle[] = fechadas.map((v) => ({
      time: v.t,
      open: v.o,
      high: v.h,
      low: v.l,
      close: v.c,
      volume: 0,
    }));
    const tempoUltima = candles[candles.length - 1]!.time;

    const r = runInstitutionalStrategies(
      {
        symbol: codigo,
        timeframe: tf as TimeframeCore,
        source: 'deriv',
        fidelity: 'true-ohlc',
        candles,
      },
      { minRMultiple: 2 },
    );

    // Só o que nasceu na última vela fechada está "ativo agora".
    const activos = r.signals.filter((s) => s.generatedAt === tempoUltima);
    const confluencia = assessConfluence(activos);
    const melhor: StrategySignal | null =
      confluencia.direction === 'conflicted'
        ? null
        : ([...activos].sort((a, b) => b.conviction - a.conviction)[0] ?? null);

    const porEstrategia = ESTRATEGIAS.map((e) => {
      const deste = activos.filter((s) => s.strategy === e.id);
      const direccao = deste[0]?.direction ?? null;
      return { ...e, direccao };
    });

    return {
      pronta: true as const,
      velas: fechadas.length,
      melhor,
      confluencia,
      porEstrategia,
      avisos: r.dataWarnings,
      calculadaEm: Date.now(),
    };
    // `chave` resume velas/nFechadas: recalcular ao tick seria o erro a evitar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  const melhor = analise.pronta ? analise.melhor : null;
  const idMelhor = melhor ? `${melhor.strategy}|${melhor.direction}|${melhor.generatedAt}` : '';

  // Desenha entrada, stop e alvos no gráfico — ou limpa, quando não há setup.
  useEffect(() => {
    if (!melhor) {
      aoMudarLinhas([]);
      return;
    }
    aoMudarLinhas([
      { preco: melhor.entryPrice, rotulo: `entrada · ${NOME[melhor.strategy] ?? ''}`, tipo: 'entrada' },
      { preco: melhor.stopLoss, rotulo: 'stop', tipo: 'stop' },
      ...melhor.targets.slice(0, 3).map((t, i) => ({
        preco: t.price,
        rotulo: `TP${i + 1} · ${t.rMultiple.toFixed(1)}R`,
        tipo: 'alvo',
      })),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idMelhor, codigo, tf]);

  // Ao desmontar (trocar de instrumento pelo URL), não deixar linhas órfãs.
  useEffect(() => () => aoMudarLinhas([]), [aoMudarLinhas]);

  const falta = proximoFecho(tf, agora) - agora;
  const fmt = (v: number) => formatarPreco(v, casas);

  return (
    <div className="analise-viva">
      <div className="analise-viva__topo">
        <span className="analise-viva__pulso" aria-hidden="true" />
        <strong>Análise ao vivo</strong>
        <span className="grow" />
        <span className="analise-viva__relogio" aria-live="off">
          próxima vela {tf} em {relogio(falta)}
        </span>
      </div>

      <div className="analise-viva__corpo">
        {!analise.pronta ? (
          <div className="empty">
            <strong>A carregar histórico…</strong>
            {analise.velas} de {MIN_VELAS} velas fechadas. As estratégias precisam de pelo menos{' '}
            {MIN_VELAS} para detetar zonas e níveis.
          </div>
        ) : melhor ? (
          <div className={`analise-viva__sinal ${melhor.direction === 'bullish' ? 'compra' : 'venda'}`}>
            <div className="analise-viva__cab">
              <span className={`lado-pill ${melhor.direction === 'bullish' ? 'compra' : 'venda'}`}>
                {melhor.direction === 'bullish' ? 'COMPRA' : 'VENDA'}
              </span>
              <strong>{NOME[melhor.strategy] ?? melhor.strategy}</strong>
              <span className="grow" />
              <span className="analise-viva__r">{melhor.maxRMultiple.toFixed(1)}R</span>
            </div>

            <div className="analise-viva__niveis">
              <div>
                <span>entrada</span>
                <b>{fmt(melhor.entryPrice)}</b>
              </div>
              <div className="stop">
                <span>stop</span>
                <b>{fmt(melhor.stopLoss)}</b>
              </div>
              {melhor.targets.slice(0, 3).map((t, i) => (
                <div key={i} className="alvo">
                  <span>
                    TP{i + 1} · {t.rMultiple.toFixed(1)}R
                  </span>
                  <b>{fmt(t.price)}</b>
                </div>
              ))}
            </div>

            <p className="analise-viva__razao">{melhor.rationale}</p>
            <div className="analise-viva__meta">
              convicção {Math.round(melhor.conviction * 100)}% ·{' '}
              {analise.confluencia.agreeingStrategies} de 4 estratégias de acordo ·{' '}
              {melhor.regime === 'mean-reversion' ? 'reversão à média' : 'continuação'}
            </div>

            {aoNegociar && (
              <button
                type="button"
                className="btn ghost block"
                style={{ marginTop: 12 }}
                onClick={aoNegociar}
              >
                Abrir o painel de ordem
              </button>
            )}
          </div>
        ) : analise.confluencia.direction === 'conflicted' ? (
          <div className="empty">
            <strong>Estratégias em sentidos opostos.</strong>
            {analise.confluencia.bullish.length} a apontar para cima e{' '}
            {analise.confluencia.bearish.length} para baixo na mesma vela. São leituras dos mesmos
            dados — quando se contradizem, não há setup.
          </div>
        ) : (
          <div className="empty">
            <strong>Sem setup na última vela fechada.</strong>
            As quatro estratégias voltam a correr quando a próxima vela fechar.
          </div>
        )}

        {analise.pronta && (
          <div className="analise-viva__estrategias">
            {analise.porEstrategia.map((e) => (
              <span
                key={e.id}
                className={`estrategia-chip ${e.direccao === 'bullish' ? 'compra' : e.direccao === 'bearish' ? 'venda' : ''}`}
                title={e.direccao ? `sinal de ${e.direccao === 'bullish' ? 'compra' : 'venda'}` : 'sem sinal nesta vela'}
              >
                <i aria-hidden="true" />
                {e.nome}
              </span>
            ))}
          </div>
        )}
      </div>

      {analise.pronta && (
        <div className="analise-viva__rodape">
          Calculada neste dispositivo sobre {analise.velas} velas {tf} fechadas, às{' '}
          {new Date(analise.calculadaEm).toLocaleTimeString('pt-PT')}. É o plano que as regras da
          estratégia produzem — não uma recomendação, e nenhuma destas estratégias tem vantagem
          demonstrada em backtest.
          {analise.avisos[0] ? ` ${analise.avisos[0]}` : ''}
        </div>
      )}
    </div>
  );
}
