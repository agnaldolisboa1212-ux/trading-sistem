/**
 * Motor SECUNDÁRIO — análise em tempo real.
 *
 * O motor principal (MMXM + SMT, `scan.ts`) corre uma vez por dia sobre velas
 * diárias fechadas. Este corre a cada minuto sobre os instrumentos e timeframes
 * que as pessoas escolheram, e só com as ESTRATÉGIAS VALIDADAS
 * (`@trading/core`, `strategies/validadas.ts`): as que mostraram vantagem
 * medida, dentro e fora da amostra, com custos — mais as EM TESTE
 * (`strategies/em-teste.ts`), que correm ao vivo marcadas como tal. O SMT em
 * teste precisa das velas das referências (GBPUSD, prata, os cinco pares do
 * DXY) e de 4h do próprio instrumento; pedem-se só quando fecha uma vela.
 *
 * As quatro institucionais antigas continuam no gráfico como contexto, mas
 * deixaram de gerar sinais — no backtest perdiam dinheiro depois do spread.
 *
 * ── CICLO ──────────────────────────────────────────────────────────────────
 *
 *   1. vigilância    INTRADAY_SYMBOLS → perfis do Supabase → lista por omissão
 *   2. velas         Deriv, endpoint público, por código Deriv
 *   3. cortar        a vela em formação nunca entra na análise
 *   4. analisar      `runInstitutionalStrategies`, só sinais da última vela
 *   5. confluência   um sinal por símbolo/timeframe; conflito → nada
 *   6. deduplicar    id determinístico, ficheiro local + Supabase
 *   7. anunciar      Telegram, n8n, push
 *
 * ── O QUE NÃO FAZ ──────────────────────────────────────────────────────────
 *
 * Não abre posições nem envia ordens. Estes sinais também não entram na gestão
 * de posições paper do motor principal: essa é calibrada em velas diárias, e
 * avaliar um stop de 15 minutos com velas diárias daria resultados inventados.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  acompanharOperacao,
  estadoDoPlano,
  estrategiaActiva,
  estrategiaEmTeste,
  estrategiasPara,
  executarEstrategiasValidadas,
  fraseEvento,
  planoVivo,
  riscoDeNoticias,
  timeframesDoPerfil,
  velasNecessariasSmt,
  VELAS_ATE_EXPIRAR,
  type Candle,
  type DadosExtra,
  type EventoOperacao,
  type StrategySignal,
  type Timeframe,
} from '@trading/core';
import { acharSimbolo, calendarioAltoImpacto, mercadosAbertosDeriv, velasDeriv } from '@trading/data';
import { createDbClient, isDbConfigured } from '@trading/db';
import { difundirAvisoOperacao, difundirSinalTempoReal, type SinalTempoReal } from '@trading/notify';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EngineConfig } from '../config.js';
import { dirDados, tabelaAusente } from './estado.js';
import {
  GRANULARIDADE_S,
  avaliarPrecoActual,
  cortarVelaAberta,
  escolherPares,
  escolherPorConfluencia,
  filtrarRepintagem,
  idSinal,
  mercadoParado,
  sinalFresco,
  validadeAvisoS,
  type OrigemVigilancia,
  type PerfilVigilancia,
  type PlanoAnterior,
} from './tempo-real-puro.js';

/** Vigilância por omissão: um de cada classe, mais dois que negoceiam 24/7. */
export const VIGILANCIA_OMISSAO = [
  'EURUSD',
  'GBPUSD',
  'US100',
  'SP500',
  'US30',
  'GER30',
  'XAUUSD',
  'BTCUSD',
  'V75',
  'V100S',
];

/** Abaixo disto as estratégias recusam-se (S&R exige histórico mínimo). */
const MIN_VELAS = 60;

/**
 * Última vela fechada já analisada, por `símbolo|timeframe`.
 *
 * O motor passa a cada minuto, mas uma vela de 15m só fecha a cada quinze. Sem
 * isto seriam 120 pedidos por hora por instrumento para analisar sempre a mesma
 * vela; com isto são 4 (15m) mais 1 (1h). Em memória de propósito: num reinício
 * a primeira passagem analisa tudo, e a deduplicação por id impede anúncios
 * repetidos.
 */
const ultimaFechadaVista = new Map<string, number>();

/**
 * O registo local já foi copiado para o Supabase neste processo?
 *
 * Enquanto a tabela `sinais_tempo_real` não existia, os sinais só ficaram no
 * ficheiro — e como o ficheiro os marca como anunciados, nunca mais seriam
 * inseridos. Medido: a migração foi aplicada com o motor a correr, e o V100S
 * das 08:15 ficou fora da base de dados para sempre. Na primeira passagem em
 * que a tabela responde, copiam-se os recentes de uma vez.
 */
let sincronizado = false;

export interface AnaliseTempoReal {
  /** Avisos de andamento enviados nesta passagem (entrada, +1R, stop, saída, viés...). */
  andamento?: string[];
  simbolo: string;
  timeframe: string;
  velas: number;
  sinaisFrescos: number;
  /** Candidatos travados porque já há plano vivo neste instrumento e timeframe. */
  repetidos?: number;
  conflito: boolean;
  escolhido: SinalTempoReal | null;
  novo: boolean;
  nota?: string;
}

export interface RelatorioTempoReal {
  iniciadoEm: number;
  terminadoEm: number;
  origem: OrigemVigilancia;
  simbolos: string[];
  timeframes: string[];
  analises: AnaliseTempoReal[];
  novos: SinalTempoReal[];
  persistencia: 'supabase' | 'ficheiro';
  /** Pares símbolo/timeframe sem vela nova desde a passagem anterior. */
  saltados: number;
  erros: string[];
}

// ---------------------------------------------------------------------------
// Registo local — deduplicação que sobrevive a reinícios
// ---------------------------------------------------------------------------

interface Registo {
  ids: string[];
  recentes: SinalTempoReal[];
}

function caminhoRegisto(): string {
  return join(dirDados(), 'sinais-tempo-real.json');
}

function lerRegisto(): Registo {
  try {
    const j = JSON.parse(readFileSync(caminhoRegisto(), 'utf8')) as Partial<Registo>;
    return {
      ids: Array.isArray(j.ids) ? j.ids : [],
      recentes: Array.isArray(j.recentes) ? j.recentes : [],
    };
  } catch {
    return { ids: [], recentes: [] };
  }
}

/**
 * Eventos de andamento já avisados, por id de sinal — a rede de segurança local
 * quando a migração 0007 ainda não está aplicada no Supabase.
 */
function caminhoAvisados(): string {
  return join(dirDados(), 'eventos-avisados.json');
}

function lerAvisados(): Record<string, string[]> {
  try {
    return JSON.parse(readFileSync(caminhoAvisados(), 'utf8')) as Record<string, string[]>;
  } catch {
    return {};
  }
}

function gravarAvisados(a: Record<string, string[]>): void {
  // Só os 500 sinais mais recentes: os antigos já não produzem eventos.
  const entradas = Object.entries(a).slice(-500);
  mkdirSync(dirDados(), { recursive: true });
  writeFileSync(caminhoAvisados(), JSON.stringify(Object.fromEntries(entradas)), 'utf8');
}

function gravarRegisto(r: Registo): void {
  mkdirSync(dirDados(), { recursive: true });
  writeFileSync(
    caminhoRegisto(),
    // Os últimos 2000 ids chegam para semanas de deduplicação; os últimos 100
    // sinais são o que o painel mostra quando não há Supabase.
    JSON.stringify({ ids: r.ids.slice(-2000), recentes: r.recentes.slice(-100) }, null, 2),
    'utf8',
  );
}

// ---------------------------------------------------------------------------

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function lerPerfis(db: SupabaseClient | null, erros: string[]): Promise<PerfilVigilancia[]> {
  if (!db) return [];
  try {
    let resposta: { data: unknown[] | null; error: { message: string; code?: string } | null } = await db
      .from('perfis_utilizador')
      .select('instrumentos,objetivos,timeframes_sinais');
    if (resposta.error && /timeframes_sinais|column/i.test(resposta.error.message)) {
      // Migração 0008 por aplicar: valem os timeframes do objetivo.
      resposta = await db.from('perfis_utilizador').select('instrumentos,objetivos');
    }
    const { data, error } = resposta;
    if (error) {
      if (!tabelaAusente(error)) erros.push(`perfis: ${error.message}`);
      return [];
    }
    return (
      (data ?? []) as Array<{ instrumentos?: string[] | null; objetivos?: string[] | null; timeframes_sinais?: string[] | null }>
    ).map((l) => ({
      instrumentos: l.instrumentos ?? [],
      objetivos: l.objetivos ?? [],
      timeframes: l.timeframes_sinais ?? [],
    }));
  } catch (err) {
    erros.push(`perfis: ${msg(err)}`);
    return [];
  }
}

/**
 * Planos anunciados recentemente, por `símbolo|timeframe`, para a
 * anti-repintagem. Do Supabase quando há; sempre também do registo local.
 */
async function lerPlanosRecentes(
  db: SupabaseClient | null,
  locais: readonly SinalTempoReal[],
  erros: string[],
): Promise<Map<string, PlanoAnterior[]>> {
  const mapa = new Map<string, PlanoAnterior[]>();
  const juntar = (simbolo: string, timeframe: string, p: PlanoAnterior) => {
    const k = `${simbolo}|${timeframe}`;
    const lista = mapa.get(k) ?? [];
    if (!lista.some((x) => x.id === p.id)) lista.push(p);
    mapa.set(k, lista);
  };
  for (const s of locais) {
    juntar(s.simbolo, s.timeframe, {
      id: s.id,
      estrategia: s.estrategia,
      direccao: s.direccao,
      entrada: s.entrada,
      stop: s.stop,
      alvo: s.alvos[0]?.preco ?? null,
      alvos: s.alvos,
      geradoEm: s.geradoEm,
    });
  }
  if (!db) return mapa;
  try {
    // Um plano diário expira ao fim de 20 velas diárias, e a tendência pode durar
    // meses: a janela tem de cobrir ambos.
    const desde = new Date(Date.now() - 120 * 86_400_000).toISOString();
    const base = 'id,simbolo,timeframe,estrategia,direccao,entrada,stop,alvos,gerado_em';
    let resposta: { data: unknown[] | null; error: { message: string; code?: string } | null } = await db
      .from('sinais_tempo_real')
      .select(`${base},estado,eventos`)
      .gte('gerado_em', desde)
      .order('gerado_em', { ascending: false })
      .limit(2000);
    const semColunas = Boolean(resposta.error && /estado|eventos|column/i.test(resposta.error.message));
    if (semColunas) {
      // Migração 0007 por aplicar: sem estado guardado, vale o ficheiro local.
      resposta = await db
        .from('sinais_tempo_real')
        .select(base)
        .gte('gerado_em', desde)
        .order('gerado_em', { ascending: false })
        .limit(2000);
    }
    const { data, error } = resposta;
    if (error) {
      if (!tabelaAusente(error)) erros.push(`planos recentes: ${error.message}`);
      return mapa;
    }
    for (const l of (data ?? []) as unknown as Array<Record<string, unknown>>) {
      const alvosBrutos = Array.isArray(l['alvos']) ? (l['alvos'] as Array<{ preco?: number }>) : [];
      const alvos = alvosBrutos
        .map((a) => ({ preco: Number(a.preco) }))
        .filter((a) => Number.isFinite(a.preco));
      const eventos = Array.isArray(l['eventos']) ? (l['eventos'] as Array<{ chave?: string }>) : null;
      const estado = typeof l['estado'] === 'string' ? l['estado'] : null;
      juntar(String(l['simbolo']), String(l['timeframe']), {
        id: String(l['id']),
        estrategia: String(l['estrategia']),
        direccao: l['direccao'] === 'bearish' ? 'bearish' : 'bullish',
        entrada: Number(l['entrada']),
        stop: Number(l['stop']),
        alvo: alvos[0]?.preco ?? null,
        alvos,
        geradoEm: Date.parse(String(l['gerado_em'])),
        avisados: semColunas ? null : (eventos ?? []).map((e) => String(e.chave)),
        terminado: estado === 'fechada' || estado === 'expirado' || estado === 'perdido',
      });
    }
  } catch (err) {
    erros.push(`planos recentes: ${msg(err)}`);
  }
  return mapa;
}

/** Planos que continuam vivos (à espera da entrada, em curso ou protegidos) nestas velas. */
function planosVivos(planos: readonly PlanoAnterior[], velas: readonly Candle[]): PlanoAnterior[] {
  return planos.filter((p) => {
    if (p.terminado) return false;
    if (estrategiaActiva(p.estrategia) && velas.some((v) => v.time === p.geradoEm)) {
      const e = acompanharOperacao({ ...p, alvos: p.alvos ?? [] }, velas).estado;
      return e === 'a-aguardar-entrada' || e === 'em-curso' || e === 'protegida';
    }
    return planoVivo(estadoDoPlano(p, velas.filter((v) => v.time > p.geradoEm)));
  });
}

/** Eventos que pedem acção imediata. */
const URGENTES = new Set(['stop', 'saida', 'saida-tempo', 'vies', 'alvo1', 'alvo2', 'stop-na-entrada']);
/** Eventos que não se avisam (planos que nunca chegaram a abrir). */
const SILENCIOSOS = new Set(['expirado', 'perdido']);

/**
 * Acompanha os planos de um instrumento e timeframe nas velas acabadas de pedir,
 * avisa os eventos novos e guarda-os. Um evento de há mais de duas velas (o motor
 * esteve parado) grava-se sem avisar: chegaria tarde demais para servir.
 */
async function acompanharPlanos(p: {
  db: SupabaseClient | null;
  planos: readonly PlanoAnterior[];
  velas: readonly Candle[];
  simbolo: { codigo: string; casas: number };
  timeframe: string;
  granularidadeS: number;
  avisados: Record<string, string[]>;
  erros: string[];
}): Promise<string[]> {
  const enviados: string[] = [];
  const ultima = p.velas[p.velas.length - 1];
  if (!ultima) return enviados;
  for (const plano of p.planos) {
    if (plano.terminado || !estrategiaActiva(plano.estrategia)) continue;
    if (!p.velas.some((v) => v.time === plano.geradoEm)) continue;
    const a = acompanharOperacao({ ...plano, alvos: plano.alvos ?? [] }, p.velas);
    const ja = new Set([...(plano.avisados ?? []), ...(p.avisados[plano.id] ?? [])]);
    const novos = a.eventos.filter((e) => !ja.has(e.chave));
    if (novos.length === 0) continue;

    for (const e of novos) {
      const recente = e.em >= ultima.time - 2 * p.granularidadeS * 1000;
      if (recente && !SILENCIOSOS.has(e.tipo)) {
        const f = fraseEvento(e, p.simbolo.casas, plano.estrategia);
        const saidas = await difundirAvisoOperacao({
          sinalId: plano.id,
          simbolo: p.simbolo.codigo,
          timeframe: p.timeframe,
          estrategia: plano.estrategia,
          titulo: f.titulo,
          corpo: f.corpo,
          urgente: URGENTES.has(e.tipo),
        });
        for (const o of saidas) {
          if (!o.ok && !o.skipped) p.erros.push(`andamento ${o.channel} (${p.simbolo.codigo} ${p.timeframe}): ${o.error}`);
        }
        enviados.push(`${f.titulo}`);
      }
      ja.add(e.chave);
    }
    p.avisados[plano.id] = [...ja];

    if (p.db && plano.avisados !== null) {
      const eventos: EventoOperacao[] = a.eventos.filter((e) => ja.has(e.chave));
      const { error } = await p.db
        .from('sinais_tempo_real')
        .update({
          estado: a.estado,
          stop_actual: a.stopActual,
          resultado_r: a.resultadoR,
          eventos,
          acompanhado_em: new Date().toISOString(),
        })
        .eq('id', plano.id);
      if (error && !/estado|eventos|column/i.test(error.message)) {
        p.erros.push(`acompanhamento ${plano.id}: ${error.message}`);
      }
    }
  }
  return enviados;
}

type ResultadoInsercao = 'novo' | 'repetido' | 'sem-tabela';

function linhaSinal(s: SinalTempoReal, notificado = false): Record<string, unknown> {
  return {
    id: s.id,
    simbolo: s.simbolo,
    timeframe: s.timeframe,
    estrategia: s.estrategia,
    direccao: s.direccao,
    regime: s.regime ?? null,
    gerado_em: new Date(s.geradoEm).toISOString(),
    preco_referencia: s.referencia ?? null,
    zona_baixa: s.zonaBaixa ?? null,
    zona_alta: s.zonaAlta ?? null,
    entrada: s.entrada,
    stop: s.stop,
    alvos: s.alvos,
    r_maximo: s.rMaximo,
    conviccao: s.conviccao,
    concordam: s.concordam ?? 1,
    razao: s.razao,
    avisos: s.avisos.slice(0, 10),
    notificado,
  };
}

/** Copia para o Supabase os sinais que só existem no registo local. */
async function sincronizarRecentes(
  db: SupabaseClient,
  recentes: SinalTempoReal[],
  erros: string[],
): Promise<boolean> {
  if (recentes.length === 0) return true;
  const { error } = await db
    .from('sinais_tempo_real')
    // `notificado: true`: estão no registo local precisamente porque já foram
    // anunciados quando nasceram.
    .upsert(
      recentes.map((s) => linhaSinal(s, true)),
      { onConflict: 'id', ignoreDuplicates: true },
    );
  if (!error) return true;
  if (!tabelaAusente(error)) erros.push(`sincronização com o Supabase: ${error.message}`);
  return false;
}

async function inserir(
  db: SupabaseClient,
  s: SinalTempoReal,
  erros: string[],
): Promise<ResultadoInsercao> {
  const { data, error } = await db
    .from('sinais_tempo_real')
    .upsert(linhaSinal(s), { onConflict: 'id', ignoreDuplicates: true })
    .select('id');

  if (error) {
    if (tabelaAusente(error)) return 'sem-tabela';
    erros.push(`sinais_tempo_real: ${error.message}`);
    return 'sem-tabela';
  }
  // Com `ignoreDuplicates`, só as linhas realmente inseridas voltam.
  return (data?.length ?? 0) > 0 ? 'novo' : 'repetido';
}

function paraSinal(
  sig: StrategySignal,
  simbolo: { codigo: string; nome: string; casas: number },
  timeframe: string,
  concordam: number,
  avisosDados: string[],
): SinalTempoReal {
  return {
    id: idSinal({
      estrategia: sig.strategy,
      simbolo: simbolo.codigo,
      timeframe,
      direccao: sig.direction,
      geradoEm: sig.generatedAt,
    }),
    simbolo: simbolo.codigo,
    nome: simbolo.nome,
    timeframe,
    estrategia: sig.strategy,
    direccao: sig.direction,
    regime: sig.regime,
    referencia: sig.referencePrice,
    zonaBaixa: sig.entryZoneLow,
    zonaAlta: sig.entryZoneHigh,
    entrada: sig.entryPrice,
    stop: sig.stopLoss,
    alvos: sig.targets.map((t) => ({ preco: t.price, r: t.rMultiple })),
    rMaximo: sig.maxRMultiple,
    conviccao: sig.conviction,
    concordam,
    razao: sig.rationale,
    casas: simbolo.casas,
    geradoEm: sig.generatedAt,
    avisos: [...avisosDados, ...sig.warnings],
    emTeste: estrategiaEmTeste(sig.strategy) !== undefined,
  };
}

// ---------------------------------------------------------------------------

export async function correrTempoReal(config: EngineConfig): Promise<RelatorioTempoReal> {
  const iniciadoEm = Date.now();
  const erros: string[] = [];
  const cfg = config.tempoReal;

  const db = isDbConfigured() ? createDbClient() : null;
  let persistencia: RelatorioTempoReal['persistencia'] = db ? 'supabase' : 'ficheiro';

  // --- 1. vigilância: cada instrumento nos timeframes de quem o segue -------
  const perfis = cfg.simbolos.length > 0 ? [] : await lerPerfis(db, erros);
  const vigilancia = escolherPares({
    envSimbolos: cfg.simbolos,
    envTimeframes: cfg.timeframes,
    perfis,
    omissao: VIGILANCIA_OMISSAO,
    conhecido: (c) => acharSimbolo(c)?.codigo ?? null,
    timeframesDe: (p) => timeframesDoPerfil(p.objetivos, p.timeframes),
  });
  if (vigilancia.ignorados.length > 0) {
    erros.push(`sem cotação na Deriv, ignorados: ${vigilancia.ignorados.join(', ')}`);
  }

  const registo = lerRegisto();
  const vistos = new Set(registo.ids);

  if (db && !sincronizado) {
    sincronizado = await sincronizarRecentes(db, registo.recentes, erros);
    if (!sincronizado) persistencia = 'ficheiro';
  }
  const recentes = await lerPlanosRecentes(db, registo.recentes, erros);
  const avisados = lerAvisados();
  const analises: AnaliseTempoReal[] = [];
  const novos: SinalTempoReal[] = [];
  let saltados = 0;

  /*
   * Estado das bolsas, pedido só quando é preciso — numa passagem em que nenhum
   * par tem vela nova não se faz pedido nenhum. Se falhar, fica `null` e vale a
   * heurística das velas (`mercadoParado`).
   */
  let abertos: Map<string, boolean> | null | undefined;
  const bolsas = async (): Promise<Map<string, boolean> | null> => {
    if (abertos !== undefined) return abertos;
    try {
      abertos = await mercadosAbertosDeriv();
    } catch (err) {
      erros.push(`estado das bolsas indisponível (${msg(err)}) — a usar a heurística das velas`);
      abertos = null;
    }
    return abertos;
  };

  /*
   * Velas fechadas pedidas nesta passagem, por código e granularidade. O EURUSD
   * que já se pediu para si serve de referência ao GBPUSD e entra no DXY: cada
   * série pede-se no máximo uma vez por passagem.
   */
  const velasDaPassagem = new Map<string, Candle[] | null>();
  const fechadasDe = async (codigo: string, gran: number): Promise<Candle[] | null> => {
    const k = `${codigo}|${gran}`;
    if (velasDaPassagem.has(k)) return velasDaPassagem.get(k) ?? null;
    const sim = acharSimbolo(codigo);
    let velas: Candle[] | null = null;
    if (sim) {
      try {
        velas = cortarVelaAberta(await velasDeriv(sim.deriv, gran, cfg.velas + 1), gran, Date.now());
      } catch (err) {
        erros.push(`velas de ${codigo} (referência do SMT): ${msg(err)}`);
      }
    }
    velasDaPassagem.set(k, velas);
    return velas;
  };

  // Sequencial de propósito: dezenas de pedidos em paralelo à mesma ligação
  // arriscam o limite por minuto da Deriv, e o ciclo tem minutos de folga.
  for (const [codigo, timeframes] of vigilancia.pares) {
    const s = acharSimbolo(codigo);
    if (!s) continue;

    for (const tf of timeframes) {
      const gran = GRANULARIDADE_S[tf];
      if (!gran) continue;
      // Sem estratégia validada para este par, não há nada que anunciar: nem se pedem velas.
      if (estrategiasPara(s.codigo, tf).length === 0) continue;

      // Abertura da vela que DEVIA ser a última fechada, pelo relógio. As velas
      // da Deriv alinham a múltiplos exactos da granularidade.
      const chave = `${s.codigo}|${tf}`;
      const passo = gran * 1000;
      const esperada = Math.floor(Date.now() / passo) * passo - passo;
      if (ultimaFechadaVista.get(chave) === esperada) {
        saltados++;
        continue;
      }

      if ((await bolsas())?.get(s.deriv) === false) {
        // Fechada: não voltar a perguntar até mudar de período.
        ultimaFechadaVista.set(chave, esperada);
        analises.push({
          simbolo: s.codigo,
          timeframe: tf,
          velas: 0,
          sinaisFrescos: 0,
          conflito: false,
          escolhido: null,
          novo: false,
          nota: 'mercado fechado',
        });
        continue;
      }

      const analise: AnaliseTempoReal = {
        simbolo: s.codigo,
        timeframe: tf,
        velas: 0,
        sinaisFrescos: 0,
        conflito: false,
        escolhido: null,
        novo: false,
      };

      try {
        // --- 2 e 3. velas fechadas ----------------------------------------
        const agora = Date.now();
        const brutas = await velasDeriv(s.deriv, gran, cfg.velas + 1);
        const fechadas = cortarVelaAberta(brutas, gran, agora);
        velasDaPassagem.set(`${s.codigo}|${gran}`, fechadas);
        analise.velas = fechadas.length;

        const ultima = fechadas[fechadas.length - 1];
        // Regista o que realmente chegou. Se a Deriv ainda não tem a vela
        // esperada, a próxima passagem volta a pedir.
        if (ultima) ultimaFechadaVista.set(chave, ultima.time);
        if (!ultima || fechadas.length < MIN_VELAS) {
          analise.nota = `só ${fechadas.length} velas fechadas`;
          analises.push(analise);
          continue;
        }
        // --- 3b. andamento das operações abertas neste par ------------------
        const andamento = await acompanharPlanos({
          db,
          planos: recentes.get(chave) ?? [],
          velas: fechadas,
          simbolo: s,
          timeframe: tf,
          granularidadeS: gran,
          avisados,
          erros,
        });
        if (andamento.length > 0) analise.andamento = andamento;

        if (mercadoParado(ultima.time, gran, agora, s.continuo)) {
          // Não voltar a pedir até mudar de período.
          ultimaFechadaVista.set(chave, esperada);
          analise.nota = 'mercado fechado';
          analises.push(analise);
          continue;
        }

        // --- 4. análise: só as estratégias validadas ------------------------
        // A convicção é a taxa medida no backtest; não há limite de R nem de
        // convicção a aplicar por cima — a regra da estratégia já é o filtro.
        let extra: DadosExtra = {};
        if (estrategiasPara(s.codigo, tf).some((e) => e.id === 'smt-teste')) {
          const referencias: Record<string, Candle[]> = {};
          for (const c of velasNecessariasSmt(s.codigo)) {
            const v = await fechadasDe(c, gran);
            if (v) referencias[c] = v;
          }
          const velas4h = tf === '4h' ? fechadas : await fechadasDe(s.codigo, GRANULARIDADE_S['4h']!);
          extra = { referencias, velas4h: velas4h ?? undefined };
        }
        const frescos = executarEstrategiasValidadas(
          fechadas,
          { symbol: s.codigo, timeframe: tf as Timeframe },
          extra,
        ).filter((x) => x.generatedAt === ultima.time);
        analise.sinaisFrescos = frescos.length;

        // --- 4b. anti-repintagem ------------------------------------------
        // Enquanto há um plano vivo neste instrumento e timeframe, a mesma
        // estratégia não volta a anunciar e o sentido oposto não sai como sinal.
        const vivos = planosVivos(recentes.get(chave) ?? [], fechadas);
        const filtro = filtrarRepintagem(
          frescos.map((x) => ({
            sinal: x,
            estrategia: x.strategy,
            direccao: x.direction,
            conviccao: x.conviction,
          })),
          vivos,
        );
        analise.repetidos = filtro.repetidos.length + filtro.contraVies.length;

        // --- 5. confluência -----------------------------------------------
        const escolha = escolherPorConfluencia(filtro.permitidos);
        if (escolha.conflito) {
          analise.conflito = true;
          analise.nota = 'estratégias em sentidos opostos — nada anunciado';
          analises.push(analise);
          continue;
        }
        if (!escolha.escolhido) {
          if (analise.repetidos) {
            analise.nota = `plano ainda vivo neste timeframe — ${analise.repetidos} repetição(ões) não anunciada(s)`;
          }
          analises.push(analise);
          continue;
        }

        const sinal = paraSinal(escolha.escolhido.sinal, s, tf, escolha.concordam, []);
        analise.escolhido = sinal;

        // --- 6. deduplicação ----------------------------------------------
        let novo = !vistos.has(sinal.id);

        // --- 6b. ainda vale a pena avisar? --------------------------------
        if (novo) {
          const agoraAnuncio = Date.now();
          if (!sinalFresco(ultima.time, gran, agoraAnuncio)) {
            analise.nota = 'sinal antigo (o motor esteve parado) — não anunciado';
            analises.push(analise);
            continue;
          }
          // O preço de agora é o fecho da vela em formação, que veio no mesmo pedido.
          const emFormacao = brutas[brutas.length - 1];
          const actual = emFormacao && emFormacao.time > ultima.time ? emFormacao.close : ultima.close;
          const preco = avaliarPrecoActual({
            direccao: sinal.direccao,
            entrada: sinal.entrada,
            stop: sinal.stop,
            alvo: sinal.alvos[0]?.preco ?? null,
            actual,
          });
          if (!preco.anunciar) {
            analise.nota =
              preco.estado === 'invalidado'
                ? 'o preço já tocou no stop antes do anúncio — não anunciado'
                : `o preço já fez ${Math.round(preco.progresso * 100)}% do caminho até ao alvo — não anunciado`;
            analises.push(analise);
            continue;
          }
          // --- 6c. notícias de alto impacto do instrumento -------------------
          const noticias = riscoDeNoticias(s.codigo, tf, await calendarioAltoImpacto(), Date.now());
          if (noticias.suspender) {
            analise.nota = noticias.aviso ?? 'notícia de alto impacto — não anunciado';
            analises.push(analise);
            continue;
          }
          if (noticias.aviso) {
            sinal.noticia = noticias.aviso;
            sinal.avisos = [noticias.aviso, ...sinal.avisos];
          }
          sinal.precoActual = actual;
          sinal.estadoPreco = preco.estado as NonNullable<SinalTempoReal['estadoPreco']>;
          sinal.distanciaR = preco.distanciaR;
          sinal.validadeAvisoS = validadeAvisoS(gran);
        }
        if (novo && db && persistencia === 'supabase') {
          const est = await inserir(db, sinal, erros);
          if (est === 'repetido') novo = false;
          if (est === 'sem-tabela') persistencia = 'ficheiro';
        }

        // --- 7. anúncio ---------------------------------------------------
        if (novo) {
          vistos.add(sinal.id);
          registo.ids.push(sinal.id);
          registo.recentes.push(sinal);
          recentes.set(chave, [
            ...(recentes.get(chave) ?? []),
            {
              id: sinal.id,
              estrategia: sinal.estrategia,
              direccao: sinal.direccao,
              entrada: sinal.entrada,
              stop: sinal.stop,
              alvo: sinal.alvos[0]?.preco ?? null,
              geradoEm: sinal.geradoEm,
            },
          ]);
          novos.push(sinal);
          analise.novo = true;

          const saidas = await difundirSinalTempoReal(sinal);
          for (const o of saidas) {
            if (!o.ok && !o.skipped) erros.push(`aviso ${o.channel} (${s.codigo} ${tf}): ${o.error}`);
          }
          if (db && persistencia === 'supabase' && saidas.some((o) => o.ok)) {
            await db.from('sinais_tempo_real').update({ notificado: true }).eq('id', sinal.id);
          }
        }

        analises.push(analise);
      } catch (err) {
        analise.nota = msg(err).slice(0, 140);
        analises.push(analise);
      }
    }
  }

  try {
    gravarRegisto(registo);
    gravarAvisados(avisados);
  } catch (err) {
    erros.push(`registo local: ${msg(err)}`);
  }

  return {
    iniciadoEm,
    terminadoEm: Date.now(),
    origem: vigilancia.origem,
    simbolos: [...vigilancia.pares.keys()],
    timeframes: [...new Set([...vigilancia.pares.values()].flat())],
    analises,
    novos,
    persistencia,
    saltados,
    erros,
  };
}

/** Resumo para a consola. */
export function formatarRelatorioTempoReal(r: RelatorioTempoReal): string {
  const segundos = ((r.terminadoEm - r.iniciadoEm) / 1000).toFixed(1);
  const linhas: string[] = [];
  linhas.push('-'.repeat(78));
  linhas.push(
    `TEMPO REAL ${new Date(r.iniciadoEm).toISOString()}  ${r.simbolos.length} instrumentos × ` +
      `${r.timeframes.join('/')}  (vigilância: ${r.origem})  ${segundos}s  novos=${r.novos.length}  ` +
      `analisados=${r.analises.length} sem-vela-nova=${r.saltados}  persistência=${r.persistencia}`,
  );
  for (const a of r.analises) {
    const e = a.escolhido;
    const marca = a.novo ? '>>>' : e ? ' = ' : a.nota ? ' ! ' : '   ';
    const corpo = e
      ? `${e.direccao === 'bullish' ? 'COMPRA' : 'VENDA '} ${e.rMaximo.toFixed(1)}R ` +
        `conv=${Math.round(e.conviccao * 100)}% ${e.estrategia}` +
        (a.novo ? ' (novo, anunciado)' : a.nota ? ` (${a.nota})` : ' (já anunciado)')
      : (a.nota ?? `sem sinal (${a.velas} velas)`);
    linhas.push(`${marca} ${a.simbolo.padEnd(8)} ${a.timeframe.padEnd(4)} ${corpo}`);
    for (const t of a.andamento ?? []) linhas.push(`  ↳ ${a.simbolo} ${a.timeframe} andamento: ${t}`);
  }
  if (r.erros.length > 0) {
    linhas.push(`AVISOS (${r.erros.length}):`);
    for (const e of r.erros.slice(0, 10)) linhas.push(`  ! ${e.slice(0, 160)}`);
  }
  return linhas.join('\n');
}
