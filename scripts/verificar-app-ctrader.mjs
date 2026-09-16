#!/usr/bin/env node
/**
 * A aplicação cTrader Open API já está aprovada?
 *
 * Faz só a autenticação da aplicação (ProtoOAApplicationAuthReq) no servidor
 * demo — não liga a nenhuma conta nem envia ordens. Lê CTRADER_CLIENT_ID e
 * CTRADER_CLIENT_SECRET do ambiente ou, se faltarem, de `.env.ctrader` na raiz.
 * Nunca escreve os valores.
 *
 *   node scripts/verificar-app-ctrader.mjs
 *
 * Saída numa linha e código de saída:
 *   0  APROVADA   a aplicação autentica: a negociação CFD já pode funcionar
 *   2  PENDENTE   "OA client is not in active state" (ainda em análise)
 *   1  ERRO       credenciais em falta, rede, ou outra resposta da cTrader
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

function lerEnv(caminho) {
  if (!existsSync(caminho)) return {};
  const pares = readFileSync(caminho, 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]);
  return Object.fromEntries(pares);
}

const ficheiro = lerEnv(join(raiz, '.env.ctrader'));
const clientId = process.env.CTRADER_CLIENT_ID || ficheiro.CTRADER_CLIENT_ID;
const clientSecret = process.env.CTRADER_CLIENT_SECRET || ficheiro.CTRADER_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.log('ERRO: faltam CTRADER_CLIENT_ID e CTRADER_CLIENT_SECRET (ambiente ou .env.ctrader)');
  process.exit(1);
}

if (typeof WebSocket !== 'function') {
  console.log(`ERRO: este Node (${process.version}) não tem WebSocket global — use Node 22 ou mais recente`);
  process.exit(1);
}

const resultado = await new Promise((resolve) => {
  const ws = new WebSocket('wss://demo.ctraderapi.com:5036');
  let feito = false;
  const fim = (r) => {
    if (feito) return;
    feito = true;
    clearTimeout(tempo);
    try {
      ws.close();
    } catch {}
    resolve(r);
  };
  const tempo = setTimeout(() => fim({ codigo: 1, texto: 'ERRO: a cTrader não respondeu em 20 s' }), 20_000);
  ws.onopen = () => ws.send(JSON.stringify({ clientMsgId: 'verificar', payloadType: 2100, payload: { clientId, clientSecret } }));
  ws.onmessage = (m) => {
    const j = JSON.parse(String(m.data));
    if (j.payloadType === 2101) return fim({ codigo: 0, texto: 'APROVADA: a aplicação cTrader autentica' });
    if (j.payloadType === 2142 || j.payloadType === 50) {
      const desc = `${j.payload?.errorCode ?? ''} ${j.payload?.description ?? ''}`.trim();
      return fim(/not in active state/i.test(desc) ? { codigo: 2, texto: `PENDENTE: ${desc}` } : { codigo: 1, texto: `ERRO: ${desc}` });
    }
  };
  ws.onerror = () => fim({ codigo: 1, texto: 'ERRO: sem ligação a demo.ctraderapi.com:5036' });
  ws.onclose = (e) => fim({ codigo: 1, texto: `ERRO: ligação fechada (${e.code})` });
});

console.log(resultado.texto);
process.exit(resultado.codigo);
