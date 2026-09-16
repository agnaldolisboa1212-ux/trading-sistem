/**
 * Estado de carregamento da página de detalhe.
 *
 * A análise faz várias chamadas de rede e leva 2-5s. Sem isto, tocar num
 * símbolo no radar não daria retorno nenhum durante segundos — no telemóvel
 * isso lê-se como "a aplicação não respondeu" e leva a segundo toque.
 */
export default function Loading() {
  return (
    <div className="wrap">
      <div className="skeleton" style={{ height: 20, width: 140, marginBottom: 20 }} />
      <div className="skeleton" style={{ height: 28, width: '60%', marginBottom: 10 }} />
      <div className="skeleton" style={{ height: 14, width: '85%', marginBottom: 28 }} />
      <div className="skeleton" style={{ height: 12, width: 120, marginBottom: 12 }} />
      <div className="skeleton" style={{ height: 420, marginBottom: 28 }} />
      <div className="skeleton" style={{ height: 12, width: 160, marginBottom: 12 }} />
      <div className="skeleton" style={{ height: 300 }} />
      <p className="faint" style={{ marginTop: 20, textAlign: 'center' }}>
        A carregar velas e a correr a análise MMXM + SMT…
      </p>
    </div>
  );
}
