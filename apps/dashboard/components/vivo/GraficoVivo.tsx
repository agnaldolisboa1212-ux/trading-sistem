'use client';

/**
 * Gráfico de velas ao vivo — desenhado em canvas.
 *
 * ── PORQUÊ CANVAS E NÃO SVG ────────────────────────────────────────────────
 *
 * O `PriceChart` que já existe é SVG e serve bem o que faz: desenha uma
 * análise que só muda quando uma vela fecha. Este gráfico é outra coisa —
 * recebe uma atualização POR SEGUNDO. Em SVG isso significa o React a comparar
 * 300 `<rect>` e 300 `<line>` sessenta vezes por minuto, mais o browser a
 * recalcular estilo e layout de cada um.
 *
 * Em canvas há um só nó no DOM. Redesenhar 300 velas custa ~0,4 ms. É a mesma
 * razão pela qual o TradingView, o MetaTrader e a Exness usam canvas.
 *
 * ── COMO SE MEXE COMO O TRADINGVIEW ────────────────────────────────────────
 *
 *   · o desenho corre dentro de `requestAnimationFrame`, sincronizado com o
 *     ecrã, e não a cada mensagem que chega
 *   · a escala vertical INTERPOLA entre o alvo e o valor atual, por isso o eixo
 *     desliza em vez de saltar quando uma vela nova alarga o intervalo
 *   · a vista é contínua: píxeis por vela e um deslocamento em velas
 *     fraccionárias — arrastar é suave, e ao soltar continua por inércia
 *   · há espaço vazio à direita da última vela, e pode-se arrastar para lá dela
 *   · roda do rato e pinça aproximam em volta do cursor / do meio dos dedos;
 *     no trackpad, dois dedos na horizontal deslocam
 *   · arrastar o EIXO DE PREÇOS estica a escala na vertical (e a partir daí o
 *     arrasto também desloca na vertical); duplo clique no eixo volta à
 *     escala automática
 *   · arrastar o EIXO DO TEMPO estica na horizontal
 *   · a olhar para o passado, uma vela nova não mexe na vista; no presente, a
 *     vista acompanha
 *   · a mira segue o rato com etiquetas de preço e de tempo
 *
 * ── CORES ──────────────────────────────────────────────────────────────────
 *
 * Lidas do CSS com `getComputedStyle` em vez de fixadas aqui. Assim o gráfico
 * acompanha o tema (claro/escuro) sem duplicar a paleta em JavaScript, e sem
 * ficar dessincronizado quando a paleta mudar.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Vela } from '@/lib/deriv/live';
import { formatarPreco, segundosDe, TIMEFRAMES, type Timeframe } from '@/lib/deriv/simbolos';

export interface GraficoVivoProps {
  velas: Vela[];
  casas: number;
  timeframe: Timeframe;
  /**
   * Faixas de preço no tempo: zonas de oferta/procura, níveis, value area, FVG.
   * `ate: Infinity` estende até ao presente. `tipo`: bull, bear, neutro, entrada.
   */
  zonas?: Array<{ de: number; ate: number; topo: number; base: number; tipo: string; rotulo?: string }>;
  /**
   * Faixas de preço no tempo. `tipo`: bull, bear, neutro, entrada — ou
   * sessao-asia, sessao-londres, sessao-ny: caixas de sessão com o nome DENTRO
   * da caixa, como no TradingView.
   */
  /** Linhas horizontais. `tipo`: entrada, stop, alvo, poc, nivel. Com `de`, começam nesse instante. */
  linhas?: Array<{ preco: number; rotulo: string; tipo: string; de?: number; curto?: string }>;
  /** Marcas pontuais (SMT, MSS, varrimento) num instante e preço. */
  marcadores?: Array<{ t: number; p: number; rotulo: string; tipo: string }>;
  /**
   * Segmentos entre dois pontos: a linha tracejada que liga o nível varrido ao
   * pavio que o varreu, com "SMT" escrito ao meio — como no TradingView.
   */
  segmentos?: Array<{ t0: number; p0: number; t1: number; p1: number; rotulo: string; tipo: string }>;
  /** Curvas no tempo, como o VWAP e as suas bandas. `tipo`: vwap, banda1, banda2. */
  curvas?: Array<{ pontos: Array<{ t: number; p: number }>; tipo: string; rotulo?: string }>;
  /** Timeframes oferecidos na barra; por omissão todos os da Deriv. */
  timeframes?: readonly Timeframe[];
  altura?: number;
  aoMudarTimeframe?: (tf: Timeframe) => void;
  cheio?: boolean;
  aoAlternarCheio?: () => void;
  titulo?: string;
}

interface Escala {
  min: number;
  max: number;
}

/** Margem à direita, para a vela atual não ficar colada ao eixo. */
const MARGEM_DIR = 62;
const MARGEM_BAIXO = 22;
const MARGEM_TOPO = 8;

/** Velas de espaço vazio à direita da última, como no TradingView. */
const DESVIO_PADRAO = 6;
/** Velas no ecrã ao abrir. */
const VELAS_PADRAO = 90;
/** Limites da largura de uma vela, em píxeis. */
const ESPACO_MIN = 1.5;
const ESPACO_MAX = 60;
const limitar = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * A vista: tudo o que os gestos mexem. Vive numa ref e não em estado — muda a
 * cada movimento do rato, e o canvas lê-a no frame seguinte sem um render do
 * React por píxel.
 */
interface Vista {
  /** Píxeis por vela. 0 = ainda não medido (o primeiro desenho decide). */
  espaco: number;
  /** Velas entre a última vela e a borda direita: >0 espaço vazio, <0 passado. */
  desvio: number;
  /** Escala de preços fixada ao esticar o eixo; null = automática. */
  manual: Escala | null;
  /** Velas da série no último desenho — para seguir o presente ou ficar no passado. */
  n: number;
  /**
   * Abertura da última vela no último desenho. É a âncora: o painel guarda um
   * histórico de tamanho fixo (entra uma vela no fim, sai uma no início), por
   * isso o ÍNDICE de uma vela muda a cada vela nova — a hora não.
   */
  ultimaT: number;
  /** Inércia do arrasto, em velas por milissegundo. */
  inercia: number;
  ultimoFrame: number;
}

/** O que o último desenho mediu — os gestos precisam disto para converter píxeis. */
interface Geometria {
  largura: number;
  altoUtil: number;
  alto: number;
  direita: number;
  esc: Escala;
}

/** Um gesto em curso. */
type Gesto =
  | { tipo: 'arrasto'; x0: number; y0: number; desvio0: number; escala0: Escala | null; rasto: Array<{ t: number; x: number }> }
  | { tipo: 'eixo-preco'; y0: number; escala0: Escala }
  | { tipo: 'eixo-tempo'; x0: number; espaco0: number }
  | { tipo: 'pinca'; dist0: number; espaco0: number; barra: number; xCentro: number };

export function GraficoVivo({
  velas,
  casas,
  timeframe,
  zonas = [],
  linhas = [],
  curvas = [],
  marcadores = [],
  segmentos = [],
  timeframes,
  altura = 340,
  aoMudarTimeframe,
  cheio = false,
  aoAlternarCheio,
  titulo,
}: GraficoVivoProps) {
  const caixa = useRef<HTMLDivElement | null>(null);
  const tela = useRef<HTMLCanvasElement | null>(null);

  const vista = useRef<Vista>({ espaco: 0, desvio: DESVIO_PADRAO, manual: null, n: 0, ultimaT: 0, inercia: 0, ultimoFrame: 0 });
  const geo = useRef<Geometria | null>(null);
  const gesto = useRef<Gesto | null>(null);
  const ponteiros = useRef(new Map<number, { x: number; y: number }>());
  /** Só o que os botões precisam de saber — muda raramente, não a cada frame. */
  const [estadoVista, setEstadoVista] = useState({ passado: false, manual: false, alterado: false });
  const estadoRef = useRef({ passado: false, manual: false, alterado: false });
  const [mira, setMira] = useState<{ x: number; y: number } | null>(null);

  /*
   * Escala animada.
   *
   * Guardada em ref e não em estado: muda a 60 fps e cada mudança de estado
   * seria um render do React inteiro. O canvas não precisa de render — precisa
   * de um número novo antes do próximo `draw`.
   */
  /*
   * `NaN` é o sentinela de "ainda não há escala", e não `{min:0, max:1}`.
   *
   * Com 0..1 o teste de arranque (`Math.abs(max-min) < 1e-12`) nunca disparava:
   * a diferença é 1. O resultado era o primeiro desenho a interpolar a partir
   * de zero em direção ao preço real — com um instrumento a 6525, o eixo ficava
   * a subir de 0 durante meio segundo, e se o separador estivesse em segundo
   * plano (onde `requestAnimationFrame` não corre) ficava congelado a meio, a
   * mostrar 4524 ao lado de um preço de 6525 e sem uma única vela visível,
   * porque todas caíam fora do intervalo desenhado.
   */
  const escalaActual = useRef<Escala>({ min: Number.NaN, max: Number.NaN });

  // Trocar de timeframe ou de instrumento é outra série: a vista volta ao
  // presente e a escala de preços ao automático (o preço é outro).
  useEffect(() => {
    const v = vista.current;
    v.espaco = 0;
    v.desvio = DESVIO_PADRAO;
    v.manual = null;
    v.inercia = 0;
    v.n = 0;
  }, [timeframe, titulo]);

  /** Redesenha. Chamado pelo loop de animação, não pelo React. */
  const desenhar = useCallback(() => {
    const c = tela.current;
    const cx = c?.getContext('2d');
    const el = caixa.current;
    if (!c || !cx || !el) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const L = el.clientWidth;
    const A = el.clientHeight;
    if (L === 0 || A === 0) return;

    if (c.width !== Math.round(L * dpr) || c.height !== Math.round(A * dpr)) {
      c.width = Math.round(L * dpr);
      c.height = Math.round(A * dpr);
      c.style.width = `${L}px`;
      c.style.height = `${A}px`;
    }
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx.clearRect(0, 0, L, A);

    // --- a vista: quantas velas, onde, e a inércia do último arrasto -------
    const largura = L - MARGEM_DIR;
    const v = vista.current;
    const n = velas.length;
    if (v.espaco === 0) v.espaco = limitar(largura / VELAS_PADRAO, ESPACO_MIN, ESPACO_MAX);
    const ultimaT = velas[n - 1]?.t ?? 0;
    if (n !== v.n || ultimaT !== v.ultimaT) {
      if (v.n > 0 && v.desvio < -0.5) {
        // A olhar para o passado: as mesmas velas ficam no mesmo sítio, mesmo que
        // a série tenha andado (vela nova no fim, vela velha a sair no início).
        const j = indiceDoTempo(velas, v.ultimaT);
        if (j >= 0) v.desvio = v.n - 1 + v.desvio + (j - (v.n - 1)) - (n - 1);
        else v.desvio = DESVIO_PADRAO; // a âncora saiu da série: volta ao presente
      }
      // No presente (desvio >= 0) não se faz nada: a vista acompanha as velas novas.
      v.n = n;
      v.ultimaT = ultimaT;
    }
    const agoraFrame = performance.now();
    const dt = v.ultimoFrame ? Math.min(64, agoraFrame - v.ultimoFrame) : 16;
    v.ultimoFrame = agoraFrame;
    if (v.inercia !== 0 && !gesto.current) {
      v.desvio += v.inercia * dt;
      v.inercia *= Math.pow(0.92, dt / 16);
      if (Math.abs(v.inercia) < 0.0004) v.inercia = 0;
    }
    const barras = largura / v.espaco;
    // Sempre algumas velas à vista: nem o presente sai pela esquerda, nem o
    // início da série sai pela direita.
    v.desvio = limitar(v.desvio, -(n - 5), barras * 0.85);
    const direita = n - 1 + v.desvio;
    const esquerda = direita - barras;
    const i0 = Math.max(0, Math.floor(esquerda));
    const janela = velas.slice(i0, Math.min(n, Math.floor(direita) + 2));
    /** Centro da vela `i` da janela, em x. */
    const xi = (i: number) => largura - (direita - (i0 + i)) * v.espaco;

    if (janela.length === 0) return;

    // --- cores do tema --------------------------------------------------
    const css = getComputedStyle(el);
    const cor = (nome: string, alt: string) => css.getPropertyValue(nome).trim() || alt;
    const alta = cor('--bull', '#16a34a');
    const baixa = cor('--bear', '#dc2626');
    const grelha = cor('--border', '#e2e5da');
    const texto = cor('--text-faint', '#8f9683');
    const textoForte = cor('--text', '#14180f');
    const acento = cor('--accent', '#b8e62e');
    const aviso = cor('--warn', '#ff9500');
    const superficie = cor('--surface', '#ffffff');

    // --- escala vertical -------------------------------------------------
    let min = Infinity;
    let max = -Infinity;
    for (const v of janela) {
      if (v.l < min) min = v.l;
      if (v.h > max) max = v.h;
    }
    /*
     * As linhas da análise entram na escala, mas NUNCA a podem destruir.
     *
     * Um plano com níveis noutra ordem de grandeza — o do instrumento anterior,
     * um valor corrompido — esticava o eixo e as velas viravam uma linha fina
     * colada ao fundo: o gráfico deixava de informar. Fora de três amplitudes
     * do preço, a linha é ignorada pela escala (continua a ser desenhada, fica
     * é fora do ecrã), que é a leitura honesta: o gráfico é do PREÇO.
     */
    const amplitudeVelas = max - min;
    const limite = amplitudeVelas > 0 ? 3 * amplitudeVelas : Math.abs(max) * 0.5;
    const minVelas = min;
    const maxVelas = max;
    for (const l of linhas) {
      if (!Number.isFinite(l.preco)) continue;
      if (l.preco < minVelas - limite || l.preco > maxVelas + limite) continue;
      if (l.preco < min) min = l.preco;
      if (l.preco > max) max = l.preco;
    }
    // O VWAP e as bandas são a própria leitura: cortá-las pela escala das velas
    // escondia precisamente as bandas de onde o preço está a afastar-se.
    if (curvas.length > 0) {
      const inicioJanela = janela[0]!.t;
      for (const cv of curvas) {
        for (const pt of cv.pontos) {
          if (pt.t < inicioJanela) continue;
          if (pt.p < min) min = pt.p;
          if (pt.p > max) max = pt.p;
        }
      }
    }
    const folga = (max - min) * 0.08 || Math.abs(max) * 0.001 || 1;
    const alvo: Escala = v.manual ?? { min: min - folga, max: max + folga };

    /*
     * Interpolação exponencial em direção ao alvo.
     *
     * O 0,18 foi escolhido a olho contra o TradingView: mais alto e o eixo
     * salta; mais baixo e fica com uma inércia de gelatina. Quando a diferença
     * já é irrelevante, encaixa — senão fica a convergir para sempre e o loop
     * de animação nunca adormece.
     */
    const a = escalaActual.current;
    const amplitudeAlvo = alvo.max - alvo.min || 1;
    /*
     * Encaixa de imediato em três casos: no primeiro desenho, quando a escala
     * atual é degenerada, e quando o alvo está a mais de uma amplitude de
     * distância — que é o que acontece ao trocar de instrumento. Sem o terceiro
     * caso, saltar de um par forex (1,16) para um índice (6525) daria vários
     * segundos de eixo a rastejar entre os dois, com o gráfico vazio no meio.
     */
    const saltoGrande =
      Number.isFinite(a.min) &&
      (Math.abs(alvo.min - a.min) > amplitudeAlvo || Math.abs(alvo.max - a.max) > amplitudeAlvo);

    if (v.manual || !Number.isFinite(a.min) || Math.abs(a.max - a.min) < 1e-12 || saltoGrande) {
      escalaActual.current = alvo;
    } else {
      const k = 0.18;
      const novoMin = a.min + (alvo.min - a.min) * k;
      const novoMax = a.max + (alvo.max - a.max) * k;
      const perto =
        Math.abs(novoMin - alvo.min) < (alvo.max - alvo.min) * 1e-4 &&
        Math.abs(novoMax - alvo.max) < (alvo.max - alvo.min) * 1e-4;
      escalaActual.current = perto ? alvo : { min: novoMin, max: novoMax };
    }
    const esc = escalaActual.current;

    const altoUtil = A - MARGEM_BAIXO - MARGEM_TOPO;
    const y = (p: number) =>
      MARGEM_TOPO + ((esc.max - p) / (esc.max - esc.min || 1)) * altoUtil;
    const passo = v.espaco;
    const larguraVela = Math.max(1, Math.min(40, passo * 0.7));
    geo.current = { largura, altoUtil, alto: A, direita, esc };

    // --- grelha e eixo de preço ------------------------------------------
    cx.font =
      '10px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    cx.textBaseline = 'middle';
    const linhasGrelha = 5;
    cx.strokeStyle = grelha;
    cx.lineWidth = 1;
    cx.setLineDash([2, 4]);
    for (let i = 0; i <= linhasGrelha; i++) {
      const p = esc.min + ((esc.max - esc.min) * i) / linhasGrelha;
      const yy = Math.round(y(p)) + 0.5;
      cx.beginPath();
      cx.moveTo(0, yy);
      cx.lineTo(largura, yy);
      cx.stroke();
      cx.fillStyle = texto;
      cx.textAlign = 'left';
      cx.fillText(formatarPreco(p, casas), largura + 6, yy);
    }
    cx.setLineDash([]);

    // Tudo o que é da análise fica dentro da área das velas: uma zona longe do
    // preço não pode pintar por cima do eixo nem da barra de tempo.
    cx.save();
    cx.beginPath();
    cx.rect(0, MARGEM_TOPO, largura, altoUtil);
    cx.clip();

    /*
     * Rótulos das linhas e das zonas: juntam-se aqui e desenham-se no fim, com
     * fundo e sem se sobreporem. No telemóvel eram escritos uns por cima dos
     * outros e por cima das velas ("máx. Ásia", "BOS", "ENTRADA" na mesma linha).
     */
    const rotulos: Array<{ texto: string; cor: string; x: number; y: number; alinhar: 'left' | 'right' }> = [];
    /** Etiquetas no eixo de preços, como no TradingView: o preço de cada linha, na cor dela. */
    const etiquetasEixo: Array<{ preco: number; cor: string; y: number }> = [];

    // --- zonas (oferta/procura, níveis, value area, FVG) -----------------
    const corDoTipo = (tipo: string) =>
      tipo.includes('bull')
        ? alta
        : tipo.includes('bear')
          ? baixa
          : tipo === 'entrada'
            ? acento
            : tipo === 'poi'
              ? aviso
              : texto;
    for (const z of zonas) {
      const z0 = janela.findIndex((c) => c.t >= z.de);
      const antes = janela[0] && z.de < janela[0].t;
      if (z0 === -1 && !antes) continue;
      const z1 = Number.isFinite(z.ate) ? janela.findIndex((c) => c.t > z.ate) : -1;
      if (Number.isFinite(z.ate) && janela[0] && z.ate < janela[0].t) continue;
      const x0 = antes ? 0 : xi(z0) - passo / 2;
      const x1 = z1 === -1 ? largura : xi(z1) - passo / 2;
      const yTopo = y(z.topo);
      const alturaZona = Math.max(2, y(z.base) - yTopo);
      if (z.tipo.startsWith('sessao')) {
        // Caixa de sessão: tinta leve, contorno fino e o nome no canto de cima.
        const corSessao = z.tipo === 'sessao-londres' ? alta : z.tipo === 'sessao-ny' ? aviso : texto;
        cx.fillStyle = corComAlfa(corSessao, 0.07);
        cx.fillRect(x0, yTopo, Math.max(2, x1 - x0), alturaZona);
        cx.strokeStyle = corComAlfa(corSessao, 0.35);
        cx.lineWidth = 1;
        cx.strokeRect(Math.round(x0) + 0.5, Math.round(yTopo) + 0.5, Math.max(2, x1 - x0) - 1, alturaZona - 1);
        if (z.rotulo && x1 - x0 > 30) {
          cx.fillStyle = corComAlfa(corSessao, 0.9);
          cx.font = '600 9.5px ui-sans-serif, system-ui, sans-serif';
          cx.textAlign = 'left';
          cx.textBaseline = 'bottom';
          cx.fillText(z.rotulo, x0 + 4, yTopo - 2);
          cx.textBaseline = 'middle';
        }
        continue;
      }
      if (z.tipo === 'posicao-alvo' || z.tipo === 'posicao-risco') {
        // A ferramenta de posição do TradingView: verde do preço de entrada ao
        // alvo, vermelho da entrada ao stop, com o rótulo dentro da caixa.
        const corPos = z.tipo === 'posicao-alvo' ? alta : baixa;
        const largPos = Math.max(2, x1 - x0);
        cx.fillStyle = corComAlfa(corPos, 0.16);
        cx.fillRect(x0, yTopo, largPos, alturaZona);
        cx.strokeStyle = corComAlfa(corPos, 0.45);
        cx.lineWidth = 1;
        cx.strokeRect(Math.round(x0) + 0.5, Math.round(yTopo) + 0.5, largPos - 1, alturaZona - 1);
        if (z.rotulo && largPos > 40 && alturaZona > 12) {
          cx.fillStyle = corComAlfa(corPos, 0.95);
          cx.font = '600 9.5px ui-sans-serif, system-ui, sans-serif';
          cx.textAlign = 'left';
          cx.textBaseline = z.tipo === 'posicao-alvo' ? 'top' : 'bottom';
          cx.fillText(z.rotulo, x0 + 4, z.tipo === 'posicao-alvo' ? yTopo + 3 : yTopo + alturaZona - 3);
          cx.textBaseline = 'middle';
        }
        continue;
      }
      const base = corDoTipo(z.tipo);
      cx.fillStyle = corComAlfa(base, z.tipo === 'entrada' || z.tipo === 'poi' ? 0.14 : 0.1);
      cx.fillRect(x0, yTopo, Math.max(2, x1 - x0), alturaZona);
      // Nas zonas só o POI leva nome, e curto; o resto lê-se pela cor e pelo eixo.
      if (z.tipo === 'poi') {
        rotulos.push({ texto: 'POI', cor: corComAlfa(base, 0.95), x: x0 + 4, y: yTopo + 8, alinhar: 'left' });
      }
    }

    // --- curvas (VWAP e bandas) -----------------------------------------
    if (curvas.length > 0 && janela.length > 1) {
      const indice = new Map(janela.map((c, i) => [c.t, i]));
      for (const cv of curvas) {
        cx.strokeStyle = cv.tipo === 'vwap' ? aviso : corComAlfa(aviso, cv.tipo === 'banda1' ? 0.55 : 0.3);
        cx.lineWidth = cv.tipo === 'vwap' ? 1.6 : 1;
        cx.setLineDash(cv.tipo === 'banda2' ? [4, 4] : []);
        cx.beginPath();
        let comecou = false;
        let ultimoX = 0;
        let ultimoY = 0;
        for (const pt of cv.pontos) {
          const i = indice.get(pt.t);
          if (i === undefined) continue;
          const xx = xi(i);
          const yy = y(pt.p);
          if (comecou) cx.lineTo(xx, yy);
          else cx.moveTo(xx, yy);
          comecou = true;
          ultimoX = xx;
          ultimoY = yy;
        }
        cx.stroke();
        cx.setLineDash([]);
        if (comecou && cv.rotulo) {
          cx.fillStyle = cx.strokeStyle;
          cx.font = '9.5px ui-sans-serif, system-ui, sans-serif';
          cx.textAlign = 'right';
          cx.fillText(cv.rotulo, Math.min(largura - 4, ultimoX - 4), ultimoY - 7);
        }
      }
    }
    cx.restore();

    // --- velas ------------------------------------------------------------
    cx.save();
    cx.beginPath();
    cx.rect(0, 0, largura, A);
    cx.clip();
    janela.forEach((vl, i) => {
      const x = xi(i);
      const sobe = vl.c >= vl.o;
      const c = sobe ? alta : baixa;
      cx.strokeStyle = c;
      cx.fillStyle = c;

      // Mecha
      cx.lineWidth = Math.max(1, larguraVela * 0.16);
      cx.beginPath();
      cx.moveTo(Math.round(x) + 0.5, y(vl.h));
      cx.lineTo(Math.round(x) + 0.5, y(vl.l));
      cx.stroke();

      // Corpo. Um doji tem altura zero e desapareceria — força-se 1 px.
      const topo = y(Math.max(vl.o, vl.c));
      const alturaCorpo = Math.max(1, Math.abs(y(vl.o) - y(vl.c)));
      cx.fillRect(x - larguraVela / 2, topo, larguraVela, alturaCorpo);
    });
    cx.restore();

    // --- linhas da análise ------------------------------------------------
    for (const l of linhas) {
      // Com `de`, a linha começa no instante do plano (como a ferramenta de
      // posição do TradingView) em vez de atravessar o gráfico inteiro.
      let xInicio = 0;
      if (l.de !== undefined && janela.length > 0) {
        if (l.de > janela[janela.length - 1]!.t) continue;
        const k = janela.findIndex((c) => c.t >= l.de!);
        xInicio = l.de < janela[0]!.t || k < 0 ? 0 : Math.max(0, xi(k));
      }
      const yy = Math.round(y(l.preco)) + 0.5;
      cx.strokeStyle =
        l.tipo === 'stop'
          ? baixa
          : l.tipo === 'alvo'
            ? alta
            : l.tipo === 'poc' || l.tipo === 'poi'
              ? aviso
              : l.tipo === 'nivel'
                ? texto
                : acento;
      cx.lineWidth = l.tipo === 'poc' || l.tipo === 'poi' || l.tipo === 'entrada' ? 1.4 : 1;
      cx.setLineDash(l.tipo === 'poc' || l.tipo === 'poi' ? [] : [5, 4]);
      cx.beginPath();
      cx.moveTo(xInicio, yy);
      cx.lineTo(largura, yy);
      cx.stroke();
      cx.setLineDash([]);
      // Como no TradingView: o nome curto encostado ao eixo, em cima da linha, e o
      // preço numa etiqueta no próprio eixo. Nada de frases por cima das velas.
      rotulos.push({ texto: curtoDaLinha(l), cor: String(cx.strokeStyle), x: largura - 4, y: yy, alinhar: 'right' });
      etiquetasEixo.push({ preco: l.preco, cor: String(cx.strokeStyle), y: yy });
    }

    // --- rótulos: com fundo, e sem se tocarem ---------------------------
    {
      cx.font = '600 9.5px ui-sans-serif, system-ui, sans-serif';
      cx.textBaseline = 'middle';
      const ALTO = 14;
      const postos: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
      const cruza = (r: { x0: number; x1: number; y0: number; y1: number }) =>
        postos.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0);
      for (const r of [...rotulos].sort((a, b) => a.y - b.y)) {
        const w = Math.min(cx.measureText(r.texto).width + 8, largura - 4);
        const x0 = r.alinhar === 'right' ? Math.max(2, r.x - w) : Math.max(2, Math.min(r.x - 2, largura - w - 2));
        let y0 = r.y - ALTO / 2;
        // Procura o lugar livre mais perto: desce, depois sobe.
        for (let k = 1; k <= 8 && cruza({ x0, x1: x0 + w, y0, y1: y0 + ALTO }); k++) {
          const tentativa = r.y - ALTO / 2 + (k % 2 === 1 ? 1 : -1) * Math.ceil(k / 2) * (ALTO + 1);
          y0 = Math.max(MARGEM_TOPO, Math.min(MARGEM_TOPO + altoUtil - ALTO, tentativa));
        }
        postos.push({ x0, x1: x0 + w, y0, y1: y0 + ALTO });
        cx.fillStyle = corComAlfa(superficie, 0.86);
        arredondado(cx, x0, y0, w, ALTO, 3);
        cx.fill();
        cx.fillStyle = r.cor;
        cx.textAlign = 'left';
        cx.save();
        cx.beginPath();
        cx.rect(x0, y0, w, ALTO);
        cx.clip();
        cx.fillText(r.texto, x0 + 4, y0 + ALTO / 2 + 0.5);
        cx.restore();
      }
    }

    // --- segmentos (a linha do SMT / varrimento) ------------------------
    const xDoTempo = (t: number): number | null => {
      if (janela.length === 0) return null;
      if (t < janela[0]!.t) return 0;
      if (t > janela[janela.length - 1]!.t) return null;
      const k = janela.findIndex((c) => c.t >= t);
      return k < 0 ? null : xi(k);
    };
    for (const sg of segmentos) {
      const xa = xDoTempo(sg.t0);
      const xb = xDoTempo(sg.t1);
      if (xa === null || xb === null || xb - xa < 4) continue;
      const ya = y(sg.p0);
      const yb = y(sg.p1);
      const corS = sg.tipo === 'smt' ? aviso : texto;
      cx.strokeStyle = corComAlfa(corS, 0.85);
      cx.lineWidth = 1.2;
      cx.setLineDash([3, 3]);
      cx.beginPath();
      cx.moveTo(xa, ya);
      cx.lineTo(xb, yb);
      cx.stroke();
      cx.setLineDash([]);
      // O rótulo ao meio, por baixo da linha se ela ligar mínimos, por cima se máximos.
      const baixo = sg.p1 <= sg.p0;
      cx.save();
      cx.translate((xa + xb) / 2, (ya + yb) / 2);
      cx.rotate(Math.atan2(yb - ya, xb - xa));
      cx.fillStyle = corS;
      cx.font = '600 9px ui-sans-serif, system-ui, sans-serif';
      cx.textAlign = 'center';
      cx.textBaseline = baixo ? 'top' : 'bottom';
      cx.fillText(sg.rotulo, 0, baixo ? 3 : -3);
      cx.restore();
      cx.textBaseline = 'middle';
    }

    // --- marcadores (SMT, MSS, varrimento) ------------------------------
    for (const m of marcadores) {
      if (janela.length === 0 || m.t < janela[0]!.t || m.t > janela[janela.length - 1]!.t) continue;
      const k = janela.findIndex((c) => c.t >= m.t);
      if (k < 0) continue;
      const mx = xi(k);
      const my = y(m.p);
      const corM = m.tipo === 'smt' ? aviso : m.tipo === 'mss' ? textoForte : m.tipo === 'entrada' ? acento : texto;
      cx.fillStyle = corM;
      cx.beginPath();
      cx.arc(mx, my, 2.5, 0, Math.PI * 2);
      cx.fill();
      cx.font = '600 9.5px ui-sans-serif, system-ui, sans-serif';
      const lg = cx.measureText(m.rotulo).width + 8;
      // Por cima do ponto se estiver na metade de baixo, por baixo se na de cima.
      const acima = my > MARGEM_TOPO + altoUtil / 2;
      const ty = acima ? my - 16 : my + 5;
      const tx = Math.min(Math.max(2, mx - lg / 2), largura - lg - 2);
      cx.fillStyle = corComAlfa(superficie, 0.88);
      arredondado(cx, tx, ty, lg, 13, 3);
      cx.fill();
      cx.fillStyle = corM;
      cx.textAlign = 'left';
      cx.textBaseline = 'middle';
      cx.fillText(m.rotulo, tx + 4, ty + 6.5);
    }

    // --- linha do último preço, com etiqueta -----------------------------
    // Sempre a do preço ACTUAL, mesmo com a vista no passado — como no TradingView.
    const ultima = velas[n - 1];
    if (ultima) {
      const sobe = ultima.c >= ultima.o;
      const c = sobe ? alta : baixa;
      const yy = Math.round(y(ultima.c)) + 0.5;

      cx.strokeStyle = c;
      cx.lineWidth = 1;
      cx.setLineDash([3, 3]);
      cx.beginPath();
      cx.moveTo(0, yy);
      cx.lineTo(largura, yy);
      cx.stroke();
      cx.setLineDash([]);

      // Etiquetas das linhas no eixo, antes da do preço actual (que fica por cima
      // e reserva o seu lugar): cada uma desce ou sobe até não tocar nas outras.
      cx.font = '10px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
      const ALTO_E = 16;
      const ocupados: Array<[number, number]> = [[yy - 9, yy + 9]];
      const livre = (a: number) => ocupados.every(([o0, o1]) => a + ALTO_E <= o0 || a >= o1);
      for (const e of [...etiquetasEixo].sort((a, b) => a.y - b.y)) {
        let y0 = e.y - ALTO_E / 2;
        for (let k = 1; k <= 10 && !livre(y0); k++) {
          y0 = e.y - ALTO_E / 2 + (k % 2 === 1 ? 1 : -1) * Math.ceil(k / 2) * (ALTO_E + 1);
        }
        y0 = Math.max(0, Math.min(A - MARGEM_BAIXO - ALTO_E, y0));
        ocupados.push([y0, y0 + ALTO_E]);
        cx.fillStyle = e.cor;
        arredondado(cx, largura + 2, y0, MARGEM_DIR - 4, ALTO_E, 3);
        cx.fill();
        cx.fillStyle = superficie;
        cx.textAlign = 'left';
        cx.textBaseline = 'middle';
        cx.fillText(formatarPreco(e.preco, casas), largura + 6, y0 + ALTO_E / 2 + 0.5);
      }

      const etiqueta = formatarPreco(ultima.c, casas);
      cx.font = '10.5px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
      const larg = cx.measureText(etiqueta).width + 10;
      cx.fillStyle = c;
      arredondado(cx, largura + 2, yy - 9, Math.min(larg, MARGEM_DIR - 4), 18, 4);
      cx.fill();
      cx.fillStyle = superficie;
      cx.textAlign = 'left';
      cx.fillText(etiqueta, largura + 7, yy);
    }

    // --- eixo de tempo ----------------------------------------------------
    cx.fillStyle = texto;
    cx.font = '10px ui-sans-serif, system-ui, sans-serif';
    cx.textAlign = 'center';
    // As marcas prendem-se a velas (de N em N, N "redondo"): andam com o
    // arrasto em vez de ficarem paradas no ecrã, e continuam no espaço vazio à
    // direita com as horas que ainda vão chegar.
    const passoMs = segundosDe(timeframe) * 1000;
    const tempoDaBarra = (k: number) =>
      k < n ? velas[Math.max(0, k)]!.t : velas[n - 1]!.t + (k - (n - 1)) * passoMs;
    const cada = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512].find((q) => q * passo >= 84) ?? 768;
    for (let k = Math.ceil(esquerda / cada) * cada; k <= direita; k += cada) {
      if (k < 0) continue;
      const x = largura - (direita - k) * passo;
      if (x < 18 || x > largura - 18) continue;
      cx.fillText(rotuloTempo(tempoDaBarra(k), timeframe), x, A - 8);
    }

    // --- mira -------------------------------------------------------------
    if (mira && mira.x < largura) {
      cx.strokeStyle = texto;
      cx.lineWidth = 1;
      cx.setLineDash([3, 3]);
      cx.beginPath();
      cx.moveTo(Math.round(mira.x) + 0.5, MARGEM_TOPO);
      cx.lineTo(Math.round(mira.x) + 0.5, A - MARGEM_BAIXO);
      cx.moveTo(0, Math.round(mira.y) + 0.5);
      cx.lineTo(largura, Math.round(mira.y) + 0.5);
      cx.stroke();
      cx.setLineDash([]);

      const preco = esc.max - ((mira.y - MARGEM_TOPO) / altoUtil) * (esc.max - esc.min);
      const etiqueta = formatarPreco(preco, casas);
      cx.font = '10.5px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
      cx.fillStyle = textoForte;
      arredondado(
        cx,
        largura + 2,
        mira.y - 9,
        Math.min(cx.measureText(etiqueta).width + 10, MARGEM_DIR - 4),
        18,
        4,
      );
      cx.fill();
      cx.fillStyle = superficie;
      cx.textAlign = 'left';
      cx.fillText(etiqueta, largura + 7, mira.y);

      // E o tempo da vela debaixo do cursor, no eixo de baixo.
      const kMira = Math.round(direita - (largura - mira.x) / passo);
      if (kMira >= 0) {
        const rotuloT = rotuloTempoCompleto(tempoDaBarra(kMira), timeframe);
        cx.font = '10px ui-sans-serif, system-ui, sans-serif';
        const lt = cx.measureText(rotuloT).width + 12;
        const xt = limitar(mira.x - lt / 2, 0, largura - lt);
        cx.fillStyle = textoForte;
        arredondado(cx, xt, A - MARGEM_BAIXO + 2, lt, 17, 3);
        cx.fill();
        cx.fillStyle = superficie;
        cx.textAlign = 'center';
        cx.fillText(rotuloT, xt + lt / 2, A - MARGEM_BAIXO + 10.5);
      }
    }

    // Os botões só precisam de saber se a vista saiu do presente ou da escala
    // automática — actualiza-se o estado só quando isso MUDA, não a cada frame.
    const passado = v.desvio < DESVIO_PADRAO - 2;
    const manual = v.manual !== null;
    const alterado = passado || manual || Math.abs(v.espaco - largura / VELAS_PADRAO) > 0.5;
    const e0 = estadoRef.current;
    if (passado !== e0.passado || manual !== e0.manual || alterado !== e0.alterado) {
      estadoRef.current = { passado, manual, alterado };
      setEstadoVista({ passado, manual, alterado });
    }
  }, [velas, casas, linhas, zonas, curvas, marcadores, segmentos, mira, timeframe]);

  /*
   * Loop de animação.
   *
   * Sempre a correr enquanto o componente está montado e o separador visível.
   * Custa uma chamada por frame que na maior parte das vezes não faz nada
   * visível — mas é o que permite a escala deslizar e a mira acompanhar o dedo
   * sem um render do React por movimento.
   */
  useEffect(() => {
    let vivo = true;
    let id = 0;
    const ciclo = () => {
      if (!vivo) return;
      if (!document.hidden) desenhar();
      id = requestAnimationFrame(ciclo);
    };
    id = requestAnimationFrame(ciclo);
    return () => {
      vivo = false;
      cancelAnimationFrame(id);
    };
  }, [desenhar]);

  // Redesenha ao mudar de tamanho (rodar o telemóvel, entrar em ecrã inteiro).
  useEffect(() => {
    const el = caixa.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(() => desenhar());
    obs.observe(el);
    return () => obs.disconnect();
  }, [desenhar]);

  // --- interação ---------------------------------------------------------

  const posicao = (e: { clientX: number; clientY: number }) => {
    const r = caixa.current?.getBoundingClientRect();
    if (!r) return null;
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** Onde caiu o ponteiro: área das velas, eixo de preços ou eixo do tempo. */
  const zonaDe = (p: { x: number; y: number }) => {
    const g = geo.current;
    if (!g) return 'grafico' as const;
    if (p.x > g.largura) return 'eixo-preco' as const;
    if (p.y > g.alto - MARGEM_BAIXO) return 'eixo-tempo' as const;
    return 'grafico' as const;
  };

  const voltarAoPresente = useCallback(() => {
    const v = vista.current;
    v.espaco = 0;
    v.desvio = DESVIO_PADRAO;
    v.manual = null;
    v.inercia = 0;
  }, []);

  /** Aproxima (factor > 1) ou afasta em volta do x dado, mantendo essa vela no sítio. */
  const aproximar = useCallback((factor: number, x?: number) => {
    const g = geo.current;
    const v = vista.current;
    if (!g) return;
    const xa = x ?? g.largura;
    const barra = g.direita - (g.largura - xa) / v.espaco;
    v.espaco = limitar(v.espaco * factor, ESPACO_MIN, ESPACO_MAX);
    v.desvio = barra + (g.largura - xa) / v.espaco - (v.n - 1);
    v.inercia = 0;
  }, []);

  const comecarGesto = (p: { x: number; y: number }) => {
    const v = vista.current;
    const g = geo.current;
    v.inercia = 0;
    if (ponteiros.current.size >= 2 && g) {
      const [a, b] = [...ponteiros.current.values()];
      const xCentro = (a!.x + b!.x) / 2;
      gesto.current = {
        tipo: 'pinca',
        dist0: Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1,
        espaco0: v.espaco,
        xCentro,
        barra: g.direita - (g.largura - xCentro) / v.espaco,
      };
      return;
    }
    const zona = zonaDe(p);
    if (zona === 'eixo-preco' && g) {
      gesto.current = { tipo: 'eixo-preco', y0: p.y, escala0: v.manual ?? g.esc };
    } else if (zona === 'eixo-tempo') {
      gesto.current = { tipo: 'eixo-tempo', x0: p.x, espaco0: v.espaco };
    } else {
      gesto.current = { tipo: 'arrasto', x0: p.x, y0: p.y, desvio0: v.desvio, escala0: v.manual, rasto: [{ t: performance.now(), x: p.x }] };
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = posicao(e);
    if (!p) return;
    ponteiros.current.set(e.pointerId, p);
    comecarGesto(p);
    if (caixa.current && gesto.current?.tipo === 'arrasto') caixa.current.style.cursor = 'grabbing';
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = posicao(e);
    if (!p) return;
    const el = caixa.current;
    if (ponteiros.current.has(e.pointerId)) ponteiros.current.set(e.pointerId, p);
    const gs = gesto.current;
    const v = vista.current;
    const g = geo.current;

    if (!gs) {
      // Sem gesto: só a mira (rato), e o cursor diz o que o arrasto vai fazer.
      if (e.pointerType !== 'touch') setMira(p);
      if (el) {
        const z = zonaDe(p);
        el.style.cursor = z === 'eixo-preco' ? 'ns-resize' : z === 'eixo-tempo' ? 'ew-resize' : 'crosshair';
      }
      return;
    }
    if (!g) return;

    if (gs.tipo === 'pinca') {
      const [a, b] = [...ponteiros.current.values()];
      if (!a || !b) return;
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      v.espaco = limitar(gs.espaco0 * (d / gs.dist0), ESPACO_MIN, ESPACO_MAX);
      v.desvio = gs.barra + (g.largura - gs.xCentro) / v.espaco - (v.n - 1);
      return;
    }
    if (gs.tipo === 'eixo-preco') {
      // Arrastar para baixo comprime, para cima estica — a partir do meio.
      const f = Math.exp((p.y - gs.y0) * 0.006);
      const meio = (gs.escala0.min + gs.escala0.max) / 2;
      const meia = ((gs.escala0.max - gs.escala0.min) * f) / 2;
      v.manual = { min: meio - meia, max: meio + meia };
      return;
    }
    if (gs.tipo === 'eixo-tempo') {
      v.espaco = limitar(gs.espaco0 * Math.exp((p.x - gs.x0) * 0.006), ESPACO_MIN, ESPACO_MAX);
      return;
    }
    // Arrasto: horizontal sempre; vertical só com a escala fixada à mão.
    v.desvio = gs.desvio0 - (p.x - gs.x0) / v.espaco;
    if (gs.escala0) {
      const dp = ((p.y - gs.y0) / g.altoUtil) * (gs.escala0.max - gs.escala0.min);
      v.manual = { min: gs.escala0.min + dp, max: gs.escala0.max + dp };
    }
    const agora = performance.now();
    gs.rasto.push({ t: agora, x: p.x });
    while (gs.rasto.length > 2 && agora - gs.rasto[0]!.t > 90) gs.rasto.shift();
    setMira(null);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    ponteiros.current.delete(e.pointerId);
    const gs = gesto.current;
    const v = vista.current;
    if (gs?.tipo === 'arrasto' && gs.rasto.length >= 2) {
      // Inércia: a velocidade dos últimos ~90 ms continua depois de soltar.
      const a = gs.rasto[0]!;
      const b = gs.rasto[gs.rasto.length - 1]!;
      const dtr = b.t - a.t;
      if (dtr > 0 && performance.now() - b.t < 60) {
        const vel = -((b.x - a.x) / dtr) / v.espaco;
        if (Math.abs(vel) > 0.002) v.inercia = limitar(vel, -0.6, 0.6);
      }
    }
    gesto.current = null;
    // Da pinça para um dedo: continua como arrasto a partir daí.
    const resto = [...ponteiros.current.values()][0];
    if (resto) comecarGesto(resto);
    if (caixa.current) caixa.current.style.cursor = 'crosshair';
  };

  /*
   * Roda do rato ligada à mão, com `passive: false`: é a única forma de impedir
   * que a página role enquanto se aproxima o gráfico (o `onWheel` do React é
   * passivo). No trackpad, dois dedos na horizontal deslocam e a pinça (que o
   * browser entrega como roda com Ctrl) aproxima.
   */
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const h = (e: WheelEvent) => {
      const g = geo.current;
      if (!g) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      const v = vista.current;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && !e.ctrlKey) {
        v.desvio += e.deltaX / v.espaco;
        v.inercia = 0;
        return;
      }
      if (x > g.largura) {
        const esc = v.manual ?? g.esc;
        const f = Math.exp(e.deltaY * 0.002);
        const meio = (esc.min + esc.max) / 2;
        const meia = ((esc.max - esc.min) * f) / 2;
        v.manual = { min: meio - meia, max: meio + meia };
        return;
      }
      aproximar(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), x);
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, [aproximar]);

  // O cabeçalho mostra a vela debaixo da mira (como no TradingView), ou a última.
  const gCab = geo.current;
  const kCab = mira && gCab ? Math.round(gCab.direita - (gCab.largura - mira.x) / vista.current.espaco) : -1;
  const ultima = (kCab >= 0 && kCab < velas.length ? velas[kCab] : undefined) ?? velas[velas.length - 1];
  const primeira = gCab
    ? velas[limitar(Math.floor(gCab.direita - gCab.largura / vista.current.espaco), 0, velas.length - 1)]
    : velas[0];
  const pct =
    primeira && ultima && primeira.o ? ((ultima.c - primeira.o) / primeira.o) * 100 : null;

  return (
    <div className={`grafico ${cheio ? 'grafico--cheio' : ''}`}>
      <div className="grafico__barra">
        <div className="segmentos grafico__tfs">
          {TIMEFRAMES.filter((t) => !timeframes || timeframes.includes(t.id)).map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={t.id === timeframe}
              onClick={() => aoMudarTimeframe?.(t.id)}
              disabled={!aoMudarTimeframe}
            >
              {t.rotulo}
            </button>
          ))}
        </div>

        <div className="grafico__accoes">
          <button
            type="button"
            className="so-largo"
            onClick={() => aproximar(1 / 1.4)}
            aria-label="Afastar"
            title="Afastar"
          >
            −
          </button>
          <button
            type="button"
            className="so-largo"
            onClick={() => aproximar(1.4)}
            aria-label="Aproximar"
            title="Aproximar"
          >
            +
          </button>
          <button
            type="button"
            className="so-largo"
            onClick={voltarAoPresente}
            aria-label="Voltar ao presente"
            title="Voltar ao presente (e escala automática)"
            disabled={!estadoVista.alterado}
          >
            ⤒
          </button>
          {aoAlternarCheio && (
            <button
              type="button"
              onClick={aoAlternarCheio}
              aria-label={cheio ? 'Sair do ecrã inteiro' : 'Ecrã inteiro'}
              title={cheio ? 'Sair (Esc)' : 'Ecrã inteiro'}
            >
              {cheio ? '✕' : '⛶'}
            </button>
          )}
        </div>
      </div>

      {/* Leitura por cima do gráfico, como nas plataformas de referência. */}
      <div className="grafico__leitura">
        {titulo && <strong className="grafico__titulo">{titulo}</strong>}
        {ultima && (
          <>
            <span className="num-vivo grafico__ohlc">
              O {formatarPreco(ultima.o, casas)} · A {formatarPreco(ultima.h, casas)} · B{' '}
              {formatarPreco(ultima.l, casas)} · F {formatarPreco(ultima.c, casas)}
            </span>
            {pct !== null && (
              <span className={pct >= 0 ? 'bull-t' : 'bear-t'}>
                {pct >= 0 ? '+' : ''}
                {pct.toFixed(2)}%
              </span>
            )}
          </>
        )}
      </div>

      <div
        ref={caixa}
        className="grafico__tela"
        style={{ height: cheio ? undefined : altura }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          if (!gesto.current) setMira(null);
        }}
        // Duplo clique no eixo de preços: volta à escala automática. No resto do
        // gráfico: volta ao presente (no telemóvel substitui o botão ⤒).
        onDoubleClick={(e) => {
          const p = posicao(e);
          if (p && zonaDe(p) === 'eixo-preco') vista.current.manual = null;
          else voltarAoPresente();
        }}
      >
        <canvas ref={tela} />
        {estadoVista.passado && (
          <button
            type="button"
            className="grafico__presente"
            onClick={voltarAoPresente}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Voltar à última vela"
            title="Voltar à última vela"
          >
            »
          </button>
        )}
        {velas.length === 0 && (
          <div className="grafico__vazio">
            <span className="brilho" style={{ width: '100%', height: '100%', display: 'block' }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * O nome curto de uma linha, como nas ferramentas do TradingView/cTrader:
 * ENT, SL, TP 2.5R, POI, Ásia ▲. O rótulo completo continua no cartão.
 */
function curtoDaLinha(l: { rotulo: string; tipo: string; curto?: string }): string {
  if (l.curto) return l.curto;
  const r = l.rotulo.match(/(\d+(?:[.,]\d+)?R)\b/);
  if (l.tipo === 'entrada') return /pendente/i.test(l.rotulo) ? 'ENT ⏳' : 'ENT';
  if (l.tipo === 'stop') return 'SL';
  if (l.tipo === 'alvo') return r ? `TP ${r[1]}` : 'TP';
  if (l.tipo === 'poi') return 'POI';
  if (/máx\.? ?Ásia/i.test(l.rotulo)) return 'Ásia ▲';
  if (/mín\.? ?Ásia/i.test(l.rotulo)) return 'Ásia ▼';
  if (l.tipo === 'poc') return /alvo do dia/i.test(l.rotulo) ? 'DOL' : 'POC';
  return l.rotulo.length > 12 ? `${l.rotulo.slice(0, 11)}…` : l.rotulo;
}

function arredondado(
  cx: CanvasRenderingContext2D,
  x: number,
  y: number,
  l: number,
  a: number,
  r: number,
): void {
  cx.beginPath();
  cx.moveTo(x + r, y);
  cx.arcTo(x + l, y, x + l, y + a, r);
  cx.arcTo(x + l, y + a, x, y + a, r);
  cx.arcTo(x, y + a, x, y, r);
  cx.arcTo(x, y, x + l, y, r);
  cx.closePath();
}

/**
 * Aplica transparência a uma cor que pode vir em qualquer notação.
 *
 * As variáveis CSS deste projeto usam hexadecimal, mas nada garante que
 * continuem a usar. `color-mix` resolve o caso geral e o browser trata da
 * conversão — mais robusto do que partir a string em canais.
 */
function corComAlfa(cor: string, alfa: number): string {
  return `color-mix(in srgb, ${cor} ${Math.round(alfa * 100)}%, transparent)`;
}

/** Índice da vela com esta abertura, ou −1 (as velas vêm por ordem de tempo). */
function indiceDoTempo(velas: readonly Vela[], t: number): number {
  let lo = 0;
  let hi = velas.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    const tm = velas[m]!.t;
    if (tm === t) return m;
    if (tm < t) lo = m + 1;
    else hi = m - 1;
  }
  return -1;
}

/** O tempo completo da vela debaixo da mira: dia, mês e hora. */
function rotuloTempoCompleto(ms: number, tf: Timeframe): string {
  const d = new Date(ms);
  const dia = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  if (tf === '1d' || tf === '1w') return `${dia}/${d.getFullYear()}`;
  return `${dia} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function rotuloTempo(ms: number, tf: Timeframe): string {
  const d = new Date(ms);
  if (tf === '1d' || tf === '1w') {
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  if (tf === '4h' || tf === '1h') {
    return `${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}h`;
  }
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
