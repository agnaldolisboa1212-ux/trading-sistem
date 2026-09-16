# Sistema de Trading — MMXM & SMT Divergence

Motor de **sinais** de swing trading em escala macro (diário/semanal), construído sobre o
framework do eBook *MMXM & Time* (The Ones That Know) e sobre **SMT Divergence** entre
pares correlacionados.

> **Modo sinal, sem execução.** O sistema analisa, grava e notifica. Não envia ordens a
> nenhuma corretora e não contém adapter de execução. A decisão e a execução são suas.

---

## O que este sistema faz

1. Carrega OHLC diário e semanal de 17 instrumentos (forex, índices US, metais, cripto)
   a partir de APIs públicas, com failover automático entre fontes.
2. Deteta a estrutura ICT: swing points fractais, Fair Value Gaps, order blocks, breakers,
   mitigation blocks, poços de liquidez e CISD/MSS.
3. Constrói a máquina de estados do **Market Maker Model** — consolidação original →
   curva esquerda → Smart Money Reversal → curva direita, com as três fases de entrada.
4. Cruza cada instrumento com os seus pares correlacionados à procura de **SMT divergence**.
5. Aplica a regra dos **macros** (traduzida para escala swing) e o **checklist de 10 pontos**.
6. Emite sinal de entrada com zona, stop, alvos escalonados e dimensionamento por risco.
7. **Acompanha a operação até ao fim**: preenche o sinal quando o preço toca a zona, avalia
   saídas a cada varrimento (alvos, stop, modelo completo, estrutura quebrada, SMT invertido,
   time stop), aplica parciais e move o stop para break-even.
8. Persiste tudo no Supabase, notifica via Telegram e n8n, e mostra no dashboard web.

---

## Arranque rápido

```bash
npm install
```

```bash
npm run build
```

Um varrimento imediato, sem configurar nada (usa só fontes públicas sem chave):

```bash
npm run engine:scan
```

Saída típica — repare que a lista é ordenada por progresso no checklist, o que mostra
quais os setups mais próximos de disparar:

```
    BTCUSD   MMSM  left-curve                   HTF=bearish  checklist= 75% passo= 6 SMT=1
    NZDUSD   MMSM  right-curve-low-risk-entry   HTF=bearish  checklist= 57% passo= 5 SMT=0
    EURUSD   MMBM  right-curve-stage-1          HTF=bullish  checklist= 30% passo= 3 SMT=0
```

Diagnóstico de baixo nível de um instrumento (quantos swings, FVGs, blocos, SMT):

```bash
node scripts/diagnose.mjs EURUSD
```

Backtest walk-forward:

```bash
npm run backtest -w @trading/engine -- EURUSD NQ XAUUSD BTCUSD
```

Testar os canais de notificação com um sinal fictício, antes de haver um a sério:

```bash
npm run test:notify
```

Verificar a ligação ao Supabase e correr um varrimento persistido:

```bash
npm run setup:supabase
```

---

## Estrutura

```
packages/
  core/     motor de estratégia — puro, sem rede nem BD, 100% testável
    indicators/   swings, FVG, order blocks/breakers, CISD/MSS, liquidez, qualidade
    mmxm/         consolidação + máquina de estados do Market Maker Model
    smt/          divergências entre pares correlacionados
    time/         macros traduzidos para escala swing
    signal/       padrões de entrada, checklist de 10 pontos, análise, saídas
    risk/         dimensionamento, alvos em R, expectativa, simulação
  data/     catálogo de 176 APIs públicas + 12 adapters + registry com failover
  db/       repositórios Supabase
  notify/   Telegram + n8n
apps/
  engine/   varrimento agendado + CLI de backtest
  dashboard/ painel web (Next.js)
supabase/migrations/  esquema SQL
```

`packages/core` não faz rede nem lê o relógio (exceto onde recebe `now` injetado). É essa
pureza que torna o backtest reproduzível e cada decisão auditável.

---

## Configuração

Copie `.env.example` para `.env` e preencha o que quiser usar. **Nada é obrigatório**:
sem Supabase o motor imprime na consola; sem Telegram/n8n não notifica; a fonte de dados
principal não precisa de chave.

### Supabase

**1.** Aplique o esquema: abra o SQL Editor do seu projeto e execute, **por esta ordem**:

- `supabase/migrations/0001_initial_schema.sql` — tabelas, índices e RLS
- `supabase/migrations/0002_position_plan.sql` — plano de saída congelado na posição e
  vistas do financeiro

Ambas são idempotentes — podem voltar a correr sem erro.

**2.** Ponha as chaves no `.env`. São **duas, com papéis diferentes**:

| Variável | Chave | Para quê |
|---|---|---|
| `SUPABASE_SECRET_KEY` | `sb_secret_…` | O motor **escreve**. Ignora RLS — só no servidor. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | O painel **lê**. Vai no bundle do browser. |

Ambas em Settings → API Keys. Os nomes legados (`SUPABASE_SERVICE_ROLE_KEY` e
`NEXT_PUBLIC_SUPABASE_ANON_KEY`) também são aceites.

Nunca troque as duas. A publicável é servida ao browser: dar-lhe escrita significaria
que qualquer visitante do painel podia inserir sinais falsos na sua base de dados.

**3.** Verifique tudo de uma vez:

```bash
npm run setup:supabase
```

Confirma o formato da chave, testa uma **escrita real**, valida as 12 tabelas, corre um
varrimento e confirma que as linhas chegaram. Cada falha vem com a instrução para a
resolver, em vez de um stack trace.

O esquema cria tabelas para velas, modelos MMXM, eventos SMT, sinais, posições, curva de
capital, diagnósticos de varrimento, saúde das fontes e corridas de backtest. RLS está
ativo em tudo.

### Telegram

1. `@BotFather` → `/newbot` → copie o token para `TELEGRAM_BOT_TOKEN` no `.env`.
2. Corra `npm run setup:telegram` e envie `/start` ao seu bot quando ele pedir.

O script fica à espera da primeira mensagem, extrai o `chat_id`, grava-o no `.env` e envia
uma confirmação. O `chat_id` não existe antes dessa mensagem — é uma proteção do Telegram
para um bot não poder escrever a quem nunca o contactou.

Para validar com um sinal completo: `npm run test:notify`.

### n8n

Crie um workflow com nó **Webhook** (POST) e cole o Production URL em `N8N_WEBHOOK_URL`.
Eventos enviados: `signal.entry`, `signal.exit`, `scan.completed`, `system.error`.
Defina `N8N_WEBHOOK_SECRET` e valide o header `X-Webhook-Secret` no n8n — sem isso qualquer
pessoa que descubra o URL consegue disparar o seu workflow.

### Dashboard

```bash
npm run dashboard:dev
```

Três vistas:

| Rota | O que mostra |
|---|---|
| `/` | Radar dos 17 instrumentos: modelo, fase, fluxo HTF, SMT e em que critério o checklist parou |
| `/instrumento/[símbolo]` | Gráfico de velas ao estilo TradingView com o MMXM anotado, seletor de timeframe, gráficos de SMT por par e o checklist completo |
| `/financeiro` | R acumulado, taxa de acerto, expectativa, distribuição de resultados, curva de capital e histórico de posições |

O painel avisa automaticamente quando a melhor operação representa mais de metade do
lucro, e quando a amostra tem menos de 30 operações — as duas armadilhas que fazem uma
estratégia sem vantagem parecer lucrativa.

#### Gráfico

Velas com volume, crosshair com etiquetas nos dois eixos, legenda OHLC, linha do último
preço, zoom pela roda e pan por arrasto. Por cima, a estrutura detetada: consolidação
original, FVGs por preencher, marcador do Smart Money Reversal, draw on liquidity e — quando
há sinal — zona de entrada, stop e alvos.

**Timeframes:** 1h · 4h · 1d · 1w, no URL (`?tf=4h`), com o HTF a subir um nível
(1h→4h, 4h→1d, 1d→1w, 1w→1M).

As janelas macro estão calibradas para escala swing. Em 1h e 4h a estrutura continua
válida mas o passo 4 do checklist mede o ciclo errado — o painel avisa em vez de fingir
que o resultado é comparável.

**Atualização ao minuto.** O gráfico mostra as velas fechadas **mais a que está em
formação**; a análise usa só as fechadas. Sem essa separação, um refresh por minuto no
diário mostraria dados idênticos o dia inteiro (a última vela fechada não muda), e deixar
a vela viva entrar na análise geraria CISD e MSS que desaparecem na vela seguinte. A
atualização pausa quando o separador está escondido, para não gastar quota das APIs.

`apps/dashboard/.env.local` precisa de `NEXT_PUBLIC_SUPABASE_URL` e
`NEXT_PUBLIC_SUPABASE_ANON_KEY`. Nunca a `service_role` — esse código vai para o browser.

### Agendamento

Um varrimento único:

```bash
npm run engine:scan
```

Agendador contínuo (por omissão às 22:15 UTC de segunda a sexta — depois do fecho de Nova
Iorque, com a vela diária já fechada):

```bash
npm run engine:dev
```

O horário controla-se com `SCAN_CRON` no `.env`. Analisar antes do fecho significaria
decidir sobre uma vela em formação, e o CISD/MSS depende de fechamentos confirmados.

### Domínio próprio

O painel e o motor têm requisitos diferentes de alojamento:

| Componente | Onde | Porquê |
|---|---|---|
| `apps/dashboard` | Vercel, Netlify | Server Components; escala a zero entre visitas |
| `apps/engine` | Railway, Fly.io, VPS | Precisa de processo vivo para o cron |

No painel da Vercel defina `NEXT_PUBLIC_SUPABASE_URL` e
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, aponte o DNS do domínio e está feito. Nunca
defina lá a chave secreta — esse ambiente é servido ao browser.

Alternativa sem processo vivo: um cron externo (GitHub Actions, cron-job.org) que corra
`npm run engine:scan` uma vez por dia.

---

## A estratégia

Detalhe completo em [`docs/estrategia.md`](docs/estrategia.md). Em resumo:

**MMXM** — consolidação que engenheira liquidez de um lado, curva esquerda que varre a
liquidez oposta, Smart Money Reversal, curva direita que entrega até à consolidação e
depois até ao draw on liquidity. Três fases de entrada: Low Risk Buy/Sell → 1ª fase de
Acumulação/Distribuição → Silver Bullet.

**SMT** — mercados correlacionados (NQ/ES, EURUSD/GBPUSD, XAU/XAG, BTC/ETH) devem formar
topos e fundos ao mesmo tempo; inversamente correlacionados (EURUSD/DXY) em sentidos
opostos. Quando isso quebra, há *crack in correlation*. O eBook é explícito: só conta
dentro da narrativa e de um point of interest — e é assim que está implementado.

**Macros em escala swing** — o eBook usa janelas de XX:45–XX:15. Como aqui operamos
diário/semanal, o mesmo conceito é fractalizado um nível acima: janela de reversão semanal
(segunda a quarta), de expansão semanal (quarta a sexta), reversão mensal (dias 1–5 e
10–16) e shift trimestral. As duas regras de execução do eBook mantêm-se literalmente.

**True Unicorn** — Breaker Block + Fair Value Gap + Balanced Price Range sobrepostos. É o
padrão de maior qualidade e o motor prefere-o a qualquer outro.

---

## Sobre o objetivo de 1:5 a 1:10

"Entrar com 100 USD e sair com 500 a 1000 USD" só fecha matematicamente se esses 100 USD
forem o valor **em risco** — a perda total caso o stop seja atingido. Isso significa
arriscar 100% do capital alocado numa única operação.

O sistema dimensiona por **percentagem de risco** (0,5%–2%, o intervalo institucional)
porque alvos de 5R–10R têm taxa de acerto baixa. A 5R basta ~17% de acertos para não
perder dinheiro — mas só chega lá quem sobrevive à sequência de perdas pelo caminho. Com
1% por operação, dez perdas seguidas custam ~10% da conta; com 100%, a primeira perda
acaba com tudo.

`simulateSequence()` em `packages/core/src/risk/sizing.ts` permite testar qualquer
configuração com números concretos antes de decidir.

---

## Correr em localhost

O painel funciona **sem configurar nada**. O motor grava um snapshot local a cada
varrimento e o dashboard lê-o quando o Supabase não está configurado:

```bash
npm run engine:scan
```

```bash
npm run dashboard:dev
```

Abra `http://localhost:3000`. O painel mostra o radar dos 17 instrumentos, em que critério
do checklist cada um parou, os sinais emitidos e a saúde das fontes de dados.

O snapshot (`data/latest-scan.json`) é só a fotografia do último varrimento — não guarda
histórico nem acompanha posições. Para isso configure o Supabase; o painel passa a usá-lo
automaticamente assim que houver dados lá.

---

## Estado da validação — leia antes de arriscar dinheiro

O backtest é walk-forward e **não tem lookahead**: a série é refatiada a cada passo e a
análise só vê velas até à data simulada, com o relógio simulado passado à regra dos macros.
Os fills são conservadores (pior preço da zona, só em vela posterior ao sinal) e, quando
uma vela toca stop e alvo, assume-se o **stop**. As perdas saem exatamente a −1,00R.

### Veredicto: o sistema NÃO tem vantagem demonstrada

Sobre ~6 anos de dados diários e 17 instrumentos, com `MIN_CONFIDENCE=0.6`:

| Métrica | Valor |
|---|---|
| Operações fechadas | 34 |
| Taxa de acerto | 47% |
| R total | **+20,3R** |
| Expectativa | +0,60R/operação |

Números que parecem bons. Não são. Duas análises desmontam-nos:

**1. Um único negócio é 81% do lucro.**

```
melhor operação   XAUUSD  +16,32R
sem a 1ª melhor    +3,93R  (33 operações)
sem as 2 melhores  +0,19R  (32 operações)
sem as 3 melhores  −3,50R  (31 operações)
```

Tirando uma operação de ouro, o sistema fica praticamente em zero. Tirando três, fica
negativo. Isto é a assinatura de um resultado por acaso, não de uma vantagem.

**2. O filtro de qualidade seleciona ao contrário.**

A análise de sensibilidade mostra que subir `MIN_CONFIDENCE` **piora** o resultado:

| conf | operações | R total | expectativa |
|---|---|---|---|
| 0,40 | 51 | +39,3R | +0,77 |
| 0,50 | 53 | +37,3R | +0,70 |
| 0,60 | 34 | +20,3R | +0,60 |
| 0,70 | 9 | **−2,4R** | **−0,27** |

Um filtro de qualidade que funciona deveria melhorar a expectativa ao apertar. Este faz o
oposto. E a coluna do melhor negócio cai de 16,3R para 2,0R entre 0,60 e 0,70 — ou seja,
a 0,70 o filtro elimina precisamente a operação que sustentava todo o lucro, e o que resta
é negativo.

### O que isto significa

- O framework **funciona mecanicamente**: deteta modelos, produz sinais, e a cauda de
  múltiplos altos que a estratégia procura chega mesmo a aparecer.
- Mas 34 operações concentradas num único vencedor **não suportam nenhuma conclusão**. O
  intervalo de confiança é largo demais para distinguir isto de ruído.
- A pontuação de confiança, mesmo depois de corrigida para discriminar, **não ordena os
  sinais por qualidade real**. Os sinais que ela classifica como melhores perdem dinheiro.

### Antes de expor capital

1. Obter amostra: mais instrumentos, mais história (`BACKTEST_CANDLES`), e testar em
   períodos separados (treino/validação) para não ajustar aos mesmos dados.
2. Investigar porque a confiança seleciona ao contrário — provavelmente `model.confidence`
   e a qualidade do padrão não medem o que se pensa que medem.
3. Correr semanas em paper e comparar com o backtest. Divergência grande = o backtest está
   otimista algures.
4. Só então, e com risco mínimo, considerar dinheiro real.

**Neste momento a resposta honesta à pergunta "isto dá dinheiro?" é: não se sabe, e a
evidência disponível não é encorajadora.**

---

## Nota sobre a qualidade dos dados

O forex vem dos **futuros da CME** (`6E`, `6B`, `6A`, `6N`, `6S`, `6J`, `6C`), não dos
símbolos spot. Os símbolos spot do Yahoo devolvem `open` praticamente igual a `close` — o
corpo medido é ~2% do range, contra ~49% num OHLC real. Isso destrói silenciosamente tudo
o que depende do corpo da vela: displacement, order blocks, CISD e a própria cor da vela.
Com os spot, o detector produzia **zero** order blocks em 400 velas, sem qualquer erro.

Os futuros de `6S`, `6J` e `6C` cotam o recíproco (CHF/USD em vez de USD/CHF) e são
invertidos na leitura, com maxima e minima trocadas.

`assessOhlcQuality()` corre antes de qualquer análise e recusa séries degeneradas com uma
mensagem explícita, em vez de as processar em silêncio.

---

## Catálogo de APIs

`packages/data/src/catalog.ts` é gerado a partir do repositório
[public-apis](https://github.com/public-apis/public-apis) e contém as **176 fontes** das
secções Finance, Cryptocurrency, Currency Exchange e Blockchain, com autenticação exigida,
capacidades e classes de ativo. 62 não precisam de chave; 12 têm adapter implementado.

Regenerar quando o upstream mudar:

```bash
npm run catalog:sync -w @trading/data
```

Consultar por capacidade em código:

```ts
import { sourcesFor, keylessSources } from '@trading/data';
sourcesFor('ohlc', 'forex');   // fontes de OHLC de forex, por ordem de failover
keylessSources('crypto-spot'); // fontes de cripto que não pedem chave
```

---

## Aviso

Este software é uma ferramenta de análise, não aconselhamento financeiro. Não constitui
recomendação de investimento. A maioria dos investidores de retalho perde dinheiro em
trading alavancado, e é possível perder a totalidade do capital. Não negoceie com dinheiro
que não pode perder.
