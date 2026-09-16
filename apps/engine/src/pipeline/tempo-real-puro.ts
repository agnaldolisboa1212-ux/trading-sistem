/**
 * Partes PURAS do motor de tempo real — sem rede, sem ficheiros, sem relógio.
 *
 * Separadas para poderem ser testadas. São exactamente as decisões que, se
 * erradas, produzem os piores defeitos do motor: um sinal anunciado três vezes,
 * um sinal gerado sobre uma vela ainda aberta, uma lista de vigilância vazia.
 */

import type { Candle } from '@trading/core';

/** Granularidades que a Deriv aceita, em segundos, por timeframe. */
export const GRANULARIDADE_S: Readonly<Record<string, number>> = Object.freeze({
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
});

/**
 * Remove a última vela se ainda não fechou.
 *
 * A Deriv devolve a vela em formação no fim do histórico. Uma zona detectada
 * sobre ela desaparece no tick seguinte — e um sinal anunciado sobre ela é um
 * sinal que deixa de existir enquanto a pessoa ainda está a ler a notificação.
 */
export function cortarVelaAberta(
  velas: readonly Candle[],
  granularidadeS: number,
  agora: number,
): Candle[] {
  const ultima = velas[velas.length - 1];
  if (!ultima) return [];
  return agora < ultima.time + granularidadeS * 1000 ? velas.slice(0, -1) : [...velas];
}

/**
 * O mercado parou? (fim de semana, bolsa fechada, feriado)
 *
 * Mede a distância entre o FECHO da última vela e agora. Mais de três velas de
 * silêncio num instrumento que não negoceia 24/7 quer dizer que o histórico
 * acabou há bocado — e um sinal sobre ele seria sobre sexta-feira, anunciado
 * como se fosse de agora.
 */
export function mercadoParado(
  ultimaAbertura: number,
  granularidadeS: number,
  agora: number,
  continuo: boolean,
): boolean {
  if (continuo) return false;
  const fecho = ultimaAbertura + granularidadeS * 1000;
  return agora - fecho > granularidadeS * 1000 * 3;
}

/** Lê `INTRADAY_TIMEFRAMES`, descartando o que a Deriv não aceita. */
export function lerTimeframes(bruto: string | undefined, omissao: readonly string[]): string[] {
  const lista = (bruto ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t in GRANULARIDADE_S);
  const unicos = [...new Set(lista)];
  return unicos.length > 0 ? unicos : [...omissao];
}

/**
 * Identificador determinístico de um sinal.
 *
 * A mesma estratégia, no mesmo símbolo, timeframe e sentido, na MESMA vela, dá
 * sempre o mesmo id. O motor corre de 5 em 5 minutos; numa vela de 15 minutos
 * vê o mesmo setup três vezes. É este id que faz as três passagens contarem
 * como uma.
 */
export function idSinal(p: {
  estrategia: string;
  simbolo: string;
  timeframe: string;
  direccao: string;
  geradoEm: number;
}): string {
  return [p.estrategia, p.simbolo, p.timeframe, p.direccao, new Date(p.geradoEm).toISOString()].join(
    '|',
  );
}

export type OrigemVigilancia = 'env' | 'perfis' | 'omissao';

/**
 * Que instrumentos vigiar, por ordem de preferência:
 *
 *   1. `INTRADAY_SYMBOLS` no .env — escolha explícita de quem opera o servidor
 *   2. a união do que os utilizadores escolheram no onboarding
 *   3. uma lista por omissão
 *
 * Códigos que a Deriv não conhece são devolvidos à parte, para o relatório os
 * mostrar em vez de os deixar desaparecer.
 */
export function escolherVigilancia(input: {
  env: readonly string[];
  perfis: ReadonlyArray<readonly string[]>;
  omissao: readonly string[];
  conhecido: (codigo: string) => string | null;
}): { simbolos: string[]; origem: OrigemVigilancia; ignorados: string[] } {
  const resolver = (lista: readonly string[]) => {
    const ok: string[] = [];
    const ignorados: string[] = [];
    for (const bruto of lista) {
      const c = bruto.trim().toUpperCase();
      if (!c) continue;
      const r = input.conhecido(c);
      if (r) {
        if (!ok.includes(r)) ok.push(r);
      } else if (!ignorados.includes(c)) {
        ignorados.push(c);
      }
    }
    return { ok, ignorados };
  };

  if (input.env.length > 0) {
    const r = resolver(input.env);
    if (r.ok.length > 0) return { simbolos: r.ok, origem: 'env', ignorados: r.ignorados };
  }

  const dosPerfis = input.perfis.flat();
  if (dosPerfis.length > 0) {
    const r = resolver(dosPerfis);
    if (r.ok.length > 0) return { simbolos: r.ok, origem: 'perfis', ignorados: r.ignorados };
  }

  const r = resolver(input.omissao);
  return { simbolos: r.ok, origem: 'omissao', ignorados: r.ignorados };
}

export interface Candidato {
  estrategia: string;
  direccao: 'bullish' | 'bearish';
  conviccao: number;
}

/**
 * Um sinal por símbolo e timeframe — ou nenhum, se as estratégias discordarem.
 *
 * Quatro estratégias sobre a mesma vela podem disparar juntas. Anunciar as
 * quatro seria quatro notificações para o mesmo movimento. Escolhe-se a de
 * maior convicção e diz-se quantas concordam.
 *
 * Se apontarem para lados opostos, não se anuncia nada. As quatro são
 * transformações dos mesmos dados OHLC: votar por maioria entre medidas
 * correlacionadas fabrica convicção onde há ruído (ver `assessConfluence`).
 */
export function escolherPorConfluencia<T extends Candidato>(
  sinais: readonly T[],
): { escolhido: T | null; concordam: number; conflito: boolean } {
  if (sinais.length === 0) return { escolhido: null, concordam: 0, conflito: false };

  const altas = sinais.filter((s) => s.direccao === 'bullish');
  const baixas = sinais.filter((s) => s.direccao === 'bearish');
  if (altas.length > 0 && baixas.length > 0) {
    return { escolhido: null, concordam: 0, conflito: true };
  }

  const lado = altas.length > 0 ? altas : baixas;
  const escolhido = [...lado].sort((a, b) => b.conviccao - a.conviccao)[0] ?? null;
  return { escolhido, concordam: new Set(lado.map((s) => s.estrategia)).size, conflito: false };
}
