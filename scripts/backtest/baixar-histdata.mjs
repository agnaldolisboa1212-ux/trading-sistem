#!/usr/bin/env node
/**
 * Descarrega do HistData velas de 1 minuto e grava-as em 15M e 1H, no mesmo
 * formato de `data/backtest/histdata/` (tempo em ms UTC).
 *
 *   node scripts/backtest/baixar-histdata.mjs AUDJPY CADJPY --desde 2021
 *   node scripts/backtest/baixar-histdata.mjs GBPJPY --tfs 3m,5m   (só esses timeframes)
 *
 * Um ficheiro que já exista com história MAIS ANTIGA do que a descarregada não
 * é substituído (o GBPJPY de 15M vem de 2016; um download desde 2021 cortava-o).
 * `--forcar` substitui na mesma.
 *
 * ── PORMENORES QUE MUDAM OS RESULTADOS ─────────────────────────────────────
 *
 *   · O HistData dá as horas em EST SEM horário de verão (UTC−5 o ano todo).
 *     Somam-se 5 horas e fica UTC exacto. Os ficheiros já existentes foram
 *     feitos assim: o EURUSD abre ao domingo às 22:00 UTC.
 *   · Anos fechados vêm num ficheiro por ano; o ano corrente vem por mês.
 *   · Um pedido de cada vez, com pausa: é um serviço gratuito.
 *
 * Os ZIP lêem-se aqui mesmo (cabeçalho local + inflate do zlib): o Node não
 * traz leitor de ZIP, e não vale uma dependência para um ficheiro por pedido.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DESTINO = join(RAIZ, 'data', 'backtest', 'histdata');
mkdirSync(DESTINO, { recursive: true });

const args = process.argv.slice(2);
const iDesde = args.indexOf('--desde');
const desde = iDesde >= 0 ? Number(args[iDesde + 1]) : 2021;
const iTfs = args.indexOf('--tfs');
const PASSOS = { '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000 };
const tfs = (iTfs >= 0 ? args[iTfs + 1] : '15m,1h').split(',').filter((t) => PASSOS[t]);
const forcar = args.includes('--forcar');
const valores = new Set([iDesde + 1, iTfs + 1].filter((k) => k > 0));
const pares = args.filter((a, k) => !a.startsWith('--') && !valores.has(k)).map((a) => a.toUpperCase());
if (pares.length === 0) {
  console.log('uso: node scripts/backtest/baixar-histdata.mjs PAR [PAR...] [--desde ANO]');
  process.exit(1);
}

const hoje = new Date();
const anoActual = hoje.getUTCFullYear();
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

/** Extrai o primeiro ficheiro .csv de um ZIP. */
function csvDoZip(buf) {
  // Directório central: a assinatura do fim (0x06054b50) está nos últimos bytes.
  let fim = -1;
  for (let k = buf.length - 22; k >= Math.max(0, buf.length - 65_557); k--) {
    if (buf.readUInt32LE(k) === 0x06054b50) {
      fim = k;
      break;
    }
  }
  if (fim < 0) throw new Error('ZIP sem directório central');
  const entradas = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  for (let e = 0; e < entradas; e++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('entrada do directório inválida');
    const metodo = buf.readUInt16LE(p + 10);
    const comprimido = buf.readUInt32LE(p + 20);
    const nomeLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const comentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.toString('utf8', p + 46, p + 46 + nomeLen);
    p += 46 + nomeLen + extraLen + comentLen;
    if (!nome.toLowerCase().endsWith('.csv')) continue;
    const lNome = buf.readUInt16LE(local + 26);
    const lExtra = buf.readUInt16LE(local + 28);
    const dados = buf.subarray(local + 30 + lNome + lExtra, local + 30 + lNome + lExtra + comprimido);
    if (metodo === 0) return dados.toString('utf8');
    if (metodo === 8) return inflateRawSync(dados).toString('utf8');
    throw new Error(`compressão ZIP ${metodo} não suportada`);
  }
  throw new Error('ZIP sem CSV');
}

/** Um ficheiro do HistData (ano inteiro, ou um mês se `mes` vier). */
async function baixar(par, ano, mes) {
  const caminho = `/ascii/1-minute-bar-quotes/${par.toLowerCase()}/${ano}${mes ? `/${mes}` : ''}`;
  const pagina = `https://www.histdata.com/download-free-forex-historical-data/?${caminho}`;
  const html = await (await fetch(pagina)).text();
  const tk = /id="tk"\s+value="([^"]+)"/.exec(html)?.[1] ?? /name="tk"[^>]*value="([^"]+)"/.exec(html)?.[1];
  if (!tk) return null; // ficheiro ainda não publicado
  const corpo = new URLSearchParams({
    tk,
    date: String(ano),
    datemonth: mes ? `${ano}${String(mes).padStart(2, '0')}` : String(ano),
    platform: 'ASCII',
    timeframe: 'M1',
    fxpair: par,
  });
  const r = await fetch('https://www.histdata.com/get.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: pagina },
    body: corpo,
  });
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 1000 || buf.readUInt32LE(0) !== 0x04034b50) return null;
  return { csv: csvDoZip(buf), bytes: buf.length };
}

const ESTparaUTC = 5 * 3_600_000;

/** "20240102 170000;147.1;147.2;147.0;147.1;0" → vela de 1 minuto em ms UTC. */
function lerCsv(csv, destino) {
  for (const linha of csv.split('\n')) {
    const c = linha.trim().split(';');
    if (c.length < 5 || c[0].length < 15) continue;
    const d = c[0];
    const t =
      Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +d.slice(9, 11), +d.slice(11, 13), +d.slice(13, 15)) +
      ESTparaUTC;
    destino.push({ time: t, open: +c[1], high: +c[2], low: +c[3], close: +c[4] });
  }
}

function agregar(minutos, passo) {
  const out = [];
  for (const m of minutos) {
    const chave = m.time - (m.time % passo);
    const u = out[out.length - 1];
    if (u && u.time === chave) {
      u.high = Math.max(u.high, m.high);
      u.low = Math.min(u.low, m.low);
      u.close = m.close;
      u.volume++;
    } else {
      out.push({ time: chave, open: m.open, high: m.high, low: m.low, close: m.close, volume: 1 });
    }
  }
  return out;
}

let totalBytes = 0;
for (const par of pares) {
  const minutos = [];
  const pedidos = [];
  for (let ano = desde; ano < anoActual; ano++) pedidos.push([ano, null]);
  for (let mes = 1; mes <= 12; mes++) pedidos.push([anoActual, mes]);

  for (const [ano, mes] of pedidos) {
    try {
      const f = await baixar(par, ano, mes);
      if (!f) {
        if (mes) break; // os meses seguintes também ainda não existem
        console.log(`  ${par} ${ano}: não disponível`);
        continue;
      }
      totalBytes += f.bytes;
      const antes = minutos.length;
      lerCsv(f.csv, minutos);
      console.log(`  ${par} ${ano}${mes ? `-${String(mes).padStart(2, '0')}` : ''}: ${minutos.length - antes} minutos (${(f.bytes / 1e6).toFixed(1)} MB)`);
    } catch (e) {
      console.log(`  ${par} ${ano}${mes ? `-${mes}` : ''}: falhou (${e instanceof Error ? e.message : e})`);
    }
    await pausa(1500);
  }

  minutos.sort((a, b) => a.time - b.time);
  const unicos = minutos.filter((m, k) => k === 0 || m.time !== minutos[k - 1].time);
  for (const tf of tfs) {
    const velas = agregar(unicos, PASSOS[tf]);
    const ficheiro = join(DESTINO, `${par}_${tf}.json`);
    if (!forcar && existsSync(ficheiro) && velas.length > 0) {
      try {
        const antigo = JSON.parse(readFileSync(ficheiro, 'utf8'));
        if (antigo.length > 0 && antigo[0].time < velas[0].time) {
          console.log(`${par} ${tf}: já existe com história desde ${new Date(antigo[0].time).toISOString().slice(0, 10)} — mantido (--forcar para substituir)`);
          continue;
        }
      } catch {
        /* ficheiro ilegível: substitui-se */
      }
    }
    writeFileSync(ficheiro, JSON.stringify(velas));
    console.log(
      `${par} ${tf}: ${velas.length} velas, ${velas.length ? new Date(velas[0].time).toISOString().slice(0, 10) : '-'} → ${velas.length ? new Date(velas[velas.length - 1].time).toISOString().slice(0, 10) : '-'}`,
    );
  }
}
console.log(`\ntotal descarregado: ${(totalBytes / 1e6).toFixed(1)} MB`);
