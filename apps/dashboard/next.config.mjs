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

export default nextConfig;
