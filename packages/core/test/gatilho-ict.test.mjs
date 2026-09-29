/**
 * ICT ALGO: o setup fixo de 1H e o tiro certeiro em 15M.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estadoDoSetup } from '../dist/index.js';

const M15 = 900_000;
const T0 = Date.UTC(2026, 8, 28, 0, 0);

/** Velas de 15M a partir de uma lista de fechos (abertura = fecho anterior). */
function velasDe(fechos, amp = 0.02) {
  let ant = fechos[0];
  return fechos.map((c, k) => {
    const o = ant;
    ant = c;
    return { time: T0 + k * M15, open: o, high: Math.max(o, c) + amp, low: Math.min(o, c) - amp, close: c, volume: 0 };
  });
}

/*
 * Ondas de alta (5 velas a subir, 3 a descer): topos e fundos a subir, a
 * estrutura de 15M é de alta. A última perna sobe até à zona de venda do 1H
 * (150,85–150,95) e a seguinte cai e fecha abaixo do último fundo: CHoCH de
 * baixa em 15M.
 */
const fechos = [];
let p = 148.0;
for (let onda = 0; onda < 12; onda++) {
  for (let k = 0; k < 5; k++) fechos.push(Number((p += 0.1).toFixed(3)));
  for (let k = 0; k < 3; k++) fechos.push(Number((p -= 0.1).toFixed(3)));
}
for (let k = 0; k < 5; k++) fechos.push(Number((p += 0.1).toFixed(3))); // até à zona
for (let k = 0; k < 6; k++) fechos.push(Number((p -= 0.1).toFixed(3))); // parte o último fundo
const velas = velasDe(fechos);
const setup = {
  simbolo: 'USDJPY',
  direccao: 'bearish',
  modelo: 'teste',
  zonaBaixa: 150.85,
  zonaAlta: 150.95,
  stop: 151.1,
  alvo: 149.0,
  rotuloAlvo: 'mínimo',
  formadoEm: T0 + 88 * M15,
  expiraEm: T0 + 88 * M15 + 24 * 3_600_000,
  chave: 's',
  passos: [],
};
const fim = velas[velas.length - 1].time + M15;

test('tiro certeiro: zona tocada, CHoCH de 15M a favor → dispara uma vez, com stop no extremo e alvo do 1H', () => {
  const e = estadoDoSetup(setup, velas, fim);
  assert.equal(e.estado, 'disparado', JSON.stringify(e));
  assert.ok(e.tiro.time > e.tocadoEm, 'o disparo é depois do toque');
  assert.equal(e.tiro.alvo, setup.alvo);
  assert.ok(e.tiro.stop <= setup.stop, 'o stop do tiro é mais curto do que o do 1H');
  assert.ok(e.tiro.stop > e.tiro.entrada, 'venda: stop acima da entrada');
  assert.ok(e.tiro.rr >= 2);
  // Mais velas depois não mudam o disparo: é sempre o primeiro.
  const depois = velasDe([...fechos, ...Array(10).fill(fechos[fechos.length - 1])]);
  const e2 = estadoDoSetup(setup, depois, depois[depois.length - 1].time + M15);
  assert.equal(e2.estado, 'disparado');
  assert.equal(e2.tiro.time, e.tiro.time);
});

test('tiro certeiro: o TESTE DO CORTE — antes do disparo, o estado não conhece o futuro', () => {
  const e = estadoDoSetup(setup, velas, fim);
  const antes = e.tiro.time; // abertura da vela do disparo: ainda não fechou
  const cortada = estadoDoSetup(setup, velas, antes);
  assert.notEqual(cortada.estado, 'disparado');
  // O mesmo resultado com as velas futuras removidas.
  const soPassado = estadoDoSetup(setup, velas.filter((c) => c.time + M15 <= antes), antes);
  assert.deepEqual(cortada, soPassado);
});

test('setup fixo: stop do 1H tocado antes de confirmar → invalidado; sem velas novas → à espera; tempo esgotado → expirado', () => {
  const stopPerto = { ...setup, stop: 150.91 };
  assert.equal(estadoDoSetup(stopPerto, velas, fim).estado, 'invalidado');
  assert.equal(estadoDoSetup(setup, velas, setup.formadoEm).estado, 'a-espera-da-zona');
  const curto = { ...setup, expiraEm: setup.formadoEm + 2 * M15 };
  assert.equal(estadoDoSetup(curto, velas, fim).estado, 'expirado');
  // Alvo atingido sem passar pela zona.
  const zonaLonge = { ...setup, zonaBaixa: 152, zonaAlta: 152.1, stop: 152.3, alvo: 149.9 };
  const e = estadoDoSetup(zonaLonge, velas, fim);
  assert.ok(e.estado === 'a-espera-da-zona' || e.estado === 'invalidado');
});
