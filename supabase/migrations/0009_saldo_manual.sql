-- =============================================================================
-- 0009 — Saldo manual, para a curva de capital do Financeiro
--
-- As ordens só saem com um toque manual no terminal cTrader: não há execução
-- automática de que se possa derivar o saldo real da conta. A página do
-- Financeiro simulava posições de papel a partir dos sinais do motor MMXM
-- antigo — uma conta que nunca existiu, desligada da conta real da pessoa.
--
-- Em vez disso, cada pessoa regista o saldo real da sua conta quando quiser
-- (depois de fechar uma operação, uma vez por semana, como preferir); a curva
-- de capital liga esses pontos. Cada pessoa só lê, cria e apaga os seus (RLS).
--
-- Pode correr-se de novo sem estragar nada.
-- =============================================================================

create table if not exists saldo_manual (
  id            bigint      generated always as identity primary key,
  utilizador_id uuid        not null references auth.users(id) on delete cascade,
  saldo         numeric     not null,
  moeda         text        not null default 'USD',
  nota          text,
  registado_em  timestamptz not null default now()
);

create index if not exists saldo_manual_utilizador_idx
  on saldo_manual (utilizador_id, registado_em desc);

comment on table saldo_manual is
  'Pontos de saldo introduzidos manualmente por cada conta, para a curva de capital do Financeiro.';

alter table saldo_manual enable row level security;

drop policy if exists saldo_manual_ler_proprio on saldo_manual;
create policy saldo_manual_ler_proprio on saldo_manual
  for select to authenticated
  using (utilizador_id = auth.uid());

drop policy if exists saldo_manual_criar_proprio on saldo_manual;
create policy saldo_manual_criar_proprio on saldo_manual
  for insert to authenticated
  with check (utilizador_id = auth.uid());

drop policy if exists saldo_manual_apagar_proprio on saldo_manual;
create policy saldo_manual_apagar_proprio on saldo_manual
  for delete to authenticated
  using (utilizador_id = auth.uid());

grant select, insert, delete on saldo_manual to authenticated;
