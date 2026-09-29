'use client';

/**
 * Velas fechadas pedidas PELO BROWSER à Deriv — para as análises do gráfico e
 * do painel de agentes.
 *
 * ── PORQUE NÃO PELO SERVIDOR ───────────────────────────────────────────────
 *
 * Medido a 26/09/2026: o servidor (Hostinger) levava "RateLimit: You have
 * reached the rate limit for ticks_history" com o mercado fechado e quase sem
 * tráfego nosso — o motor, noutra ligação, levava o mesmo em `active_symbols`.
 * Daqui (outro IP), 60 séries de uma vez passavam todas. O endpoint público da
 * Deriv limita o IP do servidor, que no alojamento é partilhado com outros
 * sites; nenhum travão do nosso lado resolve o tráfego dos outros.
 *
 * O browser de cada pessoa tem o seu IP e a sua ligação — a mesma de que o
 * gráfico já vive (`live.ts`). As análises passam a ser calculadas aqui: o
 * servidor deixa de pedir velas à Deriv para o painel, e o que sobra dessa
 * quota fica para o motor, que envia os sinais.
 *
 * O travão e a cache são os do servidor (`@trading/data/ritmo`): 15 pedidos de
 * seguida e depois 2 por segundo, a cópia vale até fechar a vela seguinte, e
 * um RateLimit pára a ligação 55 s servindo a última cópia guardada.
 *
 * E a paginação também (`@trading/data/paginar`): a Deriv devolve uma janela
 * por pedido (695 velas de 1H, 620 de 15M), não as 3500 que o ICT ALGO pede.
 * Cada página é um pedido e passa pelo travão; ao refrescar, a cópia guardada
 * dá as velas antigas e só se pede o que falta até ela.
 */

import type { Candle } from '@trading/core';
import { paginarVelas, type OpcoesPaginacao, type PedirPagina } from '@trading/data/paginar';
import { RitmoPedidos } from '@trading/data/ritmo';
import { pedirDeriv } from './live';

const ritmo = new RitmoPedidos({
  maxEmVoo: 4,
  rajada: 15,
  porSegundo: 2,
  pausaMs: 55_000,
  // O painel de agentes pede dezenas de séries de uma vez ao abrir: esperar na
  // fila é melhor do que falhar.
  esperaMaximaMs: 60_000,
});

/** Um pedido feito tão perto do fecho pode ainda não trazer a vela que acabou de fechar. */
const FOLGA_FECHO_MS = 3_000;
/** Uma cópia guardada só é servida num RateLimit se tiver menos do que isto. */
const VELHAS_MAX_MS = 15 * 60_000;

interface Guardadas {
  count: number;
  velas: Candle[];
  em: number;
}

const cache = new Map<string, Guardadas>();
const emCurso = new Map<string, { count: number; promessa: Promise<Candle[]> }>();

/** Até `count` velas, por páginas; se uma página falhar, falha o conjunto (há a cópia guardada). */
async function pedir(derivSymbol: string, gran: number, count: number, opcoes: OpcoesPaginacao): Promise<Candle[]> {
  const pagina: PedirPagina = async (quantas, end) => {
    const libertar = await ritmo.vez();
    let r: Record<string, unknown>;
    try {
      r = await pedirDeriv({
        ticks_history: derivSymbol,
        adjust_start_time: 1,
        count: quantas,
        end,
        start: 1,
        style: 'candles',
        granularity: gran,
      });
    } finally {
      libertar();
    }
    const erro = r['error'] as { code?: string; message?: string } | undefined;
    if (erro) {
      if (erro.code === 'RateLimit') ritmo.bloquear();
      throw new Error(`Deriv ${erro.code ?? 'erro'}: ${erro.message ?? ''}`.trim());
    }
    const brutas = (r['candles'] ?? []) as Array<{ epoch: number; open: number; high: number; low: number; close: number }>;
    return brutas.map((c) => ({
      time: Number(c.epoch) * 1000,
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      // A Deriv não entrega volume em ticks_history.
      volume: 0,
    }));
  };
  return (await paginarVelas(pagina, gran, count, opcoes)).velas;
}

/**
 * Até `quantidade` velas FECHADAS de `derivSymbol` na granularidade `gran`
 * (segundos). Pedidos iguais em curso partilham a resposta.
 */
export async function velasFechadasBrowser(derivSymbol: string, gran: number, quantidade: number): Promise<Candle[]> {
  const passo = gran * 1000;
  const chave = `${derivSymbol}:${gran}`;
  const count = Math.min(5000, quantidade + 1);
  const fechadas = (v: Candle[]): Candle[] => {
    const agora = Date.now();
    return v.filter((c) => c.time + passo <= agora).slice(-quantidade);
  };
  const guardada = cache.get(chave);
  const periodo = Math.floor(Date.now() / passo) * passo;
  const serve = (g: Guardadas | undefined): g is Guardadas => !!g && g.count >= count;

  // Nenhuma vela fechou desde o pedido: as fechadas são as mesmas.
  if (serve(guardada) && guardada.em >= periodo + FOLGA_FECHO_MS) return fechadas(guardada.velas);
  // Ligação em pausa por um RateLimit: a cópia guardada, sem entrar na fila.
  if (serve(guardada) && ritmo.pausadaAte() > 0 && Date.now() - guardada.em < VELHAS_MAX_MS) {
    return fechadas(guardada.velas);
  }

  const igual = emCurso.get(chave);
  if (igual && igual.count >= count) return fechadas(await igual.promessa);

  // Até à maior quantidade já guardada: as velas antigas vêm da cópia, e quem
  // pede menos (o radar, 1500) não encurta a cópia de quem pede mais (o ICT, 3500).
  // Sem vela fechada desde a cópia, só falta o que está para trás dela.
  const alvo = Math.max(count, guardada?.count ?? 0);
  const fresca = !!guardada && guardada.em >= periodo + FOLGA_FECHO_MS;
  const promessa = pedir(derivSymbol, gran, alvo, { guardadas: guardada?.velas, fresca });
  emCurso.set(chave, { count: alvo, promessa });
  try {
    const velas = await promessa;
    cache.set(chave, { count: alvo, velas, em: Date.now() });
    return fechadas(velas);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/RateLimit/.test(msg) && serve(guardada) && Date.now() - guardada.em < VELHAS_MAX_MS) {
      return fechadas(guardada.velas);
    }
    throw e;
  } finally {
    if (emCurso.get(chave)?.promessa === promessa) emCurso.delete(chave);
  }
}
