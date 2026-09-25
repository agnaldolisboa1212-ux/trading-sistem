/**
 * ICT ALGO — a análise completa de um instrumento.
 *
 * O que o algoritmo faz, de cima para baixo, a cada vela fechada:
 *
 *   1  semanal     estrutura de fundo (macro)
 *   2  diário      as cinco perguntas do viés; o draw on liquidity
 *   3  referência  a vela diária anterior — a faixa do CRT
 *   4  execução    a estrutura do 15M/1H e o que acabou de acontecer nela
 *   5  REGIME      manipulação, reversão, tendência, consolidação ou nada
 *   6  MODELO      os modelos do site para ESSE regime, por ordem; o primeiro
 *                  que monta setup é o escolhido — salvo se estiver de
 *                  quarentena por andar a perder neste instrumento
 *   7  SINAL       entrada, stop estrutural, alvo em liquidez, killzone
 *
 * ── O TRAVÃO DE PORTFÓLIO ──────────────────────────────────────────────────
 *
 * O algoritmo recusa-se a analisar um instrumento que não esteja na lista de
 * permitidos. Um sinal num instrumento que a pessoa não segue é um sinal que
 * ela não vai executar, e só enche o canal de ruído.
 *
 * ── PUREZA ─────────────────────────────────────────────────────────────────
 *
 * Sem rede, sem relógio, sem aleatoriedade. Correr duas vezes com a mesma
 * entrada dá exactamente o mesmo resultado — o mínimo que se pede a algo que
 * emite ordens, e o que a versão anterior deste painel não cumpria: escolhia o
 * "modelo" com `Math.random()`.
 */

import type { Candle, Timeframe } from '../types/market.js';
import { TIMEFRAME_MS } from '../types/market.js';
import type { AnaliseIct, ResultadoModelo, SinalIct } from './types.js';
import { NOME_MODELO } from './types.js';
import { avaliarVela, percorrerIct, prepararEstruturas, type EntradaIct } from './motor.js';
import { MODELOS_DO_REGIME, calcularPlacar, escolherModelo } from './seletor.js';
import { opcoesPorTimeframe } from './simular.js';
import { custoTipico } from './custos.js';
import { pocasActivasEm } from './liquidez.js';
import { passo } from './modelos/comum.js';

export type { EntradaIct } from './motor.js';

/** Velas mínimas no timeframe de execução para a análise fazer sentido. */
const MIN_VELAS = 120;
/** Velas de história usadas para o placar ao vivo. */
const HISTORIA_PLACAR = 3000;

function vazia(simbolo: string, timeframe: Timeframe, porqueNao: string): AnaliseIct {
  return {
    simbolo,
    timeframe,
    lidas: {},
    vies: null,
    regime: null,
    elegiveis: [],
    modelos: [],
    placar: [],
    escolhido: null,
    passos: [],
    sinal: null,
    porqueNao,
    pocas: [],
    pdArrays: [],
    varrimentos: [],
    quebras: [],
    avisos: [],
  };
}

/**
 * Para o painel: um veredicto por modelo. Se o modelo montou setup em algum
 * sentido, esse; senão, o que chegou mais longe na sua sequência.
 */
function umPorModelo(resultados: readonly ResultadoModelo[], preferido: 'bullish' | 'bearish' | null): ResultadoModelo[] {
  const porModelo = new Map<string, ResultadoModelo>();
  for (const r of resultados) {
    const actual = porModelo.get(r.modelo);
    const oks = (x: ResultadoModelo) => x.passos.filter((p) => p.veredicto === 'ok').length;
    const melhor =
      !actual ||
      (r.sinal && !actual.sinal) ||
      (!!r.sinal === !!actual.sinal &&
        (oks(r) > oks(actual) || (oks(r) === oks(actual) && r.direccao === preferido)));
    if (melhor) porModelo.set(r.modelo, r);
  }
  return [...porModelo.values()];
}

/**
 * Corre o ICT ALGO sobre um instrumento, na última vela fechada.
 *
 * Devolve sempre uma análise — com sinal ou com a razão de não haver. O silêncio
 * nunca é resposta: quem abre o painel tem de ver em que degrau a análise parou.
 */
export function correrIctAlgo(input: EntradaIct): AnaliseIct {
  const { simbolo, timeframe, velas, diarias, semanais } = input;

  if (input.portfolio && input.portfolio.length > 0) {
    const permitido = input.portfolio.some((s) => s.toUpperCase() === simbolo.toUpperCase());
    if (!permitido) {
      return vazia(simbolo, timeframe, `${simbolo} não está no portfólio — o ICT ALGO não analisa instrumentos fora dele.`);
    }
  }
  if (velas.length < MIN_VELAS) return vazia(simbolo, timeframe, `Só ${velas.length} velas em ${timeframe}; são precisas ${MIN_VELAS}.`);
  if (diarias.length < 25) return vazia(simbolo, timeframe, 'Sem velas diárias suficientes para o viés.');
  if (semanais.length < 6) return vazia(simbolo, timeframe, 'Sem velas semanais suficientes para a estrutura.');

  const e = prepararEstruturas(input);
  const i = velas.length - 1;
  const modo = input.modoEntrada ?? 'borda';
  const av = avaliarVela(e, i, modo);
  if (!av) return vazia(simbolo, timeframe, 'História diária ou semanal insuficiente na última vela.');

  // ── Placar: os modelos neste instrumento, só com operações já fechadas ────
  const custo = input.custo ?? custoTipico(simbolo, velas[i]!.close);
  const hist = percorrerIct(e, Math.max(1, i - HISTORIA_PLACAR), i - 1, opcoesPorTimeframe(timeframe, custo), modo);
  const placar = calcularPlacar(
    hist.sombras.map((o) => ({ modelo: o.modelo, fechoTime: o.fechoTime, r: o.r })),
    av.instante,
  );

  // ── Escolha ───────────────────────────────────────────────────────────────
  const esc = escolherModelo(av.regime, av.resultados, placar, true);
  const sinal: SinalIct | null = esc.escolhido?.sinal ?? null;

  // Os passos top-down: a leitura do regime, e depois os do modelo escolhido.
  const cabeca = av.regime.leitura.map((frase, k) =>
    passo(k + 1, k === 0 ? '1w' : k === 1 ? '1d' : timeframe, k === av.regime.leitura.length - 1 ? 'Regime' : 'Leitura', 'ok', frase),
  );
  const elegiveisTxt = MODELOS_DO_REGIME[av.regime.regime].map((m) => NOME_MODELO[m]).join(' → ');
  if (elegiveisTxt) {
    cabeca.push(passo(cabeca.length + 1, timeframe, 'Modelos para este regime', 'ok', elegiveisTxt));
  }
  const passos = [
    ...cabeca,
    ...(esc.escolhido?.passos ?? []).map((p, k) => ({ ...p, numero: cabeca.length + k + 1 })),
  ];
  if (sinal) sinal.passos = passos;

  const avisos: string[] = [];
  if (!input.par) avisos.push('Sem par correlacionado: o Venom (que exige SMT) não pode emitir.');
  for (const p of placar) {
    if (p.quarentena) {
      avisos.push(`${NOME_MODELO[p.modelo]} de quarentena: ${p.media.toFixed(2)}R nas últimas ${p.n} operações neste instrumento.`);
    }
  }

  return {
    simbolo,
    timeframe,
    lidas: {
      [timeframe]: velas.length,
      [input.timeframeReferencia]: input.referencia.length,
      '1d': diarias.length,
      '1w': semanais.length,
    },
    vies: av.vies,
    regime: av.regime,
    elegiveis: esc.elegiveis,
    modelos: umPorModelo(av.resultados, av.regime.direccao),
    placar,
    escolhido: esc.escolhido?.modelo ?? null,
    passos,
    sinal,
    porqueNao: sinal ? null : (esc.porqueNao ?? 'nenhum modelo montou setup'),
    // Só o que já era conhecido agora, e recente, para o gráfico não ficar ilegível.
    pocas: pocasActivasEm(e.pocas, i),
    pdArrays: [...e.fvgs, ...e.obs, ...e.breakers].filter(
      (a) => a.confirmadoEm <= i && (a.mitigadoEm === null || a.mitigadoEm > i) && i - a.index <= 100,
    ),
    varrimentos: e.varrimentos.filter((v) => v.index <= i && i - v.index <= 100),
    quebras: e.quebras.filter((q) => q.index <= i && i - q.index <= 100),
    avisos,
  };
}

const DIA = 86_400_000;

/** Início do período que contém `t`, alinhado pelo calendário. */
function inicioDoPeriodo(t: number, destino: Timeframe): number {
  if (destino === '1w') {
    // A época Unix começa numa quinta-feira: `t % semana` alinharia as semanas
    // à quinta. A semana do forex abre ao domingo, por isso alinha-se ao domingo.
    const dias = Math.floor(t / DIA);
    const diaDaSemana = (dias + 4) % 7; // 0 = domingo
    return (dias - diaDaSemana) * DIA;
  }
  if (destino === '1M') {
    const d = new Date(t);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  }
  const passo = TIMEFRAME_MS[destino];
  return t - (t % passo);
}

/**
 * Agrega velas de um timeframe menor num maior, ALINHANDO PELO CALENDÁRIO.
 *
 * Agregar de N em N velas a contar do início do array parece equivalente e não
 * é: basta um fim-de-semana ou uma vela em falta para todas as seguintes
 * ficarem deslocadas, e a "vela de 4h" do algoritmo deixa de coincidir com a
 * que a pessoa vê no gráfico.
 *
 * No diário há um cuidado extra: o domingo do forex tem uma ou duas horas de
 * negociação, e uma "vela diária" de duas horas é quase sempre um doji que
 * estragaria a vela de referência de segunda-feira. Um dia com menos de um
 * quarto das velas esperadas junta-se ao dia seguinte — é a convenção da
 * maioria das corretoras. Na cripto, que negoceia ao fim-de-semana, os dias
 * vêm completos e nada muda.
 */
export function agregar(velas: readonly Candle[], destino: Timeframe): Candle[] {
  const out: Candle[] = [];
  const contagem: number[] = [];
  for (const c of velas) {
    const chave = inicioDoPeriodo(c.time, destino);
    const u = out[out.length - 1];
    if (u && u.time === chave) {
      u.high = Math.max(u.high, c.high);
      u.low = Math.min(u.low, c.low);
      u.close = c.close;
      if (typeof c.volume === 'number') u.volume = (u.volume ?? 0) + c.volume;
      contagem[contagem.length - 1]!++;
    } else {
      out.push({ ...c, time: chave });
      contagem.push(1);
    }
  }
  if (destino !== '1d' || velas.length < 2) return out;

  // Passo da fonte: a menor diferença positiva entre as primeiras velas.
  let passoFonte = Infinity;
  for (let k = 1; k < Math.min(velas.length, 100); k++) {
    const d = velas[k]!.time - velas[k - 1]!.time;
    if (d > 0) passoFonte = Math.min(passoFonte, d);
  }
  if (!Number.isFinite(passoFonte)) return out;
  const esperadas = DIA / passoFonte;

  const fundidas: Candle[] = [];
  for (let k = 0; k < out.length; k++) {
    const c = out[k]!;
    const seguinte = out[k + 1];
    const fragmento = contagem[k]! < esperadas / 4;
    if (fragmento && seguinte && seguinte.time - c.time <= 2 * DIA) {
      // O fragmento abre o dia seguinte: a abertura é a dele, os extremos somam-se.
      seguinte.open = c.open;
      seguinte.high = Math.max(seguinte.high, c.high);
      seguinte.low = Math.min(seguinte.low, c.low);
      if (typeof c.volume === 'number') seguinte.volume = (seguinte.volume ?? 0) + c.volume;
      continue;
    }
    fundidas.push(c);
  }
  return fundidas;
}

/** O sinal só é novo se nasceu na última vela fechada. */
export function sinalDaUltimaVela(a: AnaliseIct): SinalIct | null {
  if (!a.sinal) return null;
  const lidas = a.lidas[a.sinal.timeframe];
  return typeof lidas === 'number' && a.sinal.index === lidas - 1 ? a.sinal : null;
}
