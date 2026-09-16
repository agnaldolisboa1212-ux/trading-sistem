'use client';

/**
 * A conta Deriv cTrader da pessoa, partilhada por todos os componentes.
 *
 * Um só pedido a `/api/ctrader/estado` para o cartão de saldo, o terminal e o
 * portfólio. Com posições ou ordens abertas actualiza de 5 em 5 segundos (o
 * lucro mexe); sem elas, de 20 em 20. Separador escondido não pede nada.
 */

import { useCallback, useEffect, useState } from 'react';

export interface ContaCtrader {
  id: number;
  login: number | null;
  real: boolean;
  corretora: string;
}

export interface PosicaoCtrader {
  id: number;
  symbolId: number;
  simbolo: string;
  lado: 'compra' | 'venda';
  lotes: number;
  precoEntrada: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  lucro: number;
  swap: number;
  comissao: number;
  abertaEm: number | null;
  casas: number;
}

export interface OrdemPendenteCtrader {
  id: number;
  symbolId: number;
  simbolo: string;
  tipo: 'limite' | 'stop';
  lado: 'compra' | 'venda';
  lotes: number;
  preco: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  criadaEm: number | null;
  casas: number;
}

export interface EstadoCtrader {
  aCarregar: boolean;
  configurado: boolean;
  ligada: boolean;
  erro: string | null;
  contas: ContaCtrader[];
  conta: ContaCtrader | null;
  saldo: number | null;
  capital: number | null;
  moeda: string;
  posicoes: PosicaoCtrader[];
  ordens: OrdemPendenteCtrader[];
}

const INICIAL: EstadoCtrader = {
  aCarregar: true,
  configurado: true,
  ligada: false,
  erro: null,
  contas: [],
  conta: null,
  saldo: null,
  capital: null,
  moeda: 'USD',
  posicoes: [],
  ordens: [],
};

let estado: EstadoCtrader = INICIAL;
const ouvintes = new Set<(e: EstadoCtrader) => void>();
let temporizador: ReturnType<typeof setTimeout> | null = null;
let aCorrer = false;

function emitir(novo: EstadoCtrader) {
  estado = novo;
  for (const o of ouvintes) o(novo);
}

async function buscar(): Promise<void> {
  if (aCorrer) return;
  aCorrer = true;
  try {
    const r = await fetch('/api/ctrader/estado', { cache: 'no-store' });
    const j = (await r.json()) as Record<string, unknown>;
    if (!r.ok) throw new Error(String(j['erro'] ?? `HTTP ${r.status}`));
    if (!j['ligada']) {
      emitir({ ...INICIAL, aCarregar: false, configurado: j['configurado'] !== false, erro: (j['erro'] as string) ?? null });
      return;
    }
    const contas = (j['contas'] as ContaCtrader[]) ?? [];
    const retrato = j['retrato'] as {
      conta: ContaCtrader;
      saldo: number;
      capital: number;
      moeda: string;
      posicoes: PosicaoCtrader[];
      ordens: OrdemPendenteCtrader[];
    } | null;
    emitir({
      aCarregar: false,
      configurado: true,
      ligada: true,
      erro: null,
      contas,
      conta: retrato?.conta ?? null,
      saldo: retrato?.saldo ?? null,
      capital: retrato?.capital ?? null,
      moeda: retrato?.moeda ?? 'USD',
      posicoes: retrato?.posicoes ?? [],
      ordens: retrato?.ordens ?? [],
    });
  } catch (e) {
    emitir({ ...estado, aCarregar: false, erro: e instanceof Error ? e.message : String(e) });
  } finally {
    aCorrer = false;
  }
}

function agendar() {
  if (temporizador) clearTimeout(temporizador);
  if (ouvintes.size === 0) return;
  const ritmo = estado.posicoes.length > 0 || estado.ordens.length > 0 ? 5_000 : 20_000;
  temporizador = setTimeout(async () => {
    if (!document.hidden) await buscar();
    agendar();
  }, ritmo);
}

export function actualizarCtrader(): Promise<void> {
  return buscar();
}

export function usarCtrader(): EstadoCtrader & { actualizar: () => Promise<void> } {
  const [local, setLocal] = useState<EstadoCtrader>(estado);
  useEffect(() => {
    ouvintes.add(setLocal);
    setLocal(estado);
    if (ouvintes.size === 1) {
      void buscar().then(agendar);
    }
    return () => {
      ouvintes.delete(setLocal);
      if (ouvintes.size === 0 && temporizador) {
        clearTimeout(temporizador);
        temporizador = null;
      }
    };
  }, []);
  const actualizar = useCallback(() => buscar(), []);
  return { ...local, actualizar };
}

/** Leva à página de autorização da cTrader. Devolve a mensagem de erro, se houver. */
export async function ligarCtrader(): Promise<string | null> {
  try {
    const r = await fetch('/api/ctrader/oauth/iniciar', { method: 'POST' });
    const j = (await r.json().catch(() => ({}))) as { url?: string; erro?: string };
    if (!r.ok || !j.url) return j.erro ?? `não foi possível começar (HTTP ${r.status})`;
    window.location.assign(j.url);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export async function desligarCtrader(): Promise<void> {
  await fetch('/api/ctrader/oauth/sair', { method: 'POST' }).catch(() => undefined);
  await buscar();
}

export async function escolherContaCtrader(contaId: number, confirmoReal = false): Promise<string | null> {
  const r = await fetch('/api/ctrader/conta', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contaId, confirmoReal }),
  });
  const j = (await r.json().catch(() => ({}))) as { erro?: string };
  await buscar();
  return r.ok ? null : (j.erro ?? `HTTP ${r.status}`);
}

/** Pedido às rotas de ordens; devolve `{ ok }` ou a mensagem de erro. */
export async function pedidoCtrader(
  caminho: string,
  corpo: Record<string, unknown>,
): Promise<{ ok: true; dados: Record<string, unknown> } | { ok: false; erro: string }> {
  try {
    const r = await fetch(caminho, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) return { ok: false, erro: String(j['erro'] ?? `HTTP ${r.status}`) };
    void buscar();
    return { ok: true, dados: j };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

export function dinheiroConta(valor: number | null, moeda: string): string {
  if (valor === null || !Number.isFinite(valor)) return '—';
  return `${valor.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${moeda}`;
}
