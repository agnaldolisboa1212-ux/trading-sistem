/**
 * ICT ALGO — o regime do momento, lido do macro ao micro.
 *
 * É este ficheiro que faz o algoritmo trocar de setup. Não escolhe um modelo
 * pelo que ganhou no passado: lê a estrutura, diz em que situação o mercado
 * está AGORA, e cada situação tem os modelos que o site descreve para ela.
 *
 *   semanal   macro      topos e fundos semanais — o sentido de fundo
 *   diário    viés       as cinco perguntas — o sentido do dia e o destino
 *   execução  micro      a estrutura do 15M/1H, e o que ACABOU de acontecer:
 *                        um varrimento? um MSS? um BOS? uma faixa apertada?
 *   relógio   tempo      a killzone em que o acontecimento se deu
 *
 * ── AS REGRAS, PELA ORDEM EM QUE SÃO TESTADAS ──────────────────────────────
 *
 *   1 MANIPULAÇÃO   o preço varreu liquidez numa killzone de Londres ou Nova
 *                   Iorque, no sentido que arma o viés diário (varrer mínimos
 *                   num dia de alta), e o extremo varrido ainda não foi
 *                   ultrapassado. É a fase M do Power of 3 a acabar — "the
 *                   model targets transitions between Manipulation and
 *                   Distribution".
 *   2 REVERSÃO      o micro vinha contra o viés e acabou de o quebrar com
 *                   deslocamento: um MSS no sentido do viés. O micro volta a
 *                   alinhar com o dia.
 *   3 TENDÊNCIA     micro e diário no mesmo sentido, semanal não contra, e o
 *                   último acontecimento estrutural é um BOS nesse sentido
 *                   ("BOS confirms trend continuation").
 *   4 CONSOLIDAÇÃO  micro sem sentido e as últimas 24 velas numa faixa estreita
 *                   — o preço oscila entre liquidez interna e externa.
 *   5 INDEFINIDO    nada disto: o algoritmo espera.
 *
 * A ordem importa e é deliberada: um varrimento seguido de MSS é, ao mesmo
 * tempo, "manipulação" e "reversão"; lê-se como manipulação porque é o caso
 * mais completo, e os modelos da manipulação exigem mais peças.
 *
 * ── A REGRA QUE ATRAVESSA TODAS ────────────────────────────────────────────
 *
 * Top-down quer dizer que o macro manda no micro. Com o viés diário neutro, os
 * três primeiros regimes não existem: sem sentido para o dia não há setup
 * direccional, só a faixa.
 */

import type { Candle } from '../types/market.js';
import type {
  IctDireccao,
  IctVies,
  LeituraRegime,
  QuebraEstrutura,
  Varrimento,
  ViesDiario,
} from './types.js';
import { ultimaQuebraAte } from './estrutura.js';
import { killzonesActivas } from './tempo.js';

/** Velas em que um varrimento ou um MSS ainda contam como "acabou de acontecer". */
export const JANELA_EVENTO = 12;
/** Velas para trás em que se procura o BOS da tendência. */
export const JANELA_TENDENCIA = 24;
/** Amplitude máxima das últimas 24 velas, em ATR, para haver consolidação. */
export const COMPRESSAO_MAXIMA = 6;

const nomeVies = (v: IctVies) => (v === 'bullish' ? 'alta' : v === 'bearish' ? 'baixa' : 'sem sentido');
const oposto = (d: IctDireccao): IctDireccao => (d === 'bullish' ? 'bearish' : 'bullish');

export interface EntradaRegime {
  velas: readonly Candle[];
  i: number;
  atr: Float64Array;
  /** Tendência estrutural por vela (1, −1, 0), de `tendenciasPorVela`. */
  tendencias: Int8Array;
  quebras: readonly QuebraEstrutura[];
  varrimentos: readonly Varrimento[];
  vies: ViesDiario;
  /** Nome do timeframe de execução, só para as frases. */
  rotuloTf: string;
}

/** O último varrimento conhecido na vela `i`, até `maxVelas` para trás. */
function ultimoVarrimentoAte(vs: readonly Varrimento[], i: number, maxVelas: number, lado?: IctDireccao) {
  // Os varrimentos saem ordenados por vela: percorre de trás para a frente.
  let lo = 0;
  let hi = vs.length;
  while (lo < hi) {
    const meio = (lo + hi) >> 1;
    if (vs[meio]!.index <= i) lo = meio + 1;
    else hi = meio;
  }
  for (let k = lo - 1; k >= 0; k--) {
    const v = vs[k]!;
    if (i - v.index > maxVelas) break;
    if (v.confirmadoEm > i) continue;
    if (lado && v.lado !== lado) continue;
    return v;
  }
  return null;
}

/** Algum fecho, depois do varrimento e até `i`, passou para lá do extremo varrido? */
function varrimentoInvalidado(velas: readonly Candle[], v: Varrimento, i: number): boolean {
  for (let k = v.index + 1; k <= i; k++) {
    const c = velas[k]!;
    if (v.lado === 'bullish' ? c.close < v.extremo : c.close > v.extremo) return true;
  }
  return false;
}

/**
 * Lê o regime na vela `i`.
 *
 * Função pura, e só lê o que já era conhecível em `i`: as quebras e os
 * varrimentos passam pelo mesmo guarda `confirmadoEm <= i` de todo o módulo.
 */
export function lerRegime(e: EntradaRegime): LeituraRegime {
  const { velas, i, atr, tendencias, quebras, varrimentos, vies, rotuloTf } = e;
  const macro = vies.estruturaSemanal;
  const diario = vies.direccao;
  const t = tendencias[i] ?? 0;
  const micro: IctVies = t > 0 ? 'bullish' : t < 0 ? 'bearish' : 'neutral';
  const p5 = vies.respostas[4];
  const zonaDiaria: 'premium' | 'discount' = p5?.resposta === 'bearish' ? 'premium' : 'discount';

  // Amplitude recente, em ATR.
  let alto = -Infinity;
  let baixo = Infinity;
  for (let k = Math.max(0, i - 23); k <= i; k++) {
    alto = Math.max(alto, velas[k]!.high);
    baixo = Math.min(baixo, velas[k]!.low);
  }
  const a = atr[i] ?? 0;
  const compressao = a > 0 ? (alto - baixo) / a : Infinity;

  const ultimaQuebra = ultimaQuebraAte(quebras, i, JANELA_TENDENCIA);
  const ultimoVarrimento = ultimoVarrimentoAte(varrimentos, i, JANELA_EVENTO);

  const leitura: string[] = [
    `Semanal: ${nomeVies(macro)}.`,
    `Diário: viés de ${nomeVies(diario)}` +
      (diario !== 'neutral' ? ` (${vies.aFavor} de 5 perguntas)` : '') +
      `; preço em ${zonaDiaria} da faixa de 20 dias.`,
    `${rotuloTf}: estrutura de ${nomeVies(micro)}.`,
  ];
  if (ultimoVarrimento) {
    leitura.push(
      `Varreu ${ultimoVarrimento.poca.rotulo} há ${i - ultimoVarrimento.index} velas ` +
        `(${killzonesActivas(ultimoVarrimento.time).join(', ') || 'fora de killzone'}).`,
    );
  }
  if (ultimaQuebra) {
    leitura.push(
      `Última quebra: ${ultimaQuebra.tipo.toUpperCase()} de ${nomeVies(ultimaQuebra.lado)} ` +
        `há ${i - ultimaQuebra.index} velas, em ${ultimaQuebra.nivel}.`,
    );
  }

  const base = { macro, diario, micro, zonaDiaria, ultimaQuebra, ultimoVarrimento, compressao };
  const com = (regime: LeituraRegime['regime'], direccao: IctDireccao | null, frase: string): LeituraRegime => ({
    ...base,
    regime,
    direccao,
    leitura: [...leitura, frase],
  });

  if (diario !== 'neutral') {
    // 1 — Manipulação: varrimento em killzone que arma o viés, ainda intacto.
    const v = ultimoVarrimentoAte(varrimentos, i, JANELA_EVENTO, diario);
    if (v) {
      const kz = killzonesActivas(v.time);
      const emKillzone = kz.includes('londres') || kz.includes('ny-am') || kz.includes('silver-bullet') || kz.includes('ny-pm');
      if (emKillzone && !varrimentoInvalidado(velas, v, i)) {
        return com(
          'manipulacao',
          diario,
          `Regime: MANIPULAÇÃO — varreu ${v.poca.rotulo} contra o viés, dentro de killzone; espera-se a distribuição para ${nomeVies(diario)}.`,
        );
      }
    }

    // 2 — Reversão: MSS recente no sentido do viés.
    const mss = ultimaQuebraAte(quebras, i, JANELA_EVENTO, (q) => q.tipo === 'mss' && q.lado === diario);
    const contraDepois = mss
      ? ultimaQuebraAte(quebras, i, i - mss.index, (q) => q.index > mss.index && q.lado === oposto(diario))
      : null;
    if (mss && !contraDepois) {
      return com(
        'reversao',
        diario,
        `Regime: REVERSÃO — o ${rotuloTf} vinha contra o viés e virou com deslocamento (MSS) para ${nomeVies(diario)}.`,
      );
    }

    // 3 — Tendência: micro e diário alinhados, semanal não contra, BOS recente.
    if (micro === diario && macro !== oposto(diario)) {
      const bos = ultimaQuebraAte(quebras, i, JANELA_TENDENCIA, (q) => q.tipo === 'bos' && q.lado === diario);
      const contra = bos
        ? ultimaQuebraAte(quebras, i, i - bos.index, (q) => q.index > bos.index && q.lado === oposto(diario))
        : null;
      if (bos && !contra) {
        return com(
          'tendencia',
          diario,
          `Regime: TENDÊNCIA — semanal, diário e ${rotuloTf} alinhados, com BOS de ${nomeVies(diario)} há ${i - bos.index} velas.`,
        );
      }
    }
  }

  // 4 — Consolidação: micro sem sentido e faixa estreita.
  if (micro === 'neutral' && compressao <= COMPRESSAO_MAXIMA) {
    // Com viés, só o lado do viés; sem viés, os dois extremos da faixa.
    return com(
      'consolidacao',
      diario === 'neutral' ? null : diario,
      `Regime: CONSOLIDAÇÃO — ${rotuloTf} sem sentido e as últimas 24 velas numa faixa de ${compressao.toFixed(1)} ATR.`,
    );
  }

  return com(
    'indefinido',
    null,
    diario === 'neutral'
      ? 'Regime: INDEFINIDO — sem viés diário e sem faixa definida. O algoritmo espera.'
      : `Regime: INDEFINIDO — o ${rotuloTf} não está nem em manipulação, nem em reversão, nem em tendência limpa. O algoritmo espera.`,
  );
}
