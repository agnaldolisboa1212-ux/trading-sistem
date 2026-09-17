/**
 * Estratégias em teste ao vivo — geram sinais sem taxa de acerto medida.
 *
 * Os testes fixam as regras que vão ser avaliadas ao fim da semana: se alguém
 * mudar um limiar a meio, os resultados deixam de ser de uma regra só.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acompanharOperacao,
  dxySintetico,
  estrategiaActiva,
  estrategiaEmTeste,
  estrategiaValidada,
  estrategiasPara,
  executarEstrategiasValidadas,
  fraseEvento,
  planSmtTeste,
  planVwapForexTeste,
  velasNecessariasSmt,
} from '../dist/index.js';

const H = 3_600_000;
const vela = (time, open, high, low, close) => ({ time, open, high, low, close, volume: 0 });

test('em teste: forex e ouro intradiário, nunca como validadas', () => {
  assert.deepEqual(estrategiasPara('EURUSD', '1h').map((e) => e.id), ['vwap-forex-teste', 'smt-teste']);
  assert.deepEqual(estrategiasPara('GBPJPY', '4h').map((e) => e.id), ['vwap-forex-teste']);
  assert.deepEqual(estrategiasPara('XAUUSD', '15m').map((e) => e.id), ['smt-teste']);
  assert.deepEqual(estrategiasPara('XAUUSD', '1d').map((e) => e.id), ['tendencia-ouro']);
  assert.equal(estrategiasPara('USDJPY', '15m').length, 0);
  assert.equal(estrategiaValidada('smt-teste'), undefined);
  assert.equal(estrategiaActiva('smt-teste')?.id, 'smt-teste');
  assert.equal(estrategiaEmTeste('vwap-forex-teste')?.emTeste.revisao, '2026-09-24');
  assert.deepEqual(velasNecessariasSmt('EURUSD').sort(), ['GBPUSD', 'USDCAD', 'USDCHF', 'USDJPY']);
  assert.deepEqual(velasNecessariasSmt('XAUUSD').sort(), ['EURUSD', 'GBPUSD', 'USDCAD', 'USDCHF', 'USDJPY', 'XAGUSD']);
});

test('DXY sintético: com todos os pares a 1, dá a constante da fórmula', () => {
  const um = [vela(0, 1, 1, 1, 1), vela(H, 1, 1, 1, 1)];
  const series = { EURUSD: um, USDJPY: um, GBPUSD: um, USDCAD: um, USDCHF: um };
  const d = dxySintetico(series);
  assert.equal(d.length, 2);
  assert.ok(Math.abs(d[0].close - 50.14348112) < 1e-9);
  // Falta uma vela num par: esse tempo sai.
  assert.equal(dxySintetico({ ...series, USDCHF: [um[0]] }).length, 1);
  assert.equal(dxySintetico({ EURUSD: um }).length, 0);
});

/** Um mês de velas de 1h a oscilar e um movimento final forte (para cima ou para baixo). */
function mesComMovimento(delta) {
  const inicio = Date.UTC(2026, 8, 1);
  const v = [];
  let p = 1.1;
  for (let i = 0; i < 200; i++) {
    const c = 1.1 + Math.sin(i / 3) * 0.0006;
    v.push(vela(inicio + i * H, p, Math.max(p, c) + 0.0003, Math.min(p, c) - 0.0003, c));
    p = c;
  }
  for (let k = 1; k <= 6; k++) {
    const c = 1.1 + (delta * k) / 6;
    v.push(vela(inicio + (200 + k) * H, p, Math.max(p, c) + 0.00005, Math.min(p, c) - 0.00005, c));
    p = c;
  }
  return v;
}

test('VWAP forex: vende 2σ acima, compra 2σ abaixo, com convicção 0', () => {
  const subida = planVwapForexTeste(mesComMovimento(0.006), { symbol: 'EURUSD', timeframe: '1h' });
  assert.equal(subida.length, 1);
  const s = subida[0];
  assert.equal(s.strategy, 'vwap-forex-teste');
  assert.equal(s.direction, 'bearish');
  assert.ok(s.stopLoss > s.entryPrice);
  const risco = s.stopLoss - s.entryPrice;
  assert.ok(Math.abs(s.targets[0].price - (s.entryPrice - risco)) < 1e-12, 'TP1 a +1R');
  assert.ok(Math.abs(s.targets[1].price - (s.entryPrice - 2 * risco)) < 1e-12, 'TP2 a +2R');
  assert.equal(s.conviction, 0);
  assert.match(s.rationale, /EM TESTE/);

  const queda = planVwapForexTeste(mesComMovimento(-0.006), { symbol: 'EURUSD', timeframe: '1h' });
  assert.equal(queda[0]?.direction, 'bullish');
  assert.equal(planVwapForexTeste(mesComMovimento(0), { symbol: 'EURUSD', timeframe: '1h' }).length, 0);
});

/**
 * Dois pares de 1h com dois topos em 60 e 70: o primeiro faz topo mais alto, o
 * segundo topo mais baixo. A última vela (73) é a que confirma os dois swings.
 */
function tenda(i, picos, base) {
  let h = 0;
  for (const [em, altura] of picos) h = Math.max(h, altura - Math.abs(i - em) * 0.0015);
  return base + h;
}
function parSmt(base, pico1, pico2, fimUtc) {
  const inicio = fimUtc - 73 * H;
  const v = [];
  for (let i = 0; i < 74; i++) {
    const alto = tenda(i, [[60, pico1], [70, pico2]], base);
    v.push(vela(inicio + i * H, alto - 0.001, alto, alto - 0.002, alto - 0.001));
  }
  return v;
}
function tendencia4h(fimUtc, sentido) {
  const v = [];
  for (let k = 80; k >= 1; k--) {
    const c = 1.2 + sentido * (80 - k) * 0.001;
    v.push(vela(fimUtc - k * 4 * H, c, c + 0.0005, c - 0.0005, c));
  }
  return v;
}

test('SMT: topo mais alto contra topo mais baixo, a favor da tendência → venda na vela que confirma', () => {
  const ultimaVela = Date.UTC(2026, 8, 17, 9); // fecha às 10:00 UTC
  const A = parSmt(1.1, 0.005, 0.006, ultimaVela);
  const B = parSmt(1.27, 0.006, 0.005, ultimaVela);
  const ctx = { symbol: 'EURUSD', timeframe: '1h' };
  const extra = { referencias: { GBPUSD: B }, velas4h: tendencia4h(ultimaVela + H, -1) };

  const s = planSmtTeste(A, ctx, extra);
  assert.equal(s.length, 1);
  assert.equal(s[0].strategy, 'smt-teste');
  assert.equal(s[0].direction, 'bearish');
  assert.equal(s[0].entryPrice, A[73].close);
  assert.ok(s[0].stopLoss > A[70].high, 'stop acima do topo mais alto');
  const risco = s[0].stopLoss - s[0].entryPrice;
  assert.ok(Math.abs(s[0].targets[0].price - (s[0].entryPrice - 2 * risco)) < 1e-12, 'alvo a +2R');
  assert.equal(s[0].conviction, 0);
  assert.match(s[0].rationale, /GBPUSD/);

  // O motor passa o SMT pelo mesmo caminho das validadas.
  assert.equal(executarEstrategiasValidadas(A, ctx, extra).filter((x) => x.strategy === 'smt-teste').length, 1);

  // Contra a tendência de 4h, sem referências, ou uma vela antes da confirmação: nada.
  assert.equal(planSmtTeste(A, ctx, { ...extra, velas4h: tendencia4h(ultimaVela + H, 1) }).length, 0);
  assert.equal(planSmtTeste(A, ctx, { velas4h: extra.velas4h }).length, 0);
  assert.equal(planSmtTeste(A.slice(0, 73), ctx, extra).length, 0);
  // Os dois a fazer topo mais alto não é divergência.
  assert.equal(planSmtTeste(A, ctx, { ...extra, referencias: { GBPUSD: parSmt(1.27, 0.005, 0.006, ultimaVela) } }).length, 0);
  // Depois das 18:00 UTC não há sessão para um day trade.
  const tarde = Date.UTC(2026, 8, 17, 19);
  assert.equal(
    planSmtTeste(parSmt(1.1, 0.005, 0.006, tarde), ctx, {
      referencias: { GBPUSD: parSmt(1.27, 0.006, 0.005, tarde) },
      velas4h: tendencia4h(tarde + H, -1),
    }).length,
    0,
  );
});

test('SMT: sai no fecho das 20:00 UTC se não chegar ao alvo nem ao stop', () => {
  const inicio = Date.UTC(2026, 8, 17, 0);
  const velas = [];
  for (let i = 0; i < 24; i++) velas.push(vela(inicio + i * H, 100, 100.4, 99.6, 99.8));
  const plano = { estrategia: 'smt-teste', direccao: 'bearish', entrada: 99.8, stop: 101, alvos: [{ preco: 97.4 }], geradoEm: inicio + 14 * H };
  const a = acompanharOperacao(plano, velas);
  assert.equal(a.estado, 'fechada');
  const saida = a.eventos.at(-1);
  assert.equal(saida.tipo, 'saida-tempo');
  assert.equal(saida.em, inicio + 19 * H, 'a vela das 19:00 fecha às 20:00');
  assert.match(fraseEvento(saida, 2, 'smt-teste').titulo, /fim do day trade/);
});

test('VWAP forex: +1R fecha metade e protege, como nos índices', () => {
  const t0 = Date.UTC(2026, 8, 17, 8);
  const velas = [vela(t0, 1.1, 1.1, 1.1, 1.1)];
  velas.push(vela(t0 + H, 1.1, 1.1005, 1.0985, 1.0988)); // venda: +1R a 1.0990, sem chegar a +2R
  velas.push(vela(t0 + 2 * H, 1.0985, 1.1001, 1.0985, 1.1)); // volta à entrada
  const plano = { estrategia: 'vwap-forex-teste', direccao: 'bearish', entrada: 1.1, stop: 1.101, alvos: [{ preco: 1.099 }, { preco: 1.098 }], geradoEm: t0 };
  const a = acompanharOperacao(plano, velas);
  assert.deepEqual(a.eventos.map((e) => e.tipo), ['alvo1', 'stop-na-entrada']);
  assert.equal(a.resultadoR, 0.5);
});
