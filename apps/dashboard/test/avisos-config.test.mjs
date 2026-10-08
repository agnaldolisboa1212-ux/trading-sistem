/**
 * Configuração das notificações push (migração 0013): o que vem mal guardado
 * cai na omissão, e cada tipo de aviso liga-se à sua chave.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const fonte = readFileSync(new URL('../lib/avisos-config.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(fonte, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { lerConfigAvisos, tipoLigado, CONFIG_AVISOS_OMISSAO } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
);

test('avisos: sem configuração guardada vale a omissão (o mesmo de antes da 0013)', () => {
  assert.deepEqual(lerConfigAvisos({}), CONFIG_AVISOS_OMISSAO);
  assert.deepEqual(lerConfigAvisos(null), CONFIG_AVISOS_OMISSAO);
  assert.equal(CONFIG_AVISOS_OMISSAO.ambito, 'portfolio');
  assert.equal(CONFIG_AVISOS_OMISSAO.entradas && CONFIG_AVISOS_OMISSAO.alertas && CONFIG_AVISOS_OMISSAO.operacoes, true);
});

test('avisos: valores inválidos não estragam o resto', () => {
  const c = lerConfigAvisos({ ambito: 'tudo', fixo: true, alertas: 'sim', operacoes: false });
  assert.equal(c.ambito, 'tudo');
  assert.equal(c.fixo, true);
  assert.equal(c.alertas, true, 'string não é booleano: fica a omissão');
  assert.equal(c.operacoes, false);
  assert.equal(lerConfigAvisos({ ambito: 'outra' }).ambito, 'portfolio');
});

test('avisos: cada tipo liga-se à sua chave; sem tipo passa sempre', () => {
  const c = lerConfigAvisos({ entradas: false, alertas: true, operacoes: false });
  assert.equal(tipoLigado(c, 'entrada'), false);
  assert.equal(tipoLigado(c, 'alerta'), true);
  assert.equal(tipoLigado(c, 'operacao'), false);
  assert.equal(tipoLigado(c, undefined), true);
});
