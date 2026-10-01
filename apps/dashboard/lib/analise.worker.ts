/**
 * Web Worker das análises: o ICT ALGO sobre 3500 velas leva ~1,3 s num
 * computador e mais num telemóvel, e o painel de agentes corre as estratégias
 * de todos os instrumentos do portfólio. Aqui isso não congela o ecrã.
 */

import { fazer, type Trabalho } from './analise-calculo';

const alvo = self as unknown as {
  onmessage: ((ev: MessageEvent<{ id: number; trabalho: Trabalho }>) => void) | null;
  postMessage: (m: unknown) => void;
};

alvo.onmessage = (ev) => {
  const { id, trabalho } = ev.data;
  try {
    alvo.postMessage({ id, resultado: fazer(trabalho) });
  } catch (e) {
    alvo.postMessage({ id, erro: e instanceof Error ? e.message : String(e) });
  }
};
