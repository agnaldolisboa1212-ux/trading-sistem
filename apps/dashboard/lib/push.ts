import 'server-only';

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import webpush from 'web-push';
import { timeframesDoPerfil } from '@trading/core';

/**
 * Notificacoes push — registo de subscritores e envio.
 *
 * ── ONDE FICAM AS SUBSCRICOES ──────────────────────────────────────────────
 *
 * Numa tabela do Supabase quando ele estiver configurado; num ficheiro JSON
 * caso contrario. A alternativa — guardar so em memoria — perderia todos os
 * subscritores a cada reinicio do servidor, e uma app que deixa de notificar
 * depois de um deploy e pior do que uma que nunca notificou.
 *
 * O ficheiro serve para desenvolvimento e para um servidor proprio (VPS). Em
 * plataformas sem disco persistente (Vercel e afins) o Supabase e obrigatorio,
 * e `estadoPush()` di-lo por extenso em vez de falhar em silencio.
 *
 * ── CHAVES ──────────────────────────────────────────────────────────────────
 *
 * VAPID e um par de chaves que identifica o servidor perante o servico de push
 * do browser. A publica vai para o cliente; a privada nunca sai daqui.
 */

const FICHEIRO = join(process.cwd(), '.dados', 'push.json');

export interface Subscritor {
  readonly endpoint: string;
  readonly keys: { p256dh: string; auth: string };
  /** Quem subscreveu, quando ha sessao. Permite notificar so quem interessa. */
  readonly utilizador?: string | null;
  readonly criadoEm: string;
}

export interface ConfigPush {
  readonly publica: string;
  readonly privada: string;
  readonly assunto: string;
}

export function configPush(): ConfigPush | null {
  const publica = process.env['VAPID_PUBLIC_KEY'] ?? process.env['NEXT_PUBLIC_VAPID_PUBLIC_KEY'];
  const privada = process.env['VAPID_PRIVATE_KEY'];
  if (!publica || !privada) return null;
  return {
    publica,
    privada,
    assunto: process.env['VAPID_SUBJECT'] ?? 'mailto:sem-resposta@exemplo.com',
  };
}

// ---------------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------------

function supabaseServidor(): { url: string; chave: string } | null {
  const url = process.env['SUPABASE_URL'] ?? process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const chave = process.env['SUPABASE_SECRET_KEY'] ?? process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !chave) return null;
  return { url, chave };
}

/**
 * Escreve no Supabase por REST em vez do SDK.
 *
 * O SDK e um cliente pesado para tres chamadas, e o `upsert` por REST com
 * `Prefer: resolution=merge-duplicates` faz exatamente o que e preciso: o mesmo
 * browser a subscrever duas vezes actualiza a linha em vez de criar outra.
 */
async function guardarSupabase(s: Subscritor): Promise<boolean> {
  const sb = supabaseServidor();
  if (!sb) return false;
  try {
    const r = await fetch(`${sb.url}/rest/v1/push_subscricoes`, {
      method: 'POST',
      headers: {
        apikey: sb.chave,
        Authorization: `Bearer ${sb.chave}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        endpoint: s.endpoint,
        p256dh: s.keys.p256dh,
        auth: s.keys.auth,
        utilizador: s.utilizador ?? null,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function lerSupabase(): Promise<Subscritor[] | null> {
  const sb = supabaseServidor();
  if (!sb) return null;
  try {
    const r = await fetch(`${sb.url}/rest/v1/push_subscricoes?select=*`, {
      headers: { apikey: sb.chave, Authorization: `Bearer ${sb.chave}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    const linhas = (await r.json()) as Array<{
      endpoint: string;
      p256dh: string;
      auth: string;
      utilizador: string | null;
      criado_em: string;
    }>;
    return linhas.map((l) => ({
      endpoint: l.endpoint,
      keys: { p256dh: l.p256dh, auth: l.auth },
      utilizador: l.utilizador,
      criadoEm: l.criado_em,
    }));
  } catch {
    return null;
  }
}

async function apagarSupabase(endpoint: string): Promise<void> {
  const sb = supabaseServidor();
  if (!sb) return;
  try {
    await fetch(
      `${sb.url}/rest/v1/push_subscricoes?endpoint=eq.${encodeURIComponent(endpoint)}`,
      {
        method: 'DELETE',
        headers: { apikey: sb.chave, Authorization: `Bearer ${sb.chave}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    /* melhor esforco */
  }
}

async function lerFicheiro(): Promise<Subscritor[]> {
  try {
    return JSON.parse(await readFile(FICHEIRO, 'utf8')) as Subscritor[];
  } catch {
    return [];
  }
}

async function escreverFicheiro(lista: Subscritor[]): Promise<void> {
  await mkdir(dirname(FICHEIRO), { recursive: true });
  await writeFile(FICHEIRO, JSON.stringify(lista, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export async function registarSubscritor(
  bruta: { endpoint: string; keys: { p256dh: string; auth: string } },
  utilizador: string | null,
): Promise<void> {
  const s: Subscritor = {
    endpoint: bruta.endpoint,
    keys: bruta.keys,
    utilizador,
    criadoEm: new Date().toISOString(),
  };

  if (await guardarSupabase(s)) return;

  const lista = await lerFicheiro();
  await escreverFicheiro([...lista.filter((x) => x.endpoint !== s.endpoint), s]);
}

export async function removerSubscritor(endpoint: string): Promise<void> {
  await apagarSupabase(endpoint);
  const lista = await lerFicheiro();
  await escreverFicheiro(lista.filter((x) => x.endpoint !== endpoint));
}

export async function subscritores(): Promise<Subscritor[]> {
  return (await lerSupabase()) ?? (await lerFicheiro());
}

export interface Aviso {
  readonly titulo: string;
  readonly corpo: string;
  readonly url?: string;
  /** Notificacoes com a mesma tag substituem-se em vez de empilharem. */
  readonly tag?: string;
  /**
   * Quanto tempo o servico de push pode segurar o aviso ate o entregar. O
   * `web-push` usa 4 semanas por omissao: um telemovel sem rede recebia de
   * manha o sinal de 15 minutos da noite anterior.
   */
  readonly validadeS?: number;
  /**
   * `high` por omissao. Com `normal`, o Android em repouso junta os avisos e
   * entrega-os minutos depois — era o "os sinais chegam atrasados".
   */
  readonly urgencia?: 'high' | 'normal';
  /** Um aviso ainda por entregar com o mesmo topico e substituido. */
  readonly topico?: string;
  /** Instrumento: so chega a quem o tem nas preferencias. */
  readonly simbolo?: string;
  /** Timeframe do sinal: so chega a quem o tem nos objetivos. */
  readonly timeframe?: string;
}

export interface ResultadoEnvio {
  readonly enviadas: number;
  readonly removidas: number;
  readonly falhas: number;
  /** Subscricoes de quem desligou os avisos ou nao segue este instrumento. */
  readonly filtradas: number;
}

interface PreferenciaAvisos {
  readonly activos: boolean;
  readonly instrumentos: readonly string[];
  /** Timeframes de sinal que os objetivos do onboarding pedem. */
  readonly timeframes: readonly string[];
}

/** Preferencias de avisos de todas as contas — lidas com a chave do servidor. */
async function preferenciasAvisos(): Promise<Map<string, PreferenciaAvisos> | null> {
  const sb = supabaseServidor();
  if (!sb) return null;
  try {
    const pedir = (colunas: string) =>
      fetch(`${sb.url}/rest/v1/perfis_utilizador?select=${colunas}`, {
        headers: { apikey: sb.chave, Authorization: `Bearer ${sb.chave}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
    let r = await pedir('utilizador_id,instrumentos,objetivos,timeframes_sinais,avisos_ativos');
    // Migração 0008 por aplicar: sem a coluna, valem os timeframes do objetivo.
    if (!r.ok) r = await pedir('utilizador_id,instrumentos,objetivos,avisos_ativos');
    if (!r.ok) return null;
    const linhas = (await r.json()) as Array<{
      utilizador_id: string;
      instrumentos: string[] | null;
      objetivos: string[] | null;
      timeframes_sinais?: string[] | null;
      avisos_ativos: boolean | null;
    }>;
    return new Map(
      linhas.map((l) => [
        l.utilizador_id,
        {
          activos: l.avisos_ativos !== false,
          instrumentos: l.instrumentos ?? [],
          timeframes: timeframesDoPerfil(l.objetivos, l.timeframes_sinais),
        },
      ]),
    );
  } catch {
    return null;
  }
}

/**
 * Esta subscricao quer este aviso?
 *
 * So recebe quem tem o instrumento no PORTFOLIO. Portfolio vazio nao recebe
 * sinais nenhuns — a pessoa escolhe o que segue. Subscricoes sem conta (de
 * antes do login obrigatorio) tambem nao: a app liga-as a conta assim que a
 * pessoa entra. Avisos sem instrumento (testes, contas) nao sao filtrados.
 */
export function querAviso(
  s: Pick<Subscritor, 'utilizador'>,
  prefs: ReadonlyMap<string, PreferenciaAvisos> | null,
  simbolo: string | undefined,
  timeframe?: string,
): boolean {
  if (!simbolo) return true;
  if (!s.utilizador || !prefs) return false;
  const p = prefs.get(s.utilizador);
  if (!p || !p.activos) return false;
  if (!p.instrumentos.some((i) => i.toUpperCase() === simbolo.toUpperCase())) return false;
  // Quem escolheu horas e dias não recebe sinais de 15 minutos.
  return !timeframe || p.timeframes.includes(timeframe);
}

/** O servico de push so aceita ate 32 caracteres de base64 URL-safe. */
function topicoValido(t: string | undefined): string | undefined {
  const limpo = (t ?? '').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32);
  return limpo || undefined;
}

/**
 * Envia aos subscritores que querem este aviso — ou so aos de uma conta.
 *
 * Uma subscricao que devolve 404 ou 410 esta MORTA — o utilizador desinstalou a
 * app ou limpou os dados do site. Nesse caso apaga-se, senao a lista cresce
 * para sempre com destinos que nunca mais respondem.
 */
export async function enviarAviso(
  aviso: Aviso,
  destino: { utilizador?: string } = {},
): Promise<ResultadoEnvio> {
  const cfg = configPush();
  if (!cfg) return { enviadas: 0, removidas: 0, falhas: 0, filtradas: 0 };

  webpush.setVapidDetails(cfg.assunto, cfg.publica, cfg.privada);

  const todas = await subscritores();
  const prefs = destino.utilizador ? null : await preferenciasAvisos();
  const lista = destino.utilizador
    ? todas.filter((s) => s.utilizador === destino.utilizador)
    : todas.filter((s) => querAviso(s, prefs, aviso.simbolo, aviso.timeframe));

  const carga = JSON.stringify({
    titulo: aviso.titulo,
    corpo: aviso.corpo,
    url: aviso.url,
    tag: aviso.tag,
    enviadoEm: Date.now(),
  });
  const opcoes = {
    TTL: Math.max(60, Math.round(aviso.validadeS ?? 3600)),
    urgency: aviso.urgencia ?? 'high',
    topic: topicoValido(aviso.topico),
  } as const;

  let enviadas = 0;
  let removidas = 0;
  let falhas = 0;

  await Promise.all(
    lista.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, carga, opcoes);
        enviadas++;
      } catch (err) {
        const codigo = (err as { statusCode?: number }).statusCode;
        if (codigo === 404 || codigo === 410) {
          await removerSubscritor(s.endpoint);
          removidas++;
        } else {
          falhas++;
        }
      }
    }),
  );

  return { enviadas, removidas, falhas, filtradas: todas.length - lista.length };
}

export interface EstadoPush {
  readonly configurado: boolean;
  readonly chavePublica: string | null;
  readonly subscritores: number;
  readonly armazenamento: 'supabase' | 'ficheiro' | 'nenhum';
}

export async function estadoPush(): Promise<EstadoPush> {
  const cfg = configPush();
  const noSupabase = await lerSupabase();
  const lista = noSupabase ?? (await lerFicheiro());
  return {
    configurado: cfg !== null,
    chavePublica: cfg?.publica ?? null,
    subscritores: lista.length,
    armazenamento: cfg === null ? 'nenhum' : noSupabase ? 'supabase' : 'ficheiro',
  };
}
