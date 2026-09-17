/**
 * Financeiro: o que as estratégias ACTIVAS realmente produziram.
 *
 * ── PORQUE MUDOU ───────────────────────────────────────────────────────────
 *
 * Esta página simulava uma conta de papel a partir dos sinais do motor MMXM
 * diário — posições, preenchimentos e uma curva de capital que nunca
 * corresponderam a dinheiro nenhum, e que já não tinham ligação com o que o
 * sistema realmente anuncia (`sinais_tempo_real`, as estratégias validadas e
 * em teste). Agora lê directamente essa tabela: é o mesmo log que a
 * `ListaSinais` do Início mostra, só que completo e com o resultado de cada
 * operação já fechada.
 *
 * As métricas continuam expostas em **R** (múltiplos de risco), não em euros:
 * é a unidade correcta para avaliar uma estratégia, independente do tamanho
 * da conta. O saldo REAL — esse depende de quanto se arriscou por operação,
 * uma decisão de cada pessoa — vive à parte, na curva de capital manual.
 */

import Link from 'next/link';
import { DesempenhoAgrupado, type Grupo } from '@/components/DesempenhoAgrupado';
import { CurvaDeCapital } from '@/components/CurvaDeCapital';
import { RDistribution } from '@/components/FinanceCharts';
import { estrategiaActiva, estrategiaEmTeste } from '@trading/core';
import { acharSimbolo } from '@/lib/deriv/simbolos';
import { fetchSinaisTempoReal, isConfigured, type SinalTempoRealRow } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const ABERTO = new Set(['a-aguardar-entrada', 'em-curso', 'protegida']);
const FECHADO_MOTIVO: Record<string, string> = {
  fechada: '',
  expirado: 'expirado · sem tocar na entrada',
  perdido: 'foi para o alvo sem tocar na entrada',
};

function nomeEstrategia(id: string): string {
  return estrategiaActiva(id)?.nome ?? id;
}

function when(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function preco(simbolo: string, valor: number): string {
  return valor.toFixed(acharSimbolo(simbolo)?.casas ?? 5);
}

/** Fechada com ganho, fechada com perda, ou nunca chegou a abrir (expirado/perdido). */
function aberto(r: SinalTempoRealRow): boolean {
  return r.estado === null || ABERTO.has(r.estado);
}
function fechado(r: SinalTempoRealRow): boolean {
  return r.estado === 'fechada';
}

interface Estatisticas {
  n: number;
  totalR: number;
  winRate: number;
  avgWin: number;
  expectancy: number;
  best: number;
  concentration: number;
}

function calcularEstatisticas(rValues: number[]): Estatisticas {
  const totalR = rValues.reduce((a, b) => a + b, 0);
  const wins = rValues.filter((r) => r > 0.05);
  const winRate = rValues.length > 0 ? wins.length / rValues.length : 0;
  const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const expectancy = rValues.length > 0 ? winRate * avgWin - (1 - winRate) : 0;
  const best = rValues.length > 0 ? Math.max(...rValues) : 0;
  const concentration = totalR > 0 ? best / totalR : 0;
  return { n: rValues.length, totalR, winRate, avgWin, expectancy, best, concentration };
}

function agrupar(fechados: SinalTempoRealRow[], campo: 'simbolo' | 'timeframe' | 'estrategia'): Grupo[] {
  const mapa = new Map<string, { n: number; vitorias: number; totalR: number; emTeste: Set<boolean> }>();
  for (const r of fechados) {
    if (r.resultado_r === null) continue;
    const chave =
      campo === 'estrategia' ? nomeEstrategia(r.estrategia) : campo === 'timeframe' ? r.timeframe.toUpperCase() : r.simbolo;
    const g = mapa.get(chave) ?? { n: 0, vitorias: 0, totalR: 0, emTeste: new Set<boolean>() };
    g.n += 1;
    if (r.resultado_r > 0.05) g.vitorias += 1;
    g.totalR += r.resultado_r;
    g.emTeste.add(estrategiaEmTeste(r.estrategia) !== undefined);
    mapa.set(chave, g);
  }
  return [...mapa.entries()]
    .map(([chave, g]) => ({
      chave,
      n: g.n,
      vitorias: g.vitorias,
      totalR: g.totalR,
      mediaR: g.totalR / g.n,
      emTeste: g.emTeste.size === 1 && g.emTeste.has(true),
    }))
    .sort((a, b) => b.totalR - a.totalR);
}

export default async function Page() {
  if (!isConfigured) {
    return (
      <div className="wrap">
        <Nav />
        <div className="setup">
          <p>
            O financeiro precisa do Supabase — é lá que o motor de tempo real grava cada sinal e o
            seu resultado.
          </p>
        </div>
      </div>
    );
  }

  const sinais = await fetchSinaisTempoReal(1000);
  const fechados = sinais.filter(fechado);
  const abertos = sinais.filter(aberto);
  const historico = sinais.filter((r) => r.estado === 'fechada' || r.estado === 'expirado' || r.estado === 'perdido');

  const validadas = fechados.filter((r) => estrategiaEmTeste(r.estrategia) === undefined);
  const emTeste = fechados.filter((r) => estrategiaEmTeste(r.estrategia) !== undefined);

  const estValidadas = calcularEstatisticas(validadas.map((r) => Number(r.resultado_r)).filter(Number.isFinite));
  const estEmTeste = calcularEstatisticas(emTeste.map((r) => Number(r.resultado_r)).filter(Number.isFinite));
  const todosRValues = fechados.map((r) => Number(r.resultado_r)).filter(Number.isFinite);

  const porPar = agrupar(fechados, 'simbolo');
  const porTimeframe = agrupar(fechados, 'timeframe');
  const porEstrategia = agrupar(fechados, 'estrategia');

  return (
    <div className="wrap">
      <Nav />

      <header className="top">
        <h1>Financeiro</h1>
        <p>
          {abertos.length} posição(ões) aberta(s) · {fechados.length} fechada(s) · {emTeste.length} em teste
        </p>
      </header>

      <section>
        <h2>Resultado acumulado — estratégias validadas</h2>
        <EstatisticasCard e={estValidadas} />
      </section>

      {estEmTeste.n > 0 && (
        <section>
          <h2>Resultado acumulado — em teste ao vivo</h2>
          <p className="section-cap">
            Sem taxa de acerto medida no backtest: é exactamente para medir isto ao vivo que estas
            operações contam à parte.
          </p>
          <EstatisticasCard e={estEmTeste} />
        </section>
      )}

      <section>
        <h2>Desempenho por par, timeframe e estratégia</h2>
        <p className="section-cap">Ordenado pelo R total — o mais lucrativo primeiro.</p>
        <DesempenhoAgrupado porPar={porPar} porTimeframe={porTimeframe} porEstrategia={porEstrategia} />
      </section>

      <section>
        <h2>Distribuição dos resultados (R por operação)</h2>
        <div className="card pad-chart">
          <RDistribution values={todosRValues} />
        </div>
        <p className="faint" style={{ fontSize: 12, padding: '0 8px' }}>
          Alvos de 5R–10R vivem da cauda direita: a maioria das operações perde 1R e um punhado
          paga tudo. Se a cauda não existir, a estratégia não funciona por muito boa que a taxa de
          acerto pareça.
        </p>
      </section>

      <section>
        <h2>Curva de capital</h2>
        <p className="section-cap">
          O saldo real da conta — as ordens só saem com um toque manual no terminal, por isso não há
          execução automática de que derivar isto. Registe quando quiser.
        </p>
        <CurvaDeCapital />
      </section>

      <section>
        <h2>Posições abertas ({abertos.length})</h2>
        {abertos.length === 0 ? (
          <div className="empty">Nenhuma posição aberta.</div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Símbolo</th>
                  <th>Estratégia</th>
                  <th>Lado</th>
                  <th>Gerado</th>
                  <th className="num">Entrada</th>
                  <th className="num">Stop actual</th>
                </tr>
              </thead>
              <tbody>
                {abertos.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/grafico?s=${encodeURIComponent(r.simbolo)}&tf=${r.timeframe}`} className="row-link">
                        {r.simbolo} · {r.timeframe.toUpperCase()}
                      </Link>
                    </td>
                    <td className="dim">
                      {nomeEstrategia(r.estrategia)}
                      {estrategiaEmTeste(r.estrategia) && <span className="selo-em-teste" style={{ marginLeft: 6 }}>EM TESTE</span>}
                    </td>
                    <td className={r.direccao === 'bullish' ? 'bull-t' : 'bear-t'}>
                      {r.direccao === 'bullish' ? 'COMPRA' : 'VENDA'}
                    </td>
                    <td className="dim">{when(r.gerado_em)}</td>
                    <td className="num">{preco(r.simbolo, r.entrada)}</td>
                    <td className="num">{preco(r.simbolo, r.stop_actual ?? r.stop)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2>Histórico ({historico.length})</h2>
        {historico.length === 0 ? (
          <div className="empty">
            Nenhuma operação fechada ainda. O histórico enche-se à medida que as entradas forem
            tocadas e as saídas dispararem.
          </div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Símbolo</th>
                  <th>Estratégia</th>
                  <th>Lado</th>
                  <th>Gerado</th>
                  <th className="num">Resultado</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {historico.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/grafico?s=${encodeURIComponent(r.simbolo)}&tf=${r.timeframe}`} className="row-link">
                        {r.simbolo} · {r.timeframe.toUpperCase()}
                      </Link>
                    </td>
                    <td className="dim">
                      {nomeEstrategia(r.estrategia)}
                      {estrategiaEmTeste(r.estrategia) && <span className="selo-em-teste" style={{ marginLeft: 6 }}>EM TESTE</span>}
                    </td>
                    <td className={r.direccao === 'bullish' ? 'bull-t' : 'bear-t'}>
                      {r.direccao === 'bullish' ? 'COMPRA' : 'VENDA'}
                    </td>
                    <td className="dim">{when(r.gerado_em)}</td>
                    <td className={`num ${r.estado === 'fechada' && (r.resultado_r ?? 0) >= 0 ? 'bull-t' : r.estado === 'fechada' ? 'bear-t' : 'dim'}`}>
                      {r.estado === 'fechada' && r.resultado_r !== null
                        ? `${r.resultado_r >= 0 ? '+' : ''}${r.resultado_r.toFixed(2)}R`
                        : '—'}
                    </td>
                    <td className="dim">{FECHADO_MOTIVO[r.estado ?? ''] ?? r.estado ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="note">
        Nenhuma ordem é enviada sem um toque seu: os resultados acima são os das operações
        realmente sinalizadas, com o preenchimento no fecho da vela do sinal.
      </footer>
    </div>
  );
}

function EstatisticasCard({ e }: { e: Estatisticas }) {
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
