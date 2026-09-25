'use client';

/**
 * Asia Range Algo — a aba do gráfico.
 *
 * A análise vem do servidor (`/api/asia-range/<símbolo>`), a mesma que o motor
 * usa para gerar os sinais. Aqui só se mostra e se desenha, como nos prints do
 * journal: a caixa da Ásia, o POI de Londres, a linha do SMT do extremo
 * asiático ao pavio que o varreu, e a ferramenta de posição.
 */

import { useEffect, useState } from 'react';
import { AVISO_ASIA_RANGE, type AnaliseAsiaRange } from '@trading/core';
import { formatarPreco } from '@/lib/deriv/simbolos';
import { DESENHO_VAZIO, type Desenho } from '@/lib/visoes';
import type { PlanoParaOrdem } from './Negociar';
import { Passos, caixasDeSessao } from './VisaoIct';

const M15 = 900_000;

export interface EstadoAsiaRange {
  codigo: string;
  analise: AnaliseAsiaRange | null;
  erro: string | null;
  em: number;
}

/** Pede a análise quando a aba está aberta e renova-a a cada minuto. */
export function usarAsiaRange(codigo: string, activo: boolean): EstadoAsiaRange | null {
  const [estado, setEstado] = useState<EstadoAsiaRange | null>(null);
  useEffect(() => {
    if (!activo) return;
    let cancelado = false;
    const pedir = async () => {
      try {
        const r = await fetch(`/api/asia-range/${encodeURIComponent(codigo)}`, { cache: 'no-store' });
        const j = (await r.json()) as { analise?: AnaliseAsiaRange | null; porqueNao?: string; erro?: string; em?: number };
        if (cancelado) return;
        setEstado({
          codigo,
          analise: j.analise ?? null,
          erro: j.analise ? null : (j.porqueNao ?? j.erro ?? 'sem resposta do servidor'),
          em: j.em ?? Date.now(),
        });
      } catch (e) {
        if (!cancelado) setEstado({ codigo, analise: null, erro: e instanceof Error ? e.message : String(e), em: Date.now() });
      }
    };
    void pedir();
    const id = setInterval(() => void pedir(), 60_000);
    return () => {
      cancelado = true;
      clearInterval(id);
    };
  }, [activo, codigo]);
  return estado && estado.codigo === codigo ? estado : null;
}

/** O desenho da aba, sobre as velas do gráfico (em qualquer timeframe intradiário). */
export function desenhoAsiaRange(
  a: AnaliseAsiaRange | null,
  velas: readonly { time: number; high: number; low: number }[],
  tf: string,
): Desenho {
  if (!a) return DESENHO_VAZIO;
  const intradiario = tf === '5m' || tf === '15m' || tf === '30m' || tf === '1h';
  const d: Desenho = {
    zonas: intradiario ? caixasDeSessao(velas, tf === '1h' ? 4 : 2).filter((z) => z.tipo !== 'sessao-asia') : [],
    linhas: [],
    curvas: [],
    marcas: [],
    segmentos: [],
  };
  if (a.asia) {
    d.zonas.push({ de: a.asia.de, ate: a.asia.ate + M15, topo: a.asia.alto, base: a.asia.baixo, tipo: 'sessao-asia', rotulo: 'Ásia' });
    d.linhas.push({ preco: a.asia.alto, rotulo: 'máx. Ásia', tipo: 'nivel', de: a.asia.ate + M15 });
    d.linhas.push({ preco: a.asia.baixo, rotulo: 'mín. Ásia', tipo: 'nivel', de: a.asia.ate + M15 });
  }
  if (a.poi) {
    const rotulo = `POI Londres · ${a.poi.rotulo}`;
    if (a.poi.origem === 'pd-array' && a.poi.alto > a.poi.baixo) {
      d.zonas.push({ de: a.poi.desde, ate: Infinity, topo: a.poi.alto, base: a.poi.baixo, tipo: 'poi', rotulo });
    } else {
      d.linhas.push({ preco: a.poi.preco, rotulo, tipo: 'poi', de: a.poi.desde });
    }
  }
  const s = a.sinal;
  if (s) {
    const fim = s.time + 24 * M15;
    d.zonas.push({ de: s.time, ate: fim, topo: Math.max(s.entrada, s.alvo), base: Math.min(s.entrada, s.alvo), tipo: 'posicao-alvo' });
    d.zonas.push({ de: s.time, ate: fim, topo: Math.max(s.entrada, s.stop), base: Math.min(s.entrada, s.stop), tipo: 'posicao-risco' });
    d.linhas.push({ preco: s.entrada, rotulo: 'ENTRADA', tipo: 'entrada', de: s.time });
    d.linhas.push({ preco: s.stop, rotulo: 'STOP', tipo: 'stop', de: s.time });
    d.linhas.push({ preco: s.alvo, rotulo: `ALVO ${s.rr.toFixed(1)}R`, tipo: 'alvo', de: s.time });
    d.segmentos!.push({
      t0: s.varrimento.nivelTime,
      p0: s.varrimento.nivel,
      t1: s.varrimento.time,
      p1: s.varrimento.extremo,
      rotulo: 'SMT',
      tipo: 'smt',
    });
    d.marcas!.push({ t: s.mss.time, p: s.mss.nivel, rotulo: 'MSS', tipo: 'mss' });
  }
  return d;
}

export function VisaoAsiaRange({
  estado,
  casas,
  aoNegociar,
}: {
  estado: EstadoAsiaRange | null;
  casas: number;
  aoNegociar?: (plano: PlanoParaOrdem) => void;
}) {
  const fmt = (v: number) => formatarPreco(v, casas);
  if (!estado) {
    return (
      <div className="empty">
        <strong>A pedir a análise ao servidor…</strong>
        Asia Range Algo: Ásia, varrimento em Londres, SMT e MSS, em 15M.
      </div>
    );
  }
  const a = estado.analise;
  if (!a) {
    return (
      <div className="empty">
        <strong>Asia Range Algo sem análise.</strong>
        {estado.erro}
      </div>
    );
  }
  const s = a.sinal;
  return (
    <div className="ict">
      <div className="ict__topo">
        <span className="ict__selo">ASIA RANGE ALGO</span>
        {a.vies && a.vies.direccao !== 'neutral' && (
          <span className={`lado-pill ${a.vies.direccao === 'bullish' ? 'compra' : 'venda'}`}>
            {a.vies.direccao === 'bullish' ? 'viés de alta' : 'viés de baixa'}
          </span>
        )}
        <span className="grow" />
        <span className="faint">15M{a.par ? ` · SMT contra ${a.par}` : ''}</span>
      </div>

      {a.asia && (
        <p className="analise-viva__nota">
          Ásia (00:00–08:00 Londres): <b>{fmt(a.asia.baixo)}</b> – <b>{fmt(a.asia.alto)}</b>
          {a.poi ? (
            <>
              {' '}
              · POI de Londres: <b>{fmt(a.poi.preco)}</b> ({a.poi.rotulo})
            </>
          ) : null}
        </p>
      )}

      {s ? (
        <div className={`analise-viva__sinal ${s.direccao === 'bullish' ? 'compra' : 'venda'}`}>
          <div className="analise-viva__cab">
            <span className={`lado-pill ${s.direccao === 'bullish' ? 'compra' : 'venda'}`}>
              {s.direccao === 'bullish' ? 'COMPRA' : 'VENDA'}
            </span>
            <strong>Asia Range Algo</strong>
            <span className="grow" />
            <span className="analise-viva__r">{s.rr.toFixed(1)}R</span>
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
            Stop no extremo da manipulação; alvo na {s.rotuloAlvo}.
          </p>
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
                  origem: 'Asia Range Algo',
                  id: s.chave,
                })
              }
            >
              Levar este plano para a ordem
            </button>
          )}
        </div>
      ) : (
        <div className="empty">
          <strong>Sem setup neste momento.</strong>
          {a.porqueNao}
        </div>
      )}

      <div className="visoes__estruturas">
        <div className="visoes__subtitulo">Passos</div>
        <Passos passos={a.passos} />
      </div>
      <p className="analise-viva__nota faint">{AVISO_ASIA_RANGE}</p>
    </div>
  );
}
