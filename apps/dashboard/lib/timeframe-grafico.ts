/**
 * O timeframe do gráfico que a pessoa escolheu por último.
 *
 * Quem abre "Gráficos" pela barra de baixo, ou um instrumento a partir dos
 * mercados, volta ao timeframe em que estava — não a um valor fixo. Sem escolha
 * anterior, vale o do objetivo do onboarding.
 *
 * Fica no `localStorage` do dispositivo: é uma comodidade de ecrã, não um dado
 * de conta. Tudo em try/catch — num separador privado pode não existir.
 */

import { TIMEFRAMES, type Timeframe } from '@/lib/deriv/simbolos';

const CHAVE = 'grafico_timeframe';

export function lerTimeframeGrafico(): Timeframe | null {
  try {
    const v = window.localStorage.getItem(CHAVE);
    return TIMEFRAMES.some((t) => t.id === v) ? (v as Timeframe) : null;
  } catch {
    return null;
  }
}

export function guardarTimeframeGrafico(tf: Timeframe): void {
  try {
    window.localStorage.setItem(CHAVE, tf);
  } catch {
    /* sem armazenamento: fica só nesta página */
  }
}
