import 'server-only';

/**
 * Peças comuns às rotas `/api/ctrader/*`: respostas de erro e leitura do corpo.
 */

import { NextResponse } from 'next/server';
import { ErroCtrader } from './ligacao';
import type { AcessoCtrader } from './sessao';

export function semAcesso(a: Extract<AcessoCtrader, { ok: false }>): NextResponse {
  return NextResponse.json({ erro: a.erro, codigo: a.codigo }, { status: a.estado, headers: { 'Cache-Control': 'no-store' } });
}

export function erroCtrader(e: unknown): NextResponse {
  const codigo = e instanceof ErroCtrader ? e.codigo : 'Desconhecido';
  const estado =
    codigo === 'CH_ACCESS_TOKEN_INVALID' || codigo === 'OA_AUTH_TOKEN_EXPIRED'
      ? 409
      : codigo === 'ContaAlheia'
        ? 403
        : codigo === 'SemConfig'
          ? 503
          : 400;
  return NextResponse.json(
    { erro: e instanceof Error ? e.message : String(e), codigo },
    { status: estado, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function corpoJson<T>(pedido: Request): Promise<T | null> {
  try {
    return (await pedido.json()) as T;
  } catch {
    return null;
  }
}

/** Número positivo e finito, ou null. */
export function preco(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Tecto de volume por ordem — travão contra o dedo escorregar, não gestão de risco. */
export const LIMITE_LOTES = Number(process.env['CTRADER_LIMITE_LOTES'] ?? 1);
