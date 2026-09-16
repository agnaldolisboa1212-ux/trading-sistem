/**
 * Gera os icones do PWA sem dependencias de imagem.
 *
 * PORQUE ASSIM: instalar `sharp` ou `canvas` para desenhar quatro quadrados e
 * uma seta traria binarios nativos de dezenas de megabytes a um projeto que nao
 * processa imagens em mais lado nenhum. Um PNG e, no fundo, um cabecalho fixo,
 * linhas de pixeis prefixadas por um byte de filtro, e um `deflate` — coisas
 * que o `node:zlib` ja sabe fazer.
 *
 * Desenha-se o icone em memoria como RGBA e escreve-se. O resultado e
 * determinista: correr outra vez produz ficheiros identicos, por isso nao ha
 * ruido no controlo de versoes.
 *
 * Uso: node scripts/gerar-icones.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DESTINO = join(process.cwd(), 'apps', 'dashboard', 'public', 'icones');

/** Paleta — a mesma do tema escuro da aplicacao. */
const FUNDO = [18, 23, 14, 255];
const LIMA = [200, 242, 52, 255];
const LIMA_ESCURO = [160, 200, 40, 255];

function crc32(buf) {
  let c;
  const tabela = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = tabela[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pedaco(tipo, dados) {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([tamanho, corpo, crc]);
}

/** RGBA cru -> PNG. */
function png(largura, altura, pixeis) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Cada linha leva um byte de filtro a frente. Filtro 0 = nenhum.
  const linhas = Buffer.alloc(altura * (largura * 4 + 1));
  for (let y = 0; y < altura; y++) {
    const inicio = y * (largura * 4 + 1);
    linhas[inicio] = 0;
    pixeis.copy(linhas, inicio + 1, y * largura * 4, (y + 1) * largura * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pedaco('IHDR', ihdr),
    pedaco('IDAT', deflateSync(linhas, { level: 9 })),
    pedaco('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Desenha o icone: fundo escuro com cantos arredondados e tres velas a subir.
 *
 * `maskable` significa que o sistema pode cortar o icone num circulo, por isso
 * o desenho vive dentro dos 80% centrais — a "zona segura" da especificacao.
 */
function desenhar(tamanho, maskable) {
  const p = Buffer.alloc(tamanho * tamanho * 4);
  const raio = maskable ? 0 : tamanho * 0.22;
  const escala = maskable ? 0.62 : 0.74;

  const por = (x, y, cor) => {
    if (x < 0 || y < 0 || x >= tamanho || y >= tamanho) return;
    const i = (y * tamanho + x) * 4;
    p[i] = cor[0];
    p[i + 1] = cor[1];
    p[i + 2] = cor[2];
    p[i + 3] = cor[3];
  };

  // Fundo, com cantos arredondados quando nao e maskable.
  for (let y = 0; y < tamanho; y++) {
    for (let x = 0; x < tamanho; x++) {
      let dentro = true;
      if (raio > 0) {
        const dx = Math.max(raio - x, 0, x - (tamanho - raio - 1));
        const dy = Math.max(raio - y, 0, y - (tamanho - raio - 1));
        dentro = dx * dx + dy * dy <= raio * raio;
      }
      por(x, y, dentro ? FUNDO : [0, 0, 0, 0]);
    }
  }

  // Tres velas a subir, centradas.
  const centro = tamanho / 2;
  const largura = tamanho * escala;
  const esquerda = centro - largura / 2;
  const larguraVela = largura / 5;
  const espaco = larguraVela / 2;

  const velas = [
    { base: 0.62, topo: 0.44, mecha: [0.68, 0.38] },
    { base: 0.52, topo: 0.3, mecha: [0.58, 0.24] },
    { base: 0.4, topo: 0.16, mecha: [0.46, 0.1] },
  ];

  velas.forEach((v, i) => {
    const x0 = Math.round(esquerda + i * (larguraVela + espaco));
    const x1 = Math.round(x0 + larguraVela);
    const yBase = Math.round(tamanho * v.base);
    const yTopo = Math.round(tamanho * v.topo);
    const cor = i === 2 ? LIMA : LIMA_ESCURO;

    // Mecha
    const xm = Math.round((x0 + x1) / 2);
    const grossura = Math.max(1, Math.round(tamanho * 0.012));
    for (let y = Math.round(tamanho * v.mecha[1]); y < Math.round(tamanho * v.mecha[0]); y++) {
      for (let d = -grossura; d <= grossura; d++) por(xm + d, y, cor);
    }

    // Corpo
    for (let y = yTopo; y < yBase; y++) for (let x = x0; x < x1; x++) por(x, y, cor);
  });

  return png(tamanho, tamanho, p);
}

mkdirSync(DESTINO, { recursive: true });

const ficheiros = [
  ['icone-192.png', 192, false],
  ['icone-512.png', 512, false],
  ['icone-maskable-192.png', 192, true],
  ['icone-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, false],
];

for (const [nome, tamanho, maskable] of ficheiros) {
  const buf = desenhar(tamanho, maskable);
  writeFileSync(join(DESTINO, nome), buf);
  console.log(`${nome.padEnd(28)} ${tamanho}x${tamanho}  ${(buf.length / 1024).toFixed(1)} kB`);
}
