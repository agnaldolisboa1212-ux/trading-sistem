#!/usr/bin/env node
/**
 * Servidor de produção — `npm start`, e o "Entry file" na Hostinger.
 *
 * `.js` e não `.mjs`: o `package.json` da raiz tem `"type": "module"`, por isso é
 * ESM na mesma, e há painéis de alojamento que só aceitam `.js` como ficheiro de
 * entrada.
 *
 * Um só processo que ESCUTA na porta da plataforma, e os motores como filho.
 *
 * ── PORQUE EXISTE ──────────────────────────────────────────────────────────
 *
 * O primeiro deploy na Hostinger respondia 503 em todas as páginas. O `npm
 * start` de então corria `scripts/sistema.mjs`, que não escuta em porta
 * nenhuma: lança o `next start` e o motor como processos à parte. Plataformas
 * que gerem a aplicação por si (Hostinger, Passenger, cPanel) esperam que o
 * processo que ELAS arrancam atenda na porta `PORT`. Não vendo ninguém a
 * escutar, respondem 503.
 *
 * Aqui o próprio processo cria o servidor HTTP com a API programática do Next,
 * e só depois lança os motores.
 *
 * ── A PORTA INTERNA ────────────────────────────────────────────────────────
 *
 * O motor pede ao painel que envie notificações push. Algumas plataformas dão
 * em `PORT` um socket e não um número, e aí "127.0.0.1:PORT" não existe. Por
 * isso abre-se uma segunda escuta, só em 127.0.0.1 e numa porta livre qualquer,
 * e é essa que o motor recebe em `DASHBOARD_URL`.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = dirname(fileURLToPath(import.meta.url));
const PAINEL = join(RAIZ, 'apps', 'dashboard');
const MOTOR = join(RAIZ, 'apps', 'engine', 'dist', 'index.js');
const PORTA = process.env.PORT || '3000';
const NODE_MAIOR = Number(process.versions.node.split('.')[0]);

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

const { default: next } = await import('next');
const app = next({ dev: false, dir: PAINEL });
const atender = app.getRequestHandler();
await app.prepare();

const tratar = (pedido, resposta) => {
  Promise.resolve(atender(pedido, resposta)).catch((erro) => {
    log('erro ao responder', pedido.url, erro);
    if (!resposta.headersSent) {
      resposta.statusCode = 500;
      resposta.end('erro interno');
    }
  });
};

// --- escuta pública --------------------------------------------------------
const publico = createServer(tratar);
// Número → porta TCP em todas as interfaces; texto → socket da plataforma.
publico.listen(/^\d+$/.test(PORTA) ? Number(PORTA) : PORTA, () => {
  log(`painel a responder em ${PORTA} (Node ${process.versions.node})`);
});

// --- escuta interna, para o motor ------------------------------------------
const interno = createServer(tratar);
interno.listen(0, '127.0.0.1', () => {
  const endereco = interno.address();
  const porta = typeof endereco === 'object' && endereco ? endereco.port : null;
  lancarMotores(porta ? `http://127.0.0.1:${porta}` : '');
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
  log(`motores a arrancar (pid ${filho.pid})`);

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
  motores?.kill('SIGTERM');
  publico.close();
  interno.close();
  setTimeout(() => process.exit(0), 3_000).unref();
}

process.on('SIGTERM', () => parar('SIGTERM'));
process.on('SIGINT', () => parar('SIGINT'));
