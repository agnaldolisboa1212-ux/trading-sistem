-- =============================================================================
-- 0006 — Sinais que cada pessoa eliminou da sua lista
--
-- "Eliminar" um sinal não o apaga: o sinal é do motor e aparece a todas as
-- contas que seguem aquele instrumento. O que se guarda é que ESTA conta não o
-- quer ver mais. Cada pessoa só lê, cria e apaga as suas linhas (RLS).
--
-- Pode correr-se de novo sem estragar nada.
-- =============================================================================

create table if not exists sinais_ocultos (
  utilizador_id uuid        not null references auth.users(id) on delete cascade,
  sinal_id      text        not null,
  criado_em     timestamptz not null default now(),
  primary key (utilizador_id, sinal_id)
);

comment on table sinais_ocultos is
  'Sinais de tempo real que cada conta eliminou da sua lista. O sinal continua em sinais_tempo_real.';

alter table sinais_ocultos enable row level security;

drop policy if exists sinais_ocultos_ler_proprio on sinais_ocultos;
create policy sinais_ocultos_ler_proprio on sinais_ocultos
  for select to authenticated
  using (utilizador_id = auth.uid());

drop policy if exists sinais_ocultos_criar_proprio on sinais_ocultos;
create policy sinais_ocultos_criar_proprio on sinais_ocultos
  for insert to authenticated
  with check (utilizador_id = auth.uid());

drop policy if exists sinais_ocultos_apagar_proprio on sinais_ocultos;
create policy sinais_ocultos_apagar_proprio on sinais_ocultos
  for delete to authenticated
  using (utilizador_id = auth.uid());

grant select, insert, delete on sinais_ocultos to authenticated;
