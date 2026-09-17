#!/usr/bin/env node
/**
 * Descarrega o histórico usado para validar as estratégias.
 *
 *   node scripts/backtest/baixar.mjs
 *
 *   data/backtest/deriv/SIMBOLO_TF.json   Deriv, ~1 ano, 15m/1h/4h/1d, por páginas
 *   data/backtest/diario/SIMBOLO.json     Yahoo, diário, 15 anos
 *
 * A Deriv devolve no máximo 1000 velas por pedido e cerca de um ano de
 * histórico; o diário longo vem do Yahoo (índices à vista, futuros do ouro,
 * BTC e ETH) para testar regras de swing com anos suficientes.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { acharSimbolo } = await import(pathToFileURL(join(RAIZ, 'packages/data/dist/deriv-simbolos.js')).href);
const DERIV = join(RAIZ, 'data', 'backtest', 'deriv');
const DIARIO = join(RAIZ, 'data', 'backtest', 'diario');
mkdirSync(DERIV, { recursive: true });
mkdirSync(DIARIO, { recursive: true });

const SIMBOLOS = ['EURUSD', 'GBPUSD', 'US100', 'SP500', 'US30', 'GER30', 'XAUUSD', 'BTCUSD', 'ETHUSD', 'V75', 'V100S'];
const TFS = { '15m': [900, 12], '1h': [3600, 8], '4h': [14400, 4], '1d': [86400, 2] };

const ws = new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public');
await new Promise((ok, falha) => {
  ws.onopen = ok;
  ws.onerror = falha;
});
let seq = 1;
const pendentes = new Map();
ws.onmessage = (m) => {
  const j = JSON.parse(String(m.data));
  pendentes.get(j.req_id)?.(j);
  pendentes.delete(j.req_id);
};
const pedir = (p) =>
  new Promise((ok) => {
    const id = seq++;
    pendentes.set(id, ok);
    ws.send(JSON.stringify({ ...p, req_id: id }));
  });

for (const codigo of SIMBOLOS) {
  const s = acharSimbolo(codigo);
  for (const [tf, [gran, paginas]] of Object.entries(TFS)) {
    const todas = new Map();
    let end = 'latest';
    for (let p = 0; p < paginas; p++) {
      const r = await pedir({ ticks_history: s.deriv, adjust_start_time: 1, count: 1000, end, style: 'candles', granularity: gran });
      const velas = r.candles ?? [];
      if (r.error || velas.length === 0) break;
      for (const c of velas) {
        todas.set(c.epoch, { time: c.epoch * 1000, open: +c.open, high: +c.high, low: +c.low, close: +c.close, volume: 0 });
      }
      end = String(velas[0].epoch - 1);
      if (velas.length < 50) break;
    }
    const lista = [...todas.values()].sort((a, b) => a.time - b.time);
    writeFileSync(join(DERIV, `${codigo}_${tf}.json`), JSON.stringify(lista));
    console.log('deriv', codigo, tf, lista.length);
  }
}
ws.close();

const YAHOO = {
  US100: '^NDX', SP500: '^GSPC', US30: '^DJI', GER30: '^GDAXI', UK100: '^FTSE', FRA40: '^FCHI', EU50: '^STOXX50E',
  JP225: '^N225', HK50: '^HSI', AUS200: '^AXJO', NL25: '^AEX', SWI20: '^SSMI', XAUUSD: 'GC=F', BTCUSD: 'BTC-USD', ETHUSD: 'ETH-USD',
};
for (const [codigo, y] of Object.entries(YAHOO)) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?interval=1d&range=15y`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const res = r.ok ? (await r.json()).chart?.result?.[0] : null;
  const q = res?.indicators?.quote?.[0];
  if (!res || !q) {
    console.log('yahoo', codigo, 'sem dados');
    continue;
  }
  const velas = [];
  res.timestamp.forEach((t, i) => {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if ([o, h, l, c].every((x) => typeof x === 'number' && x > 0) && h >= l) velas.push({ time: t * 1000, open: o, high: h, low: l, close: c, volume: 0 });
  });
  writeFileSync(join(DIARIO, `${codigo}.json`), JSON.stringify(velas));
  console.log('yahoo', codigo, velas.length);
}
process.exit(0);
