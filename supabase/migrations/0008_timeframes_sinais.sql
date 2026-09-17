-- =============================================================================
-- 0008 — Timeframes dos sinais escolhidos pela própria pessoa
--
-- Até aqui os timeframes dos sinais saíam só do objetivo do onboarding
-- (intradiário 1h, swing 4h e 1D...). Quem opera sabe em que timeframe opera:
-- a escolha explícita nas Definições passa a mandar; vazio = sugestão do
-- objetivo.
--
-- Pode correr-se de novo sem estragar nada.
-- =============================================================================

alter table perfis_utilizador
  add column if not exists timeframes_sinais text[] not null default '{}';

comment on column perfis_utilizador.timeframes_sinais is
  'Timeframes de sinal escolhidos (15m, 1h, 4h, 1d). Vazio = os do objetivo do onboarding.';
