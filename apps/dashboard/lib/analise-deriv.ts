import 'server-only';

/**
 * Análise de instrumentos que o universo MMXM não cobre.
 *
 * ── O PROBLEMA QUE ISTO RESOLVE ────────────────────────────────────────────
 *
 * O motor MMXM tem um universo fechado de 17 instrumentos, porque o SMT precisa
 * de PARES correlacionados definidos à mão — um instrumento sozinho não pode
 * divergir contra nada. Mas o onboarding deixa escolher qualquer coisa que a
 * Deriv negoceie: índices sintéticos, DAX, Nikkei, Hang Seng.
 *
 * Antes, esses caíam num 404 e o painel dizia "instrumento desconhecido" — o
 * que, para quem os acabou de escolher, lê-se como avaria.
 *
 * ── O QUE FAZ EM VEZ DISSO ─────────────────────────────────────────────────
 *
 * Corre as estratégias institucionais (`runInstitutionalStrategies`) sobre as
 * velas da Deriv: supply & demand, suporte/resistência, bandas de VWAP e perfil
 * de volume. São análises REAIS e independentes de pares.
 *
 * O resultado é honesto sobre a diferença: estes instrumentos não têm
 * pontuação de checklist MMXM porque não passaram por ele. A resposta traz
 * `metodo: 'institucional'` e o painel diz qual foi usado.
 *
 * ── A RESSALVA QUE NÃO PODE SUMIR ──────────────────────────────────────────
 *
 * O perfil de volume assume volume por preço, e a Deriv **não entrega volume**
 * em `ticks_history` — vem tudo a zero. A estratégia é corrida na mesma porque
 * o código a trata como contagem de barras, mas o aviso viaja com o resultado
 * em vez de desaparecer.
 */

import {
  assessConfluence,
  runInstitutionalStrategies,
  type CandleSeries,
  type Timeframe,
} from '@trading/core';
import { acharSimbolo } from './deriv/simbolos';

const WS_PUBLICO = 'wss://api.derivws.com/trading/v1/options/ws/public';

/** Timeframe canónico → granularidade em segundos aceite pela Deriv. */
const GRANULARIDADE: Record<string, number> = {
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
  '1w': 86400, // agregado a seguir
};

interface VelaDeriv {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Uma ligação por chamada, fechada no fim.
 *
 * Não há pool: estas chamadas acontecem uma vez por instrumento a cada cinco
 * minutos, e um socket parado entre pedidos HTTP num servidor sem estado é uma
 * fuga à espera de acontecer.
 */
async function pedirVelas(
  derivSymbol: string,
  granularidade: number,
  quantidade: number,
): Promise<VelaDeriv[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_PUBLICO);
    let resolvido = false;

    const terminar = (fn: () => void) => {
      if (resolvido) return;
      resolvido = true;
      clearTimeout(prazo);
      try {
        ws.close();
      } catch {
        /* já fechado */
      }
      fn();
    };

    const prazo = setTimeout(
      () => terminar(() => reject(new Error('a Deriv não respondeu em 20s'))),
      20_000,
    );

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          ticks_history: derivSymbol,
          adjust_start_time: 1,
          count: Math.min(5000, quantidade),
          end: 'latest',
          start: 1,
          style: 'candles',
          granularity: granularidade,
          req_id: 1,
        }),
      );
    };

    ws.onmessage = (ev) => {
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(String(ev.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      const erro = m['error'] as { code?: string; message?: string } | undefined;
      if (erro) {
        terminar(() => reject(new Error(`${erro.code}: ${erro.message}`)));
        return;
      }
      const velas = m['candles'] as VelaDeriv[] | undefined;
      if (velas) terminar(() => resolve(velas));
    };

    ws.onerror = () => terminar(() => reject(new Error('erro de WebSocket na Deriv')));
    ws.onclose = () =>
      terminar(() => reject(new Error('a Deriv fechou a ligação antes de responder')));
  });
}

/** Agrega diárias em semanais, alinhadas a segunda-feira UTC. */
function agregarSemanas(velas: VelaDeriv[]): VelaDeriv[] {
  const baldes = new Map<number, VelaDeriv>();
  for (const c of velas) {
    const d = new Date(c.epoch * 1000);
    const dia = d.getUTCDay();
    const recuo = dia === 0 ? 6 : dia - 1;
    const inicio =
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - recuo) / 1000;
    const acc = baldes.get(inicio);
    if (!acc) baldes.set(inicio, { ...c, epoch: inicio });
    else {
      acc.high = Math.max(acc.high, c.high);
      acc.low = Math.min(acc.low, c.low);
      acc.close = c.close;
    }
  }
  return [...baldes.values()].sort((a, b) => a.epoch - b.epoch);
}

export interface AnaliseInstitucional {
  simbolo: string;
  nome: string;
  timeframe: Timeframe;
  metodo: 'institucional';
  /**
   * Pontuação 0..1 comparável com a do checklist MMXM apenas em ORDENAÇÃO.
   *
   * Não mede a mesma coisa: aqui é a convicção do melhor sinal encontrado, lá é
   * a fração de passos do checklist que passaram. Servem ambas para dizer
   * "olha primeiro para este", e nada mais.
   */
  pontuacao: number;
  direccao: string;
  resumo: string;
  concordam: number;
  discordam: number;
  avisos: string[];
  sinal: {
    direccao: string;
    entrada: number;
    stop: number;
    rMaximo: number;
    confianca: number;
    estrategia: string;
  } | null;
  em: number;
}

/**
 * Corre as estratégias institucionais sobre um símbolo da Deriv.
 *
 * Devolve `null` se a Deriv não conhecer o símbolo — quem chama decide se isso
 * é um erro ou apenas o fim da cadeia de tentativas.
 */
export async function analisarComDeriv(
  codigo: string,
  timeframe: Timeframe = '1d',
): Promise<AnaliseInstitucional | null> {
  const s = acharSimbolo(codigo);
  if (!s) return null;

  const gran = GRANULARIDADE[timeframe] ?? 86400;
  const semanal = timeframe === '1w';
  // 300 velas chegam para as estratégias e são um pedido pequeno; no semanal
  // pede-se sete vezes mais diárias para cobrir o mesmo alcance.
  const quantidade = semanal ? 300 * 7 : 300;

  let brutas = await pedirVelas(s.deriv, gran, quantidade);
  if (semanal) brutas = agregarSemanas(brutas);

  /*
   * A ÚLTIMA vela é descartada: no diário ela está em formação até à meia-noite
   * UTC, e uma zona detetada sobre uma vela viva desaparece na vela seguinte.
   * É o mesmo cuidado que `splitForming` tem no caminho MMXM.
   */
  const fechadas = brutas.slice(0, -1);

  const serie: CandleSeries = {
    symbol: s.codigo,
    timeframe,
    source: 'deriv',
    fidelity: 'true-ohlc',
    candles: fechadas.map((c) => ({
      time: c.epoch * 1000,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      // A Deriv não entrega volume em ticks_history. Zero é a verdade, não um
      // valor em falta — e o perfil de volume avisa por causa disso.
      volume: 0,
    })),
  };

  const r = runInstitutionalStrategies(serie, { minRMultiple: 2 });
  const confluencia = assessConfluence(r.signals);
  const melhor = r.signals[0] ?? null;

  return {
    simbolo: s.codigo,
    nome: s.nome,
    timeframe,
    metodo: 'institucional',
    pontuacao: melhor ? melhor.conviction : 0,
    direccao: confluencia.direction,
    resumo: melhor
      ? melhor.rationale
      : `Nenhuma das quatro estratégias encontrou um plano com R≥2 em ${serie.candles.length} velas.`,
    concordam: confluencia.agreeingStrategies,
    discordam: confluencia.opposingStrategies,
    avisos: [...r.dataWarnings, ...(melhor?.warnings ?? [])],
    sinal: melhor
      ? {
          direccao: melhor.direction,
          entrada: melhor.entryPrice,
          stop: melhor.stopLoss,
          rMaximo: melhor.maxRMultiple,
          confianca: melhor.conviction,
          estrategia: melhor.strategy,
        }
      : null,
    em: Date.now(),
  };
}
