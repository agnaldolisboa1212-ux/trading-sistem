/**
 * Asia Range Algo — a análise de um instrumento, para a aba do gráfico.
 *
 * Corre no servidor pela mesma razão do ICT ALGO: precisa de 15M, do diário
 * (viés) e do par correlacionado (SMT) ao mesmo tempo. É a MESMA função que o
 * motor usa para gerar os sinais (`analisarAsiaRange`), sobre as velas fechadas.
 */

import { NextResponse } from 'next/server';
import { velasDeriv } from '@trading/data';
import { ASIA_RANGE_EM_TESTE, analisarAsiaRange, paresSmtIct, type Candle } from '@trading/core';
import { acharSimbolo } from '@/lib/deriv/simbolos';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const M15 = 900;

async function fechadas(derivSymbol: string, gran: number, quantas: number): Promise<Candle[]> {
  const brutas = await velasDeriv(derivSymbol, gran, quantas);
  return brutas.filter((c) => c.time + gran * 1000 <= Date.now());
}

const semCache = { headers: { 'Cache-Control': 'no-store' } };

export async function GET(_pedido: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const s = acharSimbolo(symbol.toUpperCase());
  const em = Date.now();
  if (!s) return NextResponse.json({ erro: 'instrumento desconhecido' }, { status: 404 });
  if (!ASIA_RANGE_EM_TESTE.includes(s.codigo)) {
    return NextResponse.json(
      {
        simbolo: s.codigo,
        analise: null,
        porqueNao: `O Asia Range Algo corre nos pares do journal: ${ASIA_RANGE_EM_TESTE.join(', ')}.`,
        em,
      },
      semCache,
    );
  }
  const parSimbolo = paresSmtIct(s.codigo).map((c) => acharSimbolo(c)).find((x) => x) ?? null;
  try {
    const [velas, diarias, parVelas, ltf] = await Promise.all([
      // As mesmas quantidades do radar e do ICT: partilham a cache de velas.
      fechadas(s.deriv, M15, 1500),
      fechadas(s.deriv, 86_400, 400),
      parSimbolo ? fechadas(parSimbolo.deriv, M15, 1500).catch(() => []) : Promise.resolve([]),
      // 3M: a confirmação (a mesma que o motor exige para enviar o sinal).
      fechadas(s.deriv, 180, 300).catch(() => []),
    ]);
    const analise = analisarAsiaRange({
      simbolo: s.codigo,
      velas,
      diarias,
      par: parSimbolo && parVelas.length > 0 ? { simbolo: parSimbolo.codigo, velas: parVelas } : null,
      ltf,
    });
    return NextResponse.json({ simbolo: s.codigo, analise, em }, semCache);
  } catch (e) {
    return NextResponse.json(
      { simbolo: s.codigo, analise: null, porqueNao: `Falha a obter as velas: ${e instanceof Error ? e.message : String(e)}`, em },
      { status: 502, ...semCache },
    );
  }
}
