-- =============================================================================
-- 0013 — Configuração das notificações (push) de cada pessoa
--
-- Que avisos chegam ao telemóvel e como se mostram:
--
--   entradas    sinais de entrada das estratégias (true)
--   alertas     alertas de setup — ICT ALGO, Asia Range, venda no VWAP (true)
--   operacoes   o que acontece a uma operação aberta: alvo, stop, saída por
--               tempo (true)
--   ambito      'portfolio' (só os instrumentos e timeframes do perfil) ou
--               'tudo' (tudo o que o motor anuncia no Telegram)
--   fixo        o aviso fica no ecrã até lhe tocar (popup) (false)
--   silencioso  sem som nem vibração (false)
--
-- Vazio ('{}', o valor por omissão) = os valores entre parênteses e o âmbito
-- 'portfolio': quem nunca abriu esta definição recebe o mesmo que antes.
--
-- Pode correr-se de novo sem estragar nada.
-- =============================================================================

alter table perfis_utilizador add column if not exists avisos_config jsonb not null default '{}'::jsonb;

comment on column perfis_utilizador.avisos_config is
  'Notificações push: {entradas, alertas, operacoes, ambito: portfolio|tudo, fixo, silencioso}. Vazio = omissão.';
