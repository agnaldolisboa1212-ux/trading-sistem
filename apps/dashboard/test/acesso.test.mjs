/**
 * Quem pode abrir o quê.
 *
 * É esta regra que fecha a app a quem não entrou — antes, qualquer visitante
 * abria tudo como o mesmo "A" anónimo.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const fonte = readFileSync(new URL('../lib/acesso.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(fonte, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { decidirAcesso, destinoSeguro } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
);

const anonimo = { autenticado: false, falta2fa: false, onboardingFeito: false };
const pronto = { autenticado: true, falta2fa: false, onboardingFeito: true };

test('sem sessão: o início manda para entrar', () => {
  assert.deepEqual(decidirAcesso({ ...anonimo, caminho: '/' }), {
    tipo: 'redirecionar',
    para: '/entrar',
  });
});

test('sem sessão: uma página lembra onde ia', () => {
  assert.deepEqual(decidirAcesso({ ...anonimo, caminho: '/grafico' }), {
    tipo: 'redirecionar',
    para: '/entrar?voltar=%2Fgrafico',
  });
});

test('sem sessão: as rotas de API respondem 401, não redirecionam', () => {
  const d = decidirAcesso({ ...anonimo, caminho: '/api/deriv/estado' });
  assert.equal(d.tipo, 'recusar');
  assert.equal(d.estado, 401);
  assert.equal(d.codigo, 'SemSessao');
});

test('sem sessão: entrar, criar conta e recuperar abrem', () => {
  for (const caminho of ['/entrar', '/registar', '/recuperar']) {
    assert.equal(decidirAcesso({ ...anonimo, caminho }).tipo, 'seguir', caminho);
  }
});

test('sem sessão: verificar 2FA e definir nova palavra-passe exigem sessão', () => {
  assert.equal(decidirAcesso({ ...anonimo, caminho: '/entrar/verificar' }).tipo, 'redirecionar');
  assert.equal(decidirAcesso({ ...anonimo, caminho: '/recuperar/nova' }).tipo, 'redirecionar');
});

test('sem sessão: ficheiros da app, push do motor, saúde e links de email passam', () => {
  for (const caminho of [
    '/sw.js',
    '/manifest.webmanifest',
    '/icones/icone-192.png',
    '/_next/static/chunks/a.js',
    '/api/push/enviar',
    '/api/saude',
    '/auth/confirmar',
    '/api/deriv/oauth/sair',
  ]) {
    assert.equal(decidirAcesso({ ...anonimo, caminho }).tipo, 'seguir', caminho);
  }
});

test('sem sessão: um prefixo parecido não abre nada', () => {
  assert.equal(decidirAcesso({ ...anonimo, caminho: '/entrarX' }).tipo, 'redirecionar');
  assert.equal(decidirAcesso({ ...anonimo, caminho: '/api/saude-privada' }).tipo, 'recusar');
});

test('2FA em falta: só a página do código', () => {
  const f = { ...pronto, falta2fa: true };
  assert.deepEqual(decidirAcesso({ ...f, caminho: '/' }), {
    tipo: 'redirecionar',
    para: '/entrar/verificar',
  });
  assert.equal(decidirAcesso({ ...f, caminho: '/entrar/verificar' }).tipo, 'seguir');
  assert.equal(decidirAcesso({ ...f, caminho: '/api/deriv/ordem' }).codigo, 'Falta2FA');
});

test('sem onboarding: vai para o onboarding, mas a API responde', () => {
  const f = { ...pronto, onboardingFeito: false };
  assert.deepEqual(decidirAcesso({ ...f, caminho: '/' }), { tipo: 'redirecionar', para: '/onboarding' });
  assert.equal(decidirAcesso({ ...f, caminho: '/onboarding' }).tipo, 'seguir');
  assert.equal(decidirAcesso({ ...f, caminho: '/api/deriv/estado' }).tipo, 'seguir');
});

test('com sessão: entrar e criar conta mandam para o início', () => {
  assert.deepEqual(decidirAcesso({ ...pronto, caminho: '/entrar' }), { tipo: 'redirecionar', para: '/' });
  assert.deepEqual(decidirAcesso({ ...pronto, caminho: '/registar' }), { tipo: 'redirecionar', para: '/' });
});

test('recuperação: com a sessão do email, define a palavra-passe antes do onboarding', () => {
  const f = { ...pronto, onboardingFeito: false };
  assert.equal(decidirAcesso({ ...f, caminho: '/recuperar/nova' }).tipo, 'seguir');
});

test('com tudo feito: as páginas abrem', () => {
  for (const caminho of ['/', '/grafico', '/definicoes', '/api/deriv/estado']) {
    assert.equal(decidirAcesso({ ...pronto, caminho }).tipo, 'seguir', caminho);
  }
});

test('destino depois de entrar: só caminhos internos', () => {
  assert.equal(destinoSeguro('/grafico?s=EURUSD'), '/grafico?s=EURUSD');
  assert.equal(destinoSeguro('https://phishing.example'), '/');
  assert.equal(destinoSeguro('//phishing.example'), '/');
  assert.equal(destinoSeguro('/\\phishing.example'), '/');
  assert.equal(destinoSeguro(null), '/');
});
