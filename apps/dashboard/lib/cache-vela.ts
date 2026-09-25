/**
 * Cache em memória até ao fecho da vela seguinte.
 *
 * ── PORQUÊ ─────────────────────────────────────────────────────────────────
 *
 * As análises do painel (radar dos agentes, aba do ICT ALGO) só dependem de
 * velas FECHADAS: numa vela de 15M, o resultado às 10:16 e às 10:29 é o mesmo.
 * Mas a página inicial repete os três grupos de agentes a cada minuto, e a aba
 * do ICT também. Sem cache, cada repetição pedia milhares de velas à Deriv e
 * corria o algoritmo inteiro — 14 de cada 15 vezes para chegar ao mesmo
 * resultado. Isso gastava a quota da Deriv (RateLimit), que é a mesma de que o
 * motor precisa: foi o que atrasou as passagens de tempo real ("MOTOR PARADO")
 * e fez os pedidos do browser desistirem ("Failed to fetch").
 *
 * ── A REGRA QUE IMPEDE UM RESULTADO VELHO ──────────────────────────────────
 *
 * Só se guarda um resultado cuja última vela é a que o relógio diz que já
 * fechou. Logo a seguir ao fecho a Deriv pode ainda não ter publicado a vela
 * nova; um resultado calculado sem ela não fica guardado, e o pedido seguinte
 * volta a calcular.
 *
 * Cada processo do servidor tem a sua cache (o LiteSpeed arranca vários);
 * isso só reduz a poupança, não a correcção.
 */

const PASSOS: Readonly<Record<string, number>> = {
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
};

const memoria = new Map<string, { vela: number; valor: unknown }>();
const MAXIMO = 400;

/** Abertura da última vela que, pelo relógio, já fechou neste timeframe. */
export function velaFechadaAgora(tf: string, agora = Date.now()): number | null {
  const passo = PASSOS[tf];
  if (!passo) return null;
  return Math.floor(agora / passo) * passo - passo;
}

/** O resultado guardado para esta chave, se ainda for da última vela fechada. */
export function lerCacheVela<T>(chave: string, tf: string): T | null {
  const vela = velaFechadaAgora(tf);
  const guardado = memoria.get(chave);
  if (vela === null || !guardado || guardado.vela !== vela) return null;
  return guardado.valor as T;
}

/**
 * Guarda o resultado, mas só se `ultimaVela` (abertura da última vela usada no
 * cálculo) for a última que já fechou. Devolve se guardou.
 */
export function guardarCacheVela(chave: string, tf: string, ultimaVela: number, valor: unknown): boolean {
  const vela = velaFechadaAgora(tf);
  if (vela === null || ultimaVela !== vela) return false;
  if (memoria.size >= MAXIMO) {
    // As entradas mais antigas saem primeiro (o Map guarda a ordem de inserção).
    for (const k of memoria.keys()) {
      memoria.delete(k);
      if (memoria.size < MAXIMO * 0.8) break;
    }
  }
  memoria.set(chave, { vela, valor });
  return true;
}
