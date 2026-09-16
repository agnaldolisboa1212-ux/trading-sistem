'use client';

/**
 * Horário das bolsas — aberto/fechado e, sobretudo, QUANDO reabre.
 *
 * ── O PROBLEMA QUE ISTO RESOLVE ────────────────────────────────────────────
 *
 * A app dizia "fechado" a meio da semana e parecia avariada. Não estava: às
 * 00:45 de uma quarta-feira em Luanda/Maputo são 22:45 UTC, e os índices à
 * vista da Deriv negoceiam das 06:00 às 20:00 UTC. O S&P, o Nasdaq, o Dow e o
 * DAX estão mesmo fechados a essa hora — mas a palavra "fechado", sozinha, não
 * distingue "a bolsa está fechada" de "o sistema não conseguiu ler o preço".
 *
 * A diferença entre as duas é uma frase: **abre às 08:00**.
 *
 * ── DE ONDE VEM ────────────────────────────────────────────────────────────
 *
 *   `active_symbols`  → `exchange_is_open`, a resposta autoritativa de agora
 *   `trading_times`   → as sessões do dia, em UTC, por símbolo
 *
 * Medido (2026-09-15, tudo UTC):
 *
 *   OTC_SPC / OTC_NDX / OTC_DJI   06:00 → 20:00
 *   OTC_GDAXI                     06:00 → 19:30
 *   frxEURUSD                     00:00 → 23:59  (fecha ao fim de semana)
 *   frxXAUUSD                     00:00 → 21:00 e 22:00 → 23:59
 *   cryBTCUSD, R_75, 1HZ100V      24 horas
 *
 * Há símbolos com DUAS sessões no mesmo dia (o ouro pára uma hora). Por isso
 * as sessões são uma lista, e não um par abre/fecha.
 */

import { acharSimbolo } from './simbolos';
import { pedirDeriv } from './live';
import { useEffect, useState } from 'react';

export interface HorarioMercado {
  aberto: boolean;
  /** Fim da sessão atual (ms UTC), quando está aberto e se for conhecido. */
  fechaEm: number | null;
  /** Próxima abertura (ms UTC), quando está fechado. */
  abreEm: number | null;
}

interface Sessao {
  abre: number;
  fecha: number;
}

/** `exchange_is_open` muda à hora certa; um minuto de cache chega e sobra. */
const TTL_ABERTURA = 60_000;

/** Até onde procurar a próxima abertura. Sete dias cobrem qualquer feriado. */
const MAX_DIAS = 7;

/** Sessões por dia UTC (`YYYY-MM-DD`) e por código Deriv. Nunca expira: o
 *  horário de um dia que já passou não muda. */
const sessoesPorDia = new Map<string, Map<string, Sessao[]>>();

let abertos: { em: number; mapa: Map<string, boolean> } | null = null;
let aCarregarAbertos: Promise<Map<string, boolean>> | null = null;

function diaUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

interface SimboloHorario {
  underlying_symbol?: string;
  symbol?: string;
  times?: { open?: string[]; close?: string[] };
}

async function sessoesDe(dia: string): Promise<Map<string, Sessao[]>> {
  const guardado = sessoesPorDia.get(dia);
  if (guardado) return guardado;

  const mapa = new Map<string, Sessao[]>();
  try {
    const r = await pedirDeriv({ trading_times: dia });
    const mercados =
      ((r['trading_times'] as { markets?: Array<{ submarkets?: Array<{ symbols?: SimboloHorario[] }> }> })
        ?.markets ?? []);

    for (const m of mercados) {
      for (const sm of m.submarkets ?? []) {
        for (const s of sm.symbols ?? []) {
          const codigo = s.underlying_symbol ?? s.symbol;
          if (!codigo) continue;

          const abre = s.times?.open ?? [];
          const fecha = s.times?.close ?? [];
          const sessoes: Sessao[] = [];
          for (let i = 0; i < abre.length; i++) {
            const a = abre[i];
            const f = fecha[i] ?? a;
            // A Deriv escreve "--" nos dias em que o mercado não abre.
            if (!a || !f || a === '--' || f === '--') continue;
            const inicio = Date.parse(`${dia}T${a}Z`);
            const fim = Date.parse(`${dia}T${f}Z`);
            if (Number.isFinite(inicio) && Number.isFinite(fim)) sessoes.push({ abre: inicio, fecha: fim });
          }
          mapa.set(codigo, sessoes);
        }
      }
    }
  } catch {
    // Sem horários a interface diz só "fechado" — menos informação, nunca
    // informação errada.
  }

  sessoesPorDia.set(dia, mapa);
  return mapa;
}

async function estadoAbertura(): Promise<Map<string, boolean>> {
  if (abertos && Date.now() - abertos.em < TTL_ABERTURA) return abertos.mapa;

  // Um pedido de cada vez: dez linhas da lista a montar ao mesmo tempo não
  // podem disparar dez `active_symbols`.
  aCarregarAbertos ??= (async () => {
    const r = await pedirDeriv({ active_symbols: 'brief' });
    const mapa = new Map<string, boolean>();
    const lista = (r['active_symbols'] ?? []) as Array<{
      underlying_symbol?: string;
      symbol?: string;
      exchange_is_open?: number;
      is_trading_suspended?: number;
    }>;
    for (const x of lista) {
      const codigo = x.underlying_symbol ?? x.symbol;
      if (codigo) mapa.set(codigo, x.exchange_is_open === 1 && x.is_trading_suspended !== 1);
    }
    abertos = { em: Date.now(), mapa };
    return mapa;
  })().finally(() => {
    aCarregarAbertos = null;
  });

  return aCarregarAbertos;
}

export async function horarioDe(derivSymbol: string, agora = Date.now()): Promise<HorarioMercado> {
  const mapa = await estadoAbertura().catch(() => new Map<string, boolean>());
  // Símbolo desconhecido: não se afirma que está fechado. Dizer "fechado" sem
  // saber é o erro que esta camada existe para não repetir.
  const aberto = mapa.get(derivSymbol) ?? true;

  const hoje = (await sessoesDe(diaUtc(agora))).get(derivSymbol) ?? [];

  if (aberto) {
    const actual = hoje.find((s) => agora >= s.abre && agora <= s.fecha);
    return { aberto: true, fechaEm: actual?.fecha ?? null, abreEm: null };
  }

  const maisTarde = hoje.find((s) => s.abre > agora);
  if (maisTarde) return { aberto: false, fechaEm: null, abreEm: maisTarde.abre };

  for (let d = 1; d <= MAX_DIAS; d++) {
    const sessoes = (await sessoesDe(diaUtc(agora + d * 86_400_000))).get(derivSymbol) ?? [];
    const primeira = sessoes[0];
    if (primeira) return { aberto: false, fechaEm: null, abreEm: primeira.abre };
  }

  return { aberto: false, fechaEm: null, abreEm: null };
}

/**
 * Horário de um instrumento, reavaliado ao minuto.
 *
 * Ao minuto e não ao segundo porque o que muda é a hora de abertura — e o
 * pedido à Deriv está em cache, por isso a maior parte das reavaliações não
 * sai do browser.
 */
export function usarHorario(codigo: string, activo = true): HorarioMercado | null {
  const [horario, setHorario] = useState<HorarioMercado | null>(null);

  useEffect(() => {
    if (!activo) return;
    const s = acharSimbolo(codigo);
    if (!s) {
      setHorario(null);
      return;
    }

    let vivo = true;
    const actualizar = () => {
      void horarioDe(s.deriv)
        .then((r) => {
          if (vivo) setHorario(r);
        })
        .catch(() => undefined);
    };

    actualizar();
    const id = setInterval(() => {
      if (!document.hidden) actualizar();
    }, 60_000);

    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [codigo, activo]);

  return horario;
}

/**
 * "abre 08:00", "abre qua 08:00", ou `null` se estiver aberto.
 *
 * A hora sai na hora LOCAL de quem está a ver. O mercado fecha às 20:00 UTC,
 * mas quem está em Luanda quer ler "abre às 08:00", não uma conta de fusos.
 */
export function rotuloHorario(h: HorarioMercado | null, agora = Date.now()): string | null {
  if (!h || h.aberto) return null;
  if (!h.abreEm || h.abreEm <= agora) return 'fechado';

  const quando = new Date(h.abreEm);
  const hora = quando.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

  // Dentro de meio dia a hora chega; mais longe do que isso, sem o dia da
  // semana ficaria a parecer que abre daqui a nada.
  if (h.abreEm - agora < 12 * 3_600_000) return `abre ${hora}`;
  return `abre ${quando.toLocaleDateString('pt-PT', { weekday: 'short' })} ${hora}`;
}
