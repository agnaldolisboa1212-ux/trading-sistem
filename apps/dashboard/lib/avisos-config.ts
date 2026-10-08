/**
 * Configuração das notificações push de cada pessoa (coluna `avisos_config`,
 * migração 0013). Sem dependências: corre no servidor (filtro do envio) e no
 * browser (ecrã das Definições).
 */

/** Que tipo de aviso é — cada um liga-se e desliga-se nas Definições. */
export type TipoAviso = 'entrada' | 'alerta' | 'operacao';

export interface ConfigAvisos {
  /** Sinais de entrada das estratégias. */
  readonly entradas: boolean;
  /** Alertas de setup (ICT ALGO, Asia Range, venda no VWAP): a decisão é sua. */
  readonly alertas: boolean;
  /** Alvo, stop e saída por tempo de uma operação já anunciada. */
  readonly operacoes: boolean;
  /**
   * `portfolio`: só os instrumentos e timeframes do perfil. `tudo`: tudo o que
   * o motor anuncia (o mesmo que chega ao Telegram).
   */
  readonly ambito: 'portfolio' | 'tudo';
  /** O aviso fica no ecrã até lhe tocar, em vez de desaparecer sozinho. */
  readonly fixo: boolean;
  /** Sem som nem vibração. */
  readonly silencioso: boolean;
}

export const CONFIG_AVISOS_OMISSAO: ConfigAvisos = {
  entradas: true,
  alertas: true,
  operacoes: true,
  ambito: 'portfolio',
  fixo: false,
  silencioso: false,
};

/** Lê o JSON guardado, com a omissão para o que faltar ou vier mal. */
export function lerConfigAvisos(v: unknown): ConfigAvisos {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const bool = (k: keyof ConfigAvisos) =>
    typeof o[k] === 'boolean' ? (o[k] as boolean) : (CONFIG_AVISOS_OMISSAO[k] as boolean);
  return {
    entradas: bool('entradas'),
    alertas: bool('alertas'),
    operacoes: bool('operacoes'),
    ambito: o['ambito'] === 'tudo' ? 'tudo' : 'portfolio',
    fixo: bool('fixo'),
    silencioso: bool('silencioso'),
  };
}

/** Este tipo de aviso está ligado? Avisos sem tipo (testes, contas) passam sempre. */
export function tipoLigado(c: ConfigAvisos, tipo: TipoAviso | undefined): boolean {
  if (tipo === 'entrada') return c.entradas;
  if (tipo === 'alerta') return c.alertas;
  if (tipo === 'operacao') return c.operacoes;
  return true;
}
