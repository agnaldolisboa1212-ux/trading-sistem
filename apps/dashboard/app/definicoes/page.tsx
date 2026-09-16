/**
 * Definições — tudo o que se liga, desliga ou troca.
 *
 * ── PORQUÊ SUBSTITUI O ANTIGO "PERFIL" ─────────────────────────────────────
 *
 * A página anterior mostrava um estado FIXO no código: dizia "Corretora (Deriv)
 * — sem token" porque estava escrito assim, não porque alguém tivesse
 * perguntado à Deriv. Era essa a queixa: "nas definições diz que o Deriv não
 * está a funcionar". Não estava avariado — nunca chegou a ser consultado.
 *
 * Agora cada linha é medida no momento em que a página é servida. Se disser
 * "ligado", é porque uma chamada respondeu.
 *
 * A parte que muda coisas (trocar de conta, ligar avisos, instalar) é um
 * componente de cliente; o resto é servidor e nunca deixa as credenciais sair.
 */

import Link from 'next/link';
import { PainelDefinicoes } from '@/components/vivo/PainelDefinicoes';
import { PainelMotores } from '@/components/vivo/PainelMotores';
import { estadoPush } from '@/lib/push';
import { isConfigured } from '@/lib/supabase';
import { API_CATALOG, defaultProviders } from '@trading/data';

export const dynamic = 'force-dynamic';

export default async function Page() {
  /*
   * A corretora ja nao e lida aqui. Um Server Component nao ve a sessao da
   * plataforma (vive no browser), e le-la com o token do servidor mostrava as
   * contas do dono a qualquer visitante. O cartao da corretora pede o estado ao
   * servidor com a sessao de quem esta a ver.
   */
  const push = await estadoPush();

  const providers = defaultProviders();
  const semChave = providers.filter((p) => !p.requiresKey);
  const comChave = providers.filter((p) => p.requiresKey);
  const ativos = comChave.filter((p) => p.isConfigured());

  const telegram = Boolean(process.env['TELEGRAM_BOT_TOKEN'] && process.env['TELEGRAM_CHAT_ID']);
  const n8n = Boolean(process.env['N8N_WEBHOOK_URL']);
  const modo = process.env['EXECUTION_MODE'] === 'live' ? 'live' : 'paper';

  return (
    <div className="wrap">
      <div className="cabeca">
        <div className="cabeca__id">
          <p className="cabeca__saudacao">Sistema</p>
          <h1>Definições</h1>
        </div>
      </div>

      {/* Tudo o que é interativo vive aqui dentro. */}
      <PainelDefinicoes pushDisponivel={push.configurado} />

      <PainelMotores compacto />

      <section>
        <h2>Integrações</h2>
        <div className="rows">
          <Linha
            k="Base de dados (Supabase)"
            ok={isConfigured}
            sim="ligado"
            nao="não configurado"
            nota={isConfigured ? undefined : 'Sem isto não há histórico nem login.'}
          />
          <Linha
            k="Avisos no Telegram"
            ok={telegram}
            sim="ligado"
            nao="sem token"
            nota={telegram ? undefined : 'TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no .env'}
          />
          <Linha
            k="Automação (n8n)"
            ok={n8n}
            sim="webhook definido"
            nao="sem webhook"
          />
          <Linha
            k="Notificações push"
            ok={push.configurado}
            sim={`${push.subscritores} dispositivo(s)`}
            nao="faltam chaves VAPID"
            nota={
              push.configurado
                ? undefined
                : 'Gere as chaves com `npm run push:chaves` e cola-as no .env'
            }
          />
        </div>
      </section>

      <section>
        <h2>Execução</h2>
        <div className="rows">
          <div>
            <span className="k">Modo</span>
            <span className={`v ${modo === 'live' ? 'bear-t' : 'warn-t'}`}>{modo}</span>
          </div>
          <div>
            <span className="k">Ordens automáticas</span>
            <span className="v faint">nunca</span>
          </div>
        </div>
        <p className="section-cap">
          O sistema analisa, avisa e prepara a ordem. <strong>Enviar é sempre um toque seu</strong>,
          num botão que mostra o custo antes de confirmar. Não há agendamento nem execução
          automática — nem em modo <code>live</code>.
        </p>
      </section>

      <section>
        <h2>Fontes de dados</h2>
        <div className="rows">
          <div>
            <span className="k">Sem chave (ativas)</span>
            <span className="v bull-t">{semChave.length}</span>
          </div>
          <div>
            <span className="k">Com chave (configuradas)</span>
            <span className="v">
              {ativos.length} de {comChave.length}
            </span>
          </div>
          <div>
            <span className="k">No catálogo</span>
            <span className="v">{API_CATALOG.length}</span>
          </div>
        </div>
        <p className="section-cap">{semChave.map((p) => p.id).join(' · ')}</p>
      </section>

      <section>
        <h2>Conta na plataforma</h2>
        <div className="rows">
          <div>
            <span className="k">Preferências</span>
            <span className="v">
              <Link href="/onboarding">estratégia, objetivos, mercados</Link>
            </span>
          </div>
          <div>
            <span className="k">Sessão</span>
            <span className="v">
              <Link href="/entrar">entrar ou trocar de conta</Link>
            </span>
          </div>
        </div>
      </section>

      <footer className="note">
        A estratégia MMXM não tem vantagem demonstrada: 17 operações em 6 anos de backtest, e um
        único negócio em ouro vale 81% do lucro total. Retirar as três melhores deixa o resultado
        negativo. Isto é uma afirmação sobre o <em>software</em> funcionar, não sobre o mercado.
      </footer>
    </div>
  );
}

function Linha({
  k,
  ok,
  sim,
  nao,
  nota,
}: {
  k: string;
  ok: boolean;
  sim: string;
  nao: string;
  nota?: string;
}) {
  return (
    <div>
      <span className="k">
        {k}
        {nota && <em className="linha__nota">{nota}</em>}
      </span>
      <span className={`v ${ok ? 'bull-t' : 'faint'}`}>{ok ? sim : nao}</span>
    </div>
  );
}
