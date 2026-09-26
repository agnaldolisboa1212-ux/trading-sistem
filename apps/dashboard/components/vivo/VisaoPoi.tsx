'use client';

/**
 * POI de Londres — a aba dos alertas de POI.
 *
 * Desenha o que o motor vigia para os avisos (`apps/engine/.../alertas-poi.ts`):
 * os POI do dia (topos/fundos de 15M dos últimos 3 dias por tocar, a zona da
 * vela do extremo), do lado da estrutura de 15M, a Ásia, a liquidez do lado
 * oposto e os toques na janela das 08:00–11:00 de Londres. As velas vêm pela
 * ligação do browser à Deriv; o cálculo é o `poisDeSessao` do core, o mesmo do
 * motor.
 *
 * Não é um sinal: a entrada (MSS + OB em 1M) é decisão de quem opera.
 */

import { useEffect, useState } from 'react';
import { poisDeSessao, relogioLondres, toquesPoi, type LeituraPoi, type ToquePoi } from '@trading/core';
import { acharSimbolo, formatarPreco } from '@/lib/deriv/simbolos';
import { velasFechadasBrowser } from '@/lib/deriv/velas-browser';
import { DESENHO_VAZIO, type Desenho } from '@/lib/visoes';

export interface EstadoPoi {
  codigo: string;
  leitura: LeituraPoi | null;
  toques: ToquePoi[];
  erro: string | null;
  em: number;
}

/** Calcula os POI quando a aba está aberta e renova a cada minuto. */
export function usarPoi(codigo: string, activo: boolean): EstadoPoi | null {
  const [estado, setEstado] = useState<EstadoPoi | null>(null);
  useEffect(() => {
    if (!activo) return;
    let cancelado = false;
    const pedir = async () => {
      const em = Date.now();
      const s = acharSimbolo(codigo.toUpperCase());
      if (!s) {
        setEstado({ codigo, leitura: null, toques: [], erro: 'instrumento desconhecido', em });
        return;
      }
      try {
        const v15 = await velasFechadasBrowser(s.deriv, 900, 800);
        const agora = Date.now();
        const leitura = poisDeSessao(v15, agora);
        let toques: ToquePoi[] = [];
        if (leitura && !leitura.provisoria && agora < leitura.fim + 60 * 60_000) {
          const v1 = await velasFechadasBrowser(s.deriv, 60, 240);
          toques = toquesPoi(leitura, v1, Date.now());
        }
        if (!cancelado) {
          setEstado({
            codigo,
            leitura,
            toques,
            erro: leitura ? null : 'Sem história de 15M suficiente para os POI (são precisos 3 dias de negociação).',
            em,
          });
        }
      } catch (e) {
        if (!cancelado) {
          setEstado({ codigo, leitura: null, toques: [], erro: `Falha a obter as velas: ${e instanceof Error ? e.message : String(e)}`, em });
        }
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

const NOME_QUEBRA: Record<string, string> = { bos: 'BOS', choch: 'CHoCH', mss: 'MSS' };

export function desenhoPoi(e: EstadoPoi | null): Desenho {
  const l = e?.leitura;
  if (!l) return DESENHO_VAZIO;
  const d: Desenho = { zonas: [], linhas: [], curvas: [], marcas: [], segmentos: [] };
  if (l.asia) {
    d.zonas.push({ de: l.asia.de, ate: l.asia.ate, topo: l.asia.alto, base: l.asia.baixo, tipo: 'sessao-asia', rotulo: 'Ásia' });
  }
  for (const z of l.pois) {
    d.zonas.push({ de: z.origem, ate: Infinity, topo: z.alto, base: z.baixo, tipo: 'poi', rotulo: `POI · ${z.lado}` });
  }
  for (const q of l.liquidezOposta.slice(0, 2)) {
    d.linhas.push({ preco: q.preco, rotulo: `liquidez · ${q.rotulo}`, tipo: 'alvo', de: l.inicio });
  }
  d.marcas!.push({ t: l.estrutura.time, p: l.estrutura.nivel, rotulo: NOME_QUEBRA[l.estrutura.tipo] ?? l.estrutura.tipo, tipo: 'mss' });
  for (const t of e.toques) d.marcas!.push({ t: t.em, p: t.preco, rotulo: 'toque no POI', tipo: 'entrada' });
  return d;
}

function hora(t: number): string {
  const r = relogioLondres(t);
  return `${String(r.hora).padStart(2, '0')}:${String(r.minuto).padStart(2, '0')}`;
}

export function VisaoPoi({ estado, casas }: { estado: EstadoPoi | null; casas: number }) {
  const fmt = (v: number) => formatarPreco(v, casas);
  if (!estado) {
    return (
      <div className="empty">
        <strong>A calcular os POI…</strong>
        Topos e fundos de 15M dos últimos 3 dias, do lado da estrutura.
      </div>
    );
  }
  const l = estado.leitura;
  if (!l) {
    return (
      <div className="empty">
        <strong>POI indisponíveis.</strong>
        {estado.erro}
      </div>
    );
  }
  const venda = l.vies === 'bearish';
  const agora = Date.now();
  const janela = agora < l.inicio ? 'antes da janela' : agora < l.fim ? 'janela aberta' : 'janela fechada';
  return (
    <div className="ict">
      <div className="ict__topo">
        <span className="ict__selo">POI DE LONDRES</span>
        <span className={`lado-pill ${venda ? 'venda' : 'compra'}`}>{venda ? 'estrutura de baixa' : 'estrutura de alta'}</span>
        <span className="grow" />
        <span className="faint">15M · 08:00–11:00 Londres · {janela}</span>
      </div>

      <p className="analise-viva__nota">
        Último {NOME_QUEBRA[l.estrutura.tipo] ?? l.estrutura.tipo} às {hora(l.estrutura.time)} em <b>{fmt(l.estrutura.nivel)}</b>
        {l.asia ? (
          <>
            {' '}
            · Ásia <b>{fmt(l.asia.baixo)}</b> – <b>{fmt(l.asia.alto)}</b>
          </>
        ) : null}
        {l.provisoria ? ' · leitura provisória até às 08:00' : ''}
      </p>

      {l.pois.length === 0 ? (
        <div className="empty">
          <strong>Sem POI por tocar do lado da estrutura.</strong>
          Hoje não há alerta de POI para este instrumento.
        </div>
      ) : (
        <div className="visoes__estruturas">
          <div className="visoes__subtitulo">POI {venda ? 'acima do preço (vendas)' : 'abaixo do preço (compras)'}</div>
          {l.pois.map((z) => {
            const t = estado.toques.find((x) => x.zona.chave === z.chave);
            return (
              <p key={z.chave} className="analise-viva__nota">
                <b>
                  {fmt(z.baixo)} – {fmt(z.alto)}
                </b>{' '}
                · {venda ? 'topo' : 'fundo'} de {new Date(z.origem).toLocaleString('pt-PT', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })}
                {t ? (t.invalido ? ` · passado às ${hora(t.em)} (já não vale)` : ` · TOCADO às ${hora(t.em)}`) : ' · por tocar'}
              </p>
            );
          })}
        </div>
      )}

      {l.liquidezOposta.length > 0 && (
        <p className="analise-viva__nota">
          Liquidez do lado oposto:{' '}
          {l.liquidezOposta.slice(0, 3).map((q, i) => (
            <span key={q.preco}>
              {i > 0 ? ' · ' : ''}
              <b>{fmt(q.preco)}</b> ({q.rotulo})
            </span>
          ))}
        </p>
      )}

      <p className="analise-viva__nota faint">
        Alerta, não sinal: quando o preço entra num destes POI na janela de Londres, chega um aviso por Telegram e push. A
        entrada — reversão em 1M (MSS + OB), stop além do POI — é sua. As regras mecânicas de entrada sobre estes POI não
        tiveram vantagem no backtest 2022–2026.
      </p>
    </div>
  );
}
