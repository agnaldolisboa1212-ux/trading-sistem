/**
 * O cartão de "resultado acumulado" — usado no Financeiro para o sistema
 * inteiro e, por conta, para o que a pessoa realmente marcou como negociado.
 */

import type { Estatisticas } from '@/lib/desempenho';

export function EstatisticasCard({ e }: { e: Estatisticas }) {
  return (
    <>
      <div className="card">
        <div className="kv">
          <div>
            <span>R total realizado</span>
            <strong className={e.totalR >= 0 ? 'bull-t' : 'bear-t'}>
              {e.totalR >= 0 ? '+' : ''}
              {e.totalR.toFixed(2)}R
            </strong>
          </div>
          <div>
            <span>Operações fechadas</span>
            <strong>{e.n}</strong>
          </div>
          <div>
            <span>Taxa de acerto</span>
            <strong>{e.n > 0 ? `${(e.winRate * 100).toFixed(0)}%` : '—'}</strong>
          </div>
          <div>
            <span>R médio ganho</span>
            <strong className="bull-t">{e.avgWin > 0 ? `+${e.avgWin.toFixed(2)}R` : '—'}</strong>
          </div>
          <div>
            <span>Expectativa</span>
            <strong className={e.expectancy >= 0 ? 'bull-t' : 'bear-t'}>
              {e.n > 0 ? `${e.expectancy >= 0 ? '+' : ''}${e.expectancy.toFixed(2)}R` : '—'}
            </strong>
          </div>
          <div>
            <span>Melhor operação</span>
            <strong className="bull-t">{e.best > 0 ? `+${e.best.toFixed(2)}R` : '—'}</strong>
          </div>
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
