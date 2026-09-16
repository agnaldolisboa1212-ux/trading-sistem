# A estratégia, e como está implementada

Este documento liga cada conceito do eBook *MMXM & Time* (The Ones That Know) ao ficheiro
que o implementa, e explica as adaptações feitas para escala macro.

---

## 1. Market Maker Models

**Ficheiros:** `packages/core/src/mmxm/consolidation.ts`, `packages/core/src/mmxm/model.ts`

Um MMXM é a representação esquemática de Acumulação → Manipulação → Distribuição
(*Power of Three*). Tem sempre a mesma sequência:

```
consolidação original          liquidez engenheirada de UM lado
        ↓
lado ESQUERDO da curva         1-3 expansões + retrações, na direção CONTRÁRIA
        ↓                      ao destino final — vai varrer a liquidez oposta
Smart Money Reversal           key price level + key time
        ↓
lado DIREITO da curva          1-3 expansões na direção final
        ↓
completo                       o preço atravessa a consolidação original
```

**MMBM** (Buy Model): a consolidação engenheira *equal highs* → os retalhistas vendem e
põem stops acima → o preço primeiro desce (curva esquerda) para varrer sellside → SMR →
sobe até acima da consolidação.

**MMSM** (Sell Model): o espelho — *equal lows* → curva esquerda sobe → SMR → desce.

A implementação deteta a consolidação procurando janelas com amplitude contida (relativa
ao ATR) que contenham um cluster de máximas ou mínimas "relativamente iguais". O lado do
cluster determina o tipo de modelo — é o `engineeredSide`.

> **Nota de fidelidade:** o eBook diz que o modelo é *fractal* e ocorre "when specific
> conditions have been met". A implementação constrói um modelo por consolidação
> qualificada e escolhe o ativo mais recente que serve a narrativa HTF.

---

## 2. Smart Money Reversal

**Ficheiro:** `packages/core/src/mmxm/model.ts` → `detectSmartMoneyReversal()`

O SMR é o momento em que o programa muda de compra para venda (ou vice-versa). O eBook
exige **Time and Price alignment**. O detector procura, no extremo da curva esquerda:

| Componente | Peso | O que verifica |
|---|---|---|
| Sweep de liquidez | 0,35 | O extremo varreu um poço de liquidez não tocado |
| CISD | 0,25 | Fechamento além do open da última sequência contrária |
| MSS | 0,30 | Rompimento por fechamento de um swing point |
| Displacement | 0,10 | O rompimento veio com vela de expansão |

O alinhamento **temporal** não é avaliado aqui — vive em `time/windows.ts`, para que a
regra dos macros exista num só sítio.

---

## 3. Time Based Liquidity Pools — fractalizados

**Ficheiro:** `packages/core/src/indicators/liquidity.ts`

O eBook define a hierarquia intradiária:

> Durante Ásia não referimos nada. Durante Londres referimos a máxima e mínima da Ásia.
> Durante Nova Iorque de manhã, as de Londres e da Ásia. À tarde, as da manhã e de Londres.

E autoriza explicitamente a fractalização: *"These time cycles can be fractalized into
smaller time cycles."* Este sistema fractaliza para **cima**:

| eBook (intradiário) | Este sistema (swing) |
|---|---|
| Ásia / Londres / NY | Dia / Semana / Mês / Trimestre / Ano |
| "Durante Londres referimos a Ásia" | Ao operar o **diário**, referimo-nos à **semana** anterior |
| — | Ao operar o **semanal**, ao **mês** anterior |

`detectTimeBasedPools()` extrai máximas e mínimas de cada ciclo anterior e marca quando
foram varridas. `selectDrawOnLiquidity()` escolhe o alvo ponderando relevância temporal
(ano > trimestre > mês > semana > dia), número de toques e proximidade.

---

## 4. Macros — a adaptação central

**Ficheiro:** `packages/core/src/time/windows.ts`

Os macros do eBook são janelas de **XX:45 a XX:15** (Time Of Interest), com duas funções:
produzir uma **reversão** ou uma **expansão**. Na escala diária/semanal esse relógio não
se aplica, mas o conceito sim. Tradução implementada:

| Janela | Quando | Função | Peso |
|---|---|---|---|
| Reversão semanal | Segunda a quarta (núcleo: ter/qua) | reversal | 0,75–1,0 |
| Expansão semanal | Quarta a sexta (núcleo: quinta) | expansion | 0,8–1,0 |
| Reversão mensal | Dias 1–5 e 10–16 | reversal | 0,7–0,9 |
| Expansão mensal | Dias 18–28 | expansion | 0,7 |
| Shift trimestral | 2 primeiras semanas de Jan/Abr/Jul/Out | reversal | 1,0 |

Quando várias janelas coincidem, o alinhamento é mais forte (com retornos decrescentes).

**As duas regras de execução do eBook mantêm-se literalmente** em
`evaluateMacroExecution()`:

1. Se o SMR ocorre **dentro** de uma TOI → pode participar-se fora da janela, até a
   consolidação original ser atingida.
2. Se o SMR ocorre **fora** de uma TOI → é preciso esperar pela próxima janela, que
   produzirá a expansão.

---

## 5. SMT Divergence

**Ficheiro:** `packages/core/src/smt/divergence.ts` · pares em `packages/core/src/universe.ts`

Mercados **correlacionados** devem formar swing highs e lows ao mesmo tempo. Mercados
**inversamente correlacionados** devem mover-se em sentidos opostos. Quando isso quebra,
há *crack in correlation*.

Pares configurados (extrato):

| Primário | Referência | Correlação | Peso |
|---|---|---|---|
| NQ | ES | positiva | 1,00 |
| EURUSD | GBPUSD | positiva | 1,00 |
| EURUSD | DXY | inversa | 1,00 |
| AUDUSD | NZDUSD | positiva | 0,90 |
| XAUUSD | XAGUSD | positiva | 0,90 |
| BTCUSD | ETHUSD | positiva | 0,90 |
| XAUUSD | DXY | inversa | 0,70 |

**Leitura da direção:** uma rachadura em **topos** significa que a subida deixou de ser
confirmada → leitura *bearish*. Em **fundos** → *bullish*. Isto vale independentemente de
qual dos dois falhou; qual é o lado fraco fica registado em `weakSide`.

**O filtro que o eBook exige:** *"not every crack in correlation is significant. Only
cracks that occur within our overall Narrative and Point Of Interest hold any
significance."* `filterRelevantSmt()` impõe-o — um SMT fora de POI é descartado, sem
exceção.

Quando o mesmo instrumento diverge contra **vários** pares ao mesmo tempo, a leitura é
muito mais forte: `aggregateSmtConfluence()` soma os pesos, ponderando também o grau do
swing (short 0,6 · intermediate 1,0 · long 1,3).

---

## 6. Padrões de entrada

**Ficheiro:** `packages/core/src/signal/entries.ts`

Hierarquia de qualidade, tal como o eBook a estabelece:

| Padrão | Qualidade base | Composição |
|---|---|---|
| **True Unicorn** | 1,00 | Breaker + FVG + **Balanced Price Range** |
| Unicorn | 0,85 | Breaker + FVG |
| Inverse FVG | 0,70 | FVG violado, a atuar ao contrário |
| Breaker | 0,65 | Order block que falhou |
| Mitigation block | 0,60 | *"old selling becomes new buying"* |
| FVG simples | 0,50 | Entrada no Consequent Encroachment |

O **True Unicorn** é a contribuição própria do eBook: acrescenta o Balanced Price Range
(sobreposição de um FVG de alta com um de baixa) ao unicorn do ICT. `detectEntryPatterns()`
procura-o primeiro e só desce a hierarquia depois.

A qualidade é penalizada por idade (zonas com 40+ velas perderam poder) e por já terem
sido testadas.

---

## 7. As três fases de entrada

**Ficheiro:** `packages/core/src/mmxm/model.ts` → `countRightCurveLegs()`

| Pernas na curva direita | Fase | Descrição do eBook |
|---|---|---|
| 0 | **Low Risk Buy/Sell** | Primeira entrada, confirmada pelo primeiro MSS/CISD |
| 1 | **1ª Acumulação/Distribuição** | Segundo swing intermediate a formar-se |
| 2+ | **Silver Bullet** | *"the highest probability phase"* — o preço já está perto do íman |

Uma "perna" é um swing intermediate na direção do modelo formado após o SMR.

O horizonte esperado ajusta-se à fase: na Low Risk Entry ainda falta toda a curva direita
(~1,5× o horizonte base); no Silver Bullet a entrega é rápida (~0,5×).

---

## 8. Checklist de 10 pontos

**Ficheiro:** `packages/core/src/signal/checklist.ts`

As perguntas da página 27, implementadas literalmente — incluindo a regra *"If at any
point the answer is no, go back to step 1"*: o avaliador **para** no primeiro passo que
falha.

| # | Pergunta | Peso |
|---|---|---|
| 1 | O draw on liquidity HTF é óbvio? | 0,15 |
| 2 | O fluxo institucional HTF é óbvio? | 0,15 |
| 3 | O preço chegou a um POI HTF? | 0,12 |
| 4 | O tempo encontra o preço? | 0,15 |
| 5 | Existe SMT? | **0,18** |
| 6 | Houve CISD/MSS? | 0,15 |
| 7 | Modelo de entrada definido? | 0,05 |
| 8 | Invalidação definida? | 0,03 |
| 9 | Alvos definidos? | 0,02 |
| 10 | Executar | — |

O SMT tem o maior peso por ser o diferenciador desta estratégia.

Cada passo guarda um `detail` textual explicando **porquê** passou ou falhou. É isso que
aparece no Telegram e no dashboard, e é o que permite auditar uma decisão meses depois.

**O checklist é um portão, não uma nota.** Os pesos somam 1,0, e o analisador só prossegue
quando todos os nove critérios passam — logo `checklist.score` vale sempre 1,0 nesse ponto.
Por isso ele *não* entra no cálculo da confiança final: se entrasse, seria uma constante que
não distinguiria um sinal de outro. A confiança mede só o que varia entre sinais aprovados:

```
confiança = confiança_do_modelo × 0,6 + qualidade_do_padrão × 0,4
```

---

## 9. Saídas

**Ficheiro:** `packages/core/src/signal/exits.ts`

O eBook define a saída estruturalmente (*"participate until the original consolidation is
reached"*) e pelo íman (draw on liquidity). O sistema acrescenta as saídas defensivas que
uma operação de semanas exige:

| Motivo | Fração fechada | Quando |
|---|---|---|
| `stop-hit` | tudo | Stop atingido |
| `target-hit` | conforme o plano | Alvo atingido (TP1 move stop para break-even) |
| `model-completed` | 50% do restante | Preço atravessou a consolidação original |
| `structure-broken` | tudo | MSS com displacement contra a posição |
| `smt-reversed` | 50% do restante | SMT aponta contra em ≥2 pares |
| `time-stop` | tudo | Sem alvo atingido após 2× o horizonte previsto |

Plano de alvos escalonado (`buildTargetPlan()`):

- **TP1 a 2R** — fecha 30%, move stop para break-even.
- **TP2 na consolidação original** — fecha 40%. É a conclusão estrutural do modelo.
- **TP3 no draw on liquidity** — os 30% restantes correm até ao íman.

O runner do TP3 é o que produz os múltiplos de 5R–10R. Fechar tudo no TP1 elimina
exatamente a cauda da distribuição que sustenta a expectativa positiva.

---

## 10. O que NÃO está implementado

Honestidade sobre os limites:

- **Execução automática.** Não há adapter de corretora. Por decisão explícita.
- **Timeframes intradiários.** O motor suporta `1h`/`4h` nos tipos, mas os macros estão
  calibrados para escala swing. Usar `1h` exigiria repor as janelas XX:45–XX:15 originais.
- **Volume real em forex spot.** Os futuros da CME trazem volume; o DXY não.
- **Order flow / footprint.** Fora do alcance de APIs públicas gratuitas.
- **Validação estatística.** O backtest corre, mas a amostra atual (17 operações) não
  suporta conclusões. Ver a secção correspondente no README.
