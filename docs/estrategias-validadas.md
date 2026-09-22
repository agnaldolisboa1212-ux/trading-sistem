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
  stop**, +0,41R por operação com a gestão parcial. **Atenção: em 4,7 anos de HistData a
  mesma regra dá ≈0R — ver o aviso mais abaixo.**
- **Fora da amostra (20/07–16/09/2026):** 31 operações, 68%, +0,36R.
- **Diário, 15 anos:** a mesma compra dá +0,15R por operação nas duas metades do período.
- **O filtro de RSI ou σ:** sem nenhuma das duas condições, o resultado caía para 54% e
  +0,06R.

### 2. RSI(2) de Connors — índices, Nikkei e bitcoin, diário

- **Instrumentos:** US100, SP500, US30, GER30, JP225 e BTCUSD (os dois últimos acrescentados
  em 21/09/2026 — ver "Alargar o catálogo" mais abaixo).
- **Entrada:** fecho acima da média de 200 dias com RSI(2) < 10. Compra ao fecho.
- **Saída:** primeiro fecho acima da média de 5 dias, ou ao fim de 10 dias. Stop de
  protecção a 2 ATR.
- **Medido (diário, 2011–2026):**

  | Período | Operações | A ganhar | Por operação |
  |---|---|---|---|
  | Até 2020 | 469 | 67% | +0,09R (t=2,7) |
  | 2021 em diante | 335 | 72% | +0,18R (t=5,0) |

- **Robustez:** positiva nas 24 variantes testadas (RSI < 5/10/15/20, saída na média de
  3/5/10, stop 2/3 ATR).
- **Nos outros índices** a regra foi medida uma a uma em 21/09/2026: o Nikkei passou (+0,16R,
  t=2,3, positivo nas duas metades) e entrou; FTSE e SMI eram positivos até 2020 e passaram a
  negativos depois; CAC, Hang Seng, AUS200, NL25 e EU50 ficaram abaixo da barra. Ver a secção
  "Alargar o catálogo".

### 3b. Rompimento de 20 velas a favor da tendência — ouro e USDJPY, 4h

- **Instrumentos:** XAUUSD e USDJPY. **Timeframe:** 4h. **Day trade:** a operação vive 24 horas.
- **Entrada:** fecho acima do máximo das 20 velas anteriores, com a EMA 50 acima da EMA 200.
  Compra ao fecho. Não há segundo sinal enquanto não passarem 6 velas.
- **Saída:** stop a 1,5 ATR; alvo a +2R; se em 6 velas não tocar em nenhum, sai ao fecho.
- **Medido (HistData de 1 minuto agregada em 4h, 2012–2026, com o código de produção):**
  734 operações, **53% fecharam a ganhar**, **+0,16R por operação**, t=4,0, 11 de 15 anos
  positivos. Fora da amostra (jul/2024 em diante): 138 operações, 64%, +0,42R.
- **Por instrumento:** o ouro é que carrega (+0,25R, t=4,4, aguenta o spread a TRIPLICAR); o
  USDJPY dá +0,07R (t=1,3).
- **Frequência:** cerca de 1 sinal por semana nos dois instrumentos.
- Reproduzir: `node scripts/backtest/verificar-rompimento-4h.mjs`.

### 3. Tendência de 55 dias — cripto, ouro e Nikkei, diário

- **Instrumentos:** BTCUSD e ETHUSD (cripto), XAUUSD (ouro) e JP225 (Nikkei, acrescentado em
  21/09/2026: 35 operações, +1,07R, t=1,5, positivo nas duas metades).
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

## Alargar o catálogo: as mesmas regras noutros mercados (21/09/2026)

As estratégias diárias validadas foram medidas em TODOS os instrumentos com 15 anos de histórico
(Yahoo, 2011–2026), com o código de produção e as mesmas regras conservadoras: spread,
financiamento overnight de 0,02%/dia, uma operação de cada vez, escolha até 2020 e confirmação de
2021 em diante. A barra é a das validadas: positivo nas DUAS metades, t≥1,5 e pelo menos 30
operações.

**RSI(2) de Connors** (fecho acima da média de 200 dias com RSI(2)<10):

| Mercado | Resultado | Decisão |
|---|---|---|
| Nikkei (JP225) | 110 ops, 68%, **+0,16R**, t=2,3 · +0,09R até 2020 e +0,27R depois · 11/14 anos+ | **entra** |
| Bitcoin | 118 ops, 71%, **+0,10R**, t=1,7 · +0,06R e +0,13R · 8/11 anos+ | **entra** |
| EU50 | 103 ops, +0,085R, t=1,4, positivo nas duas metades | fica de fora (t<1,5) |
| AUS200, NL25 | +0,04R e +0,03R, t<1 | fora |
| UK100, SWI20 | positivos até 2020, **negativos** de 2021 em diante | fora |
| FRA40, HK50, ouro, prata, ETH, EURUSD, GBPUSD | ≈0R ou negativo | fora |

**Tendência de 55 dias** (a regra da cripto e do ouro):

| Mercado | Resultado | Decisão |
|---|---|---|
| Nikkei (JP225) | 35 ops, 37%, **+1,07R**, t=1,5 · +0,93R até 2020 e +1,37R depois · 9/15 anos+ | **entra** |
| Hang Seng (HK50) | +0,24R, t=1,0, positivo nas duas metades | fora (t<1,5) |
| Prata | +0,52R, t=0,7 | fora |
| CAC, AUS200, SMI, NL25, EU50, UK100 | negativos, alguns muito (−0,38R a −0,50R) | fora |

**Segunda passagem (22/09/2026): todo o universo negociável.** Com 15 anos de diário para os 28
instrumentos que a corretora oferece — índices, metais, cripto e os dez pares de forex — só
apareceu mais um:

| Mercado | Connors | Decisão |
|---|---|---|
| **Paládio (XPDUSD)** | 74 ops, 68%, **+0,16R**, t=1,5 · +0,17R até 2020 e +0,11R depois · 8/12 anos+ | **entra, na fronteira** |
| Platina (XPTUSD) | −0,08R, primeira metade −0,29R | fora |
| EURJPY, EURGBP | +0,04R, t<1 | fora |
| USDJPY | +0,00R | fora |
| AUDUSD, NZDUSD, USDCHF, USDCAD, EURUSD, GBPUSD | negativos | fora |

O paládio passa por pouco: com o spread a dobrar cai para +0,11R (t=1,1) e a triplicar para
+0,07R, embora continue positivo nas duas metades em todos os casos. É um mercado fino —
**confirme o spread no cTrader antes de o operar**. Nenhum par de forex passou no Connors, e na
tendência de 55 dias não apareceu nada de novo em todo o universo.

O Nikkei entrou nas duas, o bitcoin no Connors. **Nenhum deles entrou no VWAP intradiário**: essa
regra vive em 1h e 4h e nunca foi medida nestes mercados. As listas de instrumentos passaram a ser
uma por estratégia, exactamente para impedir que um mercado aprovado no diário entre sem querer
no intradiário.

## Procurar um sistema de day trade: onde está, matematicamente, o RR alto (21/09/2026)

O pedido foi directo: um sistema de day trade em 1h–4h, com sinais toda a semana, não um
swing trade que dá um sinal por mês. A procura foi feita em quatro fases, e cada fase decidiu a
seguinte.

### Fase 1 — a geometria do payoff, sem regra nenhuma

Antes de inventar regras, mede-se o que o mercado oferece: entra-se em TODAS as velas, stop a
1 ATR, e conta-se quantas vezes o preço chega a +kR antes de −1R em 24 horas. A referência é
matemática: num passeio aleatório, isso acontece 1/(1+k) das vezes.

| Alvo | Precisa de | Índices (compra) | Forex | O que sobra depois do custo |
|---|---|---|---|---|
| 1R | 50,0% | 49–52% | 48–50% | −0,03R a −0,12R |
| 2R | 33,3% | 33–35% | 32% | −0,02R a −0,11R |
| 3R | 25,0% | 22–25% | 22% | +0,06R (só GER30) a −0,11R |

**A 1h–4h o mercado é quase um jogo justo.** A vantagem incondicional é de 0 a 2 pontos
percentuais, e só do lado da compra em índices — a deriva de longo prazo das acções. Tudo o
resto fica negativo depois de custos.

A excursão contrária mediana é de **1,18 ATR** em 24 horas. Um stop de 1 ATR está DENTRO do
ruído: é stopado mais de metade das vezes independentemente da direcção que o preço acabe por
tomar.

### Fase 1b — o plano stop × alvo

Varrendo stops de 0,5 a 3 ATR contra alvos de 1R a 3R, o que aparece é o peso do custo:

| Stop | Custo em R (índices, 1h) | Custo em R (metais, 1h) |
|---|---|---|
| 0,5 ATR | 22% de R | 53% de R |
| 1 ATR | 7% | 25% |
| 1,5 ATR | 4% | 16% |

**Qualquer sistema de day trade com stops apertados morre do spread antes de chegar ao mercado.**
Daí as escolhas da fase seguinte: stop de 1,5 ATR e 4h, onde o ATR é grande o suficiente para o
custo pesar ~4%.

### Fase 2 — que condição de entrada bate o jogo justo

Oito famílias de entrada × três alvos × três timeframes, agregadas por GRUPO de mercados (nunca
por mercado, para não escolher o vencedor no ruído de um só), em 1h, 2h e 4h:

| Família | Melhor resultado | Veredicto |
|---|---|---|
| **Rompimento de 20 velas a favor da tendência (só compras)** | **4h: +0,05R forex (t=2,0), +0,11R metais (t=2,9)** | **passa nas duas metades** |
| Compressão de volatilidade + rompimento | 2h índices +0,19R (t=1,7) | primeira metade +0,54R, segunda +0,03R — a decair |
| Rompimento nos dois sentidos | 4h forex +0,03R (t=1,6) | o lado da venda dilui |
| Recuo à EMA 20 em tendência | ≈0R | fora |
| RSI(2) em tendência, 2σ, engolfo | ≈0R ou negativo | fora |

### Fase 3 — robustez

Todos os vizinhos do vencedor continuam positivos: N de 10 a 50, stop de 1 a 2,5 ATR, alvo de
1,5R a 4R, horizonte de 12h a 96h, EMA curta de 20 a 100 e longa de 100 a 300. Mas:

- **em 1h a regra é NEGATIVA** (−0,03R, t=−1,7) e em 2h é marginal (+0,02R, t=1,2). A vantagem
  vive em **4h**;
- **em índices é negativa** (−0,04R): o rompimento intradiário não funciona lá;
- **com o lado da venda incluído, piora** (+0,025R em vez de +0,05R).

### Fase 4 — o teste que matou metade do resultado

Dois pares que NÃO participaram na escolha (USDCAD e USDCHF) deram **negativo**: −0,01R e
−0,08R. E por instrumento, dos seis que escolheram a regra:

| Instrumento | Por operação | t |
|---|---|---|
| **XAUUSD (ouro)** | **+0,24R** | **4,1** |
| USDJPY | +0,09R | 1,8 |
| GBPJPY, XAGUSD | +0,04R | <1 |
| EURUSD, GBPUSD | ≈0R | ≈0 |

A vantagem do grupo era quase toda do ouro. **Por isso a estratégia entra só com ouro e USDJPY** —
e o catálogo di-lo em vez de o esconder atrás da média do grupo.

Detalhe que mudou o resultado a meio: no backtest só há uma operação de cada vez, e a regra
escrita no código tem de fazer o mesmo. Sem o arrefecimento de 6 velas entram operações
sobrepostas no mesmo movimento e a vantagem cai para metade (+0,035R em vez de +0,076R).

### O que isto dá, em concreto

**1 sinal por semana**, cada um a durar no máximo 24 horas. Não é o "toda a semana em várias
operações" que se pediu — é o que os dados sustentam. Para mais frequência sem perder honestidade
seria preciso encontrar outra regra que passe a mesma barra, não alargar esta a mercados onde ela
foi medida e falhou.

## O perfil de volume reforça os sinais? Não (22/09/2026)

Ideia testada: juntar o perfil (POC, área de valor) à melhor regra intradiária para "fortalecer"
os sinais. Uma nota primeiro, porque muda o que se pode dizer: **a Deriv e a HistData não dão
volume negociado no forex** — o campo `volume` da HistData é a contagem de minutos com dados
(60 em 80 540 das 86 615 velas de 1h do ouro). O que se pode construir é um perfil **TPO**, tempo
passado em cada preço — o Market Profile original do Steidlmayer, não volume a sério.

Nove filtros × duas janelas, sobre o rompimento de 4h no ouro e no USDJPY:

| Filtro | Operações | R/operação | Descarta | As descartadas valiam |
|---|---|---|---|---|
| sem filtro | 750 | +0,161R | — | — |
| **vácuo acima (<10% do tempo)** | 618 | **+0,203R** | 132 | **−0,036R** |
| POC a 1+ ATR abaixo | 671 | +0,183R | 79 | −0,031R |
| entrada acima da VAH | 606 | +0,170R | 144 | +0,120R |
| perto do POC (±0,5 ATR) | 20 | −0,164R | 730 | +0,170R |

Os dois primeiros pareciam reais: melhoravam o que ficava E descartavam operações negativas.
**E depois o teste fora da amostra matou-os.** Nos quinze instrumentos que não participaram na
escolha — os oito pares onde a regra falha, a prata e cinco índices — o filtro do vácuo dá:

| | Sem filtro | Com filtro | Diferença |
|---|---|---|---|
| 15 instrumentos, 3637 operações | −0,024R | −0,022R | **+0,002R** |

Nada. Oito instrumentos melhoram, sete pioram. Os +0,24R do ouro eram **ruído de selecção**:
testaram-se 18 combinações e escolheu-se a melhor. É o erro clássico do backtest, e só o teste
em dados que não participaram na escolha o apanha.

**O perfil não entrou no sistema.** Continua a ser desenhado como contexto no gráfico, que é o
que ele é: uma leitura de onde o preço passou tempo, não um preditor.
Reproduzir: `node scripts/backtest/perfil-como-filtro.mjs`.

## Power of 3 (AMD) em 15m — testado e recusado (22/09/2026)

Pedido: testar o Power of 3 (acumulação, manipulação, distribuição + POI) nos pares de forex em
15 minutos, e acrescentá-lo **se** fosse lucrativo, com capacidade de reconhecer sinais falsos.
Foi testado; não é. Fica aqui porque um teste bem feito que diz "não" vale tanto como um que diz
"sim" — e evita repetir a ideia daqui a seis meses.

**Como se traduziu a ideia em regra medível** (`scripts/backtest/power-of-3.mjs`):

| Fase | Regra |
|---|---|
| Acumulação | o intervalo da sessão asiática, 00:00–06:00 UTC |
| Manipulação | durante Londres (07:00–12:00 UTC) o preço varre um dos lados desse intervalo |
| Distribuição | entra-se CONTRA a varredura quando uma vela fecha de volta para dentro |
| POI / stop | stop do outro lado da varredura; alvo no lado oposto do intervalo, ou 1R/2R/3R |
| Saída | fecha às 20:00 UTC — day trade |

**Os filtros de sinal falso** foram medidos ligados e desligados, um a um: fecho de volta para
dentro, varredura só de pavio (fechar fora é rompimento, não manipulação), corpo da vela de
regresso ≥ 0,3 ou 0,5 ATR, desequilíbrio (FVG) no regresso, ásia estreita (≤3 ATR) e tendência
de 4h a favor.

**Resultado — EURUSD, GBPUSD, USDJPY, GBPJPY e XAUUSD, 2016–2026, com spread** (alvo 2R, stop
mínimo de 1 ATR; com o alvo no lado oposto do intervalo é pior):

| Filtros | Operações | Acerto | R/operação | t | Até 2021 | 2022+ |
|---|---|---|---|---|---|---|
| Só o regresso ao intervalo | 8476 | 34% | **−0,172R** | −11,2 | −0,189 | −0,151 |
| + só pavio | 5280 | 34% | −0,195R | −9,9 | −0,218 | −0,165 |
| + corpo ≥ 0,3 ATR | 4914 | 34% | −0,182R | −9,0 | −0,201 | −0,158 |
| **+ desequilíbrio (FVG)** | 1274 | 37% | **−0,062R** | −1,6 | −0,079 | −0,043 |
| + corpo + FVG | 872 | 36% | −0,097R | −2,1 | −0,157 | −0,028 |
| + ásia estreita | 129 | 35% | −0,191R | −1,5 | −0,360 | +0,060 |
| + tendência de 4h | 2412 | 35% | −0,156R | −5,4 | −0,168 | −0,141 |

**Nenhuma combinação chega sequer a zero**, e todas são negativas nas duas metades. Nos dois
pares principais sozinhos (EURUSD e GBPUSD) o filtro de FVG chegava a +0,005R; com o ouro e os
pares de iene incluídos cai para −0,062R.

E o controlo, a operar **a favor** da varredura (ou seja, tratá-la como rompimento em vez de
manipulação): também negativo, −0,20R a −0,27R. Não é o sentido que está trocado — é o setup que
não tem vantagem.

**O que se aprendeu, e que fica para usar:** o filtro de FVG é um bom detector de sinal falso.
Sozinho, leva o resultado de −0,28R para 0,00R — corta as varreduras que não eram manipulação.
Mas um filtro só pode tirar operações más; não inventa vantagem onde não existe. Com stops
colados à varredura (o que a regra pede) o spread come ~15% de R por operação em 15m, e é isso
que enterra o setup — o mesmo que a fase 1b da procura intradiária já tinha mostrado.

**Não foi acrescentado ao sistema.** Medido nos cinco pares, incluindo o ouro e os pares de
iene, com 8476 operações em 10,7 anos — a amostra é grande o suficiente para a conclusão não ser
falta de dados.

## Alargar o rompimento de 4h aos pares que faltavam (22/09/2026)

O rompimento de 4h entrou no catálogo com dois instrumentos (ouro e USDJPY), depois de doze
mercados medidos. Restavam os quatro pares do universo negociável que ainda não tinham sido
testados. A regra corre igual em qualquer mercado — `PARES=<lista>
node scripts/backtest/verificar-rompimento-4h.mjs` mede um candidato sem o pôr no catálogo.

| Par | Operações | R/operação | t | 1.ª metade | 2.ª metade | Anos+ | Decisão |
|---|---|---|---|---|---|---|---|
| EURJPY | 377 | +0,101R | 2,0 | +0,122 | **+0,009** | 11/15 | **fora** — ver abaixo |
| NZDUSD | 285 | −0,009R | −0,2 | +0,018 | −0,146 | 9/15 | fora |
| AUDUSD | 297 | −0,117R | −2,2 | −0,117 | −0,114 | 3/15 | fora |
| EURGBP | 267 | −0,185R | −3,0 | −0,176 | −0,242 | 3/15 | fora |

**O EURJPY é o caso interessante, e ficou de fora na mesma.** No conjunto dos 15 anos é mais
forte do que o próprio USDJPY que está no catálogo (t=2,0 contra t=1,3), e tem 11 anos positivos.
O que o trava é o teste do custo:

| Spread | R/operação | t | 2.ª metade |
|---|---|---|---|
| assumido | +0,101R | 2,0 | +0,009R |
| a dobrar | +0,070R | 1,4 | **−0,020R** |
| a triplicar | +0,038R | 0,7 | −0,050R |

A metade recente já estava praticamente em zero com o spread ideal, e passa a NEGATIVA com um
spread realista. O ouro, à mesma prova, aguenta o spread a triplicar (+0,18R, t=3,1) — é essa a
diferença entre uma vantagem e uma coincidência. Se o EURJPY voltar a mostrar algo nos próximos
meses, revê-se.

**Resultado do alargamento:** dos dez pares de forex do universo negociável, o rompimento de 4h
foi medido em todos. Passa em dois instrumentos (ouro e USDJPY) e falha nos outros oito. Não é
uma regra universal: vive onde as tendências são fortes.

## ⚠️ O VWAP −2σ medido em 4,7 anos: muito mais fraco do que publicado (21/09/2026)

Os números da secção 1 vêm de **um ano** de dados da Deriv (out/2025–set/2026): 135 operações,
68% a chegar a +1R, +0,41R por operação. Ao alargar o catálogo, a mesma regra foi medida com
**4,7 anos** de HistData (jan/2022–ago/2026), com o mesmo código de produção e a mesma simulação:

| Índice | 4,7 anos | Até jun/2024 | Depois | Sinais/ano |
|---|---|---|---|---|
| Nikkei (JP225) | +0,097R (t=1,3) | +0,062R | +0,142R | 48 |
| DAX (GER30) | +0,063R (t=0,9) | −0,003R | +0,133R | 50 |
| S&P 500 | −0,012R | −0,078R | +0,062R | 61 |
| Nasdaq (US100) | −0,021R | −0,101R | +0,069R | 59 |
| FTSE (UK100) | −0,068R | −0,114R | +0,011R | 57 |
| CAC (FRA40) | −0,065R | −0,067R | −0,063R | 40 |

O Dow e o EuroStoxx ficam de fora desta tabela: a HistData não tem Dow (o `UDXUSD` de lá é o
índice do dólar) e o ficheiro do EuroStoxx veio vazio.

**O controlo foi feito primeiro:** o mesmo script, nos dados da Deriv, reproduz os números
publicados (GER30 +0,36R, SP500 +0,55R, US100 +0,29R, US30 +0,47R, 135 operações no total). O
script não é o problema. As duas fontes não são idênticas — a Deriv dá cerca de metade dos sinais
por ano (27 contra 50 no DAX), porque tem menos velas por dia — mas isso não explica a diferença
de resultado.

O que muda é o **período**. O padrão repete-se em todos os índices: ≈0 ou negativo de 2022 a
meados de 2024, positivo depois. É o mesmo padrão da abertura do DAX em 30m. A leitura honesta é
que esta regra vive de mercados em subida, e que o ano medido na Deriv foi um ano excepcionalmente
bom — não que a regra tenha 68% de acerto em geral.

**Pela barra deste projecto** (positivo nas duas metades, t≥1,5), o VWAP −2σ **não passaria hoje**
em nenhum índice numa janela de 4,7 anos. Fica registado aqui; a decisão de o manter como validado,
de o passar a "em teste" ou de o retirar é de quem opera.

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

Regras que correm ao vivo marcadas em todo o lado como "EM TESTE" — badge amarela em vez de
percentagem, convicção 0, aviso no texto do sinal.

**O SMT isolado (`smt-teste`) foi RETIRADO em 22/09/2026.** Esteve cinco dias ao vivo e não
chegou a fechar operações; o que o condenou foi o backtest: em 2022–2026 não teve vantagem em
nenhum par intradiário, e a única variante que parecia passar (ouro × DXY em 1h) era uma entre
dezenas testadas. A LEITURA da divergência fica como análise, no separador SMT do gráfico e
dentro do MMXM — deixou só de gerar sinais.

- **VWAP ±2σ no forex** (`vwap-forex-teste`) — EURUSD, GBPUSD, GBPJPY, USDJPY · 1h e 4h. Desde
  17/09/2026, revisão a 24/09/2026 (uma semana — sinal frequente).
  A mesma regra dos índices, mas nos dois sentidos (o forex não tem a deriva de subida dos
  índices). Compra 2σ abaixo do VWAP do mês, vende 2σ acima, com RSI(14) em extremo ou o mês
  deslocado mais de 2 ATR. Nunca foi medida nesta forma.
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
| Day trading / Intradiário | 4h | Rompimento de 20 velas no ouro e no USDJPY |
| (escolha nas Definições) | 30m | Abertura de Londres no GER30 (em teste) |
| Intradiário | 1h | VWAP em índices; VWAP e SMT no forex/ouro (em teste) |
| Swing | 4h, 1d | VWAP em índices (4h); VWAP e SMT no forex/ouro (4h, em teste); Connors (1d); tendência cripto, ouro e Nikkei (1d) |
| Investir | 1d | Connors (índices, Nikkei e bitcoin), tendência cripto, ouro e Nikkei; tendência de baixa na cripto (em teste) |

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
# alargar o catálogo: as mesmas regras noutros mercados
node scripts/backtest/alargar-catalogo-diario.mjs
# VWAP em 4,7 anos (precisa de velas de 1 min da HistData agregadas em 1h)
HISTDATA=<pasta> node scripts/backtest/alargar-catalogo-vwap.mjs GER30 SP500 US100 JP225
# o controlo, nos dados da Deriv: reproduz os números publicados
FONTE=deriv node scripts/backtest/alargar-catalogo-vwap.mjs GER30 SP500 US100 US30
# a procura do sistema de day trade (precisa das velas da HistData em 1h)
node scripts/backtest/geometria-intradiaria.mjs 24   # fase 1: o que o mercado oferece
node scripts/backtest/procurar-intradiario.mjs 24 1.5 # fase 2: que entrada bate o jogo justo
node scripts/backtest/verificar-rompimento-4h.mjs     # a regra final, com o código de produção
```

O último script corre o código de produção (`packages/core/src/strategies/validadas.ts`)
e imprime os números acima.
