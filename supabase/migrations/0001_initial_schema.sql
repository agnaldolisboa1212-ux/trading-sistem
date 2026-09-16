-- =============================================================================
-- Sistema de Trading MMXM + SMT — esquema inicial
--
-- Principio: um sinal tem de ser AUDITAVEL meses depois. Por isso guardamos nao
-- so o preco de entrada, mas o checklist completo, o modelo MMXM e os eventos
-- SMT que o justificaram. Sem isso e impossivel distinguir uma estrategia que
-- funciona de uma sequencia de sorte.
--
-- Aplicar com:  supabase db push
-- =============================================================================

create extension if not exists "uuid-ossp";

-- -----------------------------------------------------------------------------
-- Instrumentos monitorizados
-- -----------------------------------------------------------------------------
create table if not exists instruments (
  symbol          text primary key,
  name            text        not null,
  asset_class     text        not null check (asset_class in ('forex','index','metal','crypto','commodity')),
  price_precision smallint    not null default 5,
  tick_size       numeric     not null default 0.0001,
  continuous      boolean     not null default false,
  active          boolean     not null default true,
  created_at      timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Velas
--
-- A chave primaria composta (symbol, timeframe, open_time) torna a ingestao
-- idempotente: reprocessar o mesmo dia nao duplica nada.
-- `source` e `fidelity` ficam gravados para que uma analise antiga possa ser
-- reproduzida sabendo de onde vieram os dados.
-- -----------------------------------------------------------------------------
create table if not exists candles (
  symbol     text        not null references instruments(symbol) on delete cascade,
  timeframe  text        not null check (timeframe in ('1h','4h','1d','1w','1M')),
  open_time  timestamptz not null,
  open       numeric     not null,
  high       numeric     not null,
  low        numeric     not null,
  close      numeric     not null,
  volume     numeric     not null default 0,
  source     text        not null,
  fidelity   text        not null default 'true-ohlc' check (fidelity in ('true-ohlc','synthetic')),
  ingested_at timestamptz not null default now(),
  primary key (symbol, timeframe, open_time),
  constraint candles_high_ge_low check (high >= low)
);

create index if not exists candles_symbol_tf_time_idx
  on candles (symbol, timeframe, open_time desc);

-- -----------------------------------------------------------------------------
-- Modelos MMXM detectados
-- -----------------------------------------------------------------------------
create table if not exists mmxm_models (
  id                     uuid primary key default uuid_generate_v4(),
  symbol                 text        not null references instruments(symbol) on delete cascade,
  timeframe              text        not null,
  model_type             text        not null check (model_type in ('MMBM','MMSM')),
  direction              text        not null check (direction in ('bullish','bearish')),
  phase                  text        not null,
  entry_stage            text,
  consolidation_high     numeric     not null,
  consolidation_low      numeric     not null,
  consolidation_start_at timestamptz not null,
  consolidation_end_at   timestamptz not null,
  engineered_side        text,
  engineered_touches     smallint    not null default 0,
  left_curve_extreme     numeric,
  smr_at                 timestamptz,
  smr_price              numeric,
  smr_confidence         numeric,
  smr_components         jsonb,
  right_curve_legs       smallint    not null default 0,
  target_level           numeric     not null,
  invalidation_level     numeric,
  confidence             numeric     not null default 0,
  notes                  jsonb       not null default '[]'::jsonb,
  detected_at            timestamptz not null default now(),
  unique (symbol, timeframe, consolidation_start_at, model_type)
);

create index if not exists mmxm_models_symbol_idx on mmxm_models (symbol, detected_at desc);

-- -----------------------------------------------------------------------------
-- Eventos SMT (crack in correlation)
-- -----------------------------------------------------------------------------
create table if not exists smt_events (
  id              uuid primary key default uuid_generate_v4(),
  primary_symbol  text        not null references instruments(symbol) on delete cascade,
  reference_symbol text       not null,
  correlation     text        not null check (correlation in ('positive','inverse')),
  direction       text        not null check (direction in ('bullish','bearish')),
  formed_at       text        not null check (formed_at in ('high','low')),
  degree          text        not null check (degree in ('short','intermediate','long')),
  weak_side       text        not null check (weak_side in ('primary','reference')),
  strength        numeric     not null,
  occurred_at     timestamptz not null,
  primary_price   numeric     not null,
  reference_price numeric     not null,
  description     text        not null,
  detected_at     timestamptz not null default now(),
  unique (primary_symbol, reference_symbol, occurred_at, formed_at)
);

create index if not exists smt_events_symbol_time_idx
  on smt_events (primary_symbol, occurred_at desc);

-- -----------------------------------------------------------------------------
-- Sinais
--
-- `checklist` guarda os 10 passos com o detalhe textual de cada um — e a
-- justificacao completa da decisao, em formato consultavel.
-- -----------------------------------------------------------------------------
create table if not exists signals (
  id                   text primary key,
  symbol               text        not null references instruments(symbol) on delete cascade,
  timeframe            text        not null,
  kind                 text        not null check (kind in ('entry','exit','update','invalidation')),
  direction            text        not null check (direction in ('bullish','bearish')),
  status               text        not null default 'pending',
  mode                 text        not null default 'paper' check (mode in ('paper','live')),

  generated_at         timestamptz not null,
  reference_price      numeric     not null,

  entry_zone_low       numeric     not null,
  entry_zone_high      numeric     not null,
  entry_price          numeric     not null,
  stop_loss            numeric     not null,
  targets              jsonb       not null default '[]'::jsonb,
  max_r_multiple       numeric     not null default 0,

  position_units       numeric,
  position_notional    numeric,
  risk_amount          numeric,

  model_id             uuid references mmxm_models(id) on delete set null,
  entry_stage          text,
  entry_pattern_kind   text,
  entry_pattern_quality numeric,

  checklist            jsonb       not null default '{}'::jsonb,
  checklist_score      numeric     not null default 0,
  confidence           numeric     not null default 0,
  expected_horizon_days smallint,

  narrative            text,
  warnings             jsonb       not null default '[]'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists signals_status_idx on signals (status, generated_at desc);
create index if not exists signals_symbol_idx on signals (symbol, generated_at desc);

-- -----------------------------------------------------------------------------
-- Posicoes (paper por omissao)
-- -----------------------------------------------------------------------------
create table if not exists positions (
  id                 uuid primary key default uuid_generate_v4(),
  signal_id          text        not null references signals(id) on delete cascade,
  symbol             text        not null references instruments(symbol) on delete cascade,
  direction          text        not null check (direction in ('bullish','bearish')),
  mode               text        not null default 'paper' check (mode in ('paper','live')),

  opened_at          timestamptz not null,
  closed_at          timestamptz,
  filled_price       numeric     not null,
  initial_units      numeric     not null,
  remaining_fraction numeric     not null default 1 check (remaining_fraction between 0 and 1),
  current_stop       numeric     not null,
  hit_targets        jsonb       not null default '[]'::jsonb,

  realized_r         numeric     not null default 0,
  realized_pnl       numeric     not null default 0,
  unrealized_r       numeric     not null default 0,
  status             text        not null default 'open'
                       check (status in ('open','partial','closed','stopped')),
  close_reason       text,
  updated_at         timestamptz not null default now()
);

create index if not exists positions_status_idx on positions (status, opened_at desc);

-- -----------------------------------------------------------------------------
-- Eventos de saida aplicados a uma posicao
-- -----------------------------------------------------------------------------
create table if not exists position_events (
  id             uuid primary key default uuid_generate_v4(),
  position_id    uuid        not null references positions(id) on delete cascade,
  reason         text        not null,
  close_fraction numeric     not null,
  price          numeric     not null,
  r_multiple     numeric     not null default 0,
  new_stop_loss  numeric,
  narrative      text,
  occurred_at    timestamptz not null,
  created_at     timestamptz not null default now()
);

create index if not exists position_events_position_idx on position_events (position_id, occurred_at);

-- -----------------------------------------------------------------------------
-- Curva de capital (snapshot diario)
-- -----------------------------------------------------------------------------
create table if not exists equity_snapshots (
  id             uuid primary key default uuid_generate_v4(),
  taken_at       timestamptz not null default now(),
  mode           text        not null default 'paper',
  balance        numeric     not null,
  open_risk      numeric     not null default 0,
  open_positions smallint    not null default 0,
  realized_pnl   numeric     not null default 0,
  unrealized_pnl numeric     not null default 0,
  unique (taken_at, mode)
);

-- -----------------------------------------------------------------------------
-- Diagnostico por varrimento — permite ver PORQUE nao houve sinal
--
-- Esta tabela e o que impede o sistema de ser uma caixa preta: em dias sem
-- sinal fica registado em que passo do checklist cada instrumento parou.
-- -----------------------------------------------------------------------------
create table if not exists scan_diagnostics (
  id               uuid primary key default uuid_generate_v4(),
  scan_id          uuid        not null,
  symbol           text        not null,
  timeframe        text        not null,
  htf_order_flow   text,
  model_type       text,
  model_phase      text,
  checklist_score  numeric     not null default 0,
  failed_at_step   smallint,
  smt_count        smallint    not null default 0,
  summary          text,
  scanned_at       timestamptz not null default now()
);

create index if not exists scan_diagnostics_scan_idx on scan_diagnostics (scan_id);
create index if not exists scan_diagnostics_symbol_idx on scan_diagnostics (symbol, scanned_at desc);

-- -----------------------------------------------------------------------------
-- Saude das fontes de dados
-- -----------------------------------------------------------------------------
create table if not exists provider_health (
  provider_id          text primary key,
  ok                   boolean     not null default true,
  latency_ms           integer,
  last_success_at      timestamptz,
  last_error_at        timestamptz,
  last_error           text,
  consecutive_failures smallint    not null default 0,
  updated_at           timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Registo de notificacoes enviadas (evita duplicados no Telegram)
-- -----------------------------------------------------------------------------
create table if not exists notifications (
  id          uuid primary key default uuid_generate_v4(),
  channel     text        not null check (channel in ('telegram','n8n','webhook')),
  signal_id   text references signals(id) on delete cascade,
  event_key   text        not null,
  payload     jsonb       not null default '{}'::jsonb,
  delivered   boolean     not null default false,
  error       text,
  sent_at     timestamptz not null default now(),
  unique (channel, event_key)
);

-- -----------------------------------------------------------------------------
-- Corridas de backtest
-- -----------------------------------------------------------------------------
create table if not exists backtest_runs (
  id              uuid primary key default uuid_generate_v4(),
  label           text,
  symbols         text[]      not null,
  timeframe       text        not null,
  period_start    timestamptz not null,
  period_end      timestamptz not null,
  config          jsonb       not null default '{}'::jsonb,
  total_trades    integer     not null default 0,
  wins            integer     not null default 0,
  losses          integer     not null default 0,
  win_rate        numeric,
  average_r       numeric,
  expectancy      numeric,
  max_drawdown_pct numeric,
  final_balance   numeric,
  trades          jsonb       not null default '[]'::jsonb,
  created_at      timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Row Level Security
--
-- Este sistema e de utilizador unico: o motor escreve com a service_role key
-- (que ignora RLS) e o dashboard le com a anon key. Por isso ativamos RLS em
-- tudo e damos apenas leitura ao anon — nenhuma escrita chega do browser.
-- -----------------------------------------------------------------------------
alter table instruments       enable row level security;
alter table candles           enable row level security;
alter table mmxm_models       enable row level security;
alter table smt_events        enable row level security;
alter table signals           enable row level security;
alter table positions         enable row level security;
alter table position_events   enable row level security;
alter table equity_snapshots  enable row level security;
alter table scan_diagnostics  enable row level security;
alter table provider_health   enable row level security;
alter table notifications     enable row level security;
alter table backtest_runs     enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'instruments','candles','mmxm_models','smt_events','signals','positions',
    'position_events','equity_snapshots','scan_diagnostics','provider_health',
    'backtest_runs'
  ]
  loop
    execute format('drop policy if exists %I on %I', 'read_' || t, t);
    execute format(
      'create policy %I on %I for select to anon, authenticated using (true)',
      'read_' || t, t
    );
  end loop;
end $$;

-- A tabela de notificacoes pode conter tokens em `payload`; fica fora do anon.
drop policy if exists read_notifications on notifications;
create policy read_notifications on notifications
  for select to authenticated using (true);

-- -----------------------------------------------------------------------------
-- Vista de resumo para o dashboard
-- -----------------------------------------------------------------------------
create or replace view v_open_positions as
select
  p.id,
  p.symbol,
  p.direction,
  p.opened_at,
  p.filled_price,
  p.current_stop,
  p.remaining_fraction,
  p.realized_r,
  p.unrealized_r,
  p.status,
  s.max_r_multiple,
  s.confidence,
  s.entry_stage,
  s.narrative
from positions p
join signals s on s.id = p.signal_id
where p.status in ('open','partial');
