'use client';

/**
 * O portfólio da conta: os instrumentos que a pessoa segue.
 *
 * É a lista `instrumentos` do perfil. Decide três coisas: que sinais chegam ao
 * telemóvel, que sinais aparecem no início, e o que o motor de tempo real
 * vigia. Um instrumento fora do portfólio não gera aviso nenhum a esta conta.
 *
 * Estado partilhado entre todos os componentes da página (a estrela do gráfico
 * e a lista do portfólio mudam juntas), lido uma vez do perfil.
 */

import { useCallback, useEffect, useState } from 'react';
import { guardarPerfil, lerPerfil } from '@/lib/auth';
import { guardarPreferenciasCliente } from '@/lib/preferencias';

let lista: string[] | null = null;
let aCarregar: Promise<void> | null = null;
const ouvintes = new Set<(l: string[] | null) => void>();

function emitir(nova: string[]) {
  lista = nova;
  for (const o of ouvintes) o(nova);
}

async function carregar(): Promise<void> {
  aCarregar ??= (async () => {
    const p = await lerPerfil();
    emitir((p?.instrumentos ?? []).map((c) => c.toUpperCase()));
  })().finally(() => {
    aCarregar = null;
  });
  return aCarregar;
}

export function usarPortfolio(): {
  instrumentos: string[] | null;
  tem: (codigo: string) => boolean;
  alternar: (codigo: string) => Promise<string | null>;
  remover: (codigo: string) => Promise<string | null>;
  adicionar: (codigo: string) => Promise<string | null>;
} {
  const [local, setLocal] = useState<string[] | null>(lista);

  useEffect(() => {
    ouvintes.add(setLocal);
    if (lista === null) void carregar();
    else setLocal(lista);
    return () => {
      ouvintes.delete(setLocal);
    };
  }, []);

  const gravar = useCallback(async (nova: string[]): Promise<string | null> => {
    const anterior = lista ?? [];
    emitir(nova);
    const r = await guardarPerfil({ instrumentos: nova });
    if (!r.ok) {
      emitir(anterior);
      return r.erro;
    }
    guardarPreferenciasCliente({ instrumentos: nova });
    return null;
  }, []);

  const tem = useCallback((codigo: string) => (local ?? []).includes(codigo.toUpperCase()), [local]);

  const adicionar = useCallback(
    (codigo: string) => {
      const c = codigo.toUpperCase();
      const actual = lista ?? [];
      return actual.includes(c) ? Promise.resolve(null) : gravar([...actual, c]);
    },
    [gravar],
  );

  const remover = useCallback(
    (codigo: string) => gravar((lista ?? []).filter((x) => x !== codigo.toUpperCase())),
    [gravar],
  );

  const alternar = useCallback(
    (codigo: string) => ((lista ?? []).includes(codigo.toUpperCase()) ? remover(codigo) : adicionar(codigo)),
    [adicionar, remover],
  );

  return { instrumentos: local, tem, alternar, remover, adicionar };
}
