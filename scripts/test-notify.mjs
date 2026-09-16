/**
 * Testa os canais de notificação com um sinal de exemplo.
 *
 *   npm run test:notify
 *
 * Envia uma entrada e uma saída fictícias por Telegram e n8n, para confirmar
 * que os canais estão bem configurados ANTES de haver um sinal a sério. Um
 * alerta perdido por causa de um chat_id errado só se descobriria semanas
 * depois, no dia em que finalmente houvesse um setup — e nessa altura já era
 * tarde.
 *
 * A mensagem vai marcada como TESTE para não ser confundida com um sinal real.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Carregar o .env para o ambiente antes de importar os módulos que o leem.
const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

const {
  broadcastEntry,
  broadcastExit,
  isTelegramConfigured,
  isN8nConfigured,
  formatEntryMessage,
} = await import('../packages/notify/dist/index.js');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

console.log('');
console.log('Teste dos canais de notificação');
console.log('─'.repeat(58));
console.log(`telegram: ${isTelegramConfigured() ? `${GREEN}configurado${RESET}` : `${YELLOW}não configurado${RESET}`}`);
console.log(`n8n:      ${isN8nConfigured() ? `${GREEN}configurado${RESET}` : `${YELLOW}não configurado${RESET}`}`);

if (!isTelegramConfigured() && !isN8nConfigured()) {
  console.log('');
  console.log('Nenhum canal configurado — nada a testar.');
  console.log('');
  console.log('Telegram:');
  console.log('  1. @BotFather → /newbot → TELEGRAM_BOT_TOKEN');
  console.log('  2. envie uma mensagem ao seu bot');
  console.log('  3. https://api.telegram.org/bot<TOKEN>/getUpdates → chat.id → TELEGRAM_CHAT_ID');
  console.log('');
  console.log('n8n:');
  console.log('  workflow com nó Webhook (POST) → cole o Production URL em N8N_WEBHOOK_URL');
  console.log('');
  process.exit(0);
}

/** Sinal fictício com a mesma forma de um real, para exercitar a formatação. */
const signal = {
  id: 'TESTE-EURUSD-1d-000',
  kind: 'entry',
  symbol: 'EURUSD',
  timeframe: '1d',
  direction: 'bullish',
  status: 'pending',
  generatedAt: Date.parse('2026-01-15T22:00:00Z'),
  referencePrice: 1.0842,
  entryZoneLow: 1.081,
  entryZoneHigh: 1.0855,
  entryPrice: 1.0832,
  stopLoss: 1.0765,
  targets: [
    { price: 1.0966, rMultiple: 2, closeFraction: 0.3, rationale: 'Parcial a 2R. Stop para break-even.' },
    { price: 1.1085, rMultiple: 3.8, closeFraction: 0.4, rationale: 'Consolidação original do MMXM.' },
    { price: 1.1245, rMultiple: 6.2, closeFraction: 0.3, rationale: 'Draw on liquidity — o runner.' },
  ],
  maxRMultiple: 6.2,
  positionSize: { units: 1492.5, riskAmount: 10, notional: 1617, impliedLeverage: 1.6, warnings: [], stopDistance: 0.0067 },
  model: {
    type: 'MMBM',
    direction: 'bullish',
    phase: 'right-curve-stage-1',
    consolidation: { high: 1.1085, low: 1.0902 },
    notes: [],
  },
  entryStage: 'first-stage-acc-dist',
  entryPattern: { kind: 'true-unicorn', quality: 0.92, low: 1.081, high: 1.0855, entry: 1.0832 },
  smtEvents: [
    {
      reference: 'GBPUSD',
      correlation: 'positive',
      at: 'low',
      strength: 0.61,
      description: 'EURUSD fez higher low enquanto GBPUSD fez lower low (correlacionados).',
    },
  ],
  checklist: {
    score: 1,
    passed: true,
    steps: [
      { step: 1, question: 'Draw on liquidity HTF é óbvio?', passed: true, detail: 'Sim — buyside em 1.12450.' },
      { step: 2, question: 'Fluxo institucional HTF é óbvio?', passed: true, detail: 'Sim — HTF bullish.' },
      { step: 3, question: 'Preço num POI HTF?', passed: true, detail: 'Sim — FVG semanal.' },
      { step: 4, question: 'O tempo encontra o preço?', passed: true, detail: 'Sim — janela de reversão semanal.' },
      { step: 5, question: 'Existe SMT?', passed: true, detail: 'Sim — divergência contra GBPUSD.' },
      { step: 6, question: 'Houve CISD/MSS?', passed: true, detail: 'Sim — MSS bullish com displacement.' },
      { step: 7, question: 'Modelo de entrada definido?', passed: true, detail: 'Sim — True Unicorn.' },
      { step: 8, question: 'Invalidação definida?', passed: true, detail: 'Sim — 1.07650.' },
      { step: 9, question: 'Alvos definidos?', passed: true, detail: 'Sim — 3 alvos.' },
    ],
  },
  confidence: 0.81,
  expectedHorizonDays: 21,
  narrative: 'Sinal de teste.',
  warnings: ['ISTO É UM TESTE — nenhum sinal real foi gerado.'],
};

const exit = {
  signalId: signal.id,
  symbol: 'EURUSD',
  reason: 'target-hit',
  closeFraction: 0.3,
  price: 1.0966,
  time: Date.parse('2026-01-29T22:00:00Z'),
  newStopLoss: 1.0832,
  rMultipleRealized: 2,
  narrative: 'TESTE — alvo 1 atingido. Stop movido para break-even.',
};

console.log('');
console.log(`${DIM}pré-visualização da mensagem de entrada:${RESET}`);
console.log('─'.repeat(58));
console.log(formatEntryMessage(signal).replace(/\\([_*[\]()~`>#+\-=|{}.!\\])/g, '$1'));
console.log('─'.repeat(58));

console.log('');
console.log('a enviar entrada...');
for (const r of await broadcastEntry(signal)) {
  const label = r.skipped ? `${YELLOW}saltado${RESET}` : r.ok ? `${GREEN}entregue${RESET}` : `${RED}falhou${RESET}`;
  console.log(`  ${r.channel.padEnd(9)} ${label}${r.error ? ` — ${r.error}` : ''}`);
}

console.log('');
console.log('a enviar saída...');
for (const r of await broadcastExit(exit)) {
  const label = r.skipped ? `${YELLOW}saltado${RESET}` : r.ok ? `${GREEN}entregue${RESET}` : `${RED}falhou${RESET}`;
  console.log(`  ${r.channel.padEnd(9)} ${label}${r.error ? ` — ${r.error}` : ''}`);
}

console.log('');
console.log('Se recebeu as duas mensagens, os canais estão prontos.');
console.log('');
