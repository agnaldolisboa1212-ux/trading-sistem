/**
 * ICT ALGO — o motor.
 *
 * Três funções, e é a separação entre elas que garante que o que se mede é o
 * que se envia:
 *
 *   prepararEstruturas  calcula UMA vez tudo o que as velas contêm: swings,
 *                       quebras, FVG, order blocks, breakers, poças,
 *                       varrimentos. Cada objecto leva `confirmadoEm`, e é isso
 *                       que torna seguro calculá-lo para a série inteira.
 *   avaliarVela         o que o algoritmo vê numa vela: viés, vela de
 *                       referência, regime, e o veredicto dos sete modelos nos
 *                       dois sentidos. Só lê o que já era conhecível nessa vela.
 *   percorrerIct        corre `avaliarVela` ao longo da história e simula o que
 *                       aconteceria. O backtest chama-a sobre dez anos; a
 *                       análise ao vivo chama-a sobre as últimas semanas para
 *                       montar o placar. O MESMO código nos dois casos.
 */

import type { Candle, Timeframe } from '../types/market.js';
import { TIMEFRAME_MS } from '../types/market.js';
import type {
  IctDireccao,
  LeituraRegime,
  ModeloIct,
  PdArray,
  PocaLiquidez,
  QuebraEstrutura,
  RegimeIct,
  ResultadoModelo,
  Swing,
  Varrimento,
  ViesDiario,
} from './types.js';
import { quebrasDeEstrutura, serieAtrIct, swingsConfirmados, tendenciasPorVela } from './estrutura.js';
import { breakerBlocks, fairValueGaps, marcarEstados, orderBlocks } from './arrays.js';
import { pocasDeCalendario, pocasDeSwings, varrimentos } from './liquidez.js';
import { velaReferencia, type VelaReferencia } from './crt.js';
import { viesDiario } from './vies.js';
import { lerRegime } from './regime.js';
import { ultimaFechadaAte } from './tempo.js';
import type { ContextoModelo } from './modelos/comum.js';
import {
  AVALIADORES,
  TODOS_OS_MODELOS,
  calcularPlacar,
  escolherModelo,
  type RegistoOperacao,
} from './seletor.js';
import { simularSinal, type OpcoesSimulacao, type SaidaSimulada } from './simular.js';
import { aplicarEntrada, type ModoEntrada } from './entrada.js';

const DIA = 86_400_000;
const SEMANA = 7 * DIA;

export interface EntradaIct {
  simbolo: string;
  /** Timeframe onde a entrada é procurada. */
  timeframe: Timeframe;
  /** Velas do timeframe de execução, fechadas, por ordem. */
  velas: readonly Candle[];
  /** Velas diárias fechadas. */
  diarias: readonly Candle[];
  /** Velas semanais fechadas. */
  semanais: readonly Candle[];
  /** Velas do timeframe da vela de referência (o site: a diária, para 1H e 15M). */
  referencia: readonly Candle[];
  timeframeReferencia: Timeframe;
  /** Par correlacionado, para o SMT do Venom. */
  par?: { simbolo: string; velas: readonly Candle[] } | null;
  /** Instrumentos que o algoritmo pode analisar. Vazio ou ausente = sem restrição. */
  portfolio?: readonly string[];
  /** Custo por operação em preço; por omissão, o típico do instrumento. */
  custo?: number;
  /** Modelo de entrada (ver `entrada.ts`). Por omissão, o limite do PD array. */
  modoEntrada?: ModoEntrada;
}

export interface EstruturasIct {
  simbolo: string;
  timeframe: Timeframe;
  tfMs: number;
  velas: readonly Candle[];
  atr: Float64Array;
  swings: Swing[];
  tendencias: Int8Array;
  quebras: QuebraEstrutura[];
  fvgs: PdArray[];
  obs: PdArray[];
  breakers: PdArray[];
  pocas: PocaLiquidez[];
  varrimentos: Varrimento[];
  diarias: readonly Candle[];
  semanais: readonly Candle[];
  swingsSemanais: Swing[];
  referencia: readonly Candle[];
  tfRef: Timeframe;
  par: { simbolo: string; velas: readonly Candle[] } | null;
}

/** Calcula uma vez tudo o que as velas contêm. */
export function prepararEstruturas(input: EntradaIct): EstruturasIct {
  const velas = input.velas;
  const atr = serieAtrIct(velas);
  const swings = swingsConfirmados(velas);
  const tendencias = tendenciasPorVela(velas.length, swings);
  const quebras = quebrasDeEstrutura(velas, swings, atr);

  const fvgs = fairValueGaps(velas);
  const obs = orderBlocks(velas, atr, quebras);
  marcarEstados(fvgs, velas);
  marcarEstados(obs, velas);
  const breakers = breakerBlocks(obs);
  marcarEstados(breakers, velas);

  const pocas = [
    ...pocasDeSwings(swings, atr, velas),
    ...pocasDeCalendario(velas, input.diarias, input.semanais),
  ].sort((a, b) => a.index - b.index);
  const vs = varrimentos(velas, pocas, atr);

  return {
    simbolo: input.simbolo,
    timeframe: input.timeframe,
    tfMs: TIMEFRAME_MS[input.timeframe],
    velas,
    atr,
    swings,
    tendencias,
    quebras,
    fvgs,
    obs,
    breakers,
    pocas,
    varrimentos: vs,
    diarias: input.diarias,
    semanais: input.semanais,
    swingsSemanais: swingsConfirmados(input.semanais, 1),
    referencia: input.referencia,
    tfRef: input.timeframeReferencia,
    par: input.par ?? null,
  };
}

export interface AvaliacaoVela {
  i: number;
  /** Instante da decisão: o fecho da vela `i`. */
  instante: number;
  vies: ViesDiario;
  regime: LeituraRegime;
  rc: VelaReferencia | null;
  /** Os sete modelos, cada um nos dois sentidos. */
  resultados: ResultadoModelo[];
}

/** Velas diárias e semanais mínimas para o viés fazer sentido. */
const MIN_DIAS = 20;
const MIN_SEMANAS = 4;

/**
 * O que o algoritmo vê na vela `i`. Null quando ainda não há história
 * suficiente para o viés diário.
 */
export function avaliarVela(e: EstruturasIct, i: number, modo: ModoEntrada = 'borda'): AvaliacaoVela | null {
  const agora = e.velas[i];
  if (!agora || !((e.atr[i] ?? 0) > 0)) return null;
  const instante = agora.time + e.tfMs;
  const iDia = ultimaFechadaAte(e.diarias, DIA, instante);
  const iSem = ultimaFechadaAte(e.semanais, SEMANA, instante);
  if (iDia < MIN_DIAS || iSem < MIN_SEMANAS) return null;

  const vies = viesDiario({
    velasDiarias: e.diarias,
    iDia,
    swingsSemanais: e.swingsSemanais,
    iSemanal: iSem,
    pocas: e.pocas,
    iExecucao: i,
    preco: agora.close,
  });
  const rc = velaReferencia(e.referencia, e.tfRef, TIMEFRAME_MS[e.tfRef], instante);
  const regime = lerRegime({
    velas: e.velas,
    i,
    atr: e.atr,
    tendencias: e.tendencias,
    quebras: e.quebras,
    varrimentos: e.varrimentos,
    vies,
    rotuloTf: e.timeframe.toUpperCase(),
  });

  const ctx: ContextoModelo = {
    simbolo: e.simbolo,
    timeframe: e.timeframe,
    velas: e.velas,
    i,
    atr: e.atr,
    tendencias: e.tendencias,
    vies,
    regime,
    rc,
    swings: e.swings,
    varrimentos: e.varrimentos,
    quebras: e.quebras,
    fvgs: e.fvgs,
    obs: e.obs,
    breakers: e.breakers,
    pocas: e.pocas,
    par: e.par,
  };

  const resultados: ResultadoModelo[] = [];
  for (const m of TODOS_OS_MODELOS) {
    for (const d of ['bullish', 'bearish'] as const) {
      const r = AVALIADORES[m](ctx, d);
      // O modelo de entrada só mexe no preço de um setup já válido.
      if (r.sinal && modo !== 'borda') {
        const aj = aplicarEntrada(r.sinal, modo, e.velas, e.atr);
        resultados.push({ ...r, sinal: aj.sinal, porqueNao: aj.porqueNao, direccao: d });
      } else {
        resultados.push({ ...r, direccao: d });
      }
    }
  }
  return { i, instante, vies, regime, rc, resultados };
}

/** Uma operação simulada. */
export interface OperacaoIct {
  chave: string;
  modelo: ModeloIct;
  regime: RegimeIct;
  direccao: IctDireccao;
  /** Vela em que o sinal foi emitido (ou escolhido). */
  sinalEm: number;
  time: number;
  entradaEm: number;
  fechoEm: number;
  /** Instante (ms) do fecho da vela de saída. */
  fechoTime: number;
  r: number;
  rr: number;
  saida: SaidaSimulada;
}

export interface Percurso {
  /**
   * Cada setup de cada modelo, contado uma vez, independentemente do regime —
   * o desempenho "cru" de cada modelo. Alimenta o placar e o relatório.
   */
  sombras: OperacaoIct[];
  /** O algoritmo só com a camada de estrutura (regime → modelo). */
  estrutural: OperacaoIct[];
  /** O algoritmo completo: estrutura + quarentena pelo histórico. */
  comQuarentena: OperacaoIct[];
}

/**
 * Percorre a história de `desde` a `ate` como se fosse ao vivo, vela a vela.
 *
 * Mantém duas carteiras em paralelo (com e sem quarentena) para se poder medir
 * se a segunda camada acrescenta alguma coisa — em vez de a assumir. Cada
 * carteira tem uma operação de cada vez: enquanto uma ordem está pendente ou
 * aberta, não se abre outra.
 */
export function percorrerIct(
  e: EstruturasIct,
  desde: number,
  ate: number,
  simulacao: OpcoesSimulacao,
  modo: ModoEntrada = 'borda',
  /**
   * Filtro opcional sobre o setup escolhido — a confirmação em 5M do caminho ao
   * vivo (`planIctAlgo`). Um setup recusado não conta como tomado nem ocupa a
   * carteira: pode sair numa vela seguinte, quando confirmar, como ao vivo.
   * As sombras (e com elas o placar) não passam pelo filtro, também como ao vivo.
   */
  aceitar?: (s: NonNullable<ResultadoModelo['sinal']>, i: number) => boolean,
): Percurso {
  const sombras: OperacaoIct[] = [];
  const registos: RegistoOperacao[] = [];
  const vistas = new Set<string>();

  const carteiras = {
    estrutural: { ops: [] as OperacaoIct[], usadas: new Set<string>(), livreEm: desde, quarentena: false },
    comQuarentena: { ops: [] as OperacaoIct[], usadas: new Set<string>(), livreEm: desde, quarentena: true },
  };

  const operacao = (s: NonNullable<ResultadoModelo['sinal']>, i: number) => {
    const sim = simularSinal(e.velas, s, i, simulacao);
    return { sim, op: sim.r === null ? null : paraOperacao(e, s, i, sim) };
  };

  for (let i = Math.max(1, desde); i <= ate && i < e.velas.length; i++) {
    const av = avaliarVela(e, i, modo);
    if (!av) continue;

    // Sombras: cada setup novo de cada modelo, uma vez.
    for (const r of av.resultados) {
      const s = r.sinal;
      if (!s || vistas.has(s.chave)) continue;
      vistas.add(s.chave);
      const { op } = operacao(s, i);
      if (op) {
        sombras.push(op);
        registos.push({ modelo: op.modelo, fechoTime: op.fechoTime, r: op.r });
      }
    }

    for (const c of Object.values(carteiras)) {
      if (i < c.livreEm) continue;
      const placar = c.quarentena ? calcularPlacar(registos, av.instante) : [];
      const esc = escolherModelo(av.regime, av.resultados, placar, c.quarentena, c.usadas);
      const s = esc.escolhido?.sinal;
      if (!s) continue;
      if (aceitar && !aceitar(s, i)) continue;
      c.usadas.add(s.chave);
      const { sim, op } = operacao(s, i);
      if (op) c.ops.push(op);
      c.livreEm = sim.fechoEm + 1;
    }
  }

  return { sombras, estrutural: carteiras.estrutural.ops, comQuarentena: carteiras.comQuarentena.ops };
}

function paraOperacao(
  e: EstruturasIct,
  s: NonNullable<ResultadoModelo['sinal']>,
  i: number,
  sim: ReturnType<typeof simularSinal>,
): OperacaoIct {
  return {
    chave: s.chave,
    modelo: s.modelo,
    regime: s.regime,
    direccao: s.direccao,
    sinalEm: i,
    time: e.velas[i]!.time,
    entradaEm: sim.entradaEm ?? i,
    fechoEm: sim.fechoEm,
    fechoTime: e.velas[sim.fechoEm]!.time + e.tfMs,
    r: sim.r ?? 0,
    rr: s.rr,
    saida: sim.saida,
  };
}
