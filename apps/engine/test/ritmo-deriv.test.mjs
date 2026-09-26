/**
 * O travão dos pedidos de velas à Deriv (packages/data/src/providers/ritmo.ts).
 *
 * A Deriv bloqueia uma ligação ~1 minuto quando recebe uma rajada de
 * `ticks_history` (medido: 220 em 6 s). O travão tem de: nunca ter mais do que
 * N pedidos em voo, deixar sair uma rajada e depois espaçar os envios, parar
 * depois de um RateLimit e desistir — com "RateLimit" na mensagem, para quem
 * chama servir a cópia guardada — se a vez não chegar a tempo.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RitmoPedidos } from '../../../packages/data/dist/providers/ritmo.js';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

test('ritmo: nunca mais pedidos em voo do que o máximo; o seguinte entra quando um termina', async () => {
  const r = new RitmoPedidos({ maxEmVoo: 2, rajada: 100, porSegundo: 100, pausaMs: 1000, esperaMaximaMs: 2000 });
  const a = await r.vez();
  const b = await r.vez();
  let terceiro = null;
  const p = r.vez().then((l) => (terceiro = l));
  await esperar(30);
  assert.equal(terceiro, null, 'o terceiro não podia entrar com dois em voo');
  a();
  await p;
  assert.ok(terceiro, 'o terceiro entra quando o primeiro termina');
  // Libertar duas vezes não abre dois lugares.
  a();
  let quarto = null;
  const q = r.vez().then((l) => (quarto = l));
  await esperar(30);
  assert.equal(quarto, null);
  b();
  await q;
  terceiro();
  quarto();
});

test('ritmo: a rajada sai de seguida; depois, ao ritmo do balde', async () => {
  const r = new RitmoPedidos({ maxEmVoo: 10, rajada: 3, porSegundo: 25, pausaMs: 1000, esperaMaximaMs: 2000 });
  const t0 = Date.now();
  const tempos = [];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      const l = await r.vez();
      tempos.push(Date.now() - t0);
      l();
    }),
  );
  tempos.sort((x, y) => x - y);
  assert.ok(tempos[2] < 50, `os 3 da rajada saem logo (o 3.º aos ${tempos[2]} ms)`);
  // 25 por segundo: uma ficha a cada 40 ms, 3 fichas em 120 ms. Mede-se o total
  // e não cada intervalo: um temporizador atrasado deixa sair duas fichas juntas.
  assert.ok(tempos[5] >= 100, `os 3 depois da rajada levam ~120 ms (${tempos[5]} ms)`);
});

test('ritmo: depois de um RateLimit a ligação pára, e quem não pode esperar desiste com "RateLimit"', async () => {
  const r = new RitmoPedidos({ maxEmVoo: 4, rajada: 10, porSegundo: 10, pausaMs: 120, esperaMaximaMs: 50 });
  r.bloquear();
  assert.ok(r.pausadaAte() > Date.now());
  await assert.rejects(r.vez(), /RateLimit/);
  // Passada a pausa, volta a haver vez.
  await esperar(130);
  assert.equal(r.pausadaAte(), 0);
  const l = await r.vez();
  l();
});

test('ritmo: com paciência para a pausa, espera por ela em vez de falhar', async () => {
  const r = new RitmoPedidos({ maxEmVoo: 4, rajada: 10, porSegundo: 10, pausaMs: 60, esperaMaximaMs: 500 });
  r.bloquear();
  const t0 = Date.now();
  const l = await r.vez();
  assert.ok(Date.now() - t0 >= 55, `entrou ao fim de ${Date.now() - t0} ms`);
  l();
});
