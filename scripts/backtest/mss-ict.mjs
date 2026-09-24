/**
 * Market Structure Shift (MSS) — a mudança de estrutura como sinal.
 *
 * A definição mecânica, do próprio site do ICT:
 *
 *   "MSS = CHoCH + deslocamento (+ normalmente uma recolha de liquidez)"
 *   quebra   o preço FECHA além de um swing anterior, no sentido CONTRÁRIO
 *            à tendência existente (numa subida: fecha abaixo do último
 *            mínimo mais alto)
 *   confirma FECHO, não pavio
 *   desloca  a vela da quebra tem de ser de corpo grande e deixar um FVG —
 *            "um MSS não é válido sem deslocamento"
 *   entrada  esperar o recuo a um order block / FVG; o MSS dá o VIÉS, não a
 *            execução
 *
 * ── A DISCIPLINA QUE ESTE FICHEIRO IMPÕE ───────────────────────────────────
 *
 * Um swing só é CONHECIDO `k` velas depois de existir — é preciso ver as velas
 * seguintes para saber que aquele topo era um topo. Usar um swing antes disso é
 * ver o futuro, e foi exactamente o erro que inflacionou o teste dos order
 * blocks (t=13 que virou −0,04R). Aqui, nenhum swing é usado antes de estar
 * confirmado, e a vela da quebra é sempre posterior a essa confirmação.
 *
 * ── O QUE DEU (24/09/2026) ─────────────────────────────────────────────────
 *
 *   dentro da amostra   COMPRA +0,102R (t=2,4) · VENDA −0,033R
 *   FORA da amostra     COMPRA −0,010R (t=−0,2) · VENDA −0,114R
 *
 * Não replica. Os +0,102R eram da amostra que o escolheu — o mesmo padrão do
 * perfil de volume e do Silver Bullet. Não entrou no sistema.
 *
 * Uso: node scripts/backtest/mss-ict.mjs  (CONTROLO=1 para os mercados de fora)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/';
const DIR = (process.env.HISTDATA ?? RAIZ + 'data/backtest/histdata') + '/';
const HORA = 3_600_000;
const CORTE = Date.UTC(2024, 6, 1);

const MERCADOS = [
  ['GER30', 'GRXEUR', 2], ['SP500', 'SPXUSD', 0.6], ['US100', 'NSXUSD', 1.8], ['JP225', 'JPXJPY', 12],
  ['EURUSD', 'EURUSD', 0.00012], ['GBPUSD', 'GBPUSD', 0.00018], ['USDJPY', 'USDJPY', 0.012],
  ['XAUUSD', 'XAUUSD', 0.35], ['EURJPY', 'EURJPY', 0.018], ['XAGUSD', 'XAGUSD', 0.03],
];
const CONTROLO = [
  ['AUDUSD', 'AUDUSD', 0.0002], ['NZDUSD', 'NZDUSD', 0.0003], ['EURGBP', 'EURGBP', 0.00022],
  ['USDCAD', 'USDCAD', 0.00018], ['USDCHF', 'USDCHF', 0.00018], ['GBPJPY', 'GBPJPY', 0.03],
  ['UK100', 'UKXGBP', 2], ['FRA40', 'FRXEUR', 2],
];

function velas4h(ficheiro) {
  const v = JSON.parse(readFileSync(`${DIR}${ficheiro}_1h.json`, 'utf8'));
  const passo = 4 * HORA;
  const out = [];
  for (const c of v) {
    const k = c.time - (c.time % passo);
    const u = out[out.length - 1];
    if (u && u.time === k) {
      u.high = Math.max(u.high, c.high);
      u.low = Math.min(u.low, c.low);
      u.close = c.close;
    } else out.push({ ...c, time: k });
  }
  return out;
}

function atrSerie(v, p = 14) {
  const a = new Float64Array(v.length);
  let x = 0;
  for (let i = 0; i < v.length; i++) {
    const tr = i === 0 ? v[i].high - v[i].low
      : Math.max(v[i].high - v[i].low, Math.abs(v[i].high - v[i - 1].close), Math.abs(v[i].low - v[i - 1].close));
    x = i < p ? (x * i + tr) / (i + 1) : (x * (p - 1) + tr) / p;
    a[i] = x;
  }
  return a;
}

/**
 * Swings por fractal de `k` velas de cada lado.
 * `confirmadoEm` é o que impede o look-ahead: o swing em `i` só se sabe em i+k.
 */
function swings(v, k = 2) {
  const out = [];
  for (let i = k; i < v.length - k; i++) {
    let topo = true;
    let fundo = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (v[j].high >= v[i].high) topo = false;
      if (v[j].low <= v[i].low) fundo = false;
    }
    if (topo) out.push({ i, tipo: 'topo', preco: v[i].high, confirmadoEm: i + k });
    if (fundo) out.push({ i, tipo: 'fundo', preco: v[i].low, confirmadoEm: i + k });
  }
  return out;
}

/**
 * Um MSS na vela `i`?
 * Devolve o lado da NOVA tendência (+1 alta, −1 baixa) ou 0.
 */
function mssEm(v, sw, atr, i, { corpo = 0.5, exigirFvg = true }) {
  // Só swings JÁ confirmados antes desta vela.
  const vistos = [];
  for (const s of sw) {
    if (s.confirmadoEm >= i) break;
    vistos.push(s);
  }
  const topos = vistos.filter((s) => s.tipo === 'topo');
  const fundos = vistos.filter((s) => s.tipo === 'fundo');
  if (topos.length < 2 || fundos.length < 2) return 0;
  const t1 = topos.at(-1);
  const t2 = topos.at(-2);
  const f1 = fundos.at(-1);
  const f2 = fundos.at(-2);

  // Tendência pela estrutura: topos e fundos a subir = alta.
  const subida = t1.preco > t2.preco && f1.preco > f2.preco;
  const descida = t1.preco < t2.preco && f1.preco < f2.preco;
  if (!subida && !descida) return 0;

  const c = v[i];
  const corpoReal = Math.abs(c.close - c.open);
  if (!(corpoReal >= corpo * atr[i])) return 0; // deslocamento: corpo grande
  if (exigirFvg && i >= 2) {
    const gapBaixa = c.high < v[i - 2].low;
    const gapAlta = c.low > v[i - 2].high;
    if (subida && !gapBaixa) return 0;
    if (descida && !gapAlta) return 0;
  }
  // A quebra: fecho além do swing contrário.
  if (subida && c.close < f1.preco) return -1; // MSS de baixa numa subida
  if (descida && c.close > t1.preco) return 1; // MSS de alta numa descida
  return 0;
}

const st = (rs) => {
  const n = rs.length;
  if (n < 3) return { n, media: 0, t: 0, acerto: 0 };
  const m = rs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rs.reduce((a, r) => a + (r - m) ** 2, 0) / (n - 1));
  return { n, media: m, t: m / (sd / Math.sqrt(n)), acerto: rs.filter((r) => r > 0).length / n };
};

function operacoes(v, atr, sw, custo, { corpo, exigirFvg, alvo, stopAtr, H, lado }) {
  const ops = [];
  let livre = -1;
  for (let i = 60; i < v.length - 1; i++) {
    if (i <= livre) continue;
    const m = mssEm(v, sw, atr, i, { corpo, exigirFvg });
    if (m === 0 || (lado !== 0 && m !== lado)) continue;
    const a = atr[i];
    if (!(a > 0)) continue;
    const entrada = v[i].close;
    const risco = stopAtr * a;
    const stop = entrada - m * risco;
    let r = null;
    let k = i + 1;
    for (; k <= Math.min(i + H, v.length - 1); k++) {
      if ((m > 0 ? entrada - v[k].low : v[k].high - entrada) / risco >= 1) { r = -1; break; }
      if ((m > 0 ? v[k].high - entrada : entrada - v[k].low) / risco >= alvo) { r = alvo; break; }
    }
    livre = k;
    if (r === null) r = ((v[Math.min(i + H, v.length - 1)].close - entrada) * m) / risco;
    ops.push({ t: v[i].time, r: r - custo / risco });
  }
  return ops;
}

const mostra = (rot, ops) => {
  if (ops.length < 20) {
    console.log(rot.padEnd(36) + `${ops.length} operações (poucas)`);
    return;
  }
  ops.sort((a, b) => a.t - b.t);
  const s = st(ops.map((o) => o.r));
  const a = st(ops.filter((o) => o.t < CORTE).map((o) => o.r));
  const b = st(ops.filter((o) => o.t >= CORTE).map((o) => o.r));
  const passa = a.media > 0 && b.media > 0 && s.t >= 1.5;
  console.log(
    ((passa ? '✅ ' : '   ') + rot).padEnd(36) + String(s.n).padStart(6) +
      `${(100 * s.acerto).toFixed(0)}%`.padStart(6) +
      `${s.media >= 0 ? '+' : ''}${s.media.toFixed(3)}R`.padStart(10) +
      `t=${s.t.toFixed(1)}`.padStart(8) +
      `${a.media >= 0 ? '+' : ''}${a.media.toFixed(3)}`.padStart(9) +
      `${b.media >= 0 ? '+' : ''}${b.media.toFixed(3)}`.padStart(9),
  );
};

const lista = process.env.CONTROLO ? CONTROLO : MERCADOS;
console.log(`MSS · 4h · ${lista.length} mercados${process.env.CONTROLO ? ' QUE NÃO PARTICIPARAM NA ESCOLHA' : ''}\n`);
console.log('variante'.padEnd(36) + 'n'.padStart(6) + 'acerto'.padStart(6) + 'R/op'.padStart(10) + 't'.padStart(8) + '1.ª met.'.padStart(9) + '2.ª met.'.padStart(9));

const CUSTO_MULT = Number(process.env.CUSTO ?? 1);
function correr(cfg) {
  const todas = [];
  for (const [, ficheiro, custo] of lista) {
    let v;
    try {
      v = velas4h(ficheiro);
    } catch {
      continue;
    }
    const atr = atrSerie(v);
    todas.push(...operacoes(v, atr, swings(v, cfg.k ?? 2), custo * CUSTO_MULT, cfg));
  }
  return todas;
}

for (const exigirFvg of [true, false]) {
  for (const lado of [0, 1, -1]) {
    mostra(
      `corpo 0,5 ATR · ${exigirFvg ? 'com FVG' : 'sem FVG'} · ${lado === 0 ? 'ambos' : lado > 0 ? 'COMPRA' : 'VENDA '}`,
      correr({ corpo: 0.5, exigirFvg, alvo: 2, stopAtr: 1.5, H: 12, lado }),
    );
  }
}
console.log('');
for (const corpo of [0.75, 1]) {
  for (const lado of [1, -1]) {
    mostra(
      `corpo ${corpo} ATR · com FVG · ${lado > 0 ? 'COMPRA' : 'VENDA '}`,
      correr({ corpo, exigirFvg: true, alvo: 2, stopAtr: 1.5, H: 12, lado }),
    );
  }
}
