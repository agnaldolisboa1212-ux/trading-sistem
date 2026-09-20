/**
 * Abrir uma ordem na conta cTrader — a mercado, limite ou stop, com SL/TP.
 *
 * Só com um toque e confirmação: `confirmacao: 'sim'`; conta real exige também
 * `aceitoRisco: true`; volume limitado por `CTRADER_LIMITE_LOTES`. Nada no
 * sistema chama esta rota sozinho.
 */

import { NextResponse } from 'next/server';
import { abrirOrdemCtrader, contaDoToken } from '@/lib/ctrader/conta';
import { validarOrdem, type Lado, type TipoOrdem } from '@/lib/ctrader/protocolo';
import { corpoJson, erroCtrader, LIMITE_LOTES, preco, semAcesso } from '@/lib/ctrader/rotas';
import { acessoCtrader } from '@/lib/ctrader/sessao';
import { acharSimbolo } from '@/lib/deriv/simbolos';
import { clienteServidor } from '@/lib/supabase/servidor';

export const dynamic = 'force-dynamic';

export async function POST(pedido: Request) {
  const c = await corpoJson<Record<string, unknown>>(pedido);
  if (!c) return NextResponse.json({ erro: 'corpo inválido' }, { status: 400 });
  if (c['confirmacao'] !== 'sim') {
    return NextResponse.json({ erro: 'Ordem não confirmada.' }, { status: 428 });
  }

  const codigo = String(c['codigo'] ?? '').toUpperCase();
  const lado = c['lado'] === 'venda' ? 'venda' : c['lado'] === 'compra' ? 'compra' : null;
  const tipo = ['mercado', 'limite', 'stop'].includes(String(c['tipo'])) ? (c['tipo'] as TipoOrdem) : null;
  const lotes = Number(c['lotes']);
  if (!codigo || !lado || !tipo) return NextResponse.json({ erro: 'Ordem incompleta.' }, { status: 400 });
  if (!(lotes > 0)) return NextResponse.json({ erro: 'Volume inválido.' }, { status: 400 });
  if (lotes > LIMITE_LOTES) {
    return NextResponse.json({ erro: `Acima do limite por ordem (${LIMITE_LOTES} lotes). Ajuste CTRADER_LIMITE_LOTES.` }, { status: 400 });
  }

  const pedidoOrdem = {
    codigo,
    nomeCatalogo: acharSimbolo(codigo)?.nome ?? null,
    lado: lado as Lado,
    tipo,
    lotes,
    preco: preco(c['preco']),
    stopLoss: preco(c['stopLoss']),
    takeProfit: preco(c['takeProfit']),
    precoReferencia: preco(c['precoReferencia']),
  };
  const problema = validarOrdem({ ...pedidoOrdem, precoActual: pedidoOrdem.precoReferencia });
  if (problema) return NextResponse.json({ erro: problema }, { status: 400 });

  const a = await acessoCtrader(pedido);
  if (!a.ok) return semAcesso(a);
  if (!a.sessao.c) return NextResponse.json({ erro: 'Escolha uma conta cTrader.' }, { status: 409 });

  try {
    const { conta } = await contaDoToken(a.sessao.a, a.sessao.c);
    if (conta.real && c['aceitoRisco'] !== true) {
      return NextResponse.json({ erro: 'Conta REAL: confirme que percebe que usa dinheiro seu.', precisaAceitarRisco: true }, { status: 428 });
    }
    const r = await abrirOrdemCtrader(a.sessao.a, conta.id, pedidoOrdem);

    const sinalId = typeof c['sinalId'] === 'string' ? c['sinalId'] : null;
    if (sinalId) {
      const db = await clienteServidor();
      if (db && a.utilizador.id) {
        // Tentar encontrar uma conta interna com a corretora cTrader
        const { data: contas } = await db
          .from('contas')
          .select('id')
          .eq('utilizador_id', a.utilizador.id)
          .ilike('corretora', '%cTrader%')
          .limit(1);

        let contaInternaId = contas?.[0]?.id;

        // Se não existir, criar uma para esta conta
        if (!contaInternaId) {
          const { data: nova } = await db
            .from('contas')
            .insert({ 
              utilizador_id: a.utilizador.id, 
              nome: `cTrader #${conta.login ?? conta.id}`, 
              corretora: 'cTrader', 
              moeda: 'USD' 
            })
            .select('id')
            .single();
          contaInternaId = nova?.id;
        }

        if (contaInternaId) {
          // Marcar como negociado
          await db.from('entradas_pessoais').upsert({
            utilizador_id: a.utilizador.id,
            conta_id: contaInternaId,
            sinal_id: sinalId
          }, { onConflict: 'conta_id,sinal_id' });
        }
      }
    }

    return NextResponse.json({ ok: true, ...r, conta: { id: conta.id, real: conta.real } });
  } catch (e) {
    return erroCtrader(e);
  }
}
