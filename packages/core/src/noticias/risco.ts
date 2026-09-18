/**
 * Notícias de alto impacto e o que fazem a um sinal.
 *
 * ── O QUE SE MEDIU, E O QUE NÃO ────────────────────────────────────────────
 *
 * O posicionamento dos fundos (COT da CFTC) foi testado contra 15 anos de
 * operações do RSI(2) de Connors: o acerto fica entre 70% e 74% com os fundos
 * compradores, vendidos ou neutros, e as diferenças trocam de sinal entre
 * 2011–2020 e 2021–2026. Não melhora os sinais — aparece como informação, não
 * mexe na convicção medida.
 *
 * O calendário económico não tem histórico gratuito para medir. A regra abaixo
 * é a de prudência que as mesas de prop trading impõem, não uma vantagem
 * medida: não abrir uma operação de horas nos 30 minutos antes e depois de uma
 * notícia de alto impacto do próprio instrumento (o spread alarga e o preço
 * salta o stop). Em 4h e 1D o sinal sai, com o aviso da notícia.
 *
 * Função pura: recebe os eventos e o instante.
 */

export interface EventoEconomico {
  titulo: string;
  /** Moeda/economia afectada (USD, EUR, GBP, JPY...). */
  moeda: string;
  /** Instante do evento (ms UTC). */
  em: number;
  previsao?: string | null;
  anterior?: string | null;
}

/** Economias que movem cada instrumento. */
export const MOEDAS_POR_INSTRUMENTO: Readonly<Record<string, readonly string[]>> = {
  US100: ['USD'],
  SP500: ['USD'],
  US30: ['USD'],
  GER30: ['EUR', 'USD'],
  FRA40: ['EUR', 'USD'],
  EU50: ['EUR', 'USD'],
  NL25: ['EUR'],
  UK100: ['GBP', 'USD'],
  SWI20: ['CHF', 'EUR'],
  JP225: ['JPY', 'USD'],
  HK50: ['CNY', 'USD'],
  AUS200: ['AUD', 'CNY'],
  BTCUSD: ['USD'],
  ETHUSD: ['USD'],
  XAUUSD: ['USD'],
  XAGUSD: ['USD'],
  XPTUSD: ['USD'],
  XPDUSD: ['USD'],
};

/** Moedas de um instrumento: as do mapa, ou as duas metades de um par de forex. */
export function moedasDoInstrumento(simbolo: string): string[] {
  const s = simbolo.toUpperCase();
  const mapa = MOEDAS_POR_INSTRUMENTO[s];
  if (mapa) return [...mapa];
  if (/^[A-Z]{6}$/.test(s)) return [s.slice(0, 3), s.slice(3, 6)];
  return [];
}

/** Instrumentos (do catálogo dado) que um evento afecta. */
export function instrumentosAfectados(evento: EventoEconomico, catalogo: readonly string[]): string[] {
  const m = evento.moeda.toUpperCase();
  return catalogo.filter((c) => moedasDoInstrumento(c).includes(m) || m === 'ALL');
}

/** Eventos de um instrumento numa janela [desde, ate]. */
export function eventosDoInstrumento(
  simbolo: string,
  eventos: readonly EventoEconomico[],
  desde: number,
  ate: number,
): EventoEconomico[] {
  const moedas = moedasDoInstrumento(simbolo);
  return eventos
    .filter((e) => (moedas.includes(e.moeda.toUpperCase()) || e.moeda.toUpperCase() === 'ALL') && e.em >= desde && e.em <= ate)
    .sort((a, b) => a.em - b.em);
}

export interface RiscoNoticia {
  /** Não anunciar agora (só timeframes de horas). */
  suspender: boolean;
  /** Frase para o sinal, ou null sem notícias por perto. */
  aviso: string | null;
  eventos: EventoEconomico[];
}

const MIN = 60_000;
const H = 60 * MIN;

/** Janela de aviso por timeframe: quanto tempo à frente uma notícia importa. */
const JANELA_AVISO: Readonly<Record<string, number>> = {
  '15m': 2 * H,
  '30m': 3 * H,
  '1h': 4 * H,
  '4h': 12 * H,
  '1d': 36 * H,
};

function quando(em: number, agora: number): string {
  const d = em - agora;
  const hora = new Date(em).toISOString().slice(11, 16);
  if (d <= 0) return `há ${Math.max(1, Math.round(-d / MIN))} min`;
  if (d < H) return `em ${Math.round(d / MIN)} min (${hora} UTC)`;
  if (d < 24 * H) return `às ${hora} UTC`;
  return `${new Date(em).toISOString().slice(0, 10)} ${hora} UTC`;
}

export function riscoDeNoticias(
  simbolo: string,
  timeframe: string,
  eventos: readonly EventoEconomico[],
  agora: number,
): RiscoNoticia {
  const janela = JANELA_AVISO[timeframe] ?? 4 * H;
  const proximos = eventosDoInstrumento(simbolo, eventos, agora - 30 * MIN, agora + janela);
  if (proximos.length === 0) return { suspender: false, aviso: null, eventos: [] };

  const colado = proximos.filter((e) => Math.abs(e.em - agora) <= 30 * MIN);
  const deHoras = timeframe === '15m' || timeframe === '30m' || timeframe === '1h';
  const primeiro = colado[0] ?? proximos[0]!;
  const lista = proximos
    .slice(0, 3)
    .map((e) => `${e.moeda} ${e.titulo} ${quando(e.em, agora)}`)
    .join('; ');

  if (deHoras && colado.length > 0) {
    return {
      suspender: true,
      aviso: `Notícia de alto impacto colada ao sinal (${primeiro.moeda} ${primeiro.titulo} ${quando(primeiro.em, agora)}): não se abre operação de horas nos 30 min antes e depois.`,
      eventos: proximos,
    };
  }
  return {
    suspender: false,
    aviso: `Notícia de alto impacto: ${lista}. Movimentos bruscos e spread largo são prováveis.`,
    eventos: proximos,
  };
}
