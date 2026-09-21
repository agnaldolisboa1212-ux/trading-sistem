/**
 * Detalhe de um instrumento: gráfico ao vivo e a análise completa.
 *
 * A análise MMXM corre no servidor com o MESMO `analyzeInstrument` do motor.
 * Quando o instrumento existe na Deriv, o gráfico é o ao vivo (velas da Deriv,
 * ao segundo) com um selector de estratégia: o MMXM é uma das visões, ao lado
 * das quatro institucionais que o motor de tempo real usa para os avisos. Sem
 * código Deriv (futuros, DXY) fica o gráfico do servidor.
 *
 * Instrumentos da Deriv sem MMXM (sintéticos, DAX…) vão para o terminal, que
 * tem as mesmas visões.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Abas } from '@/components/Abas';
import type { MmxmPronto } from '@/components/vivo/AnaliseAoVivo';
import { GraficoInstrumento } from '@/components/vivo/GraficoInstrumento';
import { acharSimbolo, type Timeframe as DerivTimeframe } from '@/lib/deriv/simbolos';
import { alvoMmxm } from '@/lib/equivalentes';
import { visaoValida, type Desenho } from '@/lib/visoes';
import { AutoRefresh } from '@/components/AutoRefresh';
import { ThemeToggle } from '@/components/ThemeToggle';
import { TimeframeSwitch } from '@/components/TimeframeSwitch';
import { ChartPanel } from '@/components/ChartPanel';
import type { PriceBand, PriceLine, PriceMarker } from '@/components/PriceChart';
import { SmtChart, type SmtDivergenceMark } from '@/components/SmtChart';
import {
  alignByTime,
  analyzeSymbol,
  macrosCalibratedFor,
  reindex,
  toChartCandles,
  TIMEFRAMES,
  TIMEFRAME_LABEL,
  type ChartCandle,
} from '@/lib/analysis';
import { getInstrument, INSTRUMENTS, type Timeframe } from '@trading/core';

export const dynamic = 'force-dynamic';
/*
 * Sem cache: o gráfico atualiza ao minuto e a vela em formação muda a cada tick.
 * Com `revalidate` a página serviria a mesma fotografia durante minutos e o
 * contador de atualização estaria a mentir.
 */
export const revalidate = 0;

/** Quantas velas mostrar. 180 dias ≈ 9 meses de pregão — chega para ver o MMXM inteiro. */
const BARS = 180;

const PHASE_LABEL: Record<string, string> = {
  'original-consolidation': 'consolidação original',
  'left-curve': 'curva esquerda',
  'smart-money-reversal': 'Smart Money Reversal',
  'right-curve-low-risk-entry': 'curva direita — Low Risk Entry',
  'right-curve-stage-1': 'curva direita — 1ª Acumulação/Distribuição',
  'right-curve-silver-bullet': 'curva direita — Silver Bullet',
  completed: 'completo',
  invalidated: 'invalidado',
};

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<{ tf?: string; v?: string }>;
}) {
  const { symbol: raw } = await params;
  const { tf, v } = await searchParams;
  const pedido = decodeURIComponent(raw).toUpperCase();
  const deriv = acharSimbolo(pedido);
  // US100 → NQ: a análise MMXM corre sobre o contrato equivalente.
  const symbol = alvoMmxm(pedido);
  const equivalente = symbol !== pedido;

  // Timeframe do URL, validado contra a lista suportada.
  const timeframe: Timeframe = (TIMEFRAMES as string[]).includes(tf ?? '')
    ? (tf as Timeframe)
    : '1d';

  /*
   * Símbolo fora do universo: um estado explícito em vez de `notFound()`.
   *
   * Com streaming, o `notFound()` já não consegue alterar o código de estado
   * (o shell foi enviado com 200) e a página ficava presa no esqueleto de
   * carregamento — o pior resultado possível. E de qualquer forma, quem chega
   * aqui veio de um link: dizer-lhe quais são os símbolos válidos é mais útil
   * do que um 404.
   */
  if (!getInstrument(symbol)) {
    if (deriv) {
      const tfDeriv = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'].includes(tf ?? '') ? tf : '1h';
      redirect(`/grafico?s=${encodeURIComponent(deriv.codigo)}&tf=${tfDeriv}`);
    }
    return <UnknownSymbol symbol={pedido} />;
  }

  const analysis = await analyzeSymbol(symbol, timeframe);
  if (!analysis) {
    // Sem a fonte pública o MMXM não corre; o gráfico ao vivo e as outras
    // estratégias da Deriv continuam a servir.
    if (deriv) redirect(`/grafico?s=${encodeURIComponent(deriv.codigo)}&tf=${timeframe}`);
    return (
      <div className="wrap">
        <BackLink />
        <div className="setup">
          <p>
            Não foi possível carregar dados suficientes para <strong>{symbol}</strong>. As fontes
            públicas podem estar temporariamente em baixo — tente daqui a pouco.
          </p>
        </div>
      </div>
    );
  }

  const { result, primary, references, pairs } = analysis;
  const detail = result.detail;
  const model = detail?.model ?? null;
  const signal = result.signal;

  /*
   * O gráfico mostra as velas fechadas MAIS a que está em formação. A análise
   * usou só as fechadas — é essa a separação que permite atualizar ao minuto
   * sem gerar estrutura que desaparece na vela seguinte.
   */
  const paraDesenhar = analysis.forming
    ? [...primary.candles, analysis.forming]
    : primary.candles;
  const candles = toChartCandles(paraDesenhar, BARS);
  const offset = paraDesenhar.length - candles.length;
  const precision = getInstrument(symbol)?.pricePrecision ?? 5;

  // --- Anotações do gráfico de preço --------------------------------------
  const bands: PriceBand[] = [];
  const lines: PriceLine[] = [];
  const markers: PriceMarker[] = [];

  if (model) {
    bands.push({
      low: model.consolidation.low,
      high: model.consolidation.high,
      kind: 'consolidation',
      label: `consolidação original · liquidez ${model.consolidation.engineeredSide}`,
      fromIndex: model.consolidation.startIndex - offset,
      toIndex: model.consolidation.endIndex - offset,
    });

    if (model.smr && model.smr.index >= offset) {
      markers.push({
        index: model.smr.index - offset,
        price: model.smr.price,
        label: 'SMR',
        kind: 'smr',
      });
    }
  }

  // Só os FVGs por preencher — os já mitigados são história, não contexto ativo.
  const openFvgs = (detail?.fvgs ?? [])
    .filter((g) => g.filledAtIndex === null && g.index >= offset)
    .slice(-8);
  for (const gap of openFvgs) {
    bands.push({
      low: gap.low,
      high: gap.high,
      kind: gap.direction === 'bullish' ? 'fvg-bull' : 'fvg-bear',
      fromIndex: gap.index - offset,
    });
  }

  if (detail?.drawOnLiquidity) {
    lines.push({
      price: detail.drawOnLiquidity.pool.price,
      label: `draw on liquidity (${detail.drawOnLiquidity.pool.origin})`,
      kind: 'draw',
    });
  }

  if (signal) {
    bands.push({
      low: signal.entryZoneLow,
      high: signal.entryZoneHigh,
      kind: 'entry',
      label: `zona de entrada · ${signal.entryPattern?.kind ?? ''}`,
      fromIndex: Math.max(0, (signal.entryPattern?.index ?? 0) - offset),
    });
    lines.push({ price: signal.stopLoss, label: 'stop', kind: 'stop' });
    signal.targets.forEach((t, i) => {
      lines.push({ price: t.price, label: `TP${i + 1} · ${t.rMultiple.toFixed(1)}R`, kind: 'target' });
    });
  }

  const last = primary.candles[primary.candles.length - 1];

  /*
   * A análise MMXM como visão do gráfico ao vivo. As marcações vêm em índices
   * das velas do servidor e passam a tempo, para caírem nas velas da Deriv. Com
   * um contrato equivalente (US100 ↔ NQ) os preços não coincidem, e não se
   * desenham — fica o texto.
   */
  const tempoDe = (i: number | undefined) =>
    candles[Math.max(0, Math.min(candles.length - 1, i ?? 0))]?.t ?? 0;
  const desenhoMmxm: Desenho = equivalente
    ? { zonas: [], linhas: [], curvas: [] }
    : {
        zonas: bands.map((b) => ({
          de: tempoDe(b.fromIndex),
          ate: b.toIndex !== undefined ? tempoDe(b.toIndex) : Infinity,
          topo: b.high,
          base: b.low,
          tipo:
            b.kind === 'fvg-bull' ? 'bull' : b.kind === 'fvg-bear' ? 'bear' : b.kind === 'entry' ? 'entrada' : 'neutro',
          rotulo: b.label,
        })),
        linhas: lines.map((l) => ({
          preco: l.price,
          rotulo: l.label,
          tipo: l.kind === 'stop' ? 'stop' : l.kind === 'target' ? 'alvo' : 'poc',
        })),
        curvas: [],
      };
  const mmxm: MmxmPronto = {
    titulo: model
      ? `${model.type} · ${PHASE_LABEL[model.phase] ?? model.phase}`
      : 'Nenhum Market Maker Model identificável',
    linhas: [
      `Checklist ${(result.diagnostics.checklistScore * 100).toFixed(0)}%${
        result.diagnostics.failedAtStep !== null
          ? ` · parou no passo ${result.diagnostics.failedAtStep} de 9`
          : ' · 9 de 9'
      } · fluxo HTF ${result.diagnostics.htfOrderFlow}`,
      result.diagnostics.summary,
      equivalente
        ? `Analisado sobre ${symbol}, o mesmo mercado noutro contrato: os níveis não se desenham no gráfico de ${pedido}.`
        : `Velas ${timeframe} de ${primary.source}; os preços podem diferir ligeiramente dos da Deriv.`,
    ],
    desenho: desenhoMmxm,
    sinal: signal
      ? {
          direccao: signal.direction,
          entrada: signal.entryPrice,
          stop: signal.stopLoss,
          rMaximo: signal.maxRMultiple,
        }
      : null,
  };

  return (
    <div className="wrap">
      <BackLink />

      <header className="top">
        <h1>
          {deriv ? deriv.codigo : symbol}{' '}
          <span className="dim" style={{ fontWeight: 400 }}>
            · {deriv ? deriv.nome : analysis.name}
          </span>
        </h1>
        <p>
          {model ? (
            <>
              <span className={model.type === 'MMBM' ? 'bull-t' : 'bear-t'}>{model.type}</span> ·{' '}
              {PHASE_LABEL[model.phase] ?? model.phase} · fluxo HTF{' '}
              <span
                className={
                  result.diagnostics.htfOrderFlow === 'bullish'
                    ? 'bull-t'
                    : result.diagnostics.htfOrderFlow === 'bearish'
                      ? 'bear-t'
                      : 'faint'
                }
              >
                {result.diagnostics.htfOrderFlow}
              </span>
              {detail?.htfOrderFlowDetail && <span className="faint"> · {detail.htfOrderFlowDetail}</span>}
            </>
          ) : (
            'Nenhum Market Maker Model identificável.'
          )}
        </p>
        <p className="faint">
          fonte {primary.source} · {primary.candles.length} velas fechadas
          {analysis.forming ? ' + 1 em formação' : ''} · HTF {analysis.higherTimeframe} · último
          fecho {last?.close.toFixed(precision)} em{' '}
          {last ? new Date(last.time).toISOString().slice(0, 10) : '—'}
        </p>

        <div className="toolbar">
          <span className="grow" />
          <AutoRefresh updatedAt={analysis.loadedAt} />
          <ThemeToggle />
        </div>
      </header>

      {!macrosCalibratedFor(timeframe) && (
        <div className="notice">
          <strong>Janelas macro fora de calibração.</strong> Em {TIMEFRAME_LABEL[timeframe]} o
          passo 4 do checklist (Time &amp; Price) continua a responder, mas mede ciclos semanais e
          mensais — o eBook usa janelas de XX:45–XX:15 para escala intradiária. A estrutura (MMXM,
          FVG, SMT) mantém-se válida; o alinhamento temporal não.
        </div>
      )}

      <section>
        <h2>Estrutura de preço</h2>
        {deriv ? (
          <GraficoInstrumento
            codigo={deriv.codigo}
            nome={deriv.nome}
            // Validado contra TIMEFRAMES (1h, 4h, 1d, 1w), que a Deriv também tem.
            tf={timeframe as DerivTimeframe}
            casas={deriv.casas}
            visao={visaoValida(v ?? 'mmxm')}
            mmxm={mmxm}
          />
        ) : (
          <>
            <ChartPanel
              symbol={symbol}
              timeframe={timeframe}
              candles={candles}
              bands={bands}
              lines={lines}
              markers={markers}
              precision={precision}
              title={`${symbol} · ${timeframe}`}
              timeframeSwitch={
                <TimeframeSwitch current={timeframe} options={TIMEFRAMES} labels={TIMEFRAME_LABEL} />
              }
            />
            <Legend />
          </>
        )}
      </section>

      {/*
        O gráfico fica FORA das abas, sempre visível.
        Pô-lo dentro de "Overview" faria a única coisa que a página existe para
        mostrar desaparecer ao consultar uma estatística — e obrigaria a
        remontá-lo (e a repor a sondagem de preço ao vivo) a cada regresso.
      */}
      <Abas
        abas={[
          {
            id: 'overview',
            rotulo: 'Overview',
            painel: (
              <>
                <SmtSection analysis={analysis} />
                <section>
                  <h2>Checklist</h2>
                  <ChecklistView result={result} />
                </section>
                {signal && <SignalPlan signal={signal} precision={precision} />}
              </>
            ),
          },
          {
            id: 'estatisticas',
            rotulo: 'Statistics',
            painel: <Estatisticas analysis={analysis} candles={candles} precision={precision} />,
          },
          {
            id: 'historico',
            rotulo: 'History Data',
            painel: <Historico candles={candles} precision={precision} />,
          },
        ]}
      />

      <footer className="note">
        Análise calculada ao vivo a partir de dados públicos. Modo <strong>paper</strong> — nenhuma
        ordem é enviada. Isto não é aconselhamento financeiro.
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------

function UnknownSymbol({ symbol }: { symbol: string }) {
  return (
    <div className="wrap">
      <BackLink />
      <header className="top">
        <h1>{symbol} não está no universo monitorizado</h1>
        <p>Escolha um dos {INSTRUMENTS.length} instrumentos configurados.</p>
      </header>
      <div className="radar-cards">
        {INSTRUMENTS.map((i) => (
          <Link key={i.symbol} href={`/instrumento/${i.symbol}`} className="radar-card">
            <div className="radar-card__top">
              <span className="radar-card__sym">{i.symbol}</span>
              <span className="tag">{i.assetClass}</span>
            </div>
            <div className="radar-card__phase">{i.name}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/" className="backlink">
      ← voltar ao radar
    </Link>
  );
}

function Legend() {
  return (
    <div className="legend" style={{ marginTop: 10 }}>
      <span><i style={{ background: 'var(--bull)', opacity: 0.35 }} /> FVG alta</span>
      <span><i style={{ background: 'var(--bear)', opacity: 0.35 }} /> FVG baixa</span>
      <span><i style={{ background: 'var(--text-faint)', opacity: 0.5 }} /> consolidação original</span>
      <span><i style={{ background: 'var(--accent)' }} /> zona de entrada</span>
      <span><i style={{ background: 'var(--warn)' }} /> SMR / draw on liquidity</span>
    </div>
  );
}

/**
 * Secção de SMT: um gráfico por par correlacionado.
 *
 * Mostra TODAS as divergências brutas, não só as que sobreviveram ao filtro de
 * narrativa e POI — quem olha precisa de ver o que quase contou, e porquê não
 * contou. Mostrar só as aprovadas esconderia metade do raciocínio.
 */
function SmtSection({ analysis }: { analysis: NonNullable<Awaited<ReturnType<typeof analyzeSymbol>>> }) {
  const { result, primary, references, pairs, symbol } = analysis;
  const detail = result.detail;
  const all = detail?.smtAll ?? [];
  const relevant = new Set((detail?.smtRelevant ?? []).map((e) => `${e.reference}|${e.time}|${e.at}`));

  const charts = pairs
    .map((pair) => {
      const ref = references.get(pair.reference);
      if (!ref) return null;

      const aligned = alignByTime(primary.candles, ref.candles, BARS);
      if (aligned.times.length < 10) return null;

      const timeToIndex = new Map(aligned.times.map((t, i) => [dayKey(t), i]));

      const marks: SmtDivergenceMark[] = all
        .filter((e) => e.reference === pair.reference)
        .map((e) => {
          const idx = timeToIndex.get(dayKey(e.time));
          if (idx === undefined) return null;
          // O swing anterior pode cair fora da janela desenhada; encosta-se a 0.
          const prev = Math.max(0, idx - Math.max(1, Math.round(aligned.times.length * 0.08)));
          return {
            index: idx,
            prevIndex: prev,
            at: e.at,
            direction: e.direction,
            strength: e.strength,
            description:
              e.description +
              (relevant.has(`${e.reference}|${e.time}|${e.at}`)
                ? ' — CONTOU para o checklist.'
                : ' — descartada: fora da narrativa ou do point of interest.'),
          } satisfies SmtDivergenceMark;
        })
        .filter((m): m is SmtDivergenceMark => m !== null)
        .slice(-6);

      const primaryVelas = aligned.aRaw.map(c => ({
        t: c.time,
        o: c.open,
        h: c.high,
        l: c.low,
        c: c.close,
      }));

      const startBase = primaryVelas[0]!.c;
      const startRef = aligned.b[0]!;
      const referenceScaled = aligned.b.map(c => 
        pair.correlation === 'inverse' 
          ? startBase * (2 - c / startRef)
          : startBase * (c / startRef)
      );

      return {
        pair,
        times: aligned.times,
        primaryVelas,
        referenceScaled,
        marks,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  return (
    <section>
      <h2>SMT Divergence — {charts.length} par(es) correlacionado(s)</h2>

      {charts.length === 0 ? (
        <div className="empty">Sem séries de referência disponíveis para comparar.</div>
      ) : (
        charts.map((c) => (
          <div className="card pad-chart" key={c.pair.reference}>
            <SmtChart
              times={c.times}
              primarySymbol={symbol}
              referenceSymbol={c.pair.reference}
              correlation={c.pair.correlation}
              primaryVelas={c.primaryVelas}
              referenceScaled={c.referenceScaled}
              marks={c.marks}
            />
          </div>
        ))
      )}
    </section>
  );
}

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function ChecklistView({ result }: { result: NonNullable<Awaited<ReturnType<typeof analyzeSymbol>>>['result'] }) {
  const steps = result.signal?.checklist.steps ?? [];

  if (steps.length === 0) {
    return (
      <div className="card">
        <p className="dim" style={{ margin: 0 }}>
          {result.diagnostics.summary}
        </p>
        {result.diagnostics.failedAtStep !== null && (
          <p className="faint" style={{ marginBottom: 0 }}>
            O checklist parou no passo {result.diagnostics.failedAtStep}. Progresso:{' '}
            {(result.diagnostics.checklistScore * 100).toFixed(0)}%.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="card">
      <ol className="checklist-full">
        {steps
          .filter((s) => s.step <= 9)
          .map((s) => (
            <li key={s.step}>
              <div>
                <span className={s.passed ? 'bull-t' : 'bear-t'}>{s.passed ? '✓' : '✗'}</span>{' '}
                <strong>
                  {s.step}. {s.question}
                </strong>
              </div>
              <div className="faint">{s.detail}</div>
            </li>
          ))}
      </ol>
    </div>
  );
}

function SignalPlan({
  signal,
  precision,
}: {
  signal: NonNullable<NonNullable<Awaited<ReturnType<typeof analyzeSymbol>>>['result']['signal']>;
  precision: number;
}) {
  return (
    <section>
      <h2>Plano da operação</h2>
      <div className={`card ${signal.direction === 'bullish' ? 'bull' : 'bear'}`}>
        <div className="kv">
          <div>
            <span>Entrada</span>
            <strong>{signal.entryPrice.toFixed(precision)}</strong>
          </div>
          <div>
            <span>Stop</span>
            <strong className="bear-t">{signal.stopLoss.toFixed(precision)}</strong>
          </div>
          <div>
            <span>R máximo</span>
            <strong className="bull-t">{signal.maxRMultiple.toFixed(1)}R</strong>
          </div>
          <div>
            <span>Confiança</span>
            <strong>{(signal.confidence * 100).toFixed(0)}%</strong>
          </div>
        </div>
        {signal.targets.map((t, i) => (
          <div className="kv" key={i}>
            <div>
              <span>
                TP{i + 1} · {t.rMultiple.toFixed(1)}R · fechar {(t.closeFraction * 100).toFixed(0)}%
              </span>
              <strong>{t.price.toFixed(precision)}</strong>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Aba Statistics — os números que o gráfico não consegue dizer.
 *
 * O gráfico mostra ONDE estão as estruturas; esta aba mostra QUANTAS há e em
 * que estado. São as duas metades da mesma análise: quem olha para o desenho vê
 * três FVGs por preencher, mas não vê que existem mais quinze já mitigados — e
 * é essa proporção que diz se o mercado tem andado a corrigir ineficiências ou
 * a acumulá-las.
 *
 * Tudo aqui sai do MESMO `AnalyzeResult` que desenhou o gráfico. Nenhum número
 * é recalculado por outro caminho, por isso não podem discordar entre si.
 */
function Estatisticas({
  analysis,
  candles,
  precision,
}: {
  analysis: NonNullable<Awaited<ReturnType<typeof analyzeSymbol>>>;
  candles: ChartCandle[];
  precision: number;
}) {
  const { result, primary } = analysis;
  const detail = result.detail;
  const model = detail?.model ?? null;
  const diag = result.diagnostics;

  /*
   * Estatística da JANELA DESENHADA, não da série inteira: é sobre este troço
   * que a pessoa está a olhar. Um "máximo" de 18 meses não explicaria nada do
   * que está no ecrã.
   */
  const primeiro = candles[0];
  const ultimo = candles[candles.length - 1];
  const maximo = candles.length > 0 ? Math.max(...candles.map((c) => c.h)) : null;
  const minimo = candles.length > 0 ? Math.min(...candles.map((c) => c.l)) : null;
  const variacao =
    primeiro && ultimo && primeiro.o !== 0 ? ((ultimo.c - primeiro.o) / primeiro.o) * 100 : null;

  const fvgs = detail?.fvgs ?? [];
  const fvgsAbertos = fvgs.filter((g) => g.filledAtIndex === null).length;
  const pools = detail?.pools ?? [];
  const poolsPorVarrer = pools.filter((p) => p.sweptAtIndex === null).length;
  const blocos = detail?.blocks ?? [];
  const blocosVivos = blocos.filter((b) => b.invalidatedAtIndex === null).length;
  const macro = detail?.macroVerdict ?? null;

  const n = (v: number | null | undefined, casas = precision): string =>
    v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(casas);

  return (
    <>
      <section>
        <h2>
          Preço <span className="h2-note">janela de {candles.length} velas</span>
        </h2>
        <div className="rows">
          <Linha k="Último fecho" v={n(ultimo?.c)} />
          <Linha
            k="Variação na janela"
            v={variacao === null ? '—' : `${variacao >= 0 ? '+' : ''}${variacao.toFixed(2)}%`}
            /* Verde/vermelho aqui é semântica de mercado — subiu ou desceu — e
               não decoração: é exatamente o uso a que estas cores se destinam. */
            tom={variacao === null ? undefined : variacao >= 0 ? 'bull' : 'bear'}
          />
          <Linha k="Máximo" v={n(maximo)} />
          <Linha k="Mínimo" v={n(minimo)} />
          <Linha k="Amplitude" v={maximo !== null && minimo !== null ? n(maximo - minimo) : '—'} />
          <Linha
            k="ATR"
            v={detail ? n(detail.atr) : '—'}
            nota="volatilidade média por vela — a unidade em que os stops são medidos"
          />
        </div>
      </section>

      <section>
        <h2>Market Maker Model</h2>
        {model ? (
          <div className="rows">
            <Linha k="Tipo" v={model.type} tom={model.type === 'MMBM' ? 'bull' : 'bear'} />
            <Linha k="Direção" v={model.direction} />
            <Linha k="Fase" v={PHASE_LABEL[model.phase] ?? model.phase} />
            {/* `entryStage` é null enquanto o modelo não chega a uma fase que
                admita entrada — não é um erro, é o estado normal do lado
                esquerdo da curva. */}
            <Linha k="Fase de entrada" v={model.entryStage ?? 'ainda não aplicável'} />
            <Linha k="Pernas da curva direita" v={String(model.rightCurveLegs)} />
            <Linha k="Confiança do modelo" v={`${(model.confidence * 100).toFixed(0)}%`} />
            <Linha
              k="Consolidação original"
              v={`${n(model.consolidation.low)} – ${n(model.consolidation.high)}`}
            />
            <Linha k="Liquidez engenheirada" v={model.consolidation.engineeredSide} />
            <Linha
              k="Nível de invalidação"
              v={n(model.invalidationLevel)}
              nota="perder este nível mata o modelo"
            />
            <Linha k="Alvo estrutural" v={n(model.targetLevel)} />
            <Linha k="Smart Money Reversal" v={model.smr ? n(model.smr.price) : 'ainda não'} />
          </div>
        ) : (
          <div className="empty">
            <strong>Nenhum Market Maker Model identificável.</strong>
            Sem consolidação original reconhecível não há curva esquerda nem direita para medir.
          </div>
        )}
      </section>

      <section>
        <h2>Checklist e tempo</h2>
        <div className="rows">
          <Linha k="Progresso" v={`${(diag.checklistScore * 100).toFixed(0)}%`} />
          <Linha
            k="Passo em falta"
            v={diag.failedAtStep === null ? '✓ nenhum' : `${diag.failedAtStep} de 9`}
          />
          <Linha
            k="Fluxo HTF"
            v={diag.htfOrderFlow}
            tom={
              diag.htfOrderFlow === 'bullish'
                ? 'bull'
                : diag.htfOrderFlow === 'bearish'
                  ? 'bear'
                  : undefined
            }
            nota={detail?.htfOrderFlowDetail}
          />
          <Linha
            k="Execução macro"
            v={macro ? (macro.canExecute ? 'permitida' : 'em espera') : '—'}
            nota={macro?.reason}
          />
          <Linha k="Alinhamento temporal" v={macro ? `${(macro.score * 100).toFixed(0)}%` : '—'} />
        </div>
      </section>

      <section>
        <h2>
          Estruturas <span className="h2-note">contadas na série analisada</span>
        </h2>
        <div className="rows">
          <Linha k="Fair Value Gaps" v={`${fvgsAbertos} por preencher · ${fvgs.length} no total`} />
          <Linha k="Order blocks" v={`${blocosVivos} válidos · ${blocos.length} no total`} />
          <Linha
            k="Poços de liquidez"
            v={`${poolsPorVarrer} por varrer · ${pools.length} no total`}
          />
          <Linha k="Swing points" v={String(detail?.swings.length ?? 0)} />
          <Linha k="Points of interest HTF" v={String(detail?.pointsOfInterest.length ?? 0)} />
          <Linha k="Padrões de entrada" v={String(detail?.entryPatterns.length ?? 0)} />
          <Linha
            k="SMT Divergence"
            v={`${detail?.smtRelevant.length ?? 0} relevantes · ${detail?.smtAll.length ?? 0} brutas`}
            nota="relevante = sobreviveu ao filtro de narrativa e point of interest"
          />
          <Linha
            k="Draw on liquidity"
            v={
              detail?.drawOnLiquidity
                ? `${n(detail.drawOnLiquidity.pool.price)} (${detail.drawOnLiquidity.pool.origin})`
                : '—'
            }
          />
        </div>
      </section>

      <section>
        <h2>Dados</h2>
        <div className="rows">
          <Linha k="Fonte" v={primary.source} />
          <Linha k="Velas fechadas" v={String(primary.candles.length)} />
          <Linha k="Vela em formação" v={analysis.forming ? 'sim' : 'não'} />
          <Linha k="Timeframe" v={`${analysis.timeframe} · HTF ${analysis.higherTimeframe}`} />
          <Linha k="Casas decimais" v={String(precision)} />
          {/* As falhas de fonte aparecem aqui em vez de serem engolidas: uma
              referência SMT em falta muda o resultado do passo 5. */}
          <Linha
            k="Fontes em falta"
            v={analysis.failures.size === 0 ? 'nenhuma' : [...analysis.failures.keys()].join(', ')}
            tom={analysis.failures.size === 0 ? undefined : 'bear'}
          />
        </div>
      </section>
    </>
  );
}

/** Uma linha de `.rows`, com nota opcional por baixo do rótulo. */
function Linha({
  k,
  v,
  nota,
  tom,
}: {
  k: string;
  v: string;
  nota?: string;
  tom?: 'bull' | 'bear';
}) {
  return (
    <div>
      <span className="k">
        {k}
        {nota && (
          <span className="faint" style={{ display: 'block', fontSize: 11.5, lineHeight: 1.45 }}>
            {nota}
          </span>
        )}
      </span>
      <span className={`v ${tom === 'bull' ? 'bull-t' : tom === 'bear' ? 'bear-t' : ''}`}>{v}</span>
    </div>
  );
}

/**
 * Aba History Data — as velas, em números.
 *
 * A ordem é a INVERSA do gráfico: a mais recente em cima. Numa tabela lê-se de
 * cima para baixo e o que interessa primeiro é o que acabou de acontecer; num
 * gráfico o tempo corre para a direita. As duas convenções são opostas e ambas
 * estão certas no seu meio.
 */
function Historico({ candles, precision }: { candles: ChartCandle[]; precision: number }) {
  // 60 linhas chegam para percorrer um trimestre de diário sem despejar as 180
  // velas do gráfico numa tabela que ninguém rola até ao fim.
  const linhas = candles.slice(-60).reverse();

  if (linhas.length === 0) {
    return (
      <div className="empty">
        <strong>Sem velas para listar.</strong>
        As fontes públicas não devolveram série para este timeframe.
      </div>
    );
  }

  return (
    <section>
      <h2>
        Histórico{' '}
        <span className="h2-note">últimas {linhas.length} velas, mais recente em cima</span>
      </h2>

      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th className="num">Abertura</th>
              <th className="num">Máx</th>
              <th className="num">Mín</th>
              <th className="num">Fecho</th>
              <th className="num">Var.</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((c, i) => {
              /*
               * Variação face ao FECHO ANTERIOR, não à abertura da própria vela.
               * É a convenção de qualquer tabela de cotações — e a única que faz
               * sentido ao longo da coluna: (fecho − abertura) ignoraria os
               * saltos entre sessões, que num mercado que fecha à noite são
               * exatamente onde parte do movimento acontece.
               */
              const anterior = linhas[i + 1];
              const varPct =
                anterior && anterior.c !== 0 ? ((c.c - anterior.c) / anterior.c) * 100 : null;

              return (
                <tr key={c.t}>
                  <td>{new Date(c.t).toISOString().slice(0, 10)}</td>
                  <td className="num">{c.o.toFixed(precision)}</td>
                  <td className="num">{c.h.toFixed(precision)}</td>
                  <td className="num">{c.l.toFixed(precision)}</td>
                  <td className="num">{c.c.toFixed(precision)}</td>
                  <td className={`num ${varPct === null ? '' : varPct >= 0 ? 'bull-t' : 'bear-t'}`}>
                    {varPct === null ? '—' : `${varPct >= 0 ? '+' : ''}${varPct.toFixed(2)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="section-cap" style={{ marginTop: 12 }}>
        A tabela rola na horizontal dentro da sua caixa — a página não.
      </p>
    </section>
  );
}
