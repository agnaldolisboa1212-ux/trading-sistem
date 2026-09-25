/**
 * ICT ALGO — tempo.
 *
 * O ICT é, antes de tudo, um modelo de HORAS. As mesmas velas dizem coisas
 * diferentes conforme a hora a que aparecem, e o site é explícito: "all prior
 * steps correct but no kill zone = wait".
 *
 * ── AS JANELAS, TAL COMO O SITE AS DÁ (hora de Nova Iorque) ────────────────
 *
 *   Ásia            20:00 – 02:00   acumulação; define o range de referência
 *   Londres         02:00 – 05:00   manipulação; é aqui que mora o Judas swing
 *   NY AM           07:00 – 10:00   distribuição; a entrega no sentido do viés
 *   Silver Bullet   10:00 – 11:00   a hora em que o FVG aparece de forma fiável
 *   NY PM           13:30 – 16:00   sessão da tarde
 *
 * Power of 3: "Accumulation 8 PM – 2 AM EST", "Manipulation 2 AM – 5 AM EST",
 * "Distribution 7 AM – 10 AM EST".
 *
 * ── PORQUE É QUE ISTO NÃO USA `Intl.DateTimeFormat` ────────────────────────
 *
 * Usava, e estava correcto — mas um backtest percorre milhões de velas e uma
 * chamada de formatação por vela torna o teste impraticável. A regra de horário
 * de verão dos EUA é aritmética desde 2007 (segundo domingo de Março às 02:00
 * locais até ao primeiro domingo de Novembro), por isso calcula-se em vez de se
 * formatar. O teste `ict-tempo.test.mjs` compara as duas implementações ao
 * longo de vários anos, incluindo os dias da transição — se divergirem, falha.
 */

import type { JanelaTempo, FaseAmd, NomeKillzone } from './types.js';

const HORA = 3_600_000;
const DIA = 86_400_000;

/** Domingo `n` de um mês (1 = o primeiro), em ms UTC à meia-noite UTC. */
function domingoN(ano: number, mes: number, n: number): number {
  const primeiro = Date.UTC(ano, mes, 1);
  const dow = new Date(primeiro).getUTCDay();
  const primeiroDomingo = 1 + ((7 - dow) % 7);
  return Date.UTC(ano, mes, primeiroDomingo + (n - 1) * 7);
}

/**
 * Nova Iorque está em horário de verão neste instante?
 *
 * Começa no 2.º domingo de Março às 02:00 EST = 07:00 UTC.
 * Acaba no 1.º domingo de Novembro às 02:00 EDT = 06:00 UTC.
 */
function emHorarioDeVerao(t: number): boolean {
  const ano = new Date(t).getUTCFullYear();
  const inicio = domingoN(ano, 2, 2) + 7 * HORA;
  const fim = domingoN(ano, 10, 1) + 6 * HORA;
  return t >= inicio && t < fim;
}

/** Desvio de Nova Iorque face a UTC, em horas (−5 no Inverno, −4 no Verão). */
export function desvioNy(t: number): number {
  return emHorarioDeVerao(t) ? -4 : -5;
}

/** Hora, minuto e dia da semana em Nova Iorque. */
export function relogioNy(t: number): { hora: number; minuto: number; diaSemana: number } {
  const local = t + desvioNy(t) * HORA;
  const d = new Date(local);
  return { hora: d.getUTCHours(), minuto: d.getUTCMinutes(), diaSemana: d.getUTCDay() };
}

/** Minutos desde a meia-noite de Nova Iorque. */
function minutosNy(t: number): number {
  const { hora, minuto } = relogioNy(t);
  return hora * 60 + minuto;
}

const m = (h: number, min = 0) => h * 60 + min;

/**
 * Killzones activas num instante.
 *
 * A Ásia atravessa a meia-noite, por isso é o único intervalo testado com OU em
 * vez de E. O Silver Bullet vive DENTRO da NY AM alargada — quando está activo,
 * ambos aparecem, porque são duas afirmações verdadeiras ao mesmo tempo.
 */
export function killzonesActivas(t: number): NomeKillzone[] {
  const x = minutosNy(t);
  const out: NomeKillzone[] = [];
  if (x >= m(20) || x < m(2)) out.push('asia');
  if (x >= m(2) && x < m(5)) out.push('londres');
  if (x >= m(7) && x < m(10)) out.push('ny-am');
  if (x >= m(10) && x < m(11)) out.push('silver-bullet');
  if (x >= m(13, 30) && x < m(16)) out.push('ny-pm');
  return out;
}

/**
 * Fase do ciclo AMD.
 *
 * As três janelas do Power of 3 não cobrem o dia todo — entre as 05:00 e as
 * 07:00, e depois das 16:00, o algoritmo está `fora` e não opera. Isso é
 * intencional: o site descreve a entrega institucional nestas janelas, e fora
 * delas não há afirmação nenhuma a fazer.
 */
export function faseAmd(t: number): FaseAmd {
  const x = minutosNy(t);
  if (x >= m(20) || x < m(2)) return 'acumulacao';
  if (x >= m(2) && x < m(5)) return 'manipulacao';
  if (x >= m(7) && x < m(16)) return 'distribuicao';
  return 'fora';
}

/**
 * A janela Silver Bullet em que o instante cai, se alguma.
 *
 * O site descreve o Silver Bullet como "a specific one-hour window" e dá as três
 * janelas de uma hora: Londres (03:00–04:00), Nova Iorque manhã (10:00–11:00) e
 * Nova Iorque tarde (14:00–15:00), sempre em hora de Nova Iorque. Fora delas,
 * um FVG pode ser bom mas não é um Silver Bullet.
 */
export function janelaSilverBullet(t: number): 'londres' | 'ny-am' | 'ny-pm' | null {
  const x = minutosNy(t);
  if (x >= m(3) && x < m(4)) return 'londres';
  if (x >= m(10) && x < m(11)) return 'ny-am';
  if (x >= m(14) && x < m(15)) return 'ny-pm';
  return null;
}

/**
 * Índice da última vela JÁ FECHADA de uma série, num instante.
 *
 * Uma vela diária que abre às 00:00 só pode ser lida às 00:00 do dia seguinte.
 * Todas as leituras de timeframe superior passam por aqui, e é por passarem por
 * aqui que nenhuma delas vê uma vela ainda em formação. Busca binária: é
 * chamada em cada vela de um backtest de dez anos.
 */
export function ultimaFechadaAte(
  velas: readonly { time: number }[],
  duracaoMs: number,
  instante: number,
): number {
  let lo = 0;
  let hi = velas.length;
  // Primeira vela que AINDA NÃO fechou no instante.
  while (lo < hi) {
    const meio = (lo + hi) >> 1;
    if (velas[meio]!.time + duracaoMs <= instante) lo = meio + 1;
    else hi = meio;
  }
  return lo - 1;
}

/** Leitura completa do relógio para uma vela. */
export function janelaDe(t: number): JanelaTempo {
  const { hora, minuto } = relogioNy(t);
  return { killzones: killzonesActivas(t), fase: faseAmd(t), horaNy: hora, minutoNy: minuto };
}

/**
 * A janela permite EXECUTAR?
 *
 * Do site: entrar durante a manipulação é o erro que o modelo existe para
 * evitar ("this prevents entering during Manipulation believing you're entering
 * Distribution"). Executa-se em Londres (depois do varrimento) e na sessão de
 * Nova Iorque; nunca na acumulação asiática, onde o range ainda se está a
 * formar e não há nada para varrer.
 */
export function janelaPermiteEntrada(j: JanelaTempo): boolean {
  return j.killzones.some((k) => k === 'londres' || k === 'ny-am' || k === 'silver-bullet' || k === 'ny-pm');
}

/** Fim-de-semana: sexta depois do fecho de NY até domingo à noite. */
export function mercadoFechado(t: number): boolean {
  const { diaSemana, hora } = relogioNy(t);
  if (diaSemana === 6) return true;
  if (diaSemana === 5 && hora >= 17) return true;
  if (diaSemana === 0 && hora < 17) return true;
  return false;
}

/**
 * O range asiático do dia a que esta vela pertence.
 *
 * "Mark the high and low points established during the Asian consolidation.
 * These define the reference range that the subsequent phases will target."
 *
 * Só olha para velas ANTERIORES a `i` e que já fecharam dentro da janela
 * asiática — por construção, não vê o futuro. Devolve null antes de a Ásia ter
 * acabado, porque um range a meio de se formar não é um nível de referência.
 */
export function rangeAsiatico(
  velas: readonly { time: number; high: number; low: number }[],
  i: number,
): { alto: number; baixo: number; desde: number } | null {
  const agora = velas[i];
  if (!agora) return null;
  // Se ainda estamos na Ásia, o range do dia ainda não está fechado.
  if (killzonesActivas(agora.time).includes('asia')) return null;

  let alto = -Infinity;
  let baixo = Infinity;
  let desde = -1;
  // Recua no máximo 24h de velas à procura do bloco asiático mais recente.
  for (let k = i - 1; k >= 0 && agora.time - velas[k]!.time <= DIA; k--) {
    const v = velas[k]!;
    if (killzonesActivas(v.time).includes('asia')) {
      alto = Math.max(alto, v.high);
      baixo = Math.min(baixo, v.low);
      desde = k;
    } else if (desde >= 0) {
      break; // saímos do bloco asiático contíguo
    }
  }
  if (desde < 0 || !(alto > baixo)) return null;
  return { alto, baixo, desde };
}
