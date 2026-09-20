/**
 * O cartão de "resultado acumulado" — usado no Financeiro para o sistema
 * inteiro e, por conta, para o que a pessoa realmente marcou como negociado.
 */

import type { Estatisticas } from '@/lib/desempenho';

export function EstatisticasCard({ e }: { e: Estatisticas }) {
  return (
    <>
      <div className="metrics-grid">
        <div className={`metric-card ${e.totalR > 0 ? 'positive' : e.totalR < 0 ? 'negative' : ''}`}>
          <div className="m-label">R total realizado</div>
          <div className={`m-value ${e.totalR >= 0 ? 'bull-t' : 'bear-t'}`}>
            {e.totalR >= 0 ? '+' : ''}{e.totalR.toFixed(2)}R
          </div>
        </div>
        <div className="metric-card">
          <div className="m-label">Op. fechadas</div>
          <div className="m-value">{e.n}</div>
        </div>
        <div className="metric-card">
          <div className="m-label">Taxa de acerto</div>
          <div className="m-value">{e.n > 0 ? `${(e.winRate * 100).toFixed(0)}%` : '—'}</div>
        </div>
        <div className="metric-card">
          <div className="m-label">R médio ganho</div>
          <div className="m-value bull-t">{e.avgWin > 0 ? `+${e.avgWin.toFixed(2)}R` : '—'}</div>
        </div>
        <div className={`metric-card ${e.expectancy > 0 ? 'positive' : e.expectancy < 0 ? 'negative' : ''}`}>
          <div className="m-label">Expectativa</div>
          <div className={`m-value ${e.expectancy >= 0 ? 'bull-t' : 'bear-t'}`}>
            {e.n > 0 ? `${e.expectancy >= 0 ? '+' : ''}${e.expectancy.toFixed(2)}R` : '—'}
          </div>
        </div>
        <div className="metric-card">
          <div className="m-label">Melhor operação</div>
          <div className="m-value bull-t">{e.best > 0 ? `+${e.best.toFixed(2)}R` : '—'}</div>
        </div>
      </div>

      {e.n > 0 && e.concentration > 0.5 && (
        <div className="notice">
          <strong>Atenção à concentração.</strong> A melhor operação representa{' '}
          {(e.concentration * 100).toFixed(0)}% de todo o lucro acumulado. Quando um único
          resultado carrega a estratégia inteira, o que se está a medir é sorte, não vantagem — e a
          amostra ainda não diz nada sobre o futuro.
        </div>
      )}

      {e.n > 0 && e.n < 30 && (
        <div className="notice">
          <strong>Amostra insuficiente.</strong> {e.n} operação(ões) fechada(s). Abaixo de ~30
          nenhuma destas métricas distingue estratégia de ruído.
        </div>
      )}
    </>
  );
}
