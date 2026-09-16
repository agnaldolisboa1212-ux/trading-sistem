/**
 * Reexporta o catalogo de simbolos da Deriv.
 *
 * A tabela vive em `packages/data/src/deriv-simbolos.ts` porque o motor de tempo
 * real tambem a usa. Este ficheiro fica para que os componentes continuem a
 * importar de `@/lib/deriv/simbolos` sem mudar nada.
 *
 * Importa o SUBCAMINHO e nao `@trading/data`: o indice do pacote traz consigo os
 * providers de rede, que nao tem lugar num bundle de browser.
 */

export * from '@trading/data/deriv-simbolos';
