/**
 * Carry no forex — a terceira da tríade (tendência, valor, carry).
 *
 * A ideia, documentada há décadas: estar comprado nas moedas de juro alto
 * contra as de juro baixo rende o diferencial, e historicamente o movimento do
 * preço à vista não o anula por completo. É a estratégia que a AQR e a Robeco
 * medem a par do momentum.
 *
 * Aqui mede-se nos DEZ pares que a corretora oferece, com as taxas interbancárias
 * mensais da OCDE (via FRED) e os preços diários de 15 anos que o projecto já tem.
 *
 * O que se mede, e porquê separado:
 *   só preço      o movimento à vista, sem juros — é onde mora o risco
 *   + carry 100%  a rentabilidade teórica, com o diferencial todo
 *   + carry 50%   o que sobra depois de a corretora ficar com metade do swap,
 *                 que é a hipótese realista
 *
 * ── O QUE DEU (22/09/2026) ─────────────────────────────────────────────────
 *
 *   3 contra 3, carry todo        +0,9%/ano   t=0,7   Sharpe 0,17
 *   3 contra 3, metade do carry   +0,1%/ano   t=0,0
 *   só longo (carry>0)            +2,0%/ano   t=1,6   Sharpe 0,41
 *   só longo, metade do carry     +1,2%/ano   t=1,0
 *
 * Não passa. O prémio de carry está documentado num universo MUITO mais largo
 * — com moedas emergentes, onde os diferenciais são de 10 pontos e não de 2.
 * Com as oito moedas que a corretora oferece, e com a corretora a ficar com
 * parte do swap, não sobra nada. A variante "só longo" chega a t=1,6 mas a
 * primeira metade é +0,1%/ano: é viés de dólar em 2019+, não carry.
 *
 * Uso: node scripts/backtest/carry-forex.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/';
const AQUI = RAIZ + 'data/backtest/taxas/';
const DIARIO = RAIZ + 'data/backtest/diario/';

/* As taxas vêm do FRED (séries da OCDE), e ficam em cache no disco. */
const FRED = { US3m: 'IR3TIB01USM156N', EZ3m: 'IR3TIB01EZM156N', JP3m: 'IR3TIB01JPM156N', GB3m: 'IR3TIB01GBM156N',
  AU3m: 'IR3TIB01AUM156N', NZ3m: 'IR3TIB01NZM156N', CA3m: 'IR3TIB01CAM156N', CH3m: 'IR3TIB01CHM156N' };
mkdirSync(AQUI, { recursive: true });
for (const [nome, id] of Object.entries(FRED)) {
  if (existsSync(`${AQUI}${nome}.csv`)) continue;
  const r = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`);
  if (!r.ok) {
    console.error(`falhou a taxa ${nome} (${id}): ${r.status}`);
    process.exit(1);
  }
  writeFileSync(`${AQUI}${nome}.csv`, await r.text());
  console.log(`taxa ${nome} descarregada`);
}

/** Moeda → ficheiro da taxa. */
// Taxa interbancária a 3 MESES: é sobre ela que os pontos a prazo (e portanto o
// swap) são cotados. A primeira tentativa usou a taxa overnight da OCDE, cujas
// séries do NZD e do CHF acabam em 2024 — e congelar o CHF em 1,34% quando ele
// está hoje em −0,045% inventava carry que não existe. Trocou-se tudo por esta.
const TAXAS = { USD: 'US3m', EUR: 'EZ3m', JPY: 'JP3m', GBP: 'GB3m', AUD: 'AU3m', NZD: 'NZ3m', CAD: 'CA3m', CHF: 'CH3m' };
/** Par → [base, cotada]: comprar o par é ficar longo da base e curto da cotada. */
const PARES = {
  EURUSD: ['EUR', 'USD'], GBPUSD: ['GBP', 'USD'], AUDUSD: ['AUD', 'USD'], NZDUSD: ['NZD', 'USD'],
  USDJPY: ['USD', 'JPY'], USDCHF: ['USD', 'CHF'], USDCAD: ['USD', 'CAD'],
  EURGBP: ['EUR', 'GBP'], EURJPY: ['EUR', 'JPY'], GBPJPY: ['GBP', 'JPY'],
};

function lerTaxas(codigo) {
  const linhas = readFileSync(`${AQUI}${codigo}.csv`, 'utf8').trim().split('\n').slice(1);
  const m = new Map();
  for (const l of linhas) {
    const [data, valor] = l.split(',');
    const v = Number(valor);
    if (Number.isFinite(v)) m.set(data.slice(0, 7), v); // AAAA-MM
  }
  return m;
}
const taxas = Object.fromEntries(Object.entries(TAXAS).map(([moeda, c]) => [moeda, lerTaxas(c)]));

/** Taxa da moeda nesse mês; se a série acabou, usa a última conhecida (e conta-se). */
let extrapolados = 0;
function taxa(moeda, mes) {
  const m = taxas[moeda];
  if (m.has(mes)) return m.get(mes);
  let ultima = null;
  for (const [k, v] of m) if (k <= mes) ultima = v;
  if (ultima !== null) extrapolados++;
  return ultima;
}

/** Preços de fecho no último dia de cada mês. */
function fechosMensais(par) {
  const v = JSON.parse(readFileSync(`${DIARIO}${par}.json`, 'utf8'));
  const m = new Map();
  for (const c of v) m.set(new Date(c.time).toISOString().slice(0, 7), c.close);
  return m;
}
const precos = Object.fromEntries(Object.keys(PARES).map((p) => [p, fechosMensais(p)]));

// Meses comuns a tudo
const meses = [...precos.EURUSD.keys()].filter((m) => m >= '2011-10' && m <= '2026-08').sort();

function st(rs) {
  const n = rs.length;
  if (n < 3) return { n, media: 0, t: 0, sharpe: 0 };
  const m = rs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rs.reduce((a, r) => a + (r - m) ** 2, 0) / (n - 1));
  return { n, media: m, t: m / (sd / Math.sqrt(n)), sharpe: (m / sd) * Math.sqrt(12) };
}

/**
 * Uma passagem da estratégia.
 * @param quantos quantos pares em cada ponta (3 = longo nos 3 de maior carry, curto nos 3 de menor)
 * @param capturaCarry fracção do diferencial que a corretora deixa passar
 * @param soLongo true = só compra os de carry positivo, sem vender nada
 */
function correr({ quantos = 3, capturaCarry = 1, soLongo = false, soPreco = false } = {}) {
  const retornos = [];
  for (let i = 0; i < meses.length - 1; i++) {
    const mes = meses[i];
    const seguinte = meses[i + 1];
    const candidatos = [];
    for (const [par, [base, cotada]] of Object.entries(PARES)) {
      const p0 = precos[par].get(mes);
      const p1 = precos[par].get(seguinte);
      const rb = taxa(base, mes);
      const rc = taxa(cotada, mes);
      if (!(p0 > 0) || !(p1 > 0) || rb === null || rc === null) continue;
      candidatos.push({ par, carry: (rb - rc) / 100, retornoPreco: p1 / p0 - 1 });
    }
    if (candidatos.length < 6) continue;
    candidatos.sort((a, b) => b.carry - a.carry);
    const longos = soLongo ? candidatos.filter((c) => c.carry > 0) : candidatos.slice(0, quantos);
    const curtos = soLongo ? [] : candidatos.slice(-quantos);
    if (longos.length === 0) continue;
    const ganho = (c, lado) =>
      lado * (c.retornoPreco + (soPreco ? 0 : (capturaCarry * c.carry) / 12));
    let r = 0;
    for (const c of longos) r += ganho(c, 1) / longos.length;
    for (const c of curtos) r -= ganho(c, -1) / curtos.length * -1; // curto: ganha o simétrico
    if (curtos.length > 0) r /= 2; // metade do capital em cada ponta
    retornos.push({ mes, r });
  }
  return retornos;
}

const CORTE = '2019-01';
function mostra(nome, rs) {
  const s = st(rs.map((x) => x.r));
  const a = st(rs.filter((x) => x.mes < CORTE).map((x) => x.r));
  const b = st(rs.filter((x) => x.mes >= CORTE).map((x) => x.r));
  const anual = s.media * 12 * 100;
  console.log(
    nome.padEnd(34) +
      `${(100 * s.media).toFixed(2)}%/mês`.padStart(12) +
      `${anual >= 0 ? '+' : ''}${anual.toFixed(1)}%/ano`.padStart(12) +
      `t=${s.t.toFixed(1)}`.padStart(8) +
      `Sharpe ${s.sharpe.toFixed(2)}`.padStart(14) +
      `${(100 * a.media * 12).toFixed(1)}%`.padStart(9) +
      `${(100 * b.media * 12).toFixed(1)}%`.padStart(9),
  );
}

console.log('Carry no forex · 10 pares da corretora · taxas interbancárias mensais (OCDE/FRED)');
console.log(`${meses.length} meses, de ${meses[0]} a ${meses.at(-1)}\n`);
console.log(
  'estratégia'.padEnd(34) + 'por mês'.padStart(12) + 'por ano'.padStart(12) + 't'.padStart(8) +
    'Sharpe'.padStart(14) + 'até2018'.padStart(9) + '2019+'.padStart(9),
);
mostra('3v3, carry todo', correr({ quantos: 3, capturaCarry: 1 }));
mostra('3v3, metade do carry', correr({ quantos: 3, capturaCarry: 0.5 }));
mostra('3v3, SÓ o preço (sem juros)', correr({ quantos: 3, soPreco: true }));
mostra('2v2, carry todo', correr({ quantos: 2, capturaCarry: 1 }));
mostra('4v4, carry todo', correr({ quantos: 4, capturaCarry: 1 }));
mostra('só longo (carry>0), todo', correr({ soLongo: true, capturaCarry: 1 }));
mostra('só longo, metade', correr({ soLongo: true, capturaCarry: 0.5 }));
console.log(`\n(${extrapolados} meses usaram a última taxa conhecida — as séries do NZD e do CHF acabam antes)`);
