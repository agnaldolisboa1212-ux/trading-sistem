/**
 * Financeiro: o que as estratégias ACTIVAS realmente produziram.
 *
 * ── PORQUE MUDOU ───────────────────────────────────────────────────────────
 *
 * Esta página simulava uma conta de papel a partir dos sinais do motor MMXM
 * diário — posições, preenchimentos e uma curva de capital que nunca
 * corresponderam a dinheiro nenhum, e que já não tinham ligação com o que o
 * sistema realmente anuncia (`sinais_tempo_real`, as estratégias validadas e
 * em teste).
 *
 * Duas camadas, agora:
 *
 *   1. SISTEMA — "Resultado acumulado" mede TODOS os sinais gerados, como
 *      referência macro de como as estratégias activas estão a sair.
 *   2. PESSOAL — `FinanceiroContas` deixa marcar, sinal a sinal, quais foram
 *      REALMENTE negociados (a pessoa só entra nalguns, com o toque manual no
 *      terminal), por conta — uma pessoa pode ter várias, uma por corretora.
 *      Só o marcado entra no desempenho pessoal e na curva de capital dessa
 *      conta (migrações 0009 e 0010).
 *
 * As métricas continuam expostas em **R** (múltiplos de risco), não em euros:
 * é a unidade correcta para avaliar uma estratégia, independente do tamanho
 * da conta.
 */

import Link from 'next/link';
import { FinanceiroContas } from '@/components/FinanceiroContas';
import { EstatisticasCard } from '@/components/EstatisticasCard';
import { calcularEstatisticas } from '@/lib/desempenho';
import { estrategiaActiva, estrategiaEmTeste } from '@trading/core';
import { fetchSinaisTempoReal, isConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const ABERTO = new Set(['a-aguardar-entrada', 'em-curso', 'protegida']);

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

  // Só estratégias activas (validadas e em teste). Os sinais das estratégias
  // antigas (oferta/procura, perfil de volume…) continuam na tabela mas já não
  // são acompanhados — ficariam para sempre "abertos" sem estado.
  const sinais = (await fetchSinaisTempoReal(1000)).filter((r) => estrategiaActiva(r.estrategia) !== undefined);
  const fechados = sinais.filter((r) => r.estado === 'fechada');
  const abertos = sinais.filter((r) => r.estado === null || ABERTO.has(r.estado));

  const validadas = fechados.filter((r) => estrategiaEmTeste(r.estrategia) === undefined);
  const emTeste = fechados.filter((r) => estrategiaEmTeste(r.estrategia) !== undefined);
  const estValidadas = calcularEstatisticas(validadas.map((r) => Number(r.resultado_r)).filter(Number.isFinite));
  const estEmTeste = calcularEstatisticas(emTeste.map((r) => Number(r.resultado_r)).filter(Number.isFinite));

  return (
    <div className="wrap">
      <Nav />

      <header className="top">
        <h1>Financeiro</h1>
        <p>
          {abertos.length} posição(ões) aberta(s) no sistema · {fechados.length} fechada(s) ·{' '}
          {emTeste.length} em teste
        </p>
      </header>

      <section>
        <h2>Resultado acumulado do sistema — estratégias validadas</h2>
        <p className="section-cap">
          TODOS os sinais gerados, negociados ou não — a referência macro de como as estratégias
          activas estão a sair. Para o SEU desempenho real, veja "Desempenho pessoal" abaixo.
        </p>
        <EstatisticasCard e={estValidadas} />
      </section>

      {estEmTeste.n > 0 && (
        <section>
          <h2>Resultado acumulado do sistema — em teste ao vivo</h2>
          <p className="section-cap">
            Sem taxa de acerto medida no backtest: é exactamente para medir isto ao vivo que estas
            operações contam à parte.
          </p>
          <EstatisticasCard e={estEmTeste} />
        </section>
      )}

      <section>
        <h2>As minhas contas</h2>
        <p className="section-cap">
          Marque, nas tabelas abaixo, os sinais que realmente negociou — numa conta (pode ter
          várias, uma por corretora). Só o marcado entra no desempenho pessoal e na curva de
          capital dessa conta.
        </p>
        <FinanceiroContas sinais={sinais} />
      </section>

      <footer className="note">
        Nenhuma ordem é enviada sem um toque seu: os sinais do sistema acima são os anunciados
        pelo motor; o desempenho pessoal é só o que marcou como negociado.
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
