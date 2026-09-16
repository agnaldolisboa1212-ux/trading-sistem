'use client';

/**
 * Preço que reage ao tick.
 *
 * Três detalhes que fazem toda a diferença e que um mockup nunca mostra:
 *
 *   1. **Largura fixa.** `tabular-nums` no CSS impede que a linha estremeça
 *      quando `1.16124` passa a `1.16999`.
 *   2. **A animação relança.** Uma classe CSS re-aplicada não reinicia uma
 *      animação já terminada. Por isso a `key` do `<span>` inclui a geração do
 *      tick: o React troca o nó e o browser recomeça a animação do zero.
 *   3. **Não pisca à primeira.** Sem preço anterior não há direção, e um flash
 *      verde no primeiro valor sugeriria uma subida que ninguém viu.
 */

import { formatarPreco } from '@/lib/deriv/simbolos';
import { usarLigacao, usarPreco, type Direccao } from './usarPreco';

export function Preco({
  codigo,
  casas,
  inicial,
  classe = '',
  activo = true,
}: {
  codigo: string;
  casas: number;
  /** Valor a mostrar enquanto o primeiro tick não chega. */
  inicial?: number | null;
  classe?: string;
  activo?: boolean;
}) {
  const p = usarPreco(codigo, activo);
  const valor = p.preco ?? inicial ?? null;

  if (valor === null) {
    return <span className={`preco ${classe}`} aria-busy="true">—</span>;
  }

  return (
    <span
      key={p.geracao}
      className={`preco ${classe} ${p.direccao ? `preco--${p.direccao}` : ''}`}
      // O leitor de ecrã não deve anunciar cada tick — seria impossível de usar.
      aria-live="off"
    >
      {formatarPreco(valor, p.casas || casas)}
    </span>
  );
}

/** Variação percentual, com sinal e cor. */
export function Variacao({ pct, tamanho = 12 }: { pct: number | null; tamanho?: number }) {
  if (pct === null || !Number.isFinite(pct)) {
    return (
      <span className="ticker__var faint" style={{ fontSize: tamanho }}>
        —
      </span>
    );
  }
  const positiva = pct >= 0;
  return (
    <span
      className={`ticker__var ${positiva ? 'bull-t' : 'bear-t'}`}
      style={{ fontSize: tamanho }}
    >
      {positiva ? '+' : ''}
      {pct.toFixed(2)}%
    </span>
  );
}

/**
 * Indicador de ligação ao fluxo de mercado.
 *
 * Distingue quatro estados em vez do booleano de antes. "A ligar" e "caído"
 * pedem coisas diferentes de quem está a olhar: o primeiro é esperar, o segundo
 * é verificar a rede.
 */
export function Ligacao({ rotulo = true }: { rotulo?: boolean }) {
  const estado = usarLigacao();

  const texto: Record<string, string> = {
    ligado: 'ao vivo',
    'a-ligar': 'a ligar…',
    caido: 'sem ligação',
    fechado: 'em pausa',
  };

  const classe: Record<string, string> = {
    ligado: 'ligado',
    'a-ligar': 'a-ligar',
    caido: 'caido',
    fechado: '',
  };

  return (
    <span className="ligacao" title={`Fluxo de mercado: ${texto[estado]}`}>
      <span className={`ligacao__ponto ${classe[estado]}`} aria-hidden="true" />
      {rotulo && texto[estado]}
    </span>
  );
}

/** Classe de animação para a linha inteira de uma lista. */
export function classeLinha(direccao: Direccao, geracao: number): string {
  return direccao ? `linha--${direccao} g${geracao % 2}` : '';
}
