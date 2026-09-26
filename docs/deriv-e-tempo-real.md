# Deriv, tempo real e produção

O que ficou ligado, como funciona, e o que ainda não é verdade.

---

## 1. A ligação à Deriv não estava avariada — nunca tinha sido feita

A página de definições dizia *"Corretora (Deriv) — sem token"*. Estava escrito
no código, à mão. Nenhuma linha do sistema alguma vez tinha perguntado nada à
Deriv.

Perguntando, a conta responde:

| Conta | Tipo | Saldo |
|---|---|---|
| `ROT92260651` | real | 0,00 USD |
| `DOT93844232` | demo | 10 000,00 USD |

### Porque é que os tokens não funcionavam antes

Os tokens `pat_…` **não servem** na API antiga da Deriv. Testado:

```
wss://ws.derivws.com/websockets/v3?app_id=1089  +  authorize: pat_...
   -> InvalidToken: The token is invalid.
```

Pertencem à API **nova**, que tem uma forma diferente e não está documentada
lado a lado com a antiga:

```
1. REST   POST https://api.derivws.com/trading/v1/options/accounts/{id}/otp
          headers: Deriv-App-ID: <app>   Authorization: Bearer pat_...
          -> { data: { url: "wss://api.derivws.com/.../ws/demo?otp=XXXX" } }

2. Abrir esse WebSocket. A sessão já vem ligada à conta — NÃO se envia
   `authorize`, ao contrário da API antiga.

3. Daí em diante o protocolo é o MESMO da API antiga:
   {balance:1}, {portfolio:1}, {statement:1}, {proposal:1}, {buy:...}
```

Alguns campos foram renomeados — `symbol` passou a `underlying_symbol`. Pedir
com o nome antigo devolve `InputValidationFailed: Properties not allowed`.

O REST tem apenas dois caminhos: `GET /accounts` e `POST /accounts/{id}/otp`.
Tudo o resto (404) vive no WebSocket.

**Onde está:** `apps/dashboard/lib/deriv/conta.ts` — com `import 'server-only'`
no topo, para o build falhar se algum componente de cliente lhe tocar.

---

## 2. O atraso do gráfico: o servidor era o atraso

A versão anterior sondava `/api/preco` de 10 em 10 segundos. Cada sondagem era
`browser → Next → provider → Deriv → volta`. O preço mostrado tinha, em média,
cinco segundos de atraso; no pior caso, dez. Era isso que se via ao comparar
com o TradingView lado a lado.

A correção não foi sondar mais depressa. Foi tirar o servidor do caminho:

```
wss://api.derivws.com/trading/v1/options/ws/public     ← sem token
{ticks_history, style:'candles', granularity, subscribe:1}
   -> uma mensagem `ohlc` POR SEGUNDO com a vela em formação
{ticks, subscribe:1}
   -> um tick por segundo
```

O endpoint é público — verificado: `balance` responde `AuthorizationRequired`,
`candles` responde com dados. **Nenhum token de corretora chega ao browser.**

Uma só ligação serve a aplicação inteira, multiplexada por `req_id` e por
`subscription.id`. Vinte cartões de preço são vinte subscrições num socket, não
vinte sockets.

**Onde está:** `apps/dashboard/lib/deriv/live.ts`.

### Três defeitos encontrados a medir, não a ler

**O eixo do gráfico arrancava em zero.** A escala vertical interpola até ao
alvo, e o sentinela de arranque era `{min:0, max:1}`. O teste de encaixe
(`|max-min| < 1e-12`) nunca passava, porque a diferença é 1. Num instrumento a
6525 o eixo subia de zero durante meio segundo — e num separador em segundo
plano, onde `requestAnimationFrame` não corre, ficava congelado a meio: eixo a
4524, preço a 6525, e nem uma vela visível. O sentinela passou a `NaN`, e uma
diferença maior do que uma amplitude encaixa de imediato (trocar de instrumento).

**Mercado fechado apagava o histórico.** `ticks_history` com `subscribe:1`
devolve `MarketIsClosed` e recusa o pedido **inteiro**, histórico incluído. O
mesmo pedido sem `subscribe` responde com as velas todas. O carregamento passou
a ter duas fases — histórico primeiro, fluxo depois. Sem isto, o S&P, o Nasdaq,
o Dow e o DAX mostravam um travessão sempre que a bolsa estava fechada, que é a
maior parte do tempo.

**Uma subscrição órfã silenciava um par para sempre.** Em modo estrito o React
monta, desmonta e volta a montar. A sequência era: pedir → desmontar antes de o
`id` chegar (logo, sem `forget`) → pedir de novo → `AlreadySubscribed` → nunca
mais chega `id`. Medido: `tick:frxGBPUSD` com `AlreadySubscribed` e `id: null`,
enquanto o `frxXAUUSD`, que escapou à corrida, funcionava. As subscrições
passaram a sobreviver dez segundos sem ouvintes, e um `AlreadySubscribed`
reinicia o socket.

**E o dano colateral disso:** reiniciar o socket resolve as subscrições, mas
rejeita todos os pedidos únicos em voo. A fita do Início faz dez pedidos de
histórico ao mesmo tempo — bastava um `AlreadySubscribed` para os dez voltarem
vazios. `pedir()` passou a repetir uma vez quando a falha é de ligação.

---

## 3. Toda a gente é analisada, ninguém fica "desconhecido"

O motor MMXM tem um universo fechado de 17 instrumentos, porque o SMT precisa de
**pares** correlacionados definidos à mão. Mas o onboarding deixa escolher tudo
o que a Deriv negoceia. Quem escolhesse GER30 ou um sintético via *"instrumento
desconhecido"* no radar — o que, para quem os acabou de escolher, lê-se como
avaria.

Agora há duas vias:

| Via | Para quê | O que devolve |
|---|---|---|
| `mmxm` | os 17 com pares SMT | progresso do checklist (9 passos) |
| `institucional` | tudo o resto | convicção do melhor plano das 4 estratégias |

Mais um mapa de equivalências: `US100 → NQ`, `SP500 → ES`, `US30 → YM`. São o
mesmo mercado com contratos diferentes (índice à vista contra futuro) — os
preços diferem, e por isso as fontes nunca se misturam na mesma série, mas a
estrutura é a mesma. A resposta diz qual foi analisado.

**As duas pontuações não medem a mesma coisa** e o painel diz qual é qual.
Servem ambas para ordenar, e nada mais.

**Onde está:** `apps/dashboard/lib/analise-deriv.ts` e
`apps/dashboard/app/api/radar/[symbol]/route.ts`.

---

## 4. Execução: o que o sistema faz e o que nunca faz

`/api/deriv/ordem` **só corre quando uma pessoa toca no botão**. Não há nada no
sistema que a chame: nem o motor de sinais, nem o agendador, nem o worker de
notificações. Verificável:

```bash
grep -rn "api/deriv/ordem" --include=*.ts --include=*.tsx apps packages
```

O único chamador é `components/vivo/Negociar.tsx`, num `onClick`.

Cinco travões, por ordem:

1. `propostaId` obrigatório — não se compra sem ter pedido preço primeiro
2. `precoMaximo` — a Deriv rejeita se o preço subiu entretanto
3. `confirmacao` tem de ser exatamente `'sim'` — não aceita `true` nem `1`
4. conta real exige `aceitoRisco: true` **além** da confirmação
5. tecto por ordem (`DERIV_LIMITE_ORDEM`, por omissão 100)

A conta activa vive num cookie `httpOnly` — a escolha entre demo e real decide
para onde vai dinheiro verdadeiro, e um valor que o JavaScript da página
consegue reescrever não é sítio para essa decisão. Por omissão: **demo**.
Passar para real pede confirmação escrita; voltar para demo não. A assimetria é
deliberada: o erro caro só acontece numa direção.

---

## 5. O que continua sem estar demonstrado

Nada nesta ronda mudou isto, e vale a pena repeti-lo antes de pôr dinheiro:

- o backtest do MMXM deu **17 operações em 6 anos**
- **um** negócio em ouro (+16,32R) vale **81%** de todo o lucro
- retirar os três melhores deixa o resultado em **−3,50R**
- as quatro estratégias institucionais **nunca foram backtestadas** — o que
  existe são 18 testes de guarda e frequências medidas (ver
  `estrategias-institucionais.md`)

O software funciona. É uma afirmação sobre o software.

---

## 6. Antes de pôr em produção

Por ordem de importância:

1. **Rodar as credenciais.** O token da Deriv, a chave secreta do Supabase, o
   token do bot do Telegram e a chave da API do n8n apareceram todos em texto
   nesta conversa. Rodar é mais rápido do que decidir se importa.
2. **Aplicar a migração `0003`** no projeto Supabase real, se ainda não estiver.
3. **`DERIV_LIMITE_ORDEM`** — o valor por omissão (100) é um travão contra o
   dedo escorregar, não gestão de risco. Ajustar conscientemente.
4. **HTTPS obrigatório** — o service worker e as notificações push não arrancam
   sem ele, e a app não instala.
5. **Manter `EXECUTION_MODE=paper`** até haver amostra. Não muda nada no
   comportamento (nenhuma ordem sai sozinha em modo nenhum), mas marca os
   registos.

---

## 7. Horário das bolsas — porque diz "fechado" a meio da semana

Porque está mesmo. Medido na API da Deriv a 2026-09-15, tudo em **UTC**:

| Instrumento | Sessão |
|---|---|
| `OTC_SPC`, `OTC_NDX`, `OTC_DJI` (S&P, Nasdaq, Dow) | 06:00 → 20:00 |
| `OTC_GDAXI` (DAX) | 06:00 → 19:30 |
| `frxEURUSD` e restante forex | 00:00 → 23:59, de segunda a sexta |
| `frxXAUUSD` (ouro) | 00:00 → 21:00 **e** 22:00 → 23:59 |
| `cryBTCUSD`, `R_75`, `1HZ100V` | 24 horas, todos os dias |

Em Luanda ou Maputo (UTC+1/+2) isto quer dizer que às 00:45 de uma quarta-feira
os índices estão fechados há horas — às 22:45 UTC de terça. Não é avaria: é a
bolsa de Nova Iorque a dormir.

O que **era** um defeito: a app escrevia só "fechado", sem dizer quando reabre,
e "fechado" sozinho não distingue "a bolsa está fechada" de "não consegui ler o
preço". Agora mostra **"abre 08:00"** na hora local de quem está a ver, com os
horários vindos de `trading_times` e o estado de `active_symbols` — os dois da
própria Deriv, não de uma tabela escrita à mão que envelhece em silêncio.

Ao fim de semana e de madrugada, o que continua a mexer são a cripto e os
índices sintéticos. É por isso que a lista por omissão do onboarding os inclui.

## 8. "Falha a obter as velas: Deriv RateLimit" — o limite é por ligação

Medido a 26/09/2026 contra o endpoint público:

| Teste | Resultado |
|---|---|
| 90 pedidos em série (36 s) | todos OK |
| 60 pedidos de 3500 velas em série (44 s) | todos OK |
| 30 pedidos em paralelo (1,3 s) | todos OK |
| rajada: 220 pedidos em 6 s | **RateLimit** ("You have reached the rate limit for ticks_history") |
| ligação nova, logo a seguir | OK — o limite é **por ligação**, não por IP |
| a ligação bloqueada | volta a responder ao fim de **~54 s** |

O painel e o motor têm UMA ligação cada, partilhada por todas as rotas e
utilizadores. Os agentes (todas as séries de todos os instrumentos, a cada
minuto), os sinais e as abas do ICT e do Asia Range — abertos em mais do que um
dispositivo — faziam rajadas que passavam o limite; a ligação ficava quase um
minuto a recusar tudo, e as repetições de cada pedido recusado (1 s, 2,5 s,
5 s) mantinham-na bloqueada.

A correção (`packages/data/src/providers/ritmo.ts` e `deriv.ts`):

- **Travão por ligação** (balde de fichas): 15 pedidos de seguida, depois 2 por
  segundo, no máximo 4 em voo — no pior caso 135 num minuto. O resto espera na
  fila (até 30 s).
- **RateLimit não se repete.** A ligação pára 55 s e, nesse tempo, serve-se a
  última cópia guardada (até 15 min).
- **`velasFechadasDeriv`**: as rotas de análise só usam velas fechadas, que só
  mudam quando fecha a vela seguinte — a cópia vale até lá (um diário pede-se
  uma vez por dia, não a cada minuto). A rota do Asia Range passou a guardar a
  análise até ao fecho da vela de 15M, como o ICT.

Verificado contra a Deriv: 60 séries diferentes pedidas de uma vez passaram
todas em 23 s, sem RateLimit; pedidas outra vez, vieram da cache em 0,01 s.
