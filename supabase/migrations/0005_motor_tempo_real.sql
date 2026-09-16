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
