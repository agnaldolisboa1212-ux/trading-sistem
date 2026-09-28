/**
 * ICT ALGO: a mesma indicação em qualquer timeframe.
 *
 * O viés diário tem de ser o mesmo em 15M, 1H e 4H no mesmo instante — é
 * "diário". Antes de 27/09/2026 dependia das poças e do preço do timeframe de
 * execução e divergia em 29% dos instantes reais.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agregar, correrIctAlgo } from '../dist/index.js';

const M15 = 900_000;
function passeio(n, inicio, semente) {
  let s = semente;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const v = [];
  let p = 1.1;
  for (let i = 0; i < n; i++) {
    const o = p;
    const c = o + (rnd() - 0.5) * 0.004 + Math.sin(i / 300) * 0.0003;
    v.push({ time: inicio + i * M15, open: o, high: Math.max(o, c) + rnd() * 0.001, low: Math.min(o, c) - rnd() * 0.001, close: c, volume: 0 });
    p = c;
  }
  return v.filter((x) => {
    const d = new Date(x.time).getUTCDay();
    return d !== 0 && d !== 6;
  });
}

test('ICT ALGO: o viés diário é o mesmo em 15M, 1H e 4H no mesmo instante (incluindo fim de semana)', () => {
  for (const semente of [3, 11, 29]) {
    const m15 = passeio(96 * 420, Date.UTC(2025, 0, 6), semente);
    const h1 = agregar(m15, '1h');
    const h4 = agregar(m15, '4h');
    const diariasTodas = agregar(m15, '1d');
    // Dias úteis, e um sábado e um domingo.
    for (const agora of [Date.UTC(2026, 0, 14, 9), Date.UTC(2026, 0, 21, 14), Date.UTC(2026, 0, 24, 9), Date.UTC(2026, 0, 25, 12)]) {
      const ate = (v, ms) => v.filter((x) => x.time + ms <= agora);
      const diarias = ate(diariasTodas, 86_400_000).slice(-400);
      const semanais = agregar(diarias, '1w');
      const vieses = [
        ['15m', m15, M15],
        ['1h', h1, 3_600_000],
        ['4h', h4, 14_400_000],
      ].map(([tf, v, ms]) => {
        const a = correrIctAlgo({ simbolo: 'EURUSD', timeframe: tf, velas: ate(v, ms).slice(-1500), diarias, semanais, referencia: diarias, timeframeReferencia: '1d', par: null, agora });
        return `${a.vies?.direccao}/${a.vies?.aFavor}`;
      });
      assert.equal(new Set(vieses).size, 1, `semente ${semente}, ${new Date(agora).toISOString()}: ${vieses.join(' · ')}`);
    }
  }
});
