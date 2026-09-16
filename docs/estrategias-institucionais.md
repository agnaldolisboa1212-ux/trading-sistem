# Estratégias institucionais

Quatro estratégias complementares ao MMXM+SMT, em `packages/core/src/strategies/`.
Todas são funções puras: recebem uma série, devolvem sinais, não tocam em rede nem
no relógio.

O detalhe matemático de cada uma está no topo do respetivo ficheiro. Este documento
consolida o que interessa antes de confiar nelas: **o que assumem, quando essas
suposições falham, e com que frequência disparam de facto**.

---

## O que está implementado

| Estratégia | Ficheiro | Ideia |
|---|---|---|
| Supply & Demand | `supply-demand.ts` | Zonas onde um desequilíbrio deixou ordens por preencher |
| Support & Resistance | `support-resistance.ts` | Níveis por toques repetidos, flips e números redondos |
| VWAP com bandas | `vwap.ts` | Preço médio ponderado por volume, com desvios-padrão |
| Perfil de volume | `volume-profile.ts` | POC e Value Area, na tradição do Market Profile |

Mais quatro estimadores de volatilidade em `volatility.ts`: close-to-close,
Parkinson, Garman-Klass e Rogers-Satchell. São usados para dimensionar stops em
múltiplos de σ em vez de percentagens fixas.

`runInstitutionalStrategies(series, options)` corre todas e devolve os sinais
ordenados por convicção. `assessConfluence(signals)` diz se concordam.

---

## Frequência real — medida, não estimada

Corrido sobre 280 barras diárias por instrumento, contando planos gerados barra a
barra:

| | EURUSD | NQ | BTCUSD |
|---|---|---|---|
| Supply & Demand | 2 | 3 | 2 |
| Support & Resistance | 6 | 1 | 0 |
| VWAP bandas | 42 | 17 | 26 |
| Perfil de volume | 68 | 45 | 48 |

Supply & Demand e Support & Resistance são **muito** seletivas porque o planeador
exige que o preço esteja a tocar a zona **na vela atual** e que a zona ainda não
tenha sido testada. Não é um defeito: uma zona já visitada duas vezes tem as ordens
que lá estavam maioritariamente preenchidas.

VWAP e perfil de volume disparam com muito mais frequência. Isso torna-as mais
úteis para intradiário — e também mais expostas a falsos positivos.

---

## As suposições, e quando falham

### Supply & Demand

**Assume** que uma partida rápida a partir de uma base estreita deixou ordens por
executar, e que o preço volta lá para as preencher.

**Falha quando** a base não foi acumulação mas apenas ausência de participantes —
noite asiática, feriado, pré-abertura. A geometria é a mesma; o significado não.
O módulo não consegue distinguir os dois casos a partir de OHLCV.

### Support & Resistance

**Assume** que preços tocados repetidamente concentram ordens.

**Falha quando** o nível é um artefacto do próprio detetor. Com tolerância
suficientemente larga, qualquer série produz "níveis". A defesa aqui é exigir
história mínima — com 30 velas o detetor devolve zero de propósito — e contar
toques em vez de aceitar mínimas isoladas.

Os números redondos são o caso mais sólido: existem porque **as pessoas** colocam
ordens em `1.1000` e `20 000`, não por uma propriedade do mercado.

### VWAP

**Assume** que existe fluxo mecânico a comprar abaixo e a vender acima enquanto
uma ordem grande está a ser trabalhada.

**Falha porque esse fluxo é indiferente à direção.** O algoritmo compra abaixo do
VWAP porque tem de comprar, não porque acha que o preço vai subir. Usar o VWAP
como sinal direcional é ler intenção onde só há mecânica de execução. É a mais
frágil das quatro, e o ficheiro di-lo por extenso.

Acresce que o VWAP é definido por **sessão**. Num timeframe diário sem âncora de
sessão, o número que sai é uma média ponderada de um intervalo arbitrário.

### Perfil de volume

**Assume** que o volume por preço aproxima onde o negócio foi facilitado.

**Falha em três aproximações**, todas documentadas no ficheiro: o volume é
atribuído ao intervalo da vela em vez do preço exato de cada transação; o forex
spot não tem volume real (o que existe é contagem de ticks); e a Value Area de 70%
é uma convenção, não uma constante do mercado.

---

## A ressalva que a confluência carrega

`assessConfluence` devolve, com cada relatório, três avisos. O primeiro é o que
mais importa:

> As quatro estratégias são transformações dos **mesmos** dados OHLCV. Concordarem
> não é o mesmo que quatro fontes independentes concordarem — zonas, níveis, bandas
> e value area coincidem por construção geométrica.

Por isso a convicção reportada é o **máximo** entre os sinais alinhados, nunca a
soma. Somar convicções de medidas correlacionadas sobrestima a confiança de forma
sistemática.

E quando há estratégias dos dois lados, o resultado é `conflicted` — não a maioria.
Votar por maioria entre medidas correlacionadas fabrica convicção onde há ruído.

---

## Estado de validação

**Nenhuma destas estratégias tem vantagem demonstrada.** O que existe:

- 18 testes automáticos, focados nas guardas (rejeição de OHLC sintético e
  degenerado, volatilidade zero em série plana, stop do lado certo, ordenação por
  convicção)
- verificação de que produzem sinais com dados reais, e com que frequência

**O que falta**, e sem isto os números acima não dizem nada sobre rentabilidade:

1. Backtest walk-forward, como o que já existe para o MMXM em
   `apps/engine/src/pipeline/backtest.ts`
2. Amostra suficiente — a lição do MMXM foi dura: +20,3R no total, dos quais 81%
   vinham de **um** negócio
3. Validação fora da amostra, em período separado do usado para calibrar

O mesmo padrão do resto do projeto: o código funciona, está testado, e isso é uma
afirmação sobre o software — não sobre o mercado.

---

## Um bug encontrado pelos testes

`detectRoundNumber` devolvia o **incremento** em vez do **nível**: para um preço de
`1.10004` respondia `0.1`, um valor que nem sequer está perto do preço. Como o
consumidor usa o retorno como nível de suporte/resistência, o erro colocaria ordens
no sítio errado. Corrigido, e fixado por teste.
