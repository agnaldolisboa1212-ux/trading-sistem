/**
 * Notícias de alto impacto e posicionamento institucional — só fontes oficiais
 * ou de referência, e só o que move mercados.
 *
 *   calendário       Forex Factory (semana actual): só eventos marcados HIGH —
 *                    decisões de juros, CPI, emprego (NFP), PIB...
 *   bancos centrais  comunicados de política monetária: Fed (feed oficial de
 *                    política monetária), BCE e Banco de Inglaterra filtrados
 *                    pelos que tratam de juros
 *   COT              CFTC, Traders in Financial Futures: posição líquida dos
 *                    gestores de activos (fundos de pensões, mútuos) e dos
 *                    fundos alavancados (hedge funds, CTAs) em S&P 500,
 *                    Nasdaq 100, Dow e Bitcoin, com o percentil de 3 anos
 *
 * Cada fonte tem memória própria (o calendário muda pouco; o COT é semanal) e
 * falha sozinha: uma fonte em baixo devolve lista vazia, não derruba as outras.
 * Não há aqui "rumores" nem fóruns: não são verificáveis.
 */

import type { EventoEconomico } from '@trading/core';

const UA = { 'User-Agent': 'Mozilla/5.0 (TrivoHub; +https://trivohub.io)' };

interface Memoria<T> {
  ate: number;
  valor: T;
}

function comMemoria<T>(ttlMs: number, obter: () => Promise<T>, vazio: T): () => Promise<T> {
  let memoria: Memoria<T> | null = null;
  let emCurso: Promise<T> | null = null;
  return async () => {
    if (memoria && memoria.ate > Date.now()) return memoria.valor;
    emCurso ??= obter()
      .then((valor) => {
        memoria = { ate: Date.now() + ttlMs, valor };
        return valor;
      })
      .catch(() => memoria?.valor ?? vazio)
      .finally(() => {
        emCurso = null;
      });
    return emCurso;
  };
}

// ---------------------------------------------------------------------------
// Calendário económico
// ---------------------------------------------------------------------------

interface EventoForexFactory {
  title: string;
  country: string;
  date: string;
  impact: string;
  forecast?: string;
  previous?: string;
}

/** Eventos de ALTO impacto da semana actual (UTC). Memória de 30 minutos. */
export const calendarioAltoImpacto = comMemoria<EventoEconomico[]>(
  30 * 60_000,
  async () => {
    const r = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
      headers: UA,
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(`calendário HTTP ${r.status}`);
    const lista = (await r.json()) as EventoForexFactory[];
    return lista
      .filter((e) => e.impact === 'High')
      .map((e) => ({
        titulo: e.title,
        moeda: e.country.toUpperCase(),
        em: Date.parse(e.date),
        previsao: e.forecast || null,
        anterior: e.previous || null,
      }))
      .filter((e) => Number.isFinite(e.em))
      .sort((a, b) => a.em - b.em);
  },
  [],
);

// ---------------------------------------------------------------------------
// Comunicados dos bancos centrais
// ---------------------------------------------------------------------------

export interface Comunicado {
  fonte: 'Fed' | 'BCE' | 'Banco de Inglaterra';
  titulo: string;
  url: string;
  em: number;
}

function itensRss(xml: string): Array<{ titulo: string; url: string; em: number }> {
  const itens: Array<{ titulo: string; url: string; em: number }> = [];
  const limpar = (t: string) =>
    t
      .replace(/<!\[CDATA\[|\]\]>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/<[^>]+>/g, '')
      .trim();
  for (const bloco of xml.match(/<item[\s>][\s\S]*?<\/item>/g) ?? []) {
    const titulo = limpar(bloco.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
    const url = limpar(bloco.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? '');
    const data = limpar(bloco.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? bloco.match(/<dc:date>([\s\S]*?)<\/dc:date>/)?.[1] ?? '');
    const em = Date.parse(data);
    if (titulo && url.startsWith('https://') && Number.isFinite(em)) itens.push({ titulo, url, em });
  }
  return itens;
}

async function lerRss(url: string): Promise<Array<{ titulo: string; url: string; em: number }>> {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`${url} HTTP ${r.status}`);
  return itensRss(await r.text());
}

/** Comunicados de política monetária dos últimos 45 dias. Memória de 30 minutos. */
export const comunicadosBancosCentrais = comMemoria<Comunicado[]>(
  30 * 60_000,
  async () => {
    const desde = Date.now() - 45 * 86_400_000;
    const fonte = (url: string, nome: Comunicado['fonte'], filtro?: RegExp): Promise<Comunicado[]> =>
      lerRss(url).then((l) =>
        l.filter((i) => !filtro || filtro.test(i.titulo)).map((i): Comunicado => ({ ...i, fonte: nome })),
      );
    const fontes = await Promise.allSettled([
      fonte('https://www.federalreserve.gov/feeds/press_monetary.xml', 'Fed'),
      fonte('https://www.ecb.europa.eu/rss/press.html', 'BCE', /monetary policy|interest rate|policy decision/i),
      fonte('https://www.bankofengland.co.uk/rss/news', 'Banco de Inglaterra', /monetary policy|bank rate/i),
    ]);
    return fontes
      .flatMap((f) => (f.status === 'fulfilled' ? f.value : []))
      .filter((c) => c.em >= desde)
      .sort((a, b) => b.em - a.em)
      .slice(0, 20);
  },
  [],
);

// ---------------------------------------------------------------------------
// COT — posicionamento dos fundos (CFTC)
// ---------------------------------------------------------------------------

export interface PosicionamentoCot {
  simbolo: string;
  mercado: string;
  /** Data do relatório (terça-feira, publicado à sexta). */
  relatorio: string;
  /** Gestores de activos: posição líquida em % do open interest. */
  gestores: { liquidoPct: number; percentil3a: number; variacaoSemana: number };
  /** Fundos alavancados (hedge funds, CTAs): posição líquida em % do open interest. */
  alavancados: { liquidoPct: number; percentil3a: number; variacaoSemana: number };
}

const CONTRATOS_COT: ReadonlyArray<{ simbolo: string; mercado: string; codigo: string }> = [
  { simbolo: 'SP500', mercado: 'S&P 500', codigo: '13874+' },
  { simbolo: 'US100', mercado: 'Nasdaq 100', codigo: '20974+' },
  { simbolo: 'US30', mercado: 'Dow Jones', codigo: '12460+' },
  { simbolo: 'BTCUSD', mercado: 'Bitcoin (CME)', codigo: '133741' },
];

interface LinhaCot {
  report_date_as_yyyy_mm_dd: string;
  open_interest_all: string;
  asset_mgr_positions_long: string;
  asset_mgr_positions_short: string;
  lev_money_positions_long: string;
  lev_money_positions_short: string;
}

function percentil(valor: number, amostra: readonly number[]): number {
  if (amostra.length === 0) return 0.5;
  return amostra.filter((x) => x <= valor).length / amostra.length;
}

/** Posicionamento mais recente, com percentil de 156 semanas. Memória de 6 horas. */
export const posicionamentoCot = comMemoria<PosicionamentoCot[]>(
  6 * 60 * 60_000,
  async () => {
    const resultados = await Promise.allSettled(
      CONTRATOS_COT.map(async (c) => {
        const q = new URLSearchParams({
          cftc_contract_market_code: c.codigo,
          $limit: '160',
          $order: 'report_date_as_yyyy_mm_dd DESC',
          $select:
            'report_date_as_yyyy_mm_dd,open_interest_all,asset_mgr_positions_long,asset_mgr_positions_short,lev_money_positions_long,lev_money_positions_short',
        });
        const r = await fetch(`https://publicreporting.cftc.gov/resource/gpe5-46if.json?${q}`, {
          headers: UA,
          signal: AbortSignal.timeout(20_000),
        });
        if (!r.ok) throw new Error(`CFTC HTTP ${r.status}`);
        const linhas = ((await r.json()) as LinhaCot[])
          .map((l) => {
            const oi = Number(l.open_interest_all);
            return {
              data: l.report_date_as_yyyy_mm_dd.slice(0, 10),
              gestores: oi > 0 ? ((Number(l.asset_mgr_positions_long) - Number(l.asset_mgr_positions_short)) / oi) * 100 : NaN,
              alavancados: oi > 0 ? ((Number(l.lev_money_positions_long) - Number(l.lev_money_positions_short)) / oi) * 100 : NaN,
            };
          })
          .filter((l) => Number.isFinite(l.gestores) && Number.isFinite(l.alavancados));
        const [ultima, anterior] = linhas;
        if (!ultima) throw new Error('COT vazio');
        const amostra = linhas.slice(0, 156);
        return {
          simbolo: c.simbolo,
          mercado: c.mercado,
          relatorio: ultima.data,
          gestores: {
            liquidoPct: ultima.gestores,
            percentil3a: percentil(ultima.gestores, amostra.map((l) => l.gestores)),
            variacaoSemana: anterior ? ultima.gestores - anterior.gestores : 0,
          },
          alavancados: {
            liquidoPct: ultima.alavancados,
            percentil3a: percentil(ultima.alavancados, amostra.map((l) => l.alavancados)),
            variacaoSemana: anterior ? ultima.alavancados - anterior.alavancados : 0,
          },
        } satisfies PosicionamentoCot;
      }),
    );
    return resultados.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  },
  [],
);
