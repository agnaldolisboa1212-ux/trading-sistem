/**
 * Análise de um instrumento com todas as estratégias ACTIVAS.
 *
 * Alimenta o painel de agentes do Início. Corre exactamente o que o motor de
 * tempo real decide em cada passagem (`apps/engine/.../tempo-real.ts`): pede
 * as velas fechadas da Deriv, corre `executarEstrategiasValidadas` — a mesma
 * função, com o mesmo `DadosExtra` do SMT quando é preciso — e diz se há sinal
 * na última vela ou, se não houver, porquê.
 *
 * Antes disto corria a análise institucional MMXM antiga (checklist de 9
 * passos, `runInstitutionalStrategies`): mostrava "a trabalhar" com uma régua
 * que o sistema real já não usa para decidir nada — no backtest, essas
 * estratégias perdiam dinheiro depois do spread, e deixaram de gerar sinais
 * reais há vários commits. Este painel via para o gráfico com uma pontuação
 * que não correspondia ao que a pessoa recebia no Telegram.
 *
 * ── PORQUE UM INSTRUMENTO POR PEDIDO ───────────────────────────────────────
 *
 * A alternativa seria uma rota que analisa os dez de uma vez. Fica pior por
 * duas razões:
 *
 *   · o utilizador esperaria pelo mais lento antes de ver o primeiro resultado;
 *   · uma falha de rede num instrumento derrubaria a resposta inteira.
 *
 * Com um por pedido, o painel mostra cada resultado assim que chega e um
 * instrumento que falhe aparece como falhado ao lado dos que passaram.
 */

import { NextResponse } from 'next/server';
import { velasDeriv } from '@trading/data';
import {
  estrategiaEmTeste,
  estrategiasPara,
  executarEstrategiasValidadas,
  paresSmtIct,
  type Candle,
  type DadosExtra,
  type Timeframe,
} from '@trading/core';
import { acharSimbolo } from '@/lib/deriv/simbolos';

export const dynamic = 'force-dynamic';
/** O SMT pode pedir até seis séries de referência; 60s é folgado mas seguro. */
export const maxDuration = 60;

const GRANULARIDADE_S: Record<string, number> = {
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
};

/** Abaixo disto as estratégias recusam-se (a mesma regra do motor). */
const MIN_VELAS = 60;

async function velasFechadas(derivSymbol: string, gran: number, quantas = 320): Promise<Candle[]> {
  const brutas = await velasDeriv(derivSymbol, gran, quantas);
  // A Deriv devolve a vela em formação no fim: cortá-la é o motor a fazer o mesmo.
  return brutas.filter((c) => c.time + gran * 1000 <= Date.now());
}

/**
 * Os dois grupos do painel de agentes:
 *
 *   algo     ICT ALGO e Asia Range Algo — trazem o seu timeframe (15M) e
 *            precisam de diário e par; correm sempre em 15M
 *   basico   as outras estratégias, no timeframe escolhido
 *
 * Sem `grupo`, correm todas (compatibilidade).
 */
const ALGOS = ['ict-algo', 'asia-range-algo'];
type Grupo = 'algo' | 'ict' | 'asia' | 'basico' | null;
const doGrupo = (grupo: Grupo) => (e: { id: string }) =>
  grupo === 'algo'
    ? ALGOS.includes(e.id)
    : grupo === 'ict'
      ? e.id === 'ict-algo'
      : grupo === 'asia'
        ? e.id === 'asia-range-algo'
        : grupo === 'basico'
          ? !ALGOS.includes(e.id)
          : true;
/** O ICT ALGO executa em 15M, 1H e 4H; o Asia Range só em 15M. */
const TF_ICT = new Set(['15m', '1h', '4h']);

/** "Tente 1H ou 4H." — noutros timeframes deste instrumento há estratégia activa. */
function outrosTimeframes(codigo: string, actual: string, grupo: Grupo = null): string {
  const tfs = Object.keys(GRANULARIDADE_S).filter(
    (tf) => tf !== actual && estrategiasPara(codigo, tf).filter(doGrupo(grupo)).length > 0,
  );
  return tfs.length > 0
    ? `Tente ${tfs.map((t) => t.toUpperCase()).join(' ou ')}.`
    : 'Nenhum timeframe tem estratégia activa para este instrumento.';
}

export async function GET(
  pedido: Request,
  ctx: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await ctx.params;
  const url = new URL(pedido.url);
  const grupoBruto = url.searchParams.get('grupo');
  const grupo: Grupo =
    grupoBruto === 'algo' || grupoBruto === 'ict' || grupoBruto === 'asia' || grupoBruto === 'basico'
      ? grupoBruto
      : null;
  // Os algos correm nos seus timeframes.
  const tfPedido = url.searchParams.get('tf') ?? '1d';
  const tfBruto =
    grupo === 'algo' || grupo === 'asia' ? '15m' : grupo === 'ict' ? (TF_ICT.has(tfPedido) ? tfPedido : '15m') : tfPedido;
  const tf = (GRANULARIDADE_S[tfBruto] ? tfBruto : '1d') as Timeframe;
  const canonico = symbol.toUpperCase();
  const em = Date.now();

  const s = acharSimbolo(canonico);
  if (!s) {
    return NextResponse.json(
      { simbolo: canonico, erro: 'instrumento desconhecido' },
      { status: 404 },
    );
  }

  const estrategias = estrategiasPara(s.codigo, tf).filter(doGrupo(grupo));
  if (estrategias.length === 0) {
    return NextResponse.json(
      {
        simbolo: s.codigo,
        nome: s.nome,
        timeframe: tf,
        temEstrategia: false,
        sinal: null,
        resumo:
          grupo === 'algo' || grupo === 'ict' || grupo === 'asia'
            ? 'Este algo não corre neste instrumento.'
            : `Sem estratégia activa em ${tf.toUpperCase()}. ${outrosTimeframes(s.codigo, tf, grupo)}`,
        em,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const gran = GRANULARIDADE_S[tf]!;
    // Os algos (ICT ALGO, Asia Range) precisam de história, diário e par — como no motor.
    const temAlgo = estrategias.some((e) => e.id === 'ict-algo' || e.id === 'asia-range-algo');
    const fechadas = await velasFechadas(s.deriv, gran, temAlgo ? 1500 : 320);
    const ultima = fechadas.at(-1);
    if (!ultima || fechadas.length < MIN_VELAS) {
      return NextResponse.json(
        {
          simbolo: s.codigo,
          nome: s.nome,
          timeframe: tf,
          temEstrategia: true,
          sinal: null,
          resumo: `Só ${fechadas.length} velas fechadas — a estratégia precisa de pelo menos ${MIN_VELAS}.`,
          em,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    // Algumas regras precisam de velas de outro timeframe —
    // a mesma lógica de `tempo-real.ts`, sem o cache entre passagens (aqui é
    // um pedido isolado).
    let extra: DadosExtra = {};
    if (temAlgo) {
      const parSim = paresSmtIct(s.codigo).map((c) => acharSimbolo(c)).find((x) => x) ?? null;
      const [diarias, parVelas] = await Promise.all([
        velasFechadas(s.deriv, GRANULARIDADE_S['1d']!, 300),
        parSim ? velasFechadas(parSim.deriv, gran, 1500).catch(() => []) : Promise.resolve([]),
      ]);
      extra = {
        ...extra,
        algo: { diarias, par: parSim && parVelas.length > 0 ? { simbolo: parSim.codigo, velas: parVelas } : null },
      };
    }
    if (estrategias.some((e) => e.id === 'abertura-dax-teste' || e.id === 'compra-vwap-indices')) {
      extra = { ...extra, velas1d: await velasFechadas(s.deriv, GRANULARIDADE_S['1d']!) };
    }

    const frescos = executarEstrategiasValidadas(
      fechadas,
      { symbol: s.codigo, timeframe: tf },
      extra,
      estrategias.map((e) => e.id),
    ).filter((x) => x.generatedAt === ultima.time);

    // Um sinal por instrumento — como o motor: sentidos opostos não escolhem nenhum.
    const altas = frescos.filter((x) => x.direction === 'bullish');
    const baixas = frescos.filter((x) => x.direction === 'bearish');
    const conflito = altas.length > 0 && baixas.length > 0;
    const lado = altas.length > 0 ? altas : baixas;
    const escolhido = conflito ? null : ([...lado].sort((a, b) => b.conviction - a.conviction)[0] ?? null);

    const nomesEstrategias = estrategias.map((e) => e.nome);
    const resumo = conflito
      ? 'Estratégias em sentidos opostos na última vela — nenhuma prevalece.'
      : escolhido
        ? escolhido.rationale
        : `${nomesEstrategias.join(', ')} — nenhuma deu sinal na última vela fechada.`;

    return NextResponse.json(
      {
        simbolo: s.codigo,
        nome: s.nome,
        timeframe: tf,
        temEstrategia: true,
        estrategias: nomesEstrategias,
        conflito,
        sinal: escolhido
          ? {
              direccao: escolhido.direction,
              entrada: escolhido.entryPrice,
              stop: escolhido.stopLoss,
              alvo: escolhido.targets[0]?.price ?? null,
              pendente: escolhido.entryType === 'limit',
              rMaximo: escolhido.maxRMultiple,
              conviccao: escolhido.conviction,
              estrategia: escolhido.strategy,
              emTeste: estrategiaEmTeste(escolhido.strategy) !== undefined,
            }
          : null,
        resumo,
        em,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        simbolo: s.codigo,
        nome: s.nome,
        timeframe: tf,
        erro: err instanceof Error ? err.message : String(err),
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
