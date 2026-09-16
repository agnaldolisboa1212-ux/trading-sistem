import 'server-only';

/**
 * Leitura do estado dos motores e dos sinais de tempo real.
 *
 * Duas fontes, pela mesma lógica do resto do painel:
 *
 *   ficheiros em `data/`  — quando motor e painel vivem na mesma máquina. O
 *                           `motor-estado.json` tem batimento ao minuto, que é
 *                           a única forma de distinguir "à espera do próximo
 *                           cron" de "o processo morreu".
 *   Supabase              — tabelas `motor_execucoes` e `sinais_tempo_real`
 *                           (migração 0005), para quando vivem em sítios
 *                           diferentes.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getSupabase } from './supabase';

export interface ExecucaoMotor {
  iniciadoEm: string;
  terminadoEm: string;
  duracaoMs: number;
  instrumentos: number;
  sinais: number;
  novos: number;
  ok: boolean;
  resumo: string;
  erros: string[];
}

export interface EstadoMotores {
  fonte: 'ficheiro' | 'supabase' | 'nenhuma';
  /** Há um agendador vivo neste momento? */
  vivo: boolean;
  batimentoEm: string | null;
  modo: 'agendador' | 'unico' | null;
  crons: { diario: string; tempoReal: string } | null;
  aCorrer: string[];
  paradoEm: string | null;
  diario: ExecucaoMotor | null;
  tempoReal: ExecucaoMotor | null;
}

export interface SinalTempoRealLinha {
  id: string;
  simbolo: string;
  timeframe: string;
  estrategia: string;
  direccao: 'bullish' | 'bearish';
  entrada: number;
  stop: number;
  alvos: Array<{ preco: number; r: number }>;
  rMaximo: number;
  conviccao: number;
  concordam: number;
  razao: string;
  /** Abertura da vela que gerou o sinal (ISO). */
  geradoEm: string;
}

/**
 * O batimento chega a cada minuto. Três minutos sem ele é um processo morto,
 * não um atraso — uma passagem do motor principal demora segundos.
 */
const LIMITE_BATIMENTO_MS = 3 * 60_000;

function caminhos(nome: string): string[] {
  const lista: string[] = [];
  if (process.env.DATA_DIR) lista.push(resolve(process.env.DATA_DIR, nome));
  lista.push(resolve(process.cwd(), 'data', nome), resolve(process.cwd(), '..', '..', 'data', nome));
  return lista;
}

async function lerJson<T>(nome: string): Promise<T | null> {
  for (const p of caminhos(nome)) {
    try {
      return JSON.parse(await readFile(p, 'utf8')) as T;
    } catch {
      /* não existe aqui — tenta o próximo */
    }
  }
  return null;
}

interface FicheiroEstado {
  modo: 'agendador' | 'unico';
  actualizadoEm: string;
  paradoEm: string | null;
  crons: { diario: string; tempoReal: string } | null;
  aCorrer?: string[];
  diario: ExecucaoMotor | null;
  tempoReal: ExecucaoMotor | null;
}

export async function lerEstadoMotores(): Promise<EstadoMotores> {
  const f = await lerJson<FicheiroEstado>('motor-estado.json');
  if (f) {
    const batimento = Date.parse(f.actualizadoEm);
    const vivo =
      f.modo === 'agendador' &&
      !f.paradoEm &&
      Number.isFinite(batimento) &&
      Date.now() - batimento < LIMITE_BATIMENTO_MS;
    return {
      fonte: 'ficheiro',
      vivo,
      batimentoEm: f.actualizadoEm,
      modo: f.modo,
      crons: f.crons,
      aCorrer: vivo ? (f.aCorrer ?? []) : [],
      paradoEm: f.paradoEm,
      diario: f.diario,
      tempoReal: f.tempoReal,
    };
  }

  const db = getSupabase();
  if (db) {
    const ultima = async (motor: string): Promise<ExecucaoMotor | null> => {
      const { data, error } = await db
        .from('motor_execucoes')
        .select('*')
        .eq('motor', motor)
        .order('terminado_em', { ascending: false })
        .limit(1);
      const l = !error && data ? data[0] : null;
      if (!l) return null;
      return {
        iniciadoEm: l.iniciado_em,
        terminadoEm: l.terminado_em,
        duracaoMs: l.duracao_ms,
        instrumentos: l.instrumentos,
        sinais: l.sinais,
        novos: l.novos,
        ok: l.ok,
        resumo: l.resumo ?? '',
        erros: Array.isArray(l.erros) ? l.erros : [],
      };
    };

    const [diario, tempoReal] = await Promise.all([ultima('diario'), ultima('tempoReal')]);
    if (diario || tempoReal) {
      // O motor de tempo real grava na tabela pelo menos a cada 15 minutos.
      const fim = tempoReal ? Date.parse(tempoReal.terminadoEm) : NaN;
      return {
        fonte: 'supabase',
        vivo: Number.isFinite(fim) && Date.now() - fim < 20 * 60_000,
        batimentoEm: tempoReal?.terminadoEm ?? null,
        modo: null,
        crons: null,
        aCorrer: [],
        paradoEm: null,
        diario,
        tempoReal,
      };
    }
  }

  return {
    fonte: 'nenhuma',
    vivo: false,
    batimentoEm: null,
    modo: null,
    crons: null,
    aCorrer: [],
    paradoEm: null,
    diario: null,
    tempoReal: null,
  };
}

interface SinalFicheiro {
  id: string;
  simbolo: string;
  timeframe: string;
  estrategia: string;
  direccao: 'bullish' | 'bearish';
  entrada: number;
  stop: number;
  alvos: Array<{ preco: number; r: number }>;
  rMaximo: number;
  conviccao: number;
  concordam?: number;
  razao: string;
  geradoEm: number;
}

export async function lerSinaisTempoReal(limite = 8): Promise<SinalTempoRealLinha[]> {
  const db = getSupabase();
  if (db) {
    const { data, error } = await db
      .from('sinais_tempo_real')
      .select(
        'id,simbolo,timeframe,estrategia,direccao,entrada,stop,alvos,r_maximo,conviccao,concordam,razao,gerado_em',
      )
      .order('gerado_em', { ascending: false })
      .limit(limite);

    if (!error && data && data.length > 0) {
      return data.map((l) => ({
        id: l.id,
        simbolo: l.simbolo,
        timeframe: l.timeframe,
        estrategia: l.estrategia,
        direccao: l.direccao,
        entrada: Number(l.entrada),
        stop: Number(l.stop),
        alvos: Array.isArray(l.alvos) ? l.alvos : [],
        rMaximo: Number(l.r_maximo),
        conviccao: Number(l.conviccao),
        concordam: Number(l.concordam ?? 1),
        razao: l.razao ?? '',
        geradoEm: l.gerado_em,
      }));
    }
    // Tabela ainda por criar, ou vazia: o ficheiro local pode ter o que falta.
  }

  const f = await lerJson<{ recentes?: SinalFicheiro[] }>('sinais-tempo-real.json');
  return (f?.recentes ?? [])
    .slice(-limite)
    .reverse()
    .map((s) => ({
      id: s.id,
      simbolo: s.simbolo,
      timeframe: s.timeframe,
      estrategia: s.estrategia,
      direccao: s.direccao,
      entrada: s.entrada,
      stop: s.stop,
      alvos: s.alvos ?? [],
      rMaximo: s.rMaximo,
      conviccao: s.conviccao,
      concordam: s.concordam ?? 1,
      razao: s.razao,
      geradoEm: new Date(s.geradoEm).toISOString(),
    }));
}
