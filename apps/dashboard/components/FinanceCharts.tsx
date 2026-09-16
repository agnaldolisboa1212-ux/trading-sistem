'use client';

/**
 * Gráficos do financeiro: curva de capital e distribuição de resultados.
 *
 * A distribuição de R é a mais informativa das duas e quase nunca aparece nos
 * painéis de trading. Uma estratégia com alvos de 5R–10R vive da CAUDA: a maior
 * parte das operações perde 1R e um punhado paga tudo. Um número de "lucro
 * total" esconde isso; um histograma mostra-o de imediato — e mostra também
 * quando o lucro todo vem de uma barra só, que é exatamente o caso deste
 * sistema no backtest.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

const SERIES = '#3987e5';

// ---------------------------------------------------------------------------
// Curva de capital
// ---------------------------------------------------------------------------

export interface EquityPoint {
  t: number;
  balance: number;
  openRisk: number;
}

const W = 1000;
const PAD = { top: 16, right: 74, bottom: 26, left: 10 };

export function EquityChart({ points, height = 220 }: { points: EquityPoint[]; height?: number }) {
  const H = height;
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const { min, max } = useMemo(() => {
    const vals = points.map((p) => p.balance).filter(Number.isFinite);
    if (vals.length === 0) return { min: 0, max: 1 };
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = (hi - lo) * 0.12 || Math.max(1, hi * 0.02);
    return { min: lo - pad, max: hi + pad };
  }, [points]);

  const y = useCallback((v: number) => PAD.top + ((max - v) / (max - min)) * plotH, [max, min, plotH]);
  const step = plotW / Math.max(1, points.length - 1);
  const x = useCallback((i: number) => PAD.left + i * step, [step]);

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${(H - PAD.bottom).toFixed(1)} L${x(0).toFixed(1)},${(H - PAD.bottom).toFixed(1)} Z`;

  const onMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const svgX = ((e.clientX - rect.left) / rect.width) * W;
      const i = Math.round((svgX - PAD.left) / step);
      setHover(i >= 0 && i < points.length ? i : null);
    },
    [points.length, step],
  );

  if (points.length < 2) {
    return (
      <div className="empty">
        Ainda não há snapshots suficientes para desenhar a curva. Cada varrimento grava um ponto.
      </div>
    );
  }

  const active = hover !== null ? points[hover] : null;
  const ticks = [min, (min + max) / 2, max];

  return (
    <div className="chart-wrap">
      <div className="chart-scroll">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          role="img"
          aria-label="Curva de capital ao longo do tempo"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          style={{ display: 'block', height: 'auto' }}
        >
          <defs>
            <linearGradient id="eqfill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES} stopOpacity={0.28} />
              <stop offset="100%" stopColor={SERIES} stopOpacity={0} />
            </linearGradient>
          </defs>

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
                {t.toFixed(0)}
              </text>
            </g>
          ))}

          <path d={area} fill="url(#eqfill)" />
          <path d={line} fill="none" stroke={SERIES} strokeWidth={2} />

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

          {[0, points.length - 1].map((i) => (
            <text
              key={i}
              x={x(i)}
              y={H - 8}
              fill="var(--text-faint)"
              fontSize={10}
              fontFamily="var(--mono)"
              textAnchor={i === 0 ? 'start' : 'end'}
            >
              {new Date(points[i]!.t).toISOString().slice(0, 10)}
            </text>
          ))}
        </svg>
      </div>

      {active && (
        <div className="chart-tip" role="status">
          <strong>{new Date(active.t).toISOString().slice(0, 10)}</strong>
          <span>saldo {active.balance.toFixed(2)}</span>
          <span>risco aberto {active.openRisk.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Distribuição de resultados em R
// ---------------------------------------------------------------------------

export function RDistribution({ values, height = 200 }: { values: number[]; height?: number }) {
  const H = height;

  const bins = useMemo(() => {
    if (values.length === 0) return [];
    /*
     * Escalões de 1R, com os extremos agrupados. Escalões de largura fixa em R
     * (e não em dinheiro) são o que torna a cauda visível: um vencedor de 8R
     * aparece a 8 escalões de distância do grupo dos perdedores, por muito
     * pequena que tenha sido a posição.
     */
    const lo = Math.floor(Math.min(...values));
    const hi = Math.ceil(Math.max(...values));
    const out: Array<{ from: number; to: number; count: number }> = [];
    for (let b = lo; b < hi; b++) {
      out.push({
        from: b,
        to: b + 1,
        count: values.filter((v) => v >= b && v < b + 1).length,
      });
    }
    // O valor máximo cai fora de qualquer escalão semiaberto; junta-se ao último.
    const last = out[out.length - 1];
    if (last) last.count += values.filter((v) => v >= hi).length;
    return out;
  }, [values]);

  if (bins.length === 0) {
    return <div className="empty">Nenhuma operação fechada ainda.</div>;
  }

  const maxCount = Math.max(...bins.map((b) => b.count), 1);
  const plotW = W - 20;
  const plotH = H - 40;
  const bw = plotW / bins.length;

  return (
    <div className="chart-wrap">
      <div className="chart-scroll">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          role="img"
          aria-label="Distribuição dos resultados por operação, em múltiplos de R"
          style={{ display: 'block', height: 'auto' }}
        >
          <line
            x1={10}
            x2={W - 10}
            y1={H - 30}
            y2={H - 30}
            stroke="var(--border)"
            strokeWidth={1}
          />

          {bins.map((b, i) => {
            const h = (b.count / maxCount) * plotH;
            const bx = 10 + i * bw;
            // Verde/vermelho conforme o escalão é ganho ou perda: a leitura
            // "quantas perdas contra quantos ganhos" tem de ser imediata.
            const color = b.from >= 0 ? 'var(--bull)' : 'var(--bear)';
            return (
              <g key={i}>
                <rect
                  x={bx + 1}
                  y={H - 30 - h}
                  width={Math.max(1, bw - 2)}
                  height={h}
                  fill={color}
                  opacity={b.count > 0 ? 0.85 : 0}
                  rx={3}
                />
                {b.count > 0 && (
                  <text
                    x={bx + bw / 2}
                    y={H - 34 - h}
                    fill="var(--text-dim)"
                    fontSize={11}
                    fontFamily="var(--mono)"
                    textAnchor="middle"
                  >
                    {b.count}
                  </text>
                )}
                <text
                  x={bx + bw / 2}
                  y={H - 14}
                  fill="var(--text-faint)"
                  fontSize={10}
                  fontFamily="var(--mono)"
                  textAnchor="middle"
                >
                  {b.from >= 0 ? `+${b.from}` : b.from}R
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
