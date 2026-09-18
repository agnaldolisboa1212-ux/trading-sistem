/**
 * Horário da bolsa alemã (DAX à vista) em UTC — que é também a abertura de Londres.
 *
 * O DAX à vista abre às 09:00 e fecha às 17:30 hora de Frankfurt; Londres abre às
 * 08:00 hora de Londres. Os dois mudam a hora no MESMO dia (horário de verão da
 * UE: do último domingo de março, 01:00 UTC, ao último domingo de outubro, 01:00
 * UTC), por isso a abertura cai sempre à mesma hora UTC:
 *
 *   verão     abre 07:00 UTC · fecha 15:30 UTC
 *   inverno   abre 08:00 UTC · fecha 16:30 UTC
 *
 * Função pura, sem relógio: recebe o início do dia UTC.
 */

const HORA = 3_600_000;

/** Último domingo de um mês (0 = janeiro), às 01:00 UTC. */
function ultimoDomingo(ano: number, mes: number): number {
  const d = new Date(Date.UTC(ano, mes + 1, 0, 1));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.getTime();
}

/** O instante está no horário de verão europeu? */
export function veraoEuropeu(tempoMs: number): boolean {
  const ano = new Date(tempoMs).getUTCFullYear();
  return tempoMs >= ultimoDomingo(ano, 2) && tempoMs < ultimoDomingo(ano, 9);
}

/** Abertura e fecho do DAX à vista, em UTC, no dia que começa em `diaMs` (meia-noite UTC). */
export function sessaoDax(diaMs: number): { abre: number; fecha: number } {
  const verao = veraoEuropeu(diaMs);
  return { abre: diaMs + (verao ? 7 : 8) * HORA, fecha: diaMs + (verao ? 15.5 : 16.5) * HORA };
}
