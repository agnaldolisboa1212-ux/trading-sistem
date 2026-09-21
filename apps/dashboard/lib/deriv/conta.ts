import 'server-only';

/**
 * Cliente de CONTA da Deriv — exclusivamente do lado do servidor.
 *
 * O `import 'server-only'` no topo nao e decorativo: se algum dia um componente
 * de cliente importar este ficheiro, o build FALHA em vez de enviar o token da
 * corretora para dentro de um bundle de browser. E a unica garantia que nao
 * depende de alguem se lembrar.
 *
 * ── COMO A API NOVA FUNCIONA (medido, nao presumido) ───────────────────────
 *
 * Os tokens `pat_...` do utilizador NAO funcionam no WebSocket antigo — testado,
 * responde `InvalidToken`. Pertencem a API nova, que tem uma forma diferente:
 *
 *   1. REST  POST https://api.derivws.com/trading/v1/options/accounts/{id}/otp
 *            headers: Deriv-App-ID + Authorization: Bearer pat_...
 *            -> { data: { url: "wss://.../ws/real?otp=XXXX" } }
 *
 *   2. Abrir esse WebSocket. A sessao ja vem ligada a conta — NAO se envia
 *      `authorize`, ao contrario da API antiga.
 *
 *   3. A partir dai o protocolo e o MESMO da API antiga: {balance:1},
 *      {portfolio:1}, {statement:1}, {proposal:1}, {buy:...}. Alguns campos
 *      foram renomeados: `symbol` -> `underlying_symbol`.
 *
 * O OTP e de utilizacao unica e a ligacao e curta. Por isso cada operacao abre
 * a sua sessao e fecha-a — nao ha ligacao persistente do lado do servidor, o
 * que tambem evita segurar sockets autenticados entre pedidos HTTP.
 *
 * ── EXECUCAO ───────────────────────────────────────────────────────────────
 *
 * `comprar()` existe e funciona, mas so e chamada pela rota que exige
 * confirmacao explicita do utilizador. Nada neste sistema envia uma ordem
 * sozinho: nao ha automatismo, nao ha agendamento, nao ha "auto-trade".
 */

const BASE = process.env['DERIV_BASE_URL'] ?? 'https://api.derivws.com';
const PREFIXO = '/trading/v1/options';

export interface ContaDeriv {
  readonly account_id: string;
  readonly balance: string;
  readonly currency: string;
  readonly group: string;
  readonly status: string;
  /** `real` ou `demo`. */
  readonly account_type: string;
}

export interface ConfigDeriv {
  readonly appId: string;
  readonly token: string;
  /** De onde veio o token — muda a mensagem quando a Deriv o recusa. */
  readonly origem?: 'oauth' | 'dono';
}

/** Erro com a mensagem que a Deriv devolveu, para chegar intacta a interface. */
export class ErroDeriv extends Error {
  constructor(
    message: string,
    readonly codigo: string,
    /** Vale a pena repetir? Erros de validacao nao; de rede sim. */
    readonly transitorio = false,
  ) {
    super(message);
    this.name = 'ErroDeriv';
  }
}

/*
 * Já não existe `configDeriv()` a ler `DERIV_TOKEN` do ambiente. Era isso que
 * fazia TODAS as rotas usarem o token do dono para qualquer visitante. Quem
 * decide que token um pedido pode usar é `credencial.ts`; aqui só se recebe a
 * credencial já decidida.
 */

function cabecalhos(c: ConfigDeriv): HeadersInit {
  return {
    Authorization: `Bearer ${c.token}`,
    'Deriv-App-ID': c.appId,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------

/**
 * Lista as contas do token.
 *
 * Devolve real e demo. E o unico sitio onde se descobre que contas existem —
 * nao ha endpoint de "perfil".
 */
export async function listarContas(c: ConfigDeriv): Promise<ContaDeriv[]> {
  const r = await fetch(`${BASE}${PREFIXO}/accounts`, {
    headers: cabecalhos(c),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });

  if (r.status === 401 || r.status === 403) {
    throw new ErroDeriv(
      c.origem === 'oauth'
        ? 'A sessao Deriv expirou ou foi revogada. Ligue a conta de novo.'
        : 'A Deriv recusou o token do servidor (DERIV_TOKEN). Gere um novo em developers.deriv.com.',
      'TokenInvalido',
    );
  }
  if (!r.ok) {
    throw new ErroDeriv(`A Deriv respondeu HTTP ${r.status}`, 'HTTP', r.status >= 500);
  }

  const j = (await r.json()) as { data?: ContaDeriv[] };
  return j.data ?? [];
}

async function urlDaSessao(c: ConfigDeriv, accountId: string): Promise<string> {
  const r = await fetch(`${BASE}${PREFIXO}/accounts/${encodeURIComponent(accountId)}/otp`, {
    method: 'POST',
    headers: cabecalhos(c),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });

  if (!r.ok) {
    throw new ErroDeriv(
      `Nao foi possivel abrir sessao na conta ${accountId} (HTTP ${r.status})`,
      'OTP',
      r.status >= 500,
    );
  }

  const j = (await r.json()) as { data?: { url?: string } };
  const url = j.data?.url;
  if (!url) throw new ErroDeriv('A Deriv nao devolveu URL de sessao', 'OTP');
  return url;
}

// ---------------------------------------------------------------------------
// WebSocket autenticado
// ---------------------------------------------------------------------------

type Registo = Record<string, unknown>;

/**
 * Sessao curta: abre, faz o que tem a fazer, fecha.
 *
 * Usa-se com `await comSessao(id, async (s) => ...)` para que o socket feche
 * mesmo quando o corpo lanca.
 */
export async function comSessao<T>(
  c: ConfigDeriv,
  accountId: string,
  corpo: (pedir: (p: Registo) => Promise<Registo>) => Promise<T>,
): Promise<T> {
  const url = await urlDaSessao(c, accountId);
  const ws = new WebSocket(url);
  const pendentes = new Map<number, (m: Registo) => void>();
  let proximo = 1;

  ws.onmessage = (ev) => {
    let m: Registo;
    try {
      m = JSON.parse(String(ev.data)) as Registo;
    } catch {
      return;
    }
    const fn = pendentes.get(Number(m['req_id']));
    if (fn) {
      pendentes.delete(Number(m['req_id']));
      fn(m);
    }
  };

  await new Promise<void>((resolve, reject) => {
    const limite = setTimeout(() => reject(new ErroDeriv('timeout a ligar', 'Timeout', true)), 15_000);
    ws.onopen = () => {
      clearTimeout(limite);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(limite);
      reject(new ErroDeriv('erro de WebSocket', 'Socket', true));
    };
  });

  const pedir = (p: Registo): Promise<Registo> =>
    new Promise<Registo>((resolve, reject) => {
      const id = proximo++;
      const limite = setTimeout(() => {
        pendentes.delete(id);
        reject(new ErroDeriv('a Deriv nao respondeu a tempo', 'Timeout', true));
      }, 20_000);
      pendentes.set(id, (m) => {
        clearTimeout(limite);
        const erro = m['error'] as { code?: string; message?: string } | undefined;
        if (erro) {
          reject(new ErroDeriv(erro.message ?? 'erro da Deriv', erro.code ?? 'Desconhecido'));
          return;
        }
        resolve(m);
      });
      ws.send(JSON.stringify({ ...p, req_id: id }));
    });

  try {
    return await corpo(pedir);
  } finally {
    try {
      ws.close();
    } catch {
      /* ja fechado */
    }
  }
}

// ---------------------------------------------------------------------------
// Operacoes de conta
// ---------------------------------------------------------------------------

export interface Saldo {
  readonly saldo: number;
  readonly moeda: string;
  readonly loginid: string;
}

export interface PosicaoAberta {
  readonly contract_id: number;
  readonly simbolo: string;
  readonly tipo: string;
  readonly compraPor: number;
  readonly valorActual: number;
  readonly lucro: number;
  readonly abertoEm: number;
  readonly expiraEm: number | null;
  readonly descricao: string;
}

export interface Transaccao {
  readonly id: number;
  readonly tipo: string;
  readonly montante: number;
  readonly saldoDepois: number;
  readonly em: number;
  readonly contrato: number | null;
}

export interface RetratoConta {
  readonly conta: ContaDeriv;
  readonly saldo: Saldo;
  readonly posicoes: PosicaoAberta[];
  readonly transaccoes: Transaccao[];
  /** Lucro fechado acumulado, somado do `profit_table`. */
  readonly lucroFechado: number;
  readonly operacoesFechadas: number;
  readonly vitorias: number;
}

/**
 * Tudo o que a conta tem, numa ligacao so.
 *
 * Cinco pedidos ao mesmo socket em vez de cinco rotas HTTP: cada abertura de
 * sessao custa um OTP e um handshake, e o painel quer os cinco valores ao mesmo
 * tempo de qualquer maneira.
 */
export async function retratoConta(c: ConfigDeriv, conta: ContaDeriv): Promise<RetratoConta> {
  return comSessao(c, conta.account_id, async (pedir) => {
    const [bal, port, ext, lucro] = await Promise.all([
      pedir({ balance: 1 }),
      pedir({ portfolio: 1 }),
      pedir({ statement: 1, limit: 20 }),
      pedir({ profit_table: 1, limit: 100 }),
    ]);

    const b = bal['balance'] as { balance: number; currency: string; loginid: string };

    const contratos =
      ((port['portfolio'] as { contracts?: unknown[] } | undefined)?.contracts as
        | Array<Record<string, unknown>>
        | undefined) ?? [];

    const posicoes: PosicaoAberta[] = contratos.map((c) => ({
      contract_id: Number(c['contract_id']),
      simbolo: String(c['underlying_symbol'] ?? c['symbol'] ?? ''),
      tipo: String(c['contract_type'] ?? ''),
      compraPor: Number(c['buy_price'] ?? 0),
      valorActual: Number(c['bid_price'] ?? c['sell_price'] ?? 0),
      lucro: Number(c['bid_price'] ?? 0) - Number(c['buy_price'] ?? 0),
      abertoEm: Number(c['purchase_time'] ?? 0) * 1000,
      expiraEm: c['date_expiry'] ? Number(c['date_expiry']) * 1000 : null,
      descricao: String(c['longcode'] ?? ''),
    }));

    const trans =
      ((ext['statement'] as { transactions?: unknown[] } | undefined)?.transactions as
        | Array<Record<string, unknown>>
        | undefined) ?? [];

    const transaccoes: Transaccao[] = trans.map((t) => ({
      id: Number(t['transaction_id']),
      tipo: String(t['action_type'] ?? ''),
      montante: Number(t['amount'] ?? 0),
      saldoDepois: Number(t['balance_after'] ?? 0),
      em: Number(t['transaction_time'] ?? 0) * 1000,
      contrato: t['contract_id'] ? Number(t['contract_id']) : null,
    }));

    const fechadas =
      ((lucro['profit_table'] as { transactions?: unknown[] } | undefined)?.transactions as
        | Array<Record<string, unknown>>
        | undefined) ?? [];

    let lucroFechado = 0;
    let vitorias = 0;
    for (const f of fechadas) {
      const p = Number(f['sell_price'] ?? 0) - Number(f['buy_price'] ?? 0);
      lucroFechado += p;
      if (p > 0) vitorias++;
    }

    return {
      conta,
      saldo: { saldo: Number(b.balance), moeda: b.currency, loginid: b.loginid },
      posicoes,
      transaccoes,
      lucroFechado,
      operacoesFechadas: fechadas.length,
      vitorias,
    };
  });
}

// ---------------------------------------------------------------------------
// Historico completo — para o Financeiro
// ---------------------------------------------------------------------------

export interface TradeDerivFechado {
  readonly id: number;
  readonly simbolo: string;
  readonly tipo: string;
  readonly compra: number;
  readonly venda: number;
  readonly lucro: number;
  readonly abertoEm: number;
  readonly fechadoEm: number;
  readonly descricao: string;
}

export interface HistoricoDeriv {
  readonly trades: TradeDerivFechado[];
  readonly transaccoes: Transaccao[];
  readonly saldo: Saldo;
}

/**
 * Historico completo da conta — trades fechados e transaccoes.
 *
 * Usado pelo Financeiro para mostrar o desempenho real da conta Deriv.
 * Pede profit_table com 500 registos (suficiente para analise sem paginacao)
 * e statement com 200 (depositos, levantamentos, compras/vendas).
 */
export async function historicoCompleto(c: ConfigDeriv, conta: ContaDeriv): Promise<HistoricoDeriv> {
  return comSessao(c, conta.account_id, async (pedir) => {
    const [bal, lucro, ext] = await Promise.all([
      pedir({ balance: 1 }),
      pedir({ profit_table: 1, limit: 500 }),
      pedir({ statement: 1, limit: 200 }),
    ]);

    const b = bal['balance'] as { balance: number; currency: string; loginid: string };

    const fechadas =
      ((lucro['profit_table'] as { transactions?: unknown[] } | undefined)?.transactions as
        | Array<Record<string, unknown>>
        | undefined) ?? [];

    const trades: TradeDerivFechado[] = fechadas.map((f) => ({
      id: Number(f['contract_id'] ?? f['transaction_id'] ?? 0),
      simbolo: String(f['underlying_symbol'] ?? f['shortcode']?.toString().split('_')[1] ?? ''),
      tipo: String(f['contract_type'] ?? ''),
      compra: Number(f['buy_price'] ?? 0),
      venda: Number(f['sell_price'] ?? 0),
      lucro: Number(f['sell_price'] ?? 0) - Number(f['buy_price'] ?? 0),
      abertoEm: Number(f['purchase_time'] ?? 0) * 1000,
      fechadoEm: Number(f['sell_time'] ?? 0) * 1000,
      descricao: String(f['longcode'] ?? ''),
    }));

    const trans =
      ((ext['statement'] as { transactions?: unknown[] } | undefined)?.transactions as
        | Array<Record<string, unknown>>
        | undefined) ?? [];

    const transaccoes: Transaccao[] = trans.map((t) => ({
      id: Number(t['transaction_id']),
      tipo: String(t['action_type'] ?? ''),
      montante: Number(t['amount'] ?? 0),
      saldoDepois: Number(t['balance_after'] ?? 0),
      em: Number(t['transaction_time'] ?? 0) * 1000,
      contrato: t['contract_id'] ? Number(t['contract_id']) : null,
    }));

    return {
      trades,
      transaccoes,
      saldo: { saldo: Number(b.balance), moeda: b.currency, loginid: b.loginid },
    };
  });
}

export interface PedidoProposta {
  readonly accountId: string;
  readonly derivSymbol: string;
  /** `CALL` (sobe) ou `PUT` (desce). */
  readonly tipo: 'CALL' | 'PUT';
  readonly montante: number;
  readonly moeda: string;
  readonly duracao: number;
  readonly unidade: 't' | 's' | 'm' | 'h' | 'd';
}

export interface Proposta {
  readonly id: string;
  readonly pedeMontante: number;
  readonly pagamento: number;
  readonly lucro: number;
  readonly percentagem: number;
  readonly descricao: string;
  readonly pontoDeEntrada: number;
}

/**
 * Preco de um contrato antes de o comprar.
 *
 * Existe para que o botao de comprar nunca mostre um numero inventado: o
 * pagamento vem da corretora, nao de uma formula local.
 */
export async function propor(c: ConfigDeriv, p: PedidoProposta): Promise<Proposta> {
  return comSessao(c, p.accountId, async (pedir) => {
    const r = await pedir({
      proposal: 1,
      amount: p.montante,
      basis: 'stake',
      contract_type: p.tipo,
      currency: p.moeda,
      duration: p.duracao,
      duration_unit: p.unidade,
      underlying_symbol: p.derivSymbol,
    });
    const q = r['proposal'] as Record<string, unknown>;
    const pagamento = Number(q['payout'] ?? 0);
    const custo = Number(q['ask_price'] ?? p.montante);
    return {
      id: String(q['id']),
      pedeMontante: custo,
      pagamento,
      lucro: pagamento - custo,
      percentagem: custo > 0 ? ((pagamento - custo) / custo) * 100 : 0,
      descricao: String(q['longcode'] ?? ''),
      pontoDeEntrada: Number(q['spot'] ?? 0),
    };
  });
}

export interface Compra {
  readonly contract_id: number;
  readonly compraPor: number;
  readonly pagamento: number;
  readonly saldoDepois: number;
  readonly descricao: string;
  readonly em: number;
}

/**
 * Compra um contrato.
 *
 * `precoMaximo` e o tecto que o utilizador aceitou pagar. A Deriv rejeita a
 * ordem se o preco tiver subido acima dele entre a proposta e a compra — sem
 * isso, um segundo de latencia poderia executar a um preco que ninguem viu.
 */
export async function comprar(
  c: ConfigDeriv,
  accountId: string,
  propostaId: string,
  precoMaximo: number,
): Promise<Compra> {
  return comSessao(c, accountId, async (pedir) => {
    const r = await pedir({ buy: propostaId, price: precoMaximo });
    const b = r['buy'] as Record<string, unknown>;
    return {
      contract_id: Number(b['contract_id']),
      compraPor: Number(b['buy_price']),
      pagamento: Number(b['payout']),
      saldoDepois: Number(b['balance_after']),
      descricao: String(b['longcode'] ?? ''),
      em: Number(b['purchase_time'] ?? 0) * 1000,
    };
  });
}

/** Vende um contrato aberto antes do vencimento. `0` = a preco de mercado. */
export async function vender(
  c: ConfigDeriv,
  accountId: string,
  contractId: number,
  precoMinimo = 0,
): Promise<{ vendidoPor: number; saldoDepois: number }> {
  return comSessao(c, accountId, async (pedir) => {
    const r = await pedir({ sell: contractId, price: precoMinimo });
    const s = r['sell'] as Record<string, unknown>;
    return {
      vendidoPor: Number(s['sold_for'] ?? 0),
      saldoDepois: Number(s['balance_after'] ?? 0),
    };
  });
}

export interface EstadoDeriv {
  readonly configurada: boolean;
  readonly ligada: boolean;
  readonly contas: ContaDeriv[];
  readonly erro: string | null;
  readonly appId: string | null;
}

/**
 * Diagnostico para o ecra de definicoes.
 *
 * Distingue tres estados que o painel antigo confundia num so "sem token":
 * nao configurada, configurada mas recusada, e ligada. Cada um tem uma accao
 * diferente e dizer "nao esta a funcionar" para os tres nao ajuda ninguem.
 */
export async function estadoDeriv(c: ConfigDeriv | null): Promise<EstadoDeriv> {
  if (!c) {
    return { configurada: false, ligada: false, contas: [], erro: null, appId: null };
  }
  try {
    const contas = await listarContas(c);
    return { configurada: true, ligada: true, contas, erro: null, appId: c.appId };
  } catch (err) {
    return {
      configurada: true,
      ligada: false,
      contas: [],
      erro: err instanceof Error ? err.message : String(err),
      appId: c.appId,
    };
  }
}
