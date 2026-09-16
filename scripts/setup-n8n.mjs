/**
 * Cria (ou reutiliza) o workflow de receção do n8n e grava o webhook no .env.
 *
 *   npm run setup:n8n
 *
 * Duas credenciais DIFERENTES estão em jogo, e confundi-las é o erro habitual:
 *
 *   N8N_API_KEY     — credencial da Public API. Serve para GERIR o n8n
 *                     (criar workflows). Usada só por este script.
 *   N8N_WEBHOOK_URL — endereço que RECEBE os eventos do motor. É o que o
 *                     runtime usa, e é o que este script descobre e grava.
 *
 * O workflow criado é deliberadamente mínimo: um nó Webhook e um nó Set que
 * achata os campos do sinal. Não inclui nós que dependam de credenciais (Telegram,
 * Gmail) porque essas não podem ser configuradas por API sem expor segredos — a
 * ligação a elas é feita na interface, a partir deste ponto de entrada.
 *
 * É idempotente: se já existir um workflow com o mesmo nome, reutiliza-o em vez
 * de criar um duplicado.
 */

import { existsSync } from 'node:fs';
import { readEnv, setEnv } from './env-file.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = join(ROOT, '.env');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const WORKFLOW_NAME = 'Sistema de Trading — Sinais MMXM/SMT';

if (!existsSync(ENV_PATH)) {
  console.log(`${RED}✗${RESET} Não existe .env na raiz do projeto.`);
  process.exit(1);
}

const env = readEnv(ENV_PATH);

const base = (env['N8N_BASE_URL'] ?? '').replace(/\/+$/, '');
const apiKey = env['N8N_API_KEY'] ?? '';

console.log('');
console.log('Configuração do n8n');
console.log('─'.repeat(60));

if (!base || !apiKey) {
  console.log(`${RED}✗${RESET} Faltam N8N_BASE_URL e/ou N8N_API_KEY no .env.`);
  console.log('');
  console.log('  N8N_BASE_URL   endereço da instância (ex.: https://n8n.exemplo.com)');
  console.log('  N8N_API_KEY    Settings → n8n API → Create an API key');
  process.exit(1);
}

async function api(path, init = {}) {
  const res = await fetch(`${base}/api/v1${path}`, {
    ...init,
    headers: {
      'X-N8N-API-KEY': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, ok: res.ok, body };
}

// --- 1. A API responde? ----------------------------------------------------

const probe = await api('/workflows?limit=1');
if (probe.status === 401) {
  console.log(`${RED}✗${RESET} API key rejeitada (HTTP 401). Gere uma nova em Settings → n8n API.`);
  process.exit(1);
}
if (!probe.ok) {
  console.log(`${RED}✗${RESET} A API não respondeu (HTTP ${probe.status}): ${JSON.stringify(probe.body).slice(0, 200)}`);
  process.exit(1);
}
console.log(`${GREEN}✓${RESET} API acessível em ${base}`);

// --- 2. Já existe? ---------------------------------------------------------

/** Percorre a paginação à procura do workflow pelo nome. */
async function findExisting() {
  let cursor = '';
  for (let page = 0; page < 20; page++) {
    const r = await api(`/workflows?limit=100${cursor ? `&cursor=${cursor}` : ''}`);
    if (!r.ok) return null;
    const found = (r.body?.data ?? []).find((w) => w.name === WORKFLOW_NAME);
    if (found) return found;
    cursor = r.body?.nextCursor ?? '';
    if (!cursor) break;
  }
  return null;
}

let workflow = await findExisting();
let webhookPath;

if (workflow) {
  console.log(`${YELLOW}!${RESET} Workflow já existe (id=${workflow.id}) — a reutilizar.`);
  const full = await api(`/workflows/${workflow.id}`);
  const node = (full.body?.nodes ?? []).find((n) => n.type === 'n8n-nodes-base.webhook');
  webhookPath = node?.parameters?.path;
  if (!webhookPath) {
    console.log(`${RED}✗${RESET} O workflow existente não tem nó Webhook reconhecível.`);
    console.log(`  Apague-o no n8n e volte a correr, ou defina N8N_WEBHOOK_URL à mão.`);
    process.exit(1);
  }
  workflow = full.body;
} else {
  // --- 3. Criar ------------------------------------------------------------
  webhookPath = `trading-sinais-${randomUUID().slice(0, 8)}`;

  const nodes = [
    {
      parameters: {
        httpMethod: 'POST',
        path: webhookPath,
        // Responde imediatamente: o motor não deve ficar bloqueado à espera
        // do que o n8n faça a jusante.
        responseMode: 'onReceived',
        options: {},
      },
      id: randomUUID(),
      name: 'Receber sinal',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [0, 0],
      webhookId: randomUUID(),
    },
    {
      parameters: {
        assignments: {
          assignments: [
            { id: randomUUID(), name: 'evento', value: '={{ $json.body.event }}', type: 'string' },
            { id: randomUUID(), name: 'simbolo', value: '={{ $json.body.payload.symbol }}', type: 'string' },
            { id: randomUUID(), name: 'lado', value: '={{ $json.body.payload.side }}', type: 'string' },
            { id: randomUUID(), name: 'entrada', value: '={{ $json.body.payload.entry }}', type: 'number' },
            { id: randomUUID(), name: 'stop', value: '={{ $json.body.payload.stopLoss }}', type: 'number' },
            { id: randomUUID(), name: 'maxR', value: '={{ $json.body.payload.maxR }}', type: 'number' },
            { id: randomUUID(), name: 'confianca', value: '={{ $json.body.payload.confidence }}', type: 'number' },
          ],
        },
        includeOtherFields: true,
        options: {},
      },
      id: randomUUID(),
      name: 'Extrair campos',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [220, 0],
    },
  ];

  const connections = {
    'Receber sinal': { main: [[{ node: 'Extrair campos', type: 'main', index: 0 }]] },
  };

  const created = await api('/workflows', {
    method: 'POST',
    body: JSON.stringify({ name: WORKFLOW_NAME, nodes, connections, settings: {} }),
  });

  if (!created.ok) {
    console.log(`${RED}✗${RESET} Falhou a criação (HTTP ${created.status}):`);
    console.log('  ' + JSON.stringify(created.body).slice(0, 400));
    process.exit(1);
  }

  workflow = created.body;
  console.log(`${GREEN}✓${RESET} Workflow criado (id=${workflow.id})`);
}

// --- 4. Ativar -------------------------------------------------------------

if (!workflow.active) {
  const act = await api(`/workflows/${workflow.id}/activate`, { method: 'POST' });
  if (act.ok) {
    console.log(`${GREEN}✓${RESET} Workflow ativado`);
  } else {
    console.log(`${YELLOW}!${RESET} Não consegui ativar por API (HTTP ${act.status}). Ative-o na interface.`);
    console.log('  ' + JSON.stringify(act.body).slice(0, 200));
  }
} else {
  console.log(`${GREEN}✓${RESET} Workflow já estava ativo`);
}

// --- 5. Gravar o webhook no .env ------------------------------------------

const webhookUrl = `${base}/webhook/${webhookPath}`;
setEnv(ENV_PATH, { N8N_WEBHOOK_URL: webhookUrl });

console.log(`${GREEN}✓${RESET} N8N_WEBHOOK_URL gravado no .env`);
console.log('');
console.log(`  ${DIM}${webhookUrl}${RESET}`);

// --- 6. Testar de verdade --------------------------------------------------

console.log('');
console.log(`${DIM}a enviar um evento de teste...${RESET}`);

const test = await fetch(webhookUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...(env['N8N_WEBHOOK_SECRET'] ? { 'X-Webhook-Secret': env['N8N_WEBHOOK_SECRET'] } : {}),
  },
  body: JSON.stringify({
    event: 'scan.completed',
    emittedAt: new Date().toISOString(),
    source: 'sistema-de-trading',
    payload: { teste: true, symbol: 'EURUSD', side: 'BUY', entry: 1.0832, stopLoss: 1.0765, maxR: 6.2, confidence: 0.81 },
  }),
  signal: AbortSignal.timeout(30_000),
}).catch((e) => ({ ok: false, status: 0, statusText: e.message }));

console.log('');
if (test.ok) {
  console.log(`${GREEN}✓${RESET} Webhook respondeu (HTTP ${test.status}) — o n8n está a receber.`);
  console.log('');
  console.log('  Abra o workflow no n8n para ver a execução e ligar o que quiser a jusante');
  console.log('  (Telegram, Sheets, email, Discord).');
} else if (test.status === 404) {
  console.log(`${YELLOW}!${RESET} HTTP 404 — o webhook de produção só responde com o workflow ATIVO.`);
  console.log('  Ative-o na interface do n8n e volte a correr este comando.');
} else {
  console.log(`${RED}✗${RESET} O webhook não respondeu (HTTP ${test.status} ${test.statusText ?? ''}).`);
}
console.log('');
