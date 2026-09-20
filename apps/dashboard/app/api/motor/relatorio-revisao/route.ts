import { NextResponse } from 'next/server';
import { clienteServidor } from '@/lib/supabase/servidor';
import {
  ESTRATEGIAS_EM_TESTE,
  acompanharOperacao,
  fraseEvento
} from '@trading/core';
import { velasDeriv } from '@trading/data';
import { acharSimbolo } from '@/lib/deriv/simbolos';

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

// Limite de dias para retroceder
const DIAS_VOLTAR = 60;

export async function GET() {
  const db = await clienteServidor();
  if (!db) return NextResponse.json({ erro: 'Supabase não configurado' }, { status: 503 });

  // 1. Filtrar estratégias cuja data de revisão é <= hoje
  const hoje = new Date().toISOString().split('T')[0];
  const aRever = ESTRATEGIAS_EM_TESTE.filter(e => {
    return e.emTeste && e.emTeste.revisao <= hoje;
  });

  if (aRever.length === 0) {
    return NextResponse.json({ mensagem: 'Nenhuma estratégia necessita de revisão hoje.' });
  }

  const relatorio: string[] = [];

  for (const estrategia of aRever) {
    const desdeDate = new Date(Date.now() - DIAS_VOLTAR * 86_400_000).toISOString();
    
    // 2. Buscar sinais gerados por esta estratégia recentemente
    const { data: sinais } = await db
      .from('sinais_tempo_real')
      .select('id,simbolo,timeframe,direccao,entrada,stop,alvos,gerado_em')
      .eq('estrategia', estrategia.id)
      .gte('gerado_em', desdeDate);

    if (!sinais || sinais.length === 0) {
      relatorio.push(`[${estrategia.id}] NENHUM sinal gerado desde o início do teste.`);
      continue;
    }

    let operacoesFechadas = 0;
    let ganhos = 0;
    let somaR = 0;

    for (const sinal of sinais) {
      const s = acharSimbolo(sinal.simbolo);
      const gran = GRANULARIDADE_S[sinal.timeframe];
      if (!s || !gran) continue;

      const tempoMs = Date.parse(sinal.gerado_em);
      const precisa = Math.min(1000, Math.ceil((Date.now() - tempoMs) / (gran * 1000)) + 63);

      try {
        const velas = (await velasDeriv(s.deriv, gran, precisa)).filter((c) => c.time + gran * 1000 <= Date.now());
        const a = acompanharOperacao({
          estrategia: estrategia.id,
          direccao: sinal.direccao,
          entrada: sinal.entrada,
          stop: sinal.stop,
          alvos: sinal.alvos,
          geradoEm: tempoMs,
        }, velas);

        if (a.estado === 'fechada') {
          operacoesFechadas++;
          if ((a.resultadoR ?? 0) > 0) ganhos++;
          somaR += (a.resultadoR ?? 0);
        }
      } catch {
        continue;
      }
    }

    // 3. Gerar veredicto
    if (operacoesFechadas < 15) {
      relatorio.push(`[${estrategia.id}] Sinais gerados: ${sinais.length}, mas apenas ${operacoesFechadas} fechados. Amostra demasiado pequena para avaliar.`);
    } else {
      const winRate = (ganhos / operacoesFechadas) * 100;
      relatorio.push(`[${estrategia.id}] Operações fechadas: ${operacoesFechadas}.`);
      relatorio.push(`Acerto: ${winRate.toFixed(1)}%. Expectativa R: ${(somaR / operacoesFechadas).toFixed(2)}R.`);
      if (somaR < 0) {
        relatorio.push(`VEREDICTO SUGERIDO: DESCARTAR. Está a perder dinheiro.`);
      } else if (winRate > 40 && somaR > 0) {
        relatorio.push(`VEREDICTO SUGERIDO: MANTER E VALIDAR.`);
      } else {
        relatorio.push(`VEREDICTO SUGERIDO: PROLONGAR TESTE.`);
      }
    }
  }

  return NextResponse.json({
    data: hoje,
    estrategias_avaliadas: aRever.length,
    relatorio
  });
}
