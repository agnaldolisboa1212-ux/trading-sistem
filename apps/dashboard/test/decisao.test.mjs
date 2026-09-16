/**
 * Quem pode falar com que conta Deriv.
 *
 * O teste mais importante do painel: é esta regra que impede um visitante do
 * site publicado de ver o saldo do dono ou de lhe enviar ordens.
 *
 * `decisao.ts` não tem imports, por isso é transpilado aqui mesmo com o
 * TypeScript do repositório — sem build do Next e sem servidor.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const fonte = readFileSync(new URL('../lib/deriv/decisao.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(fonte, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { decidirCredencial } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
);

const AGORA = 1_800_000_000_000;
const DONO = { id: 'u-dono', email: 'dono@exemplo.com' };
const OUTRO = { id: 'u-outro', email: 'outro@exemplo.com' };
const base = {
  exigirLogin: true,
  utilizador: null,
  oauth: null,
  tokenDono: 'pat_do_dono',
  emailsDono: ['dono@exemplo.com'],
  agora: AGORA,
};

test('produção: visitante sem login NÃO recebe o token do dono', () => {
  const d = decidirCredencial(base);
  assert.equal(d.ok, false);
  assert.equal(d.estado, 401);
  assert.equal(d.codigo, 'SemSessao');
});

test('produção: utilizador com login que não é o dono NÃO recebe o token do dono', () => {
  const d = decidirCredencial({ ...base, utilizador: OUTRO });
  assert.equal(d.ok, false);
  assert.equal(d.codigo, 'DerivNaoLigada');
});

test('produção: o dono recebe o token do servidor', () => {
  const d = decidirCredencial({ ...base, utilizador: DONO });
  assert.equal(d.ok, true);
  assert.equal(d.origem, 'dono');
  assert.equal(d.token, 'pat_do_dono');
});

test('o email do dono compara sem maiúsculas', () => {
  const d = decidirCredencial({ ...base, utilizador: { id: 'x', email: 'Dono@Exemplo.COM' } });
  assert.equal(d.ok, true);
  assert.equal(d.origem, 'dono');
});

test('a ligação OAuth do próprio utilizador ganha ao token do dono', () => {
  const oauth = { t: 'ory_at_utilizador', u: OUTRO.id, e: AGORA + 60_000 };
  const d = decidirCredencial({ ...base, utilizador: OUTRO, oauth });
  assert.equal(d.ok, true);
  assert.equal(d.origem, 'oauth');
  assert.equal(d.token, 'ory_at_utilizador');
  assert.equal(d.expiraEm, AGORA + 60_000);
});

test('um cookie OAuth de OUTRA pessoa no mesmo browser é ignorado', () => {
  const oauth = { t: 'ory_at_de_outro', u: 'u-antigo', e: AGORA + 60_000 };
  const d = decidirCredencial({ ...base, utilizador: OUTRO, oauth });
  assert.equal(d.ok, false);
  assert.equal(d.codigo, 'DerivNaoLigada');
});

test('produção: cookie OAuth sem sessão iniciada não chega (computador partilhado)', () => {
  const oauth = { t: 'ory_at_x', u: OUTRO.id, e: AGORA + 60_000 };
  const d = decidirCredencial({ ...base, oauth });
  assert.equal(d.ok, false);
  assert.equal(d.codigo, 'SemSessao');
});

test('OAuth expirado pede para ligar de novo', () => {
  const oauth = { t: 'ory_at_x', u: OUTRO.id, e: AGORA - 1 };
  const d = decidirCredencial({ ...base, utilizador: OUTRO, oauth });
  assert.equal(d.ok, false);
  assert.equal(d.codigo, 'DerivExpirou');
  assert.equal(d.estado, 409);
});

test('desenvolvimento (login desligado): o token do servidor responde sem login', () => {
  const d = decidirCredencial({ ...base, exigirLogin: false });
  assert.equal(d.ok, true);
  assert.equal(d.origem, 'dono');
});

test('sem token do dono e sem OAuth: pede para ligar a Deriv', () => {
  const d = decidirCredencial({ ...base, exigirLogin: false, tokenDono: null });
  assert.equal(d.ok, false);
  assert.equal(d.codigo, 'DerivNaoLigada');
});

test('lista de donos vazia: ninguém usa o token do servidor em produção', () => {
  const d = decidirCredencial({ ...base, utilizador: DONO, emailsDono: [] });
  assert.equal(d.ok, false);
});
