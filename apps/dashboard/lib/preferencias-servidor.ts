import 'server-only';

/**
 * Leitura das preferências do lado do servidor.
 *
 * Separado de `preferencias.ts` porque `next/headers` só existe em componentes
 * de servidor: bastava um componente de cliente importar o tipo `Preferencias`
 * para o build inteiro falhar. Os tipos e a interpretação ficam no ficheiro
 * neutro; o acesso ao cookie fica aqui.
 */

import { cookies } from 'next/headers';
import { COOKIE_PREFS, OMISSAO, interpretar, type Preferencias } from './preferencias';

/** Lê as preferências no servidor. Nunca rejeita — a app tem de abrir sempre. */
export async function lerPreferenciasServidor(): Promise<Preferencias> {
  try {
    return interpretar((await cookies()).get(COOKIE_PREFS)?.value);
  } catch {
    return OMISSAO;
  }
}
