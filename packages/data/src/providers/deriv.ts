/**
 * Deriv — dados de mercado por WebSocket.
 *
 * DESCOBERTA QUE JUSTIFICA ESTE ADAPTER: a chamada `ticks_history` da Deriv
 * **nao exige token**. Os dados de mercado sao publicos; so as operacoes de
 * conta (saldo, portfolio, ordens) e que precisam de autorizacao. Isto torna a
 * Deriv utilizavel como fonte primaria imediatamente, sem qualquer credencial.
 *
 * Vantagem sobre o Yahoo: entrega OHLC real em forex spot, metais e cripto, e
 * ainda os indices sinteticos (R_75, R_100) que negoceiam 24/7 — uteis para
 * testar a estrategia ao fim de semana, quando os mercados reais estao fechados.
 *
 * ATENCAO ao instrumento: o `frxXAUUSD` da Deriv e OURO SPOT; o `GC=F` do Yahoo
 * e o FUTURO. Os precos diferem (medido: 4427 contra 4609) porque sao contratos
 * diferentes, nao porque uma das fontes esteja errada. Misturar as duas numa so
 * serie produziria saltos artificiais que o detector leria como gaps — por isso
 * o registry escolhe UMA fonte por serie e nunca as intercala.
 *
 * Granularidades suportadas pela API: 60, 120, 180, 300, 600, 900, 1800, 3600,
 * 7200, 14400, 28800, 86400 segundos. Nao ha semanal nem mensal nativos.
 */

import type { Candle, CandleSeries } from '@trading/core';
import {
  dropUnclosedCandle,
  normalizeCandles,
  ProviderError,
  type CandleRequest,
  type DataProvider,
} from '../types.js';

/**
 * Endpoint de dados de mercado.
 *
 * ── O DEFEITO QUE ISTO CORRIGE ─────────────────────────────────────────────
 *
 * Antes: `wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`. Isso
 * funcionava com o `app_id` de demonstracao (1089, numerico). Quando a conta
 * foi ligada, `DERIV_APP_ID` passou a ser o id da API NOVA — alfanumerico,
 * `34gRTm...` — e o WebSocket antigo recusa-o com erro de socket. Medido:
 *
 *   antigo + app_id alfanumerico  -> ERRO de socket
 *   antigo + 1089                 -> 2 velas
 *   API nova publica              -> 2 velas
 *
 * Nenhum erro chegava ao varrimento: o registry fazia failover para o Yahoo e
 * a Deriv — a unica fonte com OHLC real em forex spot — ficava morta em
 * silencio.
 *
 * Agora usa o endpoint PUBLICO da API nova, que nao precisa de app_id nem de
 * token para dados de mercado. `DERIV_WS_URL` sobrepoe, para quem precise.
 */
const ENDPOINT_PUBLICO = 'wss://api.derivws.com/trading/v1/options/ws/public';

function endpoint(): string {
  return process.env['DERIV_WS_URL'] ?? ENDPOINT_PUBLICO;
}

/** Timeframe canonico -> granularidade em segundos. */
const GRANULARITY: Record<string, number | null> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
  // Sem suporte nativo: construidos por agregacao do diario.
  '1w': null,
  '1M': null,
};

/**
 * Simbolo canonico -> simbolo da Deriv.
 *
 * Todos verificados empiricamente contra a API. O DXY nao existe na Deriv e o
 * RTY (Russell 2000) tambem nao — para esses o registry cai para outra fonte.
 */
const SYMBOLS: Record<string, string> = {
  EURUSD: 'frxEURUSD',
  GBPUSD: 'frxGBPUSD',
  AUDUSD: 'frxAUDUSD',
  NZDUSD: 'frxNZDUSD',
  USDCHF: 'frxUSDCHF',
  USDJPY: 'frxUSDJPY',
  USDCAD: 'frxUSDCAD',
  XAUUSD: 'frxXAUUSD',
  XAGUSD: 'frxXAGUSD',
  BTCUSD: 'cryBTCUSD',
  ETHUSD: 'cryETHUSD',
  NQ: 'OTC_NDX',
  // O S&P e OTC_SPC — OTC_SPX devolve InvalidSymbol.
  ES: 'OTC_SPC',
  YM: 'OTC_DJI',
};

// ---------------------------------------------------------------------------
// Ligacao partilhada
// ---------------------------------------------------------------------------

interface Pendente {
  resolve: (valor: Record<string, unknown>) => void;
  reject: (erro: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Uma so ligacao WebSocket reutilizada por todos os pedidos.
 *
 * Abrir uma ligacao por pedido funcionaria, mas o handshake TLS custa ~300ms e
 * um varrimento faz dezenas de pedidos. As respostas sao emparelhadas por
 * `req_id`, que a API devolve tal como o recebeu.
 */
class DerivConnection {
  private ws: WebSocket | null = null;
  private ligar: Promise<WebSocket> | null = null;
  private readonly pendentes = new Map<number, Pendente>();
  private proximoId = 1;

  private async socket(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return this.ws;
    if (this.ligar) return this.ligar;

    this.ligar = new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(endpoint());
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* já fechado */
        }
        reject(new Error('timeout a ligar ao WebSocket da Deriv'));
      }, 20_000);

      ws.onopen = () => {
        clearTimeout(timer);
        this.ws = ws;
        resolve(ws);
      };

      ws.onmessage = (ev) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
        } catch {
          return;
        }
        const id = Number(msg['req_id']);
        const p = this.pendentes.get(id);
        if (!p) return;
        this.pendentes.delete(id);
        clearTimeout(p.timer);
        p.resolve(msg);
      };

      ws.onerror = () => {
        clearTimeout(timer);
        this.derrubar(new Error('erro de WebSocket na Deriv'));
        reject(new Error('erro de WebSocket na Deriv'));
      };

      ws.onclose = () => {
        this.derrubar(new Error('ligacao à Deriv fechada'));
      };
    }).finally(() => {
      this.ligar = null;
    });

    return this.ligar;
  }

  /** Rejeita tudo o que estava pendente quando a ligacao cai. */
  private derrubar(erro: Error): void {
    this.ws = null;
    for (const [, p] of this.pendentes) {
      clearTimeout(p.timer);
      p.reject(erro);
    }
    this.pendentes.clear();
  }

  async send(payload: Record<string, unknown>, timeoutMs = 25_000): Promise<Record<string, unknown>> {
    const ws = await this.socket();
    const id = this.proximoId++;

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendentes.delete(id);
        reject(new Error(`timeout apos ${timeoutMs}ms a aguardar a Deriv`));
      }, timeoutMs);

      this.pendentes.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ ...payload, req_id: id }));
    });
  }

  close(): void {
    try {
      this.ws?.close();
    } catch {
      /* já fechado */
    }
    this.ws = null;
  }
}

/** Ligacao partilhada ao nivel do modulo. */
const conexao = new DerivConnection();

/** Fecha a ligacao — util em scripts que precisam de terminar. */
export function closeDerivConnection(): void {
  conexao.close();
}

// ---------------------------------------------------------------------------

interface DerivCandle {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export class DerivProvider implements DataProvider {
  readonly id = 'deriv';
  readonly catalogId = 'deriv';
  readonly capabilities = ['ohlc', 'fx-rate', 'metals', 'crypto-spot', 'index'] as const;
  readonly assetClasses = ['forex', 'index', 'metal', 'crypto'] as const;
  /** Dados de mercado sao publicos — so a conta e que exige token. */
  readonly requiresKey = false;
  readonly rateLimitPerMinute = 120;
  readonly ohlcFidelity = 'true-ohlc' as const;

  isConfigured(): boolean {
    return true;
  }

  supports(request: CandleRequest): boolean {
    if (!(request.symbol in SYMBOLS)) return false;
    // Semanal e mensal sao agregados a partir do diario.
    return request.timeframe !== '1M';
  }

  async getCandles(request: CandleRequest): Promise<CandleSeries> {
    const derivSymbol = SYMBOLS[request.symbol];
    if (!derivSymbol) {
      throw new ProviderError(`Deriv nao cobre ${request.symbol}`, this.id, false);
    }

    const agregarSemanal = request.timeframe === '1w';
    const granularity = agregarSemanal ? 86400 : GRANULARITY[request.timeframe];
    if (!granularity) {
      throw new ProviderError(`timeframe ${request.timeframe} nao suportado`, this.id, false);
    }

    // A API limita a 5000 velas por pedido.
    const count = Math.min(5000, agregarSemanal ? request.limit * 7 + 20 : request.limit + 10);

    let resposta: Record<string, unknown>;
    try {
      resposta = await conexao.send({
        ticks_history: derivSymbol,
        adjust_start_time: 1,
        count,
        end: 'latest',
        start: 1,
        style: 'candles',
        granularity,
      });
    } catch (err) {
      throw new ProviderError(
        `Deriv: ${err instanceof Error ? err.message : String(err)}`,
        this.id,
        true,
      );
    }

    const erro = resposta['error'] as { code?: string; message?: string } | undefined;
    if (erro) {
      // Simbolo invalido e permanente; o resto vale a pena repetir.
      const permanente = erro.code === 'InvalidSymbol';
      throw new ProviderError(
        `Deriv ${erro.code}: ${erro.message}`,
        this.id,
        !permanente,
      );
    }

    const brutas = (resposta['candles'] ?? []) as DerivCandle[];
    if (brutas.length === 0) {
      throw new ProviderError(`Deriv devolveu serie vazia para ${derivSymbol}`, this.id, true);
    }

    let candles: Candle[] = normalizeCandles(
      brutas.map((c) => ({
        time: Number(c.epoch) * 1000,
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        // A Deriv nao entrega volume em ticks_history.
        volume: 0,
      })),
    );

    if (agregarSemanal) candles = agregarSemanas(candles);

    if (!request.includeForming) {
      candles = dropUnclosedCandle(candles, request.timeframe);
    }
    if (request.since !== undefined) {
      candles = candles.filter((c) => c.time >= request.since!);
    }

    return {
      symbol: request.symbol,
      timeframe: request.timeframe,
      candles: candles.slice(-request.limit),
      source: this.id,
      fidelity: this.ohlcFidelity,
    };
  }
}

/**
 * Agrega velas diarias em semanais.
 *
 * As semanas sao alinhadas a segunda-feira UTC, nao ao primeiro dia da serie.
 * Alinhar ao inicio dos dados faria os limites semanais deslizarem consoante o
 * historico carregado, e a mesma vela semanal mudaria de forma entre dois
 * varrimentos — a estrutura detectada deixaria de ser reproduzivel.
 */
function agregarSemanas(diarias: Candle[]): Candle[] {
  const baldes = new Map<number, Candle>();

  for (const c of diarias) {
    const d = new Date(c.time);
    const diaSemana = d.getUTCDay(); // 0 = domingo
    // Recuar ate segunda-feira: domingo conta como fim da semana anterior.
    const recuo = diaSemana === 0 ? 6 : diaSemana - 1;
    const inicio = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - recuo);

    const acc = baldes.get(inicio);
    if (!acc) {
      baldes.set(inicio, { ...c, time: inicio });
    } else {
      acc.high = Math.max(acc.high, c.high);
      acc.low = Math.min(acc.low, c.low);
      acc.close = c.close;
      acc.volume += c.volume;
    }
  }

  return [...baldes.values()].sort((a, b) => a.time - b.time);
}

/**
 * Pedido directo de velas por codigo DERIV (`frxEURUSD`, `R_75`, `OTC_GDAXI`).
 *
 * O `DerivProvider` so conhece o universo do MMXM, com codigos canonicos. O
 * motor de tempo real analisa o que os utilizadores escolheram no onboarding —
 * sinteticos, DAX, Nikkei — e precisa de pedir por codigo Deriv, reutilizando a
 * mesma ligacao partilhada.
 *
 * Devolve as velas BRUTAS, incluindo a que esta em formacao. Quem chama decide
 * se a corta: o motor corta sempre, o grafico nao.
 */
export async function velasDeriv(
  derivSymbol: string,
  granularidade: number,
  quantidade: number,
): Promise<Candle[]> {
  const count = Math.min(5000, Math.max(2, quantidade));
  const chave = `${derivSymbol}:${granularidade}`;
  const agora = Date.now();

  // Uma entrada fresca com velas suficientes serve este pedido sem ir a rede.
  const guardada = cacheVelas.get(chave);
  if (guardada && guardada.count >= count && cacheValida(guardada, granularidade, agora)) {
    return guardada.velas.slice(-count);
  }

  // Um pedido igual (ou maior) ja em curso: espera por ele em vez de repetir.
  const emCurso = pedidosVelas.get(chave);
  if (emCurso && emCurso.count >= count) {
    return (await emCurso.promessa).slice(-count);
  }

  const promessa = pedirVelasComRepeticao(derivSymbol, granularidade, count);
  pedidosVelas.set(chave, { count, promessa });
  try {
    const velas = await promessa;
    cacheVelas.set(chave, { count, velas, em: Date.now() });
    return velas;
  } catch (err) {
    // Limite de pedidos atingido: velas com poucos minutos valem mais do que um
    // painel vazio. So se servem se cobrirem o pedido e nao forem velhas demais.
    if (
      err instanceof ProviderError &&
      /RateLimit/.test(err.message) &&
      guardada &&
      guardada.count >= count &&
      Date.now() - guardada.em < VELAS_VELHAS_MAX_MS
    ) {
      return guardada.velas.slice(-count);
    }
    throw err;
  } finally {
    if (pedidosVelas.get(chave)?.promessa === promessa) pedidosVelas.delete(chave);
  }
}

/*
 * ── PORQUE HA CACHE E REPETICAO EM `velasDeriv` ────────────────────────────
 *
 * Medido: com o grafico aberto, o ICT ALGO (execucao + diario + par, a cada
 * 60s), o radar, o painel de agentes e os sinais pediam as MESMAS series em
 * paralelo pela mesma ligacao. A Deriv recusava com
 * `RateLimit: You have reached the rate limit for ticks_history` e o painel
 * mostrava "Falha a obter as velas".
 *
 * Tres travoes, do mais barato ao mais caro:
 *   · cache curta por simbolo+granularidade — as velas fechadas so mudam
 *     quando fecha uma vela nova;
 *   · pedidos iguais em curso partilham a mesma resposta;
 *   · RateLimit repete com recuo exponencial antes de desistir, e se desistir
 *     serve a ultima copia guardada, se ainda for recente.
 */

interface VelasGuardadas {
  count: number;
  velas: Candle[];
  em: number;
}

const cacheVelas = new Map<string, VelasGuardadas>();
const pedidosVelas = new Map<string, { count: number; promessa: Promise<Candle[]> }>();

/** Uma copia guardada so e servida em RateLimit se tiver menos do que isto. */
const VELAS_VELHAS_MAX_MS = 10 * 60_000;

/** Frescura aceite: 1/4 da vela, entre 15s e 60s. */
function ttlVelas(granularidade: number): number {
  return Math.min(60_000, Math.max(15_000, (granularidade * 1000) / 4));
}

/**
 * A cópia guardada ainda serve?
 *
 * Até 15M: a frescura curta de sempre (o preço da vela em formação conta).
 * Em 1H, 4H e diário as análises só lêem velas FECHADAS, que só mudam quando
 * abre uma vela nova: a cópia serve até 1/4 da vela (máx. 15 min) DESDE QUE já
 * tenha a vela do período actual. Quando abre uma vela nova, pede-se logo.
 * Medido: com o gráfico, o radar e o motor abertos, os diários e os 4H eram
 * pedidos de minuto a minuto e a Deriv respondia RateLimit.
 */
function cacheValida(g: VelasGuardadas, granularidade: number, agora: number): boolean {
  const idade = agora - g.em;
  if (granularidade <= 900) return idade < ttlVelas(granularidade);
  const passo = granularidade * 1000;
  const periodoActual = Math.floor(agora / passo) * passo;
  const ultima = g.velas[g.velas.length - 1];
  if (!ultima || ultima.time < periodoActual) return idade < ttlVelas(granularidade);
  return idade < Math.min(15 * 60_000, passo / 4);
}

/**
 * No máximo PEDIDOS_EM_SIMULTANEO pedidos de velas à Deriv ao mesmo tempo, os
 * outros em fila. Dezenas de pedidos em rajada (o radar a varrer, o gráfico a
 * abrir, o motor a passar) eram o que disparava o limite de `ticks_history`.
 */
const PEDIDOS_EM_SIMULTANEO = 3;
let emVoo = 0;
const fila: Array<() => void> = [];
async function naVez<T>(fn: () => Promise<T>): Promise<T> {
  // O lugar passa directamente de quem sai para o primeiro da fila: ninguém
  // que chegue entretanto pode passar à frente e exceder o limite.
  if (emVoo >= PEDIDOS_EM_SIMULTANEO) await new Promise<void>((r) => fila.push(r));
  else emVoo++;
  try {
    return await fn();
  } finally {
    const proximo = fila.shift();
    if (proximo) proximo();
    else emVoo--;
  }
}

const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function pedirVelasComRepeticao(
  derivSymbol: string,
  granularidade: number,
  count: number,
): Promise<Candle[]> {
  // O limite da Deriv conta por janela de tempo: esperar mais entre tentativas
  // passa a janela em vez de voltar a bater nela.
  const recuos = [2_000, 5_000, 10_000, 15_000];
  for (let tentativa = 0; ; tentativa++) {
    const resposta = await naVez(() =>
      conexao.send({
        ticks_history: derivSymbol,
        adjust_start_time: 1,
        count,
        end: 'latest',
        start: 1,
        style: 'candles',
        granularity: granularidade,
      }),
    );

    const erro = resposta['error'] as { code?: string; message?: string } | undefined;
    if (erro) {
      if (erro.code === 'RateLimit' && tentativa < recuos.length) {
        await esperar(recuos[tentativa]!);
        continue;
      }
      throw new ProviderError(`Deriv ${erro.code}: ${erro.message}`, 'deriv', erro.code !== 'InvalidSymbol');
    }

    const brutas = (resposta['candles'] ?? []) as DerivCandle[];
    return normalizeCandles(
      brutas.map((c) => ({
        time: Number(c.epoch) * 1000,
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: 0,
      })),
    );
  }
}

/**
 * Que mercados estao abertos AGORA, segundo a Deriv (`active_symbols`).
 *
 * ── PORQUE NAO CHEGA OLHAR PARA AS VELAS ───────────────────────────────────
 *
 * A heuristica anterior dizia "fechado" quando a ultima vela tinha mais de tres
 * periodos de silencio. Medido as 22:07 UTC de uma terca: o US100 aparecia
 * "fechado" em 15m (tres velas de silencio) mas "aberto" em 1h (so uma), e o
 * motor analisava a vela das 20:00 como se fosse de agora. Um sinal sobre uma
 * bolsa fechada, anunciado como actual, e exactamente o aviso que nao pode sair.
 *
 * `exchange_is_open` e a resposta autoritativa e custa um pedido por passagem.
 * Devolve `code -> aberto` por codigo Deriv; simbolos ausentes nao entram.
 */
export async function mercadosAbertosDeriv(): Promise<Map<string, boolean>> {
  const resposta = await conexao.send({ active_symbols: 'brief' });

  const erro = resposta['error'] as { code?: string; message?: string } | undefined;
  if (erro) throw new ProviderError(`Deriv ${erro.code}: ${erro.message}`, 'deriv', true);

  const lista = (resposta['active_symbols'] ?? []) as Array<{
    underlying_symbol?: string;
    symbol?: string;
    exchange_is_open?: number;
    is_trading_suspended?: number;
  }>;

  const abertos = new Map<string, boolean>();
  for (const x of lista) {
    // A API nova chama-lhe `underlying_symbol`; a antiga, `symbol`.
    const codigo = x.underlying_symbol ?? x.symbol;
    if (codigo) abertos.set(codigo, x.exchange_is_open === 1 && x.is_trading_suspended !== 1);
  }
  return abertos;
}

/** Simbolos canonicos que a Deriv cobre. */
export function derivSymbols(): string[] {
  return Object.keys(SYMBOLS);
}
