/**
 * Códigos da Deriv que TÊM equivalente no universo MMXM.
 *
 * `US100` e `NQ` são o mesmo mercado com contratos diferentes (índice à vista
 * contra futuro). Os preços não coincidem — e é por isso que nunca se misturam
 * na mesma série, nem se desenham os níveis de um no gráfico do outro — mas a
 * ESTRUTURA é a mesma, por isso a análise MMXM do futuro aplica-se ao índice.
 */
export const EQUIVALENTE_MMXM: Readonly<Record<string, string>> = Object.freeze({
  US100: 'NQ',
  SP500: 'ES',
  US30: 'YM',
});

export function alvoMmxm(codigo: string): string {
  const c = codigo.toUpperCase();
  return EQUIVALENTE_MMXM[c] ?? c;
}
