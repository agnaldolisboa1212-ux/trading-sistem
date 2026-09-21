# Automação: o motor a enviar ordens sozinho

Até 21/09/2026 este sistema nunca enviava uma ordem sem alguém tocar no botão. O dono pediu
automação no servidor, 24 horas, em conta real, com limites — e confirmou depois de lhe ser dito
que as estratégias que mais sinais dão são as que estão **em teste**, sem vantagem medida.

Este documento é o mapa do que foi construído e, sobretudo, de como se desliga.

## Como parar tudo, já

Qualquer uma destas acções corta as ordens automáticas de imediato:

1. **Painel → Definições → Automação → "Retirar autorização do motor"**. Apaga a ligação cifrada à
   cTrader que o motor usa. É o travão de mão.
2. Desligar o interruptor **Estado da automação** e guardar.
3. No servidor, apagar a variável `AUTOMACAO_UTILIZADOR_ID` e reiniciar.

As posições já abertas **não** se fecham sozinhas — têm o stop e o alvo que foram enviados com a
ordem, e fecham-se na corretora como qualquer outra.

## Porquê cTrader e não a API da Deriv

As ordens que a API de opções da Deriv aceita são contratos de duração fixa com payout: não têm
stop nem alvo. Um sinal com entrada, stop e alvo não se exprime lá. A conta **Deriv cTrader** é
CFD e aceita ordem a mercado com stop e alvo — que é exactamente o que as estratégias descrevem.
Por isso a execução automática vai pela cTrader, ainda que a corretora seja a mesma.

## O caminho de um sinal até à ordem

```
motor (apps/engine)  →  POST /api/automacao/ordem  →  decidirAutomacao()  →  cTrader
    sinal novo            X-Motor-Segredo              travões              ordem a mercado
                                                                            com stop e alvo
```

O motor **não** fala com a corretora. Manda o sinal ao painel, que tem as definições, os limites e
a sessão autorizada. Há um só sítio onde a decisão de mexer em dinheiro é tomada, e é o mesmo
código que o painel usa quando a pessoa toca no botão.

## Os travões

Estão em `apps/dashboard/lib/automacao.ts`, numa função pura, com testes em
`apps/dashboard/test/automacao.test.mjs`. Por ordem:

| Travão | O que faz |
|---|---|
| Automação desligada | Não sai nada. É o estado por omissão. |
| Sinal repetido | Um sinal só dá uma ordem, para sempre (`ordens_automaticas` tem chave única). |
| Conta cTrader | Tem de estar escolhida no painel. |
| Conta REAL | Precisa de autorização à parte, um segundo interruptor. |
| Estratégia | Só as escolhidas uma a uma. |
| Instrumento | Só os escolhidos um a um. |
| Máximo de posições abertas | Conta as posições na conta, não as ordens enviadas. |
| Perda do dia | Soma os fechos de hoje; ao atingir a % definida, pára até ao dia seguinte. |
| Perda total | Soma os últimos 90 dias; ao atingir a %, pára. |
| Tecto por ordem | `CTRADER_LIMITE_LOTES` (1 lote por omissão) trava o tamanho, venha ele de onde vier. |
| Lote mínimo | Se o risco escolhido não chega para o lote mínimo do instrumento, recusa em vez de arredondar para cima. |

Todos os sinais deixam uma linha em `ordens_automaticas`, incluindo os recusados e porquê. O painel
mostra as últimas doze em **O que o motor fez** — uma automação que não envia ordens é
indistinguível de uma automação avariada sem este registo.

## O que é preciso ter ligado

No servidor (Hostinger):

```
MOTOR_SEGREDO=<o mesmo segredo que o motor já usa para o push>
PAINEL_URL=https://trivohub.io
AUTOMACAO_UTILIZADOR_ID=<o id da conta da plataforma que manda>
CTRADER_LIMITE_LOTES=1
COFRE_CHAVE=<a chave que já cifra a sessão cTrader>
SUPABASE_SECRET_KEY=<ou SUPABASE_SERVICE_ROLE_KEY>
```

`AUTOMACAO_UTILIZADOR_ID` é a peça que impede o motor de negociar por outra pessoa: o motor só
executa a automação dessa conta. Sem a variável, a rota responde e não faz nada.

Na base de dados: migração `0012_automacao.sql`.

No painel: **Definições → Automação**, escolher conta, estratégias, instrumentos e limites,
autorizar o motor, e ligar o interruptor.

## Onde vivem as credenciais

A sessão cTrader do motor fica **cifrada** (AES-GCM, `COFRE_CHAVE`) no ficheiro
`data/ctrader-motor.json`, escrito só pelo botão "autorizar o motor". Não está na base de dados,
não está no ambiente, não passa pelo browser. O refresh token da cTrader não expira: quem tiver o
ficheiro **e** a chave do cofre negoceia na conta. É por isso que a autorização é explícita e que
o ficheiro se escreve com permissões restritas.

## O que isto não faz

- **Não fecha posições.** O stop e o alvo vão com a ordem; a gestão que o painel mostra (stop
  móvel, protecção a +1R) continua a ser um aviso para a pessoa agir, não uma ordem automática.
- **Não converte moeda.** No modo "% do saldo", a conta do lote é feita na moeda em que o
  instrumento está cotado. Numa conta em USD a negociar US100, XAUUSD ou EURUSD está certa; num par
  que acabe noutra moeda fica aproximada, e o tecto por ordem é o travão.
- **Não escolhe por si.** As estratégias em teste não têm vantagem medida. Automatizá-las em conta
  real é uma decisão do dono, tomada com esta frase à frente.
