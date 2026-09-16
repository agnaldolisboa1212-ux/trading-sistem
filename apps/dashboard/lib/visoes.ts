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
  runInstitutionalStrategies,
  type Candle,
  type ConfluenceReport,
  type StrategyId,
  type StrategySignal,
  type Timeframe,
} from '@trading/core';

export type VisaoInstitucional = StrategyId;
export type VisaoId = 'resumo' | VisaoInstitucional | 'mmxm';

export const VISOES: ReadonlyArray<{ id: VisaoId; nome: string; curto: string }> = [
  { id: 'resumo', nome: 'Resumo', curto: 'Resumo' },
  { id: 'supply-demand', nome: 'Oferta e procura', curto: 'Oferta/procura' },
  { id: 'support-resistance', nome: 'Suporte e resistência', curto: 'S/R' },
  { id: 'vwap-bands', nome: 'Bandas de VWAP', curto: 'VWAP' },
  { id: 'volume-profile', nome: 'Perfil de volume', curto: 'Perfil' },
  { id: 'mmxm', nome: 'MMXM + SMT', curto: 'MMXM' },
];

export function nomeVisao(id: string): string {
  return VISOES.find((v) => v.id === id)?.nome ?? id;
}

export function visaoValida(bruto: string | null | undefined): VisaoId {
  return (VISOES.find((v) => v.id === bruto)?.id ?? 'resumo') as VisaoId;
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
      const corrida = runInstitutionalStrategies(
        { symbol: simbolo, timeframe, source: 'deriv', fidelity: 'true-ohlc', candles: lista.slice(0, i + 1) },
        { minRMultiple: 2 },
      );
      r = { sinais: corrida.signals, avisos: corrida.dataWarnings };
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

function linhasDoSinal(sv: SinalVisao, nome: string): Desenho {
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
  const sinalDe = (id: StrategyId) =>
    maisRecente(historico.sinais.filter((s) => s.strategy === id), lista);
  const desenhoDoSinal = (sv: SinalVisao | null, id: StrategyId) =>
    sv && sinalVivo(sv.estado) ? linhasDoSinal(sv, nomeVisao(id)) : DESENHO_VAZIO;

  // --- oferta e procura ---------------------------------------------------
  const zonas = activeZonesAt(detectSupplyDemandZones(lista), ultimo)
    .map((z) => ({ z, baixo: z.zoneLow, alto: z.zoneHigh }))
    .sort((a, b) => perto(a) - perto(b))
    .slice(0, PROXIMAS);
  const sd = sinalDe('supply-demand');
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
    nota: zonas.length === 0 ? 'Sem zonas activas: todas as detectadas já foram atravessadas.' : undefined,
  };

  // --- suporte e resistência ----------------------------------------------
  const niveis = detectSupportResistanceLevels(lista)
    .filter((l) => l.brokenAtIndex === null || l.kind === 'flip')
    .map((l) => ({ l, baixo: l.zoneLow, alto: l.zoneHigh }))
    .sort((a, b) => perto(a) - perto(b))
    .slice(0, PROXIMAS);
  const sr = sinalDe('support-resistance');
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
    nota: niveis.length === 0 ? 'Sem níveis por quebrar nesta janela.' : undefined,
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
  const vw = sinalDe('vwap-bands');
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
      desenhoDoSinal(vw, 'vwap-bands'),
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
    nota: vwap.usedVolume
      ? undefined
      : 'A Deriv não entrega volume: é a média ponderada pelo tempo (TWAP), não pelo volume.',
  };

  // --- perfil de volume -----------------------------------------------------
  const perfil = buildVolumeProfile(lista);
  const vp = sinalDe('volume-profile');
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
      perfil.shape === 'bimodal' ? 'Perfil com dois modos: houve dois leilões distintos na janela.' : null,
      perfil.usedVolume ? null : 'Sem volume da Deriv: perfil por tempo (TPO).',
    ]
      .filter(Boolean)
      .join(' ') || undefined,
  };

  // --- resumo ---------------------------------------------------------------
  const activos = historico.sinais.filter((s) => s.index === ultimo);
  const confluencia = assessConfluence(activos);
  const candidatos = [sd, sr, vw, vp].filter((x): x is SinalVisao => x !== null && sinalVivo(x.estado));
  // Primeiro os da última vela (salvo conflito), depois os mais recentes ainda vivos.
  const melhor =
    candidatos
      .filter((c) => c.velasAtras === 0 && confluencia.direction !== 'conflicted')
      .sort((a, b) => b.sinal.conviction - a.sinal.conviction)[0] ??
    candidatos.filter((c) => c.velasAtras > 0).sort((a, b) => a.velasAtras - b.velasAtras)[0] ??
    null;
  const resumo: Visao = {
    id: 'resumo',
    nome: 'Resumo',
    sinal: melhor,
    desenho: melhor ? linhasDoSinal(melhor, nomeVisao(melhor.sinal.strategy)) : DESENHO_VAZIO,
    estruturas: [],
    nota:
      confluencia.direction === 'conflicted'
        ? 'Na última vela as estratégias apontaram em sentidos opostos — nenhuma prevalece.'
        : undefined,
  };

  return {
    velas: lista.length,
    visoes: {
      resumo,
      'supply-demand': ofertaProcura,
      'support-resistance': suporteResistencia,
      'vwap-bands': vwapVisao,
      'volume-profile': perfilVisao,
    },
    confluencia,
    avisos: historico.avisosUltima,
  };
}
