'use client';

/**
 * Painel do gráfico: menu de camadas, preço ao vivo e ecrã inteiro.
 *
 * DOIS RELÓGIOS, de propósito:
 *
 *   preço    — sondagem a `/api/preco` de 10 em 10 segundos
 *   análise  — recarregada pelo Server Component, muito mais devagar
 *
 * Antes havia um só, de 60 em 60 segundos, que re-corria a análise completa só
 * para mexer no preço. Daí o atraso face ao TradingView: cada atualização
 * custava 1-2s de trabalho que não era preciso. A estrutura (MMXM, FVG, SMT) só
 * muda quando uma vela FECHA, por isso não ganha nada em ser recalculada ao
 * ritmo do preço.
 *
 * O gráfico e o menu partilham estado, por isso vivem no mesmo componente — a
 * página é um Server Component e não o pode segurar.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PriceChart,
  type PriceBand,
  type PriceChartCandle,
  type PriceLine,
  type PriceMarker,
} from './PriceChart';
import { usarCtrader } from './vivo/usarCtrader';

export interface ChartPanelProps {
  candles: PriceChartCandle[];
  bands: PriceBand[];
  lines: PriceLine[];
  markers: PriceMarker[];
  precision: number;
  title: string;
  /** Símbolo e timeframe, para a sondagem de preço. */
  symbol: string;
  timeframe: string;
  timeframeSwitch?: React.ReactNode;
}

interface Camadas {
  fvg: boolean;
  consolidacao: boolean;
  niveis: boolean;
  marcadores: boolean;
}

/** Intervalo da sondagem de preço. */
const POLL_MS = 10_000;

export function ChartPanel({
  candles,
  bands,
  lines,
  markers,
  precision,
  title,
  symbol,
  timeframe,
  timeframeSwitch,
}: ChartPanelProps) {
  const [camadas, setCamadas] = useState<Camadas>({
    fvg: true,
    consolidacao: true,
    niveis: true,
    marcadores: true,
  });
  const [menuAberto, setMenuAberto] = useState(false);
  const [cheio, setCheio] = useState(false);

  /** Velas com a ponta substituída pelo que a sondagem trouxer. */
  const [velas, setVelas] = useState<PriceChartCandle[]>(candles);
  const [aoVivo, setAoVivo] = useState<{ em: number; fonte: string } | null>(null);
  const [erroPreco, setErroPreco] = useState<string | null>(null);
  const [ligado, setLigado] = useState(true);
  const { posicoes } = usarCtrader();

  // Nova análise do servidor: repõe a base e descarta a ponta antiga.
  useEffect(() => {
    setVelas(candles);
  }, [candles]);

  // Ecrã inteiro automático em computadores (desktop)
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
      setCheio(true);
    }
  }, []);

  const base = useRef(candles);
  base.current = candles;

  const sondar = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/preco/${encodeURIComponent(symbol)}?tf=${encodeURIComponent(timeframe)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const dados = (await res.json()) as {
        velas: PriceChartCandle[];
        fonte: string;
        em: number;
      };
      if (!dados.velas?.length) return;

      /*
       * Fundir por timestamp em vez de acrescentar ao fim. As velas recebidas
       * podem sobrepor-se às que já lá estão (a mesma vela, agora atualizada) ou
       * ser novas. Acrescentar cegamente duplicaria a última a cada sondagem.
       */
      setVelas(() => {
        const porTempo = new Map<number, PriceChartCandle>();
        for (const c of base.current) porTempo.set(c.t, c);
        for (const c of dados.velas) porTempo.set(c.t, c);
        return [...porTempo.values()].sort((a, b) => a.t - b.t);
      });

      setAoVivo({ em: dados.em, fonte: dados.fonte });
      setErroPreco(null);
    } catch (err) {
      setErroPreco(err instanceof Error ? err.message : String(err));
    }
  }, [symbol, timeframe]);

  useEffect(() => {
    if (!ligado) return;
    void sondar();
    const id = setInterval(() => {
      // Separador escondido não gasta quota das APIs públicas.
      if (!document.hidden) void sondar();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [ligado, sondar]);

  // Sair do ecrã inteiro com Escape, como se espera de qualquer overlay.
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

  const alternar = (k: keyof Camadas) => setCamadas((c) => ({ ...c, [k]: !c[k] }));

  const bandsVisiveis = bands.filter((b) => {
    if (b.kind === 'fvg-bull' || b.kind === 'fvg-bear') return camadas.fvg;
    if (b.kind === 'consolidation') return camadas.consolidacao;
    return camadas.niveis;
  });

  const contagem = {
    fvg: bands.filter((b) => b.kind === 'fvg-bull' || b.kind === 'fvg-bear').length,
    consolidacao: bands.filter((b) => b.kind === 'consolidation').length,
    niveis: lines.length,
    marcadores: markers.length,
  };

  const segundosDesde = aoVivo ? Math.round((Date.now() - aoVivo.em) / 1000) : null;

  const conteudo = (
    <>
      <div className="chartpanel__bar">
        {timeframeSwitch}
        <span className="grow" />

        <button
          type="button"
          className={`chartpanel__toggle ${menuAberto ? 'open' : ''}`}
          onClick={() => setMenuAberto((v) => !v)}
          aria-expanded={menuAberto}
          aria-controls="chart-camadas"
        >
          camadas {menuAberto ? '▲' : '▼'}
        </button>

        <button
          type="button"
          className="chartpanel__toggle"
          onClick={() => setCheio((v) => !v)}
          aria-label={cheio ? 'Sair do ecrã inteiro' : 'Ecrã inteiro'}
          title={cheio ? 'Sair do ecrã inteiro (Esc)' : 'Ecrã inteiro'}
        >
          {cheio ? '✕' : '⛶'}
        </button>
      </div>

      {menuAberto && (
        <div className="chartpanel__menu" id="chart-camadas">
          <Camada
            ligado={camadas.fvg}
            onClick={() => alternar('fvg')}
            cor="var(--bull)"
            rotulo="Fair Value Gaps"
            contagem={contagem.fvg}
          />
          <Camada
            ligado={camadas.consolidacao}
            onClick={() => alternar('consolidacao')}
            cor="var(--text-faint)"
            rotulo="Consolidação original"
            contagem={contagem.consolidacao}
          />
          <Camada
            ligado={camadas.niveis}
            onClick={() => alternar('niveis')}
            cor="var(--warn)"
            rotulo="Níveis e zona de entrada"
            contagem={contagem.niveis}
          />
          <Camada
            ligado={camadas.marcadores}
            onClick={() => alternar('marcadores')}
            cor="var(--accent)"
            rotulo="Smart Money Reversal"
            contagem={contagem.marcadores}
          />
        </div>
      )}

      <PriceChart
        candles={velas}
        bands={bandsVisiveis}
        lines={camadas.niveis ? lines : []}
        markers={camadas.marcadores ? markers : []}
        operacoes={posicoes.filter(p => p.simbolo.toUpperCase() === symbol.toUpperCase())}
        precision={precision}
        title={title}
        className={cheio ? 'chart--cheio' : 'chart--normal'}
      />

      <div className="chartpanel__live">
        <span className={ligado && !erroPreco ? 'dot on' : 'dot'} aria-hidden="true" />
        {erroPreco ? (
          <span className="bear-t">preço indisponível — {erroPreco}</span>
        ) : aoVivo ? (
          <span>
            ao vivo · {aoVivo.fonte} · há {segundosDesde}s
          </span>
        ) : (
          <span>a ligar…</span>
        )}
        <span className="grow" />
        <button type="button" onClick={() => setLigado((v) => !v)}>
          {ligado ? 'pausar' : 'retomar'}
        </button>
      </div>
    </>
  );

  if (cheio) {
    return (
      <div className="chartpanel chartpanel--cheio" role="dialog" aria-modal="true" aria-label={title}>
        {conteudo}
      </div>
    );
  }

  return <div className="chartpanel">{conteudo}</div>;
}

function Camada({
  ligado,
  onClick,
  cor,
  rotulo,
  contagem,
}: {
  ligado: boolean;
  onClick: () => void;
  cor: string;
  rotulo: string;
  contagem: number;
}) {
  return (
    <button type="button" className={`camada ${ligado ? 'on' : ''}`} onClick={onClick} aria-pressed={ligado}>
      <i style={{ background: ligado ? cor : 'transparent', borderColor: cor }} />
      <span>{rotulo}</span>
      {contagem > 0 && <em>{contagem}</em>}
    </button>
  );
}
