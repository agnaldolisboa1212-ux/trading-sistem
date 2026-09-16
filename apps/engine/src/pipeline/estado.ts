/**
 * Estado dos motores — o "estão vivos?" que o painel mostra.
 *
 * Sem isto, a única forma de saber se o motor estava a correr era abrir o
 * terminal. O painel dizia "último varrimento: 6 de setembro" e ninguém sabia
 * se isso queria dizer "não houve nada" ou "o processo morreu há nove dias".
 *
 * Dois destinos:
 *
 *   `data/motor-estado.json` — lido pelo painel quando vive na mesma máquina.
 *                              Inclui um batimento a cada minuto, que é o que
 *                              distingue "parado" de "à espera do próximo cron".
 *   `motor_execucoes`        — tabela do Supabase (migração 0005), para quando
 *                              painel e motor vivem em sítios diferentes.
 *
 * Nenhuma falha aqui pode derrubar um motor. Tudo é best-effort.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDbClient, isDbConfigured } from '@trading/db';

export type Motor = 'diario' | 'tempoReal';

export interface Execucao {
  iniciadoEm: string;
  terminadoEm: string;
  duracaoMs: number;
  instrumentos: number;
  sinais: number;
  novos: number;
  ok: boolean;
  resumo: string;
  erros: string[];
}

export interface EstadoMotor {
  versao: 1;
  pid: number;
  modo: 'agendador' | 'unico';
  arrancouEm: string;
  /** Batimento. No agendador, actualizado a cada minuto. */
  actualizadoEm: string;
  paradoEm: string | null;
  crons: { diario: string; tempoReal: string } | null;
  aCorrer: Motor[];
  diario: Execucao | null;
  tempoReal: Execucao | null;
}

/**
 * Pasta de dados na RAIZ do monorepo.
 *
 * O motor é lançado de sítios diferentes (`npm run -w`, `node dist/...`, o
 * script `sistema`), cada um com um `cwd` diferente. Depender do `cwd` espalhava
 * ficheiros por `apps/engine/data` e `data/` e o painel lia o errado. Sobe-se a
 * partir deste ficheiro até ao `package.json` que declara `workspaces`.
 */
export function dirDados(): string {
  const doAmbiente = process.env['DATA_DIR'];
  if (doAmbiente) return resolve(doAmbiente);

  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        if ((JSON.parse(readFileSync(pkg, 'utf8')) as { workspaces?: unknown }).workspaces) {
          return join(dir, 'data');
        }
      } catch {
        /* package.json ilegível — continua a subir */
      }
    }
    const pai = dirname(dir);
    if (pai === dir) break;
    dir = pai;
  }
  return resolve(process.cwd(), 'data');
}

function caminho(): string {
  return join(dirDados(), 'motor-estado.json');
}

export function lerEstado(): EstadoMotor | null {
  try {
    return JSON.parse(readFileSync(caminho(), 'utf8')) as EstadoMotor;
  } catch {
    return null;
  }
}

function gravar(e: EstadoMotor): void {
  try {
    mkdirSync(dirDados(), { recursive: true });
    writeFileSync(caminho(), JSON.stringify(e, null, 2), 'utf8');
  } catch (err) {
    console.error('[estado] não foi possível gravar:', err instanceof Error ? err.message : err);
  }
}

function base(): EstadoMotor {
  const agora = new Date().toISOString();
  const anterior = lerEstado();
  return {
    versao: 1,
    pid: process.pid,
    modo: 'unico',
    arrancouEm: agora,
    actualizadoEm: agora,
    paradoEm: null,
    crons: null,
    aCorrer: [],
    // Mantém o histórico da última execução de cada motor entre arranques.
    diario: anterior?.diario ?? null,
    tempoReal: anterior?.tempoReal ?? null,
  };
}

let actual: EstadoMotor | null = null;

function obter(): EstadoMotor {
  actual ??= base();
  return actual;
}

export function marcarArranque(
  modo: EstadoMotor['modo'],
  crons: EstadoMotor['crons'],
): void {
  const e = obter();
  e.modo = modo;
  e.crons = crons;
  e.pid = process.pid;
  e.arrancouEm = new Date().toISOString();
  e.actualizadoEm = e.arrancouEm;
  e.paradoEm = null;
  gravar(e);
}

export function batimento(): void {
  const e = obter();
  e.actualizadoEm = new Date().toISOString();
  gravar(e);
}

export function marcarInicio(motor: Motor): void {
  const e = obter();
  if (!e.aCorrer.includes(motor)) e.aCorrer.push(motor);
  e.actualizadoEm = new Date().toISOString();
  gravar(e);
}

export function marcarParagem(): void {
  const e = obter();
  e.paradoEm = new Date().toISOString();
  e.aCorrer = [];
  gravar(e);
}

let ultimaInsercaoTempoReal = 0;

export async function registarExecucao(motor: Motor, exec: Execucao): Promise<void> {
  const e = obter();
  e[motor] = exec;
  e.aCorrer = e.aCorrer.filter((m) => m !== motor);
  e.actualizadoEm = new Date().toISOString();
  gravar(e);

  if (!isDbConfigured()) return;

  /*
   * O motor de tempo real passa a cada minuto: seriam 1440 linhas por dia só
   * para dizer "estou vivo". Grava-se quando há notícia (sinal novo ou falha)
   * ou, no máximo, uma vez a cada 15 minutos. O ficheiro local continua a ter
   * o batimento ao minuto.
   */
  if (motor === 'tempoReal') {
    const semNoticia = exec.ok && exec.novos === 0;
    if (semNoticia && Date.now() - ultimaInsercaoTempoReal < 15 * 60_000) return;
  }

  try {
    const { error } = await createDbClient()
      .from('motor_execucoes')
      .insert({
        motor,
        iniciado_em: exec.iniciadoEm,
        terminado_em: exec.terminadoEm,
        duracao_ms: exec.duracaoMs,
        instrumentos: exec.instrumentos,
        sinais: exec.sinais,
        novos: exec.novos,
        ok: exec.ok,
        resumo: exec.resumo,
        erros: exec.erros.slice(0, 20),
      });
    /*
     * A janela de 15 minutos só começa depois de uma gravação que CORREU BEM.
     * Antes começava na tentativa: com a tabela ainda por criar, cada falha
     * adiava a próxima tentativa um quarto de hora, e a migração aplicada com
     * o motor a correr só aparecia no painel muito depois.
     */
    if (!error && motor === 'tempoReal') ultimaInsercaoTempoReal = Date.now();
    // Tabela ainda não criada (migração 0005 por aplicar): o ficheiro chega.
    if (error && !tabelaAusente(error)) {
      console.warn(`[estado] motor_execucoes: ${error.message}`);
    }
  } catch {
    /* rede em baixo — o ficheiro já ficou gravado */
  }
}

/** Erro do Supabase que significa "a tabela não existe". */
export function tabelaAusente(error: { code?: string; message?: string }): boolean {
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    /schema cache|does not exist/i.test(error.message ?? '')
  );
}
