/**
 * Financeiro: onde está o capital e o que a estratégia realmente produziu.
 *
 * As métricas são expostas em **R** (múltiplos de risco) e não em euros. É a
 * unidade correta para avaliar uma estratégia: independente do tamanho da conta
 * e do dimensionamento, permite comparar operações entre si e comparar o paper
 * com o backtest. O valor monetário depende de quanto se arriscou por operação,
 * que é uma decisão separada da qualidade dos sinais.
 */

import Link from 'next/link';
import { EquityChart, RDistribution, type EquityPoint } from '@/components/FinanceCharts';
import {
  fetchAccountSummary,
  fetchClosedPositions,
  fetchEquityCurve,
  fetchOpenPositions,
  isConfigured,
} from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const REASON_LABEL: Record<string, string> = {
  'target-hit': 'alvo atingido',
  'stop-hit': 'stop',
  'model-completed': 'modelo completo',
  'model-invalidated': 'modelo invalidado',
  'structure-broken': 'estrutura quebrada',
  'smt-reversed': 'SMT invertido',
  'time-stop': 'time stop',
};

function when(iso: string | null): string {
  return iso ? new Date(iso).toISOString().slice(0, 10) : '—';
}

export default async function Page() {
  if (!isConfigured) {
    return (
      <div className="wrap">
        <Nav />
        <div className="setup">
          <p>
            O financeiro precisa do Supabase — é lá que vive o histórico de posições. O snapshot
            local só guarda a fotografia do último varrimento.
          </p>
        </div>
      </div>
    );
  }

  const [summary, equity, closed, open] = await Promise.all([
    fetchAccountSummary(),
    fetchEquityCurve(),
    fetchClosedPositions(),
    fetchOpenPositions(),
  ]);

  const rValues = closed.map((p) => Number(p.realized_r)).filter(Number.isFinite);
  const totalR = rValues.reduce((a, b) => a + b, 0);
  const wins = rValues.filter((r) => r > 0.05);
  const losses = rValues.filter((r) => r < -0.05);
  const winRate = rValues.length > 0 ? wins.length / rValues.length : 0;
  const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const expectancy = rValues.length > 0 ? winRate * avgWin - (1 - winRate) : 0;

  /*
   * Concentração: que fatia do lucro vem da melhor operação. Foi esta métrica
   * que revelou, no backtest, que 81% do resultado vinha de um único negócio —
   * fica permanentemente à vista para o mesmo não passar despercebido no paper.
   */
  const best = rValues.length > 0 ? Math.max(...rValues) : 0;
  const concentration = totalR > 0 ? best / totalR : 0;

  const equityPoints: EquityPoint[] = equity.map((e) => ({
    t: Date.parse(e.taken_at),
    balance: Number(e.balance),
    openRisk: Number(e.open_risk),
  }));

  return (
    <div className="wrap">
      <Nav />

      <header className="top">
        <h1>Financeiro</h1>
        <p>
          {summary?.open_positions ?? open.length} posição(ões) aberta(s) ·{' '}
          {rValues.length} fechada(s) · {summary?.pending_signals ?? 0} sinal(is) pendente(s)
        </p>
      </header>

      <section>
        <h2>Resultado acumulado</h2>
        <div className="card">
          <div className="kv">
            <div>
              <span>R total realizado</span>
              <strong className={totalR >= 0 ? 'bull-t' : 'bear-t'}>
                {totalR >= 0 ? '+' : ''}
                {totalR.toFixed(2)}R
              </strong>
            </div>
            <div>
              <span>Operações fechadas</span>
              <strong>{rValues.length}</strong>
            </div>
            <div>
              <span>Taxa de acerto</span>
              <strong>{rValues.length > 0 ? `${(winRate * 100).toFixed(0)}%` : '—'}</strong>
            </div>
            <div>
              <span>R médio ganho</span>
              <strong className="bull-t">{avgWin > 0 ? `+${avgWin.toFixed(2)}R` : '—'}</strong>
            </div>
            <div>
              <span>Expectativa</span>
              <strong className={expectancy >= 0 ? 'bull-t' : 'bear-t'}>
                {rValues.length > 0 ? `${expectancy >= 0 ? '+' : ''}${expectancy.toFixed(2)}R` : '—'}
              </strong>
            </div>
            <div>
              <span>Melhor operação</span>
              <strong className="bull-t">{best > 0 ? `+${best.toFixed(2)}R` : '—'}</strong>
            </div>
          </div>
        </div>

        {rValues.length > 0 && concentration > 0.5 && (
          <div className="notice">
            <strong>Atenção à concentração.</strong> A melhor operação representa{' '}
            {(concentration * 100).toFixed(0)}% de todo o lucro acumulado. Quando um único
            resultado carrega a estratégia inteira, o que se está a medir é sorte, não vantagem —
            e a amostra ainda não diz nada sobre o futuro.
          </div>
        )}

        {rValues.length > 0 && rValues.length < 30 && (
          <div className="notice">
            <strong>Amostra insuficiente.</strong> {rValues.length} operação(ões) fechada(s). Abaixo
            de ~30 nenhuma destas métricas distingue estratégia de ruído.
          </div>
        )}
      </section>

      <section>
        <h2>Distribuição dos resultados (R por operação)</h2>
        <div className="card pad-chart">
          <RDistribution values={rValues} />
        </div>
        <p className="faint" style={{ fontSize: 12, padding: '0 8px' }}>
          Alvos de 5R–10R vivem da cauda direita: a maioria das operações perde 1R e um punhado
          paga tudo. Se a cauda não existir, a estratégia não funciona por muito boa que a taxa de
          acerto pareça.
        </p>
      </section>

      <section>
        <h2>Curva de capital</h2>
        <div className="card pad-chart">
          <EquityChart points={equityPoints} />
        </div>
      </section>

      <section>
        <h2>Posições abertas ({open.length})</h2>
        {open.length === 0 ? (
          <div className="empty">Nenhuma posição aberta.</div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Símbolo</th>
                  <th>Lado</th>
                  <th>Aberta</th>
                  <th className="num">Entrada</th>
                  <th className="num">Stop</th>
                  <th className="num">Restante</th>
                  <th className="num">R realizado</th>
                  <th className="num">R aberto</th>
                </tr>
              </thead>
              <tbody>
                {open.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/instrumento/${p.symbol}`} className="row-link">
                        {p.symbol}
                      </Link>
                    </td>
                    <td className={p.direction === 'bullish' ? 'bull-t' : 'bear-t'}>
                      {p.direction === 'bullish' ? 'COMPRA' : 'VENDA'}
                    </td>
                    <td className="dim">{when(p.opened_at)}</td>
                    <td className="num">{p.filled_price?.toFixed(5)}</td>
                    <td className="num">{p.current_stop?.toFixed(5)}</td>
                    <td className="num">{(p.remaining_fraction * 100).toFixed(0)}%</td>
                    <td className={`num ${p.realized_r >= 0 ? 'bull-t' : 'bear-t'}`}>
                      {p.realized_r >= 0 ? '+' : ''}
                      {Number(p.realized_r).toFixed(2)}R
                    </td>
                    <td className={`num ${p.unrealized_r >= 0 ? 'bull-t' : 'bear-t'}`}>
                      {p.unrealized_r >= 0 ? '+' : ''}
                      {Number(p.unrealized_r).toFixed(2)}R
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2>Histórico ({closed.length})</h2>
        {closed.length === 0 ? (
          <div className="empty">
            Nenhuma operação fechada ainda. O histórico enche-se à medida que os sinais forem
            preenchidos e as saídas dispararem.
          </div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Símbolo</th>
                  <th>Lado</th>
                  <th>Aberta</th>
                  <th>Fechada</th>
                  <th className="num">Entrada</th>
                  <th className="num">Resultado</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {closed.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/instrumento/${p.symbol}`} className="row-link">
                        {p.symbol}
                      </Link>
                    </td>
                    <td className={p.direction === 'bullish' ? 'bull-t' : 'bear-t'}>
                      {p.direction === 'bullish' ? 'COMPRA' : 'VENDA'}
                    </td>
                    <td className="dim">{when(p.opened_at)}</td>
                    <td className="dim">{when(p.closed_at)}</td>
                    <td className="num">{p.filled_price?.toFixed(5)}</td>
                    <td className={`num ${p.realized_r >= 0 ? 'bull-t' : 'bear-t'}`}>
                      {p.realized_r >= 0 ? '+' : ''}
                      {Number(p.realized_r).toFixed(2)}R
                    </td>
                    <td className="dim">
                      {REASON_LABEL[p.close_reason ?? ''] ?? p.close_reason ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="note">
        Modo <strong>paper</strong>: estas operações são simuladas a partir dos sinais do motor.
        Nenhuma ordem foi enviada a nenhuma corretora. Os preenchimentos assumem o pior preço da
        zona de entrada — assumir o melhor inflacionaria os resultados e tornaria a comparação com
        o backtest inútil.
      </footer>
    </div>
  );
}

function Nav() {
  return (
    <nav className="nav">
      <Link href="/">Radar</Link>
      <Link href="/financeiro" className="active">
        Financeiro
      </Link>
    </nav>
  );
}
