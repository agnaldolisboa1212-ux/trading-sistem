/**
 * Visões do gráfico — o que cada estratégia vê, desenhado.
 *
 * ── A QUEIXA ───────────────────────────────────────────────────────────────
 *
 * "O gráfico só mostra uma análise." Mostrava o MELHOR sinal nascido na última
 * vela fechada — e nada quando não havia. Um instrumento com zonas de procura,
 * níveis testados três vezes e um sinal de há quatro velas ainda por entrar
 * aparecia vazio. E o sinal que chegou ao telemóvel não se reencontrava no
 * gráfico, porque uma vela depois já não era "da última vela".
 *
 * ── O QUE CADA VISÃO TEM ───────────────────────────────────────────────────
 *
 *   estruturas  o que a estratégia detecta, haja sinal ou não:
 *                 oferta/procura    zonas activas (não invalidadas)
 *                 suporte/resist.   níveis por quebrar, os mais próximos
 *                 VWAP              VWAP mensal e bandas de 1σ e 2σ
 *                 perfil de volume  POC, value area (VAH–VAL)
 *   sinal       o mais recente dessa estratégia, com o que lhe aconteceu
 *               desde então: à espera da entrada, em curso, alvo, stop
 *
 * ── SINAIS SÓ DAS ESTRATÉGIAS VALIDADAS ───────────────────────────────────
 *
 * Os planos (entrada, stop, alvos) vêm das três estratégias com vantagem
 * medida (`strategies/validadas.ts`): compra na banda −2σ do VWAP e RSI(2) nos
 * índices, tendência de 55 dias na cripto. Oferta/procura, suporte/resistência
 * e perfil de volume continuam desenhados como CONTEXTO, mas não geram planos:
 * no backtest perdiam dinheiro depois do spread.
 *
 * Tudo sai das mesmas funções que o motor usa (`@trading/core`), sobre as
 * mesmas velas da Deriv. Função pura: sem rede nem relógio, calculada uma vez
 * por vela fechada.
 */

import {
  activeZonesAt,
  assessConfluence,
  buildVolumeProfile,
  computeAnchoredVwap,
  detectSupplyDemandZones,
  detectSupportResistanceLevels,
  estrategiasPara,
  estrategiaActiva,
  executarEstrategiasValidadas,
  rsiSerie,
  temEstrategiaEmTeste,
  temEstrategiaValidada,
  type Candle,
  type ConfluenceReport,
  type StrategyId,
  type StrategySignal,
  type Timeframe,
} from '@trading/core';

export type VisaoInstitucional = StrategyId | 'connors-rsi2-indices' | 'tendencia-cripto' | 'smt';
export type VisaoId = 'resumo' | VisaoInstitucional | 'mmxm';

export const VISOES: ReadonlyArray<{ id: VisaoId; nome: string; curto: string; contexto?: boolean }> = [
  { id: 'resumo', nome: 'Resumo', curto: 'Resumo' },
  { id: 'vwap-bands', nome: 'VWAP −2σ (índices)', curto: 'VWAP' },
  { id: 'connors-rsi2-indices', nome: 'RSI(2) de Connors (índices)', curto: 'RSI(2)' },
  { id: 'tendencia-cripto', nome: 'Tendência 55 dias', curto: 'Tendência' },
  { id: 'supply-demand', nome: 'Oferta e procura', curto: 'Oferta/procura', contexto: true },
  { id: 'support-resistance', nome: 'Suporte e resistência', curto: 'S/R', contexto: true },
  { id: 'volume-profile', nome: 'Perfil de volume', curto: 'Perfil', contexto: true },
  { id: 'mmxm', nome: 'MMXM + SMT', curto: 'MMXM', contexto: true },
  { id: 'smt', nome: 'Divergência SMT (análise)', curto: 'SMT', contexto: true },
];

/** Aviso das visões que só mostram contexto. */
export const NOTA_CONTEXTO =
  'Só contexto: esta leitura não gera sinais. No backtest com spread perdia dinheiro, por isso saiu dos sinais.';

export function nomeVisao(id: string): string {
  return estrategiaActiva(id)?.nome ?? VISOES.find((v) => v.id === id)?.nome ?? id;
}

/** Visão de cada estratégia validada (a do VWAP vive na visão das bandas). */
const VISAO_DA_ESTRATEGIA: Record<string, VisaoId> = {
  'compra-vwap-indices': 'vwap-bands',
  'connors-rsi2-indices': 'connors-rsi2-indices',
  'tendencia-cripto': 'tendencia-cripto',
  'tendencia-ouro': 'tendencia-cripto',
  'tendencia-indices': 'tendencia-cripto',
  'tendencia-baixa-cripto': 'tendencia-cripto',
  // O VWAP no forex/ouro partilha a mesma visão (bandas).
  'vwap-forex-teste': 'vwap-bands',
  'rompimento-4h': 'resumo',
};

export function visaoValida(bruto: string | null | undefined): VisaoId {
  const id = bruto ? (VISAO_DA_ESTRATEGIA[bruto] ?? bruto) : null;
  return (VISOES.find((v) => v.id === id)?.id ?? 'resumo') as VisaoId;
}

// ---------------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------------

export interface ZonaDesenho {
  /** Tempo (ms) em que a zona começa a existir. */
  de: number;
  /** Tempo em que deixa de valer; `Infinity` = até ao presente. */
  ate: number;
  topo: number;
  base: number;
  /** 'bull' | 'bear' | 'neutro' | 'entrada' */
  tipo: string;
  rotulo?: string;
}

export interface LinhaDesenho {
  preco: number;
  rotulo: string;
  /** 'entrada' | 'stop' | 'alvo' | 'poc' | 'nivel' */
  tipo: string;
}

export interface CurvaDesenho {
  pontos: Array<{ t: number; p: number }>;
  /** 'vwap' | 'banda1' | 'banda2' */
  tipo: string;
  rotulo?: string;
}

export interface Desenho {
  zonas: ZonaDesenho[];
  linhas: LinhaDesenho[];
  curvas: CurvaDesenho[];
}

export const DESENHO_VAZIO: Desenho = { zonas: [], linhas: [], curvas: [] };

// ---------------------------------------------------------------------------
// Sinais e o que lhes aconteceu
// ---------------------------------------------------------------------------

export type EstadoSinal =
  | 'activo'
  | 'a-aguardar-entrada'
  | 'em-curso'
  | 'alvo-atingido'
  | 'stop-atingido'
  | 'perdido';

export const ROTULO_ESTADO: Record<EstadoSinal, string> = {
  activo: 'nasceu na última vela',
  'a-aguardar-entrada': 'à espera da entrada',
  'em-curso': 'entrada tocada, em curso',
  'alvo-atingido': 'chegou ao primeiro alvo',
  'stop-atingido': 'bateu no stop',
  perdido: 'foi para o alvo sem tocar na entrada',
};

/** Estados em que o plano ainda pode ser seguido. */
export function sinalVivo(e: EstadoSinal): boolean {
  return e === 'activo' || e === 'a-aguardar-entrada' || e === 'em-curso';
}

export interface SinalVisao {
  sinal: StrategySignal;
  /** 0 = nasceu na última vela fechada. */
  velasAtras: number;
  estado: EstadoSinal;
}

/**
 * O que aconteceu ao plano nas velas seguintes.
 *
 * Numa vela que toca o stop e o alvo ao mesmo tempo não se sabe a ordem; conta
 * como stop — é a leitura que não inventa um ganho.
 */
export function estadoDoSinal(s: StrategySignal, candles: readonly Candle[]): EstadoSinal {
  const depois = candles.slice(s.index + 1);
  if (depois.length === 0) return 'activo';
  const compra = s.direction === 'bullish';
  const alvo = s.targets[0]?.price;
  let entrou = false;

  for (const c of depois) {
    if (!entrou && c.low <= s.entryPrice && c.high >= s.entryPrice) entrou = true;
    const stop = compra ? c.low <= s.stopLoss : c.high >= s.stopLoss;
    if (stop) return 'stop-atingido';
    const chegou = alvo !== undefined && (compra ? c.high >= alvo : c.low <= alvo);
    if (chegou) return entrou ? 'alvo-atingido' : 'perdido';
  }
  return entrou ? 'em-curso' : 'a-aguardar-entrada';
}

/** Velas para trás em que se procuram sinais. */
export const RECENTE_VELAS = 40;

/**
 * Sinais de cada uma das últimas velas fechadas.
 *
 * As estratégias só avaliam a ÚLTIMA vela da série que recebem. Para saber o
 * que disseram há dez velas é preciso corrê-las sobre a série como ela era
 * nesse momento — é o que o motor fez quando mandou o aviso. Uma vela fechada
 * não muda, por isso cada resposta fica guardada pelo tempo da vela: na
 * primeira vez correm-se 40 passagens (~0,1 s), depois só a da vela nova.
 *
 * Os índices dos sinais guardados referem-se à série de então; quem os usa
 * recalcula-os pelo tempo (`generatedAt`), porque a janela de 300 velas anda.
 */
const memoria = new Map<string, Map<number, { sinais: StrategySignal[]; avisos: string[] }>>();

function sinaisPorVela(
  lista: Candle[],
  simbolo: string,
  timeframe: Timeframe,
): { sinais: StrategySignal[]; avisosUltima: string[] } {
  const chave = `${simbolo}|${timeframe}`;
  let porTempo = memoria.get(chave);
  if (!porTempo) {
    if (memoria.size > 40) memoria.clear();
    porTempo = new Map();
    memoria.set(chave, porTempo);
  }

  const ultimo = lista.length - 1;
  const sinais: StrategySignal[] = [];
  let avisosUltima: string[] = [];
  for (let i = Math.max(59, ultimo - RECENTE_VELAS + 1); i <= ultimo; i++) {
    const tempo = lista[i]!.time;
    let r = porTempo.get(tempo);
    if (!r) {
      // As mesmas regras que o motor usa para anunciar — só as validadas.
      r = {
        sinais: executarEstrategiasValidadas(lista.slice(0, i + 1), { symbol: simbolo, timeframe }),
        avisos: [],
      };
      porTempo.set(tempo, r);
    }
    for (const s of r.sinais) sinais.push({ ...s, index: i });
    if (i === ultimo) avisosUltima = r.avisos;
  }
  // Tempos que já saíram da janela não voltam.
  if (porTempo.size > RECENTE_VELAS * 3) {
    const limite = lista[Math.max(0, ultimo - RECENTE_VELAS)]!.time;
    for (const t of porTempo.keys()) if (t < limite) porTempo.delete(t);
  }
  return { sinais, avisosUltima };
}

function maisRecente(sinais: readonly StrategySignal[], candles: readonly Candle[]): SinalVisao | null {
  const ultimo = candles.length - 1;
  const s = [...sinais].sort((a, b) => b.index - a.index || b.conviction - a.conviction)[0];
  if (!s) return null;
  return { sinal: s, velasAtras: ultimo - s.index, estado: estadoDoSinal(s, candles) };
}

export function linhasDoSinal(sv: SinalVisao, nome: string): Desenho {
  const s = sv.sinal;
  return {
    zonas: [
      {
        de: s.generatedAt,
        ate: Infinity,
        topo: s.entryZoneHigh,
        base: s.entryZoneLow,
        tipo: 'entrada',
      },
    ],
    linhas: [
      { preco: s.entryPrice, rotulo: `entrada · ${nome}`, tipo: 'entrada' },
      { preco: s.stopLoss, rotulo: 'stop', tipo: 'stop' },
      ...s.targets.slice(0, 3).map((t, i) => ({
        preco: t.price,
        rotulo: `TP${i + 1} · ${t.rMultiple.toFixed(1)}R`,
        tipo: 'alvo',
      })),
    ],
    curvas: [],
  };
}

function juntar(...partes: Desenho[]): Desenho {
  return {
    zonas: partes.flatMap((p) => p.zonas),
    linhas: partes.flatMap((p) => p.linhas),
    curvas: partes.flatMap((p) => p.curvas),
  };
}

// ---------------------------------------------------------------------------
// Visões
// ---------------------------------------------------------------------------

export interface Estrutura {
  rotulo: string;
  baixo: number;
  alto?: number;
  tipo: 'bull' | 'bear' | 'neutro';
}

export interface Visao {
  id: VisaoId;
  nome: string;
  desenho: Desenho;
  sinal: SinalVisao | null;
  estruturas: Estrutura[];
  nota?: string;
}

export interface AnaliseVisoes {
  velas: number;
  /** Visões institucionais; a do MMXM vem do servidor. */
  visoes: Record<'resumo' | VisaoInstitucional, Visao>;
  /** Este instrumento e timeframe têm estratégia validada (logo, podem dar sinal)? */
  comSinais: boolean;
  /** Sinais nascidos na última vela, por estratégia. */
  confluencia: ConfluenceReport;
  avisos: string[];
}

const PROXIMAS = 6;

export function analisarVisoes(
  candles: readonly Candle[],
  simbolo: string,
  timeframe: Timeframe,
): AnaliseVisoes {
  const lista = candles as Candle[];
  const ultimo = lista.length - 1;
  const preco = lista[ultimo]?.close ?? 0;
  const tempoDe = (i: number) => lista[Math.max(0, Math.min(ultimo, i))]?.time ?? 0;
  const perto = (a: { baixo: number; alto?: number }) =>
    Math.abs((a.baixo + (a.alto ?? a.baixo)) / 2 - preco);

  const historico = sinaisPorVela(lista, simbolo, timeframe);
  const sinalDe = (id: string) =>
    maisRecente(historico.sinais.filter((s) => s.strategy === id), lista);
  // Desenha sempre o sinal mais recente dessa estratégia, vivo ou já
  // terminado — `sinalDe` já escolhe só um; sem isto, um alvo ou stop
  // atingido fazia o gráfico voltar a "sem sinal" como se nada tivesse
  // acontecido.
  const desenhoDoSinal = (sv: SinalVisao | null, id: string) => (sv ? linhasDoSinal(sv, nomeVisao(id)) : DESENHO_VAZIO);
  const fechos = lista.map((c) => c.close);
  const media = (periodo: number) =>
    fechos.map((_, i) => {
      if (i + 1 < periodo) return Number.NaN;
      let soma = 0;
      for (let k = i - periodo + 1; k <= i; k++) soma += fechos[k]!;
      return soma / periodo;
    });
  const curvaDe = (valores: number[], tipo: string, rotulo: string, desde = 0): CurvaDesenho => ({
    tipo,
    rotulo,
    pontos: valores
      .map((p, i) => ({ t: lista[i]!.time, p }))
      .filter((x, i) => i >= desde && Number.isFinite(x.p)),
  });

  // --- oferta e procura ---------------------------------------------------
  const zonas = activeZonesAt(detectSupplyDemandZones(lista), ultimo)
    .map((z) => ({ z, baixo: z.zoneLow, alto: z.zoneHigh }))
    .sort((a, b) => perto(a) - perto(b))
    .slice(0, PROXIMAS);
  const sd = null;
  const ofertaProcura: Visao = {
    id: 'supply-demand',
    nome: nomeVisao('supply-demand'),
    sinal: sd,
    desenho: juntar(
      {
        zonas: zonas.map(({ z }) => ({
          de: tempoDe(z.baseStartIndex),
          ate: Infinity,
          topo: z.zoneHigh,
          base: z.zoneLow,
          tipo: z.direction === 'bullish' ? 'bull' : 'bear',
          rotulo: `${z.direction === 'bullish' ? 'procura' : 'oferta'} · ${z.tests} teste${z.tests === 1 ? '' : 's'}`,
        })),
        linhas: [],
        curvas: [],
      },
      desenhoDoSinal(sd, 'supply-demand'),
    ),
    estruturas: zonas.map(({ z }) => ({
      rotulo: `${z.direction === 'bullish' ? 'Procura' : 'Oferta'} · ${z.pattern.split('-').map((p) => p[0]!.toUpperCase()).join('')} · ${z.tests} teste${z.tests === 1 ? '' : 's'}`,
      baixo: z.zoneLow,
      alto: z.zoneHigh,
      tipo: z.direction === 'bullish' ? 'bull' : 'bear',
    })),
    nota: `${NOTA_CONTEXTO}${zonas.length === 0 ? ' Sem zonas activas: todas as detectadas já foram atravessadas.' : ''}`,
  };

  // --- suporte e resistência ----------------------------------------------
  const niveis = detectSupportResistanceLevels(lista)
    .filter((l) => l.brokenAtIndex === null || l.kind === 'flip')
    .map((l) => ({ l, baixo: l.zoneLow, alto: l.zoneHigh }))
    .sort((a, b) => perto(a) - perto(b))
    .slice(0, PROXIMAS);
  const sr = null;
  const tipoNivel = (preco_: number, kind: string): Estrutura['tipo'] =>
    kind === 'flip' ? 'neutro' : preco_ < preco ? 'bull' : 'bear';
  const suporteResistencia: Visao = {
    id: 'support-resistance',
    nome: nomeVisao('support-resistance'),
    sinal: sr,
    desenho: juntar(
      {
        zonas: niveis.map(({ l }) => ({
          de: tempoDe(l.memberIndices[0] ?? 0),
          ate: Infinity,
          topo: l.zoneHigh,
          base: l.zoneLow,
          tipo: tipoNivel(l.price, l.kind),
          rotulo: `${l.price < preco ? 'suporte' : 'resistência'}${l.kind === 'flip' ? ' (inverteu)' : ''} · ${l.touches} toques`,
        })),
        linhas: [],
        curvas: [],
      },
      desenhoDoSinal(sr, 'support-resistance'),
    ),
    estruturas: niveis.map(({ l }) => ({
      rotulo: `${l.price < preco ? 'Suporte' : 'Resistência'}${l.kind === 'flip' ? ' invertido' : ''} · ${l.touches} toques${l.roundNumberIncrement ? ' · número redondo' : ''}`,
      baixo: l.zoneLow,
      alto: l.zoneHigh,
      tipo: tipoNivel(l.price, l.kind),
    })),
    nota: `${NOTA_CONTEXTO}${niveis.length === 0 ? ' Sem níveis por quebrar nesta janela.' : ''}`,
  };

  // --- VWAP -----------------------------------------------------------------
  // A âncora mensal é a que a estratégia usa (`planVwapTrades`).
  const vwap = computeAnchoredVwap(lista, { anchor: 'month' });
  const pontos = vwap.points.filter((p) => p.samples >= 10);
  const curva = (tipo: string, f: (p: (typeof pontos)[number]) => number, rotulo?: string): CurvaDesenho => ({
    tipo,
    rotulo,
    pontos: pontos.map((p) => ({ t: p.time, p: f(p) })),
  });
  const ultimoVwap = vwap.points[vwap.points.length - 1];
  const indicesValidos = estrategiasPara(simbolo, timeframe).some((e) => e.id === 'compra-vwap-indices');
  const forexEmTeste = estrategiasPara(simbolo, timeframe).some((e) => e.id === 'vwap-forex-teste');
  const vw = sinalDe('compra-vwap-indices') ?? sinalDe('vwap-forex-teste');
  const vwapVisao: Visao = {
    id: 'vwap-bands',
    nome: nomeVisao('vwap-bands'),
    sinal: vw,
    desenho: juntar(
      {
        zonas: [],
        linhas: [],
        curvas: [
          curva('banda2', (p) => p.upper2, '+2σ'),
          curva('banda1', (p) => p.upper1, '+1σ'),
          curva('vwap', (p) => p.vwap, 'VWAP'),
          curva('banda1', (p) => p.lower1, '−1σ'),
          curva('banda2', (p) => p.lower2, '−2σ'),
        ],
      },
      desenhoDoSinal(vw, vw?.sinal.strategy ?? 'compra-vwap-indices'),
    ),
    estruturas: ultimoVwap
      ? [
          { rotulo: 'Banda +2σ', baixo: ultimoVwap.upper2, tipo: 'bear' },
          { rotulo: 'Banda +1σ', baixo: ultimoVwap.upper1, tipo: 'bear' },
          { rotulo: 'VWAP do mês', baixo: ultimoVwap.vwap, tipo: 'neutro' },
          { rotulo: 'Banda −1σ', baixo: ultimoVwap.lower1, tipo: 'bull' },
          { rotulo: 'Banda −2σ', baixo: ultimoVwap.lower2, tipo: 'bull' },
        ]
      : [],
    nota: [
      indicesValidos
        ? 'Sinal: fecho abaixo de −2σ com RSI(14) < 30 ou σ do mês > 2 ATR. Só compras — as vendas não têm vantagem medida.'
        : forexEmTeste
          ? 'EM TESTE ao vivo (revisão em 1 semana): fecho a ±2σ do VWAP do mês com RSI(14) em extremo, nos dois sentidos. Sem taxa de acerto medida ainda.'
          : 'A compra na banda −2σ só está validada em US100, SP500, US30 e GER30, em 1h e 4h. Aqui as bandas são contexto.',
      vwap.usedVolume ? null : 'A Deriv não entrega volume: é a média ponderada pelo tempo (TWAP).',
    ]
      .filter(Boolean)
      .join(' '),
  };

  // --- perfil de volume -----------------------------------------------------
  const perfil = buildVolumeProfile(lista);
  const vp = null;
  const temPerfil = perfil.bins.length > 0 && Number.isFinite(perfil.poc);
  const perfilVisao: Visao = {
    id: 'volume-profile',
    nome: nomeVisao('volume-profile'),
    sinal: vp,
    desenho: juntar(
      temPerfil
        ? {
            zonas: [
              {
                de: tempoDe(perfil.fromIndex),
                ate: Infinity,
                topo: perfil.vah,
                base: perfil.val,
                tipo: 'neutro',
                rotulo: 'value area (70%)',
              },
            ],
            linhas: [
              { preco: perfil.poc, rotulo: 'POC', tipo: 'poc' },
              { preco: perfil.vah, rotulo: 'VAH', tipo: 'nivel' },
              { preco: perfil.val, rotulo: 'VAL', tipo: 'nivel' },
            ],
            curvas: [],
          }
        : DESENHO_VAZIO,
      desenhoDoSinal(vp, 'volume-profile'),
    ),
    estruturas: temPerfil
      ? [
          { rotulo: 'VAH — topo da value area', baixo: perfil.vah, tipo: 'bear' },
          { rotulo: 'POC — preço mais negociado', baixo: perfil.poc, tipo: 'neutro' },
          { rotulo: 'VAL — base da value area', baixo: perfil.val, tipo: 'bull' },
        ]
      : [],
    nota: [
      NOTA_CONTEXTO,
      perfil.shape === 'bimodal' ? 'Perfil com dois modos: houve dois leilões distintos na janela.' : null,
      perfil.usedVolume ? null : 'Sem volume da Deriv: perfil por tempo (TPO).',
    ]
      .filter(Boolean)
      .join(' ') || undefined,
  };

  // --- RSI(2) de Connors -----------------------------------------------------
  const cn = sinalDe('connors-rsi2-indices');
  const sma200 = media(200);
  const sma5 = media(5);
  const rsi2 = rsiSerie(lista, 2);
  const connorsValida = estrategiasPara(simbolo, timeframe).some((e) => e.id === 'connors-rsi2-indices');
  const desde = Math.max(0, ultimo - 150);
  const connorsVisao: Visao = {
    id: 'connors-rsi2-indices',
    nome: nomeVisao('connors-rsi2-indices'),
    sinal: cn,
    desenho: juntar(
      {
        zonas: [],
        linhas: [],
        curvas: [curvaDe(sma200, 'vwap', 'média 200', desde), curvaDe(sma5, 'banda1', 'média 5', desde)],
      },
      desenhoDoSinal(cn, 'connors-rsi2-indices'),
    ),
    estruturas: [
      ...(Number.isFinite(sma200[ultimo]) ? [{ rotulo: 'Média de 200 (tendência de fundo)', baixo: sma200[ultimo]!, tipo: 'neutro' as const }] : []),
      ...(Number.isFinite(sma5[ultimo]) ? [{ rotulo: 'Média de 5 (saída)', baixo: sma5[ultimo]!, tipo: 'bear' as const }] : []),
      ...(Number.isFinite(rsi2[ultimo]) ? [{ rotulo: 'RSI(2) agora — compra abaixo de 10', baixo: Math.round(rsi2[ultimo]! * 10) / 10, tipo: (rsi2[ultimo]! < 10 ? 'bull' : 'neutro') as Estrutura['tipo'] }] : []),
    ],
    nota: connorsValida
      ? 'Sinal: fecho acima da média de 200 com RSI(2) < 10. Sai no primeiro fecho acima da média de 5.'
      : 'Esta regra só está validada no diário (1D) de US100, SP500, US30 e GER30. Aqui é contexto.',
  };

  // --- tendência de 55 dias ----------------------------------------------------
  const tc =
    sinalDe('tendencia-cripto') ??
    sinalDe('tendencia-ouro') ??
    sinalDe('tendencia-indices') ??
    sinalDe('tendencia-baixa-cripto');
  const maximo55 = lista.map((_, i) => {
    if (i < 55) return Number.NaN;
    let m = -Infinity;
    for (let k = i - 55; k < i; k++) m = Math.max(m, lista[k]!.high);
    return m;
  });
  const minimo20 = lista.map((_, i) => {
    if (i < 19) return Number.NaN;
    let m = Infinity;
    for (let k = i - 19; k <= i; k++) m = Math.min(m, lista[k]!.low);
    return m;
  });
  // Espelho da compra, para a venda em teste: rompimento do mínimo, saída no máximo.
  const minimo55 = lista.map((_, i) => {
    if (i < 55) return Number.NaN;
    let m = Infinity;
    for (let k = i - 55; k < i; k++) m = Math.min(m, lista[k]!.low);
    return m;
  });
  const maximo20 = lista.map((_, i) => {
    if (i < 19) return Number.NaN;
    let m = -Infinity;
    for (let k = i - 19; k <= i; k++) m = Math.max(m, lista[k]!.high);
    return m;
  });
  const estrategiasTendencia = estrategiasPara(simbolo, timeframe).filter((e) =>
    ['tendencia-cripto', 'tendencia-ouro', 'tendencia-indices', 'tendencia-baixa-cripto'].includes(e.id),
  );
  const tendenciaValida = estrategiasTendencia.some((e) => !('emTeste' in e));
  const baixaEmTeste = estrategiasTendencia.some((e) => e.id === 'tendencia-baixa-cripto');
  const tendenciaVisao: Visao = {
    id: 'tendencia-cripto',
    nome: nomeVisao('tendencia-cripto'),
    sinal: tc,
    desenho: juntar(
      {
        zonas: [],
        linhas: [],
        curvas: [
          curvaDe(maximo55, 'banda2', 'máximo 55', desde),
          curvaDe(minimo20, 'banda1', 'mínimo 20', desde),
          ...(baixaEmTeste
            ? [curvaDe(minimo55, 'banda2', 'mínimo 55', desde), curvaDe(maximo20, 'banda1', 'máximo 20', desde)]
            : []),
        ],
      },
      desenhoDoSinal(tc, tc?.sinal.strategy ?? 'tendencia-cripto'),
    ),
    estruturas: [
      ...(Number.isFinite(maximo55[ultimo]) ? [{ rotulo: 'Máximo de 55 — compra no fecho acima', baixo: maximo55[ultimo]!, tipo: 'bull' as const }] : []),
      ...(Number.isFinite(minimo20[ultimo]) ? [{ rotulo: 'Mínimo de 20 — saída / stop móvel (compra)', baixo: minimo20[ultimo]!, tipo: 'bear' as const }] : []),
      ...(baixaEmTeste && Number.isFinite(minimo55[ultimo])
        ? [{ rotulo: 'Mínimo de 55 — venda no fecho abaixo (em teste)', baixo: minimo55[ultimo]!, tipo: 'bear' as const }]
        : []),
      ...(baixaEmTeste && Number.isFinite(maximo20[ultimo])
        ? [{ rotulo: 'Máximo de 20 — saída / stop móvel (venda)', baixo: maximo20[ultimo]!, tipo: 'bull' as const }]
        : []),
    ],
    nota: tendenciaValida
      ? `Sinal: fecho acima do máximo dos 55 dias anteriores. Sem alvo fixo: sai quando perde o mínimo de 20 dias.${baixaEmTeste ? ' Em teste: também vende no fecho abaixo do mínimo de 55 dias, abaixo da média de 200.' : ''}`
      : baixaEmTeste
        ? 'Em teste: vende no fecho abaixo do mínimo dos 55 dias anteriores, abaixo da média de 200 — sem taxa de acerto medida ainda.'
        : 'Esta regra só está validada no diário (1D) de BTCUSD, ETHUSD e XAUUSD. Aqui é contexto.',
  };

  // --- resumo ---------------------------------------------------------------
  const activos = historico.sinais.filter((s) => s.index === ultimo);
  const confluencia = assessConfluence(activos);
  const comSinais = estrategiasPara(simbolo, timeframe).length > 0;
  const todos = [vw, cn, tc].filter((x): x is SinalVisao => x !== null);
  const candidatos = todos.filter((x) => sinalVivo(x.estado));
  // Primeiro os da última vela (salvo conflito), depois os mais recentes ainda vivos.
  const vivo =
    candidatos
      .filter((c) => c.velasAtras === 0 && confluencia.direction !== 'conflicted')
      .sort((a, b) => b.sinal.conviction - a.sinal.conviction)[0] ??
    candidatos.filter((c) => c.velasAtras > 0).sort((a, b) => a.velasAtras - b.velasAtras)[0] ??
    null;
  // Sem plano vivo: mostra o último sinal executado (alvo, stop ou saída da
  // regra) em vez de nada — é a referência de "o que aconteceu da última vez",
  // não uma entrada por tomar. `CartaoSinal` já sabe distinguir os dois (a
  // classe `vivo` some quando o estado terminou).
  const melhor = vivo ?? [...todos].sort((a, b) => a.velasAtras - b.velasAtras)[0] ?? null;
  const resumo: Visao = {
    id: 'resumo',
    nome: 'Resumo',
    sinal: melhor,
    desenho: melhor ? linhasDoSinal(melhor, nomeVisao(melhor.sinal.strategy)) : DESENHO_VAZIO,
    estruturas: [],
    nota: !comSinais
      ? temEstrategiaValidada(simbolo) || temEstrategiaEmTeste(simbolo)
        ? `Neste timeframe não há estratégia activa para ${simbolo}. Veja ${estrategiasDoSimbolo(simbolo)}.`
        : `${simbolo} não tem nenhuma estratégia com vantagem medida, nem em teste — o sistema não gera sinais aqui. As visões mostram só contexto.`
      : confluencia.direction === 'conflicted'
        ? 'Na última vela as estratégias apontaram em sentidos opostos — nenhuma prevalece.'
        : undefined,
  };

  /*
   * Divergência SMT: análise, já não estratégia.
   *
   * A regra `smt-teste` foi retirada em 22/09/2026 — no backtest de 2022–2026 o
   * SMT isolado não teve vantagem em nenhum par intradiário. A LEITURA fica:
   * é uma das peças do MMXM e ajuda a ver quando um par varre liquidez e o
   * correlacionado não acompanha. Não gera sinais.
   */
  const smtVisao: Visao = {
    id: 'smt',
    nome: nomeVisao('smt'),
    sinal: null,
    desenho: DESENHO_VAZIO, // tem um componente próprio de desenho (GraficoSmt)
    estruturas: [],
    nota: NOTA_CONTEXTO + ' O gráfico da divergência desenha-se na vista própria em baixo.',
  };

  return {
    velas: lista.length,
    visoes: {
      resumo,
      'supply-demand': ofertaProcura,
      'support-resistance': suporteResistencia,
      'vwap-bands': vwapVisao,
      'volume-profile': perfilVisao,
      'connors-rsi2-indices': connorsVisao,
      'tendencia-cripto': tendenciaVisao,
      smt: smtVisao,
    },
    comSinais,
    confluencia,
    avisos: historico.avisosUltima,
  };
}

/** "1H e 4H" — os timeframes validados de um instrumento, para as notas. */
function estrategiasDoSimbolo(simbolo: string): string {
  const tfs = new Set<string>();
  for (const tf of ['15m', '30m', '1h', '4h', '1d']) if (estrategiasPara(simbolo, tf).length > 0) tfs.add(tf.toUpperCase());
  return [...tfs].join(' e ');
}
