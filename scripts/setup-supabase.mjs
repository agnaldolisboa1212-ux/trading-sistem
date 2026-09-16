/**
 * Verifica e ativa a ligação ao Supabase, de uma só vez.
 *
 *   node scripts/setup-supabase.mjs
 *
 * Faz, por esta ordem:
 *   1. lê o .env e confirma que a chave secreta lá está e tem o formato certo;
 *   2. testa uma ESCRITA real (não só uma leitura) — é a escrita que falha
 *      quando se usa a chave errada, e falhar aqui é muito mais barato do que
 *      falhar a meio de um varrimento;
 *   3. confirma que as 12 tabelas do esquema existem;
 *   4. corre um varrimento completo e grava tudo;
 *   5. confirma que as linhas chegaram lá.
 *
 * Desenhado para dar uma mensagem acionável em cada falha, em vez de um stack
 * trace: quase todos os erros aqui são de configuração, não de código.
 */

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';

const ok = (m) => console.log(`${GREEN}✓${RESET} ${m}`);
const bad = (m) => console.log(`${RED}✗${RESET} ${m}`);
const warn = (m) => console.log(`${YELLOW}!${RESET} ${m}`);
const dim = (m) => console.log(`${DIM}${m}${RESET}`);

function fail(message, howToFix) {
  console.log('');
  bad(message);
  if (howToFix) {
    console.log('');
    console.log(howToFix);
  }
  console.log('');
  process.exit(1);
}

// --- 1. Ler o .env ---------------------------------------------------------

const envPath = join(ROOT, '.env');
if (!existsSync(envPath)) {
  fail(
    'Não existe ficheiro .env na raiz do projeto.',
    'Corra:  cp .env.example .env    e volte a tentar.',
  );
}

const env = {};
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq === -1) continue;
  env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
}

const url = env['SUPABASE_URL'] ?? '';
const secret = env['SUPABASE_SECRET_KEY'] || env['SUPABASE_SERVICE_ROLE_KEY'] || '';

console.log('');
console.log('Verificação da ligação ao Supabase');
console.log('─'.repeat(58));

if (!url) {
  fail('SUPABASE_URL está vazia no .env.', 'Preencha com o URL do seu projeto (https://xxxx.supabase.co).');
}
ok(`SUPABASE_URL: ${url}`);

/* Referência do projeto, para poder apontar o link direto às chaves dele. */
const projectRef = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? '_';
const keysUrl = `https://supabase.com/dashboard/project/${projectRef}/settings/api-keys`;

if (!secret) {
  fail(
    'A chave secreta está vazia no .env (linha SUPABASE_SECRET_KEY).',
    [
      'Onde a encontrar, em 20 segundos:',
      '',
      `  1. Abra  ${keysUrl}`,
      '  2. Secção "API keys" → linha  secret  → clique em Reveal → copiar',
      '  3. Cole no .env:   SUPABASE_SECRET_KEY=sb_secret_...',
      '  4. Volte a correr:  npm run setup:supabase',
      '',
      `${DIM}A chave publicável (sb_publishable_...) NÃO serve aqui: por política`,
      `RLS ela só tem leitura. É a secreta que ignora RLS e permite escrever.${RESET}`,
    ].join('\n'),
  );
}

// Distinguir os dois formatos e apanhar o erro mais comum: colar a publicável.
if (secret.startsWith('sb_publishable_')) {
  fail(
    'A chave em SUPABASE_SECRET_KEY é a PUBLICÁVEL, não a secreta.',
    [
      'A publicável (sb_publishable_...) só tem leitura — o motor não conseguiria',
      'gravar nada. Precisa da que começa por  sb_secret_  .',
      '',
      `  ${keysUrl} → linha "secret" → Reveal`,
    ].join('\n'),
  );
}

const looksNew = secret.startsWith('sb_secret_');
const looksLegacy = secret.startsWith('eyJ');
if (!looksNew && !looksLegacy) {
  warn(`Formato de chave não reconhecido (${secret.slice(0, 10)}...). Vou tentar na mesma.`);
} else {
  ok(`chave secreta presente (${looksNew ? 'formato novo sb_secret_' : 'formato legado JWT'})`);
}

// --- 2. Testar uma ESCRITA real -------------------------------------------

const headers = {
  apikey: secret,
  Authorization: `Bearer ${secret}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

async function rest(path, init = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, ok: res.ok, body };
}

console.log('');
dim('a testar escrita...');

const probe = await rest('provider_health', {
  method: 'POST',
  headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
  body: JSON.stringify([
    { provider_id: '__setup_probe__', ok: true, consecutive_failures: 0 },
  ]),
});

if (probe.status === 401 || probe.status === 403) {
  fail(
    `A base de dados recusou a escrita (HTTP ${probe.status}).`,
    'A chave existe mas não tem permissão de escrita — confirme que copiou a "secret",\nnão a "publishable".',
  );
}
if (probe.status === 404) {
  fail(
    'A tabela provider_health não existe.',
    'O esquema ainda não foi aplicado. Abra o SQL Editor do Supabase e execute o\nconteúdo de supabase/migrations/0001_initial_schema.sql',
  );
}
if (!probe.ok) {
  fail(`Escrita falhou (HTTP ${probe.status}): ${JSON.stringify(probe.body).slice(0, 300)}`);
}
ok('escrita autorizada');

// Limpar a linha de teste — não deve ficar a sujar o painel.
await rest('provider_health?provider_id=eq.__setup_probe__', { method: 'DELETE' });

// --- 3. Confirmar o esquema ------------------------------------------------

const TABLES = [
  'instruments', 'candles', 'mmxm_models', 'smt_events', 'signals',
  'positions', 'position_events', 'equity_snapshots', 'scan_diagnostics',
  'provider_health', 'backtest_runs', 'v_open_positions',
];

const missing = [];
for (const t of TABLES) {
  const r = await rest(`${t}?select=*&limit=1`);
  if (!r.ok) missing.push(`${t} (HTTP ${r.status})`);
}

if (missing.length > 0) {
  fail(
    `Faltam ${missing.length} tabela(s): ${missing.join(', ')}`,
    'Execute supabase/migrations/0001_initial_schema.sql no SQL Editor do Supabase.\nA migração é idempotente — pode correr outra vez sem problema.',
  );
}
ok(`esquema completo (${TABLES.length}/${TABLES.length} tabelas)`);

// --- 4. Varrimento completo -----------------------------------------------

console.log('');
dim('a correr um varrimento e a gravar...');
console.log('');

const scan = spawnSync(
  process.execPath,
  [join(ROOT, 'apps', 'engine', 'dist', 'index.js'), 'scan'],
  { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } },
);

if (scan.status !== 0) {
  fail('O varrimento falhou. Veja o erro acima.');
}

// --- 5. Confirmar que os dados chegaram -----------------------------------

console.log('');
dim('a confirmar que os dados chegaram à base...');

const counts = {};
for (const t of ['instruments', 'scan_diagnostics', 'provider_health', 'signals']) {
  const r = await fetch(`${url}/rest/v1/${t}?select=*`, {
    headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
    signal: AbortSignal.timeout(20_000),
  });
  const range = r.headers.get('content-range') ?? '';
  counts[t] = range.split('/')[1] ?? '?';
}

console.log('');
console.log('─'.repeat(58));
for (const [t, n] of Object.entries(counts)) {
  console.log(`  ${t.padEnd(20)} ${String(n).padStart(5)} linha(s)`);
}
console.log('─'.repeat(58));

if (counts['scan_diagnostics'] === '0' || counts['scan_diagnostics'] === '?') {
  warn('Nenhum diagnóstico gravado — o varrimento correu mas não persistiu.');
  process.exit(1);
}

console.log('');
ok('Supabase ligado e a receber dados.');
console.log('');
console.log('O painel passa a ler da base de dados automaticamente (deixa de usar o');
console.log('snapshot local). Reinicie-o se estiver a correr:');
console.log('');
console.log('  npm run dashboard:dev');
console.log('');
