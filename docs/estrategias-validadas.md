# Estratégias validadas — o que gera sinais, e porquê

Só geram sinais as estratégias com **vantagem medida**: positivas dentro e fora
da amostra, depois de spread, e sem depender de um valor exacto de parâmetro.
Tudo o resto continua no gráfico como contexto, mas deixou de gerar sinais.

## Porque mudou

Os 114 sinais reais anunciados entre 15 e 17 de setembro de 2026 deram **15 ganhos
e 32 perdas**. No VWAP houve 1 ganho e 14 perdas, e a convicção era mais alta nas perdas
do que nos ganhos. Um backtest com essas estratégias confirmou que não era azar.

## Como se mediu

- **Walk-forward vela a vela.** Em cada vela a estratégia só vê as velas fechadas até
  ali, exactamente como o motor em produção.
- **Custos.** O spread típico dos CFD da Deriv cTrader é descontado em cada operação.
  No diário também se desconta o financiamento overnight (0,02% do nominal por dia).
- **Numa vela que toca o stop e o alvo, conta o stop.**
- **Dentro e fora da amostra.** As regras escolheram-se com o período mais antigo; o
  mais recente só serviu para confirmar.
- **Robustez.** Variantes vizinhas dos parâmetros também têm de ser positivas.
- **Dados.**
  - Deriv: cerca de um ano, com 15m, 1h, 4h e 1d em 11 instrumentos.
  - Yahoo: 15 anos de diário em índices, ouro, BTC e ETH.

## O que saiu (sem vantagem depois de custos)

Resultado por operação, com alvo de 1R, em velas da Deriv (1 ano):

| Estratégia | Dentro da amostra | Fora da amostra |
|---|---|---|
| Oferta e procura | −0,10R | −0,32R |
| Suporte e resistência | −0,08R | −0,16R |
| Perfil de volume | −0,11R | −0,11R |
| Bandas de VWAP (tudo junto) | −0,01R | +0,03R |
| Pullback em tendência (candidata) | −0,09R | −0,13R |
| RSI(2) intradiário (candidata) | −0,03R | −0,06R |
| MMXM + SMT (motor diário) | 17 operações em 6 anos, 81% do lucro num único negócio | — |

No forex e na cripto de 15m e 1h, o spread custa 0,16 a 0,19R por operação. Nenhuma
geometria de stop e alvo sobrevive a isso sem vantagem real.

## O que ficou

Todas as três são **só de compra**. Nos índices, as vendas não têm vantagem medida.

### 1. Compra na banda −2σ do VWAP — índices, 1h e 4h

- **Instrumentos:** US100, SP500, US30, GER30.
- **Entrada:** fecho abaixo de VWAP do mês − 2σ, com RSI(14) < 30 **ou** σ do mês > 2 ATR.
  Compra ao fecho.
- **Saída:** stop 1σ abaixo da entrada. Metade fecha em +1R; o resto vai a +2R, com o
  stop na entrada depois do primeiro alvo.
- **Medido (Deriv, set/2025–set/2026):** 135 operações, **68% chegaram a +1R antes do
  stop**, +0,41R por operação com a gestão parcial.
- **Fora da amostra (20/07–16/09/2026):** 31 operações, 68%, +0,36R.
- **Diário, 15 anos:** a mesma compra dá +0,15R por operação nas duas metades do período.
- **O filtro de RSI ou σ:** sem nenhuma das duas condições, o resultado caía para 54% e
  +0,06R.

### 2. RSI(2) de Connors — índices, diário

- **Instrumentos:** US100, SP500, US30, GER30.
- **Entrada:** fecho acima da média de 200 dias com RSI(2) < 10. Compra ao fecho.
- **Saída:** primeiro fecho acima da média de 5 dias, ou ao fim de 10 dias. Stop de
  protecção a 2 ATR.
- **Medido (diário, 2011–2026):**

  | Período | Operações | A ganhar | Por operação |
  |---|---|---|---|
  | Até 2020 | 287 | 68% | +0,08R |
  | 2021 em diante | 215 | 71% | +0,18R |

- **Robustez:** positiva nas 24 variantes testadas (RSI < 5/10/15/20, saída na média de
  3/5/10, stop 2/3 ATR).
- **Nos outros índices da Deriv** (FTSE, CAC, Nikkei, Hang Seng…) a vantagem é mais fraca e
  instável. Por isso ficam de fora.

### 3. Tendência de 55 dias — cripto, diário

- **Instrumentos:** BTCUSD, ETHUSD.
- **Entrada:** primeiro fecho acima do máximo dos 55 dias anteriores. Compra ao fecho.
- **Saída:** stop inicial a 2 ATR; depois sai quando o preço perde o mínimo dos últimos 20
  dias. Sem alvo fixo.
- **Medido:**

  | Período | Operações | A ganhar | Por operação |
  |---|---|---|---|
  | Até 2020 | 24 | 58% | muito positivo (bolha de 2017) |
  | 2021 em diante | 33 | 52% | +1,0R |

- **Robustez:** positiva nas 18 variantes testadas (55/20, 20/10, 100/20…).

### 4. Tendência de 55 dias — ouro, diário

- **Instrumento:** XAUUSD. É a mesma regra da cripto, medida à parte.
- **Só compras:** vender o ouro perdeu dinheiro em todas as variantes testadas, nos dois
  períodos.
- **Medido (Dukascopy diário, 2006–2025, com spread e financiamento):**

  | Período | Operações | A ganhar | Por operação |
  |---|---|---|---|
  | 2006–2015 | 18 | 44% | +0,93R |
  | 2016–2025 | 24 | 50% | +0,70R |

- **Robustez:** positiva com canais de 20 a 55 dias (20/10, 55/10, 55/20) e no momentum de
  126 e 252 dias. Os canais muito longos (100/150 dias) falham depois de 2016.
- **Confirmação:** o ouro do Yahoo (2011–2026) dá o mesmo sentido.
- **Limite:** a amostra é pequena, poucas operações por ano.

## Vendas nos índices, cripto e ouro — com mais confluência do que a compra

As quatro regras acima só compram. O utilizador pediu para procurar o lado da venda, mas com
mais confirmação do que a compra tinha, já que o espelho simples ("vende no mesmo ponto em que
comprava, ao contrário") já tinha sido testado nalguns casos e falhado. Testou-se venda com
filtros extra — regime abaixo da média de 200 dias, ADX alto (tendência já a formar-se),
divergência de RSI — walk-forward, com spread e financiamento, nos mesmos dados.

| Estratégia | O que se tentou | Resultado |
|---|---|---|
| VWAP índices, 1h/4h | venda no +2σ, com os mesmos filtros extra | dados intradiários a mais curtos (~1 ano) para separar dentro/fora da amostra com confiança — inconclusivo, não validado |
| Connors RSI(2) índices, diário (15 anos) | venda simétrica (RSI(2)>90, abaixo da SMA200), com e sem SMA200 a descer e ADX>20 | negativa nos dois períodos em quase todas as variantes; nenhuma combinação ficou positiva nos dois — **rejeitado** |
| Tendência 55 dias, ouro, diário | venda no rompimento do mínimo, com ADX e SMA200 | positiva mas fraca até 2018, **claramente negativa desde 2019** (−0,73R, 11% de acerto) — **rejeitado**, confirma o que já se sabia |
| Tendência 55 dias, cripto (BTC, ETH), diário | venda no rompimento do mínimo de 55 dias, abaixo da SMA200 | **positiva nos dois períodos**, e em 36 combinações de canal (20 a 100 dias) e saída (10 a 30 dias) — mas t<1,4 em todas: direcção consistente, confiança estatística ainda fraca |

A venda na cripto foi a única com sinal real: entra como **`tendencia-baixa-cripto`**, em teste
ao vivo (ver abaixo). As outras três ficam de fora — vender índices e vender ouro continuam sem
vantagem, com ou sem confluência extra.

## Forex (EURUSD, GBPUSD, USDJPY, GBPJPY) — o que se testou

Com 20 anos de diário da Dukascopy (2006–2025) e 14 anos de velas de 1 minuto da HistData
(2012–2026, agregadas em 15m, 30m, 1h e 4h), nada passou os dois períodos com margem:

| Família | Resultado |
|---|---|
| Tendência (Donchian, médias, momentum mensal) | positiva até 2015, **negativa desde 2016** |
| RSI(2), IBS, sequências de fechos | ≈ 0R depois de custos |
| Gap de segunda, dias grandes, virada do mês | sem padrão estável |
| Posicionamento COT (contrarian ou a favor dos fundos) | negativo nos dois períodos |
| Sazonalidade por hora | 1–3 pips, menos do que o spread |
| Rompimento do intervalo asiático (London breakout) | pequeno positivo até 2018, negativo desde 2019 |
| Rompimento de dia estreito (NR7) | +0,04R em 20 anos, quase zero até 2015 — demasiado fraco |
| SMT diário + quebra de estrutura (EURUSD↔GBPUSD, pares de iene) | +0,07R só com spread (t=1,8). Cada operação dura ~11 dias: com financiamento de 0,01%/dia cai para +0,015R (t=0,4) na Dukascopy e −0,02R na HistData |
| SMT 15m e 30m (EURUSD↔GBPUSD↔DXY, ouro↔prata↔DXY) | negativo com todos os gatilhos: entrada imediata, quebra de estrutura, VWAP, RSI 50, RSI em extremo, zona de oferta/procura, zona + quebra (−0,02R a −0,29R) |
| SMT 1h e 4h, os mesmos pares e gatilhos | ≈ 0R ou negativo; os poucos positivos não se repetem com outro tamanho de swing nem no outro período |
| SMT ouro↔prata 1h com quebra de estrutura | +0,02 a +0,04R até 2018 (t<1) com financiamento; o ganho de 2019–2026 vem das compras durante a subida do ouro, as vendas ficam em ≈ 0R |

O DXY foi reconstruído com a fórmula da ICE (EURUSD, USDJPY, GBPUSD, USDCAD, USDCHF; a
coroa sueca fica de fora porque a corretora não a cota).

Os pares principais estão entre os mercados mais eficientes que existem: as regras técnicas
simples que funcionavam até 2015 deixaram de funcionar. O ouro tem a tendência de 55 dias
no diário (acima).

## GER30 (DAX) em 30m na abertura de Londres — o que se testou

A abertura de Londres (08:00 em Londres) e a do DAX à vista (09:00 em Frankfurt) caem sempre à
mesma hora UTC — 07:00 no verão, 08:00 no inverno — porque os dois mudam a hora no mesmo dia. É
o momento de mais liquidez do DAX. Testou-se com velas de 1 minuto da HistData (GRXEUR,
jan/2022–ago/2026, agregadas em 30m), custo de 2,5 pontos por operação, uma operação por dia,
saída no máximo no fecho do DAX à vista (15:30 / 16:30 UTC):

| Regra | Resultado |
|---|---|
| Falso rompimento da 1.ª vela (operar contra) | −0,42R por operação — rejeitada |
| Entrar no sentido da 1.ª vela | −0,28R — rejeitada |
| Rompimento da 1.ª vela, alvo fixo de 1R ou 2R | ≈ 0R |
| Rompimento da 1.ª hora (duas velas) | ≈ 0R |
| **Rompimento da 1.ª vela de 30m, a favor da EMA 20 diária, stop a meio da faixa, sai no fecho** | **+0,19R em 611 operações, positiva em 8 de 10 semestres, compras e vendas positivas** |

A melhor variante aguenta EMA de 10, 20 ou 50 dias e janelas de entrada de 2 ou 3 horas, e dá o
mesmo com o fecho diário à meia-noite UTC (como as velas diárias da Deriv). Mas:

- **Sensível ao custo.** A 2,5 pontos é positiva nos dois períodos; a 4 pontos, 2022–2024 fica
  em zero; a 6 pontos só o período recente se aguenta.
- **Depende de tendência.** Por semestre: 2022 +0,04R e +0,45R; 2023 −0,29R e +0,06R; 2024
  +0,28R e +0,38R; 2025 +0,42R e +0,66R; 2026 +0,14R e **−0,53R** (jul–ago, 30 operações). Os
  dados da própria Deriv (mai–set/2026) também dão negativo.

É a melhor ideia intradiária em índices até agora, mas não está validada: entra em teste, só
em conta demo (ver abaixo).

## Em teste ao vivo (sem vantagem medida com confiança)

O utilizador continua a achar que o SMT funciona nestes pares, pediu para procurar o lado da
venda em vez de só comprar, e para operar o DAX na abertura de Londres. Quatro regras
(`packages/core/src/strategies/em-teste.ts`) correm ao vivo, marcadas em todo o lado como
"EM TESTE" — badge amarela em vez de percentagem, convicção 0, aviso no texto do sinal.

- **VWAP ±2σ no forex** (`vwap-forex-teste`) — EURUSD, GBPUSD, GBPJPY, USDJPY · 1h e 4h. Desde
  17/09/2026, revisão a 24/09/2026 (uma semana — sinal frequente).
  A mesma regra dos índices, mas nos dois sentidos (o forex não tem a deriva de subida dos
  índices). Compra 2σ abaixo do VWAP do mês, vende 2σ acima, com RSI(14) em extremo ou o mês
  deslocado mais de 2 ATR. Nunca foi medida nesta forma.
- **SMT sem MMXM** (`smt-teste`) — EURUSD, GBPUSD, XAUUSD, XAGUSD · 15m, 1h e 4h. Desde
  17/09/2026, revisão a 24/09/2026.
  Divergência entre pares correlacionados (EURUSD↔GBPUSD, prata↔ouro) ou contra o DXY sintético,
  só a favor da tendência de 4h (EMA 50 a subir ou a descer). Alvo a +2R; em 15m/1h sai às 20:00
  UTC do dia do sinal (day trade), em 4h ao fim de 12 velas. No backtest 2022–2026: ouro contra
  o DXY em 1h deu **+0,15R por operação, positivo nos dois períodos** — a variante escolhida
  aqui; EURUSD e GBPUSD ficaram em ≈0R ou negativos em todos os tamanhos de swing.
- **Tendência de baixa — cripto** (`tendencia-baixa-cripto`) — BTCUSD, ETHUSD · 1d. Desde
  18/09/2026, revisão a 18/12/2026 (trimestral — a compra teve só 57 sinais em 10–12 anos, uma
  semana não chega para ver um sinal sequer).
  O espelho, em venda, da tendência de 55 dias validada na cripto: fecho abaixo do mínimo dos
  55 dias anteriores E abaixo da média de 200 dias — só entra quando o regime já é de baixa.
  Stop inicial 2 ATR, depois desce com o máximo das últimas 20 velas. No backtest (Yahoo diário,
  2014–2026): positiva nos dois períodos em todas as 36 combinações de canal e saída testadas,
  mas t<1,4 em todas — ver secção acima.
- **Abertura de Londres no DAX** (`abertura-dax-teste`) — GER30 · 30m. Desde 18/09/2026,
  revisão a 18/01/2027 (~2,5 operações por semana: 40 operações levam uns 4 meses). Só conta demo.
  A 1.ª vela de 30m da abertura faz a faixa; nas 3 horas seguintes, o primeiro fecho acima dela
  compra e abaixo vende, só do mesmo lado da EMA 20 diária. Stop no meio da faixa, sem alvo: sai
  no fecho do DAX à vista. Como os outros sinais de 15m e 1h, não sai a 30 minutos de uma notícia
  de alto impacto do euro. Ver a secção do GER30 acima — incluindo o spread máximo de 2,5 pontos.

Se as operações reais forem positivas depois da revisão, cada regra sobe a validada; senão, sai.

## Quem recebe o quê

| Objetivo no onboarding | Timeframes | Estratégias que podem dar sinal |
|---|---|---|
| Day trading | 15m | SMT no forex/ouro (em teste) |
| (escolha nas Definições) | 30m | Abertura de Londres no GER30 (em teste) |
| Intradiário | 1h | VWAP em índices; VWAP e SMT no forex/ouro (em teste) |
| Swing | 4h, 1d | VWAP em índices (4h); VWAP e SMT no forex/ouro (4h, em teste); Connors (1d); tendência cripto e ouro (1d) |
| Investir | 1d | Connors, tendência cripto e ouro; tendência de baixa na cripto (em teste) |

Esta é só a sugestão inicial: em **Definições → Timeframes dos sinais** cada pessoa escolhe
exactamente em quais recebe sinais.

**Prata e sintéticos não recebem sinais fora do teste acima. O ouro recebe na tendência
diária, e no teste em 15m/1h/4h. O forex só recebe sinais em teste.**
- Nenhuma regra validada passou nos dois períodos em nenhum destes.
- Os índices sintéticos da Deriv são gerados por um gerador aleatório. Por construção,
  nenhuma leitura de gráfico tem vantagem sobre eles.

## Notícias e posicionamento dos fundos

- **Calendário de alto impacto** (decisões de juros, CPI, emprego, PIB).
  - **Sinais de 1h:** não saem entre 30 minutos antes e 30 minutos depois de uma destas
    notícias do próprio instrumento.
  - **Sinais de 4h e 1D:** saem com o aviso da notícia.
  - É uma regra de prudência, não uma vantagem medida. Não há histórico gratuito do
    calendário para a testar.
- **COT da CFTC** (gestores de activos e hedge funds em S&P 500, Nasdaq, Dow e Bitcoin):
  foi testado contra as operações do Connors de 2011–2026.
  - O acerto fica entre 70% e 74% com os fundos compradores, vendidos ou neutros.
  - As diferenças trocam de sinal entre os dois períodos.
  - Não melhora os sinais: aparece em Notícias como contexto e não mexe na convicção.
- **Comunicados de política monetária** da Fed, do BCE e do Banco de Inglaterra, com
  ligação para o texto oficial.
- **Rumores, fóruns e "comentários de bastidores"** ficam de fora: não são verificáveis.

## Limites que continuam a existir

- **Pouco histórico intradiário.** Um ano de 1h e 4h é pouco: 135 operações dão um
  intervalo de confiança largo à volta dos 68%.
- **Escolha com os mesmos dados.** Testaram-se muitas combinações. As que ficaram passaram
  fora da amostra e em variantes vizinhas, mas algum optimismo de selecção é inevitável.
- **O passado não garante o futuro.** Uma mudança de regime pode tirar a vantagem.
- **Revisão.** Convém repetir a medição de poucos em poucos meses com dados novos.

## Reproduzir

```bash
npm run build
node scripts/backtest/baixar.mjs
node scripts/backtest/verificar-validadas.mjs
```

O último script corre o código de produção (`packages/core/src/strategies/validadas.ts`)
e imprime os números acima.
