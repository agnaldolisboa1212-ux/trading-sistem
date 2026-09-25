/**
 * A cache das análises até ao fecho da vela.
 *
 * Existe para aliviar a Deriv (o painel repetia as mesmas análises a cada
 * minuto e o RateLimit atrasava o motor). O risco de uma cache é mostrar um
 * resultado velho; estes testes fixam as duas regras que o impedem.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const fonte = readFileSync(new URL('../lib/cache-vela.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(fonte, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { velaFechadaAgora, lerCacheVela, guardarCacheVela } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
);

test('a vela fechada pelo relógio é a anterior à que está a formar-se', () => {
  const t = Date.UTC(2026, 8, 25, 10, 23, 40);
  assert.equal(velaFechadaAgora('15m', t), Date.UTC(2026, 8, 25, 10, 0));
  assert.equal(velaFechadaAgora('1h', t), Date.UTC(2026, 8, 25, 9, 0));
  assert.equal(velaFechadaAgora('xx', t), null);
});

test('guarda e devolve o resultado da última vela fechada', () => {
  const vela = velaFechadaAgora('15m');
  assert.equal(guardarCacheVela('teste|a', '15m', vela, { ok: 1 }), true);
  assert.deepEqual(lerCacheVela('teste|a', '15m'), { ok: 1 });
});

test('NÃO guarda um resultado calculado sem a vela que acabou de fechar', () => {
  // A Deriv ainda não publicou a vela nova: o cálculo acabou na anterior.
  const atrasada = velaFechadaAgora('15m') - 900_000;
  assert.equal(guardarCacheVela('teste|b', '15m', atrasada, { velho: true }), false);
  assert.equal(lerCacheVela('teste|b', '15m'), null);
});

test('quando fecha a vela seguinte, o resultado antigo deixa de ser servido', () => {
  const real = Date.now;
  try {
    const t0 = Date.UTC(2026, 8, 25, 10, 20);
    Date.now = () => t0;
    assert.equal(guardarCacheVela('teste|c', '15m', velaFechadaAgora('15m'), { v: 1 }), true);
    Date.now = () => t0 + 9 * 60_000; // 10:29 — mesma vela
    assert.deepEqual(lerCacheVela('teste|c', '15m'), { v: 1 });
    Date.now = () => t0 + 11 * 60_000; // 10:31 — já fechou a vela das 10:15
    assert.equal(lerCacheVela('teste|c', '15m'), null);
  } finally {
    Date.now = real;
  }
});
