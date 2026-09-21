/**
 * A ordem que o MOTOR envia sozinho, quando um sinal passa nos limites.
 *
 * ── QUEM PODE CHAMAR ───────────────────────────────────────────────────────
 *
 * Só o motor, com o segredo partilhado `X-Motor-Segredo` (o mesmo mecanismo do
 * `/api/push/enviar`). E só executa na conta de UMA pessoa: a que estiver em
 * `AUTOMACAO_UTILIZADOR_ID`. Sem essa variável, ou sem a sessão cTrader do
 * motor (botão "autorizar o motor"), esta rota recusa tudo.
 *
 * ── O QUE TRAVA ────────────────────────────────────────────────────────────
 *
 * A decisão está em `lib/automacao.ts`, separada e testada: automação ligada,
 * estratégia e instrumento escolhidos, conta real autorizada, máximo de
 * posições abertas, perda do dia, perda total, lote dentro do tecto. Aqui só
 * se juntam os factos (saldo, posições, histórico) e se executa o veredicto.
 *
 * Todos os sinais ficam registados em `ordens_automaticas`, incluindo os
 * recusados e o motivo — sem isso não há como saber porque não houve ordem.
 */

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  AUTOMACAO_OMISSAO,
  decidirAutomacao,
  linhaDoRegisto,
  type DefinicoesAutomacao,
  type SinalParaAutomacao,
} from '@/lib/automacao';
import { abrirOrdemCtrader, historicoCompletoCtrader, retratoCtrader, simboloParaCodigo } from '@/lib/ctrader/conta';
import { sessaoDoMotor } from '@/lib/ctrader/motor';
import { acharSimbolo } from '@/lib/deriv/simbolos';
import { escreverServico, lerServico } from '@/lib/supabase/servico';

export const dynamic = 'force-dynamic';

const SEM_CACHE = { 'Cache-Control': 'no-store' };
const LIMITE_LOTES = Number(process.env['CTRADER_LIMITE_LOTES'] ?? 1);

function segredoValido(recebido: string | null): boolean {
  const esperado = process.env['MOTOR_SEGREDO'] ?? '';
  if (!esperado || !recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

const num = (v: unknown, omissao: number): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : omissao;
};

function definicoesDaLinha(l: Record<string, unknown> | undefined): DefinicoesAutomacao {
  if (!l) return AUTOMACAO_OMISSAO;
  return {
    activa: l['activa'] === true,
    contaRealPermitida: l['conta_real_permitida'] === true,
    estrategias: (l['estrategias'] as string[]) ?? [],
    instrumentos: ((l['instrumentos'] as string[]) ?? []).map((s) => s.toUpperCase()),
    modoLote: l['modo_lote'] === 'risco' ? 'risco' : 'fixo',
    loteFixo: num(l['lote_fixo'], AUTOMACAO_OMISSAO.loteFixo),
    riscoPct: num(l['risco_pct'], AUTOMACAO_OMISSAO.riscoPct),
    maxOrdensAbertas: num(l['max_ordens_abertas'], AUTOMACAO_OMISSAO.maxOrdensAbertas),
    perdaDiariaPct: num(l['perda_diaria_pct'], AUTOMACAO_OMISSAO.perdaDiariaPct),
    perdaTotalPct: num(l['perda_total_pct'], AUTOMACAO_OMISSAO.perdaTotalPct),
    contaCtrader: l['conta_ctrader'] ? num(l['conta_ctrader'], 0) || null : null,
  };
}

function sinalDoCorpo(c: Record<string, unknown>): SinalParaAutomacao | null {
  const id = typeof c['id'] === 'string' ? c['id'] : null;
  const simbolo = String(c['simbolo'] ?? '').toUpperCase();
  const direccao = c['direccao'] === 'bullish' || c['direccao'] === 'bearish' ? c['direccao'] : null;
  const entrada = Number(c['entrada']);
  const stop = Number(c['stop']);
  if (!id || !simbolo || !direccao || !Number.isFinite(entrada) || !Number.isFinite(stop)) return null;
  const alvos = Array.isArray(c['alvos']) ? (c['alvos'] as Array<{ preco?: unknown }>) : [];
  const alvo = Number(alvos[0]?.preco);
  return {
    id,
    simbolo,
    timeframe: String(c['timeframe'] ?? ''),
    estrategia: String(c['estrategia'] ?? ''),
    direccao,
    entrada,
    stop,
    alvo: Number.isFinite(alvo) ? alvo : null,
  };
}

export async function POST(pedido: Request) {
  if (!process.env['MOTOR_SEGREDO']) {
    return NextResponse.json({ erro: 'MOTOR_SEGREDO não definido no painel.' }, { status: 503, headers: SEM_CACHE });
  }
  if (!segredoValido(pedido.headers.get('x-motor-segredo'))) {
    return NextResponse.json({ erro: 'não autorizado' }, { status: 401, headers: SEM_CACHE });
  }

  const utilizadorId = process.env['AUTOMACAO_UTILIZADOR_ID'];
  if (!utilizadorId) {
    return NextResponse.json(
      { executada: false, motivo: 'AUTOMACAO_UTILIZADOR_ID não definido: automação desligada no servidor.' },
      { headers: SEM_CACHE },
    );
  }

  let corpo: Record<string, unknown>;
  try {
    corpo = (await pedido.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ erro: 'corpo inválido' }, { status: 400 });
  }
  const sinal = sinalDoCorpo(corpo);
  if (!sinal) return NextResponse.json({ erro: 'sinal incompleto' }, { status: 400 });

  const registar = async (
    resultado: 'enviada' | 'recusada' | 'erro',
    extra: { motivo?: string; lotes?: number; posicaoId?: string | null } = {},
  ) => {
    const r = await escreverServico(
      'ordens_automaticas',
      linhaDoRegisto(utilizadorId, sinal, resultado, extra),
      'return=minimal,resolution=ignore-duplicates',
    );
    if (!r.ok) console.warn('[automacao] não registou a ordem:', r.erro);
  };

  const linhas = await lerServico<Record<string, unknown>>(
    `automacao?utilizador_id=eq.${encodeURIComponent(utilizadorId)}&select=*`,
  );
  if (linhas === null) {
    return NextResponse.json({ executada: false, motivo: 'Supabase de serviço indisponível.' }, { headers: SEM_CACHE });
  }
  const definicoes = definicoesDaLinha(linhas[0]);
  if (!definicoes.activa) {
    return NextResponse.json({ executada: false, motivo: 'Automação desligada.' }, { headers: SEM_CACHE });
  }

  const jaFeitas = await lerServico<{ id: number }>(
    `ordens_automaticas?utilizador_id=eq.${encodeURIComponent(utilizadorId)}&sinal_id=eq.${encodeURIComponent(sinal.id)}&select=id`,
  );
  const jaProcessado = (jaFeitas ?? []).length > 0;

  const sessao = await sessaoDoMotor();
  if (!sessao) {
    await registar('recusada', { motivo: 'Motor sem autorização cTrader.' });
    return NextResponse.json(
      { executada: false, motivo: 'O motor não está autorizado na cTrader. Autorize no painel de automação.' },
      { headers: SEM_CACHE },
    );
  }
  const contaId = definicoes.contaCtrader;
  if (contaId === null) {
    await registar('recusada', { motivo: 'Sem conta cTrader escolhida.' });
    return NextResponse.json({ executada: false, motivo: 'Sem conta cTrader escolhida.' }, { headers: SEM_CACHE });
  }

  try {
    const retrato = await retratoCtrader(sessao.a, contaId);
    const historico = await historicoCompletoCtrader(sessao.a, contaId, 90);
    const inicioDoDia = new Date().setUTCHours(0, 0, 0, 0);
    const resultadoHoje = historico.trades
      .filter((t) => t.fechadoEm >= inicioDoDia)
      .reduce((a, t) => a + t.lucro, 0);
    const resultadoTotal = historico.trades.reduce((a, t) => a + t.lucro, 0);

    const alvoSimbolo = await simboloParaCodigo(
      sessao.a,
      contaId,
      sinal.simbolo,
      acharSimbolo(sinal.simbolo)?.nome ?? null,
    );
    if (!alvoSimbolo) {
      await registar('recusada', { motivo: `${sinal.simbolo} não existe nesta conta cTrader.` });
      return NextResponse.json({ executada: false, motivo: 'Instrumento inexistente na conta.' }, { headers: SEM_CACHE });
    }
    const det = alvoSimbolo.detalhe;

    const decisao = decidirAutomacao({
      definicoes,
      sinal,
      conta: { real: retrato.conta.real, saldo: retrato.saldo },
      posicoesAbertas: retrato.posicoes.length,
      jaProcessado,
      resultadoHoje,
      resultadoTotal,
      // Numa conta em USD a negociar um instrumento cotado em USD, o tamanho do
      // contrato É o valor de um lote por unidade de preço. Noutra moeda de
      // cotação isto fica aproximado — o tecto de lotes é o travão.
      valorPorLote: det.lotSize,
      limiteLotes: LIMITE_LOTES,
      loteMinimo: det.minVolume > 0 && det.lotSize > 0 ? det.minVolume / det.lotSize : 0.01,
    });

    if (!decisao.ok) {
      await registar('recusada', { motivo: decisao.motivo });
      return NextResponse.json({ executada: false, motivo: decisao.motivo }, { headers: SEM_CACHE });
    }

    const r = await abrirOrdemCtrader(sessao.a, contaId, {
      codigo: sinal.simbolo,
      nomeCatalogo: acharSimbolo(sinal.simbolo)?.nome ?? null,
      lado: sinal.direccao === 'bullish' ? 'compra' : 'venda',
      tipo: 'mercado',
      lotes: decisao.lotes,
      stopLoss: sinal.stop,
      takeProfit: sinal.alvo,
      precoReferencia: sinal.entrada,
    });
    await registar('enviada', {
      lotes: r.lotes,
      posicaoId: r.positionId !== null ? String(r.positionId) : null,
      motivo: retrato.conta.real ? 'conta real' : 'conta demo',
    });
    console.log(
      `[automacao] ${sinal.simbolo} ${sinal.direccao} ${r.lotes} lotes · ${sinal.estrategia} · posição ${r.positionId ?? '—'}`,
    );
    return NextResponse.json(
      { executada: true, lotes: r.lotes, posicaoId: r.positionId, conta: { real: retrato.conta.real } },
      { headers: SEM_CACHE },
    );
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    await registar('erro', { motivo });
    console.error('[automacao] falhou:', motivo);
    return NextResponse.json({ executada: false, erro: motivo }, { status: 502, headers: SEM_CACHE });
  }
}
