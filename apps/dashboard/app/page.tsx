/**
 * Início — o ecrã que responde a "o que está a acontecer agora?".
 *
 * ── ORDEM, E PORQUÊ ────────────────────────────────────────────────────────
 *
 *   1. saldo da conta      — o número que a pessoa abriu a app para ver
 *   2. fita de preços      — prova, em movimento, que o sistema está vivo
 *   3. sinais              — as conclusões reais do motor, quando existem
 *   4. motores (admin)     — estado do motor e o log do que ele anunciou
 *   5. agentes a analisar  — o trabalho a acontecer, instrumento por instrumento
 *
 * O saldo vem primeiro porque foi pedido explicitamente: depois de ligar a
 * Deriv não deve ser preciso entrar no separador financeiro para o ver.
 *
 * ── SÓ ESTRATÉGIAS ACTIVAS ─────────────────────────────────────────────────
 *
 * Havia aqui duas secções da análise MMXM antiga — "Sinais confirmados" e
 * "Último varrimento", ambas lidas de `diagnostics`/`signals` do varrimento
 * diário (`lib/data.ts`). Essa análise já não gera sinal nenhum no sistema
 * real (ver `packages/core/src/strategies/validadas.ts`): mostravam uma
 * pontuação que não correspondia ao que a pessoa recebia no Telegram, e a
 * primeira duplicava a `ListaSinais` de cima, que já é a real. Saíram; o
 * `PainelAgentes` abaixo já cobre "o que o motor está a ver agora" com as
 * MESMAS estratégias activas (validadas e em teste).
 *
 * ── O QUE É SERVIDOR E O QUE É CLIENTE ─────────────────────────────────────
 *
 * Esta página é um Server Component: lê as preferências uma vez e envia HTML.
 * Tudo o que se mexe ao segundo (saldo, preços, análise ao vivo) são ilhas de
 * cliente que se ligam sozinhas depois. Assim o primeiro ecrã pinta sem
 * esperar por WebSocket nenhum, e nada do que se mexe bloqueia a pintura.
 */

import Link from 'next/link';
import { CartaoSaldo } from '@/components/vivo/CartaoSaldo';
import { Fita } from '@/components/vivo/Fita';
import { PainelAgentes } from '@/components/vivo/PainelAgentes';
import { ListaSinais } from '@/components/vivo/ListaSinais';
import { PainelMotores } from '@/components/vivo/PainelMotores';
import { ehAdministrador } from '@/lib/administracao';
import { utilizadorDaSessao } from '@/lib/supabase/servidor';
import { Ligacao } from '@/components/vivo/Preco';
import { lerPreferenciasServidor } from '@/lib/preferencias-servidor';

export const dynamic = 'force-dynamic';

/** "Agnaldo Lisboa" → "AL". Cada conta vê as suas, e não um "A" igual para todos. */
function iniciais(nome: string | null): string {
  const partes = (nome ?? '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '·';
  const primeira = partes[0]!.charAt(0);
  const ultima = partes.length > 1 ? partes[partes.length - 1]!.charAt(0) : '';
  return (primeira + ultima).toUpperCase();
}

export default async function Page() {
  const [prefs, utilizador] = await Promise.all([lerPreferenciasServidor(), utilizadorDaSessao()]);
  const admin = ehAdministrador(utilizador);

  return (
    <div className="wrap">
      <div className="cabeca">
        <Link href="/definicoes" className="cabeca__avatar" aria-label="Conta e definições">
          {iniciais(prefs.nome)}
        </Link>
        <div className="cabeca__id">
          <p className="cabeca__saudacao">{prefs.nome ? `Olá, ${prefs.nome}` : 'Bem-vindo'}</p>
          <h1>{prefs.objetivoRotulo ?? 'Forex Dude System'}</h1>
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
        Os sinais do portfólio desta conta, ordenados, com estado. O estado dos
        motores só interessa a quem gere o servidor.
      */}
      <ListaSinais />
      {admin && <PainelMotores compacto />}

      {/*
        O painel de agentes é o coração do pedido "nada estático". Corre a
        análise real, um instrumento de cada vez, com as mesmas estratégias
        activas do motor — e mostra o progresso enquanto trabalha.
      */}
      <PainelAgentes simbolos={prefs.instrumentos} timeframe={prefs.timeframe} />

      <footer className="note">
        Nenhuma ordem é enviada sem um toque seu.
      </footer>
    </div>
  );
}
