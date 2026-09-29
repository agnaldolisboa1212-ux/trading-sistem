'use client';

/**
 * Os sinais que o motor JÁ ENVIOU e o setup fixo do ICT ALGO — para o gráfico
 * os continuar a mostrar depois de a análise de agora ter mudado (pedido do
 * Agnaldo, 29/09/2026: "depois de disparados o algoritmo muda o setup e no
 * gráfico não é possível ver os sinais dados").
 */

import { useEffect, useState } from 'react';
import type { EstadoSetup, SetupFixo } from '@trading/core';
import type { Desenho } from '@/lib/visoes';

export interface SinalEnviado {
  id: string;
  simbolo: string;
  timeframe: string;
  estrategia: string;
  direccao: 'bullish' | 'bearish';
  entrada: number;
  stop: number;
  alvos: Array<{ preco: number; r: number }>;
  geradoEm: string;
  estado: string | null;
  resultadoR: number | null;
}

export interface RegistoIct {
  setup: SetupFixo | null;
  estado: EstadoSetup | null;
  historico: Array<{ setup: SetupFixo; fim: string; em: number; detalhe: string }>;
}

/** Os sinais enviados deste instrumento nos últimos dias, renovados a cada minuto. */
export function usarSinaisEnviados(codigo: string, activo: boolean): SinalEnviado[] {
  const [lista, setLista] = useState<SinalEnviado[]>([]);
  useEffect(() => {
    if (!activo) return;
    let cancelado = false;
    const pedir = async () => {
      try {
        const r = await fetch('/api/sinais', { cache: 'no-store' });
        const j = (await r.json()) as { sinais?: SinalEnviado[] };
        if (!cancelado) setLista((j.sinais ?? []).filter((s) => s.simbolo.toUpperCase() === codigo.toUpperCase()));
      } catch {
        /* a lista fica como estava */
      }
    };
    void pedir();
    const id = setInterval(() => void pedir(), 60_000);
    return () => {
      cancelado = true;
      clearInterval(id);
    };
  }, [activo, codigo]);
  return lista;
}

/** O setup fixo do ICT ALGO que o motor está a seguir neste instrumento. */
export function usarIctFixo(codigo: string, activo: boolean): RegistoIct | null {
  const [registo, setRegisto] = useState<{ codigo: string; r: RegistoIct | null } | null>(null);
  useEffect(() => {
    if (!activo) return;
    let cancelado = false;
    const pedir = async () => {
      try {
        const r = await fetch(`/api/ict/fixos?s=${encodeURIComponent(codigo)}`, { cache: 'no-store' });
        const j = (await r.json()) as { registo?: RegistoIct | null };
        if (!cancelado) setRegisto({ codigo, r: j.registo ?? null });
      } catch {
        /* fica como estava */
      }
    };
    void pedir();
    const id = setInterval(() => void pedir(), 60_000);
    return () => {
      cancelado = true;
      clearInterval(id);
    };
  }, [activo, codigo]);
  return registo && registo.codigo === codigo ? registo.r : null;
}

const HORAS_48 = 48 * 3_600_000;
const hora = (t: number) => new Date(t).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

/** Os sinais enviados desta estratégia nas últimas 48 h, desenhados como a ferramenta de posição. */
export function desenhoEnviados(sinais: readonly SinalEnviado[], estrategia: string): Desenho {
  const d: Desenho = { zonas: [], linhas: [], curvas: [], marcas: [], segmentos: [] };
  const agora = Date.now();
  for (const s of sinais) {
    if (s.estrategia !== estrategia) continue;
    const t = Date.parse(s.geradoEm);
    if (!(agora - t <= HORAS_48)) continue;
    const venda = s.direccao === 'bearish';
    const alvo = s.alvos[0]?.preco;
    const lado = venda ? 'VENDA' : 'COMPRA';
    d.linhas.push({ preco: s.entrada, rotulo: `${lado} ${hora(t)} · entrada`, tipo: 'entrada', de: t });
    d.linhas.push({ preco: s.stop, rotulo: 'stop', tipo: 'stop', de: t });
    if (alvo !== undefined) d.linhas.push({ preco: alvo, rotulo: `alvo ${s.alvos[0]!.r.toFixed(1)}R`, tipo: 'alvo', de: t });
    d.marcas!.push({ t, p: s.entrada, rotulo: `sinal ${lado}`, tipo: 'entrada' });
  }
  return d;
}

/** O setup fixo (zona, stop e alvo do 1H) e o tiro, se já saiu. */
export function desenhoIctFixo(r: RegistoIct | null): Desenho {
  const d: Desenho = { zonas: [], linhas: [], curvas: [], marcas: [], segmentos: [] };
  const s = r?.setup;
  if (!s) return d;
  d.zonas.push({ de: s.formadoEm, ate: s.expiraEm, topo: s.zonaAlta, base: s.zonaBaixa, tipo: 'poi', rotulo: `setup fixo 1H · ${s.direccao === 'bearish' ? 'venda' : 'compra'}` });
  d.linhas.push({ preco: s.stop, rotulo: 'stop do 1H', tipo: 'stop', de: s.formadoEm });
  d.linhas.push({ preco: s.alvo, rotulo: `alvo · ${s.rotuloAlvo}`, tipo: 'alvo', de: s.formadoEm });
  if (r?.estado?.estado === 'disparado') {
    const t = r.estado.tiro;
    d.marcas!.push({ t: t.time, p: t.entrada, rotulo: 'TIRO 5M', tipo: 'entrada' });
  }
  return d;
}

/** Junta desenhos. */
export function juntarDesenhos(...ds: Desenho[]): Desenho {
  return {
    zonas: ds.flatMap((d) => d.zonas),
    linhas: ds.flatMap((d) => d.linhas),
    curvas: ds.flatMap((d) => d.curvas),
    marcas: ds.flatMap((d) => d.marcas ?? []),
    segmentos: ds.flatMap((d) => d.segmentos ?? []),
  };
}
