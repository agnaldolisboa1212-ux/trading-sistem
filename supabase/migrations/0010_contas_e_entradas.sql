-- =============================================================================
-- 0010 — Várias contas, e marcar que sinais foram mesmo negociados
--
-- O saldo manual (0009) assumia UMA conta implícita por pessoa, e nada ligava
-- um ponto de saldo aos sinais que a pessoa realmente entrou. Os sinais são do
-- SISTEMA — partilhados com toda a gente que segue aquele instrumento — e a
-- pessoa só entra nalguns, com o toque manual no terminal. Sem essa marcação,
-- o desempenho "pessoal" do Financeiro estava a medir TODOS os sinais gerados
-- como se tivessem sido todos negociados.
--
-- Duas coisas novas:
--   contas             uma pessoa pode ter várias (uma por corretora, por
--                      exemplo), cada uma com a sua moeda e a sua curva
--   entradas_pessoais  que sinal foi mesmo negociado, em que conta
--
-- Pode correr-se de novo sem estragar nada.
-- =============================================================================

create table if not exists contas (
  id            bigint      generated always as identity primary key,
  utilizador_id uuid        not null references auth.users(id) on delete cascade,
  nome          text        not null,
  corretora     text,
  moeda         text        not null default 'USD',
  arquivada     boolean     not null default false,
  criado_em     timestamptz not null default now()
);

create index if not exists contas_utilizador_idx on contas (utilizador_id, criado_em);

comment on table contas is
  'Contas de negociação de cada pessoa — pode haver várias, uma por corretora.';

alter table contas enable row level security;

drop policy if exists contas_ler_propria on contas;
create policy contas_ler_propria on contas
  for select to authenticated using (utilizador_id = auth.uid());

drop policy if exists contas_criar_propria on contas;
create policy contas_criar_propria on contas
  for insert to authenticated with check (utilizador_id = auth.uid());

drop policy if exists contas_editar_propria on contas;
create policy contas_editar_propria on contas
  for update to authenticated using (utilizador_id = auth.uid()) with check (utilizador_id = auth.uid());

drop policy if exists contas_apagar_propria on contas;
create policy contas_apagar_propria on contas
  for delete to authenticated using (utilizador_id = auth.uid());

grant select, insert, update, delete on contas to authenticated;

-- -----------------------------------------------------------------------------
-- saldo_manual passa a pertencer a uma conta
-- -----------------------------------------------------------------------------

alter table saldo_manual add column if not exists conta_id bigint references contas(id) on delete cascade;

-- Quem já tinha pontos de saldo antes das contas existirem ganha uma "Conta
-- principal" e os pontos ficam lá — sem isto, esses pontos ficavam órfãos.
insert into contas (utilizador_id, nome)
select distinct utilizador_id, 'Conta principal'
from saldo_manual
where conta_id is null;

update saldo_manual sm
set conta_id = c.id
from contas c
where sm.conta_id is null
  and c.utilizador_id = sm.utilizador_id
  and c.nome = 'Conta principal';

create index if not exists saldo_manual_conta_idx on saldo_manual (conta_id, registado_em);

-- -----------------------------------------------------------------------------
-- Que sinais foram mesmo negociados, em que conta
-- -----------------------------------------------------------------------------

create table if not exists entradas_pessoais (
  id            bigint      generated always as identity primary key,
  utilizador_id uuid        not null references auth.users(id) on delete cascade,
  conta_id      bigint      not null references contas(id) on delete cascade,
  sinal_id      text        not null references sinais_tempo_real(id) on delete cascade,
  criado_em     timestamptz not null default now(),
  unique (conta_id, sinal_id)
);

create index if not exists entradas_pessoais_conta_idx on entradas_pessoais (conta_id);
create index if not exists entradas_pessoais_utilizador_idx on entradas_pessoais (utilizador_id);

comment on table entradas_pessoais is
  'Sinais que a pessoa realmente negociou (toque manual), por conta. Sem isto, o desempenho mediria todos os sinais gerados, negociados ou não.';

alter table entradas_pessoais enable row level security;

drop policy if exists entradas_pessoais_ler_propria on entradas_pessoais;
create policy entradas_pessoais_ler_propria on entradas_pessoais
  for select to authenticated using (utilizador_id = auth.uid());

drop policy if exists entradas_pessoais_criar_propria on entradas_pessoais;
create policy entradas_pessoais_criar_propria on entradas_pessoais
  for insert to authenticated with check (utilizador_id = auth.uid());

drop policy if exists entradas_pessoais_apagar_propria on entradas_pessoais;
create policy entradas_pessoais_apagar_propria on entradas_pessoais
  for delete to authenticated using (utilizador_id = auth.uid());

grant select, insert, delete on entradas_pessoais to authenticated;
