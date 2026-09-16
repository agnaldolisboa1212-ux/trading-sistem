'use client';

/**
 * Ganchos de preço ao vivo.
 *
 * Envolvem `lib/deriv/live.ts` na forma que o React quer: subscrever ao montar,
 * cancelar ao desmontar, e — o detalhe que importa — **não re-renderizar mais
 * do que o necessário**.
 *
 * Um tick por segundo vezes vinte instrumentos na página de mercados são vinte
 * renders por segundo. Cada gancho aqui guarda o valor anterior e só muda o
 * estado quando o preço mudou de facto; a Deriv repete o mesmo `quote` quando
 * nada aconteceu, e re-renderizar por causa disso seria trabalho puro.
 */

import { useEffect, useRef, useState } from 'react';
import {
  agregarSemanal,
  observarLigacao,
  subscreverTicks,
  subscreverVelas,
  type EstadoLigacao,
  type Vela,
} from '@/lib/deriv/live';
import { acharSimbolo, type Timeframe } from '@/lib/deriv/simbolos';

export type Direccao = 'sobe' | 'desce' | null;

export interface PrecoVivo {
  readonly preco: number | null;
  readonly compra: number | null;
  readonly venda: number | null;
  readonly direccao: Direccao;
  /** Muda a cada tick — serve de `key` para relançar a animação. */
  readonly geracao: number;
  readonly em: number | null;
  readonly casas: number;
}

const VAZIO: PrecoVivo = {
  preco: null,
  compra: null,
  venda: null,
  direccao: null,
  geracao: 0,
  em: null,
  casas: 2,
};

/**
 * Preço ao vivo de um símbolo.
 *
 * `activo` permite desligar a subscrição sem violar as regras dos ganchos —
 * necessário na lista de mercados, onde só os cartões visíveis subscrevem.
 */
export function usarPreco(codigo: string, activo = true): PrecoVivo {
  const [estado, setEstado] = useState<PrecoVivo>(VAZIO);
  const anterior = useRef<number | null>(null);

  useEffect(() => {
    const s = acharSimbolo(codigo);
    if (!s || !activo) return;

    anterior.current = null;
    return subscreverTicks(s.deriv, (t) => {
      setEstado((e) => {
        if (anterior.current !== null && t.preco === anterior.current) return e;
        const direccao: Direccao =
          anterior.current === null ? null : t.preco > anterior.current ? 'sobe' : 'desce';
        anterior.current = t.preco;
        return {
          preco: t.preco,
          compra: t.compra,
          venda: t.venda,
          direccao,
          geracao: e.geracao + 1,
          em: t.em,
          casas: t.casas || s.casas,
        };
      });
    });
  }, [codigo, activo]);

  return estado;
}

export interface VelasVivas {
  readonly velas: Vela[];
  readonly actual: Vela | null;
  readonly pronto: boolean;
  readonly direccao: Direccao;
  readonly geracao: number;
}

/**
 * Velas com histórico e a vela em formação.
 *
 * O semanal é agregado no cliente a partir do diário — a Deriv não tem
 * granularidade semanal nativa (`InputValidationFailed`). Agregar aqui em vez
 * de pedir ao servidor mantém o caminho de dados com um só salto.
 */
export function usarVelas(
  codigo: string,
  tf: Timeframe,
  quantidade = 300,
  activo = true,
): VelasVivas {
  const [estado, setEstado] = useState<VelasVivas>({
    velas: [],
    actual: null,
    pronto: false,
    direccao: null,
    geracao: 0,
  });
  const anterior = useRef<number | null>(null);

  useEffect(() => {
    /*
     * Inativo ainda NAO é "sem dados": é "ainda não pedimos".
     *
     * A distinção importa. Uma versão anterior era desligada passando `''` como
     * código, e o ramo de símbolo desconhecido marcava `pronto: true` com a
     * lista vazia — indistinguível de "carregou e não há nada". A lista de
     * mercados desenhava então um travessão e a etiqueta "fechado" em linhas
     * que simplesmente ainda não tinham sido carregadas.
     */
    if (!activo) {
      setEstado((e) => (e.pronto ? e : { ...e, pronto: false }));
      return;
    }

    const s = acharSimbolo(codigo);
    if (!s) {
      setEstado({ velas: [], actual: null, pronto: true, direccao: null, geracao: 0 });
      return;
    }

    anterior.current = null;
    setEstado((e) => ({ ...e, pronto: false }));

    // No semanal pede-se diário e agrega-se: 7x mais velas para o mesmo alcance.
    const pedirTf: Timeframe = tf === '1w' ? '1d' : tf;
    const pedirQtd = tf === '1w' ? Math.min(5000, quantidade * 7) : quantidade;

    return subscreverVelas(s.deriv, pedirTf, pedirQtd, (f) => {
      const velas = tf === '1w' ? agregarSemanal(f.historico) : f.historico;
      const actual = velas[velas.length - 1] ?? null;

      setEstado((e) => {
        const fecho = actual?.c ?? null;
        if (e.pronto && fecho !== null && fecho === anterior.current) {
          // Mesmo preço: mantém o objeto para não re-renderizar o gráfico.
          return e;
        }
        const direccao: Direccao =
          anterior.current === null || fecho === null
            ? null
            : fecho > anterior.current
              ? 'sobe'
              : fecho < anterior.current
                ? 'desce'
                : e.direccao;
        anterior.current = fecho;
        return { velas, actual, pronto: true, direccao, geracao: e.geracao + 1 };
      });
    });
  }, [codigo, tf, quantidade, activo]);

  return estado;
}

/** Estado da ligação partilhada, para o indicador do cabeçalho. */
export function usarLigacao(): EstadoLigacao {
  const [e, setE] = useState<EstadoLigacao>('fechado');
  useEffect(() => observarLigacao(setE), []);
  return e;
}

/**
 * Variação percentual desde a ABERTURA da vela atual.
 *
 * A referência é a abertura da ÚLTIMA vela da série, não a da primeira. Com
 * velas diárias isto dá "quanto mexeu hoje", que é o número que toda a gente
 * espera ao lado de um preço numa lista de mercados.
 *
 * Uma versão anterior usava `velas[0].o` — a abertura da primeira vela da
 * janela. Com as 40 velas que a lista de mercados carrega, isso mostrava a
 * variação de 40 dias com ar de variação diária. E exigia `length >= 2`, pelo
 * que a fita do Início, que só carrega duas velas e passava uma, devolvia
 * sempre `null`: era por isso que aparecia um travessão em vez da percentagem.
 *
 * Não se usa "fecho da vela anterior" de propósito. Ao fim de semana isso
 * compara contra sexta-feira e o número fica congelado dois dias sem o dizer.
 */
export function variacao(velas: Vela[], precoActual: number | null): number | null {
  const ultima = velas[velas.length - 1];
  if (!ultima) return null;
  const base = ultima.o;
  const fim = precoActual ?? ultima.c;
  if (!base || !fim) return null;
  return ((fim - base) / base) * 100;
}
