import 'server-only';

/**
 * A sessão cTrader que o MOTOR usa para a automação.
 *
 * A sessão normal vive num cookie do browser: serve para quem está a usar o
 * painel, e desaparece quando o separador fecha. O motor corre sem browser
 * nenhum, por isso precisa da sua própria cópia.
 *
 * Fica num ficheiro do servidor (`data/ctrader-motor.json`), CIFRADA com a
 * mesma chave do cofre (`COFRE_CHAVE`) — nunca na base de dados, nunca em
 * texto simples, nunca no ambiente. Só lá chega quando o dono carrega em
 * "autorizar o motor", e sai com um toque em "retirar autorização".
 *
 * O refresh token da cTrader não expira: quem tiver este ficheiro E a chave do
 * cofre negoceia na conta. É por isso que o ficheiro se escreve com permissões
 * restritas e que a autorização é explícita.
 */

import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { abrir, selar } from '@/lib/cofre';
import { renovarTokenCtrader, type SessaoCtrader } from './sessao';

const NOME = 'ctrader-motor.json';

function caminho(): string {
  if (process.env.DATA_DIR) return resolve(process.env.DATA_DIR, NOME);
  return resolve(process.cwd(), 'data', NOME);
}

/** Os sítios onde o ficheiro pode estar — o painel corre da raiz ou de apps/dashboard. */
function caminhos(): string[] {
  const lista = [caminho()];
  lista.push(resolve(process.cwd(), 'data', NOME), resolve(process.cwd(), '..', '..', 'data', NOME));
  return [...new Set(lista)];
}

export async function guardarSessaoMotor(s: SessaoCtrader): Promise<void> {
  const p = caminho();
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify({ selado: selar(s) }), 'utf8');
  // Sem efeito no Windows, mas no alojamento Linux tira o ficheiro da vista de
  // outros utilizadores da máquina.
  await chmod(p, 0o600).catch(() => undefined);
}

export async function apagarSessaoMotor(): Promise<void> {
  for (const p of caminhos()) await unlink(p).catch(() => undefined);
}

export async function temSessaoMotor(): Promise<boolean> {
  return (await lerSeladoMotor()) !== null;
}

async function lerSeladoMotor(): Promise<string | null> {
  for (const p of caminhos()) {
    try {
      const j = JSON.parse(await readFile(p, 'utf8')) as { selado?: string };
      if (typeof j.selado === 'string') return j.selado;
    } catch {
      /* não está aqui — tenta o próximo */
    }
  }
  return null;
}

/**
 * A sessão do motor, com o token renovado se estiver a menos de dois dias de
 * expirar (o access token dura ~30 dias; o refresh não expira).
 */
export async function sessaoDoMotor(): Promise<SessaoCtrader | null> {
  const s = abrir<SessaoCtrader>(await lerSeladoMotor());
  if (!s) return null;
  if (s.e - Date.now() >= 2 * 86_400_000) return s;
  try {
    const novo = await renovarTokenCtrader(s.f);
    const renovada: SessaoCtrader = { ...s, a: novo.accessToken, f: novo.refreshToken, e: novo.expiraEm };
    await guardarSessaoMotor(renovada);
    return renovada;
  } catch {
    return null;
  }
}
