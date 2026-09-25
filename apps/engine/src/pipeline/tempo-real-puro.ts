// @ts-nocheck
/**
 * Partes PURAS do motor de tempo real — sem rede, sem ficheiros, sem relógio.
 *
 * Separadas para poderem ser testadas. São exactamente as decisões que, se
 * erradas, produzem os piores defeitos do motor: um sinal anunciado três vezes,
 * um sinal gerado sobre uma vela ainda aberta, uma lista de vigilância vazia.
 */

import type { Candle } from '@trading/core';

/** Granularidades que a Deriv aceita, em segundos, por timeframe. */
export const GRANULARIDADE_S: Readonly<Record<string, number>> = Object.freeze({
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
});

/**
 * Remove a última vela se ainda não fechou.
 *
 * A Deriv devolve a vela em formação no fim do histórico. Uma zona detectada
 * sobre ela desaparece no tick seguinte — e um sinal anunciado sobre ela é um
 * sinal que deixa de existir enquanto a pessoa ainda está a ler a notificação.
 */
export function cortarVelaAberta(
  velas: readonly Candle[],
  granularidadeS: number,
  agora: number,
): Candle[] {
  const ultima = velas[velas.length - 1];
  if (!ultima) return [];
  return agora < ultima.time + granularidadeS * 1000 ? velas.slice(0, -1) : [...velas];
}

/**
 * O mercado parou? (fim de semana, bolsa fechada, feriado)
 *
 * Mede a distância entre o FECHO da última vela e agora. Mais de três velas de
 * silêncio num instrumento que não negoceia 24/7 quer dizer que o histórico
 * acabou há bocado — e um sinal sobre ele seria sobre sexta-feira, anunciado
 * como se fosse de agora.
 */
export function mercadoParado(
  ultimaAbertura: number,
  granularidadeS: number,
  agora: number,
  continuo: boolean,
): boolean {
  if (continuo) return false;
  const fecho = ultimaAbertura + granularidadeS * 1000;
  return agora - fecho > granularidadeS * 1000 * 3;
}

/**
 * O sinal ainda é notícia?
 *
 * Mede desde o FECHO da vela. Com o motor a correr, um sinal sai 1 a 30
 * segundos depois (medido no Supabase). Mais do que isto só acontece quando o
 * motor esteve parado — o alojamento pode parar a aplicação sem visitas — e a
 * primeira passagem ao acordar anunciaria como novo um sinal de há quase uma
 * hora, com o preço já longe da entrada.
 *
 * Limite: meia vela, e nunca mais de 10 minutos (15m → 7,5 min; 1h → 10 min).
 * Em 4h e 1D o plano vale horas — uma operação diária que se perde porque o
 * alojamento reiniciou a app às 00:15 é um sinal inteiro deitado fora. Aí o
 * limite é um quarto da vela, até 6 horas (4h → 1 h; 1D → 6 h); o preço actual
 * continua a ser verificado antes do anúncio (`avaliarPrecoActual`).
 */
export function sinalFresco(aberturaVela: number, granularidadeS: number, agora: number): boolean {
  const fecho = aberturaVela + granularidadeS * 1000;
  const vela = granularidadeS * 1000;
  const limite = granularidadeS >= 14_400 ? Math.min(6 * 3_600_000, vela / 4) : Math.min(10 * 60_000, vela / 2);
  return agora - fecho <= limite;
}

/**
 * Quanto tempo o serviço de push pode segurar o aviso antes de desistir, em
 * segundos. Por omissão são 4 semanas: um telemóvel sem rede recebia de manhã o
 * sinal de 15 minutos da noite anterior. Meia vela, entre 5 e 30 minutos.
 */
export function validadeAvisoS(granularidadeS: number): number {
  return Math.max(300, Math.min(1800, Math.round(granularidadeS / 2)));
}

export type EstadoPreco = 'na-entrada' | 'a-aguardar' | 'melhor-que-entrada' | 'passou' | 'invalidado';

export interface AvaliacaoPreco {
  estado: EstadoPreco;
  /** Só `passou` e `invalidado` impedem o anúncio. */
  anunciar: boolean;
  /** Distância do preço à entrada em unidades de risco; positivo = a favor. */
  distanciaR: number;
  /** Fracção do caminho entrada → primeiro alvo já percorrida (0..1+). */
  progresso: number;
}

/**
 * A partir desta distância da entrada, em R, a entrada perdeu-se.
 *
 * Era "metade do caminho até ao primeiro alvo" — e isso variava com o alvo: ao
 * passar o rompimento de 4h de 2R para 3R, a tolerância saltou de 1R para 1,5R
 * sem ninguém pedir. Passa a ser uma distância ABSOLUTA em R, que não depende da
 * geometria da estratégia.
 *
 * O valor vem de medir o custo de entrar atrasado no rompimento de 4h (1336
 * operações, stop e alvo fixos no plano original):
 *
 *   no preço do plano  +0,232R
 *   +0,15R             +0,170R   perde 27%
 *   +0,25R             +0,140R   perde 40%
 *   +0,50R             +0,101R   perde 57%
 *   +1,00R             +0,080R   perde 66%
 *
 * Continua positivo mais além, mas a meio R já se deitou fora mais de metade da
 * vantagem — e o stop é o mesmo, portanto arrisca-se igual por metade do prémio.
 */
export const DISTANCIA_MAXIMA_R = 0.5;
/** Até esta distância (em R) o preço conta como estando na entrada. */
export const TOLERANCIA_ENTRADA_R = 0.15;

/**
 * Onde está o preço AGORA em relação ao plano do sinal.
 *
 * A queixa: "os sinais chegam e o preço já está avançado em relação à entrada".
 * O plano é calculado no fecho da vela; muitas entradas são no RETESTE de um
 * nível, abaixo do preço de fecho numa compra. Quem recebe o aviso precisa de
 * saber de que lado está o preço, e há dois casos em que avisar não serve:
 *
 *   invalidado  o preço já tocou no stop
 *   passou      já fez metade do caminho até ao primeiro alvo — entrar agora é
 *               outro trade, com metade do potencial e o mesmo stop
 */
export function avaliarPrecoActual(p: {
  direccao: 'bullish' | 'bearish';
  entrada: number;
  stop: number;
  /** Primeiro alvo; sem ele usa-se 2R. */
  alvo: number | null;
  actual: number;
  /**
   * Ordem pendente (limite) na entrada: o preço afastado da entrada, a favor, é
   * o normal — está à espera do regresso. Só deixa de valer se o preço já
   * chegou ao stop ou ao alvo. Sem isto os sinais pendentes do ICT ALGO eram
   * todos descartados como "o preço já passou".
   */
  pendente?: boolean;
}): AvaliacaoPreco {
  const lado = p.direccao === 'bullish' ? 1 : -1;
  const risco = Math.abs(p.entrada - p.stop);
  if (!(risco > 0) || !Number.isFinite(p.actual)) {
    return { estado: 'na-entrada', anunciar: true, distanciaR: 0, progresso: 0 };
  }

  const desvio = (p.actual - p.entrada) * lado;
  const distanciaR = desvio / risco;
  const caminho = p.alvo !== null ? (p.alvo - p.entrada) * lado : 2 * risco;
  const progresso = caminho > 0 ? desvio / caminho : 0;

  if ((p.actual - p.stop) * lado <= 0) {
    return { estado: 'invalidado', anunciar: false, distanciaR, progresso };
  }
  if (p.pendente && desvio > 0) {
    return progresso >= 1
      ? { estado: 'passou', anunciar: false, distanciaR, progresso }
      : { estado: 'a-aguardar', anunciar: true, distanciaR, progresso };
  }
  if (distanciaR >= DISTANCIA_MAXIMA_R) {
    return { estado: 'passou', anunciar: false, distanciaR, progresso };
  }
  if (Math.abs(distanciaR) <= TOLERANCIA_ENTRADA_R) {
    return { estado: 'na-entrada', anunciar: true, distanciaR, progresso };
  }
  return desvio > 0
    ? { estado: 'a-aguardar', anunciar: true, distanciaR, progresso }
    : { estado: 'melhor-que-entrada', anunciar: true, distanciaR, progresso };
}

/** Lê `INTRADAY_TIMEFRAMES`, descartando o que a Deriv não aceita. */
export function lerTimeframes(bruto: string | undefined, omissao: readonly string[]): string[] {
  const lista = (bruto ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t in GRANULARIDADE_S);
  const unicos = [...new Set(lista)];
  return unicos.length > 0 ? unicos : [...omissao];
}

/**
 * Identificador determinístico de um sinal.
 *
 * A mesma estratégia, no mesmo símbolo, timeframe e sentido, na MESMA vela, dá
 * sempre o mesmo id. O motor corre de 5 em 5 minutos; numa vela de 15 minutos
 * vê o mesmo setup três vezes. É este id que faz as três passagens contarem
 * como uma.
 */
export function idSinal(p: {
  estrategia: string;
  simbolo: string;
  timeframe: string;
  direccao: string;
  geradoEm: number;
}): string {
  return [p.estrategia, p.simbolo, p.timeframe, p.direccao, new Date(p.geradoEm).toISOString()].join(
    '|',
  );
}

export type OrigemVigilancia = 'env' | 'perfis' | 'omissao';

/**
 * Que instrumentos vigiar, por ordem de preferência:
 *
 *   1. `INTRADAY_SYMBOLS` no .env — escolha explícita de quem opera o servidor
 *   2. a união do que os utilizadores escolheram no onboarding
 *   3. uma lista por omissão
 *
 * Códigos que a Deriv não conhece são devolvidos à parte, para o relatório os
 * mostrar em vez de os deixar desaparecer.
 */
export function escolherVigilancia(input: {
  env: readonly string[];
  perfis: ReadonlyArray<readonly string[]>;
  omissao: readonly string[];
  conhecido: (codigo: string) => string | null;
}): { simbolos: string[]; origem: OrigemVigilancia; ignorados: string[] } {
  const resolver = (lista: readonly string[]) => {
    const ok: string[] = [];
    const ignorados: string[] = [];
    for (const bruto of lista) {
      const c = bruto.trim().toUpperCase();
      if (!c) continue;
      const r = input.conhecido(c);
      if (r) {
        if (!ok.includes(r)) ok.push(r);
      } else if (!ignorados.includes(c)) {
        ignorados.push(c);
      }
    }
    return { ok, ignorados };
  };

  if (input.env.length > 0) {
    const r = resolver(input.env);
    if (r.ok.length > 0) return { simbolos: r.ok, origem: 'env', ignorados: r.ignorados };
  }

  const dosPerfis = input.perfis.flat();
  if (dosPerfis.length > 0) {
    const r = resolver(dosPerfis);
    if (r.ok.length > 0) return { simbolos: r.ok, origem: 'perfis', ignorados: r.ignorados };
  }

  const r = resolver(input.omissao);
  return { simbolos: r.ok, origem: 'omissao', ignorados: r.ignorados };
}

export interface Candidato {
  estrategia: string;
  direccao: 'bullish' | 'bearish';
  conviccao: number;
}

/**
 * Um sinal por símbolo e timeframe — ou nenhum, se as estratégias discordarem.
 *
 * Quatro estratégias sobre a mesma vela podem disparar juntas. Anunciar as
 * quatro seria quatro notificações para o mesmo movimento. Escolhe-se a de
 * maior convicção e diz-se quantas concordam.
 *
 * Se apontarem para lados opostos, não se anuncia nada. As quatro são
 * transformações dos mesmos dados OHLC: votar por maioria entre medidas
 * correlacionadas fabrica convicção onde há ruído (ver `assessConfluence`).
 */
export function escolherPorConfluencia<T extends Candidato>(
  sinais: readonly T[],
): { escolhido: T | null; concordam: number; conflito: boolean } {
  if (sinais.length === 0) return { escolhido: null, concordam: 0, conflito: false };

  const altas = sinais.filter((s) => s.direccao === 'bullish');
  const baixas = sinais.filter((s) => s.direccao === 'bearish');
  if (altas.length > 0 && baixas.length > 0) {
    return { escolhido: null, concordam: 0, conflito: true };
  }

  const lado = altas.length > 0 ? altas : baixas;
  const escolhido = [...lado].sort((a, b) => b.conviccao - a.conviccao)[0] ?? null;
  return { escolhido, concordam: new Set(lado.map((s) => s.estrategia)).size, conflito: false };
}

export interface PerfilVigilancia {
  instrumentos: readonly string[];
  objetivos: readonly string[];
  /** Timeframes escolhidos nas Definições; vazio = os do objetivo. */
  timeframes?: readonly string[];
}

/**
 * Que pares instrumento × timeframe analisar.
 *
 * Por ordem de preferência:
 *
 *   1. `INTRADAY_SYMBOLS` no .env — todos esses instrumentos nos timeframes do .env
 *   2. os perfis — cada instrumento de cada pessoa nos timeframes do SEU objetivo
 *   3. a lista por omissão nos timeframes do .env
 *
 * Com perfis, `INTRADAY_TIMEFRAMES` deixa de mandar: quem escolheu intradiário e
 * swing quer 1h, 4h e 1d, não os 15m que o servidor tinha fixos. E só se analisa
 * o par que alguém quer: o EURUSD em 15m de uma pessoa não faz analisar o
 * EURUSD diário de ninguém.
 */
export function escolherPares(input: {
  envSimbolos: readonly string[];
  envTimeframes: readonly string[];
  perfis: readonly PerfilVigilancia[];
  omissao: readonly string[];
  conhecido: (codigo: string) => string | null;
  timeframesDe: (perfil: PerfilVigilancia) => readonly string[];
}): { pares: Map<string, string[]>; origem: OrigemVigilancia; ignorados: string[] } {
  const ordem = Object.keys(GRANULARIDADE_S);
  const pares = new Map<string, Set<string>>();
  const ignorados = new Set<string>();

  const juntar = (codigos: readonly string[], tfs: readonly string[]) => {
    for (const bruto of codigos) {
      const c = bruto.trim().toUpperCase();
      if (!c) continue;
      const r = input.conhecido(c);
      if (!r) {
        ignorados.add(c);
        continue;
      }
      const conjunto = pares.get(r) ?? new Set<string>();
      for (const tf of tfs) if (tf in GRANULARIDADE_S) conjunto.add(tf);
      if (conjunto.size > 0) pares.set(r, conjunto);
    }
  };
  const resultado = (origem: OrigemVigilancia) => ({
    pares: new Map(
      [...pares].map(([c, tfs]) => [c, [...tfs].sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b))]),
    ),
    origem,
    ignorados: [...ignorados],
  });

  if (input.envSimbolos.length > 0) {
    juntar(input.envSimbolos, input.envTimeframes);
    if (pares.size > 0) return resultado('env');
  }

  for (const p of input.perfis) {
    if (p.instrumentos.length === 0) continue;
    juntar(p.instrumentos, input.timeframesDe(p));
  }
  if (pares.size > 0) return resultado('perfis');

  juntar(input.omissao, input.envTimeframes);
  return resultado('omissao');
}

export interface PlanoAnterior {
  id: string;
  estrategia: string;
  direccao: 'bullish' | 'bearish';
  entrada: number;
  stop: number;
  alvo: number | null;
  /** Todos os alvos, para o acompanhamento. */
  alvos?: ReadonlyArray<{ preco: number }>;
  /** Abertura da vela que gerou o plano (ms). */
  geradoEm: number;
  /** Chaves dos eventos já avisados (Supabase). `null` sem a migração 0007. */
  avisados?: string[] | null;
  /** O acompanhamento já o deu por terminado. */
  terminado?: boolean;
}

/**
 * Anti-repintagem: que candidatos novos podem ser anunciados enquanto há planos
 * vivos (à espera da entrada ou em curso) no mesmo instrumento e timeframe.
 *
 *   mesma estratégia, qualquer sentido  → bloqueado (é o mesmo sinal a repetir-se)
 *   outra estratégia, mesmo sentido     → permitido (outra leitura a confirmar)
 *   outra estratégia, sentido oposto    → bloqueado, e devolvido como mudança de
 *                                         viés sobre o plano vivo
 */
export function filtrarRepintagem<T extends Candidato>(
  candidatos: readonly T[],
  vivos: readonly PlanoAnterior[],
): { permitidos: T[]; repetidos: T[]; contraVies: Array<{ candidato: T; plano: PlanoAnterior }> } {
  const permitidos: T[] = [];
  const repetidos: T[] = [];
  const contraVies: Array<{ candidato: T; plano: PlanoAnterior }> = [];
  for (const c of candidatos) {
    if (vivos.some((p) => p.estrategia === c.estrategia)) {
      repetidos.push(c);
      continue;
    }
    const oposto = vivos.find((p) => p.direccao !== c.direccao);
    if (oposto) {
      contraVies.push({ candidato: c, plano: oposto });
      continue;
    }
    permitidos.push(c);
  }
  return { permitidos, repetidos, contraVies };
}
