/**
 * cTrader: conversões de volume, validação de ordens, ordem colada de um sinal,
 * e a correspondência de símbolos. Um erro aqui manda uma ordem com o volume ou
 * o stop errados — por isso é a parte testada antes de qualquer rede.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const fonte = readFileSync(new URL('../lib/ctrader/protocolo.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(fonte, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const P = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

const EURUSD = { lotSize: 10_000_000, minVolume: 100_000, maxVolume: 1_000_000_000, stepVolume: 100_000 };

test('volume: 1 lote de EURUSD são 10 000 000 centésimas (100 000 unidades)', () => {
  assert.deepEqual(P.volumeDeLotes(1, EURUSD), { volume: 10_000_000, lotes: 1 });
});

test('volume: arredonda ao passo e respeita o mínimo', () => {
  assert.deepEqual(P.volumeDeLotes(0.013, EURUSD), { volume: 100_000, lotes: 0.01 });
  assert.deepEqual(P.volumeDeLotes(0.0001, EURUSD), { volume: 100_000, lotes: 0.01 });
  assert.equal(P.volumeDeLotes(0.256, EURUSD).lotes, 0.26);
});

test('volume: respeita o máximo', () => {
  assert.equal(P.volumeDeLotes(1000, EURUSD).volume, 1_000_000_000);
});

test('distância relativa em 1/100000 de preço', () => {
  assert.equal(P.distanciaRelativa(1.1, 1.095), 500);
  assert.equal(P.distanciaRelativa(4300, 4290.5), 950_000);
});

test('dinheiro com moneyDigits', () => {
  assert.equal(P.dinheiro(123456, 2), 1234.56);
  assert.equal(P.dinheiro(undefined, 2), 0);
});

test('validar: compra a mercado com SL abaixo e TP acima', () => {
  assert.equal(
    P.validarOrdem({ lado: 'compra', tipo: 'mercado', lotes: 0.1, precoActual: 100, stopLoss: 98, takeProfit: 105 }),
    null,
  );
});

test('validar: stops do lado errado', () => {
  assert.match(
    P.validarOrdem({ lado: 'compra', tipo: 'mercado', lotes: 0.1, precoActual: 100, stopLoss: 101 }),
    /abaixo/,
  );
  assert.match(
    P.validarOrdem({ lado: 'venda', tipo: 'mercado', lotes: 0.1, precoActual: 100, takeProfit: 101 }),
    /abaixo/,
  );
});

test('validar: limite e stop em relação ao preço actual', () => {
  assert.equal(P.validarOrdem({ lado: 'compra', tipo: 'limite', lotes: 1, precoActual: 100, preco: 99 }), null);
  assert.match(P.validarOrdem({ lado: 'compra', tipo: 'limite', lotes: 1, precoActual: 100, preco: 101 }), /abaixo/);
  assert.equal(P.validarOrdem({ lado: 'venda', tipo: 'stop', lotes: 1, precoActual: 100, preco: 99 }), null);
  assert.match(P.validarOrdem({ lado: 'venda', tipo: 'stop', lotes: 1, precoActual: 100, preco: 101 }), /abaixo/);
});

test('validar: pendente mede SL/TP a partir do preço da ordem', () => {
  // compra limite a 99 com stop a 99,5 está errado, mesmo abaixo do actual (100)
  assert.match(
    P.validarOrdem({ lado: 'compra', tipo: 'limite', lotes: 1, precoActual: 100, preco: 99, stopLoss: 99.5 }),
    /abaixo/,
  );
});

test('validar: sem volume', () => {
  assert.match(P.validarOrdem({ lado: 'compra', tipo: 'mercado', lotes: 0, precoActual: 100 }), /volume/);
});

const sinalCompra = { direccao: 'bullish', entrada: 100, stop: 98, alvos: [{ preco: 104 }, { preco: 108 }] };

test('colar sinal: preço na entrada → mercado', () => {
  const o = P.ordemDoSinal({ ...sinalCompra, precoActual: 100.2 });
  assert.deepEqual(o, { lado: 'compra', tipo: 'mercado', preco: null, stopLoss: 98, takeProfit: 104 });
});

test('colar sinal: compra com o preço acima da entrada → limite na entrada', () => {
  const o = P.ordemDoSinal({ ...sinalCompra, precoActual: 101.5 });
  assert.equal(o.tipo, 'limite');
  assert.equal(o.preco, 100);
});

test('colar sinal: compra com o preço abaixo da entrada → stop na entrada', () => {
  assert.equal(P.ordemDoSinal({ ...sinalCompra, precoActual: 99 }).tipo, 'stop');
});

test('colar sinal: venda espelha, e escolhe o alvo pedido', () => {
  const venda = { direccao: 'bearish', entrada: 100, stop: 102, alvos: [{ preco: 96 }, { preco: 92 }] };
  assert.equal(P.ordemDoSinal({ ...venda, precoActual: 99 }).tipo, 'limite');
  assert.equal(P.ordemDoSinal({ ...venda, precoActual: 101 }).tipo, 'stop');
  assert.equal(P.ordemDoSinal({ ...venda, precoActual: 100, alvo: 1 }).takeProfit, 92);
});

const simbolos = [
  { symbolName: 'EURUSD', description: 'Euro vs US Dollar', enabled: true },
  { symbolName: 'XAUUSD', description: 'Gold vs US Dollar', enabled: true },
  { symbolName: 'US 100', description: 'US Tech 100 Index', enabled: true },
  { symbolName: 'Volatility 75 Index', description: 'Volatility 75 Index', enabled: true },
  { symbolName: 'GBPUSD', description: 'desligado', enabled: false },
];

test('símbolos: nome igual, sinónimo, nome do catálogo', () => {
  assert.equal(P.acharSimboloCtrader('EURUSD', 'Euro / Dolar', simbolos).symbolName, 'EURUSD');
  assert.equal(P.acharSimboloCtrader('US100', 'Nasdaq 100', simbolos).symbolName, 'US 100');
  assert.equal(P.acharSimboloCtrader('V75', 'Volatility 75 Index', simbolos).symbolName, 'Volatility 75 Index');
});

test('símbolos: desligado ou inexistente não conta', () => {
  assert.equal(P.acharSimboloCtrader('GBPUSD', 'Libra / Dolar', simbolos), null);
  assert.equal(P.acharSimboloCtrader('JD100', 'Jump 100 Index', simbolos), null);
});
