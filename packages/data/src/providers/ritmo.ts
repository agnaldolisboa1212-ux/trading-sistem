/**
 * O travão dos pedidos de velas à Deriv, por ligação.
 *
 * ── O QUE FOI MEDIDO (26/09/2026, endpoint público) ────────────────────────
 *
 *   · o limite de `ticks_history` é POR LIGAÇÃO: 220 pedidos em 6 s
 *     bloquearam uma ligação com "You have reached the rate limit for
 *     ticks_history"; uma ligação nova, aberta logo a seguir, respondia;
 *   · a ligação bloqueada só voltou a responder ao fim de ~54 s;
 *   · 90 pedidos em série em 36 s, 60 pedidos de 3500 velas em 44 s e 30 em
 *     paralelo passaram sem erro.
 *
 * O painel e o motor têm UMA ligação cada, partilhada por todas as rotas e por
 * todos os utilizadores. Com os agentes (todas as séries de todos os
 * instrumentos do portfólio, a cada minuto), os sinais, as abas do ICT e do
 * Asia Range abertas — em mais do que um dispositivo —, uma rajada passava o
 * limite e a ligação ficava quase um minuto a recusar tudo: "Falha a obter as
 * velas". As repetições de cada pedido recusado (1 s, 2,5 s, 5 s) mantinham-na
 * bloqueada.
 *
 * Agora, um balde de fichas: até `rajada` pedidos de seguida, depois
 * `porSegundo`; nunca mais de `maxEmVoo` em voo; o resto espera na fila. Se
 * mesmo assim vier RateLimit, a ligação pára `pausaMs` — sem repetições — e
 * quem pede serve-se da última cópia guardada.
 */

export interface OpcoesRitmo {
  maxEmVoo: number;
  /** Pedidos que podem sair de seguida com o balde cheio. */
  rajada: number;
  /** Ritmo a que o balde se volta a encher. */
  porSegundo: number;
  pausaMs: number;
  /** Quanto um pedido aceita esperar na fila antes de desistir. */
  esperaMaximaMs: number;
  agora?: () => number;
}

export class RitmoPedidos {
  private emVoo = 0;
  private fichas: number;
  private reposto: number;
  private pausaAte = 0;
  private readonly aEspera = new Set<() => void>();
  private readonly agora: () => number;

  constructor(private readonly o: OpcoesRitmo) {
    this.agora = o.agora ?? Date.now;
    this.fichas = o.rajada;
    this.reposto = this.agora();
  }

  /** Instante até ao qual a ligação está parada por um RateLimit (0 se não está). */
  pausadaAte(): number {
    return this.pausaAte > this.agora() ? this.pausaAte : 0;
  }

  /** A Deriv respondeu RateLimit: não enviar nada durante a pausa. */
  bloquear(): void {
    this.pausaAte = Math.max(this.pausaAte, this.agora() + this.o.pausaMs);
  }

  private repor(agora: number): void {
    this.fichas = Math.min(this.o.rajada, this.fichas + ((agora - this.reposto) / 1000) * this.o.porSegundo);
    this.reposto = agora;
  }

  /**
   * Espera a vez de enviar. Devolve a função que liberta o lugar — chamar
   * quando a resposta chega (ou falha). Rejeita, com "RateLimit" na mensagem,
   * se a vez não chegar dentro de `esperaMaximaMs`.
   */
  async vez(): Promise<() => void> {
    const prazo = this.agora() + this.o.esperaMaximaMs;
    for (;;) {
      const agora = this.agora();
      this.repor(agora);
      const semFicha = this.fichas >= 1 ? 0 : Math.ceil(((1 - this.fichas) / this.o.porSegundo) * 1000);
      const falta = Math.max(0, this.pausaAte - agora, semFicha);
      if (falta === 0 && this.emVoo < this.o.maxEmVoo) {
        this.fichas -= 1;
        this.emVoo++;
        let livre = false;
        return () => {
          if (livre) return;
          livre = true;
          this.emVoo--;
          this.acordar();
        };
      }
      if (agora + falta > prazo) {
        throw new Error(
          this.pausaAte > agora
            ? 'RateLimit: ligação à Deriv em pausa depois de um RateLimit'
            : 'RateLimit: fila de pedidos de velas à Deriv cheia',
        );
      }
      await new Promise<void>((resolver) => {
        const acordar = (): void => {
          this.aEspera.delete(acordar);
          clearTimeout(temporizador);
          resolver();
        };
        // À espera de ficha ou do fim da pausa: acorda quando chega a hora. À
        // espera de um lugar em voo: acorda quando um pedido termina (ou, por
        // segurança, ao fim de 1 s).
        const temporizador = setTimeout(acordar, falta > 0 ? falta : 1_000);
        this.aEspera.add(acordar);
      });
    }
  }

  private acordar(): void {
    for (const a of [...this.aEspera]) a();
  }
}
