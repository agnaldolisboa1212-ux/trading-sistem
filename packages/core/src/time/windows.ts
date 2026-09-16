/**
 * Time & Price alignment em escala MACRO.
 *
 * O eBook trabalha com macros intradiarios (XX:45 - XX:15) e killzones de
 * sessao. Este sistema opera swing de semanas, por isso os mesmos conceitos sao
 * FRACTALIZADOS um nivel acima — o proprio eBook autoriza isto:
 *
 *   "These time cycles can be fractalized into smaller time cycles."
 *   "the Market Maker Model is a fractal within price action"
 *
 * Traducao aplicada:
 *
 *   eBook (intradiario)          este sistema (swing)
 *   ---------------------------  -----------------------------------------
 *   Asia / London / NY           Dia / Semana / Mes / Trimestre
 *   "During London we refer to   Ao operar o DIARIO referimo-nos a maxima e
 *    Asia's High and Low"         minima da SEMANA anterior; ao operar o
 *                                 SEMANAL, as do MES anterior.
 *   TOI XX:45-XX:15              Janela de reversao semanal (seg-qua) e
 *                                 janela de reversao mensal (inicio e meio).
 *
 * Base empirica da janela semanal: numa tendencia semanal, a extremidade oposta
 * da semana forma-se tipicamente entre segunda e quarta-feira, e a expansao
 * ocorre de quarta a sexta. E o analogo direto do "reversal vs expansion" que o
 * eBook descreve para os macros.
 */

export type MacroWindowKind =
  | 'weekly-reversal'
  | 'weekly-expansion'
  | 'monthly-reversal'
  | 'monthly-expansion'
  | 'quarterly-shift';

export interface MacroWindow {
  kind: MacroWindowKind;
  /** Funcao delivery esperada, na linguagem do eBook. */
  delivery: 'reversal' | 'expansion';
  label: string;
  /** Peso da janela ao pontuar "does time meet price?" (0..1). */
  weight: number;
}

/** Dia da semana em UTC: 0=domingo ... 6=sabado. */
function weekday(time: number): number {
  return new Date(time).getUTCDay();
}

/** Dia do mes em UTC (1-31). */
function dayOfMonth(time: number): number {
  return new Date(time).getUTCDate();
}

/** Mes em UTC (0-11). */
function month(time: number): number {
  return new Date(time).getUTCMonth();
}

/**
 * Janelas macro ativas num instante.
 *
 * Um mesmo instante pode estar em varias janelas ao mesmo tempo — por exemplo
 * a primeira terca-feira de Janeiro esta simultaneamente na janela de reversao
 * semanal, na mensal e no shift trimestral. Quanto mais janelas coincidem, mais
 * forte e o alinhamento Time & Price.
 */
export function activeMacroWindows(time: number): MacroWindow[] {
  const out: MacroWindow[] = [];
  const wd = weekday(time);
  const dom = dayOfMonth(time);
  const m = month(time);

  // --- Ciclo semanal -------------------------------------------------------
  // Segunda a quarta: janela onde a extremidade da semana costuma formar-se.
  if (wd >= 1 && wd <= 3) {
    out.push({
      kind: 'weekly-reversal',
      delivery: 'reversal',
      label: 'Janela de reversao semanal (seg-qua)',
      weight: wd === 2 || wd === 3 ? 1.0 : 0.75, // terca/quarta sao o nucleo
    });
  }

  // Quarta a sexta: janela de entrega do lado direito da curva.
  if (wd >= 3 && wd <= 5) {
    out.push({
      kind: 'weekly-expansion',
      delivery: 'expansion',
      label: 'Janela de expansao semanal (qua-sex)',
      weight: wd === 4 ? 1.0 : 0.8, // quinta costuma ser o dia de maior extensao
    });
  }

  // --- Ciclo mensal --------------------------------------------------------
  // Primeiros dias uteis: reversao/estabelecimento do vies do mes.
  if (dom <= 5) {
    out.push({
      kind: 'monthly-reversal',
      delivery: 'reversal',
      label: 'Janela de reversao mensal (dias 1-5)',
      weight: 0.9,
    });
  }

  // Meio do mes: segunda oportunidade de reversao (analogo ao 2o macro).
  if (dom >= 10 && dom <= 16) {
    out.push({
      kind: 'monthly-reversal',
      delivery: 'reversal',
      label: 'Janela de reversao mensal (dias 10-16)',
      weight: 0.7,
    });
  }

  // Terco final: entrega em direcao a liquidez do mes.
  if (dom >= 18 && dom <= 28) {
    out.push({
      kind: 'monthly-expansion',
      delivery: 'expansion',
      label: 'Janela de expansao mensal (dias 18-28)',
      weight: 0.7,
    });
  }

  // --- Ciclo trimestral ----------------------------------------------------
  // Primeiras duas semanas de Jan/Abr/Jul/Out: mudanca de vies trimestral.
  if ([0, 3, 6, 9].includes(m) && dom <= 14) {
    out.push({
      kind: 'quarterly-shift',
      delivery: 'reversal',
      label: 'Shift trimestral (2 primeiras semanas do trimestre)',
      weight: 1.0,
    });
  }

  return out;
}

/** True se o instante esta numa janela cuja funcao esperada e reversao. */
export function isReversalWindow(time: number): boolean {
  return activeMacroWindows(time).some((w) => w.delivery === 'reversal');
}

/** True se o instante esta numa janela cuja funcao esperada e expansao. */
export function isExpansionWindow(time: number): boolean {
  return activeMacroWindows(time).some((w) => w.delivery === 'expansion');
}

/**
 * Pontuacao de alinhamento Time & Price em 0..1.
 *
 * Combina os pesos das janelas ativas cuja funcao (`reversal`/`expansion`)
 * coincide com a funcao que o setup precisa naquele momento.
 */
export function timeAlignmentScore(time: number, needs: 'reversal' | 'expansion'): number {
  const matching = activeMacroWindows(time).filter((w) => w.delivery === needs);
  if (matching.length === 0) return 0;

  // Confluencia de janelas soma, mas com retornos decrescentes.
  const total = matching.reduce((acc, w) => acc + w.weight, 0);
  return Math.min(1, total / 1.6);
}

/**
 * Regra de execucao dos macros, transposta do eBook:
 *
 *   1) SMR dentro de uma TOI  -> pode participar imediatamente (o lado direito
 *      da curva vai desenrolar-se a seguir).
 *   2) SMR fora de uma TOI    -> tem de esperar pela proxima TOI, que produzira
 *      a expansao.
 *
 * `smrTime` e o instante do Smart Money Reversal; `now` o instante da avaliacao.
 */
export interface MacroExecutionVerdict {
  /** True se ja se pode participar na operacao. */
  canExecute: boolean;
  /** Regra do eBook que decidiu o veredicto. */
  rule: 'smr-in-toi' | 'smr-out-of-toi-waiting' | 'smr-out-of-toi-expansion-active';
  reason: string;
  /** Pontuacao de alinhamento temporal usada no checklist. */
  score: number;
}

export function evaluateMacroExecution(smrTime: number, now: number): MacroExecutionVerdict {
  const smrInReversalWindow = isReversalWindow(smrTime);

  if (smrInReversalWindow) {
    return {
      canExecute: true,
      rule: 'smr-in-toi',
      reason:
        'O Smart Money Reversal ocorreu dentro de uma janela de reversao (TOI). ' +
        'Pela regra 1 do eBook, pode participar-se fora da janela ate ser atingida ' +
        'a consolidacao original.',
      score: Math.max(timeAlignmentScore(smrTime, 'reversal'), 0.6),
    };
  }

  // SMR fora da TOI: so se executa quando a proxima janela de expansao abrir.
  const expansionNow = isExpansionWindow(now);
  if (expansionNow) {
    return {
      canExecute: true,
      rule: 'smr-out-of-toi-expansion-active',
      reason:
        'O SMR ocorreu fora de uma TOI, mas estamos agora numa janela de expansao — ' +
        'pela regra 2 do eBook e esta janela que entrega o lado direito da curva.',
      score: timeAlignmentScore(now, 'expansion'),
    };
  }

  return {
    canExecute: false,
    rule: 'smr-out-of-toi-waiting',
    reason:
      'O SMR ocorreu fora de uma TOI e ainda nao abriu uma janela de expansao. ' +
      'Pela regra 2 do eBook, e preciso esperar pela proxima janela.',
    score: 0,
  };
}
