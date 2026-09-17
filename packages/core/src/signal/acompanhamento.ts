/**
 * Acompanhamento de uma operação — o que aconteceu desde o sinal, evento a evento.
 *
 * Um sinal não acaba no aviso. Quem entrou quer saber quando chegou a +1R (e
 * que deve fechar metade e proteger), quando a regra manda sair, quando o stop
 * móvel sobe e quando o mercado vira contra a posição. Cada um destes momentos
 * é um EVENTO, com a vela em que aconteceu — o motor compara com os que já
 * avisou e só manda os novos.
 *
 * As regras de gestão são as de cada estratégia validada, as mesmas que o
 * backtest mediu:
 *
 *   compra-vwap-indices   +1R: fecha metade, stop para a entrada; +2R: fecha o resto
 *   connors-rsi2-indices  sai no primeiro fecho acima da média de 5, ou ao fim de 10 velas
 *   tendencia-cripto/ouro stop móvel no mínimo das últimas 20 velas
 *   vwap-forex-teste      como a compra do VWAP, nos dois sentidos
 *   smt-teste             alvo a +2R; sai às 20:00 UTC (15m/1h) ou ao fim de 12 velas (4h)
 *   (outras)              primeiro alvo ou stop
 *
 * Mudança de viés: a tendência da própria série (EMA 50 a descer e fecho abaixo
 * dela, numa compra) vira contra a operação enquanto está aberta. Avisa uma vez.
 *
 * Numa vela que toca o stop e um alvo, conta o stop — a leitura que não inventa
 * ganho. Função pura: só lê as velas que recebe.
 */

import type { Candle } from '../types/market.js';
import { atrSerie, viesDeTendencia } from '../strategies/contexto.js';

export type TipoEvento =
  | 'entrada'
  | 'alvo1'
  | 'alvo2'
  | 'stop'
  | 'stop-na-entrada'
  | 'saida'
  | 'saida-tempo'
  | 'stop-movel'
  | 'vies'
  | 'expirado'
  | 'perdido';

export interface EventoOperacao {
  tipo: TipoEvento;
  /** Abertura da vela em que aconteceu (ms). */
  em: number;
  /** Preço de referência do evento (nível tocado, fecho, novo stop). */
  preco: number;
  /** Resultado acumulado em R quando o evento fecha a operação. */
  resultadoR?: number;
  /** Chave única: o mesmo evento nunca se avisa duas vezes. */
  chave: string;
}

export type EstadoOperacao =
  | 'a-aguardar-entrada'
  | 'em-curso'
  | 'protegida'
  | 'fechada'
  | 'expirado'
  | 'perdido';

export interface PlanoAcompanhado {
  estrategia: string;
  direccao: 'bullish' | 'bearish';
  entrada: number;
  stop: number;
  alvos: ReadonlyArray<{ preco: number }>;
  /** Abertura da vela que gerou o sinal (ms). */
  geradoEm: number;
}

export interface Acompanhamento {
  estado: EstadoOperacao;
  eventos: EventoOperacao[];
  /** Stop em vigor agora (sobe com a entrada protegida ou o stop móvel). */
  stopActual: number;
  /** Resultado em R, quando a operação fechou. */
  resultadoR: number | null;
}

/** Velas sem tocar na entrada até o plano deixar de valer. */
const EXPIRA_VELAS = 20;

/** Metade a +1R com o stop na entrada, o resto a +2R. */
const GESTAO_PARCIAL = new Set(['compra-vwap-indices', 'vwap-forex-teste']);

const HORA = 3_600_000;
const DIA = 86_400_000;

/** Duração de uma vela: a menor distância entre velas seguidas perto do sinal. */
function passoDasVelas(velas: readonly Candle[], perto: number): number {
  let passo = Infinity;
  for (let k = Math.max(1, perto - 10); k <= Math.min(velas.length - 1, perto + 10); k++) {
    const d = velas[k]!.time - velas[k - 1]!.time;
    if (d > 0 && d < passo) passo = d;
  }
  return Number.isFinite(passo) ? passo : 0;
}

function mediaFechos(velas: readonly Candle[], fim: number, periodo: number): number {
  if (fim + 1 < periodo) return Number.NaN;
  let soma = 0;
  for (let k = fim - periodo + 1; k <= fim; k++) soma += velas[k]!.close;
  return soma / periodo;
}

function minimoBaixas(velas: readonly Candle[], de: number, ate: number): number {
  let m = Infinity;
  for (let k = Math.max(0, de); k <= ate; k++) m = Math.min(m, velas[k]!.low);
  return m;
}

/**
 * Percorre as velas FECHADAS depois do sinal e devolve o estado e os eventos.
 * `velas` deve incluir história antes do sinal (médias, mínimos, viés).
 */
export function acompanharOperacao(plano: PlanoAcompanhado, velas: readonly Candle[]): Acompanhamento {
  const compra = plano.direccao === 'bullish';
  const lado = compra ? 1 : -1;
  const risco = Math.abs(plano.entrada - plano.stop);
  const eventos: EventoOperacao[] = [];
  const ev = (tipo: TipoEvento, em: number, preco: number, resultadoR?: number, sufixo = '') =>
    eventos.push({ tipo, em, preco, resultadoR, chave: `${tipo}${sufixo}` });

  const iSinal = velas.findIndex((v) => v.time === plano.geradoEm);
  if (iSinal < 0 || !(risco > 0)) {
    return { estado: 'a-aguardar-entrada', eventos, stopActual: plano.stop, resultadoR: null };
  }

  const atr = atrSerie(velas, 14);
  const rDe = (preco: number) => ((preco - plano.entrada) * lado) / risco;
  const tocaAbaixo = (v: Candle, nivel: number) => (compra ? v.low <= nivel : v.high >= nivel);
  const tocaAcima = (v: Candle, nivel: number) => (compra ? v.high >= nivel : v.low <= nivel);
  const alvo1 = plano.alvos[0]?.preco ?? null;
  const alvo2 = plano.alvos[1]?.preco ?? null;
  // Entrada ao fecho da vela do sinal (as validadas compram assim): já está dentro.
  const aMercado = Math.abs(velas[iSinal]!.close - plano.entrada) <= risco * 0.001;

  let entrou = aMercado;
  let iEntrada = aMercado ? iSinal : -1;
  let stop = plano.stop;
  let stopAvisado = plano.stop;
  let protegida = false;
  let viesAvisado = false;
  const viesInicial = viesDeTendencia(velas, iSinal).vies;
  const tendencia = plano.estrategia === 'tendencia-cripto' || plano.estrategia === 'tendencia-ouro';

  for (let i = iSinal + 1; i < velas.length; i++) {
    const v = velas[i]!;

    if (!entrou) {
      if (v.low <= plano.entrada && v.high >= plano.entrada) {
        entrou = true;
        iEntrada = i;
        ev('entrada', v.time, plano.entrada);
      } else if (tocaAbaixo(v, plano.stop)) {
        ev('perdido', v.time, plano.stop);
        return { estado: 'perdido', eventos, stopActual: stop, resultadoR: null };
      } else if (alvo1 !== null && tocaAcima(v, alvo1)) {
        ev('perdido', v.time, alvo1);
        return { estado: 'perdido', eventos, stopActual: stop, resultadoR: null };
      } else if (i - iSinal >= EXPIRA_VELAS) {
        ev('expirado', v.time, v.close);
        return { estado: 'expirado', eventos, stopActual: stop, resultadoR: null };
      }
      if (!entrou) continue;
    }

    // --- stop (primeiro, conservador) ------------------------------------------
    if (tocaAbaixo(v, stop)) {
      if (protegida) {
        const r = GESTAO_PARCIAL.has(plano.estrategia) ? 0.5 : rDe(stop);
        ev('stop-na-entrada', v.time, stop, r);
        return { estado: 'fechada', eventos, stopActual: stop, resultadoR: r };
      }
      const r = rDe(stop);
      // Na tendência, perder o stop que já subiu é a saída da regra, não um stop.
      const subiu = compra ? stop > plano.stop : stop < plano.stop;
      ev(tendencia && subiu ? 'saida' : 'stop', v.time, stop, r);
      return { estado: 'fechada', eventos, stopActual: stop, resultadoR: r };
    }

    // --- regras de saída por estratégia --------------------------------------------
    if (GESTAO_PARCIAL.has(plano.estrategia)) {
      if (!protegida && alvo1 !== null && tocaAcima(v, alvo1)) {
        protegida = true;
        stop = plano.entrada;
        ev('alvo1', v.time, alvo1, 0.5);
      }
      if (protegida && alvo2 !== null && tocaAcima(v, alvo2)) {
        const r = 0.5 + 0.5 * rDe(alvo2);
        ev('alvo2', v.time, alvo2, r);
        return { estado: 'fechada', eventos, stopActual: stop, resultadoR: r };
      }
    } else if (plano.estrategia === 'connors-rsi2-indices') {
      const media5 = mediaFechos(velas, i, 5);
      if (compra ? v.close > media5 : v.close < media5) {
        const r = rDe(v.close);
        ev('saida', v.time, v.close, r);
        return { estado: 'fechada', eventos, stopActual: stop, resultadoR: r };
      }
      if (i - iEntrada >= 10) {
        const r = rDe(v.close);
        ev('saida-tempo', v.time, v.close, r);
        return { estado: 'fechada', eventos, stopActual: stop, resultadoR: r };
      }
    } else if (tendencia) {
      // Nível para a PRÓXIMA vela: mínimo das 20 velas até esta. O stop segue-o
      // sempre (é a regra medida); só se avisa quando sobe pelo menos 0,25 ATR.
      const nivel = minimoBaixas(velas, i - 19, i);
      const a = atr[i] ?? 0;
      if (compra && nivel > stop) {
        stop = nivel;
        if (nivel >= stopAvisado + 0.25 * a) {
          stopAvisado = nivel;
          ev('stop-movel', v.time, nivel, undefined, `@${v.time}`);
        }
      }
    } else if (alvo1 !== null && tocaAcima(v, alvo1)) {
      const r = rDe(alvo1);
      ev('alvo1', v.time, alvo1, r);
      return { estado: 'fechada', eventos, stopActual: stop, resultadoR: r };
    } else if (plano.estrategia === 'smt-teste') {
      // Day trade: em 15m e 1h fecha na vela que acaba às 20:00 UTC do dia do sinal; em 4h, 12 velas.
      const passo = passoDasVelas(velas, iSinal);
      const fechoSinal = velas[iSinal]!.time + passo;
      const fim =
        passo >= 4 * HORA
          ? i - iEntrada >= 12
          : v.time + passo >= Math.floor(fechoSinal / DIA) * DIA + 20 * HORA;
      if (fim) {
        const r = rDe(v.close);
        ev('saida-tempo', v.time, v.close, r);
        return { estado: 'fechada', eventos, stopActual: stop, resultadoR: r };
      }
    }

    // --- mudança de viés ------------------------------------------------------------
    if (!viesAvisado) {
      const agora = viesDeTendencia(velas, i).vies;
      const contra = compra ? 'bearish' : 'bullish';
      if (agora === contra && viesInicial !== contra) {
        viesAvisado = true;
        ev('vies', v.time, v.close);
      }
    }
  }

  return {
    estado: !entrou ? 'a-aguardar-entrada' : protegida ? 'protegida' : 'em-curso',
    eventos,
    stopActual: stop,
    resultadoR: null,
  };
}

/** Texto curto de um evento, para o aviso e para o Telegram. */
export function fraseEvento(e: EventoOperacao, casas: number, estrategia: string): { titulo: string; corpo: string } {
  const p = e.preco.toFixed(casas);
  const r = e.resultadoR !== undefined ? `${e.resultadoR >= 0 ? '+' : ''}${e.resultadoR.toFixed(1)}R` : '';
  switch (e.tipo) {
    case 'entrada':
      return { titulo: 'entrada tocada', corpo: `O preço chegou à entrada (${p}). A operação está em curso.` };
    case 'alvo1':
      return GESTAO_PARCIAL.has(estrategia)
        ? { titulo: '+1R atingido', corpo: `Chegou a ${p}. Feche metade e passe o stop para a entrada.` }
        : { titulo: `alvo atingido ${r}`, corpo: `Chegou ao alvo (${p}).` };
    case 'alvo2':
      return { titulo: `segundo alvo atingido ${r}`, corpo: `Chegou a ${p}. Feche o resto da posição.` };
    case 'stop':
      return { titulo: `stop atingido ${r}`, corpo: `O preço tocou no stop (${p}). A operação terminou.` };
    case 'stop-na-entrada':
      return { titulo: `fechou na entrada ${r}`, corpo: `Voltou à entrada (${p}) depois de +1R: a metade que ficou saiu sem perda.` };
    case 'saida':
      return estrategia === 'connors-rsi2-indices'
        ? { titulo: `sair agora ${r}`, corpo: `Fechou acima da média de 5 (${p}): é a saída da regra.` }
        : { titulo: `saída ${r}`, corpo: `Perdeu o stop móvel (${p}): a tendência terminou para esta operação.` };
    case 'saida-tempo':
      return estrategia === 'smt-teste'
        ? { titulo: `sair: fim do day trade ${r}`, corpo: `Não chegou ao alvo nem ao stop no tempo da regra. Fecho a ${p}.` }
        : { titulo: `sair: 10 velas ${r}`, corpo: `Passaram 10 velas sem sinal de saída. Fecho a ${p}.` };
    case 'stop-movel':
      return { titulo: 'stop móvel subiu', corpo: `Novo stop: ${p} (mínimo das últimas 20 velas).` };
    case 'vies':
      return {
        titulo: 'viés mudou contra a operação',
        corpo: `A tendência virou (EMA 50 a inverter, fecho a ${p} do lado errado). Considere proteger a posição.`,
      };
    case 'expirado':
      return { titulo: 'plano expirou', corpo: 'Passaram 20 velas sem tocar na entrada. Já não vale.' };
    case 'perdido':
      return { titulo: 'plano sem entrada', corpo: 'O preço seguiu sem tocar na entrada. Já não vale.' };
  }
}
