-- =============================================================================
-- 0011 — Sessão em que cada pessoa quer ser avisada (Sydney, Tóquio, Londres,
-- Nova Iorque)
--
-- O forex negoceia 24h, mas ninguém está acordado 24h, e a liquidez não é
-- igual a toda a hora. Isto só filtra os AVISOS (push): o sinal continua a
-- nascer e a ficar guardado fora da sessão escolhida, só não acorda o
-- telemóvel. Sinais diários não têm sessão — nunca são filtrados por isto.
--
-- Vazio (o valor por omissão) continua a significar "qualquer hora" — quem
-- nunca abriu esta definição não perde nenhum aviso que já recebia.
--
-- Pode correr-se de novo sem estragar nada.
-- =============================================================================

alter table perfis_utilizador add column if not exists sessoes_sinais text[] not null default '{}'::text[];

comment on column perfis_utilizador.sessoes_sinais is
  'Sessões em que os avisos push chegam: sydney | toquio | londres | nova-iorque. Vazio = qualquer hora.';
