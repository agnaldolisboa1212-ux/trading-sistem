-- =============================================================================
-- 0007 — Acompanhamento das operações: estado, stop em vigor e eventos avisados
--
-- O motor passa a avisar o andamento de cada sinal (entrada, +1R, alvo, stop,
-- saída pela regra, stop móvel, mudança de viés). Para não avisar o mesmo evento
-- duas vezes — nem depois de um reinício ou de um novo deploy — guarda aqui os
-- que já avisou.
--
-- Pode correr-se de novo sem estragar nada.
-- =============================================================================

alter table sinais_tempo_real add column if not exists estado text;
alter table sinais_tempo_real add column if not exists stop_actual numeric;
alter table sinais_tempo_real add column if not exists resultado_r numeric;
alter table sinais_tempo_real add column if not exists eventos jsonb not null default '[]'::jsonb;
alter table sinais_tempo_real add column if not exists acompanhado_em timestamptz;

comment on column sinais_tempo_real.estado is
  'a-aguardar-entrada | em-curso | protegida | fechada | expirado | perdido';
comment on column sinais_tempo_real.eventos is
  'Eventos já avisados: [{tipo, em, preco, resultadoR, chave}].';

create index if not exists sinais_tempo_real_estado_idx
  on sinais_tempo_real (estado, gerado_em desc);
