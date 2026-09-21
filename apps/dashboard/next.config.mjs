/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // O dashboard é apenas leitura: revalida a cada minuto em vez de manter
  // ligação viva, o que o torna barato de alojar em qualquer plano gratuito.
  experimental: {
    staleTimes: { dynamic: 60 },
    /*
     * Processos auxiliares do `next build` ("Collecting page data" e páginas
     * estáticas). Por omissão são tantos quantos os CPUs da máquina menos um — num
     * alojamento partilhado a máquina anuncia dezenas, a conta tem um limite de
     * processos, e o build morria com `spawn node EAGAIN`. Com 10 páginas
     * estáticas um só chega. O workerThreads desativa por completo as novas threads para builds pesados.
     */
    cpus: 1,
    workerThreads: false,
  },
  /*
   * Os pacotes do monorepo sao ESM ja compilados, mas o Next precisa de saber
   * que pode transpila-los — sem isto o `import` deles a partir de um Server
   * Component falha na resolucao dos subcaminhos `.js`.
   */
  transpilePackages: ['@trading/core', '@trading/data'],
  /*
   * O indicador de desenvolvimento do Next fica por cima do primeiro item da
   * navegacao inferior, que esta no mesmo canto. Nao afeta producao, mas
   * escondia o botao "Inicio" durante o desenvolvimento.
   */
  devIndicators: false,
  /*
   * Cabeçalhos de segurança em todas as respostas:
   *   X-Frame-Options      a app não abre dentro de um iframe de outro site
   *                        (clickjacking: botões de "comprar" por baixo de um
   *                        botão falso)
   *   nosniff              o browser não adivinha tipos de ficheiro
   *   Referrer-Policy      URLs internos não vazam para sites externos
   *   Permissions-Policy   câmara, microfone e localização desligados
   *   HSTS                 só HTTPS, durante um ano
   */
  async headers() {
    return [
      {
        source: '/:caminho*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ];
  },
};

/*
 * Onde fica a compilacao. Em producao numa pasta SEM ponto no nome: a Hostinger
 * compila numa pasta e arranca a aplicacao a partir de uma copia, e o `.next`
 * nao chegava a essa copia (o arranque dizia "falta apps/dashboard/.next").
 * Em desenvolvimento fica o `.next` de sempre.
 *
 * O `server.js` da raiz procura `compilado/BUILD_ID` — mudar aqui obriga a
 * mudar la.
 */
const PASTA_PRODUCAO = 'saida';

// A constante e PHASE_DEVELOPMENT_SERVER de `next/constants`; comparada como
// texto para nao depender da interoperabilidade CommonJS desse modulo.
export default function config(fase) {
  return {
    ...nextConfig,
    distDir: fase === 'phase-development-server' ? '.next' : PASTA_PRODUCAO,
  };
}
