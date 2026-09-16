-- =============================================================================
-- Plano de saída fixado na posição
--
-- PORQUÊ: o plano de uma posição aberta (entrada, stop inicial, alvos, range da
-- consolidação) tem de ficar CONGELADO no momento da abertura.
--
-- A alternativa — ler o plano por join a `mmxm_models` — parece mais limpa mas
-- está errada: o motor volta a detetar o modelo a cada varrimento, e a
-- consolidação ou os alvos podem sair diferentes. O plano de saída de uma
-- posição já aberta mudaria por baixo dela, sem ninguém dar por isso, e o
-- histórico deixaria de explicar as saídas que realmente aconteceram.
--
-- Denormalizar aqui é a escolha certa: o passado não pode ser reescrito por uma
-- reanálise do presente.
-- =============================================================================

alter table positions add column if not exists entry_price            numeric;
alter table positions add column if not exists initial_stop           numeric;
alter table positions add column if not exists targets                jsonb   not null default '[]'::jsonb;
alter table positions add column if not exists consolidation_high     numeric;
alter table positions add column if not exists consolidation_low      numeric;
alter table positions add column if not exists expected_horizon_days  smallint;
alter table positions add column if not exists max_r_multiple         numeric;
alter table positions add column if not exists last_price             numeric;
alter table positions add column if not exists last_evaluated_at      timestamptz;

-- Quantas velas uma ordem pendente sobrevive antes de expirar.
alter table signals add column if not exists expires_after_bars smallint not null default 15;
-- O range da consolidacao viaja COM o sinal, para o plano de saida ser
-- autocontido e nao depender de um join ao modelo, que e re-detetado a cada
-- varrimento.
alter table signals add column if not exists consolidation_high numeric;
alter table signals add column if not exists consolidation_low  numeric;
-- Vela em que o sinal foi emitido, para medir a idade da ordem pendente.
alter table signals add column if not exists bars_since_signal  smallint not null default 0;

-- A vista tem de ser recriada para expor as colunas novas.
drop view if exists v_open_positions;

create view v_open_positions as
select
  p.id,
  p.symbol,
  p.direction,
  p.opened_at,
  p.filled_price,
  p.entry_price,
  p.current_stop,
  p.initial_stop,
  p.remaining_fraction,
  p.realized_r,
  p.unrealized_r,
  p.realized_pnl,
  p.last_price,
  p.status,
  p.targets,
  p.hit_targets,
  p.max_r_multiple,
  p.expected_horizon_days,
  s.confidence,
  s.entry_stage,
  s.narrative
from positions p
join signals s on s.id = p.signal_id
where p.status in ('open', 'partial');

-- -----------------------------------------------------------------------------
-- Métricas agregadas da conta — o "financeiro" do painel numa só consulta.
-- -----------------------------------------------------------------------------
drop view if exists v_account_summary;

create view v_account_summary as
select
  (select count(*) from positions where status in ('open', 'partial'))          as open_positions,
  (select count(*) from positions where status in ('closed', 'stopped'))        as closed_positions,
  (select coalesce(sum(realized_r), 0) from positions)                          as total_realized_r,
  (select coalesce(sum(unrealized_r), 0) from positions
     where status in ('open', 'partial'))                                       as total_unrealized_r,
  (select count(*) from positions where status in ('closed', 'stopped')
     and realized_r > 0.05)                                                     as wins,
  (select count(*) from positions where status in ('closed', 'stopped')
     and realized_r < -0.05)                                                    as losses,
  (select count(*) from signals where status = 'pending')                       as pending_signals,
  (select count(*) from signals)                                                as total_signals;

-- RLS: as vistas herdam as políticas das tabelas de base, mas o `anon` precisa
-- de poder selecioná-las explicitamente.
grant select on v_open_positions to anon, authenticated;
grant select on v_account_summary to anon, authenticated;
