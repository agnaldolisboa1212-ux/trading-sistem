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
 */

import type { Candle } from '@trading/core';
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

async function pedir(derivSymbol: string, gran: number, count: number): Promise<Candle[]> {
  const libertar = await ritmo.vez();
  let r: Record<string, unknown>;
  try {
    r = await pedirDeriv({
      ticks_history: derivSymbol,
      adjust_start_time: 1,
      count,
      end: 'latest',
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

  const promessa = pedir(derivSymbol, gran, count);
  emCurso.set(chave, { count, promessa });
  try {
    const velas = await promessa;
    cache.set(chave, { count, velas, em: Date.now() });
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
