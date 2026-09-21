/**
 * Automação: a decisão de enviar (ou não) uma ordem sem ninguém tocar no botão.
 *
 * ── A MUDANÇA DE REGRA ─────────────────────────────────────────────────────
 *
 * Até 21/09/2026 este sistema nunca enviava uma ordem sozinho, e o ficheiro
 * `api/deriv/ordem/route.ts` ainda explica porquê. O dono pediu automação no
 * servidor, 24 horas, em conta REAL, com limites — e confirmou depois de lhe
 * ser dito que as estratégias que mais sinais dão são as que estão EM TESTE,
 * sem vantagem medida. É a decisão dele; o que este ficheiro faz é garantir
 * que a decisão tem travões.
 *
 * ── PORQUE cTRADER E NÃO A API DE OPÇÕES DA DERIV ──────────────────────────
 *
 * As ordens que a API de opções da Deriv aceita são contratos com duração fixa
 * e payout — não têm stop nem alvo. Um sinal com entrada, stop e alvo não se
 * exprime lá. A conta Deriv cTrader é CFD: aceita ordem a mercado com stop e
 * alvo, que é exactamente o que as estratégias descrevem. Por isso a execução
 * automática vai pela cTrader.
 *
 * ── OS TRAVÕES ─────────────────────────────────────────────────────────────
 *
 * Esta função é PURA: recebe factos, devolve uma decisão. É assim que se
 * consegue testar cada travão sem tocar no dinheiro de ninguém.
 */

export interface DefinicoesAutomacao {
  activa: boolean;
  contaRealPermitida: boolean;
  estrategias: readonly string[];
  instrumentos: readonly string[];
  modoLote: 'fixo' | 'risco';
  loteFixo: number;
  riscoPct: number;
  maxOrdensAbertas: number;
  perdaDiariaPct: number;
  perdaTotalPct: number;
  contaCtrader: number | null;
}

export const AUTOMACAO_OMISSAO: DefinicoesAutomacao = {
  activa: false,
  contaRealPermitida: false,
  estrategias: [],
  instrumentos: [],
  modoLote: 'fixo',
  loteFixo: 0.01,
  riscoPct: 1,
  maxOrdensAbertas: 2,
  perdaDiariaPct: 3,
  perdaTotalPct: 10,
  contaCtrader: null,
};

export interface SinalParaAutomacao {
  id: string;
  simbolo: string;
  timeframe: string;
  estrategia: string;
  direccao: 'bullish' | 'bearish';
  entrada: number;
  stop: number;
  alvo: number | null;
}

export interface FactosAutomacao {
  definicoes: DefinicoesAutomacao;
  sinal: SinalParaAutomacao;
  conta: { real: boolean; saldo: number };
  /** Posições já abertas nesta conta. */
  posicoesAbertas: number;
  /** Já existe uma ordem automática para este sinal? Nunca se repete. */
  jaProcessado: boolean;
  /** Resultado fechado de hoje e do total, em dinheiro (negativo = perda). */
  resultadoHoje: number;
  resultadoTotal: number;
  /**
   * Quanto vale um lote por unidade de preço, na moeda da conta. Numa conta em
   * USD a negociar um instrumento cotado em USD é o tamanho do contrato.
   */
  valorPorLote: number;
  /** Tecto duro por ordem (CTRADER_LIMITE_LOTES). */
  limiteLotes: number;
  /** Passo mínimo de volume do instrumento (0,01 lote na maioria). */
  loteMinimo: number;
}

export type DecisaoAutomacao =
  | { ok: true; lotes: number }
  | { ok: false; motivo: string };

/** Arredonda para baixo ao passo do instrumento, sem erro de vírgula flutuante. */
function aoPasso(lotes: number, passo: number): number {
  if (!(passo > 0)) return lotes;
  return Math.floor(lotes / passo + 1e-9) * passo;
}

export function decidirAutomacao(f: FactosAutomacao): DecisaoAutomacao {
  const d = f.definicoes;
  const s = f.sinal;

  if (!d.activa) return { ok: false, motivo: 'Automação desligada.' };
  if (f.jaProcessado) return { ok: false, motivo: 'Este sinal já tinha sido tratado.' };
  if (d.contaCtrader === null) return { ok: false, motivo: 'Sem conta cTrader escolhida para a automação.' };
  if (f.conta.real && !d.contaRealPermitida) {
    return { ok: false, motivo: 'Conta real sem autorização explícita para automação.' };
  }
  if (!d.estrategias.includes(s.estrategia)) {
    return { ok: false, motivo: `Estratégia ${s.estrategia} fora da automação.` };
  }
  if (!d.instrumentos.includes(s.simbolo.toUpperCase())) {
    return { ok: false, motivo: `${s.simbolo} fora da automação.` };
  }
  if (f.posicoesAbertas >= d.maxOrdensAbertas) {
    return { ok: false, motivo: `Já há ${f.posicoesAbertas} posições abertas (máximo ${d.maxOrdensAbertas}).` };
  }
  if (!(f.conta.saldo > 0)) return { ok: false, motivo: 'Saldo da conta indisponível.' };

  // Travões de perda: comparam-se com o saldo ACTUAL, que já inclui o que se
  // perdeu. É conservador — quanto mais se perde, mais cedo pára.
  const perdaHojePct = f.resultadoHoje < 0 ? (-f.resultadoHoje / f.conta.saldo) * 100 : 0;
  if (perdaHojePct >= d.perdaDiariaPct) {
    return { ok: false, motivo: `Limite diário atingido: ${perdaHojePct.toFixed(1)}% de ${d.perdaDiariaPct}%.` };
  }
  const perdaTotalPct = f.resultadoTotal < 0 ? (-f.resultadoTotal / f.conta.saldo) * 100 : 0;
  if (perdaTotalPct >= d.perdaTotalPct) {
    return { ok: false, motivo: `Limite total atingido: ${perdaTotalPct.toFixed(1)}% de ${d.perdaTotalPct}%.` };
  }

  const distancia = Math.abs(s.entrada - s.stop);
  if (!(distancia > 0)) return { ok: false, motivo: 'Sinal sem distância de stop.' };
  const compra = s.direccao === 'bullish';
  if (compra ? s.stop >= s.entrada : s.stop <= s.entrada) {
    return { ok: false, motivo: 'Stop do lado errado da entrada.' };
  }

  let lotes: number;
  if (d.modoLote === 'fixo') {
    lotes = d.loteFixo;
  } else {
    if (!(f.valorPorLote > 0)) return { ok: false, motivo: 'Sem valor por lote para dimensionar.' };
    const dinheiroEmRisco = f.conta.saldo * (d.riscoPct / 100);
    lotes = dinheiroEmRisco / (distancia * f.valorPorLote);
  }
  lotes = aoPasso(Math.min(lotes, f.limiteLotes), f.loteMinimo);
  if (!(lotes >= f.loteMinimo)) {
    return {
      ok: false,
      motivo: `Risco de ${d.riscoPct}% dá menos do que o lote mínimo (${f.loteMinimo}) neste instrumento.`,
    };
  }
  return { ok: true, lotes };
}

/** Linha para o registo, com o que aconteceu. */
export function linhaDoRegisto(
  utilizadorId: string,
  s: SinalParaAutomacao,
  resultado: 'enviada' | 'recusada' | 'erro',
  extra: { motivo?: string; lotes?: number; posicaoId?: string | null } = {},
): Record<string, unknown> {
  return {
    utilizador_id: utilizadorId,
    sinal_id: s.id,
    simbolo: s.simbolo,
    timeframe: s.timeframe,
    estrategia: s.estrategia,
    lado: s.direccao === 'bullish' ? 'compra' : 'venda',
    lotes: extra.lotes ?? null,
    entrada: s.entrada,
    stop: s.stop,
    alvo: s.alvo,
    resultado,
    motivo: extra.motivo ?? null,
    posicao_id: extra.posicaoId ?? null,
  };
}
