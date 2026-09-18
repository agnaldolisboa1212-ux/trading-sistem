/**
 * Sessão de negociação em que cada pessoa quer ser avisada.
 *
 * O forex e os índices negoceiam 24h, mas ninguém está acordado 24h — e o
 * volume e o movimento não são iguais a toda a hora: a sessão de Londres e a
 * sobreposição com Nova Iorque concentram a maior parte da liquidez. Quem só
 * pode olhar ao telemóvel de tarde não quer ser acordado com um sinal de
 * Tóquio às 3h.
 *
 * Só filtra os AVISOS (push): o sinal continua a nascer, a ficar guardado e a
 * aparecer na lista e no Financeiro fora da sessão escolhida — só não acorda o
 * telemóvel. E só se aplica a timeframes intradiários (15m, 1h, 4h): um sinal
 * diário não tem "sessão", nasce ao fecho do dia.
 *
 * Horas em UTC, sem ajuste de horário de verão — a mesma simplificação que o
 * resto do sistema já usa para notícias e para as janelas do SMT em teste.
 */

export type SessaoNegociacao = 'sydney' | 'toquio' | 'londres' | 'nova-iorque';

export const SESSOES_NEGOCIACAO: readonly SessaoNegociacao[] = ['sydney', 'toquio', 'londres', 'nova-iorque'];

export const ROTULO_SESSAO: Readonly<Record<SessaoNegociacao, string>> = {
  sydney: 'Sydney',
  toquio: 'Tóquio',
  londres: 'Londres',
  'nova-iorque': 'Nova Iorque',
};

/** Início e fim em UTC (fim exclusivo). `ini > fim` significa que atravessa a meia-noite. */
const JANELA: Readonly<Record<SessaoNegociacao, { ini: number; fim: number }>> = {
  sydney: { ini: 21, fim: 6 },
  toquio: { ini: 0, fim: 9 },
  londres: { ini: 7, fim: 16 },
  'nova-iorque': { ini: 12, fim: 21 },
};

function horaUtc(tempoMs: number): number {
  return new Date(tempoMs).getUTCHours();
}

function dentroDaJanela(hora: number, s: SessaoNegociacao): boolean {
  const { ini, fim } = JANELA[s];
  return ini <= fim ? hora >= ini && hora < fim : hora >= ini || hora < fim;
}

/**
 * Este instante está dentro de alguma das sessões escolhidas?
 *
 * Sem sessões escolhidas, ou num timeframe diário, não filtra — é o "qualquer
 * hora" por omissão. `tempoMs` é o instante do AVISO (a vela seguinte, quando
 * o sinal chega ao telemóvel), não o da vela que gerou o sinal.
 */
export function dentroDaSessao(
  tempoMs: number,
  sessoes: readonly string[] | null | undefined,
  timeframe?: string,
): boolean {
  const escolhidas = (sessoes ?? []).filter((s): s is SessaoNegociacao =>
    (SESSOES_NEGOCIACAO as readonly string[]).includes(s),
  );
  if (escolhidas.length === 0) return true;
  if (timeframe === '1d') return true;
  const hora = horaUtc(tempoMs);
  return escolhidas.some((s) => dentroDaJanela(hora, s));
}
