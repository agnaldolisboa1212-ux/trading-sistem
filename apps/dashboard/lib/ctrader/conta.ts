import 'server-only';

/**
 * Operações numa conta Deriv cTrader — do lado do servidor.
 *
 * ── A REGRA ────────────────────────────────────────────────────────────────
 *
 * Toda a operação começa por `contaDoToken`: a conta pedida tem de estar na
 * lista de contas que a cTrader devolve para o token DESTA pessoa. A ligação é
 * partilhada, e sem esta confirmação um pedido podia apontar para a conta de
 * outra pessoa que a ligação já tivesse autorizado.
 *
 * Nada aqui corre sozinho: as ordens só saem das rotas chamadas por um toque
 * com confirmação explícita.
 */

import { createHash } from 'node:crypto';
import { ErroCtrader, ligacao, type Ambiente, type Mensagem } from './ligacao';
import {
  acharSimboloCtrader,
  dinheiro,
  distanciaRelativa,
  EXECUCAO,
  LADO,
  lotesDeVolume,
  PT,
  TIPO_ORDEM,
  volumeDeLotes,
  type Lado,
  type TipoOrdem,
} from './protocolo';

export interface ContaCtrader {
  id: number;
  login: number | null;
  real: boolean;
  corretora: string;
}

export interface SimboloCtrader {
  symbolId: number;
  symbolName: string;
  description?: string;
  enabled?: boolean;
}

interface DetalheSimbolo {
  symbolId: number;
  digits: number;
  lotSize: number;
  minVolume: number;
  maxVolume: number;
  stepVolume: number;
}

export interface PosicaoCtrader {
  id: number;
  symbolId: number;
  simbolo: string;
  lado: Lado;
  lotes: number;
  volume: number;
  precoEntrada: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  lucro: number;
  swap: number;
  comissao: number;
  abertaEm: number | null;
  casas: number;
}

export interface OrdemPendenteCtrader {
  id: number;
  symbolId: number;
  simbolo: string;
  tipo: TipoOrdem;
  lado: Lado;
  lotes: number;
  preco: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  criadaEm: number | null;
  casas: number;
}

export interface RetratoCtrader {
  conta: ContaCtrader;
  saldo: number;
  capital: number;
  moeda: string;
  posicoes: PosicaoCtrader[];
  ordens: OrdemPendenteCtrader[];
}

const n = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));
const ou = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// ---------------------------------------------------------------------------
// Memória curta
// ---------------------------------------------------------------------------

function memo<T>() {
  const m = new Map<string, { ate: number; valor: T }>();
  return {
    obter(k: string): T | undefined {
      const x = m.get(k);
      return x && x.ate > Date.now() ? x.valor : undefined;
    },
    guardar(k: string, valor: T, ms: number) {
      if (m.size > 500) m.clear();
      m.set(k, { ate: Date.now() + ms, valor });
    },
  };
}

const contasPorToken = memo<ContaCtrader[]>();
const simbolosPorConta = memo<SimboloCtrader[]>();
const detalhesPorSimbolo = memo<DetalheSimbolo>();
const moedaPorConta = memo<string>();

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 32);

// ---------------------------------------------------------------------------
// Contas
// ---------------------------------------------------------------------------

export async function listarContasCtrader(token: string): Promise<ContaCtrader[]> {
  const chave = hashToken(token);
  const guardado = contasPorToken.obter(chave);
  if (guardado) return guardado;
  // Qualquer dos dois ambientes responde à lista; se um estiver em baixo, tenta o outro.
  const r = await ligacao('live')
    .pedir(PT.GET_ACCOUNTS_BY_TOKEN_REQ, { accessToken: token })
    .catch((e: unknown) => {
      if (e instanceof ErroCtrader && e.codigo !== 'Ligacao' && e.codigo !== 'Timeout') throw e;
      return ligacao('demo').pedir(PT.GET_ACCOUNTS_BY_TOKEN_REQ, { accessToken: token });
    });
  const contas = ((r.payload['ctidTraderAccount'] as Array<Record<string, unknown>> | undefined) ?? []).map((c) => ({
    id: n(c['ctidTraderAccountId']),
    login: ou(c['traderLogin']),
    real: c['isLive'] === true,
    corretora: String(c['brokerTitleShort'] ?? 'cTrader'),
  }));
  contasPorToken.guardar(chave, contas, 60_000);
  return contas;
}

export async function contaDoToken(token: string, contaId: number): Promise<{ conta: ContaCtrader; ambiente: Ambiente }> {
  const conta = (await listarContasCtrader(token)).find((c) => c.id === contaId);
  if (!conta) throw new ErroCtrader('Essa conta cTrader não pertence à sua ligação.', 'ContaAlheia');
  const ambiente: Ambiente = conta.real ? 'live' : 'demo';
  await ligacao(ambiente).autorizarConta(conta.id, token);
  return { conta, ambiente };
}

// ---------------------------------------------------------------------------
// Símbolos
// ---------------------------------------------------------------------------

async function simbolos(ambiente: Ambiente, contaId: number): Promise<SimboloCtrader[]> {
  const chave = String(contaId);
  const guardado = simbolosPorConta.obter(chave);
  if (guardado) return guardado;
  const r = await ligacao(ambiente).pedir(PT.SYMBOLS_LIST_REQ, { ctidTraderAccountId: contaId });
  const lista = ((r.payload['symbol'] as Array<Record<string, unknown>> | undefined) ?? []).map((s) => ({
    symbolId: n(s['symbolId']),
    symbolName: String(s['symbolName'] ?? ''),
    description: s['description'] ? String(s['description']) : undefined,
    enabled: s['enabled'] !== false,
  }));
  simbolosPorConta.guardar(chave, lista, 10 * 60_000);
  return lista;
}

async function detalhes(ambiente: Ambiente, contaId: number, ids: number[]): Promise<Map<number, DetalheSimbolo>> {
  const mapa = new Map<number, DetalheSimbolo>();
  const faltam: number[] = [];
  for (const id of new Set(ids)) {
    const g = detalhesPorSimbolo.obter(`${contaId}|${id}`);
    if (g) mapa.set(id, g);
    else faltam.push(id);
  }
  if (faltam.length > 0) {
    const r = await ligacao(ambiente).pedir(PT.SYMBOL_BY_ID_REQ, { ctidTraderAccountId: contaId, symbolId: faltam });
    for (const s of (r.payload['symbol'] as Array<Record<string, unknown>> | undefined) ?? []) {
      const d: DetalheSimbolo = {
        symbolId: n(s['symbolId']),
        digits: n(s['digits']),
        lotSize: n(s['lotSize']) || 10_000_000,
        minVolume: n(s['minVolume']),
        maxVolume: n(s['maxVolume']),
        stepVolume: n(s['stepVolume']) || 1,
      };
      detalhesPorSimbolo.guardar(`${contaId}|${d.symbolId}`, d, 30 * 60_000);
      mapa.set(d.symbolId, d);
    }
  }
  return mapa;
}

export async function simboloParaCodigo(
  token: string,
  contaId: number,
  codigo: string,
  nomeCatalogo: string | null,
): Promise<{ simbolo: SimboloCtrader; detalhe: DetalheSimbolo; ambiente: Ambiente } | null> {
  const { ambiente } = await contaDoToken(token, contaId);
  const s = acharSimboloCtrader(codigo, nomeCatalogo, await simbolos(ambiente, contaId));
  if (!s) return null;
  const d = (await detalhes(ambiente, contaId, [s.symbolId])).get(s.symbolId);
  return d ? { simbolo: s, detalhe: d, ambiente } : null;
}

// ---------------------------------------------------------------------------
// Retrato
// ---------------------------------------------------------------------------

export async function retratoCtrader(token: string, contaId: number): Promise<RetratoCtrader> {
  const { conta, ambiente } = await contaDoToken(token, contaId);
  const l = ligacao(ambiente);

  const [trader, recon, pnl, lista] = await Promise.all([
    l.pedir(PT.TRADER_REQ, { ctidTraderAccountId: contaId }),
    l.pedir(PT.RECONCILE_REQ, { ctidTraderAccountId: contaId }),
    l.pedir(PT.UNREALIZED_PNL_REQ, { ctidTraderAccountId: contaId }).catch(() => null),
    simbolos(ambiente, contaId),
  ]);

  const t = trader.payload['trader'] as Record<string, unknown>;
  const digitos = n(t['moneyDigits'] ?? 2);
  const saldo = dinheiro(n(t['balance']), digitos);

  let moeda = moedaPorConta.obter(String(contaId));
  if (!moeda) {
    try {
      const a = await l.pedir(PT.ASSET_LIST_REQ, { ctidTraderAccountId: contaId });
      const activo = ((a.payload['asset'] as Array<Record<string, unknown>> | undefined) ?? []).find(
        (x) => n(x['assetId']) === n(t['depositAssetId']),
      );
      moeda = String(activo?.['displayName'] ?? activo?.['name'] ?? 'USD');
    } catch {
      moeda = 'USD';
    }
    moedaPorConta.guardar(String(contaId), moeda, 60 * 60_000);
  }

  const nomes = new Map(lista.map((s) => [s.symbolId, s.symbolName]));
  const brutasPos = (recon.payload['position'] as Array<Record<string, unknown>> | undefined) ?? [];
  const brutasOrd = ((recon.payload['order'] as Array<Record<string, unknown>> | undefined) ?? []).filter(
    (o) => o['closingOrder'] !== true && (n(o['orderType']) === TIPO_ORDEM.LIMIT || n(o['orderType']) === TIPO_ORDEM.STOP),
  );
  const ids = [...brutasPos, ...brutasOrd].map((x) => n((x['tradeData'] as Record<string, unknown>)['symbolId']));
  const det = await detalhes(ambiente, contaId, ids);

  const lucros = new Map<number, number>();
  if (pnl) {
    const d = n(pnl.payload['moneyDigits'] ?? digitos);
    for (const p of (pnl.payload['positionUnrealizedPnL'] as Array<Record<string, unknown>> | undefined) ?? []) {
      lucros.set(n(p['positionId']), dinheiro(n(p['netUnrealizedPnL']), d));
    }
  }

  const posicoes: PosicaoCtrader[] = brutasPos.map((p) => {
    const td = p['tradeData'] as Record<string, unknown>;
    const symbolId = n(td['symbolId']);
    const d = det.get(symbolId);
    const dig = n(p['moneyDigits'] ?? digitos);
    return {
      id: n(p['positionId']),
      symbolId,
      simbolo: nomes.get(symbolId) ?? String(symbolId),
      lado: n(td['tradeSide']) === LADO.BUY ? 'compra' : 'venda',
      volume: n(td['volume']),
      lotes: lotesDeVolume(n(td['volume']), d?.lotSize ?? 10_000_000),
      precoEntrada: ou(p['price']),
      stopLoss: ou(p['stopLoss']),
      takeProfit: ou(p['takeProfit']),
      lucro: lucros.get(n(p['positionId'])) ?? 0,
      swap: dinheiro(n(p['swap']), dig),
      comissao: dinheiro(n(p['commission']), dig),
      abertaEm: ou(td['openTimestamp']),
      casas: d?.digits ?? 5,
    };
  });

  const ordens: OrdemPendenteCtrader[] = brutasOrd.map((o) => {
    const td = o['tradeData'] as Record<string, unknown>;
    const symbolId = n(td['symbolId']);
    const d = det.get(symbolId);
    const limite = n(o['orderType']) === TIPO_ORDEM.LIMIT;
    return {
      id: n(o['orderId']),
      symbolId,
      simbolo: nomes.get(symbolId) ?? String(symbolId),
      tipo: limite ? 'limite' : 'stop',
      lado: n(td['tradeSide']) === LADO.BUY ? 'compra' : 'venda',
      lotes: lotesDeVolume(n(td['volume']), d?.lotSize ?? 10_000_000),
      preco: limite ? ou(o['limitPrice']) : ou(o['stopPrice']),
      stopLoss: ou(o['stopLoss']),
      takeProfit: ou(o['takeProfit']),
      criadaEm: ou(td['openTimestamp']) ?? ou(o['utcLastUpdateTimestamp']),
      casas: d?.digits ?? 5,
    };
  });

  const capital = saldo + posicoes.reduce((s, p) => s + p.lucro, 0);
  return { conta, saldo, capital, moeda, posicoes, ordens };
}

// ---------------------------------------------------------------------------
// Ordens
// ---------------------------------------------------------------------------

const execucao = (m: Mensagem) => n(m.payload['executionType']);

function falhouSeRejeitada(m: Mensagem): Mensagem {
  if (execucao(m) === EXECUCAO.REJEITADA || execucao(m) === EXECUCAO.CANCELAMENTO_REJEITADO) {
    throw new ErroCtrader(String(m.payload['errorCode'] ?? 'Ordem rejeitada pela corretora.'), 'Rejeitada');
  }
  return m;
}

export interface PedidoOrdem {
  codigo: string;
  nomeCatalogo: string | null;
  lado: Lado;
  tipo: TipoOrdem;
  lotes: number;
  preco?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  /** Preço actual visto pela pessoa: base dos stops relativos numa ordem a mercado. */
  precoReferencia: number | null;
}

export async function abrirOrdemCtrader(
  token: string,
  contaId: number,
  p: PedidoOrdem,
): Promise<{ positionId: number | null; orderId: number | null; lotes: number; executada: boolean }> {
  const alvo = await simboloParaCodigo(token, contaId, p.codigo, p.nomeCatalogo);
  if (!alvo) throw new ErroCtrader(`${p.codigo} não existe nesta conta cTrader.`, 'SimboloInexistente');
  const { simbolo, detalhe, ambiente } = alvo;
  const l = ligacao(ambiente);
  const { volume, lotes } = volumeDeLotes(p.lotes, detalhe);

  const base: Record<string, unknown> = {
    ctidTraderAccountId: contaId,
    symbolId: simbolo.symbolId,
    tradeSide: p.lado === 'compra' ? LADO.BUY : LADO.SELL,
    volume,
    label: 'trivohub',
  };

  if (p.tipo === 'mercado') {
    // A mercado a cTrader não aceita SL/TP absolutos: vão relativos ao preço de
    // execução e são acertados para os valores exactos logo a seguir.
    if (p.precoReferencia && p.stopLoss) base['relativeStopLoss'] = distanciaRelativa(p.precoReferencia, p.stopLoss);
    if (p.precoReferencia && p.takeProfit) base['relativeTakeProfit'] = distanciaRelativa(p.precoReferencia, p.takeProfit);
    // Resolve na primeira confirmação da corretora (aceite ou executada): se a
    // de execução viesse sem o identificador do pedido, esperar por ela diria
    // "falhou" de uma ordem que foi executada.
    const r = falhouSeRejeitada(
      await l.pedir(PT.NEW_ORDER_REQ, { ...base, orderType: TIPO_ORDEM.MARKET }, { prazoMs: 30_000 }),
    );
    const positionId = ou((r.payload['position'] as Record<string, unknown> | undefined)?.['positionId']);
    if (positionId !== null && (p.stopLoss || p.takeProfit)) {
      // A posição pode ainda estar a ser preenchida: três tentativas espaçadas.
      // Se falharem, os stops relativos já protegem a posição.
      for (let tentativa = 0; tentativa < 3; tentativa++) {
        await new Promise((ok) => setTimeout(ok, 400 * (tentativa + 1)));
        const acertou = await l
          .pedir(PT.AMEND_POSITION_SLTP_REQ, {
            ctidTraderAccountId: contaId,
            positionId,
            ...(p.stopLoss ? { stopLoss: p.stopLoss } : {}),
            ...(p.takeProfit ? { takeProfit: p.takeProfit } : {}),
          })
          .then(() => true)
          .catch(() => false);
        if (acertou) break;
      }
    }
    return { positionId, orderId: null, lotes, executada: true };
  }

  const pendente = {
    ...base,
    orderType: p.tipo === 'limite' ? TIPO_ORDEM.LIMIT : TIPO_ORDEM.STOP,
    ...(p.tipo === 'limite' ? { limitPrice: p.preco } : { stopPrice: p.preco }),
    ...(p.stopLoss ? { stopLoss: p.stopLoss } : {}),
    ...(p.takeProfit ? { takeProfit: p.takeProfit } : {}),
  };
  const r = falhouSeRejeitada(await l.pedir(PT.NEW_ORDER_REQ, pendente, { prazoMs: 30_000 }));
  const orderId = ou((r.payload['order'] as Record<string, unknown> | undefined)?.['orderId']);
  return { positionId: null, orderId, lotes, executada: false };
}

export async function alterarPosicaoCtrader(
  token: string,
  contaId: number,
  positionId: number,
  stopLoss: number | null,
  takeProfit: number | null,
): Promise<void> {
  const { ambiente } = await contaDoToken(token, contaId);
  falhouSeRejeitada(
    await ligacao(ambiente).pedir(PT.AMEND_POSITION_SLTP_REQ, {
      ctidTraderAccountId: contaId,
      positionId,
      ...(stopLoss ? { stopLoss } : {}),
      ...(takeProfit ? { takeProfit } : {}),
    }),
  );
}

export async function fecharPosicaoCtrader(
  token: string,
  contaId: number,
  positionId: number,
  lotes: number | null,
): Promise<void> {
  const retrato = await retratoCtrader(token, contaId);
  const pos = retrato.posicoes.find((p) => p.id === positionId);
  if (!pos) throw new ErroCtrader('A posição já não existe.', 'POSITION_NOT_FOUND');
  const { ambiente } = await contaDoToken(token, contaId);
  const d = (await detalhes(ambiente, contaId, [pos.symbolId])).get(pos.symbolId);
  const volume = lotes && d ? Math.min(pos.volume, volumeDeLotes(lotes, d).volume) : pos.volume;
  falhouSeRejeitada(
    await ligacao(ambiente).pedir(
      PT.CLOSE_POSITION_REQ,
      { ctidTraderAccountId: contaId, positionId, volume },
      { prazoMs: 30_000 },
    ),
  );
}

export async function alterarOrdemCtrader(
  token: string,
  contaId: number,
  orderId: number,
  mudancas: { preco: number | null; stopLoss: number | null; takeProfit: number | null },
): Promise<void> {
  const retrato = await retratoCtrader(token, contaId);
  const ordem = retrato.ordens.find((o) => o.id === orderId);
  if (!ordem) throw new ErroCtrader('A ordem já não existe.', 'OA_ORDER_NOT_FOUND');
  const { ambiente } = await contaDoToken(token, contaId);
  falhouSeRejeitada(
    await ligacao(ambiente).pedir(PT.AMEND_ORDER_REQ, {
      ctidTraderAccountId: contaId,
      orderId,
      ...(mudancas.preco ? (ordem.tipo === 'limite' ? { limitPrice: mudancas.preco } : { stopPrice: mudancas.preco }) : {}),
      ...(mudancas.stopLoss ? { stopLoss: mudancas.stopLoss } : {}),
      ...(mudancas.takeProfit ? { takeProfit: mudancas.takeProfit } : {}),
    }),
  );
}

export async function cancelarOrdemCtrader(token: string, contaId: number, orderId: number): Promise<void> {
  const { ambiente } = await contaDoToken(token, contaId);
  falhouSeRejeitada(await ligacao(ambiente).pedir(PT.CANCEL_ORDER_REQ, { ctidTraderAccountId: contaId, orderId }));
}
