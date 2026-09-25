/**
 * ICT ALGO — liquidez.
 *
 * "Liquidity: the resting stop orders and pending orders that institutions need
 * to fill their large positions." Buy-side acima de máximos antigos, sell-side
 * abaixo de mínimos antigos.
 *
 * ── A DISTINÇÃO QUE DECIDE TUDO ────────────────────────────────────────────
 *
 * Varrimento e rompimento são a MESMA coisa no gráfico até a vela fechar. O
 * site dá a regra mecânica que os separa:
 *
 *   "a sweep must show a wick through the level with the candle body closing
 *    back above (for bullish sweeps). A candle close through the level means
 *    it is a run."
 *
 * Pavio passa, corpo fecha de volta → varrimento, espera-se reversão.
 * Corpo fecha para lá do nível     → run, é continuação, e o setup morre.
 *
 * Confundir os dois é comprar o topo de um rompimento a pensar que se está a
 * apanhar uma reversão. Esta é a única regra do módulo que não tem parâmetro
 * nenhum para afinar — ou o corpo fechou de volta, ou não fechou.
 *
 * ── DUAS FAMÍLIAS DE POÇAS, DUAS VIDAS DIFERENTES ──────────────────────────
 *
 *   estrutura   máximos e mínimos de swing, e os "equal highs/lows" — vivem
 *               `IDADE_MAXIMA` velas, porque o site fala de liquidez RECENTE
 *   calendário  máxima/mínima do dia e da semana anteriores e o range asiático
 *               — não envelhecem por velas: são substituídas quando o dia (ou
 *               a semana, ou a Ásia) seguinte fecha
 */

import type { Candle } from '../types/market.js';
import type { IctDireccao, OrigemPoca, PocaLiquidez, Swing, Varrimento } from './types.js';
import { pocaActivaEm } from './types.js';
import { killzonesActivas } from './tempo.js';

/** Tolerância, em ATR, para dois extremos contarem como "equal highs/lows". */
const TOLERANCIA_IGUAIS = 0.1;
/** Idade máxima de uma poça de ESTRUTURA, em velas. */
export const IDADE_MAXIMA = 200;
/**
 * Quanto para trás se procura uma poça activa. Tem de cobrir a semana anterior
 * no timeframe mais fino em uso (15M: 5 dias × 96 velas = 480), com folga.
 */
const JANELA_PROCURA = 1200;

const DIA = 86_400_000;

/** A poça é de estrutura (envelhece) ou de calendário (é substituída)? */
function deEstrutura(o: OrigemPoca): boolean {
  return o === 'swing' || o === 'equal-highs' || o === 'equal-lows';
}

/**
 * Poças de liquidez a partir dos swings confirmados.
 *
 * Um segundo topo ao mesmo nível (dentro de `TOLERANCIA_IGUAIS` ATR) faz nascer
 * uma poça de "equal highs" — o que o site chama "relative equal highs/lows", e
 * que acumula mais stops do que um topo isolado. A pergunta 4 do viés diário
 * ("which has the densest stop accumulation") lê exactamente os `toques`.
 *
 * Duas regras que impedem esta função de ler o futuro:
 *
 *   1. A poça nova nasce na vela em que o SEGUNDO topo é confirmado. A poça do
 *      primeiro topo não é alterada: existiu tal como era até essa vela, e só a
 *      partir dela é que passa a `substituida`.
 *   2. Só há "equal highs" se, entre os dois topos, o preço nunca tiver passado
 *      do nível. Se passou, o primeiro topo já foi varrido e os seus stops já
 *      não existem — o segundo é um topo novo, não um par.
 */
export function pocasDeSwings(
  swings: readonly Swing[],
  atr: number | Float64Array,
  velas?: readonly Candle[],
): PocaLiquidez[] {
  const out: PocaLiquidez[] = [];
  // A tolerância usa o ATR do INSTANTE em que o swing é confirmado — nunca uma
  // média da série inteira, que no backtest seria volatilidade do futuro.
  const tolEm = (k: number) => TOLERANCIA_IGUAIS * (typeof atr === 'number' ? atr : (atr[k] ?? 0));
  // A poça mais recente (e ainda não substituída) de cada lado, para comparar.
  const vivas: PocaLiquidez[] = [];

  for (const s of swings) {
    const lado = s.kind === 'high' ? 'buy-side' : 'sell-side';
    const tol = tolEm(s.confirmadoEm);
    let par: PocaLiquidez | null = null;
    for (let k = vivas.length - 1; k >= 0; k--) {
      const p = vivas[k]!;
      if (p.lado !== lado) continue;
      if (s.index - p.index > IDADE_MAXIMA) continue;
      if (Math.abs(p.preco - s.price) > tol) continue;
      if (velas && passouEntre(velas, p.index, s.index, p.preco, lado, tol)) continue;
      par = p;
      break;
    }

    if (par) {
      const toques = par.toques + 1;
      const nova: PocaLiquidez = {
        index: s.index,
        confirmadoEm: s.confirmadoEm,
        time: s.time,
        lado,
        // O extremo do conjunto: é aí que os stops de todos os toques estão.
        preco: lado === 'buy-side' ? Math.max(par.preco, s.price) : Math.min(par.preco, s.price),
        origem: s.kind === 'high' ? 'equal-highs' : 'equal-lows',
        toques,
        rotulo: `${toques} ${s.kind === 'high' ? 'máximos' : 'mínimos'} iguais`,
        varridaEm: null,
        substituidaEm: null,
      };
      par.substituidaEm = s.confirmadoEm;
      vivas.splice(vivas.indexOf(par), 1, nova);
      out.push(nova);
      continue;
    }

    const p: PocaLiquidez = {
      index: s.index,
      confirmadoEm: s.confirmadoEm,
      time: s.time,
      lado,
      preco: s.price,
      origem: 'swing',
      toques: 1,
      rotulo: s.kind === 'high' ? 'máximo anterior' : 'mínimo anterior',
      varridaEm: null,
      substituidaEm: null,
    };
    vivas.push(p);
    if (vivas.length > 400) vivas.splice(0, vivas.length - 400);
    out.push(p);
  }
  return out;
}

/** O preço passou do nível entre duas velas (exclusivo)? */
function passouEntre(
  velas: readonly Candle[],
  de: number,
  ate: number,
  nivel: number,
  lado: 'buy-side' | 'sell-side',
  tol: number,
): boolean {
  for (let k = de + 1; k < ate; k++) {
    const c = velas[k];
    if (!c) continue;
    if (lado === 'buy-side' ? c.high > nivel + tol : c.low < nivel - tol) return true;
  }
  return false;
}

/** Primeira vela com `time >= t` (busca binária). */
function primeiraVelaDesde(velas: readonly Candle[], t: number): number {
  let lo = 0;
  let hi = velas.length;
  while (lo < hi) {
    const meio = (lo + hi) >> 1;
    if (velas[meio]!.time < t) lo = meio + 1;
    else hi = meio;
  }
  return lo;
}

function pocaCalendario(
  velas: readonly Candle[],
  i: number,
  lado: 'buy-side' | 'sell-side',
  preco: number,
  origem: OrigemPoca,
  rotulo: string,
): PocaLiquidez {
  return {
    index: i,
    confirmadoEm: i,
    time: velas[i]!.time,
    lado,
    preco,
    origem,
    toques: 1,
    rotulo,
    varridaEm: null,
    substituidaEm: null,
  };
}

/** Cada poça passa a substituída quando nasce a seguinte da mesma família e lado. */
function encadear(pocas: PocaLiquidez[]): void {
  const ultima = new Map<string, PocaLiquidez>();
  for (const p of pocas) {
    const chave = `${p.origem}|${p.lado}`;
    const anterior = ultima.get(chave);
    if (anterior) anterior.substituidaEm = p.confirmadoEm;
    ultima.set(chave, p);
  }
}

/**
 * Poças de referência do calendário: máxima e mínima do dia e da semana
 * anteriores, e o range asiático.
 *
 * São as três que o site nomeia na pergunta 4 do viés ("Asian range, prior day
 * high/low, prior week high/low"). Uma vela diária ou semanal só serve depois de
 * FECHAR, por isso a poça nasce na primeira vela intradiária a seguir ao fecho.
 */
export function pocasDeCalendario(
  velas: readonly Candle[],
  diarias: readonly Candle[],
  semanais: readonly Candle[],
): PocaLiquidez[] {
  const out: PocaLiquidez[] = [];
  if (velas.length === 0) return out;

  const marcar = (fonte: readonly Candle[], duracao: number, origem: OrigemPoca, alto: string, baixo: string) => {
    for (const d of fonte) {
      const i = primeiraVelaDesde(velas, d.time + duracao);
      if (i >= velas.length) continue;
      out.push(pocaCalendario(velas, i, 'buy-side', d.high, origem, alto));
      out.push(pocaCalendario(velas, i, 'sell-side', d.low, origem, baixo));
    }
  };
  marcar(diarias, DIA, 'dia-anterior', 'máxima do dia anterior', 'mínima do dia anterior');
  marcar(semanais, 7 * DIA, 'semana-anterior', 'máxima da semana anterior', 'mínima da semana anterior');
  out.push(...pocasAsiaticas(velas));

  out.sort((a, b) => a.index - b.index);
  encadear(out);
  return out;
}

/**
 * O range asiático de cada dia, como duas poças.
 *
 * "Mark the high and low points established during the Asian consolidation.
 * These define the reference range that the subsequent phases will target."
 * Nasce na primeira vela FORA da Ásia — antes disso o range ainda se está a
 * formar e não é um nível de nada.
 */
export function pocasAsiaticas(velas: readonly Candle[]): PocaLiquidez[] {
  const out: PocaLiquidez[] = [];
  let alto = -Infinity;
  let baixo = Infinity;
  let dentro = false;
  for (let i = 0; i < velas.length; i++) {
    const c = velas[i]!;
    const asia = killzonesActivas(c.time).includes('asia');
    if (asia) {
      if (!dentro) {
        alto = -Infinity;
        baixo = Infinity;
        dentro = true;
      }
      alto = Math.max(alto, c.high);
      baixo = Math.min(baixo, c.low);
    } else if (dentro) {
      dentro = false;
      if (alto > baixo) {
        out.push(pocaCalendario(velas, i, 'buy-side', alto, 'range-asiatico', 'máxima da Ásia'));
        out.push(pocaCalendario(velas, i, 'sell-side', baixo, 'range-asiatico', 'mínima da Ásia'));
      }
    }
  }
  return out;
}

/** Primeiro índice de `pocas` (ordenadas por `index`) com `index >= alvo`. */
export function inicioDaJanela(pocas: readonly PocaLiquidez[], alvo: number): number {
  let lo = 0;
  let hi = pocas.length;
  while (lo < hi) {
    const meio = (lo + hi) >> 1;
    if (pocas[meio]!.index < alvo) lo = meio + 1;
    else hi = meio;
  }
  return lo;
}

/**
 * As poças que existiam, intactas, na vela `i`.
 *
 * `pocas` tem de vir ordenada por `index`. Percorre só a janela relevante e
 * pára na primeira poça posterior a `i` — que é também a primeira que ainda
 * não existia.
 */
export function pocasActivasEm(pocas: readonly PocaLiquidez[], i: number): PocaLiquidez[] {
  const out: PocaLiquidez[] = [];
  for (let k = inicioDaJanela(pocas, i - JANELA_PROCURA); k < pocas.length; k++) {
    const p = pocas[k]!;
    if (p.index > i) break;
    if (!pocaActivaEm(p, i)) continue;
    if (deEstrutura(p.origem) && i - p.index > IDADE_MAXIMA) continue;
    out.push(p);
  }
  return out;
}

/** Importância de uma poça, para escolher quando uma vela varre várias de uma vez. */
const PESO_ORIGEM: Record<OrigemPoca, number> = {
  'semana-anterior': 6,
  'dia-anterior': 5,
  'range-asiatico': 4,
  'equal-highs': 3,
  'equal-lows': 3,
  swing: 1,
};

/**
 * Varrimentos de liquidez em toda a série.
 *
 * Para cada vela, olha para as poças JÁ conhecidas e intactas e pergunta: o
 * pavio passou e o corpo fechou de volta?
 *
 * Uma poça só é varrida uma vez. Depois disso os stops que lá estavam já foram
 * accionados — insistir no mesmo nível é operar liquidez que já não existe.
 * Quando uma só vela varre várias poças do mesmo lado, fica UM varrimento, com
 * a poça mais importante: a máxima da semana anterior pesa mais do que um swing.
 */
export function varrimentos(
  velas: readonly Candle[],
  pocas: PocaLiquidez[],
  atr: Float64Array,
): Varrimento[] {
  const out: Varrimento[] = [];

  /*
   * Conjunto activo, em vez de refiltrar tudo em cada vela: O(velas + poças)
   * em vez de O(velas × poças). O que sai do conjunto é exactamente o que a
   * filtragem descartaria.
   */
  const ordenadas = [...pocas].sort((a, b) => a.confirmadoEm - b.confirmadoEm);
  let proxima = 0;
  let activas: PocaLiquidez[] = [];

  for (let i = 0; i < velas.length; i++) {
    while (proxima < ordenadas.length && ordenadas[proxima]!.confirmadoEm <= i) {
      activas.push(ordenadas[proxima]!);
      proxima++;
    }
    if ((i & 63) === 0) {
      activas = activas.filter(
        (p) =>
          p.varridaEm === null &&
          (p.substituidaEm === null || p.substituidaEm > i) &&
          !(deEstrutura(p.origem) && i - p.index > IDADE_MAXIMA),
      );
    }

    const c = velas[i]!;
    const a = atr[i] ?? 0;
    if (!(a > 0)) continue;

    let melhorAlta: Varrimento | null = null; // varreu máximos → venda
    let melhorBaixa: Varrimento | null = null; // varreu mínimos → compra

    for (const p of activas) {
      if (p.varridaEm !== null) continue;
      if (p.substituidaEm !== null && p.substituidaEm <= i) continue;
      if (deEstrutura(p.origem) && i - p.index > IDADE_MAXIMA) continue;
      // Nota: uma poça de calendário nasce na ABERTURA da vela `confirmadoEm` e
      // pode ser varrida por ela (o dia abre e vai logo buscar a máxima de
      // ontem). Uma de swing nunca o pode ser pela vela que a confirma — essa
      // vela tem, por definição do pivô, máxima abaixo dele.

      if (p.lado === 'buy-side') {
        if (c.high <= p.preco) continue;
        p.varridaEm = i; // os stops foram accionados, varrimento ou não
        // Corpo a fechar acima do nível: é um run, o nível foi aceite.
        if (Math.max(c.open, c.close) >= p.preco) continue;
        const v: Varrimento = {
          index: i,
          confirmadoEm: i,
          time: c.time,
          lado: 'bearish',
          poca: { ...p },
          extremo: c.high,
          penetracaoAtr: (c.high - p.preco) / a,
        };
        if (!melhorAlta || PESO_ORIGEM[p.origem] > PESO_ORIGEM[melhorAlta.poca.origem]) melhorAlta = v;
      } else {
        if (c.low >= p.preco) continue;
        p.varridaEm = i;
        if (Math.min(c.open, c.close) <= p.preco) continue;
        const v: Varrimento = {
          index: i,
          confirmadoEm: i,
          time: c.time,
          lado: 'bullish',
          poca: { ...p },
          extremo: c.low,
          penetracaoAtr: (p.preco - c.low) / a,
        };
        if (!melhorBaixa || PESO_ORIGEM[p.origem] > PESO_ORIGEM[melhorBaixa.poca.origem]) melhorBaixa = v;
      }
    }
    if (melhorAlta) out.push(melhorAlta);
    if (melhorBaixa) out.push(melhorBaixa);
  }
  return out;
}

/**
 * O draw on liquidity: a poça que o preço deve procurar, no sentido pedido.
 *
 * "Locate the nearest DOL in the daily bias direction." É o alvo da operação —
 * não um múltiplo de R inventado, mas um sítio concreto onde há ordens à espera.
 * Entre duas poças no mesmo sentido, a mais próxima é a que o preço encontra
 * primeiro.
 */
export function drawOnLiquidity(
  pocas: readonly PocaLiquidez[],
  i: number,
  preco: number,
  direccao: IctDireccao,
): PocaLiquidez | null {
  const lado = direccao === 'bullish' ? 'buy-side' : 'sell-side';
  let melhor: PocaLiquidez | null = null;
  let menorDistancia = Infinity;
  for (const p of pocasActivasEm(pocas, i)) {
    if (p.lado !== lado) continue;
    const d = direccao === 'bullish' ? p.preco - preco : preco - p.preco;
    if (d <= 0) continue; // já está do lado errado: não é um destino
    if (d < menorDistancia) {
      menorDistancia = d;
      melhor = p;
    }
  }
  return melhor;
}
