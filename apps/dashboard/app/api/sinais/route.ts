/**
 * Os sinais de tempo real de QUEM PEDE.
 *
 *   só do portfólio   instrumentos que a conta escolheu (perfil); portfólio
 *                     vazio = lista vazia, e o ecrã diz como a encher
 *   sem os eliminados tabela `sinais_ocultos` (migração 0006)
 *   com estado        à espera, em curso, alvo, invalidado (stop, sem entrada,
 *                     expirado) — calculado sobre as velas da Deriv desde o
 *                     fecho da vela do sinal
 *   ordenados         pelo momento do anúncio, mais recente primeiro
 *
 * As velas pedem-se uma vez por instrumento/timeframe e ficam um minuto em
 * memória: vinte pessoas a abrir o início não são vinte pedidos à Deriv.
 */

import { NextResponse } from 'next/server';
import { timeframesDosObjetivos } from '@trading/core';
import { velasDeriv } from '@trading/data';
import { acharSimbolo } from '@/lib/deriv/simbolos';
import { estadoDoPlano, type EstadoPlano, type VelaMinima } from '@/lib/estado-sinal';
import { clienteServidor } from '@/lib/supabase/servidor';

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

/** Sinais mais antigos do que isto não entram na lista. */
const JANELA_DIAS = 7;

export interface SinalDaConta {
  id: string;
  simbolo: string;
  timeframe: string;
  estrategia: string;
  direccao: 'bullish' | 'bearish';
  entrada: number;
  stop: number;
  alvos: Array<{ preco: number; r: number }>;
  rMaximo: number;
  conviccao: number;
  razao: string;
  geradoEm: string;
  anunciadoEm: string;
  estado: EstadoPlano | null;
}

const memoriaVelas = new Map<string, { ate: number; velas: VelaMinima[] }>();

async function velasDesde(simbolo: string, timeframe: string, desdeMs: number): Promise<VelaMinima[] | null> {
  const s = acharSimbolo(simbolo);
  const gran = GRANULARIDADE_S[timeframe];
  if (!s || !gran) return null;
  const chave = `${s.deriv}|${gran}`;
  const guardado = memoriaVelas.get(chave);
  const precisa = Math.min(1000, Math.ceil((Date.now() - desdeMs) / (gran * 1000)) + 3);
  if (guardado && guardado.ate > Date.now() && guardado.velas.length >= precisa) return guardado.velas;
  try {
    const velas = (await velasDeriv(s.deriv, gran, precisa)).map((c) => ({
      time: c.time,
      high: c.high,
      low: c.low,
    }));
    if (memoriaVelas.size > 200) memoriaVelas.clear();
    memoriaVelas.set(chave, { ate: Date.now() + 60_000, velas });
    return velas;
  } catch {
    return null;
  }
}

export async function GET() {
  const db = await clienteServidor();
  if (!db) return NextResponse.json({ erro: 'Supabase não configurado' }, { status: 503 });

  const { data: u } = await db.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return NextResponse.json({ erro: 'sem sessão', codigo: 'SemSessao' }, { status: 401 });

  const { data: perfil } = await db
    .from('perfis_utilizador')
    .select('instrumentos,objetivos')
    .eq('utilizador_id', uid)
    .maybeSingle();
  const portfolio = ((perfil?.instrumentos as string[] | null) ?? []).map((c) => c.toUpperCase());
  // Só os timeframes que o objetivo do onboarding pede (intradiário 1h, swing 4h e 1d...).
  const timeframes = timeframesDosObjetivos(perfil?.objetivos as string[] | null);

  let ocultos = new Set<string>();
  let ocultarDisponivel = true;
  {
    const { data, error } = await db.from('sinais_ocultos').select('sinal_id').eq('utilizador_id', uid);
    if (error) ocultarDisponivel = false;
    else ocultos = new Set((data ?? []).map((l) => l.sinal_id as string));
  }

  if (portfolio.length === 0) {
    return NextResponse.json(
      { portfolio, timeframes, sinais: [], ocultarDisponivel },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const desde = new Date(Date.now() - JANELA_DIAS * 86_400_000).toISOString();
  const { data: linhas, error } = await db
    .from('sinais_tempo_real')
    .select('id,simbolo,timeframe,estrategia,direccao,entrada,stop,alvos,r_maximo,conviccao,razao,gerado_em,criado_em')
    .in('simbolo', portfolio)
    .in('timeframe', timeframes)
    .gte('criado_em', desde)
    .order('criado_em', { ascending: false })
    .limit(80);
  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }

  const sinais: SinalDaConta[] = (linhas ?? [])
    .filter((l) => !ocultos.has(l.id))
    .map((l) => ({
      id: l.id,
      simbolo: l.simbolo,
      timeframe: l.timeframe,
      estrategia: l.estrategia,
      direccao: l.direccao,
      entrada: Number(l.entrada),
      stop: Number(l.stop),
      alvos: Array.isArray(l.alvos) ? l.alvos : [],
      rMaximo: Number(l.r_maximo),
      conviccao: Number(l.conviccao),
      razao: l.razao ?? '',
      geradoEm: l.gerado_em,
      anunciadoEm: l.criado_em,
      estado: null,
    }));

  // Estado: um pedido de velas por instrumento/timeframe, desde o sinal mais antigo.
  const grupos = new Map<string, SinalDaConta[]>();
  for (const s of sinais) {
    const k = `${s.simbolo}|${s.timeframe}`;
    grupos.set(k, [...(grupos.get(k) ?? []), s]);
  }
  await Promise.all(
    [...grupos.values()].map(async (lista) => {
      const primeiro = lista[0]!;
      const gran = (GRANULARIDADE_S[primeiro.timeframe] ?? 900) * 1000;
      const maisAntigo = Math.min(...lista.map((s) => Date.parse(s.geradoEm)));
      const velas = await velasDesde(primeiro.simbolo, primeiro.timeframe, maisAntigo);
      if (!velas) return;
      for (const s of lista) {
        const fecho = Date.parse(s.geradoEm) + gran;
        s.estado = estadoDoPlano(
          { direccao: s.direccao, entrada: s.entrada, stop: s.stop, alvo: s.alvos[0]?.preco ?? null },
          velas.filter((v) => v.time >= fecho),
        );
      }
    }),
  );

  return NextResponse.json(
    { portfolio, timeframes, sinais, ocultarDisponivel },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
