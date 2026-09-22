'use client';

/**
 * O painel que mostra o sistema a trabalhar.
 *
 * ── O PEDIDO, E A TENTAÇÃO QUE FOI RECUSADA ────────────────────────────────
 *
 * "Como se fossem agentes de IA a trabalhar para encontrar o melhor sinal de
 * entrada nos pares selecionados." A forma fácil de fazer isto é uma barra de
 * progresso falsa e umas linhas que acendem em sequência com `setTimeout`.
 *
 * Isto não faz isso. Cada linha é um instrumento a ser REALMENTE analisado:
 * pede-se `/api/radar/<símbolo>`, que carrega as velas da Deriv e corre as
 * MESMAS estratégias ACTIVAS (validadas e em teste) que o motor de tempo real
 * usa para decidir o que anuncia — não a análise institucional antiga, que já
 * não gera sinal nenhum no sistema real. A linha fica a pulsar enquanto o
 * pedido está no ar e assenta no resultado quando chega.
 *
 * A diferença importa: uma animação falsa ensina a pessoa a ignorar o ecrã. Se
 * o EURUSD demora quatro segundos e o BTCUSD demora um, isso vê-se — e é
 * informação real sobre onde estão as fontes lentas.
 *
 * ── UM DE CADA VEZ ─────────────────────────────────────────────────────────
 *
 * Sequencial, de propósito. Dez análises em paralelo saturariam as APIs
 * públicas (que têm limites por minuto) e chegariam todas ao mesmo tempo, o
 * que daria exatamente o ecrã estático que se queria evitar.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export interface Resultado {
  simbolo: string;
  nome?: string;
  /** Há alguma estratégia activa para este instrumento e timeframe? */
  temEstrategia?: boolean;
  /** Nomes das estratégias activas aqui, mesmo sem sinal na última vela. */
  estrategias?: string[];
  /** As estratégias activas discordaram na última vela — nenhuma prevalece. */
  conflito?: boolean;
  sinal?: {
    direccao: string;
    entrada: number;
    stop: number;
    rMaximo: number;
    /** Taxa de acerto medida no backtest; 0 quando `emTeste`. */
    conviccao: number;
    estrategia: string;
    /** Em teste ao vivo: sem taxa de acerto medida ainda. */
    emTeste: boolean;
  } | null;
  resumo?: string;
  erro?: string;
}

type Estado = 'espera' | 'corre' | 'passou' | 'falhou';

/** Em intradiário a vela fecha a cada poucos minutos: repetir mais depressa. */
const INTRADIARIO = new Set(['1m', '5m', '15m', '30m']);

const TIMEFRAMES_RADAR = ['15m', '30m', '1h', '4h', '1d'] as const;
const CHAVE_RADAR = 'radar_timeframe';

/** Ordena com sinal primeiro (por convicção), depois sem sinal, depois falhas. */
function pontuacaoOrdem(r: Resultado | undefined): number {
  if (!r || r.erro) return -1;
  if (r.sinal) return 1 + r.sinal.conviccao;
  return 0;
}

export function PainelAgentes({
  simbolos,
  timeframe: timeframeObjetivo = '1d',
}: {
  simbolos: string[];
  timeframe?: string;
}) {
  // O timeframe do objetivo é só o ponto de partida: a escolha fica neste dispositivo.
  const [timeframe, setTimeframe] = useState(timeframeObjetivo);
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(CHAVE_RADAR);
      if (v && (TIMEFRAMES_RADAR as readonly string[]).includes(v)) setTimeframe(v);
    } catch {
      /* sem armazenamento */
    }
  }, []);
  const escolherTimeframe = (tf: string) => {
    setTimeframe(tf);
    try {
      window.localStorage.setItem(CHAVE_RADAR, tf);
    } catch {
      /* sem armazenamento */
    }
  };
  const [resultados, setResultados] = useState<Map<string, Resultado>>(new Map());
  const [estados, setEstados] = useState<Map<string, Estado>>(new Map());
  const [aCorrer, setACorrer] = useState(false);
  const [terminadoEm, setTerminadoEm] = useState<number | null>(null);
  const cancelado = useRef(false);

  const varrer = useCallback(async () => {
    if (simbolos.length === 0) return;
    cancelado.current = false;
    setACorrer(true);
    setEstados(new Map(simbolos.map((s) => [s, 'espera' as Estado])));
    setResultados(new Map());

    for (const s of simbolos) {
      if (cancelado.current) break;
      setEstados((m) => new Map(m).set(s, 'corre'));

      try {
        const r = await fetch(
          `/api/radar/${encodeURIComponent(s)}?tf=${encodeURIComponent(timeframe)}`,
          { cache: 'no-store' },
        );
        const j = (await r.json()) as Resultado;
        if (cancelado.current) break;

        setResultados((m) => new Map(m).set(s, j));
        setEstados((m) => new Map(m).set(s, j.erro ? 'falhou' : 'passou'));
      } catch (err) {
        if (cancelado.current) break;
        setResultados((m) =>
          new Map(m).set(s, {
            simbolo: s,
            erro: err instanceof Error ? err.message : String(err),
          }),
        );
        setEstados((m) => new Map(m).set(s, 'falhou'));
      }
    }

    if (!cancelado.current) {
      setACorrer(false);
      setTerminadoEm(Date.now());
    }
  }, [simbolos, timeframe]);

  useEffect(() => {
    void varrer();
    return () => {
      cancelado.current = true;
    };
  }, [varrer]);

  /*
   * Nova passagem de 5 em 5 minutos.
   *
   * Não mais depressa: a análise depende de velas FECHADAS, e num diário isso
   * muda uma vez por dia. O que muda ao segundo é o preço, e esse vem do fluxo
   * de mercado — não daqui.
   */
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden && !aCorrer) void varrer();
    }, INTRADIARIO.has(timeframe) ? 60_000 : 300_000);
    return () => clearInterval(id);
  }, [varrer, aCorrer, timeframe]);

  const feitos = [...estados.values()].filter((e) => e === 'passou' || e === 'falhou').length;
  const comSinal = [...resultados.values()].filter((r) => r.sinal).length;

  // Ordena por pontuação, mas só depois de terminar — reordenar a meio faria as
  // linhas saltar debaixo do dedo de quem está a ler.
  const ordem = aCorrer
    ? simbolos
    : [...simbolos].sort((a, b) => pontuacaoOrdem(resultados.get(b)) - pontuacaoOrdem(resultados.get(a)));

  return (
    <div className="agentes">
      <div className="agentes__topo">
        <span className="agentes__titulo">
          {aCorrer ? 'A analisar mercados…' : 'Análise concluída'}
        </span>
        <span className="grow" />
        <span className="agente__valor">
          {feitos}/{simbolos.length}
          {!aCorrer && comSinal > 0 && ` · ${comSinal} com sinal`}
        </span>
        {!aCorrer && (
          <button
            type="button"
            className="agentes__repetir"
            onClick={() => void varrer()}
            aria-label="Analisar outra vez"
            title="Analisar outra vez"
          >
            ↻
          </button>
        )}
      </div>

      <div className="segmentos agentes__tfs" role="radiogroup" aria-label="Timeframe da análise">
        {TIMEFRAMES_RADAR.map((tf) => (
          <button key={tf} type="button" aria-pressed={timeframe === tf} onClick={() => escolherTimeframe(tf)}>
            {tf.toUpperCase()}
          </button>
        ))}
      </div>

      <div className={`agentes__barra ${aCorrer ? 'activa' : ''}`} />

      {ordem.map((s) => (
        <LinhaAgente
          key={s}
          simbolo={s}
          estado={estados.get(s) ?? 'espera'}
          resultado={resultados.get(s)}
          timeframe={timeframe}
        />
      ))}

      {terminadoEm && !aCorrer && (
        <div className="agentes__rodape">
          Última passagem às{' '}
          {new Date(terminadoEm).toLocaleTimeString('pt-PT', {
            hour: '2-digit',
            minute: '2-digit',
          })}
          . Velas {timeframe} fechadas — as mesmas estratégias que o motor de tempo real usa,
          repetidas a cada {INTRADIARIO.has(timeframe) ? 'minuto' : '5 minutos'}.
        </div>
      )}
    </div>
  );
}

function LinhaAgente({
  simbolo,
  estado,
  resultado,
  timeframe,
}: {
  simbolo: string;
  estado: Estado;
  resultado: Resultado | undefined;
  timeframe: string;
}) {
  const sinal = resultado?.sinal;

  const marca =
    estado === 'corre' ? '◍' : estado === 'falhou' ? '!' : estado === 'passou' ? '✓' : '·';

  const detalhe = (): string => {
    if (estado === 'corre') return 'a analisar…';
    if (estado === 'espera') return 'em fila';
    if (resultado?.erro) return resultado.erro.slice(0, 44);
    if (sinal) {
      const lado = sinal.direccao === 'bullish' ? 'COMPRA' : 'VENDA';
      return `${lado} · ${sinal.rMaximo.toFixed(1)}R`;
    }
    if (resultado?.conflito) return 'estratégias em sentidos opostos';
    if (resultado?.temEstrategia === false) return 'sem estratégia activa';
    return resultado?.estrategias?.length ? `${resultado.estrategias.join(', ')} · sem sinal` : '—';
  };

  const destino = sinal
    ? `/grafico?s=${encodeURIComponent(simbolo)}&tf=${timeframe}&v=${encodeURIComponent(sinal.estrategia)}`
    : `/grafico?s=${encodeURIComponent(simbolo)}&tf=${timeframe}`;

  return (
    <Link href={destino} className="agente">
      <span
        className={`agente__estado ${sinal && estado === 'passou' ? 'passou' : estado}`}
        aria-hidden="true"
      >
        {marca}
      </span>
      <span className="agente__nome">
        <strong>{simbolo}</strong>
        <em className="agente__detalhe">{detalhe()}</em>
      </span>
      <span className="agente__valor">
        {sinal?.emTeste ? null : sinal ? (
          `${Math.round(sinal.conviccao * 100)}%`
        ) : (
          ''
        )}
      </span>
    </Link>
  );
}
