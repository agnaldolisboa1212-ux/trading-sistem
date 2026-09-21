/**
 * Alargar o VWAP −2σ (1h e 4h) a mais índices, com 4,7 anos de HistData
 * (2022–ago/2026) em vez do ano único da Deriv.
 *
 * Mesma simulação do scripts/backtest/verificar-validadas.mjs:
 *   entrada ao fecho do sinal, uma operação de cada vez, risco = entrada−stop,
 *   spread descontado, gestão parcial (metade a +1R, resto a +2R com o stop na
 *   entrada depois do primeiro alvo).
 *
 * Divisão: até 30/06/2024 (escolha) e depois (confirmação).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/';
// Velas de 1 minuto da HistData agregadas em 1h, uma pasta por quem as baixou.
// HISTDATA=<pasta> aponta para onde estão; sem elas só corre com FONTE=deriv.
const DIR = (process.env.HISTDATA ?? RAIZ + 'data/backtest/histdata') + '/';
const { planCompraVwapIndices } = await import(pathToFileURL(RAIZ + 'packages/core/dist/index.js').href);

const CORTE = Date.UTC(2024, 6, 1);
const HORA = 3_600_000;
// Spread + deslize em pontos do índice. GER30 como no verificar-validadas; os
// outros com o dobro da margem, por serem menos líquidos na corretora.
const CUSTO = { GER30: 2, UK100: 2, FRA40: 2, EU50: 2, JP225: 12, SP500: 0.6, US100: 1.8, US30: 3.5 };
/*
 * Nome do ficheiro da HistData para cada instrumento do catálogo.
 *
 * ATENÇÃO: `UDXUSD` na HistData é o ÍNDICE DO DÓLAR, não o Dow Jones — não há
 * Dow na HistData. Usá-lo como US30 dá −11R por operação (custo do Dow sobre um
 * preço de ~100), que é o sintoma de estar a medir outro instrumento.
 * O Dow e o EuroStoxx só se medem com os dados da Deriv (FONTE=deriv).
 */
const FICHEIRO = { GER30: 'GRXEUR', UK100: 'UKXGBP', FRA40: 'FRXEUR', EU50: 'ETXEUR', JP225: 'JPXJPY', SP500: 'SPXUSD', US100: 'NSXUSD' };

function ler(simbolo, tf) {
  // FONTE=deriv usa o histórico da Deriv (1 ano) — o controlo que confirma que
  // este script reproduz os números publicados antes de os pôr em causa.
  if (process.env.FONTE === 'deriv') {
    return JSON.parse(readFileSync(`${RAIZ}data/backtest/deriv/${simbolo}_${tf}.json`, 'utf8'));
  }
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
    } else out.push({ time: k, open: c.open, high: c.high, low: c.low, close: c.close, volume: 0 });
  }
  return out;
}

function estatistica(rs) {
  const n = rs.length;
  if (n < 3) return { n, acerto: 0, media: 0, t: 0 };
  const m = rs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rs.reduce((a, r) => a + (r - m) ** 2, 0) / (n - 1));
  return { n, acerto: rs.filter((r) => r > 0).length / n, media: m, t: m / (sd / Math.sqrt(n)) };
}
const linha = (rotulo, st) =>
  `${rotulo.padEnd(14)} n=${String(st.n).padStart(4)} ${(100 * st.acerto).toFixed(0).padStart(3)}% ` +
  `${st.media >= 0 ? '+' : ''}${st.media.toFixed(3)}R t=${st.t.toFixed(1).padStart(5)}`;

const SIMBOLOS = process.argv.slice(2);
for (const s of SIMBOLOS) {
  const antes = { f1: [], parcial: [] };
  const depois = { f1: [], parcial: [] };
  let sinais = 0;
  // Quanto tempo a amostra cobre: o controlo da Deriv tem 11 meses, a HistData
  // 4,7 anos. Dividir sempre pelo mesmo número dava uma frequência errada.
  let inicio = Infinity;
  let fim = 0;
  for (const tf of ['1h', '4h']) {
    let v;
    try {
      v = ler(s, tf);
    } catch {
      console.log(`${s}: sem dados`);
      break;
    }
    inicio = Math.min(inicio, v[0]?.time ?? Infinity);
    fim = Math.max(fim, v[v.length - 1]?.time ?? 0);
    let livre = -1;
    for (let i = 300; i < v.length - 1; i++) {
      if (i <= livre) continue;
      const g = planCompraVwapIndices(v.slice(i - 299, i + 1), { symbol: s, timeframe: tf })[0];
      if (!g) continue;
      sinais++;
      const risco = g.entryPrice - g.stopLoss;
      if (!(risco > 0)) continue;
      const custo = CUSTO[s] / risco;
      let f1 = null;
      let parcial = null;
      let armado = false;
      let k = i + 1;
      for (; k < v.length && k <= i + 200; k++) {
        const baixo = (v[k].low - g.entryPrice) / risco;
        const alto = (v[k].high - g.entryPrice) / risco;
        if (f1 === null) f1 = baixo <= -1 ? -1 : alto >= 1 ? 1 : null;
        if (parcial === null) {
          if (armado && baixo <= 0) parcial = 0.5;
          else if (!armado && baixo <= -1) parcial = -1;
          else if (alto >= 2) parcial = 1.5;
          else if (alto >= 1) armado = true;
        }
        if (f1 !== null && parcial !== null) break;
      }
      livre = k;
      if (f1 === null || parcial === null) continue;
      const destino = v[i].time < CORTE ? antes : depois;
      destino.f1.push(f1 - custo);
      destino.parcial.push(parcial - custo);
    }
  }
  const tudoP = [...antes.parcial, ...depois.parcial];
  if (tudoP.length === 0) continue;
  const st = estatistica(tudoP);
  const a = estatistica(antes.parcial);
  const b = estatistica(depois.parcial);
  const f1 = estatistica([...antes.f1, ...depois.f1]);
  const passa = a.media > 0 && b.media > 0 && st.t >= 1.5 && st.n >= 30;
  const anos = Math.max(0.1, (fim - inicio) / (365.25 * 24 * HORA));
  console.log(
    `\n${s} · 1h e 4h · custo ${CUSTO[s]} pts${passa ? '  ✅ PASSA' : ''}\n  ` +
      linha('gestão parcial', st) + `\n  ` + linha('até jun/2024', a) + `\n  ` + linha('depois', b) +
      `\n  ` + linha('alvo 1R', f1) +
      `\n  sinais por ano: ${(st.n / anos).toFixed(0)} · amostra de ${anos.toFixed(1)} anos`,
  );
}
