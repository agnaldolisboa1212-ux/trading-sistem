/**
 * O JORNAL DOS SINAIS — três edições por dia útil (29/09/2026).
 *
 * Pedido do Agnaldo: "mudar o que está a acontecer para 3x ao dia, como se
 * fosse um jornal de todos os sinais". Substitui o boletim "A que estar atento"
 * de hora a hora. Os sinais continuam a sair na hora em que nascem; o jornal é
 * o resumo:
 *
 *   07:30  Manhã — antes de Londres: o que ficou da noite, os POI do dia
 *   12:45  Meio-dia — antes de Nova Iorque
 *   21:30  Fecho do dia
 *
 * Hora de Lisboa = hora de Londres (o mesmo fuso, WET/WEST). Cada edição sai uma
 * vez: fica registada em `data/jornal.json`. Um motor parado à hora certa ainda
 * a envia até 90 minutos depois; mais tarde do que isso, salta-se.
 *
 * Conteúdo: sinais novos desde a edição anterior, os que estão em aberto, os
 * que fecharam (com o resultado em R) e o total do dia; os setups fixos do ICT
 * ALGO (`ict-fixo.ts`); os POI de Londres (manhã); e o que está perto de
 * disparar (as mesmas proximidades do antigo boletim).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { diaLondres, poisDeSessao, relogioLondres, type EstadoSetup, type Proximidade } from '@trading/core';
import { acharSimbolo, velasFechadasDeriv } from '@trading/data';
import { difundirJornal, type EdicaoJornal, type LinhaJornal } from '@trading/notify';
import { dirDados } from './estado.js';
import { lerEstadoIct } from './ict-fixo.js';

export const EDICOES = [
  { id: 'manha', minutos: 7 * 60 + 30, titulo: 'Manhã · antes de Londres' },
  { id: 'meio-dia', minutos: 12 * 60 + 45, titulo: 'Meio-dia · antes de Nova Iorque' },
  { id: 'fecho', minutos: 21 * 60 + 30, titulo: 'Fecho do dia' },
] as const;

/** Até quanto depois da hora uma edição ainda sai (motor parado, reinício). */
export const TOLERANCIA_EDICAO_MIN = 90;

const H = 3_600_000;
const FINAIS = new Set(['alvo-atingido', 'stop-atingido', 'perdido', 'expirado']);
const ABERTOS = new Set(['a-aguardar-entrada', 'em-curso']);

/**
 * A edição que deve sair agora, ou null. Pura: `enviadas` são as chaves
 * `dia|edição` já enviadas.
 */
export function edicaoDevida(
  agora: number,
  enviadas: ReadonlySet<string>,
): { chave: string; id: string; titulo: string } | null {
  const l = relogioLondres(agora);
  if (l.diaSemana === 0 || l.diaSemana === 6) return null;
  const dia = diaLondres(agora);
  for (const e of EDICOES) {
    if (l.minutos < e.minutos || l.minutos >= e.minutos + TOLERANCIA_EDICAO_MIN) continue;
    const chave = `${dia}|${e.id}`;
    if (!enviadas.has(chave)) return { chave, id: e.id, titulo: e.titulo };
  }
  return null;
}

interface Registo {
  enviadas: string[];
  ultimaEm: number;
}

const caminho = (): string => join(dirDados(), 'jornal.json');

function lerRegistoJornal(): Registo {
  try {
    const r = JSON.parse(readFileSync(caminho(), 'utf8')) as Partial<Registo>;
    return { enviadas: r.enviadas ?? [], ultimaEm: r.ultimaEm ?? 0 };
  } catch {
    return { enviadas: [], ultimaEm: 0 };
  }
}

function gravarRegistoJornal(r: Registo): void {
  mkdirSync(dirDados(), { recursive: true });
  writeFileSync(caminho(), JSON.stringify({ enviadas: r.enviadas.slice(-30), ultimaEm: r.ultimaEm }), 'utf8');
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface LinhaDb {
  simbolo: string;
  timeframe: string;
  estrategia: string;
  direccao: 'bullish' | 'bearish';
  entrada: number;
  stop: number;
  alvos: Array<{ preco: number; r: number }> | null;
  gerado_em: string;
  estado?: string | null;
  resultado_r?: number | null;
  acompanhado_em?: string | null;
}

function paraLinha(s: LinhaDb): LinhaJornal {
  const alvo = s.alvos?.[0];
  return {
    simbolo: s.simbolo,
    timeframe: s.timeframe,
    estrategia: s.estrategia,
    direccao: s.direccao,
    entrada: Number(s.entrada),
    stop: Number(s.stop),
    alvo: alvo ? { preco: Number(alvo.preco), r: Number(alvo.r) } : null,
    geradoEm: Date.parse(s.gerado_em),
    estado: s.estado ?? null,
    resultadoR: s.resultado_r === null || s.resultado_r === undefined ? null : Number(s.resultado_r),
    casas: acharSimbolo(s.simbolo)?.casas ?? 5,
  };
}

/** O estado do setup fixo, em palavras curtas. */
function estadoIct(e: EstadoSetup | null): string {
  if (!e) return 'a calcular';
  switch (e.estado) {
    case 'a-espera-da-zona':
      return 'à espera da zona';
    case 'na-zona':
      return 'na zona, à espera da reversão em 15M';
    case 'disparado':
      return `TIRO disparado (${e.tiro.rr.toFixed(1)}R)`;
    case 'invalidado':
      return `invalidado: ${e.motivo}`;
    default:
      return 'expirado';
  }
}

/**
 * Chamado no fim de cada passagem do tempo real. Envia a edição devida, se a
 * houver; devolve se enviou.
 */
export async function publicarJornal(input: {
  db: SupabaseClient | null;
  simbolos: readonly string[];
  atencao: readonly Proximidade[];
  erros: string[];
  agora?: number;
}): Promise<boolean> {
  const agora = input.agora ?? Date.now();
  const reg = lerRegistoJornal();
  const devida = edicaoDevida(agora, new Set(reg.enviadas));
  if (!devida) return false;

  // O período coberto: desde a edição anterior, no máximo 24 h.
  const desde = Math.max(reg.ultimaEm, agora - 24 * H);
  const l = relogioLondres(agora);
  const inicioDoDia = agora - l.minutos * 60_000 - (agora % 60_000);

  let linhas: LinhaDb[] = [];
  if (input.db) {
    try {
      const { data, error } = await input.db
        .from('sinais_tempo_real')
        .select('simbolo,timeframe,estrategia,direccao,entrada,stop,alvos,gerado_em,estado,resultado_r,acompanhado_em')
        .gte('gerado_em', new Date(agora - 7 * 24 * H).toISOString())
        .order('gerado_em', { ascending: false })
        .limit(500);
      if (error) input.erros.push(`jornal: ${error.message}`);
      else linhas = (data ?? []) as LinhaDb[];
    } catch (e) {
      input.erros.push(`jornal: ${msg(e)}`);
    }
  }
  const fechouEm = (s: LinhaDb) => (s.acompanhado_em ? Date.parse(s.acompanhado_em) : Date.parse(s.gerado_em));
  const novos = linhas.filter((s) => Date.parse(s.gerado_em) >= desde);
  const emAberto = linhas.filter((s) => ABERTOS.has(s.estado ?? '') && Date.parse(s.gerado_em) < desde);
  const fechados = linhas.filter((s) => FINAIS.has(s.estado ?? '') && fechouEm(s) >= desde);
  const doDia = linhas.filter((s) => FINAIS.has(s.estado ?? '') && fechouEm(s) >= inicioDoDia && s.resultado_r !== null && s.resultado_r !== undefined);

  // Os setups fixos do ICT ALGO que o motor segue.
  const ict = lerEstadoIct();
  const setupsIct: EdicaoJornal['setupsIct'] = [];
  for (const [codigo, r] of Object.entries(ict)) {
    if (!r.setup) continue;
    setupsIct.push({
      simbolo: codigo,
      casas: acharSimbolo(codigo)?.casas ?? 5,
      direccao: r.setup.direccao,
      modelo: r.setup.modelo,
      zonaBaixa: r.setup.zonaBaixa,
      zonaAlta: r.setup.zonaAlta,
      alvo: r.estado && 'alvo' in r.estado && r.estado.alvo !== undefined ? r.estado.alvo : r.setup.alvo,
      estado: estadoIct(r.estado),
    });
  }

  // Os POI de Londres: só na edição da manhã (a leitura provisória das 07:30).
  const pois: EdicaoJornal['pois'] = [];
  if (devida.id === 'manha') {
    for (const codigo of input.simbolos) {
      const s = acharSimbolo(codigo);
      if (!s || !s.deriv.startsWith('frx')) continue;
      try {
        const v15 = await velasFechadasDeriv(s.deriv, 900, 800);
        const leitura = poisDeSessao(v15, agora);
        if (!leitura || leitura.pois.length === 0) continue;
        pois.push({
          simbolo: s.codigo,
          casas: s.casas,
          lado: leitura.vies === 'bearish' ? 'venda' : 'compra',
          zonas: leitura.pois.slice(0, 3).map((z) => ({ baixo: z.baixo, alto: z.alto })),
        });
      } catch (e) {
        input.erros.push(`jornal (POI ${s.codigo}): ${msg(e)}`);
      }
    }
  }

  const edicao: EdicaoJornal = {
    titulo: devida.titulo,
    em: agora,
    desde,
    novos: novos.map(paraLinha),
    emAberto: emAberto.map(paraLinha),
    fechados: fechados.map(paraLinha),
    dia: { r: doDia.reduce((t, s) => t + Number(s.resultado_r), 0), n: doDia.length },
    setupsIct,
    pois,
    atencao: [...input.atencao].sort((a, b) => a.distanciaAtr - b.distanciaAtr).slice(0, 5),
  };

  const resultados = await difundirJornal(edicao);
  for (const r of resultados) if (!r.ok && !r.skipped) input.erros.push(`jornal ${r.channel}: ${r.error}`);
  // Regista mesmo com um canal em baixo: repetir a edição no minuto seguinte
  // seria pior do que perdê-la num canal.
  try {
    gravarRegistoJornal({ enviadas: [...reg.enviadas, devida.chave], ultimaEm: agora });
  } catch (e) {
    input.erros.push(`jornal (registo local): ${msg(e)}`);
  }
  return true;
}
