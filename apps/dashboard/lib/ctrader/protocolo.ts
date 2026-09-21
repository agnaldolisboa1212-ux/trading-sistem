/**
 * cTrader Open API — as partes puras: números do protocolo, conversões e regras.
 *
 * Sem imports e sem rede, testado em `test/ctrader.test.mjs`. Os números vêm dos
 * `.proto` oficiais da Spotware (github.com/spotware/openapi-proto-messages):
 * `OpenApiModelMessages.proto`, enum `ProtoOAPayloadType`.
 *
 * ── UNIDADES DO PROTOCOLO ──────────────────────────────────────────────────
 *
 *   volume          centésimas de unidade: 1000 = 10,00 unidades
 *   lotSize         também em centésimas (EURUSD: 10 000 000 = 100 000 unid.)
 *   preços de spot  1/100000 de unidade: 123000 = 1,23
 *   SL/TP relativos 1/100000 de unidade de preço
 *   dinheiro        inteiro × 10^-moneyDigits
 */

export const PT = {
  ERRO_COMUM: 50,
  HEARTBEAT: 51,
  APPLICATION_AUTH_REQ: 2100,
  APPLICATION_AUTH_RES: 2101,
  ACCOUNT_AUTH_REQ: 2102,
  ACCOUNT_AUTH_RES: 2103,
  NEW_ORDER_REQ: 2106,
  CANCEL_ORDER_REQ: 2108,
  AMEND_ORDER_REQ: 2109,
  AMEND_POSITION_SLTP_REQ: 2110,
  CLOSE_POSITION_REQ: 2111,
  ASSET_LIST_REQ: 2112,
  ASSET_LIST_RES: 2113,
  SYMBOLS_LIST_REQ: 2114,
  SYMBOLS_LIST_RES: 2115,
  SYMBOL_BY_ID_REQ: 2116,
  SYMBOL_BY_ID_RES: 2117,
  TRADER_REQ: 2121,
  TRADER_RES: 2122,
  RECONCILE_REQ: 2124,
  RECONCILE_RES: 2125,
  EXECUTION_EVENT: 2126,
  SUBSCRIBE_SPOTS_REQ: 2127,
  SPOT_EVENT: 2131,
  ORDER_ERROR_EVENT: 2132,
  DEAL_LIST_REQ: 2133,
  DEAL_LIST_RES: 2134,
  ERRO: 2142,
  ACCOUNTS_TOKEN_INVALIDATED_EVENT: 2147,
  GET_ACCOUNTS_BY_TOKEN_REQ: 2149,
  GET_ACCOUNTS_BY_TOKEN_RES: 2150,
  UNREALIZED_PNL_REQ: 2187,
  UNREALIZED_PNL_RES: 2188,
} as const;

export const TIPO_ORDEM = { MARKET: 1, LIMIT: 2, STOP: 3 } as const;
export const LADO = { BUY: 1, SELL: 2 } as const;
export const EXECUCAO = {
  ACEITE: 2,
  EXECUTADA: 3,
  SUBSTITUIDA: 4,
  CANCELADA: 5,
  EXPIRADA: 6,
  REJEITADA: 7,
  CANCELAMENTO_REJEITADO: 8,
  PARCIAL: 11,
} as const;

export type TipoOrdem = 'mercado' | 'limite' | 'stop';
export type Lado = 'compra' | 'venda';

// ---------------------------------------------------------------------------
// Volume
// ---------------------------------------------------------------------------

export interface DetalheVolume {
  /** Centésimas de unidade por lote. */
  lotSize: number;
  minVolume: number;
  maxVolume: number;
  stepVolume: number;
}

/**
 * Lotes → volume do protocolo, arredondado ao passo do símbolo e limitado ao
 * mínimo e máximo. Devolve também o que ficou em lotes depois de arredondar,
 * para o ecrã mostrar o que vai mesmo ser enviado.
 */
export function volumeDeLotes(lotes: number, d: DetalheVolume): { volume: number; lotes: number } {
  const passo = d.stepVolume > 0 ? d.stepVolume : 1;
  let volume = Math.round((lotes * d.lotSize) / passo) * passo;
  if (d.minVolume > 0) volume = Math.max(volume, d.minVolume);
  if (d.maxVolume > 0) volume = Math.min(volume, d.maxVolume);
  return { volume, lotes: volume / d.lotSize };
}

export function lotesDeVolume(volume: number, lotSize: number): number {
  return lotSize > 0 ? volume / lotSize : 0;
}

// ---------------------------------------------------------------------------
// Preços
// ---------------------------------------------------------------------------

/** Distância em preço → unidades relativas do protocolo (1/100000). */
export function distanciaRelativa(de: number, ate: number): number {
  return Math.round(Math.abs(de - ate) * 100_000);
}

export function precoDeSpot(v: number | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v / 100_000 : null;
}

export function dinheiro(valor: number | undefined, moneyDigits: number | undefined): number {
  return typeof valor === 'number' ? valor / 10 ** (moneyDigits ?? 2) : 0;
}

/**
 * A ordem faz sentido?
 *
 *   compra   stop < referência < alvo      venda   alvo < referência < stop
 *   limite   compra abaixo do preço actual, venda acima
 *   stop     compra acima do preço actual, venda abaixo
 *
 * A referência é o preço actual numa ordem a mercado e o preço da ordem numa
 * pendente. Devolve o problema em português, ou `null`.
 */
export function validarOrdem(o: {
  lado: Lado;
  tipo: TipoOrdem;
  lotes: number;
  precoActual: number | null;
  preco?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
}): string | null {
  if (!(o.lotes > 0)) return 'Indique o volume em lotes.';
  const compra = o.lado === 'compra';
  let ref = o.precoActual;

  if (o.tipo !== 'mercado') {
    if (!(o.preco && o.preco > 0)) return 'Indique o preço da ordem pendente.';
    ref = o.preco;
    if (o.precoActual !== null) {
      const acima = o.preco > o.precoActual;
      if (o.tipo === 'limite' && compra && acima) return 'Uma compra limite fica abaixo do preço actual.';
      if (o.tipo === 'limite' && !compra && !acima) return 'Uma venda limite fica acima do preço actual.';
      if (o.tipo === 'stop' && compra && !acima) return 'Uma compra stop fica acima do preço actual.';
      if (o.tipo === 'stop' && !compra && acima) return 'Uma venda stop fica abaixo do preço actual.';
    }
  }

  if (ref === null) return null;
  if (o.stopLoss) {
    if (compra && o.stopLoss >= ref) return 'Numa compra o stop loss fica abaixo do preço de entrada.';
    if (!compra && o.stopLoss <= ref) return 'Numa venda o stop loss fica acima do preço de entrada.';
  }
  if (o.takeProfit) {
    if (compra && o.takeProfit <= ref) return 'Numa compra o take profit fica acima do preço de entrada.';
    if (!compra && o.takeProfit >= ref) return 'Numa venda o take profit fica abaixo do preço de entrada.';
  }
  return null;
}

/**
 * Ordem a colar a partir de um sinal.
 *
 * O sinal dá entrada, stop e alvos. Se o preço actual já está na entrada (até
 * 0,15 R de distância), a ordem é a mercado. Se não, é pendente NO PREÇO DA
 * ENTRADA: limite quando o preço tem de voltar atrás até lá, stop quando tem de
 * avançar.
 */
export function ordemDoSinal(s: {
  direccao: 'bullish' | 'bearish';
  entrada: number;
  stop: number;
  alvos: Array<{ preco: number }>;
  precoActual: number | null;
  alvo?: number;
}): { lado: Lado; tipo: TipoOrdem; preco: number | null; stopLoss: number; takeProfit: number | null } {
  const lado: Lado = s.direccao === 'bullish' ? 'compra' : 'venda';
  const takeProfit = s.alvos[s.alvo ?? 0]?.preco ?? s.alvos[0]?.preco ?? null;
  const risco = Math.abs(s.entrada - s.stop);
  if (s.precoActual === null || risco <= 0 || Math.abs(s.precoActual - s.entrada) <= 0.15 * risco) {
    return { lado, tipo: 'mercado', preco: null, stopLoss: s.stop, takeProfit };
  }
  const entradaAbaixo = s.entrada < s.precoActual;
  const tipo: TipoOrdem = lado === 'compra' ? (entradaAbaixo ? 'limite' : 'stop') : entradaAbaixo ? 'stop' : 'limite';
  return { lado, tipo, preco: s.entrada, stopLoss: s.stop, takeProfit };
}

// ---------------------------------------------------------------------------
// Símbolos
// ---------------------------------------------------------------------------

/** Nomes pelos quais cada código da app costuma aparecer nas corretoras cTrader. */
const SINONIMOS: Readonly<Record<string, readonly string[]>> = {
  XAUUSD: ['GOLD', 'XAUUSD'],
  XAGUSD: ['SILVER', 'XAGUSD'],
  US100: ['US100', 'USTEC', 'NAS100', 'NASDAQ100', 'US TECH 100'],
  SP500: ['US500', 'SPX500', 'SP500', 'US SPX 500'],
  US30: ['US30', 'DJ30', 'WS30', 'WALL STREET 30'],
  GER30: ['GER40', 'DE40', 'GER30', 'DE30', 'GERMANY 40'],
  UK100: ['UK100', 'FTSE100'],
  JP225: ['JP225', 'JPN225', 'NIKKEI225'],
  BTCUSD: ['BTCUSD', 'BITCOIN'],
  ETHUSD: ['ETHUSD', 'ETHEREUM'],
};

export function normalizarSimbolo(nome: string): string {
  return nome.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * O símbolo da conta cTrader para um código da app.
 *
 * Tenta, por ordem: o próprio código, os sinónimos conhecidos, e o nome
 * completo do catálogo (os sintéticos da Deriv chamam-se "Volatility 75 Index"
 * no cTrader, tal como no catálogo). Compara sem espaços nem pontuação, no nome
 * e na descrição.
 */
export function acharSimboloCtrader<T extends { symbolName?: string; description?: string; enabled?: boolean }>(
  codigo: string,
  nomeCatalogo: string | null,
  lista: readonly T[],
): T | null {
  const candidatos = [codigo, ...(SINONIMOS[codigo.toUpperCase()] ?? []), ...(nomeCatalogo ? [nomeCatalogo] : [])]
    .map(normalizarSimbolo)
    .filter(Boolean);
  const activos = lista.filter((s) => s.enabled !== false);
  for (const c of candidatos) {
    const porNome = activos.find((s) => normalizarSimbolo(s.symbolName ?? '') === c);
    if (porNome) return porNome;
  }
  for (const c of candidatos) {
    const porDescricao = activos.find((s) => normalizarSimbolo(s.description ?? '') === c);
    if (porDescricao) return porDescricao;
  }
  return null;
}
