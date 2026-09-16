import type { MetadataRoute } from 'next';

/**
 * Manifesto do PWA.
 *
 * O botao "Instalar" do Chrome so aparece quando TRES condicoes se verificam ao
 * mesmo tempo:
 *
 *   1. este manifesto, com `name`, `icons` de 192 e 512, `start_url` e
 *      `display: standalone`
 *   2. um service worker registado **com um handler de `fetch`** — sem esse
 *      handler o Chrome nao considera a app instalavel
 *   3. HTTPS (ou localhost, que conta como origem segura)
 *
 * Os icones `maskable` existem para o Android: sem eles o sistema desenha o
 * icone dentro de um quadrado branco em vez de o recortar no formato do
 * lancador.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Sistema de Trading — MMXM & SMT',
    short_name: 'Trading',
    description:
      'Sinais de swing trading com Market Maker Models, SMT Divergence e ligacao a conta Deriv.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#12170e',
    theme_color: '#12170e',
    categories: ['finance', 'business'],
    lang: 'pt',
    dir: 'ltr',
    icons: [
      { src: '/icones/icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icones/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icones/icone-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icones/icone-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      { name: 'Mercados', url: '/mercados', description: 'Precos ao vivo' },
      { name: 'Portfolio', url: '/portfolio', description: 'Indices e posicoes' },
      { name: 'Conta', url: '/conta', description: 'Saldo e operacoes' },
    ],
  };
}
