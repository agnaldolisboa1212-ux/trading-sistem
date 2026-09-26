/**
 * Asia Range Algo — a análise de um instrumento, para a aba do gráfico.
 *
 * Corre no servidor pela mesma razão do ICT ALGO: precisa de 15M, do diário
 * (viés) e do par correlacionado (SMT) ao mesmo tempo. É a MESMA função que o
 * motor usa para gerar os sinais (`analisarAsiaRange`), sobre as velas fechadas.
 */

import { NextResponse } from 'next/server';
import { velasFechadasDeriv } from '@trading/data';
import { ASIA_RANGE_EM_TESTE, analisarAsiaRange, paresSmtIct, type Candle } from '@trading/core';
import { acharSimbolo } from '@/lib/deriv/simbolos';
import { guardarCacheVela, lerCacheVela } from '@/lib/cache-vela';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const M15 = 900;

/** Só velas fechadas, guardadas até fechar a seguinte (menos pedidos à Deriv). */
const fechadas = (derivSymbol: string, gran: number, quantas: number): Promise<Candle[]> =>
  velasFechadasDeriv(derivSymbol, gran, quantas);

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
  // A análise só muda quando fecha a vela de 15M (a confirmação de 1M é lida no
  // fecho dela): até lá, a aba — que pergunta a cada minuto — recebe a mesma.
  const chaveCache = `asia|${s.codigo}`;
  const guardado = lerCacheVela<Record<string, unknown>>(chaveCache, '15m');
  if (guardado) return NextResponse.json(guardado, semCache);
  try {
    const [velas, diarias, parVelas, ltf] = await Promise.all([
      fechadas(s.deriv, M15, 400),
      fechadas(s.deriv, 86_400, 300),
      parSimbolo ? fechadas(parSimbolo.deriv, M15, 400).catch(() => []) : Promise.resolve([]),
      // 1M: a confirmação (a mesma que o motor exige para enviar o sinal), com as
      // mesmas 300 velas fechadas do motor.
      fechadas(s.deriv, 60, 301).catch(() => []),
    ]);
    const analise = analisarAsiaRange({
      simbolo: s.codigo,
      velas,
      diarias,
      par: parSimbolo && parVelas.length > 0 ? { simbolo: parSimbolo.codigo, velas: parVelas } : null,
      ltf,
    });
    const corpo = { simbolo: s.codigo, analise, em };
    const ultima = velas[velas.length - 1];
    if (ultima) guardarCacheVela(chaveCache, '15m', ultima.time, corpo);
    return NextResponse.json(corpo, semCache);
  } catch (e) {
    return NextResponse.json(
      { simbolo: s.codigo, analise: null, porqueNao: `Falha a obter as velas: ${e instanceof Error ? e.message : String(e)}`, em },
      { status: 502, ...semCache },
    );
  }
}
