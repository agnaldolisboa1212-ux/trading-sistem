/**
 * ICT ALGO — que modelo montar, agora.
 *
 * Duas camadas, e a ordem entre elas é a parte importante:
 *
 *   1. ESTRUTURA (manda)  o regime lido do macro ao micro diz que modelos fazem
 *                         sentido neste momento. O mapa está escrito aqui, à
 *                         vista, e foi fixado a partir do que o site diz de cada
 *                         modelo — NÃO a partir de resultados. Um mapa escolhido
 *                         depois de ver qual modelo ganhou em cada regime seria
 *                         um ajuste aos dados, e dava um backtest bonito e uma
 *                         conta real a perder.
 *
 *   2. HISTÓRICO (trava)  entre os modelos que a estrutura permite, um que ande a
 *                         perder NESTE instrumento fica de quarentena. Só conta
 *                         operações que já tinham FECHADO antes da vela que está
 *                         a decidir: o algoritmo sabe o que um operador saberia
 *                         naquele instante, e nada mais.
 *
 * O histórico nunca escolhe um modelo que a estrutura não permitiu. Só pode
 * tirar um da lista.
 */

import type {
  IctDireccao,
  LeituraRegime,
  ModeloIct,
  PlacarModelo,
  RegimeIct,
  ResultadoModelo,
} from './types.js';
import { NOME_MODELO } from './types.js';
import type { Avaliador } from './modelos/comum.js';
import { avaliarVenom } from './modelos/venom.js';
import { avaliarCrt } from './modelos/crt.js';
import { avaliarReaper } from './modelos/reaper.js';
import { avaliarSilverBullet } from './modelos/silver-bullet.js';
import { avaliarUnicorn } from './modelos/unicorn.js';
import { avaliarTurtleSoup } from './modelos/turtle-soup.js';
import { avaliarContinuacao } from './modelos/continuacao.js';
import { avaliarMentorship2022 } from './modelos/mentorship-2022.js';

/**
 * O mapa regime → modelos, por ordem de prioridade.
 *
 *   manipulação   Venom é o modelo que o site desenha para a transição de
 *                 manipulação para distribuição; CRT é a mesma leitura sem SMT;
 *                 Reaper é a manipulação que parte um FVG; Silver Bullet é a
 *                 manipulação na abertura de uma janela horária.
 *   reversão      Unicorn (breaker = order block que falhou = mudança de mãos),
 *                 Turtle Soup (rompimento falhado), Reaper.
 *   tendência     continuação por OTE + PD array ("BOS confirms trend
 *                 continuation"); Silver Bullet a favor do viés.
 *   consolidação  Turtle Soup nos extremos iguais da faixa; CRT entre os
 *                 extremos da vela de referência.
 *
 * O modelo da mentoria de 2022 (varrimento → MSS → FVG em desconto/prémio)
 * entra na manipulação, logo a seguir ao Venom (é o mesmo movimento sem exigir
 * SMT), e na reversão, a seguir ao Unicorn (um varrimento que parte a estrutura
 * é uma mudança de mãos). Fixado pela descrição do modelo, antes de medir.
 *
 * Dentro de cada regime, o primeiro da lista que montar setup é o escolhido: a
 * prioridade é a do modelo mais exigente para o menos, e é fixa.
 */
export const MODELOS_DO_REGIME: Readonly<Record<RegimeIct, readonly ModeloIct[]>> = {
  manipulacao: ['venom', 'mentorship-2022', 'crt', 'reaper-ifvg', 'silver-bullet'],
  reversao: ['unicorn', 'mentorship-2022', 'turtle-soup', 'reaper-ifvg'],
  tendencia: ['continuacao', 'silver-bullet'],
  consolidacao: ['turtle-soup', 'crt'],
  indefinido: [],
};

export const AVALIADORES: Readonly<Record<ModeloIct, Avaliador>> = {
  venom: avaliarVenom,
  crt: avaliarCrt,
  'reaper-ifvg': avaliarReaper,
  'silver-bullet': avaliarSilverBullet,
  unicorn: avaliarUnicorn,
  'turtle-soup': avaliarTurtleSoup,
  continuacao: avaliarContinuacao,
  'mentorship-2022': avaliarMentorship2022,
};

export const TODOS_OS_MODELOS: readonly ModeloIct[] = [
  'venom',
  'crt',
  'reaper-ifvg',
  'silver-bullet',
  'unicorn',
  'turtle-soup',
  'continuacao',
  'mentorship-2022',
];

/** Operações fechadas que contam para o placar. */
export const PLACAR_JANELA = 20;
/** Abaixo disto não há amostra para condenar um modelo. */
export const PLACAR_MINIMO = 10;

export interface RegistoOperacao {
  modelo: ModeloIct;
  /** Instante (ms) em que a operação FECHOU. */
  fechoTime: number;
  r: number;
}

/**
 * O placar de cada modelo no instante `agora`.
 *
 * Só entram operações com `fechoTime <= agora`. Uma operação ainda aberta — ou
 * que fechou depois — não existe para quem está a decidir agora.
 */
export function calcularPlacar(registos: readonly RegistoOperacao[], agora: number): PlacarModelo[] {
  return TODOS_OS_MODELOS.map((modelo) => {
    const fechadas = registos
      .filter((x) => x.modelo === modelo && x.fechoTime <= agora)
      .sort((a, b) => a.fechoTime - b.fechoTime)
      .slice(-PLACAR_JANELA);
    const n = fechadas.length;
    const media = n > 0 ? fechadas.reduce((s, x) => s + x.r, 0) / n : 0;
    return { modelo, n, media, quarentena: n >= PLACAR_MINIMO && media < 0 };
  });
}

export interface Escolha {
  escolhido: ResultadoModelo | null;
  elegiveis: ModeloIct[];
  porqueNao: string | null;
}

/**
 * Escolhe o setup do momento.
 *
 * `candidatos` são os veredictos de todos os modelos, nos dois sentidos, na
 * vela actual. `usadas` são chaves de setups já tomados (o mesmo setup não se
 * toma duas vezes).
 */
export function escolherModelo(
  regime: LeituraRegime,
  candidatos: readonly ResultadoModelo[],
  placar: readonly PlacarModelo[],
  usarQuarentena: boolean,
  usadas: ReadonlySet<string> = new Set(),
): Escolha {
  const elegiveis = [...MODELOS_DO_REGIME[regime.regime]];
  if (elegiveis.length === 0) {
    return { escolhido: null, elegiveis, porqueNao: regime.leitura[regime.leitura.length - 1] ?? 'regime indefinido' };
  }
  const permitidas: IctDireccao[] = regime.direccao ? [regime.direccao] : ['bullish', 'bearish'];
  const razoes: string[] = [];

  for (const m of elegiveis) {
    const p = placar.find((x) => x.modelo === m);
    if (usarQuarentena && p?.quarentena) {
      razoes.push(`${NOME_MODELO[m]} de quarentena (${p.media.toFixed(2)}R nas últimas ${p.n})`);
      continue;
    }
    const doModelo = candidatos.filter((c) => c.modelo === m);
    const comSinal = doModelo.find(
      (c) => c.sinal && permitidas.includes(c.sinal.direccao) && !usadas.has(c.sinal.chave),
    );
    if (comSinal) return { escolhido: comSinal, elegiveis, porqueNao: null };
    // A razão que interessa é a do sentido que o regime permite.
    const noSentido = doModelo.find((c) => c.direccao !== undefined && permitidas.includes(c.direccao));
    razoes.push(`${NOME_MODELO[m]}: ${noSentido?.porqueNao ?? 'sem setup'}`);
  }
  return { escolhido: null, elegiveis, porqueNao: razoes.join(' · ') };
}
