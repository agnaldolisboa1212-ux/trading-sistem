/**
 * Catalogo de simbolos da Deriv — fonte UNICA, partilhada por motor e painel.
 *
 * Vivia em `apps/dashboard/lib/deriv/simbolos.ts`. Mudou-se para aqui quando o
 * motor de tempo real passou a precisar de saber que `GER30` e `OTC_GDAXI` e
 * que `V75` e `R_75`: duas copias da mesma tabela divergem na primeira vez que
 * alguem acrescenta um instrumento a uma so.
 *
 * Nao importa nada — nem providers, nem `fetch`, nem Node. E exportado pelo
 * subcaminho `@trading/data/deriv-simbolos` para que o browser o possa incluir
 * sem arrastar o resto do pacote.
 *
 * Os nomes vieram de `active_symbols` medido contra a API (89 simbolos). A API
 * nova renomeou `symbol` para `underlying_symbol` — os valores nao mudaram.
 */

export type ClasseAtivo = 'forex' | 'index' | 'metal' | 'crypto' | 'synthetic';

export interface SimboloDeriv {
  /** Codigo canonico usado por todo o sistema. */
  readonly codigo: string;
  /** Codigo da Deriv (`underlying_symbol`). */
  readonly deriv: string;
  readonly nome: string;
  readonly classe: ClasseAtivo;
  /** Casas decimais para apresentacao. */
  readonly casas: number;
  /**
   * Negoceia 24/7?
   *
   * So os sinteticos e a cripto. Isto decide o que se mostra a um sabado — sem
   * esta marca o painel ficaria congelado ao fim de semana sem explicar porque.
   */
  readonly continuo: boolean;
}

/**
 * Indices mundiais.
 *
 * Os quatro primeiros sao os que interessam a um painel de investimento: S&P,
 * Nasdaq, Dow e DAX. Os restantes vieram de borla no mesmo `active_symbols`.
 */
export const INDICES: readonly SimboloDeriv[] = Object.freeze([
  { codigo: 'SP500', deriv: 'OTC_SPC', nome: 'S&P 500', classe: 'index', casas: 2, continuo: false },
  { codigo: 'US100', deriv: 'OTC_NDX', nome: 'Nasdaq 100', classe: 'index', casas: 2, continuo: false },
  { codigo: 'US30', deriv: 'OTC_DJI', nome: 'Dow Jones 30', classe: 'index', casas: 2, continuo: false },
  { codigo: 'GER30', deriv: 'OTC_GDAXI', nome: 'DAX 30 (Alemanha)', classe: 'index', casas: 2, continuo: false },
  { codigo: 'UK100', deriv: 'OTC_FTSE', nome: 'FTSE 100 (Reino Unido)', classe: 'index', casas: 2, continuo: false },
  { codigo: 'FRA40', deriv: 'OTC_FCHI', nome: 'CAC 40 (Franca)', classe: 'index', casas: 2, continuo: false },
  { codigo: 'EU50', deriv: 'OTC_SX5E', nome: 'Euro Stoxx 50', classe: 'index', casas: 2, continuo: false },
  { codigo: 'JP225', deriv: 'OTC_N225', nome: 'Nikkei 225 (Japao)', classe: 'index', casas: 2, continuo: false },
  { codigo: 'HK50', deriv: 'OTC_HSI', nome: 'Hang Seng (Hong Kong)', classe: 'index', casas: 2, continuo: false },
  { codigo: 'AUS200', deriv: 'OTC_AS51', nome: 'ASX 200 (Australia)', classe: 'index', casas: 2, continuo: false },
  { codigo: 'NL25', deriv: 'OTC_AEX', nome: 'AEX (Holanda)', classe: 'index', casas: 2, continuo: false },
  { codigo: 'SWI20', deriv: 'OTC_SSMI', nome: 'SMI 20 (Suica)', classe: 'index', casas: 2, continuo: false },
]);

export const FOREX: readonly SimboloDeriv[] = Object.freeze([
  { codigo: 'EURUSD', deriv: 'frxEURUSD', nome: 'Euro / Dolar', classe: 'forex', casas: 5, continuo: false },
  { codigo: 'GBPUSD', deriv: 'frxGBPUSD', nome: 'Libra / Dolar', classe: 'forex', casas: 5, continuo: false },
  { codigo: 'AUDUSD', deriv: 'frxAUDUSD', nome: 'Dolar australiano / Dolar', classe: 'forex', casas: 5, continuo: false },
  { codigo: 'NZDUSD', deriv: 'frxNZDUSD', nome: 'Dolar neozelandes / Dolar', classe: 'forex', casas: 5, continuo: false },
  { codigo: 'USDJPY', deriv: 'frxUSDJPY', nome: 'Dolar / Iene', classe: 'forex', casas: 3, continuo: false },
  { codigo: 'USDCHF', deriv: 'frxUSDCHF', nome: 'Dolar / Franco suico', classe: 'forex', casas: 5, continuo: false },
  { codigo: 'USDCAD', deriv: 'frxUSDCAD', nome: 'Dolar / Dolar canadiano', classe: 'forex', casas: 5, continuo: false },
  { codigo: 'EURGBP', deriv: 'frxEURGBP', nome: 'Euro / Libra', classe: 'forex', casas: 5, continuo: false },
  { codigo: 'EURJPY', deriv: 'frxEURJPY', nome: 'Euro / Iene', classe: 'forex', casas: 3, continuo: false },
  { codigo: 'GBPJPY', deriv: 'frxGBPJPY', nome: 'Libra / Iene', classe: 'forex', casas: 3, continuo: false },
]);

export const METAIS: readonly SimboloDeriv[] = Object.freeze([
  { codigo: 'XAUUSD', deriv: 'frxXAUUSD', nome: 'Ouro / Dolar', classe: 'metal', casas: 2, continuo: false },
  { codigo: 'XAGUSD', deriv: 'frxXAGUSD', nome: 'Prata / Dolar', classe: 'metal', casas: 3, continuo: false },
  { codigo: 'XPTUSD', deriv: 'frxXPTUSD', nome: 'Platina / Dolar', classe: 'metal', casas: 2, continuo: false },
  { codigo: 'XPDUSD', deriv: 'frxXPDUSD', nome: 'Paladio / Dolar', classe: 'metal', casas: 2, continuo: false },
]);

export const CRIPTO: readonly SimboloDeriv[] = Object.freeze([
  { codigo: 'BTCUSD', deriv: 'cryBTCUSD', nome: 'Bitcoin / Dolar', classe: 'crypto', casas: 2, continuo: true },
  { codigo: 'ETHUSD', deriv: 'cryETHUSD', nome: 'Ethereum / Dolar', classe: 'crypto', casas: 2, continuo: true },
]);

/**
 * Indices sinteticos.
 *
 * Sao instrumentos gerados pela Deriv, nao mercados reais. Estao aqui por uma
 * razao pratica: negoceiam **24 horas por dia, sete dias por semana**. Ao fim
 * de semana sao a unica coisa no painel que se mexe — sem eles, quem abre a app
 * ao sabado ve um ecra congelado e conclui que esta avariada.
 *
 * Os `(1s)` produzem um tick por segundo; os outros, um a cada dois segundos.
 */
export const SINTETICOS: readonly SimboloDeriv[] = Object.freeze([
  { codigo: 'V100', deriv: 'R_100', nome: 'Volatility 100 Index', classe: 'synthetic', casas: 2, continuo: true },
  { codigo: 'V75', deriv: 'R_75', nome: 'Volatility 75 Index', classe: 'synthetic', casas: 4, continuo: true },
  { codigo: 'V50', deriv: 'R_50', nome: 'Volatility 50 Index', classe: 'synthetic', casas: 4, continuo: true },
  { codigo: 'V25', deriv: 'R_25', nome: 'Volatility 25 Index', classe: 'synthetic', casas: 3, continuo: true },
  { codigo: 'V10', deriv: 'R_10', nome: 'Volatility 10 Index', classe: 'synthetic', casas: 3, continuo: true },
  { codigo: 'V100S', deriv: '1HZ100V', nome: 'Volatility 100 (1s)', classe: 'synthetic', casas: 2, continuo: true },
  { codigo: 'V75S', deriv: '1HZ75V', nome: 'Volatility 75 (1s)', classe: 'synthetic', casas: 4, continuo: true },
  { codigo: 'V50S', deriv: '1HZ50V', nome: 'Volatility 50 (1s)', classe: 'synthetic', casas: 4, continuo: true },
  { codigo: 'V25S', deriv: '1HZ25V', nome: 'Volatility 25 (1s)', classe: 'synthetic', casas: 3, continuo: true },
  { codigo: 'V10S', deriv: '1HZ10V', nome: 'Volatility 10 (1s)', classe: 'synthetic', casas: 3, continuo: true },
  { codigo: 'BOOM1000', deriv: 'BOOM1000', nome: 'Boom 1000 Index', classe: 'synthetic', casas: 4, continuo: true },
  { codigo: 'CRASH1000', deriv: 'CRASH1000', nome: 'Crash 1000 Index', classe: 'synthetic', casas: 4, continuo: true },
  { codigo: 'STEP', deriv: 'stpRNG', nome: 'Step Index', classe: 'synthetic', casas: 1, continuo: true },
  { codigo: 'JD100', deriv: 'JD100', nome: 'Jump 100 Index', classe: 'synthetic', casas: 2, continuo: true },
]);

export const TODOS: readonly SimboloDeriv[] = Object.freeze([
  ...INDICES,
  ...FOREX,
  ...METAIS,
  ...CRIPTO,
  ...SINTETICOS,
]);

const PorCodigo = new Map(TODOS.map((s) => [s.codigo, s]));
const PorDeriv = new Map(TODOS.map((s) => [s.deriv, s]));

/**
 * Aliases do universo antigo.
 *
 * O motor MMXM fala em `NQ`, `ES`, `YM` (codigos de futuros). A Deriv fala em
 * indices a vista. Sao o mesmo mercado com contratos diferentes, por isso o
 * alias resolve — mas os PRECOS diferem, e e por isso que o registry nunca
 * intercala as duas fontes na mesma serie.
 */
const ALIAS: Record<string, string> = {
  NQ: 'US100',
  ES: 'SP500',
  YM: 'US30',
  DAX: 'GER30',
  GOLD: 'XAUUSD',
  SILVER: 'XAGUSD',
  BTC: 'BTCUSD',
  ETH: 'ETHUSD',
};

export function acharSimbolo(codigo: string): SimboloDeriv | undefined {
  const directo = PorCodigo.get(codigo);
  if (directo) return directo;
  const alias = ALIAS[codigo];
  return alias ? PorCodigo.get(alias) : undefined;
}

export function porCodigoDeriv(deriv: string): SimboloDeriv | undefined {
  return PorDeriv.get(deriv);
}

/** Codigo da Deriv para um simbolo canonico, ou `undefined` se nao houver. */
export function paraDeriv(codigo: string): string | undefined {
  return acharSimbolo(codigo)?.deriv;
}

export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w';

/**
 * Granularidades aceites pela Deriv, em segundos: 60, 120, 180, 300, 600, 900,
 * 1800, 3600, 7200, 14400, 28800, 86400. Nao ha semanal nem mensal nativos —
 * sao agregados a partir do diario. Pedir outra coisa devolve
 * `InputValidationFailed`.
 */
export const TIMEFRAMES: ReadonlyArray<{ id: Timeframe; rotulo: string; segundos: number }> =
  Object.freeze([
    { id: '1m', rotulo: '1m', segundos: 60 },
    { id: '5m', rotulo: '5m', segundos: 300 },
    { id: '15m', rotulo: '15m', segundos: 900 },
    { id: '30m', rotulo: '30m', segundos: 1800 },
    { id: '1h', rotulo: '1H', segundos: 3600 },
    { id: '4h', rotulo: '4H', segundos: 14400 },
    { id: '1d', rotulo: '1D', segundos: 86400 },
    { id: '1w', rotulo: '1S', segundos: 604800 },
  ]);

export function segundosDe(tf: Timeframe): number {
  return TIMEFRAMES.find((t) => t.id === tf)?.segundos ?? 86400;
}

/** Granularidade a PEDIR a API para um timeframe (o semanal pede diario). */
export function granularidadeDe(tf: Timeframe): number {
  const s = segundosDe(tf);
  return s > 86400 ? 86400 : s;
}

/** Formata um preco com as casas decimais do instrumento. */
export function formatarPreco(valor: number, casas: number): string {
  return valor.toLocaleString('pt-PT', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}
