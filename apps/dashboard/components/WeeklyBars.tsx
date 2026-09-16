/**
 * Gráfico de barras semanal do cartão principal — as barras M S T W T F S do
 * mockup.
 *
 * Cada barra é EMPILHADA em duas partes, como no desenho original: a base em
 * lima e o topo em claro. No mockup isso é decoração; aqui carrega significado —
 * a base é a fração do checklist que já passou e o topo o que falta. Uma barra
 * quase toda lima é um dia em que os setups estavam maduros.
 *
 * Server Component: SVG puro, sem interação.
 */

export interface DiaBarra {
  /** Letra do dia (M, T, W...). */
  label: string;
  /** 0..1 — fração preenchida a lima. */
  valor: number;
  /** Destaque do dia atual. */
  hoje?: boolean;
}

interface Props {
  dias: DiaBarra[];
  height?: number;
}

export function WeeklyBars({ dias, height = 96 }: Props) {
  if (dias.length === 0) return null;

  const W = 300;
  const alturaRotulo = 18;
  const alturaBarra = height - alturaRotulo;
  const passo = W / dias.length;
  // Barras finas e bem espaçadas, como no mockup.
  const largura = Math.min(20, passo * 0.46);
  const raio = largura / 2;

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label="Progresso do checklist por dia da semana"
      style={{ display: 'block' }}
    >
      {dias.map((d, i) => {
        const cx = i * passo + passo / 2;
        const x = cx - largura / 2;
        const preenchido = Math.max(0, Math.min(1, d.valor));
        // A parte lima cresce de baixo para cima.
        const hLima = alturaBarra * preenchido;
        const yLima = alturaBarra - hLima;

        return (
          <g key={i}>
            {/* fundo da barra — o que falta */}
            <rect
              x={x}
              y={0}
              width={largura}
              height={alturaBarra}
              rx={raio}
              fill="var(--on-invert)"
              opacity={d.hoje ? 0.9 : 0.55}
            />
            {/* parte preenchida */}
            {hLima > 1 && (
              <rect x={x} y={yLima} width={largura} height={hLima} rx={raio} fill="var(--accent)" />
            )}
            <text
              x={cx}
              y={height - 4}
              textAnchor="middle"
              fontSize={11}
              fontFamily="var(--mono)"
              fill="var(--on-invert)"
              opacity={d.hoje ? 0.95 : 0.5}
              fontWeight={d.hoje ? 700 : 400}
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
