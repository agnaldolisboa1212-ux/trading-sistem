/**
 * ICT ALGO no motor — a passagem de tempo real, à parte de tudo o resto.
 *
 * Independente de propósito: não passa por `tempo-real.ts`, não escreve na
 * tabela `sinais_tempo_real`, não entra nas contas do financeiro nem na
 * automação de ordens. Tem o seu próprio registo de avisados e os seus próprios
 * avisos, que começam sempre por "ICT ALGO". Se esta passagem falhar, a das
 * estratégias validadas corre igual.
 *
 * ── O QUE FAZ, EM CADA MINUTO ──────────────────────────────────────────────
 *
 *   1  lê os portfólios dos perfis — o algoritmo só analisa o que alguém segue
 *   2  para cada instrumento e timeframe (15M por omissão), só quando FECHOU
 *      uma vela nova: pede execução, diário e o par correlacionado
 *   3  corre `correrIctAlgo`, o mesmo que a secção do gráfico
 *   4  se o setup nasceu nesta vela e a sua chave nunca foi avisada: regista-o
 *      e, com o interruptor ligado, avisa
 *
 * ── O INTERRUPTOR ──────────────────────────────────────────────────────────
 *
 *   ICT_ALGO_NOTIFICAR         sem efeito desde 25/09/2026: os avisos saem do
 *                              motor de tempo real (estratégia `ict-algo`)
 *   ICT_ALGO_TIMEFRAMES=15m    timeframes de execução, separados por vírgula
 *
 * Desligado por omissão: o backtest de 2022–2026 com custos não mostrou
 * vantagem, e um aviso no telemóvel é o tipo de coisa que se executa. Com o
 * interruptor desligado o algoritmo corre na mesma, regista cada setup em
 * `ict-algo-sinais.jsonl` e a secção do gráfico mostra-o — só não toca o
 * telemóvel.
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { acharSimbolo, velasDeriv } from '@trading/data';
import {
  NOME_MODELO,
  agregar,
  correrIctAlgo,
  sinalDaUltimaVela,
  paresSmtIct,
  type Candle,
  type SinalIct,
  type Timeframe,
} from '@trading/core';
import { difundirSinalIct } from '@trading/notify';
import { dirDados } from './estado.js';

const GRANULARIDADE_S: Record<string, number> = { '15m': 900, '1h': 3600, '4h': 14400 };
const VELAS_EXECUCAO = 3500;

/** Última vela fechada já analisada, por instrumento/timeframe (memória do processo). */
const ultimaVista = new Map<string, number>();

export interface RelatorioIct {
  analisados: number;
  setups: SinalIct[];
  avisados: number;
  notificar: boolean;
  erros: string[];
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function caminhoAvisados(): string {
  return join(dirDados(), 'ict-algo-avisados.json');
}

function lerAvisados(): string[] {
  try {
    return JSON.parse(readFileSync(caminhoAvisados(), 'utf8')) as string[];
  } catch {
    return [];
  }
}

function gravarAvisados(chaves: string[]): void {
  mkdirSync(dirDados(), { recursive: true });
  // As últimas 2000 chaves chegam para semanas de deduplicação.
  writeFileSync(caminhoAvisados(), JSON.stringify(chaves.slice(-2000)), 'utf8');
}

function registarSetup(s: SinalIct): void {
  mkdirSync(dirDados(), { recursive: true });
  const linha = {
    em: new Date().toISOString(),
    chave: s.chave,
    simbolo: s.simbolo,
    timeframe: s.timeframe,
    modelo: s.modelo,
    regime: s.regime,
    direccao: s.direccao,
    tipoEntrada: s.tipoEntrada,
    entrada: s.entrada,
    stop: s.stop,
    alvo: s.alvo,
    rr: s.rr,
    vela: new Date(s.time).toISOString(),
  };
  appendFileSync(join(dirDados(), 'ict-algo-sinais.jsonl'), `${JSON.stringify(linha)}\n`, 'utf8');
}

/** Instrumentos de todos os portfólios. O algoritmo não analisa mais nada. */
async function lerPortfolios(db: SupabaseClient | null, erros: string[]): Promise<string[]> {
  const doAmbiente = (process.env['ICT_ALGO_SIMBOLOS'] ?? '')
    .split(',')
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);
  if (doAmbiente.length > 0) return doAmbiente;
  if (!db) {
    erros.push('sem Supabase: sem portfólios para ler (defina ICT_ALGO_SIMBOLOS)');
    return [];
  }
  const { data, error } = await db.from('perfis_utilizador').select('instrumentos');
  if (error) {
    erros.push(`portfólios: ${error.message}`);
    return [];
  }
  const todos = new Set<string>();
  for (const linha of data ?? []) {
    for (const c of (linha['instrumentos'] as string[] | null) ?? []) todos.add(c.toUpperCase());
  }
  return [...todos];
}

async function fechadas(derivSymbol: string, gran: number, quantas: number): Promise<Candle[]> {
  const brutas = await velasDeriv(derivSymbol, gran, quantas);
  return brutas.filter((c) => c.time + gran * 1000 <= Date.now());
}

export async function correrIctTempoReal(db: SupabaseClient | null): Promise<RelatorioIct> {
  const erros: string[] = [];
  // Desde 25/09/2026 os sinais do ICT ALGO saem pelo motor de tempo real (a
  // estratégia `ict-algo`, em teste): lista de sinais, Telegram e push. Esta
  // passagem fica só a registar em `ict-algo-sinais.jsonl`; avisar daqui outra
  // vez duplicava cada aviso. `ICT_ALGO_NOTIFICAR` deixou de ter efeito.
  const notificar = false;
  const tfs = (process.env['ICT_ALGO_TIMEFRAMES'] ?? '15m')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => GRANULARIDADE_S[x]) as Timeframe[];

  const portfolio = await lerPortfolios(db, erros);
  const avisados = lerAvisados();
  const jaAvisado = new Set(avisados);
  const setups: SinalIct[] = [];
  let analisados = 0;
  let avisadosAgora = 0;

  // Sequencial: dezenas de pedidos em paralelo à mesma ligação arriscam o
  // limite por minuto da Deriv, e o ciclo tem minutos de folga.
  for (const codigo of portfolio) {
    const s = acharSimbolo(codigo);
    if (!s) continue;
    for (const tf of tfs) {
      const gran = GRANULARIDADE_S[tf]!;
      const passo = gran * 1000;
      const esperada = Math.floor(Date.now() / passo) * passo - passo;
      const chaveVista = `${s.codigo}|${tf}`;
      if (ultimaVista.get(chaveVista) === esperada) continue;

      try {
        // O primeiro par correlacionado que a Deriv serve (ver `paresSmtIct`).
        const parSimbolo = paresSmtIct(s.codigo).map((c) => acharSimbolo(c)).find((x) => x) ?? null;
        const execucao = await fechadas(s.deriv, gran, VELAS_EXECUCAO);
        const diarias = await fechadas(s.deriv, 86_400, 400);
        const parVelas = parSimbolo ? await fechadas(parSimbolo.deriv, gran, VELAS_EXECUCAO).catch(() => []) : [];
        ultimaVista.set(chaveVista, esperada);
        analisados++;

        const a = correrIctAlgo({
          simbolo: s.codigo,
          timeframe: tf,
          velas: execucao,
          diarias,
          semanais: agregar(diarias, '1w'),
          referencia: diarias,
          timeframeReferencia: '1d',
          par: parSimbolo && parVelas.length > 0 ? { simbolo: parSimbolo.codigo, velas: parVelas } : null,
          portfolio,
        });
        const sinal = sinalDaUltimaVela(a);
        if (!sinal || jaAvisado.has(sinal.chave)) continue;

        jaAvisado.add(sinal.chave);
        avisados.push(sinal.chave);
        setups.push(sinal);
        registarSetup(sinal);
        console.log(
          `[ICT ALGO] ${sinal.simbolo} ${tf} · ${NOME_MODELO[sinal.modelo]} · ${sinal.direccao === 'bullish' ? 'COMPRA' : 'VENDA'} ` +
            `${sinal.entrada} / stop ${sinal.stop} / alvo ${sinal.alvo} (${sinal.rr.toFixed(1)}R)` +
            (notificar ? '' : ' — o aviso sai do motor de tempo real'),
        );

        if (notificar) {
          for (const r of await difundirSinalIct(sinal, s.casas)) {
            if (r.ok) avisadosAgora++;
            else if (!r.skipped) erros.push(`aviso ICT ${r.channel} (${s.codigo} ${tf}): ${r.error}`);
          }
        }
      } catch (err) {
        erros.push(`${s.codigo} ${tf}: ${msg(err)}`);
      }
    }
  }

  try {
    gravarAvisados(avisados);
  } catch (err) {
    erros.push(`registo ICT: ${msg(err)}`);
  }
  return { analisados, setups, avisados: avisadosAgora, notificar, erros };
}
