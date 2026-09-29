'use client';

/**
 * ICT ALGO — a secção do gráfico.
 *
 * Mostra a análise top-down inteira, não só a conclusão, pela mesma ordem com
 * que o algoritmo pensa:
 *
 *   1  a leitura      semanal → diário → execução → o que acabou de acontecer
 *   2  o regime       e os modelos do site que esse regime pede
 *   3  o setup        o modelo escolhido, com entrada, stop e alvo explicados
 *   4  os sete        o que cada modelo vê neste momento, e onde parou
 *   5  o placar       como cada modelo tem corrido NESTE instrumento
 *
 * Tudo é calculado sobre velas reais da Deriv, pedidas pelo próprio browser
 * (`lib/analise-browser.ts`). Nada é simulado, nada é aleatório, nada tem
 * preços escritos à mão — que era exactamente o que o painel anterior fazia.
 */

import { useEffect, useState } from 'react';
import type { AnaliseIct, ModeloIct, PassoTopDown, SinalIct, Varrimento } from '@trading/core';
import { NOME_MODELO, relogioLondres } from '@trading/core';
import { formatarPreco } from '@/lib/deriv/simbolos';
import { DESENHO_VAZIO, type Desenho } from '@/lib/visoes';
import { analisarIctBrowser } from '@/lib/analise-browser';
import type { PlanoParaOrdem } from './Negociar';
import type { RegistoIct } from './usarSinaisEnviados';

/**
 * O setup lê-se SEMPRE em 1H (pedido do Agnaldo, 29/09/2026); a confirmação e
 * o tiro saem em 15M, no motor (`ict/gatilho.ts`). Em qualquer gráfico, a
 * análise mostrada é a de 1H.
 */
export const tfDoIct = (_tf: string) => '1h';

const NOME_REGIME: Record<string, string> = {
  manipulacao: 'Manipulação',
  reversao: 'Reversão',
  tendencia: 'Tendência',
  consolidacao: 'Consolidação',
  indefinido: 'Indefinido',
};

/**
 * O que foi medido, para ninguém confundir esta análise com uma estratégia
 * validada. Números do backtest 2022–2026 com custos (scripts/backtest/ict-algo.mjs);
 * se o algoritmo mudar, isto tem de ser medido de novo e actualizado.
 */
export const MEDICAO_ICT =
  'Medido em 2022–2026, com custos: nenhuma combinação de modelo, regime e entrada teve vantagem nos mercados de controlo (15M, entrada no FVG: −0,39R por operação). Leia os setups como análise, não como sinais validados.';

interface Estado {
  chave: string;
  analise: AnaliseIct | null;
  erro: string | null;
  em: number;
}

/**
 * Calcula a análise ICT quando a secção está aberta, e renova-a a cada minuto —
 * o algoritmo decide sobre velas fechadas, e um minuto chega para apanhar o
 * fecho de uma vela de 15M. Entre fechos, as velas e a análise vêm da cache.
 */
export function usarIct(codigo: string, tf: string, activo: boolean): Estado | null {
  const tfIct = tfDoIct(tf);
  const chave = `${codigo}|${tfIct}`;
  const [estado, setEstado] = useState<Estado | null>(null);

  useEffect(() => {
    if (!activo) return;
    let cancelado = false;
    const pedir = async () => {
      try {
        const j = await analisarIctBrowser(codigo, tfIct as '15m' | '1h' | '4h');
        if (cancelado) return;
        setEstado({
          chave,
          analise: j.analise ?? null,
          erro: j.analise ? null : (j.porqueNao ?? 'sem análise'),
          em: j.em,
        });
      } catch (e) {
        if (!cancelado) setEstado({ chave, analise: null, erro: e instanceof Error ? e.message : String(e), em: Date.now() });
      }
    };
    void pedir();
    const id = setInterval(() => void pedir(), 60_000);
    return () => {
      cancelado = true;
      clearInterval(id);
    };
  }, [activo, chave, codigo, tfIct]);

  // Estado de outro instrumento ou timeframe não serve: seria desenhar o plano
  // de um gráfico no gráfico de outro (o bug da escala destruída).
  return estado && estado.chave === chave ? estado : null;
}

/** O que a secção desenha no gráfico. */
/** Uma vela, no mínimo que as caixas de sessão precisam. */
type VelaSimples = { time: number; high: number; low: number };

/** As sessões, em hora de Londres: [início, fim) em minutos do dia. */
const SESSOES = [
  { tipo: 'sessao-asia', rotulo: 'Ásia', de: 0, ate: 8 * 60 },
  { tipo: 'sessao-londres', rotulo: 'Londres', de: 8 * 60, ate: 13 * 60 },
  { tipo: 'sessao-ny', rotulo: 'Nova Iorque', de: 13 * 60, ate: 21 * 60 },
] as const;

/**
 * Caixas das sessões dos últimos `dias` dias: cada uma do máximo ao mínimo que
 * o preço fez dentro dela. É a leitura das notas "Estudos do JPY" — Ásia a
 * acumular, Londres a manipular e a distribuir, Nova Iorque a mudar a sessão.
 */
export function caixasDeSessao(velas: readonly VelaSimples[], dias: number): Desenho['zonas'] {
  type Caixa = { tipo: string; rotulo: string; de: number; ate: number; topo: number; base: number; dia: number };
  const out: Caixa[] = [];
  if (velas.length === 0) return [];
  const limite = velas[velas.length - 1]!.time - dias * 86_400_000;
  let actual: Caixa | null = null;
  for (const v of velas) {
    if (v.time < limite) continue;
    const l = relogioLondres(v.time);
    if (l.diaSemana === 6 || (l.diaSemana === 0 && l.minutos < 21 * 60)) continue;
    const sessao = SESSOES.find((s) => l.minutos >= s.de && l.minutos < s.ate);
    // Dia de calendário de Londres: o desvio face a UTC é 0 ou 60 minutos.
    const minutosUtc = new Date(v.time).getUTCHours() * 60 + new Date(v.time).getUTCMinutes();
    const desvioMin = (l.minutos - minutosUtc + 1440) % 1440;
    const dia = Math.floor((v.time + desvioMin * 60_000) / 86_400_000);
    if (!sessao) {
      if (actual) out.push(actual);
      actual = null;
      continue;
    }
    if (actual && actual.tipo === sessao.tipo && actual.dia === dia) {
      actual.ate = v.time;
      actual.topo = Math.max(actual.topo, v.high);
      actual.base = Math.min(actual.base, v.low);
    } else {
      if (actual) out.push(actual);
      actual = { tipo: sessao.tipo, rotulo: sessao.rotulo, de: v.time, ate: v.time, topo: v.high, base: v.low, dia };
    }
  }
  if (actual) out.push(actual);
  return out.map(({ dia: _dia, ...z }) => z);
}

const MS_TF: Record<string, number> = { '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '4h': 14_400_000 };

/** Um varrimento desenhado como no TradingView: do nível varrido ao pavio. */
function desenharVarrimento(d: Desenho, v: Varrimento, smt: boolean): void {
  const rotulo = smt ? 'SMT' : 'varrimento';
  const tipo = smt ? 'smt' : 'varrimento';
  if (v.poca.time < v.time) {
    d.segmentos!.push({ t0: v.poca.time, p0: v.poca.preco, t1: v.time, p1: v.extremo, rotulo, tipo });
  } else {
    d.marcas!.push({ t: v.time, p: v.extremo, rotulo, tipo });
  }
}

/**
 * Máximo e mínimo da última sessão asiática, como linhas que começam no fim da
 * Ásia. No journal do Notion, o alvo dos trades que chegaram ao T/P era quase
 * sempre este: "capturar a alta da sessão asiática", "SESSION HIGH".
 */
function linhasAsia(d: Desenho, caixas: Desenho['zonas'], ultima: number | undefined): void {
  const asia = [...caixas].reverse().find((z) => z.tipo === 'sessao-asia');
  // Com a Ásia ainda aberta, o máximo e o mínimo ainda não estão feitos.
  if (!asia || asia.ate === ultima) return;
  d.linhas.push({ preco: asia.topo, rotulo: 'máx. Ásia', tipo: 'nivel', de: asia.ate });
  d.linhas.push({ preco: asia.base, rotulo: 'mín. Ásia', tipo: 'nivel', de: asia.ate });
}

/**
 * Os dois POI do dia, como nos prints do journal:
 *
 *   · o POI DE ENTRADA — o order block por mitigar de onde o preço pode
 *     partir no sentido do viés (a caixa onde o preço reage), em zona;
 *   · o ALVO — a liquidez para onde Londres vai ("SESSION HIGH"): uma zona
 *     quando é um PD array, uma linha quando é uma poça de liquidez.
 */
export function desenharPoi(
  d: Desenho,
  poi: AnaliseIct['poi'] | null,
  entrada: AnaliseIct['poiEntrada'] | null = null,
): void {
  if (entrada && entrada.alto > entrada.baixo) {
    d.zonas.push({ de: entrada.desde, ate: Infinity, topo: entrada.alto, base: entrada.baixo, tipo: 'poi', rotulo: `POI · ${entrada.rotulo}` });
  }
  if (!poi) return;
  const rotulo = `alvo · ${poi.rotulo}`;
  if (poi.origem === 'pd-array' && poi.alto > poi.baixo) {
    d.zonas.push({ de: poi.desde, ate: Infinity, topo: poi.alto, base: poi.baixo, tipo: 'poi', rotulo });
  } else {
    d.linhas.push({ preco: poi.preco, rotulo, tipo: 'poi', de: poi.desde });
  }
}

/**
 * O que a secção desenha no gráfico — limpo, como nas notas do Notion:
 *
 *   · as caixas das sessões (Ásia, Londres, Nova Iorque)
 *   · com setup: a zona de entrada e três linhas curtas (entrada, stop, alvo)
 *     que começam no sinal, como a ferramenta de posição do TradingView
 *   · sem setup: só o alvo do dia (draw on liquidity)
 *   · duas marcas: o último varrimento ("SMT" quando houve divergência) e o MSS
 *
 * Nada mais. Os PD arrays e as poças de liquidez continuam na análise, por
 * escrito; no gráfico eram dezenas de linhas que tapavam o preço.
 */
export function desenhoIct(a: AnaliseIct | null, velas: readonly VelaSimples[] = [], tf = '1h'): Desenho {
  if (!a) return DESENHO_VAZIO;
  const intradiario = tf === '15m' || tf === '30m' || tf === '1h' || tf === '5m';
  const caixas = intradiario ? caixasDeSessao(velas, tf === '1h' ? 4 : 2) : [];
  const d: Desenho = {
    zonas: caixas,
    linhas: [],
    curvas: [],
    marcas: [],
    segmentos: [],
  };
  if (intradiario) linhasAsia(d, caixas, velas[velas.length - 1]?.time);
  desenharPoi(d, a.poi ?? null, a.poiEntrada ?? null);
  const s = a.sinal;

  if (s) {
    d.zonas.push({
      de: s.time,
      ate: Infinity,
      topo: s.zonaEntradaAlta,
      base: s.zonaEntradaBaixa,
      tipo: 'entrada',
      // Sem rótulo: o modelo já está no cartão por baixo, e no telemóvel o
      // texto tapava o "máx. Ásia", o BOS e a ENTRADA.
    });
    // Ferramenta de posição: caixa do alvo e caixa do risco, 24 velas de largura.
    const fim = s.time + 24 * (MS_TF[tf] ?? 3_600_000);
    d.zonas.push({
      de: s.time,
      ate: fim,
      topo: Math.max(s.entrada, s.alvo),
      base: Math.min(s.entrada, s.alvo),
      tipo: 'posicao-alvo',
    });
    d.zonas.push({
      de: s.time,
      ate: fim,
      topo: Math.max(s.entrada, s.stop),
      base: Math.min(s.entrada, s.stop),
      tipo: 'posicao-risco',
    });
    d.linhas.push({ preco: s.entrada, rotulo: `ENTRADA ${s.tipoEntrada === 'pendente' ? '(pendente)' : ''}`, tipo: 'entrada', de: s.time });
    d.linhas.push({ preco: s.stop, rotulo: 'STOP', tipo: 'stop', de: s.time });
    d.linhas.push({ preco: s.alvo, rotulo: `ALVO ${s.rr.toFixed(1)}R`, tipo: 'alvo', de: s.time });
    if (s.varrimento) desenharVarrimento(d, s.varrimento, s.modelo === 'venom');
    if (s.quebra) d.marcas!.push({ t: s.quebra.time, p: s.quebra.nivel, rotulo: s.quebra.tipo.toUpperCase(), tipo: 'mss' });
    return d;
  }

  if (a.vies?.dol && a.vies.dol.preco !== a.poi?.preco) {
    d.linhas.push({ preco: a.vies.dol.preco, rotulo: `alvo do dia · ${a.vies.dol.rotulo}`, tipo: 'poc' });
  }
  const v = a.regime?.ultimoVarrimento;
  if (v) desenharVarrimento(d, v, false);
  const q = a.regime?.ultimaQuebra;
  if (q) d.marcas!.push({ t: q.time, p: q.nivel, rotulo: q.tipo.toUpperCase(), tipo: 'mss' });
  return d;
}

const icone = (v: PassoTopDown['veredicto']) => (v === 'ok' ? '✓' : v === 'falhou' ? '✗' : '…');

export function Passos({ passos }: { passos: PassoTopDown[] }) {
  return (
    <ol className="ict__passos">
      {passos.map((p) => (
        <li key={`${p.numero}-${p.titulo}`} className={`ict__passo ict__passo--${p.veredicto}`}>
          <span className="ict__icone" aria-hidden="true">
            {icone(p.veredicto)}
          </span>
          <span className="ict__passo-texto">
            <b>
              {p.titulo}
              <em>{p.timeframe === 'tempo' ? 'relógio' : p.timeframe.toUpperCase()}</em>
            </b>
            <span>{p.detalhe}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function CartaoSinalIct({
  s,
  fmt,
  aoNegociar,
}: {
  s: SinalIct;
  fmt: (v: number) => string;
  aoNegociar?: (plano: PlanoParaOrdem) => void;
}) {
  const compra = s.direccao === 'bullish';
  return (
    <div className={`analise-viva__sinal ${compra ? 'compra' : 'venda'}`}>
      <div className="analise-viva__cab">
        <span className={`lado-pill ${compra ? 'compra' : 'venda'}`}>{compra ? 'COMPRA' : 'VENDA'}</span>
        <strong>ICT ALGO · {NOME_MODELO[s.modelo]}</strong>
        <span className="grow" />
        <span className="analise-viva__r">{s.rr.toFixed(1)}R</span>
      </div>
      <div className="analise-viva__nota">
        Leitura de 1H de agora. O sinal só é enviado quando o preço vier à zona e o 15M confirmar a reversão (o tiro).
      </div>
      <div className="analise-viva__estado vivo">
        Regime {NOME_REGIME[s.regime]?.toLowerCase()} ·{' '}
        {s.tipoEntrada === 'pendente' ? 'ordem pendente: entra no regresso do preço à zona' : 'entrada a mercado, no fecho da vela de rejeição'}
      </div>
      <div className="analise-viva__niveis">
        <div>
          <span>entrada</span>
          <b>{fmt(s.entrada)}</b>
        </div>
        <div className="stop">
          <span>stop</span>
          <b>{fmt(s.stop)}</b>
        </div>
        <div className="alvo">
          <span>alvo · {s.rr.toFixed(1)}R</span>
          <b>{fmt(s.alvo)}</b>
        </div>
      </div>
      <p className="analise-viva__razao">
        Zona {fmt(s.zonaEntradaBaixa)} – {fmt(s.zonaEntradaAlta)}. Stop no {s.rotuloStop}; alvo na {s.rotuloAlvo}.
      </p>
      {s.avisos.map((a) => (
        <p key={a} className="analise-viva__nota warn-t">
          {a}
        </p>
      ))}
      {aoNegociar && (
        <button
          type="button"
          className="btn ghost block"
          style={{ marginTop: 12 }}
          onClick={() =>
            aoNegociar({
              direccao: s.direccao,
              entrada: s.entrada,
              stop: s.stop,
              alvos: [{ preco: s.alvo, r: s.rr }],
              origem: `ICT ALGO · ${NOME_MODELO[s.modelo]}`,
              id: s.chave,
            })
          }
        >
          Levar este plano para a ordem
        </button>
      )}
    </div>
  );
}

const FIM_SETUP: Record<string, string> = {
  invalidado: 'invalidado',
  expirado: 'expirou',
  'tiro-fechado': 'tiro fechado',
};

/**
 * O setup FIXO que o motor está a seguir: armado numa vela de 1H, fica até
 * disparar o tiro em 15M, ser invalidado ou expirar — não muda com a análise
 * de agora. É daqui, e só daqui, que sai o sinal do ICT ALGO.
 */
function CartaoSetupFixo({
  r,
  fmt,
  aoNegociar,
}: {
  r: RegistoIct | null;
  fmt: (v: number) => string;
  aoNegociar?: (plano: PlanoParaOrdem) => void;
}) {
  const s = r?.setup;
  const e = r?.estado;
  const hist = [...(r?.historico ?? [])].reverse().slice(0, 3);
  const hora = (t: number) => new Date(t).toLocaleString('pt-PT', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  return (
    <div className="visoes__estruturas">
      <div className="visoes__subtitulo">Setup fixo 1H → tiro em 15M (o que o motor segue)</div>
      {!s || !e ? (
        <p className="analise-viva__nota">
          Nenhum setup armado. O motor arma um quando nasce um setup numa vela de 1H fechada, e fica com ele até ao tiro, à
          invalidação ou 24 h.
        </p>
      ) : (
        <div className={`analise-viva__sinal ${s.direccao === 'bullish' ? 'compra' : 'venda'}`}>
          <div className="analise-viva__cab">
            <span className={`lado-pill ${s.direccao === 'bullish' ? 'compra' : 'venda'}`}>
              {s.direccao === 'bullish' ? 'COMPRA' : 'VENDA'}
            </span>
            <strong>{s.modelo}</strong>
            <span className="grow" />
            <span className="faint">armado {hora(s.formadoEm)}</span>
          </div>
          <div className={`analise-viva__estado ${e.estado === 'disparado' ? 'vivo' : ''}`}>
            {e.estado === 'a-espera-da-zona'
              ? `À espera de que o preço venha à zona do 1H (válido até ${hora(s.expiraEm)}).`
              : e.estado === 'na-zona'
                ? `Na zona — ${e.detalhe}.`
                : e.estado === 'disparado'
                  ? `TIRO DISPARADO em 15M: ${e.tiro.detalhe}.`
                  : e.estado === 'invalidado'
                    ? `Invalidado: ${e.motivo}.`
                    : 'Expirou sem confirmação em 15M.'}
          </div>
          {e.estado === 'disparado' ? (
            <div className="analise-viva__niveis">
              <div>
                <span>entrada</span>
                <b>{fmt(e.tiro.entrada)}</b>
              </div>
              <div className="stop">
                <span>stop</span>
                <b>{fmt(e.tiro.stop)}</b>
              </div>
              <div className="alvo">
                <span>alvo · {e.tiro.rr.toFixed(1)}R</span>
                <b>{fmt(e.tiro.alvo)}</b>
              </div>
            </div>
          ) : (
            <p className="analise-viva__razao">
              Zona {fmt(s.zonaBaixa)} – {fmt(s.zonaAlta)} · stop do 1H {fmt(s.stop)} · alvo {fmt(s.alvo)} ({s.rotuloAlvo}).
            </p>
          )}
          <details className="ict__bloco">
            <summary>Porque este setup (de cima para baixo)</summary>
            <Passos passos={s.passos} />
          </details>
          {e.estado === 'disparado' && aoNegociar && (
            <button
              type="button"
              className="btn ghost block"
              style={{ marginTop: 12 }}
              onClick={() =>
                aoNegociar({
                  direccao: s.direccao,
                  entrada: e.tiro.entrada,
                  stop: e.tiro.stop,
                  alvos: [{ preco: e.tiro.alvo, r: e.tiro.rr }],
                  origem: `ICT ALGO · tiro 15M · ${s.modelo}`,
                  id: `${s.chave}|tiro`,
                })
              }
            >
              Levar o tiro para a ordem
            </button>
          )}
        </div>
      )}
      {hist.length > 0 && (
        <ul className="ict__modelos">
          {hist.map((h) => (
            <li key={`${h.setup.chave}-${h.em}`}>
              <span className="ict__icone" aria-hidden="true">
                ·
              </span>
              <span className="ict__passo-texto">
                <b>
                  {h.setup.direccao === 'bullish' ? 'compra' : 'venda'} · {h.setup.modelo}
                  <em>{FIM_SETUP[h.fim] ?? h.fim}</em>
                </b>
                <span className="faint">
                  armado {hora(h.setup.formadoEm)} — {h.detalhe}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function VisaoIct({
  estado,
  tf,
  casas,
  aoNegociar,
  fixo = null,
}: {
  estado: Estado | null;
  tf: string;
  casas: number;
  aoNegociar?: (plano: PlanoParaOrdem) => void;
  fixo?: RegistoIct | null;
}) {
  const fmt = (v: number) => formatarPreco(v, casas);
  if (!estado) {
    return (
      <div className="empty">
        <strong>A pedir a análise ICT ao servidor…</strong>
        Lê o semanal, o diário, a vela de referência e o {tfDoIct(tf).toUpperCase()}, e o par correlacionado. Demora alguns segundos.
      </div>
    );
  }
  const a = estado.analise;
  if (!a) {
    return (
      <div className="empty">
        <strong>ICT ALGO sem análise.</strong>
        {estado.erro}
      </div>
    );
  }

  const regime = a.regime;
  const modelosDoRegime = new Set<ModeloIct>(a.elegiveis);
  return (
    <div className="ict">
      <div className="ict__topo">
        <span className="ict__selo">ICT ALGO</span>
        {regime && <span className={`ict__regime ict__regime--${regime.regime}`}>{NOME_REGIME[regime.regime]}</span>}
        {regime?.direccao && (
          <span className={`lado-pill ${regime.direccao === 'bullish' ? 'compra' : 'venda'}`}>
            {regime.direccao === 'bullish' ? 'viés de alta' : 'viés de baixa'}
          </span>
        )}
        <span className="grow" />
        <span className="faint">{a.timeframe.toUpperCase()}</span>
      </div>
      {tf !== '1h' && (
        <p className="analise-viva__nota">
          O setup do ICT ALGO lê-se em 1H e o tiro sai em 15M; neste gráfico de {tf.toUpperCase()} mostra-se a leitura de 1H.
        </p>
      )}

      <CartaoSetupFixo r={fixo} fmt={fmt} aoNegociar={aoNegociar} />

      {(a.poiEntrada || a.poi) && (
        <p className="analise-viva__nota">
          {a.poiEntrada ? (
            <>
              POI de entrada ({a.poiEntrada.rotulo}): <b>{fmt(a.poiEntrada.baixo)}</b> – <b>{fmt(a.poiEntrada.alto)}</b>, de
              onde o preço pode partir
            </>
          ) : (
            'Sem order block por mitigar do lado do recuo'
          )}
          {a.poi ? (
            <>
              {' '}
              · alvo: <b>{fmt(a.poi.preco)}</b> ({a.poi.rotulo})
            </>
          ) : null}
        </p>
      )}

      {a.sinal ? (
        <CartaoSinalIct s={a.sinal} fmt={fmt} aoNegociar={aoNegociar} />
      ) : (
        <div className="empty">
          <strong>Sem setup novo em 1H neste momento.</strong>
          {a.porqueNao}
        </div>
      )}

      <div className="visoes__estruturas">
        <div className="visoes__subtitulo">Leitura de cima para baixo</div>
        <Passos passos={a.passos} />
      </div>

      {a.vies && (
        <details className="ict__bloco">
          <summary>
            Viés diário · {a.vies.aFavor} de 5 a favor
            {a.vies.direccao === 'bullish' ? ' da alta' : a.vies.direccao === 'bearish' ? ' da baixa' : ' (empate: sem viés)'}
          </summary>
          <ul className="ict__vies">
            {a.vies.respostas.map((r) => (
              <li key={r.pergunta}>
                <b className={r.resposta === 'bullish' ? 'bull-t' : r.resposta === 'bearish' ? 'bear-t' : 'faint'}>
                  {r.resposta === 'bullish' ? 'alta' : r.resposta === 'bearish' ? 'baixa' : '—'}
                </b>
                <span>
                  {r.pergunta} <em className="faint">{r.detalhe}</em>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <details className="ict__bloco">
        <summary>Os sete modelos, agora</summary>
        <ul className="ict__modelos">
          {a.modelos.map((m) => {
            const placar = a.placar.find((p) => p.modelo === m.modelo);
            return (
              <li key={m.modelo} className={modelosDoRegime.has(m.modelo) ? 'ict__modelo--elegivel' : ''}>
                <span className={`ict__icone ${m.sinal ? 'ict__icone--ok' : ''}`} aria-hidden="true">
                  {m.sinal ? '✓' : modelosDoRegime.has(m.modelo) ? '…' : '·'}
                </span>
                <span className="ict__passo-texto">
                  <b>
                    {NOME_MODELO[m.modelo]}
                    {a.escolhido === m.modelo && <em className="bull-t">escolhido</em>}
                    {modelosDoRegime.has(m.modelo) && a.escolhido !== m.modelo && <em>do regime</em>}
                    {placar?.quarentena && <em className="warn-t">quarentena</em>}
                  </b>
                  <span>
                    {m.sinal
                      ? `${m.sinal.direccao === 'bullish' ? 'compra' : 'venda'} em ${fmt(m.sinal.entrada)}, stop ${fmt(m.sinal.stop)}, alvo ${fmt(m.sinal.alvo)} (${m.sinal.rr.toFixed(1)}R)`
                      : `parou: ${m.porqueNao}`}
                  </span>
                  {placar && placar.n > 0 && (
                    <span className="faint">
                      neste instrumento: {placar.n} operações recentes, {placar.media >= 0 ? '+' : ''}
                      {placar.media.toFixed(2)}R em média
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </details>

      {a.avisos.map((x) => (
        <p key={x} className="analise-viva__nota">
          {x}
        </p>
      ))}
      <p className="analise-viva__nota ict__medicao">{MEDICAO_ICT}</p>
      <div className="analise-viva__rodape">
        Calculada no servidor às {new Date(estado.em).toLocaleTimeString('pt-PT')} sobre{' '}
        {Object.entries(a.lidas)
          .map(([t, n]) => `${n} velas ${t.toUpperCase()}`)
          .join(', ')}
        . Renova a cada minuto.
      </div>
    </div>
  );
}
