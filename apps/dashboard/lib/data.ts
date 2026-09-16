/**
 * Camada de acesso a dados do dashboard.
 *
 * Duas fontes, escolhidas automaticamente:
 *
 *   1. SUPABASE — quando configurado. Registo historico completo e auditavel.
 *   2. SNAPSHOT LOCAL — `data/latest-scan.json`, escrito pelo motor a cada
 *      varrimento. Contem apenas a fotografia do ultimo varrimento.
 *
 * A alternativa local existe para que `npm run dashboard:dev` funcione numa
 * maquina limpa, logo a seguir a um `npm run engine:scan`, sem exigir que se
 * crie um projeto Supabase primeiro.
 *
 * O snapshot usa os MESMOS nomes de campo que as colunas do Supabase, por isso
 * os componentes de renderizacao nao sabem — nem precisam de saber — de onde
 * vieram os dados.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  fetchLatestDiagnostics,
  fetchOpenPositions,
  fetchProviderHealth,
  fetchSignals,
  isConfigured,
  type DiagnosticRow,
  type PositionRow,
  type ProviderHealthRow,
  type SignalRow,
} from './supabase';

export type DataSource = 'supabase' | 'snapshot' | 'none';

export interface DashboardData {
  source: DataSource;
  scannedAt: string | null;
  mode: string | null;
  signals: SignalRow[];
  positions: PositionRow[];
  diagnostics: DiagnosticRow[];
  health: ProviderHealthRow[];
  errors: string[];
  /** Caminho procurado, para a mensagem de setup quando nao ha nada. */
  snapshotPath: string;
}

interface Snapshot {
  scanId: string;
  scannedAt: string;
  mode: string;
  signals: SignalRow[];
  diagnostics: DiagnosticRow[];
  providerHealth: ProviderHealthRow[];
  errors: string[];
}

/**
 * Localiza o snapshot.
 *
 * O Next.js corre com cwd em `apps/dashboard`, mas o motor escreve na raiz do
 * repositorio. Tentamos os dois caminhos em vez de assumir um — assim funciona
 * tanto em `npm run dashboard:dev` a partir da raiz como a partir da pasta da
 * propria app.
 */
function candidatePaths(): string[] {
  const fromEnv = process.env.SNAPSHOT_PATH;
  return [
    ...(fromEnv ? [resolve(fromEnv)] : []),
    resolve(process.cwd(), 'data', 'latest-scan.json'),
    resolve(process.cwd(), '..', '..', 'data', 'latest-scan.json'),
  ];
}

async function readSnapshot(): Promise<{ snapshot: Snapshot | null; path: string }> {
  const paths = candidatePaths();
  for (const path of paths) {
    try {
      const raw = await readFile(path, 'utf-8');
      return { snapshot: JSON.parse(raw) as Snapshot, path };
    } catch {
      // Ficheiro inexistente ou ilegivel: tenta o proximo caminho.
    }
  }
  return { snapshot: null, path: paths[paths.length - 1] ?? 'data/latest-scan.json' };
}

export async function loadDashboardData(): Promise<DashboardData> {
  const { snapshot, path } = await readSnapshot();

  if (isConfigured) {
    const [signals, positions, diagnostics, health] = await Promise.all([
      fetchSignals(20),
      fetchOpenPositions(),
      fetchLatestDiagnostics(),
      fetchProviderHealth(),
    ]);

    // Supabase configurado mas ainda vazio (nenhum varrimento gravado): cai
    // para o snapshot em vez de mostrar um painel vazio sem explicacao.
    if (diagnostics.length > 0 || signals.length > 0) {
      return {
        source: 'supabase',
        scannedAt: diagnostics[0]?.scanned_at ?? null,
        mode: signals[0]?.mode ?? null,
        signals,
        positions,
        diagnostics,
        health,
        errors: [],
        snapshotPath: path,
      };
    }
  }

  if (snapshot) {
    return {
      source: 'snapshot',
      scannedAt: snapshot.scannedAt,
      mode: snapshot.mode,
      signals: snapshot.signals ?? [],
      // O snapshot nao acompanha posicoes: isso exige historico, logo Supabase.
      positions: [],
      diagnostics: snapshot.diagnostics ?? [],
      health: snapshot.providerHealth ?? [],
      errors: snapshot.errors ?? [],
      snapshotPath: path,
    };
  }

  return {
    source: 'none',
    scannedAt: null,
    mode: null,
    signals: [],
    positions: [],
    diagnostics: [],
    health: [],
    errors: [],
    snapshotPath: path,
  };
}
