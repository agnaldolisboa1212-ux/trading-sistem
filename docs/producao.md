# Pôr o sistema a correr todos os dias

## O que corre

| Processo | O que faz | Ritmo |
|---|---|---|
| **Motor principal** | MMXM + SMT sobre velas diárias; grava diagnósticos e sinais; gere as posições paper (preenchimentos, alvos, stops) | 22:15 UTC, dias úteis (`SCAN_CRON`) |
| **Motor de tempo real** | As 4 estratégias institucionais em 15m e 1h, sobre o que os utilizadores escolheram; anuncia sinais novos | A cada minuto (`INTRADAY_CRON`), só pede velas quando fecha uma nova |
| **Painel** | App, gráficos ao vivo no browser, análise ao vivo no terminal, conta Deriv, envio de push | Contínuo |

Os avisos saem por **Telegram**, **n8n** e **push** (via painel). Nenhum dos motores envia ordens.

---

## Comandos

```bash
npm run sistema             # motores + painel (desenvolvimento), reinicia se caírem
npm run sistema:producao    # igual, com o painel compilado
npm run engine:scan         # uma passagem do motor principal
npm run engine:tempo-real   # uma passagem do motor de tempo real
npm run engine:estado       # o que o agendador gravou da última vez
npm test                    # testes do núcleo e do motor
```

---

## 1. Supabase — uma vez

Abrir **SQL Editor → New query**, colar o conteúdo de
[`supabase/APLICAR_NO_SUPABASE.sql`](../supabase/APLICAR_NO_SUPABASE.sql) e carregar em **Run**.

Cria, por esta ordem (e pode correr-se de novo sem estragar nada):

| Migração | Tabelas | Para quê |
|---|---|---|
| 0003 | `perfis_utilizador` | Preferências do onboarding, com RLS por pessoa |
| 0004 | `push_subscricoes` + colunas `objetivos`, `avisos_ativos`, `montante_por_operacao` | Estilo de operação e subscrições de push |
| 0005 | `sinais_tempo_real`, `motor_execucoes` | Sinais intradiários e registo dos motores |

Sem isto os motores funcionam na mesma — gravam em `data/*.json` —, mas o
perfil não sincroniza entre dispositivos e o painel só vê os motores se estiver
na mesma máquina.

---

## 2. Variáveis de ambiente

### `.env` na raiz (motores)

| Variável | Valor | Nota |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | do projeto | escrita; nunca no browser |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | do bot | |
| `N8N_WEBHOOK_URL` | do workflow | |
| `MOTOR_SEGREDO` | 64 hex | **igual** ao do painel; gerado automaticamente |
| `DASHBOARD_URL` | `http://localhost:3000` | onde o motor pede o envio de push |
| `INTRADAY_CRON` | `* * * * *` | |
| `INTRADAY_TIMEFRAMES` | `15m,1h` | aceita 1m, 5m, 15m, 30m, 1h, 4h, 1d |
| `INTRADAY_SYMBOLS` | vazio | vazio = o que os utilizadores escolheram |
| `INTRADAY_MIN_R` | `2` | |
| `INTRADAY_MIN_CONVICTION` | `0.5` | 0..1, **não** é probabilidade |
| `DERIV_WS_URL` | vazio | só para sobrepor o endpoint público |

### `apps/dashboard/.env.local` (painel)

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`DERIV_APP_ID`, `DERIV_TOKEN`, `DERIV_LIMITE_ORDEM`, as quatro `VAPID_*` e
**`MOTOR_SEGREDO`** (o mesmo da raiz).

---

## 3. Numa VPS (recomendado)

O push, a PWA e a instalação no telemóvel **exigem HTTPS**. Localhost só serve
para desenvolver.

```bash
git clone … && cd sistema-de-trading
npm ci
npx tsc -b
npm run build -w @trading/dashboard

npm i -g pm2
pm2 start apps/engine/dist/index.js --name motores -- schedule
pm2 start npm --name painel -- run start -w @trading/dashboard
pm2 save && pm2 startup     # sobrevivem a reinícios da máquina
```

À frente do painel, um proxy com certificado (Caddy é o mais curto):

```
trading.seu-dominio.com {
  reverse_proxy localhost:3000
}
```

Na VPS, `DASHBOARD_URL` continua `http://localhost:3000`: o motor fala com o
painel por dentro da máquina.

---

## 4. Hostinger (aplicação Node.js a partir do GitHub)

| Campo | Valor |
|---|---|
| Versão do Node | **22** — o `@supabase/supabase-js` exige ≥ 22; com o 20 dá avisos no build e pode falhar a correr |
| Diretório raiz | `/` — a raiz do repositório, porque o painel depende dos pacotes em `packages/` |
| Instalação | `npm ci` |
| Build | `npm run build` |
| Arranque | `npm start` |

`npm start` arranca os dois motores, o ouvinte da conta e o painel (`next start`),
reinicia-os se caírem e usa a porta que a Hostinger der em `PORT`.

### Variáveis de ambiente

Definem-se no painel da Hostinger — nunca no repositório. Todas as de `.env.example`, e ainda:

| Variável | Valor |
|---|---|
| `NODE_ENV` | `production` — liga o login obrigatório nas rotas da conta |
| `DERIV_OAUTH_REDIRECT` | `https://trivohub.io/api/deriv/oauth/retorno` (o domínio que usar) |
| `COFRE_CHAVE` | nova, 32+ caracteres aleatórios — não reutilize a do computador |
| `DERIV_DONO_EMAIL` | o seu email de login na plataforma |
| `DASHBOARD_URL` | **deixar vazio** — o motor usa a porta de `PORT` |

**As `NEXT_PUBLIC_*` têm de existir antes do build.** O Next copia-as para o código
do browser durante a compilação; se forem definidas depois, o painel fica sem
Supabase até ao deploy seguinte.

**Na Deriv**, registe o mesmo `DERIV_OAUTH_REDIRECT` na aplicação
(developers.deriv.com → Registered apps). Tem de coincidir letra a letra: `https`,
domínio, sem barra no fim.

### O que o erro "Can't resolve '@trading/data'" era

O `.gitignore` tinha `**/data/*.json`, que escondia `packages/data/package.json` e
`packages/data/tsconfig.json`. Sem eles, o pacote não existia para o npm. Corrigido
no commit `e5ff23b`. Se voltar a acontecer com outro pacote:

```bash
git check-ignore -v packages/*/package.json
```

---

## Antes de dinheiro real

1. **Rodar as credenciais** que passaram por conversas e ficheiros partilhados:
   token Deriv, chave secreta do Supabase, token do Telegram, chave da API do n8n.
2. **Conta demo primeiro.** A troca para real está nas Definições e pede confirmação.
3. `DERIV_LIMITE_ORDEM` é um travão contra o dedo escorregar, não gestão de risco.
4. Nenhuma estratégia tem vantagem demonstrada: o MMXM deu 17 operações em 6
   anos com 81% do lucro num único negócio, e as quatro institucionais nunca foram
   backtestadas. O sistema mostra planos; a decisão e o risco são de quem opera.
