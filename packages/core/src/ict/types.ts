/**
 * ICT ALGO — vocabulário.
 *
 * Este módulo é INDEPENDENTE do resto do sistema: não importa estratégias, não
 * partilha estado com o MMXM/SMT que já existe, e nada do que aqui está altera
 * o comportamento das regras validadas. É uma segunda opinião, com a sua própria
 * linguagem.
 *
 * ── A REGRA DE CASA QUE ATRAVESSA TODO O MÓDULO ────────────────────────────
 *
 * Quase todos os conceitos do ICT assentam em SWINGS, e um swing não existe no
 * instante em que o preço lá passa: só se sabe que aquele topo era um topo
 * depois de as velas seguintes não o ultrapassarem. Usar um swing antes disso é
 * ler o futuro — e foi exactamente esse erro que, neste projecto, fez um teste
 * de order blocks dar t=13,3 (um resultado impossível) até ser corrigido, e
 * cair para −0,044R.
 *
 * Por isso TODA a estrutura aqui carrega dois índices:
 *
 *   index         a vela onde a coisa aconteceu
 *   confirmadoEm  a vela a partir da qual a coisa é CONHECÍVEL
 *
 * e nenhuma função pode usar um objecto cuja `confirmadoEm` seja >= à vela que
 * está a avaliar. O guarda `visivelEm()` existe para isso e é usado em todo o
 * lado.
 */

import type { Candle, Timeframe } from '../types/market.js';

export type IctDireccao = 'bullish' | 'bearish';
export type IctVies = IctDireccao | 'neutral';

/** Tudo o que só é conhecível algumas velas depois de acontecer. */
export interface Datado {
  /** Vela em que o facto ocorreu. */
  index: number;
  /**
   * Primeira vela a partir da qual este facto é conhecível.
   *
   * Uma função que está a decidir na vela `i` só pode usar factos com
   * `confirmadoEm <= i`. Ver `visivelEm`.
   */
  confirmadoEm: number;
  /** Instante de abertura da vela `index` (ms UTC). */
  time: number;
}

/**
 * O guarda contra look-ahead.
 *
 * `true` quando o facto já era conhecido na vela `i`. Chamar isto antes de usar
 * qualquer swing, poça, PD array ou quebra não é opcional.
 */
export function visivelEm(f: Datado, i: number): boolean {
  return f.confirmadoEm <= i;
}

/** Filtra para os factos já conhecidos na vela `i`, pela ordem original. */
export function visiveisEm<T extends Datado>(fs: readonly T[], i: number): T[] {
  return fs.filter((f) => f.confirmadoEm <= i);
}

// ── Estrutura ───────────────────────────────────────────────────────────────

export interface Swing extends Datado {
  kind: 'high' | 'low';
  price: number;
}

/**
 * Quebra de estrutura.
 *
 *   BOS    continuação: quebra limpa do swing anterior no sentido da tendência
 *   CHoCH  reversão: quebra do swing contra-tendência mais recente
 *   MSS    o gatilho de timeframe menor — a quebra estrutural COM deslocamento
 *          que diz que a reversão está em marcha
 *
 * Do site: "MSS = the lower-timeframe trigger — the specific structural break,
 * backed by displacement, that signals the reversal is now underway".
 * Sem deslocamento não há MSS, só uma quebra.
 */
export interface QuebraEstrutura extends Datado {
  tipo: 'bos' | 'choch' | 'mss';
  /** Sentido da estrutura DEPOIS da quebra. */
  lado: IctDireccao;
  /** Preço do swing que foi quebrado. */
  nivel: number;
  /** O fecho que quebrou. */
  fecho: number;
  /** Corpo da vela da quebra, em ATR. Abaixo de `MIN_DESLOCAMENTO` não é MSS. */
  deslocamentoAtr: number;
}

// ── Liquidez ────────────────────────────────────────────────────────────────

export type OrigemPoca =
  | 'swing'
  | 'equal-highs'
  | 'equal-lows'
  | 'dia-anterior'
  | 'semana-anterior'
  | 'range-asiatico';

/**
 * Poça de liquidez: onde estão as ordens de stop.
 *
 * Do site: "the resting stop orders and pending orders that institutions need
 * to fill their large positions". Buy-side acima de máximos antigos, sell-side
 * abaixo de mínimos antigos.
 */
export interface PocaLiquidez extends Datado {
  lado: 'buy-side' | 'sell-side';
  preco: number;
  origem: OrigemPoca;
  /** Quantos toques no mesmo patamar — mais toques, mais stops acumulados. */
  toques: number;
  rotulo: string;
  /** Vela em que foi varrida, se já o foi. */
  varridaEm: number | null;
  /**
   * Vela a partir da qual esta poça foi ABSORVIDA por outra mais completa.
   *
   * Quando um segundo topo aparece ao mesmo nível, nasce uma poça nova de
   * "equal highs" — mas só na vela em que esse segundo topo é confirmado. Até
   * lá, a poça de um toque existiu e contou. Mudar a poça antiga em vez de
   * criar uma nova seria reescrever o passado com informação do futuro.
   */
  substituidaEm: number | null;
}

/** A poça existia, intacta, na vela `i`? */
export function pocaActivaEm(p: PocaLiquidez, i: number): boolean {
  return (
    p.confirmadoEm <= i &&
    (p.varridaEm === null || p.varridaEm > i) &&
    (p.substituidaEm === null || p.substituidaEm > i)
  );
}

/**
 * Varrimento de liquidez (sweep).
 *
 * A distinção mecânica do site, que é o que separa isto de um rompimento:
 *
 *   "a sweep must show a wick through the level with the candle body closing
 *    back above (for bullish sweeps). A candle close through the level means
 *    it is a run."
 *
 * Pavio através do nível, corpo a fechar de volta = varrimento.
 * Corpo a fechar para lá do nível = "run", continuação, NÃO é varrimento.
 */
export interface Varrimento extends Datado {
  /** Sentido da reversão esperada: varrer mínimos (sell-side) arma uma compra. */
  lado: IctDireccao;
  poca: PocaLiquidez;
  /**
   * O extremo do pavio que varreu.
   *
   * É AQUI que vai o stop — não no limite do FVG. Do site: "place the stop loss
   * below the swept low (for bullish entries) — not below the FVG low".
   */
  extremo: number;
  /** Quanto o pavio passou do nível, em ATR. */
  penetracaoAtr: number;
}

// ── PD arrays ───────────────────────────────────────────────────────────────

export type TipoPdArray = 'fvg' | 'order-block' | 'breaker';

/**
 * PD array: "any specific institutional price level within a range — order
 * blocks, fair value gaps, breaker blocks and more".
 *
 * Todos partilham a mesma forma: uma ZONA (não um preço), um lado, e um estado
 * de mitigação. A regra de mitigação vem do site e é por FECHO, não por toque:
 * "a bullish order block is mitigated when price closes below its low".
 */
export interface PdArray extends Datado {
  tipo: TipoPdArray;
  lado: IctDireccao;
  alto: number;
  baixo: number;
  /** Vela em que foi mitigado (invalidado), se já o foi. */
  mitigadoEm: number | null;
  /** Primeira vela em que o preço lhe tocou (entrada potencial). */
  tocadoEm: number | null;
  rotulo: string;
}

// ── Tempo ───────────────────────────────────────────────────────────────────

export type NomeKillzone = 'asia' | 'londres' | 'ny-am' | 'silver-bullet' | 'ny-pm';
export type FaseAmd = 'acumulacao' | 'manipulacao' | 'distribuicao' | 'fora';

export interface JanelaTempo {
  killzones: NomeKillzone[];
  fase: FaseAmd;
  /** Hora de Nova Iorque (0..23) da vela, já com horário de verão resolvido. */
  horaNy: number;
  minutoNy: number;
}

// ── Viés ────────────────────────────────────────────────────────────────────

/**
 * As cinco perguntas do viés diário, tal como o site as ordena.
 *
 * Cada uma responde `bullish`, `bearish` ou `neutral`, e todas ficam visíveis
 * no resultado: quando o algoritmo não dá sinal, a pessoa consegue ver QUAL das
 * cinco falhou, em vez de receber um silêncio.
 */
export interface RespostaVies {
  pergunta: string;
  resposta: IctVies;
  detalhe: string;
}

export interface ViesDiario {
  direccao: IctVies;
  /** Quantas das cinco perguntas apontam na direcção dominante. */
  aFavor: number;
  contra: number;
  respostas: RespostaVies[];
  /** Draw on liquidity: a poça que o dia deve procurar. É o alvo. */
  dol: PocaLiquidez | null;
  /** Estrutura semanal, a pergunta 1 — o passo 1 do modelo de 2022. */
  estruturaSemanal: IctVies;
}

// ── Regime ──────────────────────────────────────────────────────────────────

/**
 * O regime do momento, lido de cima para baixo.
 *
 * É isto que decide QUE setup se monta. Um operador top-down não usa o mesmo
 * setup em tendência, em range e em reversão, e o algoritmo também não:
 *
 *   manipulacao   houve varrimento de liquidez numa killzone, a favor do viés
 *                 diário — a transição de manipulação para distribuição
 *   reversao      o micro vinha contra o viés e acabou de virar (MSS) de volta
 *   tendencia     semanal, diário e micro alinhados, com BOS no sentido
 *   consolidacao  estrutura neutra e faixa comprimida — o preço oscila entre
 *                 liquidez de um lado e do outro
 *   indefinido    nenhuma das anteriores; o algoritmo espera
 *
 * A ordem acima é a ordem de avaliação, e foi fixada ANTES de medir fosse o que
 * fosse. Escolhê-la depois de ver resultados seria ajustar a regra aos dados.
 */
export type RegimeIct = 'manipulacao' | 'reversao' | 'tendencia' | 'consolidacao' | 'indefinido';

export interface LeituraRegime {
  regime: RegimeIct;
  /** Sentido permitido. `null` na consolidação: os dois lados da faixa servem. */
  direccao: IctDireccao | null;
  /** Estrutura semanal (macro). */
  macro: IctVies;
  /** Viés diário (as cinco perguntas). */
  diario: IctVies;
  /** Estrutura do timeframe de execução (micro). */
  micro: IctVies;
  /** Onde está o preço na faixa diária de 20 dias. */
  zonaDiaria: 'premium' | 'discount';
  /** Última quebra de estrutura recente, se houve. */
  ultimaQuebra: QuebraEstrutura | null;
  /** Último varrimento recente, se houve. */
  ultimoVarrimento: Varrimento | null;
  /** Amplitude das últimas 24 velas, em ATR. Baixa = faixa comprimida. */
  compressao: number;
  /** A leitura em frases, do semanal à vela — vai para o painel e para o Telegram. */
  leitura: string[];
}

// ── Modelos ─────────────────────────────────────────────────────────────────

/**
 * Os modelos avançados do site que o algoritmo sabe montar.
 *
 *   venom          varrimento + SMT + MSS + first presented FVG (manipulação)
 *   crt            vela de referência: Seek & Destroy de um extremo, Delivery
 *                  para o outro (manipulação, consolidação)
 *   reaper-ifvg    FVG invertido durante uma colheita de liquidez (manipulação,
 *                  reversão)
 *   silver-bullet  FVG na janela de uma hora, a favor do viés (manipulação,
 *                  tendência) — só em 15M ou menos
 *   unicorn        breaker sobreposto a FVG depois de um MSS (reversão)
 *   turtle-soup    varrimento de máximos/mínimos iguais que falha (reversão,
 *                  consolidação)
 *   continuacao    BOS + regresso a um PD array dentro do OTE (tendência)
 *
 * O percurso de base (o "modelo de 2022") fica de fora: é a versão de ensino da
 * mesma sequência que o Venom completa.
 */
export type ModeloIct =
  | 'venom'
  | 'crt'
  | 'reaper-ifvg'
  | 'silver-bullet'
  | 'unicorn'
  | 'turtle-soup'
  | 'continuacao'
  | 'mentorship-2022';

/** Nome legível de cada modelo. */
export const NOME_MODELO: Readonly<Record<ModeloIct, string>> = {
  venom: 'Venom',
  crt: 'CRT (Candle Range Theory)',
  'reaper-ifvg': 'Reaper IFVG',
  'silver-bullet': 'Silver Bullet',
  unicorn: 'Unicorn',
  'turtle-soup': 'Turtle Soup',
  continuacao: 'Continuação (OTE + PD array)',
  'mentorship-2022': 'ICT 2022 Mentorship',
};

/** Um passo da análise top-down, para a explicação que vai ao utilizador. */
export interface PassoTopDown {
  numero: number;
  /** '3m': a confirmação do Asia Range Algo (a Deriv serve 3M; o sistema não o usa como timeframe). */
  timeframe: Timeframe | 'tempo' | '3m';
  titulo: string;
  veredicto: 'ok' | 'falhou' | 'espera';
  detalhe: string;
}

// ── Sinal ───────────────────────────────────────────────────────────────────

/**
 * O sinal do ICT ALGO.
 *
 * Deliberadamente NÃO é um `StrategySignal`: este algoritmo é independente das
 * estratégias validadas, tem o seu próprio formato, o seu próprio identificador
 * e a sua própria contabilidade. Quem vê "ICT ALGO" sabe de onde veio.
 */
export interface SinalIct {
  readonly algoritmo: 'ICT ALGO';
  modelo: ModeloIct;
  /** O regime em que o setup foi montado — a razão de ser ESTE modelo. */
  regime: RegimeIct;
  simbolo: string;
  /** Timeframe onde a entrada foi encontrada. */
  timeframe: Timeframe;
  direccao: IctDireccao;

  /**
   * Identidade do setup: o mesmo setup visto em velas seguidas é UM sinal, não
   * vários. Sem isto o canal recebia a mesma ideia de hora a hora.
   */
  chave: string;

  /** Vela fechada que completou o modelo. */
  index: number;
  /** Instante de abertura dessa vela (ms UTC). */
  time: number;
  /** Fecho dessa vela — o preço a que a análise foi feita. */
  precoAnalise: number;

  /**
   * `pendente`: ordem limite no PD array, à espera do regresso do preço — o
   * caso normal ("wait for the pullback into the FVG").
   * `mercado`: entrada no fecho da vela de rejeição — o caso do Reaper IFVG,
   * que o site descreve assim.
   */
  tipoEntrada: 'pendente' | 'mercado';
  entrada: number;
  zonaEntradaAlta: number;
  zonaEntradaBaixa: number;
  stop: number;
  alvo: number;
  rr: number;
  /** O que o alvo é, em palavras: "máximo do impulso", "extremo oposto da vela de referência"… */
  rotuloAlvo: string;
  rotuloStop: string;

  /** A cadeia completa, do semanal à entrada. Vai para o painel e para o Telegram. */
  passos: PassoTopDown[];
  /** As peças concretas que sustentam o sinal (algumas não existem em todos os modelos). */
  varrimento: Varrimento | null;
  quebra: QuebraEstrutura | null;
  pdArray: PdArray;
  vies: ViesDiario;
  janela: JanelaTempo;

  /** O que pode correr mal neste sinal em concreto. */
  avisos: string[];
}

/** O veredicto de UM modelo numa vela: sinal, ou em que passo parou. */
export interface ResultadoModelo {
  modelo: ModeloIct;
  /** Sentido em que o modelo foi avaliado (cada modelo é avaliado nos dois). */
  direccao?: IctDireccao;
  sinal: SinalIct | null;
  passos: PassoTopDown[];
  porqueNao: string | null;
}

/**
 * O registo de um modelo no passado deste instrumento — só com operações que
 * já tinham FECHADO antes da vela que está a decidir.
 */
export interface PlacarModelo {
  modelo: ModeloIct;
  /** Operações fechadas na janela considerada. */
  n: number;
  /** R médio dessas operações. */
  media: number;
  /** Suspenso: perdeu na janela recente com amostra suficiente. */
  quarentena: boolean;
}

/** Resultado completo de uma análise, haja sinal ou não. */
export interface AnaliseIct {
  simbolo: string;
  timeframe: Timeframe;
  /** Velas lidas em cada timeframe, para auditoria. */
  lidas: Partial<Record<Timeframe, number>>;
  vies: ViesDiario | null;
  regime: LeituraRegime | null;
  /** Os modelos que o regime tornou elegíveis, pela ordem em que foram tentados. */
  elegiveis: ModeloIct[];
  /** O veredicto de TODOS os modelos nesta vela — para o painel mostrar o que cada um vê. */
  modelos: ResultadoModelo[];
  /** O desempenho recente de cada modelo neste instrumento. */
  placar: PlacarModelo[];
  /** O modelo escolhido para este momento, se algum montou setup. */
  escolhido: ModeloIct | null;
  passos: PassoTopDown[];
  sinal: SinalIct | null;
  /** Porque não houve sinal, em uma frase. Nunca fica vazio quando sinal é null. */
  porqueNao: string | null;
  /** Estruturas encontradas, para desenhar no gráfico. */
  pocas: PocaLiquidez[];
  pdArrays: PdArray[];
  varrimentos: Varrimento[];
  quebras: QuebraEstrutura[];
  /**
   * O ponto de interesse para onde Londres vai, no sentido do viés (ver
   * `poi.ts`). Null sem viés ou sem destino à frente.
   */
  poi?: {
    preco: number;
    alto: number;
    baixo: number;
    rotulo: string;
    origem: 'liquidez' | 'pd-array';
    desde: number;
  } | null;
  /**
   * A confirmação em 5M do sinal (ver `confirmacao.ts`), quando quem chama tem
   * velas de 5M. Sem `ok`, o sinal não é enviado — é só análise.
   */
  confirmacao?: {
    ok: boolean;
    tipo: 'bos' | 'choch' | 'mss' | null;
    time: number | null;
    nivel: number | null;
    detalhe: string;
  } | null;
  avisos: string[];
}
