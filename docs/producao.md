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
| 0006 | `sinais_ocultos` | Sinais que cada pessoa eliminou da sua lista |
| 0007 | colunas `estado`, `stop_actual`, `resultado_r`, `eventos` em `sinais_tempo_real` | Avisos de andamento sem repetir depois de um deploy |

As migrações 0006 e 0007 estão em `supabase/migrations/` — colar cada ficheiro
no SQL Editor e carregar em **Run**.

Sem isto os motores funcionam na mesma — gravam em `data/*.json` —, mas o
perfil não sincroniza entre dispositivos e o painel só vê os motores se estiver
na mesma máquina.

### Contas (Authentication)

A app só abre com sessão iniciada (`apps/dashboard/middleware.ts`): cada pessoa
cria a sua conta, faz o seu onboarding e liga a sua Deriv. No Supabase:

1. **Authentication → URL Configuration**: *Site URL* `https://trivohub.io`;
   *Redirect URLs* `https://trivohub.io/**`. Sem isto os links dos emails voltam
   para `localhost`.
2. **Authentication → Emails → SMTP Settings**: ligar um servidor de email próprio.
   **Sem ele o Supabase só envia emails para os membros do projecto, e no máximo 2
   por hora** — os outros utilizadores nunca recebem a confirmação nem a
   recuperação. Com um email da Hostinger (ex. `nao-responder@trivohub.io`): host
   `smtp.hostinger.com`, porta `465`, utilizador = o email, a palavra-passe dele.
3. **Authentication → Sign In / Providers → Email**: *Confirm email* ligado;
   *Minimum password length* 8.
4. **Authentication → Emails → Templates** (recomendado): em *Confirm signup*,
   *Reset password* e *Magic link*, acrescentar o código `{{ .Token }}` ao texto.
   Dentro da app instalada no telemóvel o link abre no browser, que é outra sessão;
   o código de seis dígitos escreve-se na própria app.
5. **Authentication → Multi-Factor**: *TOTP* ligado (vem ligado por omissão). É o
   que permite a verificação em dois passos nas Definições.

Quem gere o servidor vê, nas Definições, as integrações e as chaves: os emails em
`ADMIN_EMAILS` (ou, sem ela, `DERIV_DONO_EMAIL`).

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
| Framework preset | **Express** (ou Other) — **não** Next.js |
| Versão do Node | **22** — o `@supabase/supabase-js` exige ≥ 22; com o 20 dá avisos no build e pode falhar a correr |
| Root directory | `./` (raiz do repositório) — o painel depende dos pacotes em `packages/` |
| Build command | `npm run build` |
| Output directory | `saida` |
| Entry file | `server.js` (lido dentro de `saida/`) |

**Como a Hostinger lê estes campos** (regras de deploy dela, no repositório
`hostinger/hostinger-templates`):

- O **Entry file é procurado DENTRO da Output directory**: aqui, `saida/server.js`.
  O build copia o `server.js` para lá. Com uma Output directory que não o tenha (por
  exemplo `.next`), o deploy falha **depois** de um build verde, com a análise a dizer
  que `server.js` "não existe".
- A aplicação **não corre na pasta onde foi compilada**: corre de um checkout do
  repositório com o `node_modules`, **sem nada do que o build gerou** (os Runtime logs
  deram `FALTA` em `packages/*/dist`, `apps/engine/dist` e na compilação do painel). O
  que passa do build para a aplicação é a **Output directory**. Por isso o último passo
  do build (`scripts/preparar-saida.mjs`) junta tudo em `saida/`, com a mesma estrutura
  do repositório.
- **Sem Entry file** não arranca processo nenhum: serve a Output directory como site
  estático. Para esta aplicação isso dá **404 em todas as páginas**.
- **Ligações simbólicas partem o deploy.** Por isso o build já não cria o `.next` na
  raiz, e apaga o que builds antigos lá deixaram.
- O preset **Next.js** tem pipeline próprio e não sabe lidar com um monorepo — o
  painel vive em `apps/dashboard`, não na raiz.

`server.js` é um só processo que **escuta ele próprio** na porta `PORT` e arranca os
motores e o ouvinte da conta como processo filho, reiniciando-o se cair. É também o
`main` e o `npm start` do `package.json`.

**Como a Hostinger o arranca.** Não é com `node server.js`: o `.htaccess` do domínio
entrega os pedidos ao LiteSpeed, que carrega a aplicação com o `lsnode.js`. Isso impõe
três regras ao `server.js`, todas já cumpridas — não as desfaça:

- O `lsnode` faz **`require()`** do ficheiro. Por isso é **CommonJS e sem `await` no
  topo**, e a raiz do repositório não declara `"type": "module"`. Um módulo ES com
  `await` no topo dá `ERR_REQUIRE_ASYNC_MODULE` e o site fica em **503**.
- **Só a primeira chamada a `listen()` conta**, e liga ao socket do LiteSpeed (a porta
  é ignorada); as outras são ignoradas sem aviso. A escuta interna do motor usa o
  `listen` original.
- No arranque, se a compilação não estiver no sítio, o `server.js` **repõe-a a partir
  de `saida/`** (segundos). Só se nem aí existir compila ali mesmo (1 a 3 minutos, a
  responder 503 "a compilar"); `COMPILAR_NO_ARRANQUE=nao` desliga isso. Compilar no
  arranque é frágil: o alojamento limita os processos por conta (`spawn node EAGAIN`),
  por isso o Next usa `experimental.cpus: 1`.
- O LiteSpeed **arranca vários processos** da aplicação ao mesmo tempo. Trincos em
  ficheiro (`*.trinco` na pasta da aplicação) garantem que só um prepara a compilação e
  **só um corre os motores**; se esse morrer, outro fica com eles no minuto seguinte.
- O painel compila, em produção, para `apps/dashboard/compilado` (em desenvolvimento
  continua `.next`).
- O LiteSpeed pode **parar a aplicação quando não há visitas** e arrancá-la no pedido
  seguinte — e os motores vão com ela. Se o painel mostrar os motores parados sem
  ninguém ter mexido, é isto. Resolve-se com um pedido periódico, por exemplo uma
  tarefa Cron no hPanel a cada 5 minutos: `curl -s https://trivohub.io/api/motores`.

Para correr só o painel, sem motores: `MOTORES=desligados`.

**`tsc: command not found` no build.** Com o preset Express a Hostinger instala só as
`dependencies` (sem as `devDependencies`). Por isso o TypeScript e os `@types/*` de
que o build precisa estão nas `dependencies` da raiz — não os devolva a
`devDependencies`.

**Build verde mas "Deployment build failed".** Quase sempre é a Output directory
errada: tem de ser `saida`, com o Entry file `server.js`. As vulnerabilidades do
`npm audit` **não** travam deploys — a Hostinger só propõe um pull request.

**Deploy verde mas o domínio responde 404 ("This Page Does Not Exist").** O Entry
file está vazio. **Se responde 503**, a aplicação morreu ao arrancar. Nos dois casos,
veja os **Runtime Logs** (não o log do build): deve aparecer
`[servidor] painel a responder em socket do LiteSpeed (Node 22…)` e depois
`[servidor] Next pronto`. Se aparecer `AVISO: a compilação não está no sítio`, as
linhas seguintes dizem, ficheiro a ficheiro, o que existe na pasta da aplicação e em
`saida/`.

**Ficheiros antigos no domínio.** Se o `public_html` do domínio tiver ficheiros de
outro site — `sw.js`, `manifest.webmanifest` — o servidor web entrega-os ANTES de
chegar à aplicação. Um `sw.js` alheio instala o service worker errado no browser de
quem visita. Apague-os no Gestor de Ficheiros.

### Variáveis de ambiente

Definem-se no painel da Hostinger — nunca no repositório. Todas as de `.env.example`, e ainda:

| Variável | Valor |
|---|---|
| `NODE_ENV` | `production` — liga o login obrigatório nas rotas da conta |
| `DERIV_OAUTH_REDIRECT` | `https://trivohub.io/api/deriv/oauth/retorno` (o domínio que usar) |
| `COFRE_CHAVE` | nova, 32+ caracteres aleatórios — não reutilize a do computador |
| `DERIV_DONO_EMAIL` | o seu email de login na plataforma |
| `ADMIN_EMAILS` | opcional; quem vê o estado do servidor nas Definições (por omissão, `DERIV_DONO_EMAIL`) |
| `DERIV_TOKEN_NO_PAINEL` | **não definir**. Em produção cada pessoa, o dono incluído, entra com a própria conta Deriv; o `DERIV_TOKEN` fica só para os motores |
| `DASHBOARD_URL` | **deixar vazio** — o motor usa a porta de `PORT` |
| `CTRADER_CLIENT_ID` | Client ID da aplicação cTrader Open API (negociação CFD) |
| `CTRADER_CLIENT_SECRET` | Client Secret da mesma aplicação — só no painel da Hostinger |
| `CTRADER_REDIRECT` | `https://trivohub.io/api/ctrader/oauth/retorno` (obrigatória em produção) |
| `CTRADER_LIMITE_LOTES` | opcional; volume máximo por ordem, em lotes (por omissão `1`) |

**As `NEXT_PUBLIC_*` têm de existir antes do build.** O Next copia-as para o código
do browser durante a compilação; se forem definidas depois, o painel fica sem
Supabase até ao deploy seguinte.

**Na Deriv**, registe o mesmo `DERIV_OAUTH_REDIRECT` na aplicação
(developers.deriv.com → Registered apps). Tem de coincidir letra a letra: `https`,
domínio, sem barra no fim.

### Negociação CFD — Deriv cTrader

As contas que o painel negoceia são as **Deriv cTrader** (CFD) de cada pessoa, pela
cTrader Open API. A API da Deriv não negoceia MT5, e a de opções não serve para CFD.

1. Em [openapi.ctrader.com](https://openapi.ctrader.com) → *Applications* → *Add new
   app*. Em *Redirect URIs* ponha `https://trivohub.io/api/ctrader/oauth/retorno` —
   letra a letra, sem barra no fim. A aprovação pela Spotware pode demorar.
2. Copie o Client ID e o Client Secret para as variáveis `CTRADER_*` acima, na
   Hostinger. Também é precisa a `COFRE_CHAVE`: é ela que cifra os tokens no cookie.
3. Cada pessoa precisa de uma conta Deriv cTrader (comece pela demo, criada no painel
   da Deriv). Depois: **Definições → Corretora → Ligar conta Deriv cTrader**, entrar com
   o cTrader ID e autorizar.

O que o painel faz com a ligação: saldo e capital, ordens a mercado, limite e stop com
SL/TP, colar a ordem de um sinal, modificar SL/TP e preço, fechar tudo ou parte, e
cancelar pendentes. Cada acção pede confirmação; na conta real pede também que se
marque que se percebe o risco. Os tokens ficam no servidor e nunca chegam ao browser.

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
3. `CTRADER_LIMITE_LOTES` é um travão contra o dedo escorregar, não gestão de risco.
4. Nenhuma estratégia tem vantagem demonstrada: o MMXM deu 17 operações em 6
   anos com 81% do lucro num único negócio, e as quatro institucionais nunca foram
   backtestadas. O sistema mostra planos; a decisão e o risco são de quem opera.
