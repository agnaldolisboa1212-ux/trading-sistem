-- =============================================================================
-- 0012 — Automação: o motor envia as ordens sozinho, dentro de limites
--
-- Até aqui, uma ordem só saía quando a pessoa tocava no botão. O dono pediu
-- automação 24 horas no servidor, em conta real, com limites — e é isso que
-- estas duas tabelas guardam:
--
--   automacao           as regras (o que, quanto, até onde) de cada pessoa
--   ordens_automaticas  o registo do que o motor fez, ou porque não fez
--
-- O que NÃO está aqui: credenciais. A sessão cTrader que o motor usa fica
-- cifrada num ficheiro do servidor (`data/ctrader-motor.json`), escrita pelo
-- botão "autorizar o motor" e nunca nesta base de dados.
--
-- SEGURANÇA: o motor só executa a automação de UMA pessoa — a que estiver em
-- `AUTOMACAO_UTILIZADOR_ID` no ambiente do servidor. Sem essa variável não
-- executa nada. Estas tabelas não dão a ninguém acesso à conta de outrem.
--
-- Pode correr-se de novo sem estragar nada.
-- =============================================================================

create table if not exists automacao (
  utilizador_id         uuid        primary key references auth.users(id) on delete cascade,
  activa                boolean     not null default false,
  -- Sem isto, uma conta real nunca recebe ordens automáticas.
  conta_real_permitida  boolean     not null default false,
  estrategias           text[]      not null default '{}',
  instrumentos          text[]      not null default '{}',
  -- 'fixo' usa sempre `lote_fixo`; 'risco' calcula pelo % do saldo.
  modo_lote             text        not null default 'fixo',
  lote_fixo             numeric     not null default 0.01,
  risco_pct             numeric     not null default 1,
  max_ordens_abertas    integer     not null default 2,
  /** Perda máxima num dia e no total, em % do saldo. Atingida, pára. */
  perda_diaria_pct      numeric     not null default 3,
  perda_total_pct       numeric     not null default 10,
  conta_ctrader         bigint,
  actualizado_em        timestamptz not null default now()
);

comment on table automacao is
  'Regras da automação de cada pessoa. O motor só corre a de AUTOMACAO_UTILIZADOR_ID.';

alter table automacao enable row level security;

drop policy if exists automacao_ler_propria on automacao;
create policy automacao_ler_propria on automacao
  for select to authenticated using (utilizador_id = auth.uid());

drop policy if exists automacao_gravar_propria on automacao;
create policy automacao_gravar_propria on automacao
  for insert to authenticated with check (utilizador_id = auth.uid());

drop policy if exists automacao_editar_propria on automacao;
create policy automacao_editar_propria on automacao
  for update to authenticated using (utilizador_id = auth.uid()) with check (utilizador_id = auth.uid());

grant select, insert, update on automacao to authenticated;

-- -----------------------------------------------------------------------------
-- O que o motor fez — e o que decidiu não fazer
-- -----------------------------------------------------------------------------

create table if not exists ordens_automaticas (
  id            bigint      generated always as identity primary key,
  utilizador_id uuid        not null references auth.users(id) on delete cascade,
  -- Sem chave estrangeira de propósito: o registo tem de sobreviver à limpeza
  -- dos sinais, e serve também para sinais que já não estão na tabela.
  sinal_id      text        not null,
  simbolo       text        not null,
  timeframe     text,
  estrategia    text,
  lado          text,
  lotes         numeric,
  entrada       numeric,
  stop          numeric,
  alvo          numeric,
  -- 'enviada' | 'recusada' | 'erro'
  resultado     text        not null,
  motivo        text,
  posicao_id    text,
  criado_em     timestamptz not null default now(),
  unique (utilizador_id, sinal_id)
);

create index if not exists ordens_automaticas_utilizador_idx
  on ordens_automaticas (utilizador_id, criado_em desc);

comment on table ordens_automaticas is
  'Registo das ordens automáticas: uma linha por sinal, mesmo quando foi recusado pelos limites.';

alter table ordens_automaticas enable row level security;

drop policy if exists ordens_automaticas_ler_propria on ordens_automaticas;
create policy ordens_automaticas_ler_propria on ordens_automaticas
  for select to authenticated using (utilizador_id = auth.uid());

grant select on ordens_automaticas to authenticated;
