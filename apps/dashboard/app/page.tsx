/**
 * Início — o ecrã que responde a "o que está a acontecer agora?".
 *
 * ── ORDEM, E PORQUÊ ────────────────────────────────────────────────────────
 *
 *   1. saldo da conta      — o número que a pessoa abriu a app para ver
 *   2. fita de preços      — prova, em movimento, que o sistema está vivo
 *   3. agentes a analisar  — o trabalho a acontecer, instrumento por instrumento
 *   4. sinais              — conclusões, quando existem
 *   5. radar do varrimento — o estado do último passe do motor
 *
 * O saldo vem primeiro porque foi pedido explicitamente: depois de ligar a
 * Deriv não deve ser preciso entrar no separador financeiro para o ver. Antes
 * daqui estava um "progresso médio do checklist" de 0-100% no lugar mais
 * visível do ecrã — uma métrica interna onde se esperava dinheiro.
 *
 * ── O QUE É SERVIDOR E O QUE É CLIENTE ─────────────────────────────────────
 *
 * Esta página é um Server Component: lê o snapshot/Supabase uma vez e envia
 * HTML. Tudo o que se mexe ao segundo (saldo, preços, análise ao vivo) são
 * ilhas de cliente que se ligam sozinhas depois. Assim o primeiro ecrã pinta
 * sem esperar por WebSocket nenhum, e nada do que se mexe bloqueia a pintura.
 */

import Link from 'next/link';
import { CartaoSaldo } from '@/components/vivo/CartaoSaldo';
import { Fita } from '@/components/vivo/Fita';
import { PainelAgentes } from '@/components/vivo/PainelAgentes';
import { PainelMotores } from '@/components/vivo/PainelMotores';
import { Ligacao } from '@/components/vivo/Preco';
import { Sparkline, formaDoProgresso } from '@/components/Sparkline';
import { loadDashboardData } from '@/lib/data';
import { lerPreferenciasServidor } from '@/lib/preferencias-servidor';
import type { DiagnosticRow, SignalRow } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const PHASE_LABEL: Record<string, string> = {
  'original-consolidation': 'consolidação',
  'left-curve': 'curva esquerda',
  'smart-money-reversal': 'Smart Money Reversal',
  'right-curve-low-risk-entry': 'Low Risk Entry',
  'right-curve-stage-1': '1ª Acc/Dist',
  'right-curve-silver-bullet': 'Silver Bullet',
  completed: 'completo',
  invalidated: 'invalidado',
};

const STEP_LABEL: Record<number, string> = {
  1: 'draw on liquidity',
  2: 'fluxo HTF',
  3: 'point of interest',
  4: 'Time & Price',
  5: 'SMT divergence',
  6: 'CISD / MSS',
  7: 'modelo de entrada',
  8: 'invalidação',
  9: 'alvos',
};

/** "Agnaldo Lisboa" → "AL". Cada conta vê as suas, e não um "A" igual para todos. */
function iniciais(nome: string | null): string {
  const partes = (nome ?? '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '·';
  const primeira = partes[0]!.charAt(0);
  const ultima = partes.length > 1 ? partes[partes.length - 1]!.charAt(0) : '';
  return (primeira + ultima).toUpperCase();
}

export default async function Page() {
  const [data, prefs] = await Promise.all([loadDashboardData(), lerPreferenciasServidor()]);

  const diagnosticos =
    data.source === 'none'
      ? []
      : [...data.diagnostics].sort((a, b) => b.checklist_score - a.checklist_score);

  const melhor = diagnosticos[0];
  const sinais = data.source === 'none' ? [] : data.signals;

  return (
    <div className="wrap">
      <div className="cabeca">
        <Link href="/definicoes" className="cabeca__avatar" aria-label="Conta e definições">
          {iniciais(prefs.nome)}
        </Link>
        <div className="cabeca__id">
          <p className="cabeca__saudacao">{prefs.nome ? `Olá, ${prefs.nome}` : 'Bem-vindo'}</p>
          <h1>{prefs.objetivoRotulo ?? 'Sistema de Trading'}</h1>
        </div>
        <Ligacao rotulo={false} />
      </div>

      <CartaoSaldo nome={prefs.nome} />

      <section>
        <div className="section-head">
          <h2>Ao vivo</h2>
          <span className="grow" />
          <Link href="/mercados">mercados</Link>
        </div>
        <Fita simbolos={prefs.instrumentos} />
      </section>

      {/*
        O painel de agentes é o coração do pedido "nada estático". Corre a
        análise real, um instrumento de cada vez, contra os mercados que a
        pessoa escolheu no onboarding — e mostra o progresso enquanto trabalha.
      */}
      {/*
        Os motores correm num processo à parte. Este painel diz se estão vivos e
        mostra o que o de tempo real anunciou — atualiza sozinho.
      */}
      <PainelMotores />

      <PainelAgentes simbolos={prefs.instrumentos} timeframe={prefs.timeframe} />

      <Sinais rows={sinais} melhor={melhor} />

      {data.source === 'snapshot' && (
        <div className="notice">
          <strong>A ler do snapshot local.</strong> O Supabase não está configurado ou ainda está
          vazio, por isso não há histórico nem acompanhamento de posições.
        </div>
      )}

      <section>
        <div className="section-head">
          <h2>Último varrimento</h2>
          <span className="grow" />
          <Link href="/mercados">ver todos</Link>
        </div>
        <p className="section-cap">
          Estado guardado pelo motor no último passe. A percentagem é o progresso do checklist
          MMXM — não é preço.
        </p>

        {diagnosticos.length === 0 ? (
          <div className="empty">
            <strong>Ainda não há varrimento guardado.</strong>
            Corra <code>npm run engine:scan</code> para preencher o histórico. A análise ao vivo em
            cima não depende disto.
          </div>
        ) : (
          <div className="assets">
            {diagnosticos.slice(0, 6).map((d) => (
              <CartaoAtivo key={d.symbol} d={d} />
            ))}
          </div>
        )}
      </section>

      <footer className="note">
        Último varrimento:{' '}
        {data.source !== 'none' && data.scannedAt
          ? new Date(data.scannedAt).toISOString().slice(0, 16).replace('T', ' ')
          : '—'}{' '}
        · modo <strong>{data.source === 'none' ? 'paper' : (data.mode ?? 'paper')}</strong>. Nenhuma
        ordem é enviada sem um toque seu.
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------

function CartaoAtivo({ d }: { d: DiagnosticRow }) {
  const score = Math.round(d.checklist_score * 100);
  const alta = d.model_type === 'MMBM';

  return (
    <Link href={`/instrumento/${d.symbol}`} className="asset">
      <div className="asset__top">
        <span className="asset__logo" aria-hidden="true">
          {d.symbol.slice(0, 3)}
        </span>
        <div className="grow">
          <div className="asset__name">{d.symbol}</div>
          <div className="asset__sub">
            {PHASE_LABEL[d.model_phase ?? ''] ?? d.model_phase ?? '—'}
          </div>
        </div>
        <span className={`pill ${alta ? 'bull' : 'bear'}`}>{d.model_type ?? '—'}</span>
      </div>

      <div className="asset__row">
        <div className="grow">
          <div className="asset__price">{score}%</div>
          <div className="asset__meta">
            {d.failed_at_step !== null
              ? `passo ${d.failed_at_step} · ${STEP_LABEL[d.failed_at_step] ?? ''}`
              : /abaixo do minimo|rejeitado/i.test(d.summary ?? '')
                ? // 9/9 passos e mesmo assim sem sinal: dizer porquê, senão
                  // "100% completo" sem sinal nenhum lê-se como avaria.
                  '9/9 passos · R abaixo do mínimo'
                : '✓ checklist completo'}
          </div>
        </div>
        <Sparkline
          values={formaDoProgresso(d.checklist_score, alta)}
          color={alta ? 'var(--bull)' : 'var(--bear)'}
        />
      </div>
    </Link>
  );
}

/**
 * Sinais — com estado vazio a sério.
 *
 * Esconder a secção quando não há sinais apagaria a diferença entre "o sistema
 * não encontrou nada" e "o sistema não correu", que são coisas muito diferentes
 * para quem está a decidir se olha para o mercado hoje. Zero sinais é
 * informação: mostra-se, e diz-se quão perto esteve o melhor candidato.
 */
function Sinais({ rows, melhor }: { rows: SignalRow[]; melhor: DiagnosticRow | undefined }) {
  return (
    <section>
      <div className="section-head">
        <h2>Sinais confirmados</h2>
        <span className="grow" />
        <span className="section-note">{rows.length}</span>
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          <strong>Nenhum sinal aberto.</strong>
          Um sinal só nasce quando os 9 passos do checklist passam todos.
          {melhor && (
            <>
              {' '}
              O mais avançado no último varrimento foi <strong style={{ display: 'inline' }}>
                {melhor.symbol}
              </strong>
              , com {(melhor.checklist_score * 100).toFixed(0)}%
              {melhor.failed_at_step !== null && (
                <>
                  , parado no passo {melhor.failed_at_step} ·{' '}
                  {STEP_LABEL[melhor.failed_at_step] ?? ''}
                </>
              )}
              .
            </>
          )}
        </div>
      ) : (
        rows.slice(0, 3).map((s) => (
          <Link key={s.id} href={`/instrumento/${s.symbol}`} className="sinal">
            <div className="sinal__topo">
              <span className={`sinal__lado ${s.direction === 'bullish' ? 'compra' : 'venda'}`}>
                {s.direction === 'bullish' ? 'COMPRA' : 'VENDA'}
              </span>
              <strong className="grow">{s.symbol}</strong>
              <span className="sinal__r">{s.max_r_multiple?.toFixed(1)}R</span>
            </div>
            <div className="sinal__linhas">
              <span>
                entrada <b>{s.entry_price?.toFixed(5)}</b>
              </span>
              <span>
                stop <b>{s.stop_loss?.toFixed(5)}</b>
              </span>
              <span>
                confiança <b>{Math.round((s.confidence ?? 0) * 100)}%</b>
              </span>
            </div>
          </Link>
        ))
      )}
    </section>
  );
}
