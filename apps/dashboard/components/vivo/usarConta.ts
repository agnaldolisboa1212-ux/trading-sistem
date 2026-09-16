'use client';

/**
 * Estado da conta da corretora, partilhado por toda a aplicação.
 *
 * PORQUÊ UM ESTADO PARTILHADO: o cartão de saldo no Início, as métricas no
 * Portfólio e o botão de comprar no gráfico querem todos o mesmo retrato. Se
 * cada um sondasse a sua rota, três componentes visíveis ao mesmo tempo fariam
 * três sessões WebSocket autenticadas por ciclo — e cada sessão custa um OTP.
 *
 * Aqui há um só ciclo. Quem se inscreve recebe o que já existe imediatamente e
 * as atualizações a seguir.
 *
 * O ritmo é de 20 segundos e não de 1: o saldo não muda entre ordens. O que
 * muda ao segundo é o PREÇO, e esse vem do fluxo público, que não passa por
 * aqui.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

export interface PosicaoAberta {
  contract_id: number;
  simbolo: string;
  tipo: string;
  compraPor: number;
  valorActual: number;
  lucro: number;
  abertoEm: number;
  expiraEm: number | null;
  descricao: string;
}

export interface EstadoConta {
  ligada: boolean;
  aCarregar: boolean;
  erro: string | null;
  contaId: string | null;
  tipo: 'demo' | 'real' | null;
  moeda: string;
  saldo: number | null;
  posicoes: PosicaoAberta[];
  lucroFechado: number;
  operacoesFechadas: number;
  vitorias: number;
  transaccoes: Array<{
    id: number;
    tipo: string;
    montante: number;
    saldoDepois: number;
    em: number;
  }>;
}

const INICIAL: EstadoConta = {
  ligada: false,
  aCarregar: true,
  erro: null,
  contaId: null,
  tipo: null,
  moeda: 'USD',
  saldo: null,
  posicoes: [],
  lucroFechado: 0,
  operacoesFechadas: 0,
  vitorias: 0,
  transaccoes: [],
};

type Ouvinte = (e: EstadoConta) => void;

let estado: EstadoConta = INICIAL;
const ouvintes = new Set<Ouvinte>();
let temporizador: ReturnType<typeof setInterval> | null = null;
let aCorrer = false;

function emitir(novo: EstadoConta): void {
  estado = novo;
  for (const o of ouvintes) o(novo);
}

async function buscar(): Promise<void> {
  // Sem sobreposição: um pedido lento não deve empilhar outro por cima.
  if (aCorrer) return;
  aCorrer = true;
  try {
    const r = await apiFetch('/api/deriv/conta');
    const j = (await r.json()) as Record<string, unknown>;

    if (!j['ligada']) {
      emitir({
        ...INICIAL,
        aCarregar: false,
        erro: (j['erro'] as string) ?? null,
      });
      return;
    }

    const conta = j['conta'] as { account_id: string; account_type: string; currency: string };
    const saldo = j['saldo'] as { saldo: number; moeda: string };

    emitir({
      ligada: true,
      aCarregar: false,
      erro: null,
      contaId: conta.account_id,
      tipo: conta.account_type === 'real' ? 'real' : 'demo',
      moeda: saldo?.moeda ?? conta.currency ?? 'USD',
      saldo: saldo?.saldo ?? null,
      posicoes: (j['posicoes'] as PosicaoAberta[]) ?? [],
      lucroFechado: Number(j['lucroFechado'] ?? 0),
      operacoesFechadas: Number(j['operacoesFechadas'] ?? 0),
      vitorias: Number(j['vitorias'] ?? 0),
      transaccoes: (j['transaccoes'] as EstadoConta['transaccoes']) ?? [],
    });
  } catch (err) {
    emitir({
      ...estado,
      aCarregar: false,
      erro: err instanceof Error ? err.message : String(err),
    });
  } finally {
    aCorrer = false;
  }
}

/** Força uma atualização — usado depois de uma ordem. */
export function actualizarConta(): Promise<void> {
  return buscar();
}

export function usarConta(): EstadoConta & { actualizar: () => Promise<void> } {
  const [local, setLocal] = useState<EstadoConta>(estado);

  useEffect(() => {
    ouvintes.add(setLocal);
    setLocal(estado);

    if (ouvintes.size === 1) {
      void buscar();
      temporizador = setInterval(() => {
        // Separador escondido não gasta sessões da corretora.
        if (!document.hidden) void buscar();
      }, 20_000);
    }

    return () => {
      ouvintes.delete(setLocal);
      if (ouvintes.size === 0 && temporizador) {
        clearInterval(temporizador);
        temporizador = null;
      }
    };
  }, []);

  const actualizar = useCallback(() => buscar(), []);
  return { ...local, actualizar };
}

/** Formata dinheiro na moeda da conta. */
export function dinheiro(valor: number | null, moeda = 'USD'): string {
  if (valor === null || !Number.isFinite(valor)) return '—';
  return valor.toLocaleString('pt-PT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + ` ${moeda}`;
}
