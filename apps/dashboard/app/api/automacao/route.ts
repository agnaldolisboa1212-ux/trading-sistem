/**
 * As regras da automação de quem está a usar o painel.
 *
 * GET devolve as definições (as de omissão, se ainda não houver linha) e diz
 * se o motor já está autorizado a usar a conta cTrader.
 * PUT grava. Só a própria pessoa: o RLS da migração 0012 trata disso.
 */

import { NextResponse } from 'next/server';
import { AUTOMACAO_OMISSAO, type DefinicoesAutomacao } from '@/lib/automacao';
import { temSessaoMotor } from '@/lib/ctrader/motor';
import { clienteServidor, utilizadorDaSessao } from '@/lib/supabase/servidor';

export const dynamic = 'force-dynamic';

const SEM_CACHE = { 'Cache-Control': 'no-store' };

interface LinhaAutomacao {
  activa: boolean;
  conta_real_permitida: boolean;
  estrategias: string[];
  instrumentos: string[];
  modo_lote: string;
  lote_fixo: number | string;
  risco_pct: number | string;
  max_ordens_abertas: number;
  perda_diaria_pct: number | string;
  perda_total_pct: number | string;
  conta_ctrader: number | string | null;
}

const num = (v: unknown, omissao: number): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : omissao;
};

function daLinha(l: LinhaAutomacao): DefinicoesAutomacao {
  return {
    activa: l.activa,
    contaRealPermitida: l.conta_real_permitida,
    estrategias: l.estrategias ?? [],
    instrumentos: l.instrumentos ?? [],
    modoLote: l.modo_lote === 'risco' ? 'risco' : 'fixo',
    loteFixo: num(l.lote_fixo, AUTOMACAO_OMISSAO.loteFixo),
    riscoPct: num(l.risco_pct, AUTOMACAO_OMISSAO.riscoPct),
    maxOrdensAbertas: num(l.max_ordens_abertas, AUTOMACAO_OMISSAO.maxOrdensAbertas),
    perdaDiariaPct: num(l.perda_diaria_pct, AUTOMACAO_OMISSAO.perdaDiariaPct),
    perdaTotalPct: num(l.perda_total_pct, AUTOMACAO_OMISSAO.perdaTotalPct),
    contaCtrader: l.conta_ctrader === null ? null : num(l.conta_ctrader, 0) || null,
  };
}

export async function GET() {
  const db = await clienteServidor();
  const u = await utilizadorDaSessao();
  if (!db || !u) return NextResponse.json({ erro: 'Entre na plataforma.' }, { status: 401, headers: SEM_CACHE });

  const { data } = await db.from('automacao').select('*').eq('utilizador_id', u.id).maybeSingle();
  return NextResponse.json(
    {
      definicoes: data ? daLinha(data as LinhaAutomacao) : AUTOMACAO_OMISSAO,
      motorAutorizado: await temSessaoMotor(),
      // Sem esta variável no servidor, o motor não executa nada — e é melhor
      // dizê-lo do que deixar alguém achar que ligou a automação.
      motorLigadoAEsteUtilizador: process.env['AUTOMACAO_UTILIZADOR_ID'] === u.id,
    },
    { headers: SEM_CACHE },
  );
}

export async function PUT(pedido: Request) {
  const db = await clienteServidor();
  const u = await utilizadorDaSessao();
  if (!db || !u) return NextResponse.json({ erro: 'Entre na plataforma.' }, { status: 401, headers: SEM_CACHE });

  let c: Partial<DefinicoesAutomacao>;
  try {
    c = (await pedido.json()) as Partial<DefinicoesAutomacao>;
  } catch {
    return NextResponse.json({ erro: 'corpo inválido' }, { status: 400 });
  }

  const limitar = (v: unknown, min: number, max: number, omissao: number) =>
    Math.min(max, Math.max(min, num(v, omissao)));

  const linha = {
    utilizador_id: u.id,
    activa: c.activa === true,
    conta_real_permitida: c.contaRealPermitida === true,
    estrategias: Array.isArray(c.estrategias) ? c.estrategias.map(String) : [],
    instrumentos: Array.isArray(c.instrumentos) ? c.instrumentos.map((s) => String(s).toUpperCase()) : [],
    modo_lote: c.modoLote === 'risco' ? 'risco' : 'fixo',
    lote_fixo: limitar(c.loteFixo, 0.01, 100, 0.01),
    risco_pct: limitar(c.riscoPct, 0.1, 5, 1),
    max_ordens_abertas: Math.round(limitar(c.maxOrdensAbertas, 1, 20, 2)),
    perda_diaria_pct: limitar(c.perdaDiariaPct, 0.5, 50, 3),
    perda_total_pct: limitar(c.perdaTotalPct, 1, 90, 10),
    conta_ctrader: c.contaCtrader ? Math.round(num(c.contaCtrader, 0)) : null,
    actualizado_em: new Date().toISOString(),
  };

  const { error } = await db.from('automacao').upsert(linha, { onConflict: 'utilizador_id' });
  if (error) return NextResponse.json({ erro: error.message }, { status: 500, headers: SEM_CACHE });
  return NextResponse.json({ ok: true, definicoes: c }, { headers: SEM_CACHE });
}
