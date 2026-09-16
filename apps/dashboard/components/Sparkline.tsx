/**
 * Sparkline dos cartões de ativo.
 *
 * Server Component de propósito: é puro SVG sem interação, e mandá-lo para o
 * cliente só acrescentaria JavaScript a um gráfico que nunca muda.
 *
 * Sem eixos, sem grelha, sem rótulos. Um sparkline responde a uma só pergunta —
 * "que forma teve isto?" — e qualquer decoração rouba espaço à linha num
 * cartão que tem 100px de largura.
 */

interface Props {
  values: number[];
  /** Cor da linha. Por omissão segue a direção (subiu/desceu). */
  color?: string;
  width?: number;
  height?: number;
  /** Preenchimento suave por baixo da linha. */
  fill?: boolean;
}

export function Sparkline({ values, color, width = 84, height = 30, fill = true }: Props) {
  const limpos = values.filter((v) => Number.isFinite(v));
  if (limpos.length < 2) {
    return <svg width={width} height={height} aria-hidden="true" />;
  }

  const min = Math.min(...limpos);
  const max = Math.max(...limpos);
  const span = max - min || 1;

  // Margem vertical para a linha não encostar às bordas do cartão.
  const pad = 2;
  const x = (i: number) => (i / (limpos.length - 1)) * width;
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);

  const linha = limpos.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${linha} L${width},${height} L0,${height} Z`;

  const subiu = (limpos.at(-1) ?? 0) >= (limpos[0] ?? 0);
  const cor = color ?? (subiu ? 'var(--bull)' : 'var(--bear)');
  const id = `spark-${Math.abs(hash(limpos.join(',')))}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      {fill && (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={cor} stopOpacity={0.28} />
              <stop offset="100%" stopColor={cor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${id})`} />
        </>
      )}
      <path d={linha} fill="none" stroke={cor} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Hash estável para o id do gradiente — dois sparklines não podem colidir. */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}

/**
 * Forma para o sparkline de um cartão de diagnóstico.
 *
 * PORQUÊ NÃO É PREÇO: o varrimento gravado (`scan_diagnostics` / snapshot) não
 * guarda série de preços — só o resultado do checklist. Desenhar uma curva de
 * preço aqui seria desenhar dados que não existem, e num painel de trading isso
 * é o pior tipo de mentira: parece um gráfico a sério.
 *
 * Esta curva codifica o que EXISTE. A altura final é o progresso do checklist e
 * a inclinação segue a direção do modelo (MMBM sobe, MMSM desce). É
 * determinística: o mesmo diagnóstico dá sempre a mesma forma, por isso a lista
 * não treme entre renderizações nem entre o servidor e o cliente.
 *
 * O rótulo ao lado diz sempre, por extenso, que a percentagem é do checklist —
 * a forma é um resumo visual, não uma segunda fonte de informação.
 */
export function formaDoProgresso(score: number, alta: boolean, pontos = 12): number[] {
  return Array.from({ length: pontos }, (_, i) => {
    const t = pontos > 1 ? i / (pontos - 1) : 0;
    // Rampa monótona: é ela que comunica a direção do modelo.
    const rampa = alta ? 0.45 + 0.55 * t : 1 - 0.55 * t;
    // Ondulação pequena — dá forma à linha sem sugerir picos que não existem.
    const onda = 0.06 * Math.sin(t * Math.PI * 3);
    return Math.max(0.04, rampa + onda) * score * 100;
  });
}
