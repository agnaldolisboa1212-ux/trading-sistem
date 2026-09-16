import 'server-only';

/**
 * Ligação à cTrader Open API — WebSocket com mensagens JSON.
 *
 * ── UMA LIGAÇÃO POR AMBIENTE ───────────────────────────────────────────────
 *
 * A Spotware pede no máximo duas ligações por aplicação: uma para contas demo
 * e outra para reais. Abrir uma por pedido HTTP repetiria a autorização da app
 * e das contas a cada toque, e passaria o limite de pedidos. Por isso cada
 * ambiente tem uma ligação que se abre quando é precisa, se mantém com um
 * batimento a cada 10 segundos (exigência do servidor) e fecha após cinco
 * minutos sem uso.
 *
 *   wss://demo.ctraderapi.com:5036   contas demo   (5036 = JSON)
 *   wss://live.ctraderapi.com:5036   contas reais
 *
 * ── QUEM PODE FAZER O QUÊ ──────────────────────────────────────────────────
 *
 * A ligação autoriza contas de várias pessoas. Ela não sabe quem pediu: quem
 * chama (`conta.ts`) confirma sempre que a conta pertence ao token de quem está
 * a pedir, antes de enviar qualquer ordem.
 */

import { randomUUID } from 'node:crypto';
import { PT } from './protocolo';

export type Ambiente = 'demo' | 'live';

export class ErroCtrader extends Error {
  constructor(
    message: string,
    readonly codigo: string,
  ) {
    super(message);
    this.name = 'ErroCtrader';
  }
}

type Mensagem = { clientMsgId?: string; payloadType: number; payload: Record<string, unknown> };

interface Pendente {
  resolver: (m: Mensagem) => void;
  rejeitar: (e: Error) => void;
  aceita: (m: Mensagem) => boolean;
  prazo: ReturnType<typeof setTimeout>;
}

export function configCtrader(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env['CTRADER_CLIENT_ID'];
  const clientSecret = process.env['CTRADER_CLIENT_SECRET'];
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Mensagens de erro da Spotware traduzidas para o que a pessoa precisa de saber. */
function traduzir(codigo: string, descricao: string): string {
  const conhecidos: Record<string, string> = {
    CH_CLIENT_AUTH_FAILURE: 'A aplicação cTrader não está autorizada no servidor (CTRADER_CLIENT_ID/SECRET).',
    CH_ACCESS_TOKEN_INVALID: 'A ligação à cTrader expirou ou foi revogada. Ligue a conta de novo.',
    OA_AUTH_TOKEN_EXPIRED: 'A ligação à cTrader expirou. Ligue a conta de novo.',
    ACCOUNT_NOT_AUTHORIZED: 'A conta cTrader não está autorizada para esta aplicação.',
    NOT_ENOUGH_MONEY: 'Margem insuficiente para esta ordem.',
    MARKET_CLOSED: 'O mercado está fechado.',
    TRADING_DISABLED: 'A negociação deste instrumento está desligada na conta.',
    POSITION_NOT_FOUND: 'A posição já não existe.',
    OA_ORDER_NOT_FOUND: 'A ordem já não existe.',
    BLOCKED_PAYLOAD_TYPE: 'Demasiados pedidos à cTrader. Espere uns segundos.',
    TRADING_BAD_VOLUME: 'Volume inválido para este instrumento.',
    TRADING_BAD_STOPS: 'Stop loss ou take profit inválidos (demasiado perto do preço ou do lado errado).',
    INVALID_REQUEST: 'Pedido inválido para a cTrader.',
  };
  return conhecidos[codigo] ?? (descricao || codigo);
}

class Ligacao {
  private ws: WebSocket | null = null;
  private pronta: Promise<void> | null = null;
  private pendentes = new Map<string, Pendente>();
  private contas = new Map<number, string>();
  private batimento: ReturnType<typeof setInterval> | null = null;
  private ultimoUso = Date.now();

  constructor(private readonly ambiente: Ambiente) {}

  private url(): string {
    return `wss://${this.ambiente === 'live' ? 'live' : 'demo'}.ctraderapi.com:5036`;
  }

  private fechar(motivo: string): void {
    if (this.batimento) clearInterval(this.batimento);
    this.batimento = null;
    const ws = this.ws;
    this.ws = null;
    this.pronta = null;
    this.contas.clear();
    for (const [id, p] of this.pendentes) {
      clearTimeout(p.prazo);
      p.rejeitar(new ErroCtrader(`ligação à cTrader fechada (${motivo})`, 'Ligacao'));
      this.pendentes.delete(id);
    }
    try {
      ws?.close();
    } catch {
      /* já fechada */
    }
  }

  private ligar(): Promise<void> {
    if (this.pronta) return this.pronta;
    const cfg = configCtrader();
    if (!cfg) return Promise.reject(new ErroCtrader('cTrader não configurado no servidor.', 'SemConfig'));

    this.pronta = new Promise<void>((resolver, rejeitar) => {
      const ws = new WebSocket(this.url());
      this.ws = ws;
      const limite = setTimeout(() => {
        rejeitar(new ErroCtrader('a cTrader não respondeu a tempo', 'Timeout'));
        this.fechar('timeout');
      }, 15_000);

      ws.onmessage = (ev) => this.receber(String(ev.data));
      ws.onclose = () => this.fechar('servidor');
      ws.onerror = () => {
        clearTimeout(limite);
        rejeitar(new ErroCtrader('erro de ligação à cTrader', 'Ligacao'));
        this.fechar('erro');
      };
      ws.onopen = () => {
        this.enviar(PT.APPLICATION_AUTH_REQ, { clientId: cfg.clientId, clientSecret: cfg.clientSecret })
          .then(() => {
            clearTimeout(limite);
            this.batimento = setInterval(() => {
              if (Date.now() - this.ultimoUso > 5 * 60_000) {
                this.fechar('sem uso');
                return;
              }
              try {
                this.ws?.send(JSON.stringify({ payloadType: PT.HEARTBEAT, payload: {} }));
              } catch {
                this.fechar('batimento');
              }
            }, 10_000);
            this.batimento.unref?.();
            resolver();
          })
          .catch((e: unknown) => {
            clearTimeout(limite);
            rejeitar(e instanceof Error ? e : new Error(String(e)));
            this.fechar('autorização da app');
          });
      };
    });
    return this.pronta;
  }

  private receber(texto: string): void {
    let m: Mensagem;
    try {
      m = JSON.parse(texto) as Mensagem;
    } catch {
      return;
    }
    if (m.payloadType === PT.ACCOUNTS_TOKEN_INVALIDATED_EVENT) {
      for (const id of (m.payload['ctidTraderAccountIds'] as number[] | undefined) ?? []) this.contas.delete(id);
      return;
    }
    const id = m.clientMsgId;
    if (!id) return;
    const p = this.pendentes.get(id);
    if (!p) return;

    const erro = m.payloadType === PT.ERRO || m.payloadType === PT.ERRO_COMUM || m.payloadType === PT.ORDER_ERROR_EVENT;
    if (erro) {
      const codigo = String(m.payload['errorCode'] ?? 'Desconhecido');
      clearTimeout(p.prazo);
      this.pendentes.delete(id);
      if (codigo === 'CH_ACCESS_TOKEN_INVALID' || codigo === 'OA_AUTH_TOKEN_EXPIRED') this.contas.clear();
      p.rejeitar(new ErroCtrader(traduzir(codigo, String(m.payload['description'] ?? '')), codigo));
      return;
    }
    if (!p.aceita(m)) return; // ex.: ORDER_ACCEPTED quando se espera o FILLED
    clearTimeout(p.prazo);
    this.pendentes.delete(id);
    p.resolver(m);
  }

  /** Envia e espera a resposta com o mesmo `clientMsgId`. */
  enviar(
    payloadType: number,
    payload: Record<string, unknown>,
    opcoes: { aceita?: (m: Mensagem) => boolean; prazoMs?: number } = {},
  ): Promise<Mensagem> {
    this.ultimoUso = Date.now();
    const ws = this.ws;
    if (!ws) return Promise.reject(new ErroCtrader('sem ligação à cTrader', 'Ligacao'));
    const clientMsgId = randomUUID();
    return new Promise<Mensagem>((resolver, rejeitar) => {
      const prazo = setTimeout(() => {
        this.pendentes.delete(clientMsgId);
        rejeitar(new ErroCtrader('a cTrader não respondeu a tempo', 'Timeout'));
      }, opcoes.prazoMs ?? 20_000);
      this.pendentes.set(clientMsgId, { resolver, rejeitar, prazo, aceita: opcoes.aceita ?? (() => true) });
      try {
        ws.send(JSON.stringify({ clientMsgId, payloadType, payload }));
      } catch (e) {
        clearTimeout(prazo);
        this.pendentes.delete(clientMsgId);
        rejeitar(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  async pedir(
    payloadType: number,
    payload: Record<string, unknown>,
    opcoes?: { aceita?: (m: Mensagem) => boolean; prazoMs?: number },
  ): Promise<Mensagem> {
    await this.ligar();
    return this.enviar(payloadType, payload, opcoes);
  }

  /** Autoriza a conta nesta ligação, se ainda não estiver com este token. */
  async autorizarConta(contaId: number, token: string): Promise<void> {
    await this.ligar();
    if (this.contas.get(contaId) === token) return;
    await this.enviar(PT.ACCOUNT_AUTH_REQ, { ctidTraderAccountId: contaId, accessToken: token });
    this.contas.set(contaId, token);
  }
}

const ligacoes = new Map<Ambiente, Ligacao>();

export function ligacao(ambiente: Ambiente): Ligacao {
  let l = ligacoes.get(ambiente);
  if (!l) {
    l = new Ligacao(ambiente);
    ligacoes.set(ambiente, l);
  }
  return l;
}

export type { Mensagem };
