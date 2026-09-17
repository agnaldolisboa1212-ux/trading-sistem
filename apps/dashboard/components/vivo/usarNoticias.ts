'use client';

/**
 * Notícias de alto impacto, partilhadas por todos os componentes.
 *
 * Um pedido a `/api/noticias` a cada 10 minutos, e só com o separador visível.
 * A página de notícias e o painel de análise do gráfico leem a mesma cópia.
 */

import { useEffect, useState } from 'react';

export interface EventoNoticia {
  titulo: string;
  moeda: string;
  em: number;
  previsao?: string | null;
  anterior?: string | null;
  instrumentos: string[];
}

export interface ComunicadoNoticia {
  fonte: string;
  titulo: string;
  url: string;
  em: number;
}

export interface CotNoticia {
  simbolo: string;
  mercado: string;
  relatorio: string;
  gestores: { liquidoPct: number; percentil3a: number; variacaoSemana: number };
  alavancados: { liquidoPct: number; percentil3a: number; variacaoSemana: number };
}

export interface Noticias {
  eventos: EventoNoticia[];
  comunicados: ComunicadoNoticia[];
  cot: CotNoticia[];
  geradoEm: number;
}

let cache: { em: number; dados: Noticias } | null = null;
let pedido: Promise<Noticias | null> | null = null;
const TTL = 10 * 60_000;

async function buscar(): Promise<Noticias | null> {
  if (cache && Date.now() - cache.em < TTL) return cache.dados;
  pedido ??= fetch('/api/noticias', { cache: 'no-store' })
    .then(async (r) => (r.ok ? ((await r.json()) as Noticias) : null))
    .then((dados) => {
      if (dados) cache = { em: Date.now(), dados };
      return dados ?? cache?.dados ?? null;
    })
    .catch(() => cache?.dados ?? null)
    .finally(() => {
      pedido = null;
    });
  return pedido;
}

export function usarNoticias(): { dados: Noticias | null; aCarregar: boolean } {
  const [dados, setDados] = useState<Noticias | null>(cache?.dados ?? null);
  const [aCarregar, setACarregar] = useState(!cache);
  useEffect(() => {
    let vivo = true;
    const actualizar = () => {
      if (document.hidden) return;
      void buscar().then((d) => {
        if (!vivo) return;
        setDados(d);
        setACarregar(false);
      });
    };
    actualizar();
    const id = setInterval(actualizar, TTL);
    document.addEventListener('visibilitychange', actualizar);
    return () => {
      vivo = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', actualizar);
    };
  }, []);
  return { dados, aCarregar };
}

/** "hoje 14:30", "amanhã 08:30", "qua 12:30" — na hora local de quem vê. */
export function quandoNoticia(em: number, agora: number): string {
  const d = new Date(em);
  const hora = d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  const dia = (t: number) => new Date(t).toDateString();
  if (dia(em) === dia(agora)) return `hoje ${hora}`;
  if (dia(em) === dia(agora + 86_400_000)) return `amanhã ${hora}`;
  if (dia(em) === dia(agora - 86_400_000)) return `ontem ${hora}`;
  return `${d.toLocaleDateString('pt-PT', { weekday: 'short' })} ${hora}`;
}
