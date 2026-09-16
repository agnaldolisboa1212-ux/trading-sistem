/**
 * Análise de um instrumento, em formato compacto.
 *
 * Alimenta o painel de "agentes" do Início. Corre a MESMA `analyzeSymbol` que a
 * página de detalhe usa — não é uma versão simplificada, é a mesma função com a
 * resposta reduzida ao que o painel desenha.
 *
 * ── PORQUÊ UM INSTRUMENTO POR PEDIDO ───────────────────────────────────────
 *
 * A alternativa seria uma rota que analisa os dez de uma vez. Fica pior por
 * duas razões:
 *
 *   · o utilizador esperaria pelo mais lento antes de ver o primeiro resultado;
 *   · uma falha de rede num instrumento derrubaria a resposta inteira.
 *
 * Com um por pedido, o painel mostra cada resultado assim que chega e um
 * instrumento que falhe aparece como falhado ao lado dos que passaram. É essa
 * cascata de resultados a aparecer um a um que dá a sensação de trabalho a
 * decorrer — e neste caso o trabalho é real.
 */

import { NextResponse } from 'next/server';
import { analisarComDeriv } from '@/lib/analise-deriv';
import { analyzeSymbol } from '@/lib/analysis';
import { acharSimbolo } from '@/lib/deriv/simbolos';
import { getInstrument, type Timeframe } from '@trading/core';

/**
 * Códigos da Deriv que TÊM equivalente no universo MMXM.
 *
 * `US100` e `NQ` são o mesmo mercado com contratos diferentes (índice à vista
 * contra futuro). Os preços não coincidem — e é por isso que o registry nunca
 * mistura as duas fontes na mesma série — mas a ESTRUTURA é a mesma, por isso
 * a análise MMXM do futuro aplica-se ao índice.
 *
 * Sem este mapa, quem escolhesse "US100" no onboarding veria "instrumento
 * desconhecido" no radar, apesar de o sistema saber analisar exatamente esse
 * mercado.
 */
const EQUIVALENTE_MMXM: Record<string, string> = {
  US100: 'NQ',
  SP500: 'ES',
  US30: 'YM',
};

export const dynamic = 'force-dynamic';
/** Cada análise carrega 400 velas de várias séries; 60s é folgado mas seguro. */
export const maxDuration = 60;

const VALIDOS = new Set<Timeframe>(['5m', '15m', '30m', '1h', '4h', '1d', '1w']);

/**
 * Abaixo de 1h não se corre o MMXM, nem para o universo dele.
 *
 * As janelas macro do modelo estão calibradas em ciclos semanais e mensais; a
 * 15 minutos continuariam a devolver uma pontuação, mas a medir o ciclo errado.
 * Antes, um pedido de 15m caía em silêncio para o diário e quem escolheu "day
 * trading" via análise diária rotulada como sua. Agora vai pelas estratégias
 * institucionais, que funcionam em qualquer timeframe — e a resposta diz qual.
 */
const INTRADIARIO = new Set<Timeframe>(['5m', '15m', '30m']);

export async function GET(
  pedido: Request,
  ctx: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await ctx.params;
  const url = new URL(pedido.url);
  const tfBruto = url.searchParams.get('tf') ?? '1d';
  const tf = (VALIDOS.has(tfBruto as Timeframe) ? tfBruto : '1d') as Timeframe;

  const canonico = symbol.toUpperCase();
  const alvoMmxm = EQUIVALENTE_MMXM[canonico] ?? canonico;

  try {
    /*
     * Duas vias, por esta ordem:
     *
     *   1. MMXM completo — só para os 17 instrumentos que têm pares SMT
     *      definidos. É a análise mais forte que o sistema tem.
     *   2. Estratégias institucionais sobre velas da Deriv — para tudo o
     *      resto (sintéticos, DAX, Nikkei…), que não tem par correlacionado.
     *
     * A alternativa era devolver 404 para o segundo grupo. Mas o onboarding
     * deixa escolhê-los, e um instrumento escolhido que responde "desconhecido"
     * lê-se como avaria, não como limite de desenho.
     */
    if (INTRADIARIO.has(tf) || !getInstrument(alvoMmxm)) {
      const inst = await analisarComDeriv(canonico, tf);
      if (!inst) {
        return NextResponse.json(
          { simbolo: canonico, erro: 'instrumento desconhecido' },
          { status: 404 },
        );
      }
      return NextResponse.json(inst, { headers: { 'Cache-Control': 'no-store' } });
    }

    const a = await analyzeSymbol(alvoMmxm, tf);
    if (!a) {
      return NextResponse.json(
        { simbolo: canonico, erro: 'instrumento desconhecido' },
        { status: 404 },
      );
    }

    const d = a.result.diagnostics;
    const s = a.result.signal;

    return NextResponse.json(
      {
        simbolo: canonico,
        nome: acharSimbolo(canonico)?.nome ?? a.name,
        // Quando o pedido foi US100 e a analise correu sobre NQ, dizer qual foi
        // usada evita que alguem compare este preco com o do grafico e conclua
        // que um dos dois esta errado.
        analisado: alvoMmxm === canonico ? undefined : alvoMmxm,
        metodo: 'mmxm',
        timeframe: tf,
        pontuacao: d.checklistScore,
        modelo: d.modelType,
        fase: d.modelPhase,
        fluxo: d.htfOrderFlow,
        passoFalhado: d.failedAtStep,
        resumo: d.summary,
        smt: d.smtCount,
        // Falhas de dados por símbolo — quando uma referência SMT não carrega,
        // o resultado ainda sai mas vale menos, e isso tem de ser visível.
        falhas: [...a.failures.entries()].map(([k, v]) => ({ simbolo: k, erro: v })),
        sinal: s
          ? {
              direccao: s.direction,
              entrada: s.entryPrice,
              stop: s.stopLoss,
              rMaximo: s.maxRMultiple,
              confianca: s.confidence,
              alvos: s.targets.map((t) => ({ preco: t.price, r: t.rMultiple })),
            }
          : null,
        em: a.loadedAt,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        simbolo: canonico,
        erro: err instanceof Error ? err.message : String(err),
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
