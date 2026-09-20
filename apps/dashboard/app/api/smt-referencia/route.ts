import { NextResponse } from 'next/server';
import { acharSimbolo } from '@/lib/deriv/simbolos';
import { velasDeriv } from '@trading/data';
import { buildSwingLadder, detectSmtDivergences, smtPairsFor, type Candle } from '@trading/core';

export const dynamic = 'force-dynamic';

const GRANULARIDADE_S: Record<string, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const simbolo = searchParams.get('s')?.toUpperCase();
  const timeframe = searchParams.get('tf');

  if (!simbolo || !timeframe) {
    return NextResponse.json({ erro: 'Parâmetros s e tf são obrigatórios' }, { status: 400 });
  }

  const s = acharSimbolo(simbolo);
  const gran = GRANULARIDADE_S[timeframe];
  if (!s || !gran) {
    return NextResponse.json({ erro: 'Símbolo ou timeframe inválido' }, { status: 404 });
  }

  const pares = smtPairsFor(simbolo);
  if (pares.length === 0) {
    return NextResponse.json({ erro: 'Este instrumento não tem par SMT configurado' }, { status: 404 });
  }
  const par = pares[0]!;
  const ref = acharSimbolo(par.reference);
  if (!ref) {
    return NextResponse.json({ erro: 'Símbolo de referência desconhecido' }, { status: 404 });
  }

  try {
    const velasBase = await velasDeriv(s.deriv, gran, 350);
    const velasRef = await velasDeriv(ref.deriv, gran, 350);

    // Alinhar velas pelo tempo, mantendo só o que está em ambas
    const refMap = new Map(velasRef.map((c) => [c.time, c]));
    const timeIndex: number[] = [];
    const primaryAligned: Candle[] = [];
    const refAligned: Candle[] = [];

    for (const c of velasBase) {
      const cr = refMap.get(c.time);
      if (cr) {
        timeIndex.push(c.time);
        primaryAligned.push(c);
        refAligned.push(cr);
      }
    }

    if (primaryAligned.length < 50) {
      return NextResponse.json({ erro: 'Histórico insuficiente para SMT' }, { status: 400 });
    }

    const swingsBase = buildSwingLadder(primaryAligned);
    const swingsRef = buildSwingLadder(refAligned);

    const smtEvents = detectSmtDivergences(
      par,
      primaryAligned,
      swingsBase.all,
      swingsRef.all,
      { minDegree: 'short' } // Usamos short para ter marcações suficientes no gráfico
    );

    // Reindexar a 100 no início para o gráfico
    const startBase = primaryAligned[0]!.close;
    const startRef = refAligned[0]!.close;
    
    // Inverter a referência se a correlação for inversa para que o gráfico os coloque no mesmo sentido
    const primarySeries = primaryAligned.map(c => (c.close / startBase) * 100);
    const referenceSeries = refAligned.map(c => 
      par.correlation === 'inverse' 
        ? 200 - ((c.close / startRef) * 100) 
        : (c.close / startRef) * 100
    );

    const primaryRaw = primaryAligned.map(c => c.close);
    const referenceRaw = refAligned.map(c => c.close);

    const marks = smtEvents.map((e) => ({
      index: timeIndex.indexOf(e.time), // O timeIndex já é a série alinhada. O e.time pode ser usado se a candle.time bate
      prevIndex: timeIndex.indexOf(primaryAligned[e.primaryPrevIndex]?.time ?? 0),
      at: e.at,
      direction: e.direction,
      description: e.description,
      strength: e.strength
    })).filter(m => m.index !== -1 && m.prevIndex !== -1);

    return NextResponse.json({
      times: timeIndex,
      primarySymbol: s.codigo,
      referenceSymbol: ref.codigo,
      correlation: par.correlation,
      primary: primarySeries,
      reference: referenceSeries,
      primaryRaw: primaryRaw,
      referenceRaw: referenceRaw,
      marks
    });
  } catch (err) {
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
