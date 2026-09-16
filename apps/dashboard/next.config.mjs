/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // O dashboard é apenas leitura: revalida a cada minuto em vez de manter
  // ligação viva, o que o torna barato de alojar em qualquer plano gratuito.
  experimental: { staleTimes: { dynamic: 60 } },
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
const PASTA_PRODUCAO = 'compilado';

// A constante e PHASE_DEVELOPMENT_SERVER de `next/constants`; comparada como
// texto para nao depender da interoperabilidade CommonJS desse modulo.
export default function config(fase) {
  return {
    ...nextConfig,
    distDir: fase === 'phase-development-server' ? '.next' : PASTA_PRODUCAO,
  };
}
