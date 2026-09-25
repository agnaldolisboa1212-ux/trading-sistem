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
 *   · arrastar desloca, roda do rato e pinça aproximam
 *   · a mira segue o dedo/rato com etiquetas de preço e de tempo
 *
 * ── CORES ──────────────────────────────────────────────────────────────────
 *
 * Lidas do CSS com `getComputedStyle` em vez de fixadas aqui. Assim o gráfico
 * acompanha o tema (claro/escuro) sem duplicar a paleta em JavaScript, e sem
 * ficar dessincronizado quando a paleta mudar.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Vela } from '@/lib/deriv/live';
import { formatarPreco, TIMEFRAMES, type Timeframe } from '@/lib/deriv/simbolos';

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
  linhas?: Array<{ preco: number; rotulo: string; tipo: string; de?: number }>;
  /** Marcas pontuais (SMT, MSS, varrimento) num instante e preço. */
  marcadores?: Array<{ t: number; p: number; rotulo: string; tipo: string }>;
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

export function GraficoVivo({
  velas,
  casas,
  timeframe,
  zonas = [],
  linhas = [],
  curvas = [],
  marcadores = [],
  timeframes,
  altura = 340,
  aoMudarTimeframe,
  cheio = false,
  aoAlternarCheio,
  titulo,
}: GraficoVivoProps) {
  const caixa = useRef<HTMLDivElement | null>(null);
  const tela = useRef<HTMLCanvasElement | null>(null);

  /** Quantas velas cabem no ecrã. Estado porque os botões de zoom mexem nele. */
  const [visiveis, setVisiveis] = useState(90);
  /** Quantas velas de deslocamento a partir do fim. 0 = colado ao presente. */
  const [recuo, setRecuo] = useState(0);
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
  const arrasto = useRef<{ x: number; recuo: number } | null>(null);
  const pinca = useRef<{ dist: number; visiveis: number } | null>(null);

  const janela = useMemo(() => {
    const fim = Math.max(1, velas.length - recuo);
    const inicio = Math.max(0, fim - visiveis);
    return velas.slice(inicio, fim);
  }, [velas, visiveis, recuo]);

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
    const alvo: Escala = { min: min - folga, max: max + folga };

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

    if (!Number.isFinite(a.min) || Math.abs(a.max - a.min) < 1e-12 || saltoGrande) {
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

    const largura = L - MARGEM_DIR;
    const altoUtil = A - MARGEM_BAIXO - MARGEM_TOPO;
    const y = (p: number) =>
      MARGEM_TOPO + ((esc.max - p) / (esc.max - esc.min || 1)) * altoUtil;
    const passo = largura / janela.length;
    const larguraVela = Math.max(1, Math.min(14, passo * 0.68));

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

    // --- zonas (oferta/procura, níveis, value area, FVG) -----------------
    const corDoTipo = (tipo: string) =>
      tipo.includes('bull')
        ? alta
        : tipo.includes('bear')
          ? baixa
          : tipo === 'entrada'
            ? acento
            : texto;
    for (const z of zonas) {
      const i0 = janela.findIndex((v) => v.t >= z.de);
      const antes = janela[0] && z.de < janela[0].t;
      if (i0 === -1 && !antes) continue;
      const i1 = Number.isFinite(z.ate) ? janela.findIndex((v) => v.t > z.ate) : -1;
      if (Number.isFinite(z.ate) && janela[0] && z.ate < janela[0].t) continue;
      const x0 = antes ? 0 : i0 * passo;
      const x1 = (i1 === -1 ? janela.length : i1) * passo;
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
      const base = corDoTipo(z.tipo);
      cx.fillStyle = corComAlfa(base, z.tipo === 'entrada' ? 0.14 : 0.1);
      cx.fillRect(x0, yTopo, Math.max(2, x1 - x0), alturaZona);
      if (z.rotulo) {
        cx.fillStyle = corComAlfa(base, 0.9);
        cx.font = '9.5px ui-sans-serif, system-ui, sans-serif';
        cx.textAlign = 'right';
        cx.textBaseline = 'top';
        cx.fillText(z.rotulo, largura - 4, yTopo + 2);
        cx.textBaseline = 'middle';
      }
    }

    // --- curvas (VWAP e bandas) -----------------------------------------
    if (curvas.length > 0 && janela.length > 1) {
      const indice = new Map(janela.map((v, i) => [v.t, i]));
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
          const xx = i * passo + passo / 2;
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
    janela.forEach((v, i) => {
      const x = i * passo + passo / 2;
      const sobe = v.c >= v.o;
      const c = sobe ? alta : baixa;
      cx.strokeStyle = c;
      cx.fillStyle = c;

      // Mecha
      cx.lineWidth = Math.max(1, larguraVela * 0.16);
      cx.beginPath();
      cx.moveTo(Math.round(x) + 0.5, y(v.h));
      cx.lineTo(Math.round(x) + 0.5, y(v.l));
      cx.stroke();

      // Corpo. Um doji tem altura zero e desapareceria — força-se 1 px.
      const topo = y(Math.max(v.o, v.c));
      const alturaCorpo = Math.max(1, Math.abs(y(v.o) - y(v.c)));
      cx.fillRect(x - larguraVela / 2, topo, larguraVela, alturaCorpo);
    });

    // --- linhas da análise ------------------------------------------------
    for (const l of linhas) {
      // Com `de`, a linha começa no instante do plano (como a ferramenta de
      // posição do TradingView) em vez de atravessar o gráfico inteiro.
      let xInicio = 0;
      if (l.de !== undefined && janela.length > 0) {
        if (l.de > janela[janela.length - 1]!.t) continue;
        const k = janela.findIndex((v) => v.t >= l.de!);
        xInicio = l.de < janela[0]!.t || k < 0 ? 0 : k * passo + passo / 2;
      }
      const yy = Math.round(y(l.preco)) + 0.5;
      cx.strokeStyle =
        l.tipo === 'stop'
          ? baixa
          : l.tipo === 'alvo'
            ? alta
            : l.tipo === 'poc'
              ? aviso
              : l.tipo === 'nivel'
                ? texto
                : acento;
      cx.lineWidth = l.tipo === 'poc' || l.tipo === 'entrada' ? 1.4 : 1;
      cx.setLineDash(l.tipo === 'poc' ? [] : [5, 4]);
      cx.beginPath();
      cx.moveTo(xInicio, yy);
      cx.lineTo(largura, yy);
      cx.stroke();
      cx.setLineDash([]);
      cx.fillStyle = cx.strokeStyle;
      cx.textAlign = 'left';
      cx.font = '9.5px ui-sans-serif, system-ui, sans-serif';
      cx.fillText(l.rotulo, Math.min(xInicio + 4, largura - 60), yy - 6);
    }

    // --- marcadores (SMT, MSS, varrimento) ------------------------------
    for (const m of marcadores) {
      if (janela.length === 0 || m.t < janela[0]!.t || m.t > janela[janela.length - 1]!.t) continue;
      const k = janela.findIndex((v) => v.t >= m.t);
      if (k < 0) continue;
      const mx = k * passo + passo / 2;
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
    const ultima = janela[janela.length - 1];
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
    const marcas = Math.max(2, Math.floor(largura / 78));
    for (let i = 0; i < marcas; i++) {
      const idx = Math.floor((i * (janela.length - 1)) / (marcas - 1 || 1));
      const v = janela[idx];
      if (!v) continue;
      const x = Math.min(largura - 20, Math.max(20, idx * passo + passo / 2));
      cx.fillText(rotuloTempo(v.t, timeframe), x, A - 8);
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
    }
  }, [janela, casas, linhas, zonas, curvas, marcadores, mira, timeframe]);

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

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    arrasto.current = { x: e.clientX, recuo };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = posicao(e);
    if (p) setMira(p);

    const a = arrasto.current;
    if (!a) return;
    const largura = (caixa.current?.clientWidth ?? 1) - MARGEM_DIR;
    const passo = largura / Math.max(1, visiveis);
    const delta = Math.round((e.clientX - a.x) / passo);
    const max = Math.max(0, velas.length - 10);
    setRecuo(Math.min(max, Math.max(0, a.recuo + delta)));
  };

  const onPointerUp = () => {
    arrasto.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    // Sem `preventDefault`: o React liga o `wheel` como passivo e chamá-lo
    // dispara um aviso na consola. Limita-se a ajustar o zoom.
    const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    setVisiveis((v) => Math.round(Math.min(600, Math.max(20, v * factor))));
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      pinca.current = { dist: distancia(e.touches), visiveis };
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinca.current) {
      const d = distancia(e.touches);
      const r = pinca.current.dist / (d || 1);
      setVisiveis(Math.round(Math.min(600, Math.max(20, pinca.current.visiveis * r))));
    }
  };

  const onTouchEnd = () => {
    pinca.current = null;
  };

  const ultima = janela[janela.length - 1];
  const primeira = janela[0];
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
            onClick={() => setVisiveis((v) => Math.min(600, Math.round(v * 1.4)))}
            aria-label="Afastar"
            title="Afastar"
          >
            −
          </button>
          <button
            type="button"
            className="so-largo"
            onClick={() => setVisiveis((v) => Math.max(20, Math.round(v / 1.4)))}
            aria-label="Aproximar"
            title="Aproximar"
          >
            +
          </button>
          <button
            type="button"
            className="so-largo"
            onClick={() => {
              setRecuo(0);
              setVisiveis(90);
            }}
            aria-label="Voltar ao presente"
            title="Voltar ao presente"
            disabled={recuo === 0 && visiveis === 90}
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
        onPointerLeave={() => {
          onPointerUp();
          setMira(null);
        }}
        onWheel={onWheel}
        // Toque duplo (ou duplo clique) volta ao presente: no telemóvel é o que
        // substitui o botão ⤒, que não cabe ao lado dos timeframes.
        onDoubleClick={() => {
          setRecuo(0);
          setVisiveis(90);
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <canvas ref={tela} />
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

function distancia(t: React.TouchList): number {
  const a = t[0];
  const b = t[1];
  if (!a || !b) return 0;
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
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
