'use client';

/**
 * Gráfico de velas ao estilo TradingView, com a estrutura MMXM anotada.
 *
 * Decisões de desenho que valem a pena explicar:
 *
 * - **O gráfico MEDE-SE, não se estica.** Antes desenhava-se num `viewBox` fixo
 *   de 1000×altura e era esticado com `width: 100%`. Isso amarrava o desenho a
 *   um rácio: no telemóvel os rótulos ficavam com 5px reais e no computador a
 *   altura crescia com a largura, pelo que o gráfico nunca preenchia a caixa —
 *   era o "preso" que se via no ecrã grande. Agora 1 unidade do `viewBox` = 1
 *   pixel: o tipo de letra e as margens são constantes em qualquer largura e o
 *   TAMANHO passa a ser decidido pelo CSS, que é onde as regras mobile-first
 *   vivem.
 *
 * - **Menos velas em ecrãs estreitos.** A janela inicial é a que mantém cada
 *   vela com pelo menos ~4,5px. Espremer 180 velas em 320px dava um borrão
 *   cinzento; num telemóvel mostram-se ~60 e o resto alcança-se com um arrasto.
 *
 * - **Eixo X por índice, não por data.** Os mercados não negoceiam ao fim de
 *   semana nem em feriados. Espaçar as velas pelo tempo real abriria buracos
 *   que o olho lê como consolidação — inventando estrutura que não existe.
 *
 * - **Verde/vermelho são semânticos, não categóricos.** Alta e baixa são uma
 *   convenção universal nos mercados; substituí-las por uma paleta categórica
 *   tornaria o gráfico ilegível para quem o vai usar. A identidade nunca depende
 *   só da cor: o corpo da vela e a sua posição dizem o mesmo.
 *
 * - **As anotações são recessivas.** Caixas e bandas ficam a baixa opacidade,
 *   por trás das velas; o preço é o dado, a estrutura é contexto.
 *
 * - **Zoom e pan alteram a JANELA, não a escala vertical.** O eixo de preço
 *   reajusta-se ao que está visível, como no TradingView — é isso que permite
 *   ampliar uma zona e continuar a ver a amplitude real do movimento.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMedida } from './useMedida';

export interface PriceChartCandle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

export interface PriceBand {
  low: number;
  high: number;
  kind: 'fvg-bull' | 'fvg-bear' | 'entry' | 'consolidation';
  label?: string;
  /** Índice a partir do qual a zona EXISTE. */
  fromIndex?: number;
  /** Índice em que deixou de valer. */
  toIndex?: number;
}

export interface PriceLine {
  price: number;
  label: string;
  kind: 'stop' | 'target' | 'draw';
}

export interface PriceMarker {
  index: number;
  price: number;
  label: string;
  kind: 'smr' | 'sweep';
}

interface Props {
  candles: PriceChartCandle[];
  bands?: PriceBand[];
  lines?: PriceLine[];
  markers?: PriceMarker[];
  precision?: number;
  /** Mostrado na legenda, canto superior esquerdo. */
  title?: string;
  /** Classe da caixa. É por aqui que o CSS manda na altura. */
  className?: string;
}

/** Fatia da altura reservada ao volume, ao fundo. */
const VOLUME_RATIO = 0.16;
/** Mínimo de velas visíveis — abaixo disto o zoom deixa de fazer sentido. */
const MIN_VISIBLE = 20;
/** Largura mínima por vela na janela inicial, em pixéis reais. */
const PASSO_MIN = 4.5;
/** Arrasto abaixo disto é um toque, não um pan — senão o crosshair morria ao clicar. */
const LIMIAR_ARRASTE = 4;

export function PriceChart({
  candles,
  bands = [],
  lines = [],
  markers = [],
  precision = 5,
  title,
  className = '',
}: Props) {
  const [caixaRef, { w, h }] = useMedida<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  /** Janela visível. `null` = a automática, calculada a partir da largura. */
  const [view, setView] = useState<{ start: number; end: number } | null>(null);

  /*
   * Repõe a janela só quando a SÉRIE muda (outro símbolo ou timeframe), não
   * quando o comprimento muda. A sondagem de preço acrescenta velas de 10 em 10
   * segundos; reagir ao comprimento desfazia o zoom do utilizador a cada
   * atualização.
   */
  const chaveSerie = candles[0]?.t ?? 0;
  useEffect(() => {
    setView(null);
    setHover(null);
  }, [chaveSerie]);

  const desenhavel = w > 80 && h > 100;

  // --- Geometria em pixéis reais -------------------------------------------
  const compacto = w < 420;
  const fonte = compacto ? 10 : 11;

  /*
   * A goteira do eixo de preço vem do rótulo MAIS LARGO da série inteira, não
   * do da janela visível: se dependesse da janela, cada zoom empurrava o gráfico
   * para os lados.
   */
  const digitos = useMemo(() => {
    let maior = 6;
    for (const c of candles) maior = Math.max(maior, c.h.toFixed(precision).length);
    return maior;
  }, [candles, precision]);

  const eixoW = Math.min(104, Math.max(44, Math.round(digitos * fonte * 0.62) + 14));
  const PAD = useMemo(
    () => ({ top: compacto ? 30 : 34, right: eixoW, bottom: 24, left: 6 }),
    [compacto, eixoW],
  );

  const plotW = Math.max(10, w - PAD.left - PAD.right);
  const alturaUtil = Math.max(40, h - PAD.top - PAD.bottom);
  const volH = alturaUtil * VOLUME_RATIO;
  const plotH = alturaUtil - volH;

  /** Janela por omissão: tantas velas quantas cabem com passo legível. */
  const auto = useMemo(() => {
    const cabem = Math.floor(plotW / PASSO_MIN);
    const n = Math.max(MIN_VISIBLE, Math.min(candles.length, cabem));
    return { start: Math.max(0, candles.length - n), end: candles.length };
  }, [candles.length, plotW]);

  const bruto = view ?? auto;
  const start = Math.max(0, Math.min(bruto.start, Math.max(0, candles.length - MIN_VISIBLE)));
  const end = Math.min(candles.length, Math.max(bruto.end, start + MIN_VISIBLE));
  const visible = useMemo(() => candles.slice(start, end), [candles, start, end]);

  /*
   * A escala vertical acompanha APENAS o que está visível, mas tem de conter
   * também as anotações que caem dentro da janela — um stop desenhado fora do
   * domínio ficaria colado à moldura e transmitiria uma distância errada.
   */
  const { min, max } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of visible) {
      if (c.l < lo) lo = c.l;
      if (c.h > hi) hi = c.h;
    }
    for (const l of lines) {
      if (l.price < lo) lo = l.price;
      if (l.price > hi) hi = l.price;
    }
    for (const b of bands) {
      const from = b.fromIndex ?? 0;
      const to = b.toIndex ?? candles.length;
      if (to < start || from > end) continue; // fora da janela
      if (b.low < lo) lo = b.low;
      if (b.high > hi) hi = b.high;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { min: 0, max: 1 };
    const pad = (hi - lo) * 0.07 || 1;
    return { min: lo - pad, max: hi + pad };
  }, [visible, lines, bands, start, end, candles.length]);

  const maxVol = useMemo(() => Math.max(1, ...visible.map((c) => c.v ?? 0)), [visible]);

  const y = useCallback(
    (price: number) => PAD.top + ((max - price) / (max - min)) * plotH,
    [max, min, plotH, PAD.top],
  );
  const volY = useCallback(
    (v: number) => h - PAD.bottom - (v / maxVol) * volH,
    [maxVol, volH, h, PAD.bottom],
  );

  const step = plotW / Math.max(1, visible.length);
  const bodyW = Math.max(1, Math.min(16, step * 0.68));
  const x = useCallback((i: number) => PAD.left + i * step + step / 2, [step, PAD.left]);

  /** Converte px do ecrã para o índice da vela na janela visível. */
  const indiceEm = useCallback(
    (clientX: number) => {
      const r = svgRef.current?.getBoundingClientRect();
      if (!r) return null;
      // O viewBox está em pixéis, por isso não há conversão de escala a fazer.
      const i = Math.floor((clientX - r.left - PAD.left) / step);
      return i >= 0 && i < visible.length ? i : null;
    },
    [visible.length, step, PAD.left],
  );

  // --- Gestos ---------------------------------------------------------------
  /*
   * Pointer Events em vez de mouse: um só caminho serve rato, dedo e caneta. O
   * `touch-action: pan-y` no SVG entrega-nos o arrasto horizontal e deixa o
   * vertical rolar a página — sem isso, tocar no gráfico prendia o polegar.
   */
  const ponteiros = useRef(new Map<number, number>());
  const arraste = useRef<{ x: number; start: number; end: number; ativo: boolean } | null>(null);
  const pinca = useRef<{ d: number; centro: number; start: number; end: number } | null>(null);

  const aplicarJanela = useCallback(
    (inicio: number, largura: number) => {
      const l = Math.max(MIN_VISIBLE, Math.min(candles.length, largura));
      const s = Math.max(0, Math.min(candles.length - l, inicio));
      setView({ start: s, end: s + l });
    },
    [candles.length],
  );

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    ponteiros.current.set(e.pointerId, e.clientX);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* o browser pode recusar a captura; o gesto continua a funcionar */
    }
    if (ponteiros.current.size === 2) {
      const [a, b] = [...ponteiros.current.values()];
      pinca.current = { d: Math.max(1, Math.abs(a! - b!)), centro: (a! + b!) / 2, start, end };
      arraste.current = null;
    } else {
      arraste.current = { x: e.clientX, start, end, ativo: false };
    }
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (ponteiros.current.has(e.pointerId)) ponteiros.current.set(e.pointerId, e.clientX);

    if (pinca.current && ponteiros.current.size >= 2) {
      const [a, b] = [...ponteiros.current.values()];
      const d = Math.max(1, Math.abs(a! - b!));
      const p = pinca.current;
      const largura = p.end - p.start;
      const nova = Math.round(largura * (p.d / d));
      // A vela sob o centro dos dedos fica quieta enquanto se abre ou fecha.
      const r = svgRef.current?.getBoundingClientRect();
      const frac = r
        ? Math.max(0, Math.min(1, (p.centro - r.left - PAD.left) / plotW))
        : 0.5;
      aplicarJanela(Math.round(p.start + frac * largura - frac * nova), nova);
      return;
    }

    if (arraste.current) {
      const dx = e.clientX - arraste.current.x;
      if (!arraste.current.ativo && Math.abs(dx) < LIMIAR_ARRASTE) {
        if (e.pointerType === 'mouse') setHover(indiceEm(e.clientX));
        return;
      }
      arraste.current.ativo = true;
      const d = arraste.current;
      const largura = d.end - d.start;
      aplicarJanela(d.start + Math.round((-dx * largura) / plotW), largura);
      return;
    }

    // O crosshair é de rato: num toque o dedo tapa exatamente o que apontaria.
    if (e.pointerType === 'mouse') setHover(indiceEm(e.clientX));
  };

  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    ponteiros.current.delete(e.pointerId);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* já libertado */
    }
    if (ponteiros.current.size < 2) pinca.current = null;
    if (ponteiros.current.size === 0) arraste.current = null;
  };

  /*
   * A roda tem de ser ligada à mão: o React regista `wheel` como passivo, por
   * isso um `preventDefault()` dentro de `onWheel` não trava a rolagem da
   * página e o gráfico ampliava enquanto o ecrã fugia por baixo.
   */
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const i = indiceEm(e.clientX);
      if (i === null) return;
      e.preventDefault();
      const ancora = start + i;
      const largura = end - start;
      const nova = Math.round(largura * (e.deltaY > 0 ? 1.18 : 1 / 1.18));
      const razao = (ancora - start) / Math.max(1, largura);
      aplicarJanela(Math.round(ancora - razao * nova), nova);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [indiceEm, start, end, aplicarJanela, desenhavel]);

  const ticks = useMemo(() => {
    const quantos = Math.max(3, Math.min(7, Math.round(plotH / 62)));
    const out: number[] = [];
    for (let i = 0; i <= quantos; i++) out.push(min + ((max - min) * i) / quantos);
    return out;
  }, [min, max, plotH]);

  const fmt = useCallback((v: number) => v.toFixed(precision), [precision]);
  const active = hover !== null ? visible[hover] : null;
  const last = visible[visible.length - 1];

  /** Séries intradiárias precisam da hora; nas diárias ela seria sempre 00:00. */
  const intradiario = useMemo(
    () => candles.some((c) => new Date(c.t).getUTCHours() !== 0),
    [candles],
  );

  const dataLabel = useCallback(
    (ms: number) => {
      const iso = new Date(ms).toISOString();
      return intradiario ? `${iso.slice(5, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
    },
    [intradiario],
  );

  /** Quantos rótulos de data cabem sem se sobreporem. */
  const datas = useMemo(() => {
    if (visible.length === 0) return [];
    const quantos = Math.max(2, Math.min(6, Math.floor(plotW / 108)));
    const out = new Set<number>();
    for (let i = 0; i < quantos; i++) {
      out.add(Math.round((i / (quantos - 1)) * (visible.length - 1)));
    }
    return [...out];
  }, [visible.length, plotW]);

  const janelaCheia = start === 0 && end === candles.length;

  return (
    <div className={`chart-box ${className}`.trim()} ref={caixaRef}>
      {desenhavel && (
        <svg
          ref={svgRef}
          viewBox={`0 0 ${w} ${h}`}
          width="100%"
          height="100%"
          role="img"
          aria-label={`Gráfico de velas${title ? ` de ${title}` : ''} com a estrutura do Market Maker Model anotada`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={() => setHover(null)}
          style={{ display: 'block', touchAction: 'pan-y', cursor: 'crosshair' }}
        >
          {/* grelha recessiva */}
          {ticks.map((t, i) => (
            <line
              key={i}
              x1={PAD.left}
              x2={w - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--border)"
              strokeWidth={1}
              opacity={0.6}
            />
          ))}

          {/* bandas: FVGs, consolidação, zona de entrada */}
          {bands.map((b, i) => {
            const from = Math.max(0, (b.fromIndex ?? 0) - start);
            const to = Math.min(visible.length, (b.toIndex ?? candles.length) - start);
            if (to <= 0 || from >= visible.length) return null;
            const top = y(b.high);
            const alt = Math.max(1, y(b.low) - top);
            const style = BAND_STYLE[b.kind];
            const bx = PAD.left + from * step;
            const bw = Math.max(2, (to - from) * step);
            return (
              <g key={`b${i}`}>
                <rect
                  x={bx}
                  y={top}
                  width={bw}
                  height={alt}
                  fill={style.fill}
                  opacity={style.opacity}
                  stroke={style.stroke}
                  strokeWidth={style.stroke ? 1 : 0}
                  strokeDasharray={style.dash}
                />
                {b.label && bw > 110 && (
                  <text x={bx + 6} y={top + 12} fill={style.text} fontSize={fonte - 1} fontFamily="var(--mono)">
                    {b.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* níveis horizontais */}
          {lines.map((l, i) => {
            const style = LINE_STYLE[l.kind];
            return (
              <g key={`l${i}`}>
                <line
                  x1={PAD.left}
                  x2={w - PAD.right}
                  y1={y(l.price)}
                  y2={y(l.price)}
                  stroke={style.stroke}
                  strokeWidth={1.5}
                  strokeDasharray={style.dash}
                  opacity={0.9}
                />
                <text
                  x={PAD.left + 6}
                  y={y(l.price) - 4}
                  fill={style.stroke}
                  fontSize={fonte - 1}
                  fontFamily="var(--mono)"
                  fontWeight={600}
                >
                  {l.label}
                </text>
              </g>
            );
          })}

          {/* volume */}
          {visible.map((c, i) =>
            c.v ? (
              <rect
                key={`v${i}`}
                x={x(i) - bodyW / 2}
                y={volY(c.v)}
                width={bodyW}
                height={Math.max(0.5, h - PAD.bottom - volY(c.v))}
                fill={c.c >= c.o ? 'var(--bull)' : 'var(--bear)'}
                opacity={0.28}
              />
            ) : null,
          )}

          {/* velas */}
          {visible.map((c, i) => {
            const up = c.c >= c.o;
            const cor = up ? 'var(--bull)' : 'var(--bear)';
            const topo = y(Math.max(c.o, c.c));
            const alt = Math.max(1, y(Math.min(c.o, c.c)) - topo);
            return (
              <g key={i}>
                <line x1={x(i)} x2={x(i)} y1={y(c.h)} y2={y(c.l)} stroke={cor} strokeWidth={1} />
                <rect
                  x={x(i) - bodyW / 2}
                  y={topo}
                  width={bodyW}
                  height={alt}
                  fill={cor}
                  rx={bodyW > 4 ? 1 : 0}
                />
              </g>
            );
          })}

          {/* marcadores SMR */}
          {markers.map((m, i) => {
            const idx = m.index - start;
            if (idx < 0 || idx >= visible.length) return null;
            const style = MARKER_STYLE[m.kind];
            return (
              <g key={`m${i}`}>
                <circle cx={x(idx)} cy={y(m.price)} r={5} fill={style.fill} stroke="var(--surface)" strokeWidth={2} />
                <text
                  x={x(idx) + 9}
                  y={y(m.price) + 3.5}
                  fill={style.fill}
                  fontSize={fonte}
                  fontFamily="var(--mono)"
                  fontWeight={700}
                >
                  {m.label}
                </text>
              </g>
            );
          })}

          {/* linha do último preço */}
          {last && (
            <g>
              <line
                x1={PAD.left}
                x2={w - PAD.right}
                y1={y(last.c)}
                y2={y(last.c)}
                stroke="var(--text-dim)"
                strokeWidth={1}
                strokeDasharray="2 3"
                opacity={0.6}
              />
              {/*
                Etiqueta com FUNDO NEUTRO e moldura semântica. Um retângulo cheio
                de verde/vermelho obrigaria a escrever por cima dele, e nenhuma
                das duas tintas disponíveis passa contraste sobre o verde do tema
                claro. A direção continua a ler-se — pela cor da moldura e pela
                posição da linha.
              */}
              <rect
                x={w - PAD.right + 2}
                y={y(last.c) - 9}
                width={PAD.right - 6}
                height={18}
                fill="var(--surface-3)"
                stroke={last.c >= last.o ? 'var(--bull)' : 'var(--bear)'}
                strokeWidth={1}
                rx={4}
              />
              <text
                x={w - PAD.right + 7}
                y={y(last.c) + 4}
                fill="var(--text)"
                fontSize={fonte}
                fontFamily="var(--mono)"
                fontWeight={700}
              >
                {fmt(last.c)}
              </text>
            </g>
          )}

          {/* eixo de preço */}
          {ticks.map((t, i) => (
            <text
              key={`t${i}`}
              x={w - PAD.right + 7}
              y={y(t) + 3.5}
              fill="var(--text-faint)"
              fontSize={fonte}
              fontFamily="var(--mono)"
            >
              {fmt(t)}
            </text>
          ))}

          {/* crosshair com etiquetas nos dois eixos */}
          {hover !== null && active && (
            <g pointerEvents="none">
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={h - PAD.bottom}
                stroke="var(--text-faint)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <line
                x1={PAD.left}
                x2={w - PAD.right}
                y1={y(active.c)}
                y2={y(active.c)}
                stroke="var(--text-faint)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <rect
                x={w - PAD.right + 2}
                y={y(active.c) - 9}
                width={PAD.right - 6}
                height={18}
                fill="var(--surface-invert)"
                rx={4}
              />
              <text
                x={w - PAD.right + 7}
                y={y(active.c) + 4}
                fill="var(--on-invert)"
                fontSize={fonte}
                fontFamily="var(--mono)"
              >
                {fmt(active.c)}
              </text>
              <rect
                x={Math.max(0, Math.min(w - 96, x(hover) - 48))}
                y={h - PAD.bottom + 3}
                width={96}
                height={18}
                fill="var(--surface-invert)"
                rx={4}
              />
              <text
                x={Math.max(48, Math.min(w - 48, x(hover)))}
                y={h - PAD.bottom + 16}
                fill="var(--on-invert)"
                fontSize={fonte - 1}
                fontFamily="var(--mono)"
                textAnchor="middle"
              >
                {dataLabel(active.t)}
              </text>
            </g>
          )}

          {/* datas no eixo inferior */}
          {datas.map((i) => (
            <text
              key={`d${i}`}
              x={Math.max(PAD.left, Math.min(w - PAD.right, x(i)))}
              y={h - 8}
              fill="var(--text-faint)"
              fontSize={fonte - 1}
              fontFamily="var(--mono)"
              textAnchor={i === 0 ? 'start' : i === visible.length - 1 ? 'end' : 'middle'}
            >
              {visible[i] ? dataLabel(visible[i]!.t) : ''}
            </text>
          ))}

          {/* legenda OHLC, ao estilo TradingView */}
          <g pointerEvents="none">
            <text x={PAD.left + 2} y={14} fill="var(--text)" fontSize={fonte + 1} fontFamily="var(--mono)" fontWeight={700}>
              {title ?? ''}
            </text>
            {(active ?? last) && (
              <text x={PAD.left + 2} y={compacto ? 26 : 28} fontSize={fonte} fontFamily="var(--mono)">
                {(() => {
                  const c = active ?? last!;
                  const col = c.c >= c.o ? 'var(--bull)' : 'var(--bear)';
                  return (
                    <>
                      <tspan fill="var(--text-faint)">A </tspan>
                      <tspan fill={col}>{fmt(c.o)} </tspan>
                      <tspan fill="var(--text-faint)">M </tspan>
                      <tspan fill={col}>{fmt(c.h)} </tspan>
                      <tspan fill="var(--text-faint)">m </tspan>
                      <tspan fill={col}>{fmt(c.l)} </tspan>
                      <tspan fill="var(--text-faint)">F </tspan>
                      <tspan fill={col}>{fmt(c.c)}</tspan>
                    </>
                  );
                })()}
              </text>
            )}
          </g>
        </svg>
      )}

      <div className="chart-controls">
        <span className="faint">
          {visible.length}/{candles.length} velas · roda ou pinça para zoom · arraste para navegar
        </span>
        <span className="grow" />
        {!janelaCheia && (
          <button type="button" onClick={() => setView(null)}>
            repor
          </button>
        )}
      </div>
    </div>
  );
}

const BAND_STYLE: Record<PriceBand['kind'], { fill: string; opacity: number; stroke?: string; dash?: string; text: string }> = {
  'fvg-bull': { fill: 'var(--bull)', opacity: 0.1, text: 'var(--bull)' },
  'fvg-bear': { fill: 'var(--bear)', opacity: 0.1, text: 'var(--bear)' },
  entry: { fill: 'var(--accent)', opacity: 0.16, stroke: 'var(--accent)', dash: '4 3', text: 'var(--accent-strong)' },
  consolidation: { fill: 'var(--text-faint)', opacity: 0.09, stroke: 'var(--text-faint)', dash: '5 4', text: 'var(--text-dim)' },
};

const LINE_STYLE: Record<PriceLine['kind'], { stroke: string; dash: string }> = {
  stop: { stroke: 'var(--bear)', dash: '6 4' },
  target: { stroke: 'var(--bull)', dash: '6 4' },
  draw: { stroke: 'var(--warn)', dash: '2 4' },
};

const MARKER_STYLE: Record<PriceMarker['kind'], { fill: string }> = {
  smr: { fill: 'var(--warn)' },
  sweep: { fill: 'var(--accent-strong)' },
};
