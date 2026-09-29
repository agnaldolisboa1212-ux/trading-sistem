/**
 * Velas da Deriv por páginas (packages/data/src/providers/paginar.ts).
 *
 * Medido a 29/09/2026: o endpoint público devolve uma JANELA de 1000 ×
 * granularidade por pedido, não a quantidade pedida — 695 velas de 1H quando o
 * ICT ALGO pedia 3500, sem aviso. Estes testes usam uma Deriv falsa que se
 * comporta como a medida (janela, vela parcial no corte, mercado fechado, um ano
 * de história) e fixam: a série chega inteira e sem buracos, a história acaba
 * sem pedidos inúteis, e refrescar com a cópia guardada custa um pedido.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { HISTORIA_MS, MAX_PAGINAS, paginarVelas } from '../../../packages/data/dist/providers/paginar.js';

const MIN = 60_000;
const H = 60 * MIN;
const DIA = 24 * H;
/** Terça, 29/09/2026, 13:46 UTC — a hora das medições. */
const AGORA = Date.UTC(2026, 8, 29, 13, 46);

/** Forex na Deriv: fecha à sexta às 21:00 UTC e reabre à segunda às 00:00. */
const forex = (t) => {
  const d = new Date(t);
  const dia = d.getUTCDay();
  return dia !== 0 && dia !== 6 && !(dia === 5 && d.getUTCHours() >= 21);
};
/** Índices OTC (S&P, Nasdaq, Dow): 06:00–20:00 UTC, dias úteis. */
const indice = (t) => {
  const d = new Date(t);
  const dia = d.getUTCDay();
  return dia !== 0 && dia !== 6 && d.getUTCHours() >= 6 && d.getUTCHours() < 20;
};

/** `dias` de velas até `ate`; o preço é o número da vela, para se ver qual é qual. */
function serie(gran, aberto, ate = AGORA, dias = 400) {
  const passo = gran * 1000;
  const velas = [];
  for (let t = Math.floor((ate - dias * DIA) / passo) * passo; t <= ate; t += passo) {
    if (!aberto(t)) continue;
    const n = t / passo;
    velas.push({ time: t, open: n, high: n + 1, low: n - 1, close: n + 0.5, volume: 0 });
  }
  return velas;
}

/**
 * A Deriv pública como foi medida. Cada pedido devolve a janela de 1000 ×
 * granularidade que acaba em `end` (o `count` só corta, nunca estica); a
 * primeira vela, se a janela a corta a meio, vem parcial com o epoch do corte;
 * com o mercado fechado em `end`, recua até à última vela; nada para lá de um
 * ano — e um `end` anterior a isso devolve a janela mais recente.
 */
function derivFalsa(velas, gran, relogio = () => AGORA) {
  const passo = gran * 1000;
  const pedidos = [];
  const janela = (count, end) => {
    pedidos.push({ count, end });
    const agora = relogio();
    const limite = agora - HISTORIA_MS;
    let fim = end === 'latest' ? agora : end * 1000;
    if (fim < limite) fim = agora;
    const ate = velas.filter((c) => c.time <= fim && c.time <= agora);
    const ultima = ate[ate.length - 1];
    if (!ultima) return [];
    fim = Math.min(fim, ultima.time + passo - 1);
    const inicio = Math.max(limite, fim - 1000 * passo);
    const dentro = ate.filter((c) => c.time + passo > inicio);
    if (count < dentro.length) return dentro.slice(-count).map((c) => ({ ...c }));
    return dentro.map((c, i) => (i === 0 && c.time < inicio ? { ...c, time: inicio, low: c.low + 0.5 } : { ...c }));
  };
  return { janela, pedir: async (count, end) => janela(count, end), pedidos };
}

/** O que a Deriv tem: as velas inteiras do último ano, até à que se está a formar. */
const verdade = (velas, agora = AGORA) => velas.filter((c) => c.time >= agora - HISTORIA_MS && c.time <= agora);

test('3500 velas de 1H no forex: seis janelas, sem buracos e sem a vela parcial do corte', async () => {
  const velas = serie(3600, forex);
  const d = derivFalsa(velas, 3600);
  // O defeito: um pedido só traz a janela.
  assert.ok((await d.pedir(3501, 'latest')).length < 700);
  d.pedidos.length = 0;

  const r = await paginarVelas(d.pedir, 3600, 3501, { agora: AGORA });
  assert.deepEqual(r.velas, verdade(velas).slice(-3501));
  assert.equal(r.pedidos, 6);
  assert.equal(d.pedidos.length, 6);
  assert.equal(d.pedidos[0].end, 'latest');
  // Cada página acaba um segundo antes da primeira vela inteira da anterior.
  for (const p of d.pedidos.slice(1)) assert.equal((p.end + 1) % 3600, 0);
});

test('índice (06:00–20:00): 1500 velas de 15M, com janelas de ~400', async () => {
  const velas = serie(900, indice, AGORA, 60);
  const d = derivFalsa(velas, 900);
  const r = await paginarVelas(d.pedir, 900, 1501, { agora: AGORA });
  assert.deepEqual(r.velas, verdade(velas).slice(-1501));
  assert.equal(r.pedidos, 4);
});

test('o diário pára no ano que a Deriv serve: 401 pedidas, as ~260 que há, num só pedido', async () => {
  const velas = serie(86_400, forex);
  const d = derivFalsa(velas, 86_400);
  const r = await paginarVelas(d.pedir, 86_400, 401, { agora: AGORA });
  assert.deepEqual(r.velas, verdade(velas));
  assert.ok(r.velas.length > 250 && r.velas.length < 265, `${r.velas.length} velas`);
  // A primeira vela da janela (cortada no limite do ano) vinha parcial e ficou de fora.
  assert.equal(r.velas[0].time % DIA, 0);
  assert.equal(r.pedidos, 1);
});

test('instrumento com menos de um ano: a página sem velas mais antigas acaba a história', async () => {
  const velas = serie(3600, forex, AGORA, 30);
  const d = derivFalsa(velas, 3600);
  const r = await paginarVelas(d.pedir, 3600, 3501, { agora: AGORA });
  assert.deepEqual(r.velas, velas);
  assert.equal(r.pedidos, 2);
});

test('fim de semana: um `end` com o mercado fechado recua até sexta, sem página vazia', async () => {
  // Segunda às 00:30: a janela de 1M (~17 h) só tem meia hora de mercado.
  const segunda = Date.UTC(2026, 8, 28, 0, 30, 20);
  const velas = serie(60, forex, segunda, 5);
  const d = derivFalsa(velas, 60, () => segunda);
  const r = await paginarVelas(d.pedir, 60, 301, { agora: segunda });
  assert.deepEqual(r.velas, velas.slice(-301));
  assert.equal(new Date(r.velas[0].time).getUTCDay(), 5);
  assert.equal(r.pedidos, 2);
});

test('com a cópia guardada, refrescar custa um pedido — e a vela que se formava vem nova', async () => {
  const antes = serie(900, forex);
  const r0 = await paginarVelas(derivFalsa(antes, 900).pedir, 900, 1501, { agora: AGORA });
  // A última vela foi guardada a meio: o fecho que ficou não é o final.
  const guardadas = r0.velas.map((c, i, a) => (i === a.length - 1 ? { ...c, close: -1 } : c));

  const depois = AGORA + 15 * MIN;
  const velas = serie(900, forex, depois);
  const d = derivFalsa(velas, 900, () => depois);
  const r = await paginarVelas(d.pedir, 900, 1501, { guardadas, agora: depois });
  assert.equal(r.pedidos, 1);
  assert.ok(d.pedidos[0].count <= 3, `a página só vai até à cópia (${d.pedidos[0].count} velas)`);
  assert.deepEqual(r.velas, verdade(velas, depois).slice(-1501));
});

test('cópia mais curta do que o pedido: liga-se a ela e só o que falta vem de trás', async () => {
  const r0 = await paginarVelas(derivFalsa(serie(900, forex), 900).pedir, 900, 1001, { agora: AGORA });
  const depois = AGORA + 15 * MIN;
  const velas = serie(900, forex, depois);
  const d = derivFalsa(velas, 900, () => depois);
  const r = await paginarVelas(d.pedir, 900, 1501, { guardadas: r0.velas, agora: depois });
  assert.deepEqual(r.velas, verdade(velas, depois).slice(-1501));
  assert.equal(r.pedidos, 2);
});

test('uma Deriv avariada (uma vela por página) não prende o pedido: pára nas MAX_PAGINAS', async () => {
  let n = 0;
  const pedir = async (_count, end) => {
    n++;
    const t = end === 'latest' ? AGORA - (AGORA % H) : (end + 1) * 1000 - H;
    return [{ time: t, open: 1, high: 1, low: 1, close: 1, volume: 0 }];
  };
  const r = await paginarVelas(pedir, 3600, 3501, { agora: AGORA });
  assert.equal(n, MAX_PAGINAS);
  assert.equal(r.velas.length, MAX_PAGINAS);
});

test('cópia fresca e curta (1000 pedidas há segundos, agora 1500): só se pede o que falta para trás', async () => {
  const velas = serie(900, forex);
  const r0 = await paginarVelas(derivFalsa(velas, 900).pedir, 900, 1001, { agora: AGORA });
  const d = derivFalsa(velas, 900);
  const r = await paginarVelas(d.pedir, 900, 1501, { guardadas: r0.velas, fresca: true, agora: AGORA });
  assert.deepEqual(r.velas, verdade(velas).slice(-1501));
  assert.equal(r.pedidos, 1);
  assert.notEqual(d.pedidos[0].end, 'latest');
});

/**
 * O que o motor pede à Deriv por uma série, na primeira passagem e na vela
 * seguinte, com a cópia de `velasDeriv`: refresca até à maior quantidade
 * guardada, e uma cópia fresca só precisa do que está para trás dela.
 */
async function custo(aberto, gran, pedidas, dias = 400) {
  const passo = gran * 1000;
  const velas = serie(gran, aberto, AGORA + passo, dias);
  let guardadas = [];
  let frio = 0;
  for (const count of pedidas) {
    const alvo = Math.max(count, guardadas.length);
    const opcoes = { guardadas, fresca: guardadas.length > 0, agora: AGORA };
    const r = await paginarVelas(derivFalsa(velas, gran).pedir, gran, alvo, opcoes);
    frio += r.pedidos;
    guardadas = r.velas;
  }
  const depois = AGORA + passo;
  const falsa = derivFalsa(velas, gran, () => depois);
  const r = await paginarVelas(falsa.pedir, gran, guardadas.length, { guardadas, agora: depois });
  return { frio, quente: r.pedidos };
}

test('orçamento: a primeira passagem do motor cabe num minuto do travão; depois, um pedido por série', async () => {
  /*
   * A vigilância por omissão (VIGILANCIA_OMISSAO em `tempo-real.ts`) e o que o
   * motor pede de cada instrumento:
   *   ICT ALGO   15M 1001 (`ict-fixo.ts`) e logo a seguir 1501 (VELAS_ALGO),
   *              1H 3501 (VELAS_1H), 1D 401 e, no Asia Range, 1M 301
   *   par SMT    o do ouro é o XAGUSD, fora da vigilância: 1H 3501 e 15M 301
   *              (os do EURUSD e do GBPUSD são um ao outro; os índices não têm)
   *   os outros  BTC, V75 e V100S: 301 em 15M e em 1H
   * Mais o `active_symbols` da passagem.
   */
  const sempre = () => true;
  const series = [
    ...['EURUSD', 'GBPUSD'].flatMap(() => [
      [forex, 900, [1001, 1501], 60],
      [forex, 3600, [3501]],
      [forex, 86_400, [401]],
      [forex, 60, [301], 5],
    ]),
    // XAUUSD e o seu par, o XAGUSD
    [forex, 900, [1001, 1501], 60],
    [forex, 3600, [3501]],
    [forex, 86_400, [401]],
    [forex, 3600, [3501]],
    [forex, 900, [301], 60],
    ...['US100', 'SP500', 'US30', 'GER30'].flatMap(() => [
      [indice, 900, [1001, 1501], 60],
      [indice, 3600, [3501]],
      [indice, 86_400, [401]],
    ]),
    ...['BTCUSD', 'V75', 'V100S'].flatMap(() => [
      [sempre, 900, [301], 10],
      [sempre, 3600, [301], 30],
    ]),
  ];
  let frio = 1;
  let quente15 = 0;
  for (const [aberto, gran, pedidas, dias] of series) {
    const c = await custo(aberto, gran, pedidas, dias);
    frio += c.frio;
    if (gran === 900) quente15 += c.quente;
  }
  // O travão (`ritmo.ts`) deixa sair 15 de seguida e depois 2 por segundo: 135 num minuto.
  assert.ok(frio <= 135, `primeira passagem: ${frio} pedidos`);
  // Na vela de 15M seguinte, cada série de 15M custa um pedido — como antes das páginas.
  assert.equal(quente15, series.filter((s) => s[1] === 900).length);
});

// ---------------------------------------------------------------------------
// `velasDeriv` a sério, contra um servidor WebSocket local que é a Deriv falsa.
// ---------------------------------------------------------------------------

/** Um servidor WebSocket mínimo (texto, sem extensões): o suficiente para `deriv.ts`. */
function servidorWs(responder) {
  const server = createServer();
  const sockets = new Set();
  const moldura = (dados) => {
    const n = dados.length;
    let cab;
    if (n < 126) cab = Buffer.from([0x81, n]);
    else if (n < 65_536) {
      cab = Buffer.alloc(4);
      cab[0] = 0x81;
      cab[1] = 126;
      cab.writeUInt16BE(n, 2);
    } else {
      cab = Buffer.alloc(10);
      cab[0] = 0x81;
      cab[1] = 127;
      cab.writeBigUInt64BE(BigInt(n), 2);
    }
    return Buffer.concat([cab, dados]);
  };
  server.on('upgrade', (req, socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    const aceite = createHash('sha1')
      .update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${aceite}\r\n\r\n`,
    );
    let buf = Buffer.alloc(0);
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (buf.length < 2) return;
        const op = buf[0] & 0x0f;
        let n = buf[1] & 0x7f;
        let off = 2;
        if (n === 126) {
          if (buf.length < 4) return;
          n = buf.readUInt16BE(2);
          off = 4;
        } else if (n === 127) {
          if (buf.length < 10) return;
          n = Number(buf.readBigUInt64BE(2));
          off = 10;
        }
        if (buf.length < off + 4 + n) return;
        const mascara = buf.subarray(off, off + 4);
        const dados = Buffer.from(buf.subarray(off + 4, off + 4 + n)).map((b, i) => b ^ mascara[i % 4]);
        buf = buf.subarray(off + 4 + n);
        if (op === 8) {
          socket.end();
          return;
        }
        if (op !== 1) continue;
        const pedido = JSON.parse(dados.toString('utf8'));
        socket.write(moldura(Buffer.from(JSON.stringify({ ...responder(pedido), req_id: pedido.req_id }))));
      }
    });
  });
  return {
    abrir: () => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port))),
    fechar: () => {
      for (const s of sockets) s.destroy();
      return new Promise((r) => server.close(r));
    },
  };
}

test('velasDeriv: pagina pela ligação e pelo travão, guarda a série e ao refrescar pede só o que falta', async (t) => {
  // Um relógio que anda (a ligação precisa dele), a começar em AGORA.
  const dataNow = Date.now;
  let desvio = AGORA - dataNow();
  const relogio = () => dataNow() + desvio;
  const series = {
    3600: serie(3600, forex, AGORA + 2 * H),
    900: serie(900, forex, AGORA + 2 * H, 60),
  };
  const falsas = {
    3600: derivFalsa(series[3600], 3600, relogio),
    900: derivFalsa(series[900], 900, relogio),
  };
  const recebidos = [];
  const servidor = servidorWs((p) => {
    recebidos.push(p);
    const velas = falsas[p.granularity].janela(p.count, p.end);
    return {
      candles: velas.map((c) => ({ epoch: c.time / 1000, open: c.open, high: c.high, low: c.low, close: c.close })),
    };
  });
  const porta = await servidor.abrir();
  process.env['DERIV_WS_URL'] = `ws://127.0.0.1:${porta}`;
  const { velasDeriv, velasFechadasDeriv, closeDerivConnection } = await import(
    '../../../packages/data/dist/providers/deriv.js'
  );
  // O travão (`ritmoVelas`) já guardou o relógio verdadeiro ao ser criado; a cache usa este.
  Date.now = relogio;
  t.after(async () => {
    Date.now = dataNow;
    closeDerivConnection();
    await servidor.fechar();
  });

  const fechadas = (velas, gran, n) =>
    verdade(velas, relogio())
      .filter((c) => c.time + gran * 1000 <= relogio())
      .slice(-n);

  // 1H, 3500: seis páginas, cada uma um pedido.
  const v1 = await velasFechadasDeriv('frxEURUSD', 3600, 3500);
  assert.deepEqual(v1, fechadas(series[3600], 3600, 3500));
  assert.equal(recebidos.length, 6);
  assert.ok(recebidos.every((p) => p.ticks_history === 'frxEURUSD' && p.count <= 5000));

  // Outra vez na mesma hora: a cópia, sem pedido.
  await velasFechadasDeriv('frxEURUSD', 3600, 3500);
  assert.equal(recebidos.length, 6);

  // Uma hora depois: UMA página, até à última vela guardada.
  desvio += H;
  const v2 = await velasFechadasDeriv('frxEURUSD', 3600, 3500);
  assert.deepEqual(v2, fechadas(series[3600], 3600, 3500));
  assert.equal(recebidos.length, 7);
  assert.ok(recebidos[6].count <= 3);

  // 15M: o setup fixo pede 1000, o tempo real 1500 — este liga-se à cópia do primeiro.
  const a = await velasDeriv('frxEURUSD', 900, 1001);
  assert.equal(a.length, 1001);
  const pedidos1001 = recebidos.length - 7;
  const b = await velasDeriv('frxEURUSD', 900, 1501);
  assert.equal(b.length, 1501);
  const pedidos1501 = recebidos.length - 7 - pedidos1001;
  assert.equal(pedidos1001, 2);
  assert.equal(pedidos1501, 1);

  // A vela de 15M seguinte: quem pede 1000 refresca as 1500 guardadas com um pedido,
  // e o tempo real, logo a seguir, é servido pela cópia.
  desvio += 15 * MIN;
  const antes = recebidos.length;
  const c = await velasDeriv('frxEURUSD', 900, 1001);
  const d = await velasDeriv('frxEURUSD', 900, 1501);
  assert.equal(recebidos.length - antes, 1);
  assert.deepEqual(d.slice(-1001), c);
  assert.deepEqual(d, verdade(series[900], relogio()).slice(-1501));
});
