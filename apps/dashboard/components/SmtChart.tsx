'use client';

/**
 * Gráfico de SMT Divergence — dois mercados correlacionados no mesmo eixo.
 *
 * A DECISÃO CENTRAL: as duas séries são **reindexadas a 100** no início da
 * janela, não desenhadas em preço absoluto com dois eixos verticais.
 *
 * Porquê isto importa: comparar EURUSD (1,16) com o DXY (98) em valor absoluto
 * é impossível num eixo só. A solução habitual nas plataformas de trading é dar
 * um eixo a cada série — e essa é precisamente a forma de mentir com um
 * gráfico. Com duas escalas independentes, deslocar uma delas faz aparecer ou
 * desaparecer qualquer divergência, e quem olha não tem como saber.
 *
 * Reindexar a uma base comum põe ambas no mesmo eixo a medir a mesma coisa —
 * variação relativa desde o início da janela. Uma divergência no gráfico passa
 * a ser uma divergência real.
 *
 * Cores: azul #3987e5 e laranja #d95926, os dois primeiros slots categóricos,
 * validados contra a superfície escura do painel (ΔE 26,8 para daltonismo,
 * alvo ≥8). A identidade nunca depende só da cor — cada linha leva rótulo
 * direto na ponta, além da legenda.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface SmtDivergenceMark {
  /** Índice na série alinhada onde a divergência se formou. */
  index: number;
  /** Índice do swing anterior que serve de comparação. */
  prevIndex: number;
  at: 'high' | 'low';
  direction: 'bullish' | 'bearish';
  description: string;
  strength: number;
}

interface Props {
  times: number[];
  primarySymbol: string;
  referenceSymbol: string;
  correlation: 'positive' | 'inverse';
  /** Valores já reindexados a 100. */
  primary: number[];
  reference: number[];
  /** Preços originais, para o tooltip. */
  primaryRaw: number[];
  referenceRaw: number[];
  marks?: SmtDivergenceMark[];
  height?: number;
}

const PAD = { top: 30, right: 96, bottom: 26, left: 10 };

const SERIES_1 = '#3987e5'; // slot categórico 1 — azul
const SERIES_2 = '#d95926'; // slot categórico 2 — laranja

export function SmtChart({
  times,
  primarySymbol,
  referenceSymbol,
  correlation,
  primary,
  reference,
  primaryRaw,
  referenceRaw,
  marks = [],
  height = 300,
}: Props) {
  const H = height;
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [W, setW] = useState(1000); // default fallback

  useEffect(() => {
    if (!wrapperRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setW(entry.contentRect.width);
        }
      }
    });
    observer.observe(wrapperRef.current);
    return () => observer.disconnect();
  }, []);

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const { min, max } = useMemo(() => {
    const all = [...primary, ...reference].filter(Number.isFinite);
    if (all.length === 0) return { min: 90, max: 110 };
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const pad = (hi - lo) * 0.1 || 1;
    return { min: lo - pad, max: hi + pad };
  }, [primary, reference]);

  const y = useCallback(
    (v: number) => PAD.top + ((max - v) / (max - min)) * plotH,
    [max, min, plotH],
  );
  const step = plotW / Math.max(1, times.length - 1);
  const x = useCallback((i: number) => PAD.left + i * step, [step]);

  const path = useCallback(
    (values: number[]) =>
      values
        .map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
        .join(' '),
    [x, y],
  );

  const onMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const svgX = ((e.clientX - rect.left) / rect.width) * W;
      const i = Math.round((svgX - PAD.left) / step);
      setHover(i >= 0 && i < times.length ? i : null);
    },
    [times.length, step],
  );

  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i <= 3; i++) out.push(min + ((max - min) * i) / 3);
    return out;
  }, [min, max]);

  const lastP = primary[primary.length - 1];
  const lastR = reference[reference.length - 1];

  return (
    <div className="chart-wrap">
      {/* Legenda sempre presente para 2 séries. */}
      <div className="legend">
        <span>
          <i style={{ background: SERIES_1 }} /> {primarySymbol}
        </span>
        <span>
          <i style={{ background: SERIES_2 }} /> {referenceSymbol}
        </span>
        <span className="faint">
          correlação {correlation === 'positive' ? 'positiva' : 'inversa'} · base 100 no início
        </span>
      </div>

      <div className="chart-scroll" ref={wrapperRef} style={{ width: '100%', height: H, overflow: 'hidden' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height="100%"
        role="img"
        aria-label={`Comparação reindexada entre ${primarySymbol} e ${referenceSymbol}, com as divergências marcadas`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        style={{ display: 'block' }}
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--border)"
              strokeWidth={1}
              opacity={0.5}
            />
            <text
              x={W - PAD.right + 7}
              y={y(t) + 3.5}
              fill="var(--text-faint)"
              fontSize={10.5}
              fontFamily="var(--mono)"
            >
              {t.toFixed(1)}
            </text>
          </g>
        ))}

        {/* faixas verticais onde a correlação rachou */}
        {marks.map((m, i) => {
          const x1 = x(Math.min(m.prevIndex, m.index));
          const x2 = x(Math.max(m.prevIndex, m.index));
          /*
           * Divergências próximas empilhavam os rótulos uns por cima dos outros
           * ("SMTSMT ▼SMT ▼"). Só rotula quando há folga desde o anterior; a
           * faixa e a linha continuam lá, por isso não se perde informação.
           */
          // Vazio para i=0, logo o primeiro rótulo aparece sempre.
          const showLabel = marks
            .slice(0, i)
            .every((o) => Math.abs(x(o.index) - x(m.index)) > 54);
          return (
            <g key={`mk${i}`}>
              <rect
                x={x1}
                y={PAD.top}
                width={Math.max(2, x2 - x1)}
                height={plotH}
                fill="var(--warn)"
                opacity={0.1}
              />
              <line
                x1={x(m.index)}
                x2={x(m.index)}
                y1={PAD.top}
                y2={H - PAD.bottom}
                stroke="var(--warn)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                opacity={0.8}
              />
              {showLabel && (
                <text
                  x={x(m.index)}
                  y={PAD.top - 8}
                  fill="var(--warn)"
                  fontSize={10}
                  fontFamily="var(--mono)"
                  fontWeight={700}
                  textAnchor="middle"
                >
                  SMT {m.at === 'high' ? '▲' : '▼'}
                </text>
              )}
            </g>
          );
        })}

        {/* linhas: 2px, anel da superfície onde se cruzam */}
        <path d={path(reference)} fill="none" stroke="var(--surface)" strokeWidth={4} opacity={0.9} />
        <path d={path(reference)} fill="none" stroke={SERIES_2} strokeWidth={2} />
        <path d={path(primary)} fill="none" stroke="var(--surface)" strokeWidth={4} opacity={0.9} />
        <path d={path(primary)} fill="none" stroke={SERIES_1} strokeWidth={2} />

        {/* pontos exatos onde os swings divergiram */}
        {marks.map((m, i) => (
          <g key={`pt${i}`}>
            {[m.prevIndex, m.index].map((idx) => (
              <g key={idx}>
                <circle
                  cx={x(idx)}
                  cy={y(primary[idx] ?? 0)}
                  r={4}
                  fill={SERIES_1}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
                <circle
                  cx={x(idx)}
                  cy={y(reference[idx] ?? 0)}
                  r={4}
                  fill={SERIES_2}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              </g>
            ))}
          </g>
        ))}

        {/* rótulos diretos na ponta — identidade sem depender da legenda */}
        {lastP !== undefined && (
          <text
            x={W - PAD.right + 7}
            y={y(lastP) + 3.5}
            fill={SERIES_1}
            fontSize={11}
            fontFamily="var(--mono)"
            fontWeight={700}
          >
            {primarySymbol}
          </text>
        )}
        {lastR !== undefined && (
          <text
            x={W - PAD.right + 7}
            y={y(lastR) + 3.5}
            fill={SERIES_2}
            fontSize={11}
            fontFamily="var(--mono)"
            fontWeight={700}
          >
            {referenceSymbol}
          </text>
        )}

        {hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={PAD.top}
            y2={H - PAD.bottom}
            stroke="var(--text-faint)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {times.length > 0 &&
          [0, Math.floor(times.length / 2), times.length - 1].map((i) => (
            <text
              key={`t${i}`}
              x={x(i)}
              y={H - 8}
              fill="var(--text-faint)"
              fontSize={10}
              fontFamily="var(--mono)"
              textAnchor={i === 0 ? 'start' : i === times.length - 1 ? 'end' : 'middle'}
            >
              {new Date(times[i]!).toISOString().slice(0, 10)}
            </text>
          ))}
      </svg>
      </div>
      <span className="chart-hint">arraste na horizontal para ver o resto do período</span>

      {hover !== null && (
        <div className="chart-tip" role="status">
          <strong>{new Date(times[hover]!).toISOString().slice(0, 10)}</strong>
          <span style={{ color: SERIES_1 }}>
            {primarySymbol} {primaryRaw[hover]?.toFixed(4)} ({primary[hover]?.toFixed(1)})
          </span>
          <span style={{ color: SERIES_2 }}>
            {referenceSymbol} {referenceRaw[hover]?.toFixed(4)} ({reference[hover]?.toFixed(1)})
          </span>
        </div>
      )}

      {marks.length > 0 && (
        <ul className="smt-list">
          {marks.map((m, i) => (
            <li key={i}>
              <span className={m.direction === 'bullish' ? 'bull-t' : 'bear-t'}>
                {m.at === 'high' ? '▲ topos' : '▼ fundos'}
              </span>{' '}
              <span className="dim">
                {new Date(times[m.index] ?? 0).toISOString().slice(0, 10)} · força{' '}
                {m.strength.toFixed(2)}
              </span>
              <div className="faint">{m.description}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
