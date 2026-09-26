'use client';

/**
 * As análises do gráfico e do painel de agentes, calculadas NO BROWSER.
 *
 * Eram as rotas `/api/ict`, `/api/asia-range` e `/api/radar`: o servidor pedia
 * as velas à Deriv e corria o algoritmo. O servidor levava RateLimit da Deriv
 * mesmo com pouco tráfego (ver `lib/deriv/velas-browser.ts`) e as abas ficavam
 * com "Falha a obter as velas". Aqui as velas vêm pela ligação do próprio
 * browser e os cálculos correm num Web Worker — as mesmas funções do motor,
 * sobre as mesmas séries que as rotas pediam, com o mesmo formato de resposta.
 */

import {
  ASIA_RANGE_EM_TESTE,
  analisarAsiaRange,
  estrategiaEmTeste,
  estrategiasPara,
  paresSmtIct,
  type AnaliseAsiaRange,
  type AnaliseIct,
  type Candle,
  type DadosExtra,
  type StrategySignal,
  type Timeframe,
} from '@trading/core';
import { acharSimbolo } from '@/lib/deriv/simbolos';
import { velasFechadasBrowser } from '@/lib/deriv/velas-browser';
import { lerPreferenciasCliente } from '@/lib/preferencias';
import { fazer, type Trabalho } from '@/lib/analise-calculo';

const GRANULARIDADE_S: Record<string, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
};
const DIA_S = 86_400;

// ── O worker ────────────────────────────────────────────────────────────────

let worker: Worker | null | undefined;
const aEspera = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let proximoId = 1;

function obterWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./analise.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<{ id: number; resultado?: unknown; erro?: string }>) => {
      const p = aEspera.get(ev.data.id);
      if (!p) return;
      aEspera.delete(ev.data.id);
      if (ev.data.erro !== undefined) p.reject(new Error(ev.data.erro));
      else p.resolve(ev.data.resultado);
    };
    worker.onerror = () => {
      // O worker morreu: o que estava pendente é refeito na thread principal.
      for (const [, p] of aEspera) p.reject(new Error('worker indisponível'));
      aEspera.clear();
      worker?.terminate();
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

async function calcular<T>(t: Trabalho): Promise<T> {
  const w = obterWorker();
  if (!w) return fazer(t) as T;
  try {
    return (await new Promise<unknown>((resolve, reject) => {
      const id = proximoId++;
      aEspera.set(id, { resolve, reject });
      w.postMessage({ id, trabalho: t });
    })) as T;
  } catch (e) {
    // Um erro do próprio algoritmo repete-se na thread principal e sobe; um worker
    // que falhou deixa de fazer falta.
    if (e instanceof Error && e.message === 'worker indisponível') return fazer(t) as T;
    throw e;
  }
}

const falha = (e: unknown) => `Falha a obter as velas: ${e instanceof Error ? e.message : String(e)}`;

// ── ICT ALGO ────────────────────────────────────────────────────────────────

export interface RespostaIct {
  analise: AnaliseIct | null;
  porqueNao?: string;
  em: number;
}

/** O placar de cada modelo precisa de história; a Deriv serve até 5000 por pedido. */
const VELAS_EXECUCAO = 3500;
const cacheIct = new Map<string, { ultima: number; resposta: RespostaIct }>();

export async function analisarIctBrowser(codigo: string, tf: '15m' | '1h' | '4h'): Promise<RespostaIct> {
  const em = Date.now();
  const s = acharSimbolo(codigo.toUpperCase());
  if (!s) return { analise: null, porqueNao: 'instrumento desconhecido', em };

  // O travão de portfólio: só instrumentos escolhidos por quem vê.
  const portfolio = lerPreferenciasCliente().instrumentos.map((c) => c.toUpperCase());
  if (portfolio.length === 0) {
    return { analise: null, porqueNao: 'O portfólio está vazio — escolha os instrumentos nas Definições.', em };
  }
  if (!portfolio.includes(s.codigo.toUpperCase())) {
    return { analise: null, porqueNao: `${s.codigo} não está no seu portfólio — o ICT ALGO não analisa instrumentos fora dele.`, em };
  }

  const gran = GRANULARIDADE_S[tf]!;
  const parSimbolo = paresSmtIct(s.codigo).map((c) => acharSimbolo(c)).find((x) => x) ?? null;
  let execucao: Candle[];
  let diarias: Candle[];
  let parVelas: Candle[];
  let velas5m: Candle[];
  try {
    [execucao, diarias, parVelas, velas5m] = await Promise.all([
      velasFechadasBrowser(s.deriv, gran, VELAS_EXECUCAO),
      velasFechadasBrowser(s.deriv, DIA_S, 400),
      parSimbolo ? velasFechadasBrowser(parSimbolo.deriv, gran, VELAS_EXECUCAO).catch(() => []) : Promise.resolve([]),
      // 5M: a confirmação do sinal (a mesma que o motor exige para o enviar).
      velasFechadasBrowser(s.deriv, 300, 300).catch(() => []),
    ]);
  } catch (e) {
    return { analise: null, porqueNao: falha(e), em };
  }

  // Até fechar a vela seguinte de execução, a análise é a mesma.
  const ultima = execucao[execucao.length - 1]?.time ?? 0;
  const chave = `${s.codigo}|${tf}`;
  const guardada = cacheIct.get(chave);
  if (guardada && guardada.ultima === ultima) return guardada.resposta;

  const analise = await calcular<AnaliseIct>({
    tipo: 'ict',
    simbolo: s.codigo,
    timeframe: tf,
    granS: gran,
    execucao,
    diarias,
    par: parSimbolo && parVelas.length > 0 ? { simbolo: parSimbolo.codigo, velas: parVelas } : null,
    velas5m,
    portfolio,
  });
  const resposta: RespostaIct = { analise, em: Date.now() };
  cacheIct.set(chave, { ultima, resposta });
  return resposta;
}

// ── Asia Range Algo ─────────────────────────────────────────────────────────

export interface RespostaAsia {
  analise: AnaliseAsiaRange | null;
  porqueNao?: string;
  em: number;
}

export async function analisarAsiaBrowser(codigo: string): Promise<RespostaAsia> {
  const em = Date.now();
  const s = acharSimbolo(codigo.toUpperCase());
  if (!s) return { analise: null, porqueNao: 'instrumento desconhecido', em };
  if (!ASIA_RANGE_EM_TESTE.includes(s.codigo)) {
    return { analise: null, porqueNao: `O Asia Range Algo corre nos pares do journal: ${ASIA_RANGE_EM_TESTE.join(', ')}.`, em };
  }
  const parSimbolo = paresSmtIct(s.codigo).map((c) => acharSimbolo(c)).find((x) => x) ?? null;
  try {
    const [velas, diarias, parVelas, ltf] = await Promise.all([
      velasFechadasBrowser(s.deriv, 900, 400),
      velasFechadasBrowser(s.deriv, DIA_S, 300),
      parSimbolo ? velasFechadasBrowser(parSimbolo.deriv, 900, 400).catch(() => []) : Promise.resolve([]),
      // 1M: a confirmação — as mesmas 300 velas fechadas que o motor usa.
      velasFechadasBrowser(s.deriv, 60, 300).catch(() => []),
    ]);
    // ~20 ms: não precisa do worker.
    const analise = analisarAsiaRange({
      simbolo: s.codigo,
      velas,
      diarias,
      par: parSimbolo && parVelas.length > 0 ? { simbolo: parSimbolo.codigo, velas: parVelas } : null,
      ltf,
    });
    return { analise, em };
  } catch (e) {
    return { analise: null, porqueNao: falha(e), em };
  }
}

// ── Radar (painel de agentes) ───────────────────────────────────────────────

/** Abaixo disto as estratégias recusam-se (a mesma regra do motor). */
const MIN_VELAS = 60;
const ALGOS = ['ict-algo', 'asia-range-algo'];
export type GrupoRadar = 'algo' | 'ict' | 'asia' | 'basico' | null;
const doGrupo = (grupo: GrupoRadar) => (e: { id: string }) =>
  grupo === 'algo'
    ? ALGOS.includes(e.id)
    : grupo === 'ict'
      ? e.id === 'ict-algo'
      : grupo === 'asia'
        ? e.id === 'asia-range-algo'
        : grupo === 'basico'
          ? !ALGOS.includes(e.id)
          : true;
/** O ICT ALGO executa em 15M, 1H e 4H; o Asia Range só em 15M. */
const TF_ICT = new Set(['15m', '1h', '4h']);
const TF_RADAR = ['15m', '30m', '1h', '4h', '1d'];

function outrosTimeframes(codigo: string, actual: string, grupo: GrupoRadar): string {
  const tfs = TF_RADAR.filter((tf) => tf !== actual && estrategiasPara(codigo, tf).filter(doGrupo(grupo)).length > 0);
  return tfs.length > 0
    ? `Tente ${tfs.map((t) => t.toUpperCase()).join(' ou ')}.`
    : 'Nenhum timeframe tem estratégia activa para este instrumento.';
}

export interface RespostaRadar {
  simbolo: string;
  nome?: string;
  timeframe?: string;
  temEstrategia?: boolean;
  estrategias?: string[];
  conflito?: boolean;
  sinal?: {
    direccao: string;
    entrada: number;
    stop: number;
    alvo: number | null;
    pendente: boolean;
    rMaximo: number;
    conviccao: number;
    estrategia: string;
    emTeste: boolean;
  } | null;
  resumo?: string;
  em?: number;
  erro?: string;
}

const cacheRadar = new Map<string, { ultima: number; resposta: RespostaRadar }>();

/** A análise de um instrumento com as estratégias activas — o que o motor decide na última vela. */
export async function radarBrowser(simbolo: string, tfPedido: string, grupo: GrupoRadar): Promise<RespostaRadar> {
  const tfBruto =
    grupo === 'algo' || grupo === 'asia' ? '15m' : grupo === 'ict' ? (TF_ICT.has(tfPedido) ? tfPedido : '15m') : tfPedido;
  const tf = (GRANULARIDADE_S[tfBruto] && TF_RADAR.includes(tfBruto) ? tfBruto : '1d') as Timeframe;
  const em = Date.now();
  const s = acharSimbolo(simbolo.toUpperCase());
  if (!s) return { simbolo: simbolo.toUpperCase(), erro: 'instrumento desconhecido' };

  const estrategias = estrategiasPara(s.codigo, tf).filter(doGrupo(grupo));
  if (estrategias.length === 0) {
    return {
      simbolo: s.codigo,
      nome: s.nome,
      timeframe: tf,
      temEstrategia: false,
      sinal: null,
      resumo:
        grupo === 'algo' || grupo === 'ict' || grupo === 'asia'
          ? 'Este algo não corre neste instrumento.'
          : `Sem estratégia activa em ${tf.toUpperCase()}. ${outrosTimeframes(s.codigo, tf, grupo)}`,
      em,
    };
  }

  try {
    const gran = GRANULARIDADE_S[tf]!;
    const temAlgo = estrategias.some((e) => ALGOS.includes(e.id));
    const fechadas = await velasFechadasBrowser(s.deriv, gran, temAlgo ? 1500 : 320);
    const ultima = fechadas[fechadas.length - 1];
    if (!ultima || fechadas.length < MIN_VELAS) {
      return {
        simbolo: s.codigo,
        nome: s.nome,
        timeframe: tf,
        temEstrategia: true,
        sinal: null,
        resumo: `Só ${fechadas.length} velas fechadas — a estratégia precisa de pelo menos ${MIN_VELAS}.`,
        em,
      };
    }
    // A análise só muda quando fecha uma vela.
    const chave = `${s.codigo}|${tf}|${grupo ?? 'todos'}`;
    const guardada = cacheRadar.get(chave);
    if (guardada && guardada.ultima === ultima.time) return guardada.resposta;

    let extra: DadosExtra = {};
    if (temAlgo) {
      const parSim = paresSmtIct(s.codigo).map((c) => acharSimbolo(c)).find((x) => x) ?? null;
      const temIct = estrategias.some((e) => e.id === 'ict-algo');
      const temAsia = estrategias.some((e) => e.id === 'asia-range-algo');
      const [diarias, parVelas, ltf, ltf1] = await Promise.all([
        velasFechadasBrowser(s.deriv, DIA_S, 300),
        parSim ? velasFechadasBrowser(parSim.deriv, gran, 1500).catch(() => []) : Promise.resolve([]),
        // 5M: a confirmação do ICT ALGO.
        temIct ? velasFechadasBrowser(s.deriv, 300, 300).catch(() => []) : Promise.resolve([]),
        // 1M: a confirmação do Asia Range Algo (as 300 velas do motor).
        temAsia ? velasFechadasBrowser(s.deriv, 60, 300).catch(() => []) : Promise.resolve([]),
      ]);
      extra = {
        ...extra,
        algo: {
          diarias,
          par: parSim && parVelas.length > 0 ? { simbolo: parSim.codigo, velas: parVelas } : null,
          ltf,
          ltf1,
        },
      };
    }
    if (estrategias.some((e) => e.id === 'abertura-dax-teste' || e.id === 'compra-vwap-indices')) {
      extra = { ...extra, velas1d: await velasFechadasBrowser(s.deriv, DIA_S, 320) };
    }

    const todos = await calcular<StrategySignal[]>({
      tipo: 'estrategias',
      simbolo: s.codigo,
      timeframe: tf,
      velas: fechadas,
      extra,
      ids: estrategias.map((e) => e.id),
    });
    const frescos = todos.filter((x) => x.generatedAt === ultima.time);

    // Um sinal por instrumento — como o motor: sentidos opostos não escolhem nenhum.
    const altas = frescos.filter((x) => x.direction === 'bullish');
    const baixas = frescos.filter((x) => x.direction === 'bearish');
    const conflito = altas.length > 0 && baixas.length > 0;
    const lado = altas.length > 0 ? altas : baixas;
    const escolhido = conflito ? null : ([...lado].sort((a, b) => b.conviction - a.conviction)[0] ?? null);
    const nomes = estrategias.map((e) => e.nome);
    const resposta: RespostaRadar = {
      simbolo: s.codigo,
      nome: s.nome,
      timeframe: tf,
      temEstrategia: true,
      estrategias: nomes,
      conflito,
      sinal: escolhido
        ? {
            direccao: escolhido.direction,
            entrada: escolhido.entryPrice,
            stop: escolhido.stopLoss,
            alvo: escolhido.targets[0]?.price ?? null,
            pendente: escolhido.entryType === 'limit',
            rMaximo: escolhido.maxRMultiple,
            conviccao: escolhido.conviction,
            estrategia: escolhido.strategy,
            emTeste: estrategiaEmTeste(escolhido.strategy) !== undefined,
          }
        : null,
      resumo: conflito
        ? 'Estratégias em sentidos opostos na última vela — nenhuma prevalece.'
        : escolhido
          ? escolhido.rationale
          : `${nomes.join(', ')} — nenhuma deu sinal na última vela fechada.`,
      em,
    };
    cacheRadar.set(chave, { ultima: ultima.time, resposta });
    return resposta;
  } catch (e) {
    return { simbolo: s.codigo, nome: s.nome, timeframe: tf, erro: e instanceof Error ? e.message : String(e) };
  }
}
