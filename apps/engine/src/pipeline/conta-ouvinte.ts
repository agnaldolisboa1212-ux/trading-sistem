// @ts-nocheck
/**
 * Ouvinte da conta Deriv — os webhooks que a Deriv não tem.
 *
 * A documentação é clara: não há webhooks nativos. O que existe é o stream
 * `transaction` no WebSocket autenticado — cada compra, fecho, depósito ou
 * levantamento na conta gera uma mensagem. Este módulo mantém esse stream
 * aberto e transforma cada mensagem num evento para fora:
 *
 *   n8n       → evento `account.transaction`, com o payload completo
 *   Telegram  → mensagem curta: o que aconteceu, quanto, saldo
 *
 * Push fica de fora DE PROPÓSITO. As subscrições push são de todos os
 * utilizadores da aplicação; um movimento na conta do dono não pode aparecer no
 * telemóvel de outra pessoa. Telegram e n8n já são canais só do dono.
 *
 * ── QUE CONTA ──────────────────────────────────────────────────────────────
 *
 * A do token do servidor (`DERIV_TOKEN`). As ligações OAuth dos utilizadores
 * duram uma hora e não têm refresh token, por isso um ouvinte permanente para
 * cada uma não é possível com a API atual.
 *
 * ── LIGAÇÃO ────────────────────────────────────────────────────────────────
 *
 * Cada abertura pede um OTP novo (são de uso único). Ping a cada 30 segundos
 * para a ligação não ser fechada por inatividade; se cair, volta a ligar com
 * espera crescente de 5 s até 1 min.
 */

import { difundirTransaccao, type TransaccaoConta } from '@trading/notify';

const BASE = (process.env['DERIV_BASE_URL'] ?? 'https://api.derivws.com').replace(/\/+$/, '');
const PREFIXO = '/trading/v1/options';

interface ContaApi {
  account_id: string;
  account_type: string;
  currency: string;
}

/** `DERIV_OUVIR_CONTAS`: `todas` (omissão), `demo`, `real` ou `nenhuma`. */
function filtro(): string {
  return (process.env['DERIV_OUVIR_CONTAS'] ?? 'todas').trim().toLowerCase();
}

export function ouvinteConfigurado(): boolean {
  return Boolean(process.env['DERIV_TOKEN'] && process.env['DERIV_APP_ID']) && filtro() !== 'nenhuma';
}

function cabecalhos(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env['DERIV_TOKEN'] ?? ''}`,
    'Deriv-App-ID': process.env['DERIV_APP_ID'] ?? '',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function listarContas(): Promise<ContaApi[]> {
  const r = await fetch(`${BASE}${PREFIXO}/accounts`, {
    headers: cabecalhos(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`contas: HTTP ${r.status}`);
  return ((await r.json()) as { data?: ContaApi[] }).data ?? [];
}

async function urlSessao(accountId: string): Promise<string> {
  const r = await fetch(`${BASE}${PREFIXO}/accounts/${encodeURIComponent(accountId)}/otp`, {
    method: 'POST',
    headers: cabecalhos(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`OTP ${accountId}: HTTP ${r.status}`);
  const url = ((await r.json()) as { data?: { url?: string } }).data?.url;
  if (!url) throw new Error(`OTP ${accountId}: a Deriv não devolveu URL`);
  return url;
}

class Ouvinte {
  private ws: WebSocket | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  private espera = 5_000;
  private parado = false;
  /** Uma reconexão pode reenviar o último movimento: não anunciar duas vezes. */
  private readonly vistos = new Set<string>();

  constructor(private readonly conta: ContaApi) {}

  async ligar(): Promise<void> {
    if (this.parado) return;
    try {
      const ws = new WebSocket(await urlSessao(this.conta.account_id));
      this.ws = ws;

      ws.onopen = () => {
        this.espera = 5_000;
        ws.send(JSON.stringify({ transaction: 1, subscribe: 1, req_id: 1 }));
        this.ping = setInterval(() => {
          try {
            ws.send(JSON.stringify({ ping: 1 }));
          } catch {
            /* o onclose trata */
          }
        }, 30_000);
        console.log(`[conta] a ouvir ${this.conta.account_id} (${this.conta.account_type})`);
      };
      ws.onmessage = (ev) => void this.receber(ev);
      ws.onclose = () => this.reagendar();
      ws.onerror = () => {
        /* o onclose trata da reconexão */
      };
    } catch (err) {
      console.warn(`[conta] ${this.conta.account_id}: ${err instanceof Error ? err.message : err}`);
      this.reagendar();
    }
  }

  private async receber(ev: MessageEvent): Promise<void> {
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(String(ev.data)) as Record<string, unknown>;
    } catch {
      return;
    }

    const erro = m['error'] as { code?: string; message?: string } | undefined;
    if (erro) {
      console.warn(`[conta] ${this.conta.account_id}: ${erro.code} — ${erro.message}`);
      return;
    }
    if (m['msg_type'] !== 'transaction') return;

    const t = m['transaction'] as Record<string, unknown> | undefined;
    // A primeira resposta só confirma a subscrição e não traz movimento.
    const idBruto = t?.['transaction_id'];
    if (!t || idBruto === undefined || idBruto === null) return;

    const id = String(idBruto);
    if (this.vistos.has(id)) return;
    this.vistos.add(id);
    if (this.vistos.size > 5_000) this.vistos.clear();

    const simbolo = t['underlying_symbol'] ?? t['symbol'];
    const tx: TransaccaoConta = {
      contaId: this.conta.account_id,
      tipoConta: this.conta.account_type === 'real' ? 'real' : 'demo',
      accao: String(t['action'] ?? 'desconhecida'),
      montante: Number(t['amount'] ?? 0),
      saldo: Number(t['balance'] ?? 0),
      moeda: String(t['currency'] ?? this.conta.currency),
      contratoId: t['contract_id'] ? Number(t['contract_id']) : null,
      simbolo: simbolo ? String(simbolo) : null,
      descricao: String(t['longcode'] ?? ''),
      transaccaoId: id,
      em: Number(t['transaction_time'] ?? Math.floor(Date.now() / 1000)) * 1000,
    };

    const saidas = await difundirTransaccao(tx);
    const falhas = saidas.filter((o) => !o.ok && !o.skipped).map((o) => o.channel);
    console.log(
      `[conta] ${tx.contaId} ${tx.accao} ${tx.montante.toFixed(2)} ${tx.moeda} · saldo ${tx.saldo.toFixed(2)}` +
        (falhas.length > 0 ? ` · aviso falhou em ${falhas.join(', ')}` : ''),
    );
  }

  private reagendar(): void {
    if (this.ping) {
      clearInterval(this.ping);
      this.ping = null;
    }
    this.ws = null;
    if (this.parado) return;
    const espera = this.espera;
    this.espera = Math.min(60_000, this.espera * 2);
    setTimeout(() => void this.ligar(), espera);
  }

  parar(): void {
    this.parado = true;
    if (this.ping) clearInterval(this.ping);
    try {
      this.ws?.close();
    } catch {
      /* já fechado */
    }
  }
}

/** Liga um ouvinte por conta. Devolve a função que os pára a todos. */
export async function iniciarOuvinteConta(): Promise<() => void> {
  let contas: ContaApi[];
  try {
    contas = await listarContas();
  } catch (err) {
    console.warn(
      `[conta] não foi possível listar as contas (${err instanceof Error ? err.message : err}) — ouvinte desligado`,
    );
    return () => undefined;
  }

  const f = filtro();
  const alvo = contas.filter((c) => f === 'todas' || c.account_type === f);
  if (alvo.length === 0) {
    console.log(`[conta] nenhuma conta corresponde a DERIV_OUVIR_CONTAS=${f}`);
    return () => undefined;
  }

  const ouvintes = alvo.map((c) => new Ouvinte(c));
  for (const o of ouvintes) void o.ligar();
  return () => {
    for (const o of ouvintes) o.parar();
  };
}
