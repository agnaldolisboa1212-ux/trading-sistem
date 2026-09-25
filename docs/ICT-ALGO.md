# ICT ALGO

Algoritmo independente, construído a partir da mecânica publicada em
[theinnercircletraders.com](https://www.theinnercircletraders.com/) (cluster
avançado). Lê o mercado do semanal à vela de execução, decide em que **regime**
o mercado está nesse momento e monta o setup com o **modelo do site que
corresponde a esse regime**. Os sinais saem marcados `ICT ALGO` e não se misturam
com as estratégias validadas do sistema.

> **Estado medido (ler antes de tudo):** no backtest de 2022–2026, com custos,
> o algoritmo **não tem vantagem** — perde em média por operação nos mercados
> principais e nos de controlo. Ver [Medição](#medição). Por isso o aviso para o
> telemóvel está **desligado por omissão** (`ICT_ALGO_NOTIFICAR`).

---

## 1. Como pensa, de cima para baixo

```
semanal ─► diário ─► vela de referência ─► execução (15M/1H) ─► REGIME ─► MODELO ─► entrada
 macro      viés       faixa do CRT          micro + evento
```

| Degrau | O que lê | Ficheiro |
|---|---|---|
| Semanal | topos e fundos semanais a subir ou a descer | `vies.ts` (pergunta 1) |
| Diário | as **cinco perguntas** do viés, pela ordem do site; o *draw on liquidity* | `vies.ts` |
| Referência | a vela diária anterior (*"Prior daily candle when entering on 1H or 15M"*) | `crt.ts` |
| Execução | swings confirmados, BOS/CHoCH/MSS, FVG, order blocks, breakers, poças, varrimentos | `estrutura.ts`, `arrays.ts`, `liquidez.ts` |
| Relógio | killzones e fases AMD em hora de Nova Iorque (horário de verão resolvido) | `tempo.ts` |
| **Regime** | manipulação, reversão, tendência, consolidação, indefinido | `regime.ts` |
| **Modelo** | os modelos do regime, por prioridade; o primeiro que monta setup ganha | `seletor.ts` |
| Entrada | limite do PD array, meio, OTE ou mercado | `entrada.ts` |

### Regimes (ordem de avaliação fixa, definida antes de medir)

1. **Manipulação** — varrimento de liquidez numa killzone de Londres/NY, no sentido que arma o viés diário, ainda não invalidado.
2. **Reversão** — MSS recente no sentido do viés (o micro vinha contra e virou).
3. **Tendência** — micro e diário alinhados, semanal não contra, BOS recente com deslocamento.
4. **Consolidação** — micro sem sentido e as últimas 24 velas numa faixa ≤ 6 ATR.
5. **Indefinido** — nada disto: espera.

Com viés diário neutro, 1–3 não existem (top-down: o macro manda no micro).

### Mapa regime → modelos (`MODELOS_DO_REGIME`)

| Regime | Modelos, por prioridade |
|---|---|
| manipulação | Venom → CRT → Reaper IFVG → Silver Bullet |
| reversão | Unicorn → Turtle Soup → Reaper IFVG |
| tendência | Continuação (OTE + PD array) → Silver Bullet |
| consolidação | Turtle Soup → CRT |

O mapa vem do que o site diz de cada modelo, **não** de resultados. Escolher o
mapa depois de ver qual modelo ganhou em cada regime seria ajustar a regra aos
dados.

### Segunda camada: quarentena pelo histórico

Entre os modelos que o regime permite, um que tenha média negativa nas últimas
20 operações **já fechadas** neste instrumento (mínimo 10) fica de quarentena.
Só pode **tirar** um modelo da lista, nunca acrescentar. Ver `calcularPlacar`.

---

## 2. Os sete modelos

Todos acabam em `fecharSinal` (`modelos/comum.ts`): risco ≥ 0,25 ATR, ordem pendente do lado certo, alvo na liquidez **mais próxima** com RR ≥ 2, killzone.

| Modelo | Sequência (regras do site) | Stop | Alvo |
|---|---|---|---|
| **Venom** | viés → vela de referência (não doji) → varrimento do extremo dela com corpo de volta → **SMT** contra o par → CHoCH/MSS → first presented FVG na metade certa da faixa | extremo varrido | extremo oposto da faixa ou DOL, o mais perto |
| **CRT** | vela de referência → Seek & Destroy (a vela mais extrema fecha de volta dentro) → CHoCH/MSS → FVG/OB da entrega | extremo do Seek & Destroy | extremo oposto da vela de referência |
| **Reaper IFVG** | FVG rompido; teste das 3 perguntas (tomou liquidez? varrimento? vela grande?) → primeiro regresso com vela de rejeição | limite da zona | liquidez mais próxima |
| **Silver Bullet** | só 15M; viés → janela 03–04 / 10–11 / 14–15 NY → varrimento contra o viés → deslocamento com FVG na janela | extremo varrido | liquidez mais próxima |
| **Unicorn** | MSS → breaker (order block que falhou) sobreposto a FVG da reversão | origem da reversão | liquidez mais próxima |
| **Turtle Soup** | varrimento de máximos/mínimos **iguais** → CHoCH/MSS → primeiro FVG | extremo varrido | liquidez mais próxima |
| **Continuação** | semanal/diário/micro alinhados → BOS com deslocamento → FVG/OB da perna dentro do OTE 62–79% | origem do impulso | extremo do impulso (IRL → ERL) |

O Venom **não emite sem par correlacionado** (é o único estágio com informação de fora do instrumento).

---

## 3. A regra que atravessa tudo: nada vê o futuro

Todo o objecto estrutural tem `index` (quando aconteceu) e `confirmadoEm` (a
partir de quando é **conhecível**). Um swing com lookback 2 só existe duas velas
depois do pivô. Nenhuma função usa um objecto com `confirmadoEm > i`.

Foi este erro que, neste projecto, fez um teste de order blocks dar **t = 13,3**
até ser corrigido (caiu para −0,044R). Os testes em
`packages/core/test/ict-algo.test.mjs` verificam-no directamente:

- **O teste do corte no algoritmo inteiro**: a decisão na vela N com a série
  completa tem de ser *idêntica* à decisão com a série cortada em N — regime,
  viés e o veredicto dos sete modelos nos dois sentidos. Idem para os modos de
  entrada.
- varrimento ≠ rompimento; seletor nunca contraria o regime; placar só vê
  operações fechadas; geometria de todos os sinais em milhares de velas;
  determinismo; travão de portfólio; hora de NY contra `Intl`.

Correções feitas por esta regra durante a construção (para não se repetirem):
- poças "equal highs" já não reescrevem a poça antiga (nasce uma nova quando o 2.º topo é confirmado);
- a tolerância dos "equal highs" usa o ATR do instante, não a média da série;
- a pergunta 4 do viés não exclui poças varridas **depois** da vela;
- o Reaper não conta liquidez tomada depois da vela actual;
- um FVG não é dado como "tocado" pela vela que o cria.

---

## 4. Onde vive no sistema

| Peça | Ficheiro |
|---|---|
| Algoritmo (puro, sem rede) | `packages/core/src/ict/` |
| Testes | `packages/core/test/ict-algo.test.mjs` |
| API do gráfico (com travão de portfólio do utilizador) | `apps/dashboard/app/api/ict/[symbol]/route.ts` |
| Secção "ICT ALGO" na Análise do gráfico | `apps/dashboard/components/vivo/VisaoIct.tsx` (+ ligação em `AnaliseAoVivo.tsx`, aba em `lib/visoes.ts`) |
| Estilos | `apps/dashboard/app/vivo.css` (bloco `ICT ALGO`) |
| Motor de tempo real (passagem própria) | `apps/engine/src/pipeline/ict-algo.ts` (+ `index.ts`) |
| Mensagens Telegram/push "ICT ALGO" | `packages/notify/src/index.ts` (`formatarSinalIct`, `difundirSinalIct`) |
| Medição | `scripts/backtest/ict-algo.mjs`, `scripts/backtest/jpy-londres.mjs` |
| Dados HistData (1 minuto → 15M/1H) | `scripts/backtest/baixar-histdata.mjs` |

### Variáveis do motor

| Variável | Efeito |
|---|---|
| `ICT_ALGO_NOTIFICAR=1` | envia os avisos (por omissão: só regista em `ict-algo-sinais.jsonl`) |
| `ICT_ALGO_TIMEFRAMES=15m` | timeframes de execução, separados por vírgula |
| `ICT_ALGO_SIMBOLOS=EURUSD,GBPUSD` | substitui os portfólios dos perfis |
| `ICT_ALGO_DESLIGADO=1` | não agenda a passagem |

Passagem única: `node apps/engine/dist/index.js ict`.

---

## 5. Medir

```bash
TF=15m node scripts/backtest/ict-algo.mjs                  # mercados principais
CONTROLO=1 TF=15m node scripts/backtest/ict-algo.mjs       # mercados que não participaram
ENTRADA=ote TF=15m node scripts/backtest/ict-algo.mjs      # borda | meio | ote | mercado
```

Só dados de 2022+; metades 2022-01→2024-06 e 2024-07→2026-08; custos de conta
normal em todas as operações; stop e alvo na mesma vela = stop.

**Fasquia para um modelo ou variante contar:** positivo nas duas metades **e**
t ≥ 1,5 **e** positivo nos mercados de controlo. Quem testar muitas variantes
tem de esperar que algumas passem por acaso nos principais — é para isso que o
controlo existe.

---

## 6. Medição

Medido a 25/09/2026. Só dados de 2022+; custos de conta normal; algoritmo
completo = regime → modelo + quarentena. Principais: EURUSD, GBPUSD, USDJPY,
EURJPY, XAUUSD, SP500, US100, GER30 (em 15M só os 6 com dados de 15M).
Controlo: AUDUSD, NZDUSD, EURGBP, USDCAD, USDCHF, GBPJPY, UK100, FRA40 (em 15M, 4).

### O algoritmo, por timeframe e modelo de entrada

| TF | Entrada | Principais | Controlo |
|---|---|---|---|
| 1H | limite do PD array | 170 op · −0,335R · t=−2,8 | 158 · −0,333R · t=−2,7 |
| 15M | limite do PD array | 435 · −0,013R · t=−0,1 | 215 · −0,393R · t=−3,6 |
| 15M | meio da zona (50%) | 413 · −0,098R · t=−0,9 | 218 · −0,419R · t=−3,5 |
| 15M | OTE 70,5% | 417 · −0,146R · t=−1,5 | 194 · −0,559R · t=−4,7 |
| 15M | a mercado | 246 · +0,123R · t=1,0 | 116 · −0,625R · t=−5,5 |

Nenhuma combinação passa a fasquia. Só com a camada de estrutura (sem
quarentena) é pior em todos os casos (ex.: 15M borda, −0,195R, t=−3,3); a
quarentena reduz as perdas mas não cria vantagem.

### Células que "passaram" nos principais — e o que o controlo disse

| Célula (15M) | Principais | Controlo |
|---|---|---|
| manipulação → Silver Bullet, borda | 98 op · +0,401R · t=1,6 | 44 · −0,671R · t=−3,3 |
| compras, entrada a mercado | 130 · +0,317R · t=1,8 | 66 · −0,632R · t=−4,2 |
| reversão → Unicorn, a mercado | 38 · +0,409R · t=1,6 | (Unicorn a mercado: 100 · +0,049R · t=0,4) |

Com ~30 células por corrida e 4 modos de entrada, algumas passarem por acaso
nos principais é o esperado. Nenhuma sobreviveu ao controlo.

### Porque perde (medido, não suposto)

Dos 3059 setups com ordem pendente em 15M: 44% **nunca enchem** — o preço vai ao
alvo sem regressar à zona. Os que enchem dão −0,228R; entrar a mercado em
todos dá −0,099R. É selecção adversa das ordens limite: enchem-se os que vão
falhar. O "+0,233R" dos que fugiram **não é capturável** — só se sabe que um
setup fugiu depois de o preço chegar ao alvo.

Os modelos crus mais fracos: Reaper IFVG (−0,52R nos principais, −1,10R no
controlo, em 15M) e Turtle Soup. O menos mau: Unicorn (≈ 0).

### O método das notas "Estudos do JPY" (medido a 25/09/2026)

As notas do Notion descrevem um método próprio, diferente dos modelos do site:
Power of 3 + SMT nos pares JPY, na abertura de Londres. Foi posto em regras
**antes** de medir (ver o cabeçalho de `scripts/backtest/jpy-londres.mjs`):

1. viés diário; sem viés não se opera
2. faixa asiática 00:00–08:00 de Londres
3. entre 08:00 e 10:00 de Londres o par passa o extremo asiático contra o viés
   (as notas estão num TradingView em UTC+2, escritas no Verão: "9:00" = 08:00
   de Londres, "11H" = 10:00, saída "13:30–14:00" = 12:30–13:00)
4. SMT: a referência (USDJPY; GBPJPY para o USDJPY) não passa o seu extremo asiático
5. entrada 1 no fecho de volta para dentro da faixa, alvo 3R; entrada 2 no MSS, alvo 3,5R
6. break-even a +1,2R, saída às 13:00 de Londres, uma operação por dia, nada às sextas

15M, 2022+, com custos:

| | Pares das notas (GBPJPY, EURJPY, USDJPY) | Controlo (AUDJPY, CADJPY, CHFJPY, NZDJPY) |
|---|---|---|
| entrada 1 (SMT na abertura) | 392 op · −0,151R · t=−2,0 | 399 · −0,256R · t=−3,7 |
| entrada 2 (confirmação MSS) | 71 · +0,117R · t=1,1 (acerto 55%; 2.ª met. −0,080) | 66 · −0,018R · t=−0,2 |
| combinada ½ + ½ | 392 · −0,065R · t=−1,6 | 399 · −0,130R · t=−3,5 |
| + radar AUDJPY/NZDJPY | 102 · +0,003R · t=0,0 | (CADJPY/CHFJPY) 52 · −0,026R |
| versão refinada (OTE de 1H + estocástico 5,3,3) | 6 operações em 4,7 anos | 6 |

Os dados repetem a lição que as próprias notas registam — entrar à abertura
perde, esperar pela confirmação acerta mais — mas nenhuma versão tem vantagem
mensurável, e a versão refinada quase nunca acontece (o varrimento da Ásia raramente cai no OTE da perna de 1H
com divergência no estocástico ao mesmo tempo).

Nota sobre os pares JPY no ICT ALGO: USDJPY e EURJPY foram os melhores mercados
nas medições do algoritmo, mas o GBPJPY — o único par JPY que não entrou em
escolha nenhuma — perdeu em todos os modos de entrada (−0,255R a −0,839R). Não
há um "efeito JPY" que sobreviva fora da amostra.

Dados dos quatro pares de controlo: `node scripts/backtest/baixar-histdata.mjs AUDJPY CADJPY CHFJPY NZDJPY --desde 2021`.

---

## 7. Para acrescentar um modelo

1. Escrever `modelos/<nome>.ts` com um `Avaliador` `(ctx, direccao) => ResultadoModelo`, terminando em `fecharSinal`.
2. Acrescentar o nome a `ModeloIct` e `NOME_MODELO` (`types.ts`) e a `AVALIADORES` e `TODOS_OS_MODELOS` (`seletor.ts`).
3. Pô-lo em `MODELOS_DO_REGIME` **pela regra do site**, antes de medir.
4. Garantir que só lê objectos com `confirmadoEm <= i` — o teste do corte apanha o resto.
5. Medir com a fasquia acima, nos principais **e** no controlo.
