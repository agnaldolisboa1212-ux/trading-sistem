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
 * pede-se `/api/radar/<símbolo>`, que carrega as velas das fontes públicas e
 * corre o mesmo `analyzeInstrument` do motor. A linha fica a pulsar enquanto o
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
  /**
   * Qual das duas análises correu.
   *
   * `mmxm` só existe para os 17 instrumentos com pares SMT definidos. Tudo o
   * resto — sintéticos, DAX, Nikkei — vai pelas estratégias institucionais.
   * As duas pontuações NÃO medem a mesma coisa, por isso a linha diz qual é.
   */
  metodo?: 'mmxm' | 'institucional';
  /** Instrumento realmente analisado, quando difere do pedido (US100 -> NQ). */
  analisado?: string;
  pontuacao?: number;
  modelo?: string | null;
  fase?: string | null;
  passoFalhado?: number | null;
  resumo?: string;
  smt?: number;
  /** Só na via institucional: quantas estratégias concordam. */
  concordam?: number;
  direccao?: string;
  sinal?: {
    direccao: string;
    rMaximo: number;
    confianca: number;
    estrategia?: string;
  } | null;
  erro?: string;
}

const ESTRATEGIA_NOME: Record<string, string> = {
  'supply-demand': 'oferta e procura',
  'support-resistance': 'suporte/resistência',
  'vwap-bands': 'bandas de VWAP',
  'volume-profile': 'perfil de volume',
};

type Estado = 'espera' | 'corre' | 'passou' | 'falhou';

/** Em intradiário a vela fecha a cada poucos minutos: repetir mais depressa. */
const INTRADIARIO = new Set(['1m', '5m', '15m', '30m']);

const PASSO_NOME: Record<number, string> = {
  1: 'draw on liquidity',
  2: 'fluxo HTF',
  3: 'point of interest',
  4: 'Time & Price',
  5: 'SMT divergence',
  6: 'CISD / MSS',
  7: 'modelo de entrada',
  8: 'invalidação',
  9: 'alvos',
};

export function PainelAgentes({
  simbolos,
  timeframe = '1d',
}: {
  simbolos: string[];
  timeframe?: string;
}) {
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
    : [...simbolos].sort(
        (a, b) => (resultados.get(b)?.pontuacao ?? -1) - (resultados.get(a)?.pontuacao ?? -1),
      );

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
          . Velas {timeframe} fechadas — repete a cada{' '}
          {INTRADIARIO.has(timeframe) ? 'minuto' : '5 minutos'}.
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
  const pontos = resultado?.pontuacao;
  const temSinal = Boolean(resultado?.sinal);

  const marca =
    estado === 'corre' ? '◍' : estado === 'falhou' ? '!' : estado === 'passou' ? '✓' : '·';

  const detalhe = (): string => {
    if (estado === 'corre') return 'a analisar…';
    if (estado === 'espera') return 'em fila';
    if (resultado?.erro) return resultado.erro.slice(0, 44);

    if (resultado?.sinal) {
      const s = resultado.sinal;
      const lado = s.direccao === 'bullish' ? 'COMPRA' : 'VENDA';
      const via = s.estrategia ? ` · ${ESTRATEGIA_NOME[s.estrategia] ?? s.estrategia}` : '';
      return `${lado} · ${s.rMaximo.toFixed(1)}R${via}`;
    }

    // Via institucional: não há checklist, há concordância entre estratégias.
    if (resultado?.metodo === 'institucional') {
      if (resultado.concordam && resultado.concordam > 0) {
        return `${resultado.concordam} estratégia(s) de acordo · sem plano R≥2`;
      }
      return 'sem zona ativa neste momento';
    }

    if (resultado?.passoFalhado != null) {
      return `passo ${resultado.passoFalhado} · ${PASSO_NOME[resultado.passoFalhado] ?? ''}`;
    }
    // 9/9 passos sem sinal: o resumo do motor diz porquê — quase sempre o R.
    if (resultado?.resumo && /abaixo do minimo|rejeitado/i.test(resultado.resumo)) {
      return '9/9 passos · R abaixo do mínimo';
    }
    return resultado?.fase ?? '—';
  };

  /*
   * Sem MMXM (sintéticos, índices sem par SMT) o destino é o terminal, já nas
   * estratégias institucionais. Com MMXM, a página do instrumento — pelo código
   * da Deriv (US100 e não NQ), para o gráfico ao vivo ser o do mercado escolhido.
   */
  const destino =
    resultado?.metodo === 'institucional'
      ? `/grafico?s=${encodeURIComponent(simbolo)}&tf=${timeframe}`
      : `/instrumento/${encodeURIComponent(simbolo)}?tf=${timeframe}&v=mmxm`;

  return (
    <Link href={destino} className="agente">
      <span
        className={`agente__estado ${temSinal && estado === 'passou' ? 'passou' : estado}`}
        aria-hidden="true"
      >
        {marca}
      </span>
      <span className="agente__nome">
        <strong>{simbolo}</strong>
        <em className="agente__detalhe">{detalhe()}</em>
      </span>
      <span className="agente__valor">
        {pontos != null ? `${Math.round(pontos * 100)}%` : ''}
      </span>
    </Link>
  );
}
