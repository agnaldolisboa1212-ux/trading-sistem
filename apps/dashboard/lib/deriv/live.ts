/**
 * Fluxo de mercado ao vivo — ligacao direta do BROWSER a Deriv.
 *
 * ISTO E A CORRECAO DO ATRASO DO GRAFICO.
 *
 * A versao anterior sondava `/api/preco` de 10 em 10 segundos. Cada sondagem
 * era: browser -> Next -> provider -> Deriv -> volta. Mesmo rapida, o preco
 * mostrado tinha em media 5 segundos de atraso e no pior caso 10 — e era isso
 * que se via ao comparar com o TradingView lado a lado.
 *
 * Aqui o browser liga-se DIRETAMENTE ao WebSocket publico da Deriv. Medido:
 *
 *   {ticks_history, style:'candles', granularity:60, subscribe:1}
 *      -> uma mensagem `ohlc` POR SEGUNDO com a vela em formacao
 *   {ticks, subscribe:1}
 *      -> um tick por segundo (dois, nos sinteticos `1s`)
 *
 * Nao ha servidor no meio, por isso nao ha atraso de servidor. E o endpoint e
 * PUBLICO — verificado: `balance` responde `AuthorizationRequired`, `candles`
 * responde com dados. Nenhum token do utilizador chega ao browser.
 *
 * DESENHO: uma unica ligacao partilhada por toda a aplicacao. Vinte cartoes de
 * preco na pagina de mercados abririam vinte sockets se cada componente abrisse
 * o seu; aqui abrem uma so e multiplexam por `req_id` e por `subscription.id`.
 */

'use client';

import { granularidadeDe, type Timeframe } from './simbolos';

/** Endpoint publico da API nova. Sem token, sem OTP. */
const URL_PUBLICA = 'wss://api.derivws.com/trading/v1/options/ws/public';

export interface Tick {
  readonly simbolo: string;
  /** Milissegundos. */
  readonly em: number;
  readonly compra: number;
  readonly venda: number;
  readonly preco: number;
  readonly casas: number;
}

export interface Vela {
  /** Inicio da vela, em milissegundos. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export type EstadoLigacao = 'a-ligar' | 'ligado' | 'caido' | 'fechado';

type Ouvinte = (m: Registo) => void;
type Registo = Record<string, unknown>;

interface Subscricao {
  /** Id devolvido pela Deriv, necessario para `forget`. */
  id: string | null;
  ouvintes: Set<Ouvinte>;
  /** Pedido original, para repetir depois de uma reconexao. */
  pedido: Registo;
  /**
   * Remocao agendada, quando o ultimo ouvinte sai.
   *
   * Ver `subscrever`: a subscricao sobrevive alguns segundos sem ouvintes para
   * aguentar o ciclo montar-desmontar-montar do React em modo estrito e a
   * navegacao entre paginas que partilham simbolos.
   */
  remocao: ReturnType<typeof setTimeout> | null;
  /**
   * Ultima mensagem recebida nesta chave.
   *
   * Existe para quem se inscreve TARDE. Dois componentes podem querer o mesmo
   * simbolo — a fita do Inicio e a lista de mercados, por exemplo — e o segundo
   * partilha o fluxo em vez de abrir outro. Sem esta copia, esse segundo
   * componente ficava em branco ate a Deriv mandar a mensagem seguinte; num
   * mercado fechado, que nao manda nenhuma, ficava em branco para sempre.
   */
  ultima: Registo | null;
}

/**
 * Cliente partilhado.
 *
 * Reconecta com recuo exponencial e **repete as subscricoes** que estavam
 * ativas. Sem essa repeticao, uma quebra de rede de dois segundos deixaria os
 * graficos congelados para sempre sem nenhum erro visivel — o pior modo de
 * falha possivel num painel de precos.
 */
class ClienteDeriv {
  private ws: WebSocket | null = null;
  private aLigar: Promise<WebSocket> | null = null;
  private proximoId = 1;
  private tentativa = 0;

  private readonly pendentes = new Map<number, (m: Registo) => void>();
  /** Chave logica -> subscricao. A chave e estavel entre reconexoes. */
  private readonly subs = new Map<string, Subscricao>();
  private readonly estadoOuvintes = new Set<(e: EstadoLigacao) => void>();

  private estadoActual: EstadoLigacao = 'fechado';

  get estado(): EstadoLigacao {
    return this.estadoActual;
  }

  observarEstado(fn: (e: EstadoLigacao) => void): () => void {
    this.estadoOuvintes.add(fn);
    fn(this.estadoActual);
    return () => this.estadoOuvintes.delete(fn);
  }

  private mudarEstado(e: EstadoLigacao): void {
    if (this.estadoActual === e) return;
    this.estadoActual = e;
    for (const fn of this.estadoOuvintes) fn(e);
  }

  private async socket(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return this.ws;
    if (this.aLigar) return this.aLigar;

    this.mudarEstado('a-ligar');
    this.aLigar = new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(URL_PUBLICA);
      const limite = setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* ja fechado */
        }
        reject(new Error('timeout a ligar a Deriv'));
      }, 15_000);

      ws.onopen = () => {
        clearTimeout(limite);
        this.ws = ws;
        this.tentativa = 0;
        this.mudarEstado('ligado');
        void this.repetirSubscricoes();
        resolve(ws);
      };

      ws.onmessage = (ev) => this.receber(ev);

      ws.onerror = () => {
        clearTimeout(limite);
        reject(new Error('erro de socket'));
      };

      ws.onclose = () => {
        clearTimeout(limite);
        this.ws = null;
        for (const [, resolver] of this.pendentes) resolver({ error: { code: 'Fechado' } });
        this.pendentes.clear();
        // Os ids da Deriv morrem com a ligacao; os ouvintes sobrevivem.
        for (const s of this.subs.values()) s.id = null;
        this.mudarEstado('caido');
        this.reagendar();
      };
    }).finally(() => {
      this.aLigar = null;
    });

    return this.aLigar;
  }

  /** Recuo exponencial com tecto de 15s, so se ainda houver quem esteja a ouvir. */
  private reagendar(): void {
    if (this.subs.size === 0) {
      this.mudarEstado('fechado');
      return;
    }
    const espera = Math.min(15_000, 500 * 2 ** this.tentativa++);
    setTimeout(() => {
      if (this.subs.size > 0) void this.socket().catch(() => undefined);
    }, espera);
  }

  private receber(ev: MessageEvent): void {
    let m: Registo;
    try {
      m = JSON.parse(String(ev.data)) as Registo;
    } catch {
      return;
    }

    const reqId = Number(m['req_id']);
    const resolver = this.pendentes.get(reqId);
    if (resolver) {
      this.pendentes.delete(reqId);
      resolver(m);
      // Uma resposta de subscricao e tambem o primeiro valor: segue para os
      // ouvintes a seguir, em vez de ser consumida so pelo `await`.
    }

    // Encaminha por id de subscricao.
    const sub = m['subscription'] as { id?: string } | undefined;
    const idSub = sub?.id ?? (m['tick'] as { id?: string } | undefined)?.id ??
      (m['ohlc'] as { id?: string } | undefined)?.id;
    if (!idSub) return;

    for (const s of this.subs.values()) {
      if (s.id === idSub) {
        s.ultima = m;
        for (const fn of s.ouvintes) fn(m);
        return;
      }
    }
  }

  private async enviar(pedido: Registo, timeoutMs = 20_000): Promise<Registo> {
    const ws = await this.socket();
    const id = this.proximoId++;
    return new Promise<Registo>((resolve) => {
      const limite = setTimeout(() => {
        this.pendentes.delete(id);
        resolve({ error: { code: 'Timeout', message: `sem resposta em ${timeoutMs}ms` } });
      }, timeoutMs);
      this.pendentes.set(id, (m) => {
        clearTimeout(limite);
        resolve(m);
      });
      ws.send(JSON.stringify({ ...pedido, req_id: id }));
    });
  }

  private async repetirSubscricoes(): Promise<void> {
    for (const [chave, s] of this.subs) {
      if (s.id !== null || s.ouvintes.size === 0) continue;
      const r = await this.enviar(s.pedido);
      const novo =
        (r['subscription'] as { id?: string } | undefined)?.id ??
        (r['tick'] as { id?: string } | undefined)?.id ??
        (r['ohlc'] as { id?: string } | undefined)?.id ??
        null;
      const actual = this.subs.get(chave);
      if (actual) {
        actual.id = novo;
        actual.ultima = r;
        for (const fn of actual.ouvintes) fn(r);
      }
    }
  }

  /**
   * Pedido unico, sem subscricao — com uma repeticao se a ligacao cair.
   *
   * ── PORQUE A REPETICAO E OBRIGATORIA AQUI ─────────────────────────────────
   *
   * `repetirSubscricoes` trata das SUBSCRICOES depois de uma reconexao. Nao
   * trata destes pedidos: quando o socket fecha a meio, `onclose` resolve tudo
   * o que estava pendente com `{error:{code:'Fechado'}}` e o chamador fica com
   * uma resposta vazia para sempre.
   *
   * Isso era visivel: a fita de precos do Inicio faz dez pedidos de historico
   * ao mesmo tempo, e bastava UM `AlreadySubscribed` — que reinicia o socket de
   * proposito — para os dez voltarem vazios. Os mercados fechados, que so tem o
   * historico para mostrar, ficavam todos com um travessao.
   *
   * Uma repeticao chega: a segunda corre ja sobre a ligacao nova.
   */
  async pedir(pedido: Registo): Promise<Registo> {
    const r = await this.enviar(pedido);
    const codigo = (r['error'] as { code?: string } | undefined)?.code;
    if (codigo !== 'Fechado' && codigo !== 'Timeout') return r;

    // Pequena pausa para o socket novo assentar antes de repetir.
    await new Promise((res) => setTimeout(res, 400));
    return this.enviar(pedido);
  }

  /**
   * Subscreve e devolve a funcao de cancelamento.
   *
   * Varios componentes podem subscrever a MESMA chave: partilham o fluxo e so o
   * ultimo a sair e que envia `forget` a Deriv.
   */
  subscrever(chave: string, pedido: Registo, ouvinte: Ouvinte): () => void {
    let s = this.subs.get(chave);
    if (!s) {
      s = { id: null, ouvintes: new Set(), pedido, ultima: null, remocao: null };
      this.subs.set(chave, s);
      void this.enviar(pedido).then((r) => {
        const actual = this.subs.get(chave);
        if (!actual) return;
        actual.id =
          (r['subscription'] as { id?: string } | undefined)?.id ??
          (r['tick'] as { id?: string } | undefined)?.id ??
          (r['ohlc'] as { id?: string } | undefined)?.id ??
          null;
        /*
         * `AlreadySubscribed` significa que a Deriv ainda tem viva uma
         * subscricao que este cliente ja perdeu de vista — o `id` perdeu-se
         * numa corrida e nunca chegou a haver por onde lhe mandar `forget`.
         * Sem recuperacao, aquele simbolo fica mudo para sempre nesta ligacao.
         *
         * A saida limpa e reiniciar o socket: a Deriv esquece tudo o que estava
         * ligado a ele, e `repetirSubscricoes` volta a pedir o que ainda tem
         * ouvintes. Custa um handshake e resolve a classe inteira de problema,
         * em vez de tentar adivinhar que `forget` enviar.
         */
        const codigo = (r['error'] as { code?: string } | undefined)?.code;
        if (codigo === 'AlreadySubscribed') {
          try {
            this.ws?.close();
          } catch {
            /* ja fechado */
          }
          return;
        }

        actual.ultima = r;
        for (const fn of actual.ouvintes) fn(r);

        // O `id` pode chegar DEPOIS de o ultimo ouvinte ter saido. Sem isto,
        // ficaria uma subscricao viva na Deriv que ninguem consome e que faz o
        // proximo pedido igual falhar com `AlreadySubscribed`.
        if (actual.ouvintes.size === 0 && actual.remocao === null) {
          this.subs.delete(chave);
          this.esquecer(actual.id);
        }
      });
    }
    // Se estava marcada para morrer, salva-a: chegou alguem novo.
    if (s.remocao) {
      clearTimeout(s.remocao);
      s.remocao = null;
    }
    s.ouvintes.add(ouvinte);
    // Quem chega depois recebe imediatamente o ultimo estado conhecido.
    if (s.ultima) ouvinte(s.ultima);

    return () => {
      const actual = this.subs.get(chave);
      if (!actual) return;
      actual.ouvintes.delete(ouvinte);
      if (actual.ouvintes.size > 0) return;

      /*
       * ── PERIODO DE GRACA ANTES DE CANCELAR ──────────────────────────────
       *
       * Cancelar de imediato parecia obvio e partia o fluxo. Em modo estrito o
       * React monta, desmonta e volta a montar cada componente. A sequencia era:
       *
       *   1. montar   -> envia {ticks: frxGBPUSD, subscribe: 1}
       *   2. desmontar-> apaga a subscricao localmente. Mas o `id` da Deriv
       *                  ainda nao tinha chegado, por isso NAO se enviou
       *                  `forget` — do lado da Deriv ela continuou viva.
       *   3. montar   -> envia o mesmo pedido -> `AlreadySubscribed`.
       *
       * Resultado: nunca chegava um `id`, os ticks ficavam a ser entregues a
       * uma subscricao fantasma, e o par aparecia como "fechado" a meio da
       * sessao de Londres. Medido: `tick:frxGBPUSD` com `ERRO AlreadySubscribed`
       * e `id: null`, enquanto `frxXAUUSD`, que escapou a corrida, funcionava.
       *
       * Adiar dez segundos resolve as duas pontas: o remonte reencontra a
       * subscricao viva, e navegar entre paginas que mostram os mesmos simbolos
       * deixa de renegociar tudo a cada clique.
       */
      actual.remocao = setTimeout(() => {
        const ainda = this.subs.get(chave);
        if (!ainda || ainda.ouvintes.size > 0) return;

        this.subs.delete(chave);
        this.esquecer(ainda.id);
        this.talvezFechar();
      }, 10_000);
    };
  }

  /**
   * Cancela uma subscricao do lado da Deriv.
   *
   * Sem `id` nao ha nada a cancelar — e esse e precisamente o caso em que a
   * subscricao pode ter ficado viva do lado de la. Por isso a resposta ao
   * pedido inicial tambem verifica se ja ninguem a quer (ver `subscrever`).
   */
  private esquecer(id: string | null): void {
    if (!id) return;
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ forget: id, req_id: this.proximoId++ }));
  }

  /** Fecha o socket quando ja nao ha nada a ouvir — com folga. */
  private talvezFechar(): void {
    if (this.subs.size > 0) return;
    // Navegar entre paginas desmonta e remonta os mesmos fluxos; reabrir o
    // socket a cada transicao custaria um handshake TLS por clique.
    setTimeout(() => {
      if (this.subs.size > 0) return;
      try {
        this.ws?.close();
      } catch {
        /* ja fechado */
      }
      this.ws = null;
      this.mudarEstado('fechado');
    }, 8_000);
  }
}

/**
 * Instancia unica por separador.
 *
 * Guardada no `globalThis` porque o Fast Refresh do Next recarrega o modulo e
 * criaria uma segunda ligacao a cada gravacao em desenvolvimento.
 */
function cliente(): ClienteDeriv {
  const g = globalThis as unknown as { __derivLive?: ClienteDeriv };
  if (!g.__derivLive) g.__derivLive = new ClienteDeriv();
  return g.__derivLive;
}

// ---------------------------------------------------------------------------
// API publica
// ---------------------------------------------------------------------------

export function observarLigacao(fn: (e: EstadoLigacao) => void): () => void {
  return cliente().observarEstado(fn);
}

/**
 * Pedido unico ao fluxo publico, sem subscricao.
 *
 * Existe para os horarios de mercado (`active_symbols`, `trading_times`), que
 * nao sao um fluxo: pergunta-se uma vez e guarda-se. Passa pela MESMA ligacao
 * partilhada, por isso nao abre socket nenhum de propósito para isto.
 */
export async function pedirDeriv(pedido: Record<string, unknown>): Promise<Record<string, unknown>> {
  return cliente().pedir(pedido);
}

/** Subscreve os ticks de um simbolo. Um por segundo, ou dois nos sinteticos 1s. */
export function subscreverTicks(derivSymbol: string, ao: (t: Tick) => void): () => void {
  return cliente().subscrever(`tick:${derivSymbol}`, { ticks: derivSymbol, subscribe: 1 }, (m) => {
    const t = m['tick'] as
      | { epoch: number; ask: number; bid: number; quote: number; pip_size: number; symbol: string }
      | undefined;
    if (!t) return;
    ao({
      simbolo: t.symbol,
      em: Number(t.epoch) * 1000,
      compra: Number(t.ask),
      venda: Number(t.bid),
      preco: Number(t.quote),
      casas: Number(t.pip_size),
    });
  });
}

export interface FluxoVelas {
  /** Historico devolvido na primeira resposta. */
  historico: Vela[];
  /** Vela em formacao, atualizada a cada segundo. */
  actual: Vela | null;
}

/**
 * Subscreve velas com historico.
 *
 * A Deriv responde primeiro com o array `candles` (historico fechado) e depois
 * emite `ohlc` a cada segundo com a vela em formacao. As duas coisas chegam no
 * mesmo fluxo, por isso sao separadas aqui: o historico so muda quando uma vela
 * fecha; a vela atual muda ao segundo.
 *
 * Manter as duas separadas evita re-desenhar 500 velas a cada segundo para
 * mexer numa.
 */
export function subscreverVelas(
  derivSymbol: string,
  tf: Timeframe,
  quantidade: number,
  ao: (f: FluxoVelas) => void,
): () => void {
  const granularity = granularidadeDe(tf);
  let historico: Vela[] = [];
  let cancelado = false;
  let pararFluxo: (() => void) | null = null;

  /*
   * ── DUAS FASES, E PORQUE NAO UMA ──────────────────────────────────────────
   *
   * Fase 1: historico, num pedido SEM `subscribe`.
   * Fase 2: subscricao para a vela em formacao.
   *
   * A versao anterior fazia as duas num so pedido (`ticks_history` com
   * `subscribe: 1`), o que e mais curto — e falha exatamente onde nao pode
   * falhar. Quando a bolsa esta fechada a Deriv rejeita o pedido INTEIRO com
   * `MarketIsClosed`, incluindo o historico. Medido: o mesmo pedido sem
   * `subscribe` devolve as velas todas.
   *
   * Resultado do atalho: a lista de mercados mostrava um travessao em vez do
   * ultimo fecho para o S&P, o Nasdaq, o Dow e o DAX sempre que a bolsa estava
   * fechada — que e a maior parte do tempo. Um painel financeiro que nao sabe
   * dizer a quanto fechou o S&P ontem nao esta a informar ninguem.
   *
   * Separar tem outra vantagem: o historico aparece a primeira resposta, sem
   * esperar pela negociacao do fluxo.
   */
  void velasUnicas(derivSymbol, tf, quantidade)
    .then((v) => {
      if (cancelado) return;
      historico = v;
      // `actual` fica a null: a ultima vela do historico pode estar em
      // formacao, mas so o fluxo o confirma. Ate la vale como fechada.
      ao({ historico, actual: null });
    })
    .catch(() => {
      if (!cancelado) ao({ historico: [], actual: null });
    });

  pararFluxo = cliente().subscrever(
    `ohlc:${derivSymbol}:${granularity}`,
    {
      ticks_history: derivSymbol,
      adjust_start_time: 1,
      // Um pedido minimo: o historico ja veio pela outra via, aqui so interessa
      // o fluxo que vem a seguir.
      count: 2,
      end: 'latest',
      start: 1,
      style: 'candles',
      granularity,
      subscribe: 1,
    },
    (m) => {
      if (cancelado) return;

      // Mercado fechado ou qualquer outra recusa: o historico ja esta desenhado
      // e nao ha vela viva. Nao ha nada a fazer, e nao ha nada de errado.
      if (m['error']) return;

      const o = m['ohlc'] as
        | {
            open_time: number;
            open: string | number;
            high: string | number;
            low: string | number;
            close: string | number;
          }
        | undefined;
      if (!o) return;

      const actual: Vela = {
        t: Number(o.open_time) * 1000,
        o: Number(o.open),
        h: Number(o.high),
        l: Number(o.low),
        c: Number(o.close),
      };

      /*
       * Vela nova? A anterior fechou — passa a fazer parte do historico. Sem
       * este passo o grafico perderia uma vela por periodo: a antiga sairia do
       * lugar de "atual" e nunca entraria no historico.
       */
      const ultima = historico[historico.length - 1];
      if (!ultima || actual.t > ultima.t) {
        historico = [...historico, actual].slice(-quantidade);
      } else if (actual.t === ultima.t) {
        historico = [...historico.slice(0, -1), actual];
      } else {
        // Vela mais antiga do que a ultima conhecida: chegou fora de ordem.
        // Ignorar e mais seguro do que reescrever o passado.
        return;
      }

      ao({ historico, actual });
    },
  );

  return () => {
    cancelado = true;
    pararFluxo?.();
  };
}

/** Pedido unico de velas, sem subscricao. Util para miniaturas. */
export async function velasUnicas(
  derivSymbol: string,
  tf: Timeframe,
  quantidade: number,
): Promise<Vela[]> {
  const r = await cliente().pedir({
    ticks_history: derivSymbol,
    adjust_start_time: 1,
    count: Math.min(5000, quantidade),
    end: 'latest',
    start: 1,
    style: 'candles',
    granularity: granularidadeDe(tf),
  });
  const brutas = r['candles'] as
    | Array<{ epoch: number; open: number; high: number; low: number; close: number }>
    | undefined;
  if (!brutas) return [];
  return brutas.map((c) => ({
    t: Number(c.epoch) * 1000,
    o: Number(c.open),
    h: Number(c.high),
    l: Number(c.low),
    c: Number(c.close),
  }));
}

/**
 * Agrega velas diarias em semanais, alinhadas a segunda-feira UTC.
 *
 * Alinhar ao inicio dos dados faria os limites deslizarem consoante o historico
 * carregado, e a mesma vela semanal mudaria de forma entre dois carregamentos.
 */
export function agregarSemanal(diarias: Vela[]): Vela[] {
  const baldes = new Map<number, Vela>();
  for (const c of diarias) {
    const d = new Date(c.t);
    const dia = d.getUTCDay();
    const recuo = dia === 0 ? 6 : dia - 1;
    const inicio = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - recuo);
    const acc = baldes.get(inicio);
    if (!acc) baldes.set(inicio, { ...c, t: inicio });
    else {
      acc.h = Math.max(acc.h, c.h);
      acc.l = Math.min(acc.l, c.l);
      acc.c = c.c;
    }
  }
  return [...baldes.values()].sort((a, b) => a.t - b.t);
}
