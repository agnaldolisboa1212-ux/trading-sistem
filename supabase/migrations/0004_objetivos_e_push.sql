-- =============================================================================
-- Objetivos de negociação + subscrições de notificação push
--
-- Duas coisas que chegaram ao mesmo tempo e partilham a mesma migração porque
-- ambas nascem do onboarding: a pessoa escolhe COMO quer operar e diz se quer
-- ser AVISADA.
--
-- IDEMPOTENTE: pode ser colada no SQL Editor as vezes que forem precisas.
--
-- Aplicar com:  supabase db push   (ou colar no SQL Editor do Supabase)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Objetivos
--
-- `objetivos` é um text[] com no máximo 2 elementos — a regra vem de o produto
-- pedir "escolha até 2". O CHECK está aqui e não só na interface porque uma
-- restrição que só existe no formulário deixa de existir no momento em que
-- alguém escreve na API diretamente.
--
-- Valores esperados: 'investir', 'day-trading', 'intradiario', 'swing'.
-- Sem CHECK de domínio: acrescentar um estilo novo não deve exigir migração.
-- -----------------------------------------------------------------------------
alter table perfis_utilizador
  add column if not exists objetivos text[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'perfis_objetivos_ate_dois'
  ) then
    alter table perfis_utilizador
      add constraint perfis_objetivos_ate_dois
      check (array_length(objetivos, 1) is null or array_length(objetivos, 1) <= 2);
  end if;
end $$;

comment on column perfis_utilizador.objetivos is
  'Estilo de operação escolhido no onboarding. Até 2: investir, day-trading, intradiario, swing.';

-- Preferência de notificações. Guardada no perfil e não só no browser: quem
-- instala a app em dois telemóveis espera a mesma preferência nos dois.
alter table perfis_utilizador
  add column if not exists avisos_ativos boolean not null default true;

-- Montante por operação que a pessoa escolheu no onboarding. Guardado aqui para
-- que o botão de comprar já apareça preenchido com um valor que ela decidiu, em
-- vez de um número arbitrário.
alter table perfis_utilizador
  add column if not exists montante_por_operacao numeric(12,2) not null default 10;

-- -----------------------------------------------------------------------------
-- Subscrições push
--
-- O `endpoint` é a chave primária e não um `id` gerado: é ele que identifica
-- unicamente um browser junto do serviço de push, e usá-lo como PK faz com que
-- o mesmo browser a subscrever duas vezes ATUALIZE em vez de duplicar. Com um
-- id gerado, cada limpeza de cookies criaria uma linha nova e a lista de
-- destinos cresceria sem fim.
--
-- `utilizador` é nullable de propósito: alguém pode ativar as notificações
-- antes de fazer login, e recusar a subscrição nesse momento seria perder a
-- única altura em que o browser mostra o pedido de permissão.
-- -----------------------------------------------------------------------------
create table if not exists push_subscricoes (
  endpoint    text        primary key,
  p256dh      text        not null,
  auth        text        not null,
  utilizador  uuid        references auth.users(id) on delete cascade,
  criado_em   timestamptz not null default now(),
  usado_em    timestamptz
);

create index if not exists push_subscricoes_utilizador_idx
  on push_subscricoes (utilizador);

comment on table push_subscricoes is
  'Destinos de notificação push. Escritos pelo servidor com a chave secreta; nunca legíveis pelo papel anon.';

-- -----------------------------------------------------------------------------
-- RLS
--
-- Esta tabela é escrita e lida APENAS pelo servidor, com a chave secreta (que
-- ignora RLS). Ativar RLS sem criar nenhuma política para `anon` fecha-a por
-- completo ao browser — que é exatamente o pretendido: a lista de endpoints de
-- push de todos os utilizadores não tem nenhuma razão para ser legível a partir
-- do cliente.
-- -----------------------------------------------------------------------------
alter table push_subscricoes enable row level security;

-- Cada pessoa pode ver e apagar as SUAS subscrições, para poder desligar as
-- notificações de um telemóvel que já não tem.
drop policy if exists push_ler_proprio on push_subscricoes;
create policy push_ler_proprio on push_subscricoes
  for select
  using (utilizador = auth.uid());

drop policy if exists push_apagar_proprio on push_subscricoes;
create policy push_apagar_proprio on push_subscricoes
  for delete
  using (utilizador = auth.uid());
