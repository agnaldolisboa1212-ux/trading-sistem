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

## Forex (EURUSD, GBPUSD, USDJPY, GBPJPY) — o que se testou

Com 20 anos de diário da Dukascopy (2006–2025) e 1 a 2 anos de horário (Yahoo e Deriv),
nada passou os dois períodos com margem:

| Família | Resultado |
|---|---|
| Tendência (Donchian, médias, momentum mensal) | positiva até 2015, **negativa desde 2016** |
| RSI(2), IBS, sequências de fechos | ≈ 0R depois de custos |
| Gap de segunda, dias grandes, virada do mês | sem padrão estável |
| Posicionamento COT (contrarian ou a favor dos fundos) | negativo nos dois períodos |
| Sazonalidade por hora | 1–3 pips, menos do que o spread |
| Rompimento do intervalo asiático (London breakout) | +0,05R no Yahoo (2 anos), mas negativo na primeira metade do ano na Deriv — instável |
| Rompimento de dia estreito (NR7) | +0,04R em 20 anos, quase zero até 2015 — demasiado fraco |

Os pares principais estão entre os mercados mais eficientes que existem: as regras técnicas
simples que funcionavam até 2015 deixaram de funcionar. Os pares continuam sem sinais até
uma regra passar os testes. A pesquisa continua com mais histórico horário.

## Quem recebe o quê

| Objetivo no onboarding | Timeframes | Estratégias que podem dar sinal |
|---|---|---|
| Day trading | 15m | nenhuma validada em 15m |
| Intradiário | 1h | VWAP em índices |
| Swing | 4h, 1d | VWAP em índices (4h), Connors (1d), tendência cripto e ouro (1d) |
| Investir | 1d | Connors, tendência cripto e ouro |

Esta é só a sugestão inicial: em **Definições → Timeframes dos sinais** cada pessoa escolhe
exactamente em quais recebe sinais.

**Forex, prata e sintéticos não recebem sinais. O ouro recebe na tendência diária.**
- Nenhuma regra testada passou nos dois períodos.
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
