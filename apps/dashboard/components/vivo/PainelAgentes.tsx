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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ASIA_RANGE_EM_TESTE, ICT_ALGO_EM_TESTE } from '@trading/core';
import Link from 'next/link';
import { acharSimbolo, formatarPreco } from '@/lib/deriv/simbolos';

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
    /** Primeiro alvo (TP). */
    alvo?: number | null;
    /** Ordem pendente (limite) na entrada, à espera do regresso do preço. */
    pendente?: boolean;
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

/*
 * ── PORQUE SE REPETE ───────────────────────────────────────────────────────
 *
 * Medido: com o gráfico, os sinais e este painel abertos, a Deriv respondia
 * `RateLimit` a `ticks_history` a meio da passagem, e os pedidos seguintes
 * morriam com "Failed to fetch" (a ligação caía enquanto o servidor ainda
 * esperava). Metade das linhas ficava vermelha por uma falha de segundos.
 *
 * Um erro passageiro — rede, RateLimit, timeout — espera um pouco e tenta de
 * novo. Um erro permanente (símbolo desconhecido) não se repete.
 */
const RECUOS_MS = [2_000, 5_000];

function passageiro(msg: string): boolean {
  return /RateLimit|rate limit|Failed to fetch|NetworkError|Load failed|timeout|HTTP 5\d\d|ligação|WebSocket/i.test(msg);
}

async function pedirRadar(
  simbolo: string,
  timeframe: string,
  grupo: Grupo,
  cancelado: () => boolean,
): Promise<Resultado> {
  for (let tentativa = 0; ; tentativa++) {
    let resultado: Resultado;
    try {
      const url = `/api/radar/${encodeURIComponent(simbolo)}?tf=${encodeURIComponent(timeframe)}&grupo=${grupo}`;
      const r = await fetch(url, {
        cache: 'no-store',
      });
      resultado = r.ok || r.status < 500 ? ((await r.json()) as Resultado) : { simbolo, erro: `HTTP ${r.status}` };
    } catch (err) {
      resultado = { simbolo, erro: err instanceof Error ? err.message : String(err) };
    }
    if (!resultado.erro || !passageiro(resultado.erro) || tentativa >= RECUOS_MS.length || cancelado()) {
      return resultado;
    }
    await new Promise((r) => setTimeout(r, RECUOS_MS[tentativa]));
  }
}

/**
 * Os dois grupos do painel:
 *
 *   ict      ICT ALGO, nos timeframes em que executa (15M, 1H, 4H)
 *   asia     Asia Range Algo, em 15M
 *   basico   as outras estratégias, no timeframe escolhido
 */
type Grupo = 'ict' | 'asia' | 'basico';

/** Em intradiário a vela fecha a cada poucos minutos: repetir mais depressa. */
const INTRADIARIO = new Set(['1m', '5m', '15m', '30m']);

const TIMEFRAMES_RADAR = ['15m', '30m', '1h', '4h', '1d'] as const;
const CHAVE_RADAR = 'radar_timeframe';
/** Só os timeframes em que o ICT ALGO dá sinais. */
const TIMEFRAMES_ICT = ['15m', '1h', '4h'] as const;
const CHAVE_ICT = 'radar_timeframe_ict';

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
  const [tfIct, setTfIct] = useState<string>('15m');
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(CHAVE_ICT);
      if (v && (TIMEFRAMES_ICT as readonly string[]).includes(v)) setTfIct(v);
    } catch {
      /* sem armazenamento */
    }
  }, []);
  const escolherTfIct = (tf: string) => {
    setTfIct(tf);
    try {
      window.localStorage.setItem(CHAVE_ICT, tf);
    } catch {
      /* sem armazenamento */
    }
  };
  const doIct = useMemo(() => simbolos.filter((s) => ICT_ALGO_EM_TESTE.includes(s.toUpperCase())), [simbolos]);
  const doAsia = useMemo(() => simbolos.filter((s) => ASIA_RANGE_EM_TESTE.includes(s.toUpperCase())), [simbolos]);

  return (
    <>
      {doIct.length > 0 && (
        <GrupoAgentes
          titulo="ICT ALGO"
          grupo="ict"
          simbolos={doIct}
          timeframe={tfIct}
          timeframes={TIMEFRAMES_ICT}
          aoEscolherTimeframe={escolherTfIct}
        />
      )}
      {doAsia.length > 0 && <GrupoAgentes titulo="Asia Range Algo" grupo="asia" simbolos={doAsia} timeframe="15m" />}
      <GrupoAgentes
        titulo="Análises básicas"
        grupo="basico"
        simbolos={simbolos}
        timeframe={timeframe}
        aoEscolherTimeframe={escolherTimeframe}
      />
    </>
  );
}

function GrupoAgentes({
  titulo,
  grupo,
  simbolos,
  timeframe,
  timeframes = TIMEFRAMES_RADAR,
  aoEscolherTimeframe,
}: {
  titulo: string;
  grupo: Grupo;
  simbolos: string[];
  timeframe: string;
  /** Os timeframes do seletor; por omissão, os cinco do radar. */
  timeframes?: readonly string[];
  /** Sem isto o grupo tem timeframe fixo (o Asia Range) e não mostra o seletor. */
  aoEscolherTimeframe?: (tf: string) => void;
}) {
  const [resultados, setResultados] = useState<Map<string, Resultado>>(new Map());
  const [estados, setEstados] = useState<Map<string, Estado>>(new Map());
  const [aCorrer, setACorrer] = useState(false);
  const [terminadoEm, setTerminadoEm] = useState<number | null>(null);
  /**
   * Número da varredura em curso. Ao mudar de timeframe começa outra; a antiga
   * vê que já não é a actual e pára — antes continuava e escrevia resultados do
   * timeframe anterior na lista nova (o "ICT ALGO" no separador 4H).
   */
  const geracao = useRef(0);
  /** Último resultado sem erro por símbolo+timeframe. */
  const ultimosBons = useRef(new Map<string, Resultado>());

  const varrer = useCallback(async () => {
    if (simbolos.length === 0) return;
    const minha = ++geracao.current;
    const cancelado = { get current() { return geracao.current !== minha; } };
    setACorrer(true);
    setEstados(new Map(simbolos.map((s) => [s, 'espera' as Estado])));
    setResultados(new Map());

    for (const s of simbolos) {
      if (cancelado.current) break;
      setEstados((m) => new Map(m).set(s, 'corre'));

      const j = await pedirRadar(s, timeframe, grupo, () => cancelado.current);
      if (cancelado.current) break;

      // Uma falha passageira não apaga uma análise boa da passagem anterior.
      const chave = `${s}|${timeframe}|${grupo}`;
      const anterior = ultimosBons.current.get(chave);
      const final = j.erro && anterior ? anterior : j;
      if (!j.erro) ultimosBons.current.set(chave, j);

      setResultados((m) => new Map(m).set(s, final));
      setEstados((m) => new Map(m).set(s, final.erro ? 'falhou' : 'passou'));
    }

    if (!cancelado.current) {
      setACorrer(false);
      setTerminadoEm(Date.now());
    }
  }, [simbolos, timeframe, grupo]);

  useEffect(() => {
    void varrer();
    return () => {
      // Desmontar ou mudar de timeframe invalida a varredura em curso.
      geracao.current++;
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
    }, grupo !== 'basico' ? 180_000 : INTRADIARIO.has(timeframe) ? 120_000 : 300_000);
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
          {titulo}
          <em className="faint">
            {' · '}
            {aoEscolherTimeframe ? '' : `${timeframe.toUpperCase()} · `}
            {aCorrer ? 'a analisar…' : 'concluída'}
          </em>
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

      {aoEscolherTimeframe && (
        <div className="segmentos agentes__tfs" role="radiogroup" aria-label="Timeframe da análise">
          {timeframes.map((tf) => (
            <button key={tf} type="button" aria-pressed={timeframe === tf} onClick={() => aoEscolherTimeframe(tf)}>
              {tf.toUpperCase()}
            </button>
          ))}
        </div>
      )}

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
          . Velas {timeframe} fechadas —{' '}
          {grupo === 'ict'
            ? 'o ICT ALGO, o mesmo que o motor de tempo real usa'
            : grupo === 'asia'
              ? 'o Asia Range Algo, o mesmo que o motor de tempo real usa'
              : 'as mesmas estratégias que o motor de tempo real usa'}
          , repetidas a cada {grupo !== 'basico' ? '3 minutos' : INTRADIARIO.has(timeframe) ? '2 minutos' : '5 minutos'}.
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
  const casas = acharSimbolo(simbolo)?.casas ?? 5;
  const fmt = (v: number) => formatarPreco(v, casas);

  const marca =
    estado === 'corre' ? '◍' : estado === 'falhou' ? '!' : estado === 'passou' ? '✓' : '·';

  const detalhe = (): string => {
    if (estado === 'corre') return 'a analisar…';
    if (estado === 'espera') return 'em fila';
    if (resultado?.erro) return resultado.erro.slice(0, 44);
    if (sinal) {
      const lado = sinal.direccao === 'bullish' ? 'COMPRA' : 'VENDA';
      return `${lado} · ${sinal.rMaximo.toFixed(1)}R${sinal.pendente ? ' · ordem pendente' : ''}`;
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
        {sinal && estado === 'passou' && (
          <em className="agente__detalhe">
            entrada <b>{fmt(sinal.entrada)}</b> · stop <b className="bear-t">{fmt(sinal.stop)}</b>
            {sinal.alvo != null && (
              <>
                {' '}
                · alvo <b className="bull-t">{fmt(sinal.alvo)}</b>
              </>
            )}
          </em>
        )}
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
