-- =============================================================================
-- COLAR ISTO NO SQL EDITOR DO SUPABASE E CARREGAR EM RUN
--
-- Junta as migracoes 0003, 0004 e 0005, por esta ordem (0004 altera a tabela
-- que a 0003 cria). Todas sao idempotentes: correr duas vezes nao estraga nada.
--
--   0003  perfis_utilizador       preferencias do onboarding, com RLS por pessoa
--   0004  objetivos + push        estilo de operacao e subscricoes de notificacao
--   0005  motor de tempo real     sinais intradiarios e registo dos motores
--
-- Gerado a partir de supabase/migrations/. Se editar uma migracao, volte a gerar.
-- =============================================================================



-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0003_perfis_utilizador.sql <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0004_objetivos_e_push.sql <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0005_motor_tempo_real.sql <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- Motor de tempo real: sinais intradiarios + registo de execucoes dos motores
--
-- PORQUE UMA TABELA NOVA E NAO `signals`
--
-- `signals` tem uma FK para `instruments(symbol)` — o universo MMXM de 17
-- instrumentos. O motor de tempo real analisa o que cada pessoa escolheu no
-- onboarding: sinteticos da Deriv, DAX, Nikkei. Esses simbolos nao existem em
-- `instruments`, e a insercao falharia.
--
-- E nao sao o mesmo tipo de sinal: nao passam pelo checklist de 9 passos, nao
-- tem modelo MMXM nem SMT. Meter os dois na mesma tabela obrigaria a encher
-- colunas obrigatorias com valores inventados.
--
-- IDEMPOTENTE: pode ser colada no SQL Editor as vezes que forem precisas.
-- =============================================================================

create table if not exists sinais_tempo_real (
  -- estrategia|simbolo|timeframe|direccao|vela — o mesmo setup na mesma vela
  -- produz sempre o mesmo id. E isto que impede o motor, que corre de 5 em 5
  -- minutos, de anunciar tres vezes o mesmo sinal numa vela de 15 minutos.
  id                text        primary key,
  simbolo           text        not null,
  timeframe         text        not null,
  estrategia        text        not null,
  direccao          text        not null check (direccao in ('bullish','bearish')),
  regime            text,

  -- Abertura da vela FECHADA que gerou o sinal.
  gerado_em         timestamptz not null,

  preco_referencia  numeric,
  zona_baixa        numeric,
  zona_alta         numeric,
  entrada           numeric     not null,
  stop              numeric     not null,
  alvos             jsonb       not null default '[]'::jsonb,
  r_maximo          numeric     not null default 0,

  -- Ordenacao relativa dentro da estrategia. NAO e uma probabilidade.
  conviccao         numeric     not null default 0,
  concordam         smallint    not null default 1,

  razao             text,
  avisos            jsonb       not null default '[]'::jsonb,
  notificado        boolean     not null default false,
  criado_em         timestamptz not null default now()
);

create index if not exists sinais_tempo_real_gerado_idx
  on sinais_tempo_real (gerado_em desc);

create index if not exists sinais_tempo_real_simbolo_idx
  on sinais_tempo_real (simbolo, gerado_em desc);

comment on table sinais_tempo_real is
  'Sinais do motor secundario (estrategias institucionais, intradiario). Escritos pelo motor com a chave secreta.';

-- -----------------------------------------------------------------------------
-- Execucoes dos motores
--
-- Serve para o painel responder a "os motores estao a correr?" mesmo quando o
-- painel e o motor vivem em maquinas diferentes. Quando vivem na mesma, o motor
-- tambem escreve `data/motor-estado.json` e o painel le esse primeiro.
-- -----------------------------------------------------------------------------
create table if not exists motor_execucoes (
  id            bigint      generated always as identity primary key,
  motor         text        not null check (motor in ('diario','tempoReal')),
  iniciado_em   timestamptz not null,
  terminado_em  timestamptz not null,
  duracao_ms    integer     not null,
  instrumentos  integer     not null default 0,
  sinais        integer     not null default 0,
  novos         integer     not null default 0,
  ok            boolean     not null default true,
  resumo        text,
  erros         jsonb       not null default '[]'::jsonb
);

create index if not exists motor_execucoes_motor_idx
  on motor_execucoes (motor, terminado_em desc);

-- -----------------------------------------------------------------------------
-- RLS — leitura publica, como as outras tabelas de mercado (0001)
--
-- Sinais e execucoes nao tem nada pessoal: sao o que o sistema viu no mercado.
-- O painel le com a chave publicavel; so o motor, com a secreta, escreve.
-- -----------------------------------------------------------------------------
alter table sinais_tempo_real enable row level security;
alter table motor_execucoes   enable row level security;

drop policy if exists read_sinais_tempo_real on sinais_tempo_real;
create policy read_sinais_tempo_real on sinais_tempo_real
  for select to anon, authenticated using (true);

drop policy if exists read_motor_execucoes on motor_execucoes;
create policy read_motor_execucoes on motor_execucoes
  for select to anon, authenticated using (true);
