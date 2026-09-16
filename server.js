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
 * Tudo o que se segue foi descoberto nos Runtime logs da Hostinger.
 *
 * ── COMMONJS, SEM `await` NO TOPO ──────────────────────────────────────────
 *
 * O LiteSpeed carrega a aplicação com o `lsnode.js`, que faz `require()` deste
 * ficheiro. Um módulo ES com `await` no topo não se carrega assim
 * (ERR_REQUIRE_ASYNC_MODULE) e o site dava 503. A raiz do repositório não
 * declara `"type": "module"`.
 *
 * ── AS DUAS ESCUTAS ────────────────────────────────────────────────────────
 *
 * O lsnode substitui `http.Server.prototype.listen`: a PRIMEIRA chamada liga ao
 * socket do LiteSpeed (a porta é ignorada) e as seguintes são ignoradas em
 * silêncio. A escuta pública é a primeira, logo no carregamento; a interna, que
 * o motor usa para pedir o envio de push, usa o `listen` original
 * (`realListen`).
 *
 * ── A COMPILAÇÃO VEM DE `saida/` ───────────────────────────────────────────
 *
 * A aplicação corre de um checkout do repositório com o `node_modules`, sem
 * nada do que o build gerou. O build junta isso em `saida/`
 * (scripts/preparar-saida.mjs), que é a Output directory — e por isso este
 * ficheiro pode estar a correr como `saida/server.js`. No arranque, se a
 * compilação não estiver no sítio, é reposta a partir de `saida/`. Só se nem aí
 * existir se compila ali mesmo (`COMPILAR_NO_ARRANQUE=nao` desliga).
 *
 * ── VÁRIOS PROCESSOS AO MESMO TEMPO ────────────────────────────────────────
 *
 * O LiteSpeed pode arrancar vários processos desta aplicação. Dois a compilar na
 * mesma pasta estragaram-se um ao outro e esgotaram o limite de processos da
 * conta; dois com motores dariam avisos em duplicado. Por isso há trincos em
 * ficheiro: só um processo prepara a compilação de cada vez, e só um corre os
 * motores — se esse morrer, outro fica com eles no minuto seguinte.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const { basename, dirname, join } = require('node:path');

const DENTRO_DA_SAIDA = basename(__dirname) === 'saida';
const RAIZ = DENTRO_DA_SAIDA ? dirname(__dirname) : __dirname;
const SAIDA = DENTRO_DA_SAIDA ? __dirname : join(RAIZ, 'saida');
const PAINEL = join(RAIZ, 'apps', 'dashboard');
const MOTOR = join(RAIZ, 'apps', 'engine', 'dist', 'index.js');
const PORTA = process.env.PORT || '3000';
const NODE_MAIOR = Number(process.versions.node.split('.')[0]);
// O lsnode guarda o `listen` original antes de carregar a aplicação.
const LISTEN_ORIGINAL = http.Server.prototype.realListen || http.Server.prototype.listen;
const ATRAS_DO_LITESPEED = typeof http.Server.prototype.realListen === 'function';

/**
 * Ficheiros que só existem depois de um build COMPLETO. O `BUILD_ID` sozinho não
 * chega: o Next escreve-o a meio, e uma compilação interrompida parecia pronta
 * (depois falhava a ler `prerender-manifest.json`). `compilado` é o `distDir` de
 * produção em apps/dashboard/next.config.mjs.
 */
const COMPILACAO = [
  'apps/dashboard/compilado/BUILD_ID',
  'apps/dashboard/compilado/prerender-manifest.json',
  'apps/engine/dist/index.js',
  'packages/core/dist/index.js',
  'packages/data/dist/index.js',
  'packages/db/dist/index.js',
  'packages/notify/dist/index.js',
];
const completa = (base) => COMPILACAO.every((rel) => fs.existsSync(join(base, rel)));

const log = (...partes) => console.log(new Date().toISOString(), '[servidor]', ...partes);
const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

// Tem de estar definido ANTES de o Next ser carregado.
process.env.NODE_ENV ||= 'production';

if (NODE_MAIOR < 22) {
  log(
    `ATENÇÃO: Node ${process.versions.node}. Este sistema precisa do Node 22 — sem ele não existe ` +
      'WebSocket nativo, e a ligação à Deriv e ao Supabase falham. Mude a versão nas definições da aplicação.',
  );
}

/*
 * Uma rejeição não tratada numa rota não pode derrubar o site inteiro: por
 * omissão o Node termina o processo, e a plataforma voltaria a responder 503
 * até reiniciar a aplicação.
 */
process.on('unhandledRejection', (erro) => log('rejeição não tratada:', erro));

// --- trincos entre processos -----------------------------------------------
function processoVivo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (erro) {
    return erro.code === 'EPERM';
  }
}

const caminhoTrinco = (nome) => join(RAIZ, `${nome}.trinco`);

/** Fica com o trinco se estiver livre, ou se o dono já morreu. */
function tomarTrinco(nome) {
  const caminho = caminhoTrinco(nome);
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      fs.writeFileSync(caminho, String(process.pid), { flag: 'wx' });
      return true;
    } catch (erro) {
      if (erro.code !== 'EEXIST') throw erro;
    }
    let dono;
    let idade;
    try {
      dono = Number(fs.readFileSync(caminho, 'utf8'));
      idade = Date.now() - fs.statSync(caminho).mtimeMs;
    } catch {
      continue; // desapareceu entretanto
    }
    // Vazio e recente: o dono está a meio de o escrever.
    if (processoVivo(dono) || (!dono && idade < 10_000)) return false;
    try {
      fs.unlinkSync(caminho);
    } catch {
      /* outro processo tirou-o primeiro */
    }
  }
  return false;
}

function largarTrinco(nome) {
  try {
    if (Number(fs.readFileSync(caminhoTrinco(nome), 'utf8')) === process.pid) {
      fs.unlinkSync(caminhoTrinco(nome));
    }
  } catch {
    /* não era nosso, ou já não existe */
  }
}

process.on('exit', () => {
  largarTrinco('preparacao');
  largarTrinco('motores');
});

// --- compilação ------------------------------------------------------------
/** 'a arrancar' | 'a preparar' | 'a compilar' | 'pronto' | 'falhou' */
let fase = 'a arrancar';
let atender = null;

function diagnostico() {
  log('pasta da aplicação:', RAIZ, '| a correr de:', __filename);
  for (const base of [RAIZ, SAIDA]) {
    for (const rel of COMPILACAO) {
      log(`   ${fs.existsSync(join(base, rel)) ? 'existe  ' : 'FALTA   '} ${join(base, rel)}`);
    }
  }
  for (const pasta of [RAIZ, PAINEL, SAIDA]) {
    if (!fs.existsSync(pasta)) continue;
    try {
      log(`   conteúdo de ${pasta}: ${fs.readdirSync(pasta).join('  ')}`);
    } catch (erro) {
      log(`   não foi possível ler ${pasta}: ${erro.message}`);
    }
  }
}

/**
 * Corre um script de Node com o mesmo binário, sem depender do PATH.
 *
 * Num grupo de processos próprio (o servidor chegou a receber SIGINT no
 * instante em que o `next build` falhou), sem telemetria do Next (abre mais um
 * processo) e com menos threads: o alojamento conta-as no limite de processos.
 */
function correrNode(args) {
  return new Promise((resolver, rejeitar) => {
    const filho = spawn(process.execPath, args, {
      cwd: RAIZ,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        NEXT_TELEMETRY_DISABLED: '1',
        UV_THREADPOOL_SIZE: '2',
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --v8-pool-size=2`.trim(),
      },
      stdio: ['ignore', 'inherit', 'inherit'],
      // No Windows `detached` abre uma consola nova; lá não é preciso.
      detached: process.platform !== 'win32',
    });
    filho.on('error', rejeitar);
    filho.on('exit', (codigo, sinal) =>
      codigo === 0
        ? resolver()
        : rejeitar(new Error(`${args.join(' ')} terminou com ${codigo ?? sinal}`)),
    );
  });
}

async function prepararCompilacao() {
  if (completa(RAIZ)) return;

  log('AVISO: a compilação não está no sítio.');
  diagnostico();
  fase = 'a preparar';

  while (!tomarTrinco('preparacao')) {
    await esperar(2_000);
    if (completa(RAIZ)) {
      log('outro processo desta aplicação preparou a compilação');
      return;
    }
  }

  try {
    if (completa(RAIZ)) return;

    if (completa(SAIDA)) {
      log(`a repor a compilação a partir de ${SAIDA}`);
      // Restos de uma compilação interrompida não se misturam com a boa.
      fs.rmSync(join(PAINEL, 'compilado'), { recursive: true, force: true });
      fs.cpSync(SAIDA, RAIZ, { recursive: true, force: true });
      if (completa(RAIZ)) {
        log('compilação reposta');
        return;
      }
      log('AVISO: depois de repor, a compilação continua incompleta');
    } else {
      log(`AVISO: ${SAIDA} também não tem a compilação. Na Hostinger, a Output directory tem de ser "saida".`);
    }

    if (process.env.COMPILAR_NO_ARRANQUE === 'nao') {
      throw new Error('sem compilação, e COMPILAR_NO_ARRANQUE=nao');
    }
    fase = 'a compilar';
    log('a compilar aqui — demora 1 a 3 minutos…');
    // --force: o tsconfig.tsbuildinfo pode existir sem o dist/, e aí o tsc
    // acharia que não há nada a fazer.
    await correrNode([require.resolve('typescript/bin/tsc'), '-b', '--force']);
    await correrNode([require.resolve('next/dist/bin/next'), 'build', PAINEL]);
    if (!completa(RAIZ)) throw new Error('o build terminou, mas a compilação continua incompleta');
    log('compilação concluída');
  } finally {
    largarTrinco('preparacao');
  }
}

async function arrancar() {
  fase = 'a arrancar';
  await prepararCompilacao();
  fase = 'a arrancar';

  const next = require('next');
  const app = next({ dev: false, dir: PAINEL });
  await app.prepare();
  atender = app.getRequestHandler();
  fase = 'pronto';
  log('Next pronto');
}

// Depois de uma falha, o pedido seguinte volta a tentar — mas não antes de um
// minuto, para um erro persistente não pôr o servidor a compilar sem parar.
const ESPERA_ENTRE_TENTATIVAS = 60_000;
let falhouEm = 0;

function iniciarPainel() {
  return arrancar().then(
    () => true,
    (erro) => {
      fase = 'falhou';
      falhouEm = Date.now();
      log('ERRO: o painel não arrancou (nova tentativa no próximo pedido, daqui a 1 minuto):', erro);
      return false;
    },
  );
}

let pronto = iniciarPainel();
const primeiraTentativa = pronto;

const AVISOS = {
  'a preparar': 'O painel está a ser preparado neste servidor. Volte a abrir daqui a 1 minuto.',
  'a compilar': 'O painel está a ser compilado neste servidor. Volte a abrir daqui a 2 minutos.',
  falhou: 'O painel não arrancou. Volta a tentar sozinho daqui a 1 minuto; os detalhes estão nos logs do servidor.',
};

function tratar(pedido, resposta) {
  if (fase === 'falhou' && Date.now() - falhouEm > ESPERA_ENTRE_TENTATIVAS) {
    log('nova tentativa de arrancar o painel');
    pronto = iniciarPainel();
  }
  // Preparar e compilar demoram: responde já, em vez de deixar o pedido
  // pendurado até o servidor web desistir.
  if (AVISOS[fase]) {
    resposta.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '60' });
    resposta.end(AVISOS[fase]);
    return;
  }
  pronto
    .then((ok) => {
      if (ok) return atender(pedido, resposta);
      resposta.statusCode = 503;
      resposta.end(AVISOS.falhou);
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
  log(`painel a responder em ${onde} (Node ${process.versions.node}, pid ${process.pid})`);
});

// --- escuta interna, para o motor ------------------------------------------
const interno = http.createServer(tratar);
LISTEN_ORIGINAL.call(interno, 0, '127.0.0.1', () => {
  // O lsnode também substitui `address()` do http.Server (devolve o socket
  // dele); o original continua no net.Server.
  const endereco = net.Server.prototype.address.call(interno);
  const porta = endereco && typeof endereco === 'object' ? endereco.port : null;
  // Os motores não dependem do painel: arrancam depois da primeira tentativa,
  // corra ela bem ou mal.
  void primeiraTentativa.then(() => iniciarMotores(porta ? `http://127.0.0.1:${porta}` : ''));
});

// --- motores ---------------------------------------------------------------
let motores = null;
let comMotores = false;
let aParar = false;

function iniciarMotores(urlInterno) {
  if (process.env.MOTORES === 'desligados') {
    log('motores desligados (MOTORES=desligados) — só o painel está a correr');
    return;
  }
  const tentar = () => {
    if (aParar || comMotores || !tomarTrinco('motores')) return false;
    comMotores = true;
    lancarMotores(urlInterno);
    return true;
  };
  if (tentar()) return;

  log('os motores já correm noutro processo desta aplicação — este fica só com o painel');
  const vigia = setInterval(() => {
    if (tentar()) {
      log('o processo que tinha os motores terminou — este fica com eles');
      clearInterval(vigia);
    }
  }, 60_000);
  vigia.unref();
}

function lancarMotores(urlInterno, tentativa = 0) {
  if (aParar) return;
  if (!fs.existsSync(MOTOR)) {
    log('ERRO: o motor não está compilado (falta apps/engine/dist). O painel continua sem motores.');
    return;
  }

  // No Node 20 o WebSocket nativo existe atrás de uma flag; no 22 já vem ligado.
  const flags = NODE_MAIOR < 22 ? ['--experimental-websocket'] : [];
  const filho = spawn(process.execPath, [...flags, MOTOR, 'schedule'], {
    cwd: RAIZ,
    // MOTOR_PAI_PID: o motor pára sozinho se este processo morrer sem o avisar.
    env: {
      ...process.env,
      DASHBOARD_URL: process.env.DASHBOARD_URL || urlInterno,
      MOTOR_PAI_PID: String(process.pid),
    },
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
