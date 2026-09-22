/**
 * O VWAP −2σ com uma última confirmação — a ideia do Agnaldo.
 *
 * O problema: medido em 4,7 anos, o VWAP −2σ dá ≈0R. O diagnóstico está no
 * padrão — negativo de 2022 a meados de 2024, positivo depois: a regra vive de
 * mercados em SUBIDA. Comprar a queda num mercado que está a cair é apanhar
 * faca.
 *
 * Em vez de retirar a estratégia, aperta-se o critério. Cada confirmação é
 * avaliada NA PRÓPRIA VELA DO SINAL — não se entra mais tarde, que era a
 * condição do Agnaldo.
 *
 * Mede-se o que interessa: quantos sinais se perdem, e quanto melhora o que
 * sobra. Um filtro que corta metade dos sinais para melhorar 0,01R não vale.
 *
 * NOTA: a regra em produção já leva as duas confirmações (média de 200 dias e
 * vela do sinal em alta), por isso a linha "sem filtro" aqui já não existe no
 * sistema — serve de comparação com o que a regra era antes de 22/09/2026.
 *
 * Uso: node scripts/backtest/vwap-com-confirmacao.mjs [SIMBOLOS...]
 */
import { readFileSync } from 'node:fs';

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/';
const DIR = (process.env.HISTDATA ?? RAIZ + 'data/backtest/histdata') + '/';
const DIARIO = RAIZ + 'data/backtest/diario/';
const { planCompraVwapIndices } = await import(pathToFileURL(RAIZ + 'packages/core/dist/index.js').href);

const HORA = 3_600_000;
const CORTE = Date.UTC(2024, 6, 1);
/** CUSTO=0.6 mede com o custo de uma conta raw. */
const CUSTO_MULT = Number(process.env.CUSTO ?? 1);
const CUSTO = { GER30: 2, SP500: 0.6, US100: 1.8, JP225: 12, UK100: 2, FRA40: 2,
  EURUSD: 0.00012, GBPUSD: 0.00018, GBPJPY: 0.03, USDJPY: 0.012, EURJPY: 0.018, XAUUSD: 0.35 };
const FICHEIRO = { GER30: 'GRXEUR', SP500: 'SPXUSD', US100: 'NSXUSD', JP225: 'JPXJPY', UK100: 'UKXGBP', FRA40: 'FRXEUR',
  EURUSD: 'EURUSD', GBPUSD: 'GBPUSD', GBPJPY: 'GBPJPY', USDJPY: 'USDJPY', EURJPY: 'EURJPY', XAUUSD: 'XAUUSD' };

function velas(simbolo, tf) {
  const v = JSON.parse(readFileSync(`${DIR}${FICHEIRO[simbolo]}_1h.json`, 'utf8'));
  if (tf === '1h') return v;
  const passo = 4 * HORA;
  const out = [];
  for (const c of v) {
    const k = c.time - (c.time % passo);
    const u = out[out.length - 1];
    if (u && u.time === k) {
      u.high = Math.max(u.high, c.high);
      u.low = Math.min(u.low, c.low);
      u.close = c.close;
      u.volume = (u.volume ?? 0) + (c.volume ?? 0);
    } else out.push({ ...c, time: k });
  }
  return out;
}

/** Velas diárias do índice, para a regra confirmar o regime. */
function diarias(simbolo) {
  try {
    return JSON.parse(readFileSync(`${DIARIO}${simbolo}.json`, 'utf8'));
  } catch {
    return null;
  }
}

/** Média de 200 dias do índice, do ficheiro diário: o regime de fundo. */
function regimeDiario(simbolo) {
  let v;
  try {
    v = JSON.parse(readFileSync(`${DIARIO}${simbolo}.json`, 'utf8'));
  } catch {
    return null;
  }
  const pontos = [];
  let soma = 0;
  for (let i = 0; i < v.length; i++) {
    soma += v[i].close;
    if (i >= 200) soma -= v[i - 200].close;
    if (i >= 199) pontos.push({ t: v[i].time, acima: v[i].close > soma / 200 });
  }
  return (t) => {
    // O último dia FECHADO antes do sinal.
    let r = null;
    for (const p of pontos) {
      if (p.t >= t) break;
      r = p.acima;
    }
    return r;
  };
}

function rsi(velas, periodo = 14) {
  const n = velas.length;
  const out = new Float64Array(n);
  let g = 0;
  let p = 0;
  for (let i = 1; i < n; i++) {
    const d = velas[i].close - velas[i - 1].close;
    const sobe = Math.max(d, 0);
    const desce = Math.max(-d, 0);
    if (i <= periodo) {
      g = (g * (i - 1) + sobe) / i;
      p = (p * (i - 1) + desce) / i;
    } else {
      g = (g * (periodo - 1) + sobe) / periodo;
      p = (p * (periodo - 1) + desce) / periodo;
    }
    out[i] = p === 0 ? 100 : 100 - 100 / (1 + g / p);
  }
  return out;
}

const st = (rs) => {
  const n = rs.length;
  if (n < 3) return { n, media: 0, t: 0, acerto: 0 };
  const m = rs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rs.reduce((a, r) => a + (r - m) ** 2, 0) / (n - 1));
  return { n, media: m, t: m / (sd / Math.sqrt(n)), acerto: rs.filter((r) => r > 0).length / n };
};

/*
 * A regra de produção já traz as duas confirmações (média de 200 dias e vela do
 * sinal em alta). O que resta aqui é medi-la, e ver o que AINDA se poderia
 * apertar por cima — para a próxima vez que a pergunta aparecer.
 */
const FILTROS = {
  'a regra actual': () => true,
  '+ RSI já a virar': (c) => c.rsiAgora > c.rsiAntes,
  '+ fecha no topo da vela': (c) => {
    const amp = c.vela.high - c.vela.low;
    return amp > 0 && (c.vela.close - c.vela.low) / amp >= 0.5;
  },
};
const SIMBOLOS = process.argv.slice(2).length ? process.argv.slice(2) : ['GER30', 'SP500', 'US100', 'JP225'];
const resultados = new Map(Object.keys(FILTROS).map((k) => [k, { antes: [], depois: [], anos: 0 }]));

for (const s of SIMBOLOS) {
  const regime = regimeDiario(s);
  const velas1d = diarias(s) ?? undefined;
  for (const tf of ['1h', '4h']) {
    let v;
    try {
      v = velas(s, tf);
    } catch {
      continue;
    }
    if (v.length < 400) continue;
    const r = rsi(v);
    const anos = (v[v.length - 1].time - v[0].time) / (365.25 * 24 * HORA);
    const livrePorFiltro = new Map(Object.keys(FILTROS).map((k) => [k, -1]));
    for (let i = 300; i < v.length - 1; i++) {
      const g = planCompraVwapIndices(v.slice(i - 299, i + 1), { symbol: s, timeframe: tf }, { velas1d })[0];
      if (!g) continue;
      const risco = g.entryPrice - g.stopLoss;
      if (!(risco > 0)) continue;
      const ctx = {
        vela: v[i],
        regime: regime ? regime(v[i].time) : null,
        rsiAgora: r[i],
        rsiAntes: r[i - 1],
      };
      // Gestão parcial: metade a +1R, resto a +2R com o stop na entrada.
      const custo = (CUSTO[s] * CUSTO_MULT) / risco;
      let parcial = null;
      let armado = false;
      let k = i + 1;
      for (; k < v.length && k <= i + 200; k++) {
        const baixo = (v[k].low - g.entryPrice) / risco;
        const alto = (v[k].high - g.entryPrice) / risco;
        if (armado && baixo <= 0) parcial = 0.5;
        else if (!armado && baixo <= -1) parcial = -1;
        else if (alto >= 2) parcial = 1.5;
        else if (alto >= 1) armado = true;
        if (parcial !== null) break;
      }
      if (parcial === null) continue;
      for (const [nome, f] of Object.entries(FILTROS)) {
        if (i <= livrePorFiltro.get(nome)) continue; // uma operação de cada vez
        if (!f(ctx)) continue;
        livrePorFiltro.set(nome, k);
        const acc = resultados.get(nome);
        (v[i].time < CORTE ? acc.antes : acc.depois).push(parcial - custo);
        acc.anos = Math.max(acc.anos, anos);
      }
    }
  }
}

console.log(`VWAP −2σ com confirmação · ${SIMBOLOS.join(', ')} · 1h e 4h · 4,7 anos de HistData\n`);
console.log(
  'confirmação'.padEnd(32) + 'sinais'.padStart(7) + '/ano'.padStart(7) + 'acerto'.padStart(8) +
    'R/op'.padStart(9) + 't'.padStart(7) + 'até jun/24'.padStart(12) + 'depois'.padStart(9) + 'R/ano'.padStart(8),
);
for (const [nome, acc] of resultados) {
  const todas = [...acc.antes, ...acc.depois];
  if (todas.length < 20) {
    console.log(nome.padEnd(32) + String(todas.length).padStart(7) + '   (poucos sinais)');
    continue;
  }
  const s = st(todas);
  const a = st(acc.antes);
  const b = st(acc.depois);
  const passa = a.media > 0 && b.media > 0 && s.t >= 1.5;
  const porAno = todas.length / acc.anos;
  console.log(
    ((passa ? '✅ ' : '   ') + nome).padEnd(32) +
      String(s.n).padStart(7) +
      porAno.toFixed(0).padStart(7) +
      `${(100 * s.acerto).toFixed(0)}%`.padStart(8) +
      `${s.media >= 0 ? '+' : ''}${s.media.toFixed(3)}`.padStart(9) +
      s.t.toFixed(1).padStart(7) +
      `${a.media >= 0 ? '+' : ''}${a.media.toFixed(3)}`.padStart(12) +
      `${b.media >= 0 ? '+' : ''}${b.media.toFixed(3)}`.padStart(9) +
      `${s.media * porAno >= 0 ? '+' : ''}${(s.media * porAno).toFixed(1)}R`.padStart(8),
  );
}
