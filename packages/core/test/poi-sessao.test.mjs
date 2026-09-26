/**
 * POI de sessão (alertas): a leitura das 08:00 de Londres e o toque.
 *
 * Um passeio aleatório determinístico em 15M dá topos e fundos reais; os testes
 * verificam as regras (lado do viés, zona da vela do extremo, "por tocar") e o
 * TESTE DO CORTE: velas depois das 08:00 não mudam a leitura.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { poisDeSessao, toquesPoi, relogioLondres, diaLondres } from '../dist/index.js';

const M15 = 900_000;

function passeio(n, inicio, semente = 7) {
  let s = semente;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const v = [];
  let p = 150;
  for (let i = 0; i < n; i++) {
    const o = p;
    const passo = (rnd() - 0.5) * 0.3 + Math.sin(i / 40) * 0.02;
    const c = o + passo;
    const h = Math.max(o, c) + rnd() * 0.08;
    const l = Math.min(o, c) - rnd() * 0.08;
    v.push({ time: inicio + i * M15, open: o, high: h, low: l, close: c, volume: 0 });
    p = c;
  }
  return v;
}

// Segunda-feira 12/01/2026 00:00 UTC (inverno: Londres = UTC), 10 dias de 15M sem fins de semana.
const inicio = Date.UTC(2026, 0, 5);
const v15 = passeio(96 * 12, inicio).filter((c) => {
  const d = new Date(c.time).getUTCDay();
  return d !== 0 && d !== 6;
});
const as0930 = Date.UTC(2026, 0, 15, 9, 30);

test('POI: leitura das 08:00 — lado do viés, zona da vela do extremo, por tocar', () => {
  const l = poisDeSessao(v15.filter((c) => c.time + M15 <= as0930), as0930);
  assert.ok(l, 'há leitura');
  assert.equal(l.provisoria, false);
  assert.equal(relogioLondres(l.inicio).minutos, 8 * 60);
  assert.equal(diaLondres(l.inicio), diaLondres(as0930));
  const venda = l.vies === 'bearish';
  const j = v15.findIndex((c) => c.time + M15 > l.inicio) - 1;
  for (const z of l.pois) {
    assert.equal(z.lado, venda ? 'venda' : 'compra');
    // À frente do preço das 08:00.
    assert.ok(venda ? z.baixo > l.preco : z.alto < l.preco);
    const c = v15.find((x) => x.time === z.origem);
    assert.ok(c, 'a origem é uma vela');
    if (venda) {
      assert.equal(z.alto, c.high);
      assert.equal(z.baixo, Math.max(c.open, c.close));
    } else {
      assert.equal(z.baixo, c.low);
      assert.equal(z.alto, Math.min(c.open, c.close));
    }
    // Por tocar até às 08:00.
    const i0 = v15.indexOf(c);
    for (let k = i0 + 1; k <= j; k++) assert.ok(venda ? v15[k].high < z.extremo : v15[k].low > z.extremo);
    // Dos 3 dias de negociação anteriores.
    assert.ok(diaLondres(z.origem) < diaLondres(as0930));
  }
});

test('POI: o TESTE DO CORTE — as velas depois das 08:00 não mudam a leitura', () => {
  const ate = (t) => v15.filter((c) => c.time + M15 <= t);
  const as0800 = Date.UTC(2026, 0, 15, 8, 0);
  const a = poisDeSessao(ate(as0800), as0930);
  const b = poisDeSessao(ate(as0930), as0930);
  const c = poisDeSessao(v15, as0930);
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
});

test('POI: o toque é a primeira vela que entra na zona, só dentro da janela', () => {
  const l = poisDeSessao(v15, as0930);
  assert.ok(l);
  // Um POI construído à mão, à frente do preço, e uma vela de 1M que lá entra às 09:10.
  const venda = l.vies === 'bearish';
  const zona = venda
    ? { lado: 'venda', baixo: l.preco + 0.5, alto: l.preco + 0.6, extremo: l.preco + 0.6, origem: l.inicio - 86_400_000, chave: 'teste' }
    : { lado: 'compra', baixo: l.preco - 0.6, alto: l.preco - 0.5, extremo: l.preco - 0.6, origem: l.inicio - 86_400_000, chave: 'teste' };
  const leitura = { ...l, pois: [zona] };
  const t = Date.UTC(2026, 0, 15, 9, 10);
  const vela = (time, alto, baixo) => ({ time, open: (alto + baixo) / 2, high: alto, low: baixo, close: (alto + baixo) / 2, volume: 0 });
  const perto = venda ? vela(t - 60_000, l.preco + 0.4, l.preco + 0.3) : vela(t - 60_000, l.preco - 0.3, l.preco - 0.4);
  const dentro = venda ? vela(t, l.preco + 0.55, l.preco + 0.45) : vela(t, l.preco - 0.45, l.preco - 0.55);
  // Às 07:59 não conta: fora da janela.
  const cedo = venda ? vela(l.inicio - 60_000, l.preco + 0.7, l.preco + 0.5) : vela(l.inicio - 60_000, l.preco - 0.5, l.preco - 0.7);
  const toques = toquesPoi(leitura, [cedo, perto, dentro], t);
  assert.equal(toques.length, 1);
  assert.equal(toques[0].em, t);
  assert.equal(toques[0].invalido, false);
  // Antes da vela chegar, não há toque.
  assert.equal(toquesPoi(leitura, [cedo, perto, dentro], t - 60_000).length, 0);
  // Passar o POI em mais de ½ ATR invalida-o.
  const longe = venda
    ? vela(t + 60_000, zona.extremo + l.atr, zona.extremo)
    : vela(t + 60_000, zona.extremo, zona.extremo - l.atr);
  assert.equal(toquesPoi(leitura, [perto, dentro, longe], t + 60_000)[0].invalido, true);
});
