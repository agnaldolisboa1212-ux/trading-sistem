/**
 * Descobre o chat_id do Telegram e grava-o no .env.
 *
 *   npm run setup:telegram
 *
 * O token do bot identifica o BOT; o chat_id identifica PARA ONDE enviar. O
 * segundo não existe até alguém falar com o bot pela primeira vez — é uma
 * proteção do Telegram para um bot não poder escrever a quem nunca o contactou.
 *
 * Este script fica à espera dessa primeira mensagem, extrai o chat_id, escreve-o
 * no .env e envia uma mensagem de confirmação. Evita o passo manual de abrir o
 * getUpdates no browser e copiar um número de dentro de um JSON.
 */

import { existsSync } from 'node:fs';
import { readEnv, setEnv } from './env-file.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = join(ROOT, '.env');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

if (!existsSync(ENV_PATH)) {
  console.log(`${RED}✗${RESET} Não existe .env na raiz do projeto.`);
  process.exit(1);
}

const env = readEnv(ENV_PATH);

const token = env['TELEGRAM_BOT_TOKEN'];
if (!token) {
  console.log(`${RED}✗${RESET} TELEGRAM_BOT_TOKEN está vazio no .env.`);
  console.log('  Fale com @BotFather → /newbot → copie o token para o .env.');
  process.exit(1);
}

const api = (method, qs = '') => `https://api.telegram.org/bot${token}/${method}${qs}`;

async function call(method, qs = '') {
  const res = await fetch(api(method, qs), { signal: AbortSignal.timeout(30_000) });
  return res.json();
}

console.log('');
console.log('Configuração do Telegram');
console.log('─'.repeat(56));

const me = await call('getMe');
if (!me.ok) {
  console.log(`${RED}✗${RESET} Token inválido: ${me.description}`);
  process.exit(1);
}
console.log(`${GREEN}✓${RESET} bot @${me.result.username} (${me.result.first_name})`);

/** Procura um chat_id nas atualizações pendentes. */
async function findChat() {
  const ups = await call('getUpdates', '?timeout=0');
  if (!ups.ok) return null;
  for (const u of ups.result ?? []) {
    const msg = u.message ?? u.channel_post ?? u.edited_message;
    const chat = msg?.chat;
    if (chat?.id) {
      const name =
        chat.title ?? [chat.first_name, chat.last_name].filter(Boolean).join(' ') ?? chat.username;
      return { id: chat.id, type: chat.type, name };
    }
  }
  return null;
}

let chat = await findChat();

if (!chat) {
  console.log('');
  console.log(`${YELLOW}!${RESET} Ainda ninguém falou com o bot.`);
  console.log('');
  console.log(`  Abra  ${DIM}https://t.me/${me.result.username}${RESET}  e envie  /start`);
  console.log('');
  console.log('  À espera... (Ctrl+C para desistir)');

  // Sondagem em vez de long polling: o long polling do Telegram consome as
  // atualizações, e queremos deixá-las intactas caso o utilizador volte a correr.
  const deadline = Date.now() + 180_000;
  while (!chat && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    chat = await findChat();
    if (chat) break;
    process.stdout.write('.');
  }
  console.log('');
}

if (!chat) {
  console.log('');
  console.log(`${RED}✗${RESET} Não chegou nenhuma mensagem em 3 minutos.`);
  console.log(`  Envie /start a @${me.result.username} e volte a correr este comando.`);
  process.exit(1);
}

console.log(`${GREEN}✓${RESET} chat encontrado: ${chat.name} (${chat.type}, id=${chat.id})`);

// --- Gravar no .env --------------------------------------------------------

setEnv(ENV_PATH, { TELEGRAM_CHAT_ID: chat.id });
console.log(`${GREEN}✓${RESET} TELEGRAM_CHAT_ID gravado no .env`);

// --- Confirmar com uma mensagem real --------------------------------------

const res = await fetch(api('sendMessage'), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    chat_id: chat.id,
    text:
      '✅ Sistema de Trading ligado.\n\n' +
      'Este canal vai receber os sinais de entrada e saída do motor MMXM + SMT.\n\n' +
      'Modo: paper — nenhuma ordem é enviada a nenhuma corretora.',
    disable_web_page_preview: true,
  }),
  signal: AbortSignal.timeout(30_000),
});

const sent = await res.json();
console.log('');
if (sent.ok) {
  console.log(`${GREEN}✓${RESET} Mensagem de confirmação enviada — verifique o Telegram.`);
  console.log('');
  console.log('Para testar com um sinal completo:');
  console.log('  npm run test:notify');
} else {
  console.log(`${RED}✗${RESET} Falhou o envio: ${sent.description}`);
}
console.log('');
