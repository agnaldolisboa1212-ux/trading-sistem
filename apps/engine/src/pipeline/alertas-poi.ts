/**
 * Alertas de POI — o setup Asia Range do journal, como AVISO e não como sinal.
 *
 * Nas passagens do tempo real entre as 08:00 e as 11:00 de Londres (dias
 * úteis), para cada instrumento de forex/metais dos portfólios: lê os POI do dia
 * (`poisDeSessao`: topos/fundos de 15M dos últimos 3 dias por tocar, do lado da
 * estrutura de 15M) e, quando o preço de 1M entra num deles, avisa por Telegram
 * e push. Uma vez por POI e por dia; a decisão da entrada (MSS + OB em 1M) fica
 * com quem opera.
 *
 * Porquê aviso e não sinal: medido em `scripts/backtest/asia-range-poi.mjs`
 * (26/09/2026), as regras mecânicas de entrada sobre estes POI não tiveram
 * vantagem (−0,16R com custos; ~0 sem). O journal do Agnaldo, com a leitura
 * dele, teve +0,63R por ideia. A máquina marca e vigia; a pessoa decide.
 *
 * Pedidos à Deriv: o 15M vem da cache até fechar a vela seguinte (um pedido por
 * instrumento a cada 15 min); o 1M só se pede para os instrumentos com POI por
 * avisar, e só dentro da janela.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JANELA_POI, poisDeSessao, relogioLondres, toquesPoi } from '@trading/core';
import { acharSimbolo, velasFechadasDeriv } from '@trading/data';
import { difundirAlertaPoi } from '@trading/notify';
import { dirDados } from './estado.js';

/** 15M para o viés e os POI: ~8 dias de negociação. */
const VELAS_15M = 800;
/** Um toque mais antigo do que isto já não se avisa (motor parado, reinício). */
const TOQUE_FRESCO_MS = 10 * 60_000;

const caminho = (): string => join(dirDados(), 'poi-avisados.json');

function lerAvisados(): Set<string> {
  try {
    return new Set(JSON.parse(readFileSync(caminho(), 'utf8')) as string[]);
  } catch {
    return new Set();
  }
}

function gravarAvisados(s: Set<string>): void {
  mkdirSync(dirDados(), { recursive: true });
  // Os POI são do dia: 500 chaves chegam para semanas.
  writeFileSync(caminho(), JSON.stringify([...s].slice(-500)), 'utf8');
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Devolve quantos alertas saíram nesta passagem. */
export async function vigiarPois(simbolos: readonly string[], erros: string[], agora = Date.now()): Promise<number> {
  const l = relogioLondres(agora);
  if (l.diaSemana === 0 || l.diaSemana === 6) return 0;
  if (l.minutos < JANELA_POI.de || l.minutos >= JANELA_POI.ate) return 0;

  const avisados = lerAvisados();
  const antes = avisados.size;
  let enviados = 0;
  for (const codigo of simbolos) {
    const s = acharSimbolo(codigo);
    // A janela de Londres é do forex e dos metais.
    if (!s || !s.deriv.startsWith('frx')) continue;
    try {
      const v15 = await velasFechadasDeriv(s.deriv, 900, VELAS_15M);
      const leitura = poisDeSessao(v15, agora);
      if (!leitura || leitura.provisoria) continue;
      const porAvisar = leitura.pois.filter((z) => !avisados.has(`${s.codigo}|${z.chave}`));
      if (porAvisar.length === 0) continue;

      const minutos = Math.ceil((agora - leitura.inicio) / 60_000) + 2;
      const v1 = await velasFechadasDeriv(s.deriv, 60, Math.min(240, Math.max(5, minutos)));
      const ultima = v1[v1.length - 1];
      for (const t of toquesPoi({ ...leitura, pois: porAvisar }, v1, agora)) {
        const chave = `${s.codigo}|${t.zona.chave}`;
        avisados.add(chave);
        // Passou o POI em mais de ½ ATR: já não é uma reacção no POI. E um toque
        // antigo (motor parado) não se avisa como se fosse agora.
        if (t.invalido || agora - t.em > TOQUE_FRESCO_MS) continue;
        const r = await difundirAlertaPoi({
          simbolo: s.codigo,
          casas: s.casas,
          lado: t.zona.lado,
          estrutura: { tipo: leitura.estrutura.tipo, em: leitura.estrutura.time },
          poi: { baixo: t.zona.baixo, alto: t.zona.alto, origem: t.zona.origem },
          tocadoEm: t.em,
          preco: ultima?.close ?? t.preco,
          asia: leitura.asia ? { baixo: leitura.asia.baixo, alto: leitura.asia.alto } : null,
          liquidez: leitura.liquidezOposta,
          chave: `${s.codigo}-${t.zona.chave}`,
        });
        for (const x of r) if (!x.ok && !x.skipped) erros.push(`alerta de POI ${s.codigo} (${x.channel}): ${x.error}`);
        enviados++;
      }
    } catch (e) {
      erros.push(`alerta de POI ${s.codigo}: ${msg(e)}`);
    }
  }
  if (avisados.size !== antes) {
    try {
      gravarAvisados(avisados);
    } catch (e) {
      erros.push(`alertas de POI (registo local): ${msg(e)}`);
    }
  }
  return enviados;
}
