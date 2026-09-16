-- =============================================================================
-- Perfis de utilizador — preferências de onboarding
--
-- PORQUÊ: até aqui o sistema era de utilizador único e o dashboard lia tudo com
-- a chave publicável no papel `anon`. A partir do momento em que há login, cada
-- pessoa tem de ter as SUAS preferências (estratégia, instrumentos, avatar) e
-- ninguém pode ler as dos outros. Daí uma tabela ligada a `auth.users` com RLS
-- por `auth.uid()`, e não uma tabela de configuração global.
--
-- As colunas estão em português para acompanhar o nome do ficheiro e o resto do
-- código da aplicação; as tabelas de mercado (0001) ficam em inglês porque
-- espelham vocabulário de domínio já estabelecido (candles, signals, positions).
--
-- IDEMPOTENTE: pode ser colada no SQL Editor as vezes que forem precisas.
--
-- Aplicar com:  supabase db push   (ou colar no SQL Editor do Supabase)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Perfil
--
-- `utilizador_id` é ao mesmo tempo chave primária e chave estrangeira: um
-- utilizador tem exatamente um perfil, e apagar a conta apaga o perfil.
--
-- `instrumentos` é um text[] e não uma tabela de junção. É uma lista curta (no
-- máximo os 17 do universo), lida sempre inteira e escrita sempre inteira — uma
-- tabela de junção acrescentaria um join a cada leitura para não resolver
-- problema nenhum. Fica sem FK para `instruments` de propósito: se um símbolo
-- sair do universo, o perfil não deve rebentar; o filtro simplesmente ignora-o.
--
-- `onboarding_em` é o que distingue "utilizador novo" de "utilizador que já
-- escolheu". Um booleano `onboarding_feito` diria o mesmo mas perderia QUANDO,
-- que é a informação de que se precisa quando alguém diz "nunca escolhi isto".
-- -----------------------------------------------------------------------------
create table if not exists perfis_utilizador (
  utilizador_id     uuid        primary key references auth.users(id) on delete cascade,
  nome              text,
  avatar_url        text,

  -- Identificador da estratégia no registo do código (ver lib/estrategias.ts).
  -- Sem CHECK de valores: novas estratégias entram em `packages/core` sem
  -- exigir uma migração para as autorizar.
  estrategia        text        not null default 'mmxm-smt',

  -- Símbolos que o utilizador quer acompanhar. Vazio = todos.
  instrumentos      text[]      not null default '{}',

  -- Ligação à corretora. NENHUM token vive aqui: o token da Deriv fica no
  -- ambiente do servidor e nunca sai dele. Isto guarda apenas a ESCOLHA de
  -- conta, que por si só não autoriza nada.
  deriv_ligada      boolean     not null default false,
  deriv_account_id  text,
  deriv_ambiente    text        check (deriv_ambiente in ('demo','real')),

  onboarding_em     timestamptz,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

-- Colunas acrescentadas depois da primeira aplicação desta migração entram por
-- aqui, para quem já a correu antes.
alter table perfis_utilizador add column if not exists nome             text;
alter table perfis_utilizador add column if not exists avatar_url       text;
alter table perfis_utilizador add column if not exists estrategia       text    not null default 'mmxm-smt';
alter table perfis_utilizador add column if not exists instrumentos     text[]  not null default '{}';
alter table perfis_utilizador add column if not exists deriv_ligada     boolean not null default false;
alter table perfis_utilizador add column if not exists deriv_account_id text;
alter table perfis_utilizador add column if not exists deriv_ambiente   text;
alter table perfis_utilizador add column if not exists onboarding_em    timestamptz;

comment on table  perfis_utilizador is 'Preferências de onboarding por utilizador. Sem segredos: nenhum token de corretora é guardado aqui.';
comment on column perfis_utilizador.instrumentos is 'Símbolos acompanhados. Lista vazia significa "todo o universo".';
comment on column perfis_utilizador.deriv_account_id is 'Conta Deriv escolhida. Identificador público — não autoriza operações por si só.';

-- -----------------------------------------------------------------------------
-- `atualizado_em` automático
--
-- Deixar isto ao cliente significaria confiar em cada sítio que escreve para se
-- lembrar de o atualizar. Um trigger não se esquece.
-- -----------------------------------------------------------------------------
create or replace function perfis_utilizador_touch()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists perfis_utilizador_touch_trg on perfis_utilizador;
create trigger perfis_utilizador_touch_trg
  before update on perfis_utilizador
  for each row execute function perfis_utilizador_touch();

-- -----------------------------------------------------------------------------
-- Row Level Security — cada um vê só o seu
--
-- Sem DELETE de propósito: o perfil desaparece por cascade quando a conta é
-- apagada. Uma política de DELETE só serviria para o utilizador apagar o perfil
-- e ficar com a conta num estado sem preferências, que a aplicação teria de
-- voltar a tratar como "novo" — mais superfície, zero benefício.
-- -----------------------------------------------------------------------------
alter table perfis_utilizador enable row level security;

drop policy if exists perfis_ler_proprio on perfis_utilizador;
create policy perfis_ler_proprio on perfis_utilizador
  for select to authenticated
  using (auth.uid() = utilizador_id);

drop policy if exists perfis_inserir_proprio on perfis_utilizador;
create policy perfis_inserir_proprio on perfis_utilizador
  for insert to authenticated
  with check (auth.uid() = utilizador_id);

drop policy if exists perfis_atualizar_proprio on perfis_utilizador;
create policy perfis_atualizar_proprio on perfis_utilizador
  for update to authenticated
  using (auth.uid() = utilizador_id)
  with check (auth.uid() = utilizador_id);

-- -----------------------------------------------------------------------------
-- Perfil criado automaticamente no registo
--
-- CONVENIÊNCIA, NÃO GARANTIA: a aplicação faz sempre `upsert` ao gravar o
-- onboarding, por isso funciona na mesma se este trigger não existir. Criar
-- triggers em `auth.users` exige privilégios que nem todos os projetos dão ao
-- papel do SQL Editor — por isso o bloco engole a falha de privilégio em vez de
-- abortar a migração inteira por causa de um extra.
-- -----------------------------------------------------------------------------
create or replace function criar_perfil_ao_registar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into perfis_utilizador (utilizador_id)
  values (new.id)
  on conflict (utilizador_id) do nothing;
  return new;
end;
$$;

do $$
begin
  execute 'drop trigger if exists criar_perfil_ao_registar_trg on auth.users';
  execute 'create trigger criar_perfil_ao_registar_trg
             after insert on auth.users
             for each row execute function criar_perfil_ao_registar()';
exception
  when insufficient_privilege then
    raise notice 'Sem privilégios para criar trigger em auth.users — ignorado. A aplicação faz upsert do perfil na mesma.';
end $$;

-- -----------------------------------------------------------------------------
-- Avatares (Supabase Storage)
--
-- Bucket público de LEITURA: uma foto de perfil é mostrada em cada ecrã e um
-- bucket privado obrigaria a assinar um URL a cada renderização. A escrita é
-- que está fechada — cada utilizador só pode escrever dentro da pasta com o seu
-- próprio uid, que é o que impede alguém de substituir o avatar de outro.
--
-- Caminho convencionado:  avatares/<uid>/<ficheiro>
--
-- O bloco está protegido porque `storage.objects` pertence a
-- `supabase_storage_admin`; em projetos onde o SQL Editor não tem esse
-- privilégio, as políticas criam-se pelo painel (Storage → Policies).
-- -----------------------------------------------------------------------------
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('avatares', 'avatares', true)
  on conflict (id) do nothing;

  execute 'drop policy if exists avatares_ler_publico on storage.objects';
  execute $pol$
    create policy avatares_ler_publico on storage.objects
      for select to public
      using (bucket_id = 'avatares')
  $pol$;

  execute 'drop policy if exists avatares_carregar_proprio on storage.objects';
  execute $pol$
    create policy avatares_carregar_proprio on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'avatares'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
  $pol$;

  execute 'drop policy if exists avatares_substituir_proprio on storage.objects';
  execute $pol$
    create policy avatares_substituir_proprio on storage.objects
      for update to authenticated
      using (
        bucket_id = 'avatares'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
  $pol$;

  execute 'drop policy if exists avatares_apagar_proprio on storage.objects';
  execute $pol$
    create policy avatares_apagar_proprio on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'avatares'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
  $pol$;
exception
  when insufficient_privilege then
    raise notice 'Sem privilégios em storage.* — criar o bucket "avatares" e as políticas pelo painel. O onboarding funciona com iniciais até lá.';
  when undefined_table then
    raise notice 'Storage não disponível neste projeto — avatares ficam limitados a iniciais.';
end $$;

-- -----------------------------------------------------------------------------
-- Leitura autenticada das tabelas de mercado
--
-- A 0001 deu SELECT a `anon` e a `authenticated` nas tabelas de mercado, por
-- isso o painel continua a ler tudo depois do login. Nada a mudar aqui — fica
-- registado para que a ausência de alterações seja uma decisão visível e não um
-- esquecimento.
-- -----------------------------------------------------------------------------
