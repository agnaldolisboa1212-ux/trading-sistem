/**
 * Testes das estrategias institucionais.
 *
 * Escritos com velas SINTETICAS construidas para conter o padrao que se quer
 * testar. Testar contra dados reais tornaria o teste dependente do mercado do
 * dia — passaria numa semana e falharia na seguinte sem que nada no codigo
 * tivesse mudado.
 *
 * Cobrem sobretudo as GUARDAS: e ai que uma estrategia se torna perigosa. Um
 * detetor que devolve zonas a mais so produz ruido; um planeador que aceita
 * volume falso ou risco nulo produz ordens.
 *
 * Corre com:  npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assessConfluence,
  closeToCloseVolatility,
  detectRoundNumber,
  detectSupplyDemandZones,
  detectSupportResistanceLevels,
  garmanKlassVolatility,
  parkinsonVolatility,
  planSupplyDemandTrades,
  planSupportResistanceTrades,
  rogersSatchellVolatility,
  roundIncrementsFor,
  runInstitutionalStrategies,
} from '../dist/index.js';

const DIA = 86_400_000;
const T0 = Date.parse('2026-01-01T00:00:00Z');

/** Constroi velas a partir de tuplos [open, high, low, close, volume]. */
function velas(linhas) {
  return linhas.map(([o, h, l, c, v = 1000], i) => ({
    time: T0 + i * DIA,
    open: o,
    high: h,
    low: l,
    close: c,
    volume: v,
  }));
}

/** Serie plana com ruido deterministico — base para inserir padroes. */
function serieBase(n, preco = 100, amplitude = 0.6) {
  const out = [];
  for (let i = 0; i < n; i++) {
    // Deterministico de proposito: o mesmo teste tem de dar sempre o mesmo.
    const desvio = Math.sin(i / 3) * amplitude;
    const o = preco + desvio;
    const c = preco + Math.sin((i + 1) / 3) * amplitude;
    out.push([o, Math.max(o, c) + 0.3, Math.min(o, c) - 0.3, c, 1000]);
  }
  return out;
}

function serie(candles, extra = {}) {
  return {
    symbol: 'TESTE',
    timeframe: '1d',
    source: 'test',
    fidelity: 'true-ohlc',
    candles,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Volatilidade
// ---------------------------------------------------------------------------

test('os quatro estimadores de volatilidade concordam em ordem de grandeza', () => {
  const c = velas(serieBase(80, 100, 1.2));

  const cc = closeToCloseVolatility(c);
  const pk = parkinsonVolatility(c);
  const gk = garmanKlassVolatility(c);
  const rs = rogersSatchellVolatility(c);

  for (const [nome, v] of [['close-to-close', cc], ['parkinson', pk], ['garman-klass', gk], ['rogers-satchell', rs]]) {
    assert.ok(Number.isFinite(v), `${nome} devolveu ${v}`);
    assert.ok(v >= 0, `${nome} devolveu volatilidade negativa`);
  }

  // Estimadores de intervalo usam mais informacao que o fecho-a-fecho, mas
  // medem a mesma coisa: nao podem divergir por ordens de grandeza.
  const finitos = [cc, pk, gk, rs].filter((v) => v > 0);
  if (finitos.length > 1) {
    const maior = Math.max(...finitos);
    const menor = Math.min(...finitos);
    assert.ok(maior / menor < 50, `estimadores divergem demasiado: ${menor} vs ${maior}`);
  }
});

test('volatilidade de uma serie sem movimento e zero, nao NaN', () => {
  const c = velas(Array.from({ length: 40 }, () => [100, 100, 100, 100, 0]));
  for (const f of [closeToCloseVolatility, parkinsonVolatility, garmanKlassVolatility]) {
    const v = f(c);
    assert.ok(Number.isFinite(v), `${f.name} devolveu ${v} numa serie plana`);
    assert.ok(Math.abs(v) < 1e-6, `${f.name} devolveu ${v}, esperado ~0`);
  }
});

test('estimadores nao rebentam com amostra curta demais', () => {
  const c = velas([[100, 101, 99, 100]]);
  for (const f of [closeToCloseVolatility, parkinsonVolatility, garmanKlassVolatility, rogersSatchellVolatility]) {
    const v = f(c);
    assert.ok(Number.isFinite(v), `${f.name} devolveu ${v} com uma vela`);
  }
});

// ---------------------------------------------------------------------------
// Numeros redondos
// ---------------------------------------------------------------------------

test('os incrementos redondos acompanham a escala do preco', () => {
  const forex = roundIncrementsFor(1.1);
  const indice = roundIncrementsFor(20000);

  assert.ok(forex.every((i) => i > 0), 'incrementos tem de ser positivos');
  assert.ok(indice.every((i) => i > 0));
  // 1.1000 e 20000 sao ambos "redondos", mas a que distancia isso acontece
  // depende da escala — um passo de 0.01 num indice de 20 mil e ruido.
  assert.ok(
    Math.max(...indice) > Math.max(...forex),
    'um indice de 20 mil precisa de incrementos maiores que um par de forex',
  );
});

test('detectRoundNumber encontra o nivel redondo dentro da tolerancia', () => {
  // 1.10000 e redondo; 1.10004 esta a 0.00004 dele.
  const achado = detectRoundNumber(1.10004, 0.0002);
  assert.equal(typeof achado, 'number');
  assert.ok(Math.abs(achado - 1.1) < 1e-6, `esperado 1.1, veio ${achado}`);
});

test('detectRoundNumber devolve null quando nao ha nivel perto', () => {
  assert.equal(detectRoundNumber(1.10437, 0.00001), null);
});

// ---------------------------------------------------------------------------
// Zonas de oferta e procura
// ---------------------------------------------------------------------------

test('detecta uma zona de procura num drop-base-rally', () => {
  const linhas = [
    ...serieBase(30, 100),
    // queda
    [100, 100.2, 94, 94.5], [94.5, 94.8, 90, 90.4], [90.4, 90.6, 88, 88.3],
    // base apertada — e isto que forma a zona
    [88.3, 88.9, 87.8, 88.1], [88.1, 88.7, 87.9, 88.4], [88.4, 88.8, 88.0, 88.2],
    // partida em forca
    [88.2, 93, 88.1, 92.8], [92.8, 98, 92.6, 97.6], [97.6, 103, 97.4, 102.7],
    ...serieBase(20, 103),
  ];

  const zonas = detectSupplyDemandZones(velas(linhas));
  assert.ok(zonas.length > 0, 'devia ter encontrado pelo menos uma zona');

  const procura = zonas.filter((z) => z.direction === 'bullish');
  assert.ok(procura.length > 0, 'a queda-base-subida devia dar uma zona de procura');

  const z = procura[0];
  assert.ok(z.zoneLow < z.zoneHigh, 'a zona tem de ter amplitude');
  assert.ok(z.strength >= 0 && z.strength <= 1, `forca fora de 0..1: ${z.strength}`);
  // O bordo proximal e o que o preco encontra primeiro ao regressar.
  assert.ok(
    z.proximal >= z.zoneLow && z.proximal <= z.zoneHigh,
    'o proximal tem de estar dentro da zona',
  );
});

test('serie sem impulso nao inventa zonas', () => {
  // Ruido de amplitude minima: nao ha partida nenhuma a assinalar.
  const zonas = detectSupplyDemandZones(velas(serieBase(120, 100, 0.05)));
  assert.equal(zonas.length, 0, `inventou ${zonas.length} zonas numa serie plana`);
});

test('o planeador exige que o preco esteja a tocar a zona', () => {
  const linhas = [
    ...serieBase(30, 100),
    [100, 100.2, 94, 94.5], [94.5, 94.8, 90, 90.4], [90.4, 90.6, 88, 88.3],
    [88.3, 88.9, 87.8, 88.1], [88.1, 88.7, 87.9, 88.4], [88.4, 88.8, 88.0, 88.2],
    [88.2, 93, 88.1, 92.8], [92.8, 98, 92.6, 97.6], [97.6, 103, 97.4, 102.7],
    // fica LONGE da zona: nao deve haver plano
    ...serieBase(20, 115),
  ];

  const ctx = { symbol: 'TESTE', timeframe: '1d', minRMultiple: 2 };
  const planos = planSupplyDemandTrades(velas(linhas), ctx);
  assert.equal(planos.length, 0, 'nao devia planear com o preco longe da zona');
});

// ---------------------------------------------------------------------------
// Suporte e resistencia
// ---------------------------------------------------------------------------

test('deteta um nivel tocado varias vezes', () => {
  const linhas = [];
  /*
   * Seis ciclos, nao tres. Com 30 velas o detetor devolve zero — precisa de
   * historia suficiente para distinguir um nivel de uma coincidencia, e essa
   * exigencia e o que o impede de marcar como suporte qualquer minima isolada.
   */
  for (let ciclo = 0; ciclo < 6; ciclo++) {
    linhas.push([100, 101, 99.9, 100.5]);
    linhas.push([100.5, 101, 95.0, 95.6]);
    linhas.push([95.6, 99, 95.02, 98.5]);
    linhas.push([98.5, 102, 98, 101.5]);
    linhas.push(...serieBase(6, 101));
  }

  const niveis = detectSupportResistanceLevels(velas(linhas));
  assert.ok(niveis.length > 0, 'devia ter encontrado pelo menos um nivel');

  const forte = niveis.find((n) => n.touches >= 2);
  assert.ok(forte, 'devia haver um nivel com dois ou mais toques');
  assert.ok(forte.zoneLow < forte.zoneHigh, 'o nivel e uma zona, nao uma linha');
  assert.ok(
    forte.price >= forte.zoneLow && forte.price <= forte.zoneHigh,
    'o preco do nivel tem de cair dentro da sua zona',
  );
});

test('planos de suporte/resistencia trazem stop do lado certo', () => {
  const linhas = [];
  for (let ciclo = 0; ciclo < 8; ciclo++) {
    linhas.push([100, 101, 99.9, 100.5], [100.5, 101, 95.0, 95.6], [95.6, 99, 95.02, 98.5], [98.5, 102, 98, 101.5]);
    linhas.push(...serieBase(5, 101));
  }
  // Termina EM CIMA do suporte, para o planeador poder disparar.
  linhas.push([96, 96.5, 95.05, 95.4]);

  const ctx = { symbol: 'TESTE', timeframe: '1d', minRMultiple: 1 };
  const planos = planSupportResistanceTrades(velas(linhas), ctx);

  for (const p of planos) {
    if (p.direction === 'bullish') {
      assert.ok(p.stopLoss < p.entry, 'numa compra o stop fica ABAIXO da entrada');
    } else {
      assert.ok(p.stopLoss > p.entry, 'numa venda o stop fica ACIMA da entrada');
    }
    assert.ok(p.conviction >= 0 && p.conviction <= 1, `conviccao fora de 0..1: ${p.conviction}`);
  }
});

// ---------------------------------------------------------------------------
// Orquestrador
// ---------------------------------------------------------------------------

test('recusa series com OHLC sintetico em vez de as analisar', () => {
  const c = velas(serieBase(200, 100, 1.5));
  const r = runInstitutionalStrategies(serie(c, { fidelity: 'synthetic' }));

  assert.equal(r.signals.length, 0, 'nao pode produzir sinais sobre OHLC sintetico');
  assert.ok(r.dataWarnings.length > 0, 'tem de dizer PORQUE nao analisou');
  assert.match(r.dataWarnings[0], /synthetic/i);
});

test('recusa OHLC degenerado (abertura igual ao fecho)', () => {
  // O bug real dos pares `=X` do Yahoo: corpo praticamente nulo.
  const c = velas(Array.from({ length: 200 }, (_, i) => {
    const p = 100 + Math.sin(i / 5);
    return [p, p + 0.5, p - 0.5, p, 1000];
  }));

  const r = runInstitutionalStrategies(serie(c));
  assert.equal(r.signals.length, 0);
  assert.ok(r.dataWarnings.length > 0, 'tem de avisar sobre a qualidade do OHLC');
});

test('`only` limita as estrategias corridas', () => {
  const c = velas(serieBase(200, 100, 1.5));
  const r = runInstitutionalStrategies(serie(c), { only: ['supply-demand'] });

  assert.equal(r.byStrategy['support-resistance'].length, 0);
  assert.equal(r.byStrategy['vwap-bands'].length, 0);
  assert.equal(r.byStrategy['volume-profile'].length, 0);
});

test('os sinais vem ordenados por conviccao decrescente', () => {
  const c = velas(serieBase(250, 100, 2));
  const r = runInstitutionalStrategies(serie(c));

  for (let i = 1; i < r.signals.length; i++) {
    assert.ok(
      r.signals[i - 1].conviction >= r.signals[i].conviction,
      'a lista tem de estar ordenada da maior conviccao para a menor',
    );
  }
});

// ---------------------------------------------------------------------------
// Confluencia
// ---------------------------------------------------------------------------

test('confluencia sem sinais devolve "none" e nao rebenta', () => {
  const c = assessConfluence([]);
  assert.equal(c.direction, 'none');
  assert.equal(c.agreeingStrategies, 0);
  assert.ok(typeof c.detail === 'string' && c.detail.length > 0);
});

test('maioria NAO decide quando ha estrategias dos dois lados', () => {
  const sinais = [
    { strategy: 'supply-demand', direction: 'bullish', conviction: 0.8 },
    { strategy: 'support-resistance', direction: 'bullish', conviction: 0.6 },
    { strategy: 'vwap-bands', direction: 'bearish', conviction: 0.5 },
  ];

  const c = assessConfluence(sinais);

  /*
   * Duas contra uma NAO da "alta": da 'conflicted'.
   *
   * E a decisao certa e vale a pena fixa-la num teste para ninguem a
   * "corrigir" mais tarde. As quatro estrategias sao transformacoes dos MESMOS
   * dados OHLCV — quando discordam, o que isso diz e que a leitura e ambigua,
   * nao que a maioria tem razao. Votar por maioria entre medidas correlacionadas
   * fabrica convicao onde ha ruido.
   */
  assert.equal(c.direction, 'conflicted');
  assert.deepEqual(c.bullish.sort(), ['supply-demand', 'support-resistance'].sort());
  assert.deepEqual(c.bearish, ['vwap-bands']);
  // Sem direcao escolhida nao ha com o que concordar.
  assert.equal(c.agreeingStrategies, 0);
  assert.match(c.detail, /conflito/i);
});

test('unanimidade num so lado da direcao e conta as estrategias', () => {
  const sinais = [
    { strategy: 'supply-demand', direction: 'bullish', conviction: 0.7 },
    { strategy: 'vwap-bands', direction: 'bullish', conviction: 0.4 },
  ];

  const c = assessConfluence(sinais);
  assert.equal(c.direction, 'bullish');
  assert.equal(c.agreeingStrategies, 2);
  assert.equal(c.opposingStrategies, 0);
  // O maximo, nunca a soma: somar convicoes correlacionadas sobrestima.
  assert.ok(Math.abs(c.maxConviction - 0.7) < 1e-9);
  assert.ok(c.caveats.length > 0, 'a confluencia tem de vir com ressalvas');
});
