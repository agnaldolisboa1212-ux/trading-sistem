/**
 * O que aconteceu a um plano de entrada desde que foi anunciado.
 *
 * Função pura (sem imports), partilhada pelo motor (repintagem, avisos de
 * andamento) e pelo painel (lista de sinais, visões do gráfico). Testada em
 * `packages/core/test/estado-plano.test.mjs`.
 *
 *   a-aguardar-entrada  o preço ainda não tocou na entrada
 *   em-curso            tocou na entrada; nem stop nem alvo desde então
 *   alvo-atingido       chegou ao primeiro alvo depois de entrar
 *   stop-atingido       tocou no stop                              → invalidado
 *   perdido             foi ao alvo sem nunca tocar na entrada     → invalidado
 *   expirado            ficou N velas sem tocar na entrada         → invalidado
 *
 * Numa vela que toca o stop e o alvo ao mesmo tempo não se sabe a ordem: conta
 * como stop — é a leitura que não inventa um ganho.
 */

export type EstadoPlano =
  | 'a-aguardar-entrada'
  | 'em-curso'
  | 'alvo-atingido'
  | 'stop-atingido'
  | 'perdido'
  | 'expirado';

export interface VelaMinima {
  /** Abertura da vela, em ms. */
  time: number;
  high: number;
  low: number;
}

export interface Plano {
  direccao: 'bullish' | 'bearish';
  entrada: number;
  stop: number;
  /** Primeiro alvo, se houver. */
  alvo: number | null;
}

/** Velas sem tocar na entrada até o plano deixar de valer. */
export const VELAS_ATE_EXPIRAR = 20;

export function estadoDoPlano(
  plano: Plano,
  /** Só as velas DEPOIS da vela que gerou o sinal, por ordem. */
  velasDepois: readonly VelaMinima[],
  opcoes: { expirarAposVelas?: number } = {},
): EstadoPlano {
  const compra = plano.direccao === 'bullish';
  let entrou = false;

  for (const v of velasDepois) {
    if (!entrou && v.low <= plano.entrada && v.high >= plano.entrada) entrou = true;
    const stop = compra ? v.low <= plano.stop : v.high >= plano.stop;
    if (stop) return 'stop-atingido';
    const chegou = plano.alvo !== null && (compra ? v.high >= plano.alvo : v.low <= plano.alvo);
    if (chegou) return entrou ? 'alvo-atingido' : 'perdido';
  }

  if (entrou) return 'em-curso';
  const limite = opcoes.expirarAposVelas ?? VELAS_ATE_EXPIRAR;
  return velasDepois.length >= limite ? 'expirado' : 'a-aguardar-entrada';
}

export const ROTULO_PLANO: Record<EstadoPlano, string> = {
  'a-aguardar-entrada': 'à espera da entrada',
  'em-curso': 'em curso',
  'alvo-atingido': 'alvo atingido',
  'stop-atingido': 'invalidado · stop',
  perdido: 'invalidado · sem entrada',
  expirado: 'expirado',
};

/** Ainda se pode seguir o plano. */
export function planoVivo(e: EstadoPlano): boolean {
  return e === 'a-aguardar-entrada' || e === 'em-curso';
}

/** Deixou de valer sem dar resultado. */
export function planoInvalidado(e: EstadoPlano): boolean {
  return e === 'stop-atingido' || e === 'perdido' || e === 'expirado';
}
