#!/usr/bin/env node
'use strict';
/**
 * Servidor de produção — `npm start`, e o "Entry file" na Hostinger.
 *
 * Um só processo que ESCUTA na porta da plataforma, e os motores como filho.
 * Plataformas que gerem a aplicação por si esperam que o processo que ELAS
 * arrancam atenda os pedidos; um script que só lança outros processos deixa-as
 * sem ninguém a responder (foi o primeiro 503).
 *
 * ── PORQUE É COMMONJS, SEM `await` NO TOPO ─────────────────────────────────
 *
 * Na Hostinger a aplicação não arranca com `node server.js`. O LiteSpeed
 * carrega-a com o `lsnode.js`, que faz `require()` deste ficheiro. Um módulo ES
 * com `await` no topo não se carrega com `require()`
 * (ERR_REQUIRE_ASYNC_MODULE): o processo morria antes de escutar e o site
 * respondia 503. Por isso este ficheiro é CommonJS — a raiz do repositório não
 * declara `"type": "module"` — e todo o trabalho assíncrono corre em funções.
 *
 * ── AS DUAS ESCUTAS ────────────────────────────────────────────────────────
 *
 * O lsnode substitui `http.Server.prototype.listen`: a PRIMEIRA chamada liga o
 * servidor ao socket do LiteSpeed (a porta pedida é ignorada) e as seguintes são
 * ignoradas em silêncio, sem chamar o callback. Daí:
 *
 *   - a escuta pública é a primeira, feita logo no carregamento. Os pedidos que
 *     chegam enquanto o Next arranca esperam por ele.
 *   - a escuta interna, para o motor, usa o `listen` original, que o lsnode
 *     guarda em `realListen`. Atrás do LiteSpeed o painel não tem porta TCP, e o
 *     motor precisa de uma para pedir o envio de push; recebe-a em
 *     `DASHBOARD_URL`, só em 127.0.0.1.
 *
 * Com `node server.js` (computador, VPS) o lsnode não existe e tudo é o normal.
 */

const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const { join } = require('node:path');

const RAIZ = __dirname;
const PAINEL = join(RAIZ, 'apps', 'dashboard');
const MOTOR = join(RAIZ, 'apps', 'engine', 'dist', 'index.js');
const PORTA = process.env.PORT || '3000';
const NODE_MAIOR = Number(process.versions.node.split('.')[0]);
// O lsnode guarda o `listen` original antes de carregar a aplicação.
const LISTEN_ORIGINAL = http.Server.prototype.realListen || http.Server.prototype.listen;
const ATRAS_DO_LITESPEED = typeof http.Server.prototype.realListen === 'function';

const log = (...partes) => console.log(new Date().toISOString(), '[servidor]', ...partes);

// Tem de estar definido ANTES de o Next ser carregado.
process.env.NODE_ENV ||= 'production';

if (NODE_MAIOR < 22) {
  log(
    `ATENÇÃO: Node ${process.versions.node}. Este sistema precisa do Node 22 — sem ele não existe ` +
      'WebSocket nativo, e a ligação à Deriv e ao Supabase falham. Mude a versão nas definições da aplicação.',
  );
}

if (!existsSync(join(PAINEL, '.next', 'BUILD_ID'))) {
  log('ERRO: o painel não está compilado (falta apps/dashboard/.next). Corra `npm run build` antes do arranque.');
  process.exit(1);
}

/*
 * Uma rejeição não tratada numa rota não pode derrubar o site inteiro: por
 * omissão o Node termina o processo, e a plataforma voltaria a responder 503
 * até reiniciar a aplicação.
 */
process.on('unhandledRejection', (erro) => log('rejeição não tratada:', erro));

// --- o Next ----------------------------------------------------------------
const next = require('next');
const app = next({ dev: false, dir: PAINEL });
const atender = app.getRequestHandler();
const pronto = app.prepare().then(
  () => {
    log('Next pronto');
    return true;
  },
  (erro) => {
    log('ERRO: o Next não arrancou:', erro);
    return false;
  },
);

function tratar(pedido, resposta) {
  pronto
    .then((ok) => {
      if (ok) return atender(pedido, resposta);
      resposta.statusCode = 503;
      resposta.end('o painel não arrancou — ver os logs do servidor');
    })
    .catch((erro) => {
      log('erro ao responder', pedido.url, erro);
      if (!resposta.headersSent) {
        resposta.statusCode = 500;
        resposta.end('erro interno');
      }
    });
}

// --- escuta pública: a primeira, e já --------------------------------------
const publico = http.createServer(tratar);
publico.on('error', (erro) => {
  log('ERRO: não foi possível escutar:', erro);
  process.exit(1);
});
// Número → porta TCP em todas as interfaces; texto → socket da plataforma.
publico.listen(/^\d+$/.test(PORTA) ? Number(PORTA) : PORTA, () => {
  const onde = ATRAS_DO_LITESPEED ? 'socket do LiteSpeed' : PORTA;
  log(`painel a responder em ${onde} (Node ${process.versions.node})`);
});

// --- escuta interna, para o motor ------------------------------------------
const interno = http.createServer(tratar);
LISTEN_ORIGINAL.call(interno, 0, '127.0.0.1', () => {
  // O lsnode também substitui `address()` do http.Server (devolve o socket
  // dele); o original continua no net.Server.
  const endereco = net.Server.prototype.address.call(interno);
  const porta = endereco && typeof endereco === 'object' ? endereco.port : null;
  void pronto.then(() => lancarMotores(porta ? `http://127.0.0.1:${porta}` : ''));
});

// --- motores ---------------------------------------------------------------
let motores = null;
let aParar = false;

function lancarMotores(urlInterno, tentativa = 0) {
  if (aParar) return;
  if (process.env.MOTORES === 'desligados') {
    log('motores desligados (MOTORES=desligados) — só o painel está a correr');
    return;
  }
  if (!existsSync(MOTOR)) {
    log('ERRO: o motor não está compilado (falta apps/engine/dist). O painel continua sem motores.');
    return;
  }

  // No Node 20 o WebSocket nativo existe atrás de uma flag; no 22 já vem ligado.
  const flags = NODE_MAIOR < 22 ? ['--experimental-websocket'] : [];
  const filho = spawn(process.execPath, [...flags, MOTOR, 'schedule'], {
    cwd: RAIZ,
    env: { ...process.env, DASHBOARD_URL: process.env.DASHBOARD_URL || urlInterno },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  motores = filho;
  const arrancouEm = Date.now();
  log(`motores a arrancar (pid ${filho.pid}, painel interno ${urlInterno || 'indisponível'})`);

  filho.on('exit', (codigo, sinal) => {
    motores = null;
    if (aParar) return;
    // Mais de dois minutos a correr: foi uma queda, não um arranque falhado.
    const proxima = Date.now() - arrancouEm > 120_000 ? 0 : tentativa + 1;
    const espera = Math.min(60_000, 2_000 * 2 ** Math.min(proxima, 5));
    log(`motores terminaram (${codigo ?? sinal}); a reiniciar em ${Math.round(espera / 1000)}s`);
    setTimeout(() => lancarMotores(urlInterno, proxima), espera);
  });
}

// --- paragem ---------------------------------------------------------------
function parar(sinal) {
  if (aParar) return;
  aParar = true;
  log(`${sinal} recebido — a parar`);
  if (motores) motores.kill('SIGTERM');
  publico.close();
  interno.close();
  setTimeout(() => process.exit(0), 3_000).unref();
}

process.on('SIGTERM', () => parar('SIGTERM'));
process.on('SIGINT', () => parar('SIGINT'));
