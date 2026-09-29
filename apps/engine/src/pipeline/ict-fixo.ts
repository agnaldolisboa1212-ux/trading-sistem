/**
 * ICT ALGO — o SETUP FIXO de cada instrumento, entre passagens (29/09/2026).
 *
 *   1H   quando não há setup activo e fecha uma vela de 1H nova, corre-se o
 *        ICT ALGO em 1H; se um setup NASCEU nessa vela, fica fixo (24 h)
 *   5M   em cada passagem, o estado do setup com as velas de 5M
 *        (`estadoDoSetup`, `PASSO_GATILHO_ICT`): à espera da zona → na zona →
 *        DISPARADO (o tiro sai pela lista de sinais, em `planIctAlgo`, no fecho
 *        da vela de 15M que o contém) → ou invalidado/expirado. Era 15M até
 *        29/09/2026 (ver `gatilho.ts`)
 *
 * Um disparado fica fixo até o tiro ir ao stop ou ao alvo (ou 24 h), e só
 * depois se arma outro: o algoritmo não salta de setup em setup.
 *
 * O estado vive em `data/ict-setups.json` (o painel lê-o para o gráfico e o
 * jornal lê-o para os "setups armados").
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NOME_MODELO,
  PASSO_GATILHO_ICT,
  agregar,
  armarSetupIct,
  correrIctAlgo,
  estadoDoSetup,
  estrategiasPara,
  paresSmtIct,
  type EstadoSetup,
  type ModeloIct,
  type SetupFixo,
} from '@trading/core';
import { acharSimbolo, velasFechadasDeriv } from '@trading/data';
import { dirDados } from './estado.js';

const H1 = 3_600_000;
const DIA = 86_400_000;
/** Velas de 1H para o ICT ALGO (o placar dos modelos precisa de história). */
const VELAS_1H = 3500;
/**
 * Velas do gatilho (5M). A Deriv só dá ~1,5 dias de 5M por pedido (~450 velas):
 * chega para um setup de 24 h e a estrutura antes dele.
 */
const VELAS_GATILHO = 600;

export interface RegistoIct {
  setup: SetupFixo | null;
  estado: EstadoSetup | null;
  /** Abertura da última vela de 1H já analisada. */
  ultimo1h: number;
  /** Os últimos setups que terminaram, para o gráfico e para o jornal. */
  historico: Array<{ setup: SetupFixo; fim: EstadoSetup['estado'] | 'tiro-fechado'; em: number; detalhe: string }>;
}

export type EstadoIct = Record<string, RegistoIct>;

const caminho = (): string => join(dirDados(), 'ict-setups.json');

export function lerEstadoIct(): EstadoIct {
  try {
    return JSON.parse(readFileSync(caminho(), 'utf8')) as EstadoIct;
  } catch {
    return {};
  }
}

function gravar(e: EstadoIct): void {
  mkdirSync(dirDados(), { recursive: true });
  writeFileSync(caminho(), JSON.stringify(e), 'utf8');
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Depois de disparado: o tiro já foi ao stop ou ao alvo? */
function tiroFechado(estado: EstadoSetup, velas: readonly { time: number; high: number; low: number }[], agora: number): string | null {
  if (estado.estado !== 'disparado') return null;
  const t = estado.tiro;
  const venda = t.stop > t.entrada;
  for (const c of velas) {
    if (c.time <= t.time || c.time + PASSO_GATILHO_ICT > agora) continue;
    if (venda ? c.high >= t.stop : c.low <= t.stop) return `o tiro foi ao stop (${t.stop})`;
    if (venda ? c.low <= t.alvo : c.high >= t.alvo) return `o tiro foi ao alvo (${t.alvo}, ${t.rr.toFixed(1)}R)`;
  }
  return agora - t.time > DIA ? 'o tiro fechou ao fim de 24 h' : null;
}

/**
 * Actualiza o setup fixo de cada instrumento com ICT ALGO e devolve os que
 * estão activos — o que `planIctAlgo` precisa para disparar na vela de 15M.
 */
export async function prepararIctFixo(
  codigos: readonly string[],
  erros: string[],
  agora = Date.now(),
): Promise<Map<string, { setup: SetupFixo; estado: EstadoSetup }>> {
  const estado = lerEstadoIct();
  const activos = new Map<string, { setup: SetupFixo; estado: EstadoSetup }>();
  for (const codigo of codigos) {
    if (!estrategiasPara(codigo, '15m').some((e) => e.id === 'ict-algo')) continue;
    const s = acharSimbolo(codigo);
    if (!s) continue;
    const reg: RegistoIct = estado[s.codigo] ?? { setup: null, estado: null, ultimo1h: 0, historico: [] };
    try {
      const vg = await velasFechadasDeriv(s.deriv, PASSO_GATILHO_ICT / 1000, VELAS_GATILHO);
      const opcoes = { passoMs: PASSO_GATILHO_ICT };

      // 1 — O setup activo: em que ponto está, e se já terminou.
      if (reg.setup) {
        const e = estadoDoSetup(reg.setup, vg, agora, opcoes);
        const fechado = tiroFechado(e, vg, agora);
        const terminou = e.estado === 'invalidado' || e.estado === 'expirado' || fechado !== null;
        if (terminou) {
          reg.historico = [
            ...reg.historico,
            {
              setup: reg.setup,
              fim: (fechado ? 'tiro-fechado' : e.estado) as RegistoIct['historico'][number]['fim'],
              em: agora,
              detalhe: fechado ?? (e.estado === 'invalidado' ? e.motivo : 'expirou sem confirmar em 15M'),
            },
          ].slice(-20);
          reg.setup = null;
          reg.estado = null;
        } else {
          reg.estado = e;
        }
      }

      // 2 — Sem setup activo: a vela de 1H nova pode armar um.
      if (!reg.setup) {
        const v1h = await velasFechadasDeriv(s.deriv, 3600, VELAS_1H);
        const ult = v1h[v1h.length - 1];
        if (ult && ult.time !== reg.ultimo1h) {
          reg.ultimo1h = ult.time;
          const diarias = await velasFechadasDeriv(s.deriv, 86400, 400);
          const parSim = paresSmtIct(s.codigo).map((c) => acharSimbolo(c)).find((x) => x);
          const parVelas = parSim ? await velasFechadasDeriv(parSim.deriv, 3600, VELAS_1H).catch(() => []) : [];
          const a = correrIctAlgo({
            simbolo: s.codigo,
            timeframe: '1h',
            velas: v1h,
            diarias,
            semanais: agregar(diarias, '1w'),
            referencia: diarias,
            timeframeReferencia: '1d',
            par: parSim && parVelas.length > 0 ? { simbolo: parSim.codigo, velas: parVelas } : null,
            agora,
          });
          const novo = armarSetupIct(a, ult.time + H1, (m) => NOME_MODELO[m as ModeloIct] ?? m);
          // Um setup que já acabou (a mesma chave) não se arma outra vez: na réplica
          // de 14–25/09 o EURJPY armava duas vezes a mesma zona.
          if (novo && !reg.historico.some((h) => h.setup.chave === novo.chave)) {
            reg.setup = novo;
            reg.estado = estadoDoSetup(novo, vg, agora, opcoes);
          }
        }
      }
      if (reg.setup && reg.estado) activos.set(s.codigo, { setup: reg.setup, estado: reg.estado });
    } catch (e) {
      erros.push(`ICT ALGO (setup fixo) ${s.codigo}: ${msg(e)}`);
    }
    estado[s.codigo] = reg;
  }
  try {
    gravar(estado);
  } catch (e) {
    erros.push(`ICT ALGO (setup fixo): não gravou o estado: ${msg(e)}`);
  }
  return activos;
}
