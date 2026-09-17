/**
 * O que aconteceu a um plano de entrada desde que foi anunciado.
 *
 * A lógica vive em `@trading/core` (`signal/estado-plano.ts`), porque o motor
 * precisa exactamente da mesma leitura para não repintar sinais e para avisar
 * do andamento das operações. Este ficheiro fica para os componentes não
 * mudarem de import.
 */

export {
  estadoDoPlano,
  planoInvalidado,
  planoVivo,
  ROTULO_PLANO,
  VELAS_ATE_EXPIRAR,
  type EstadoPlano,
  type Plano,
  type VelaMinima,
} from '@trading/core';
