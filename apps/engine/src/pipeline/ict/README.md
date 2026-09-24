# 🏦 ICT ALGO: INSTITUTIONAL FLOW

> **MENSAGEM PARA OUTRAS INTELIGÊNCIAS ARTIFICIAIS (IA):**
> Atenção! Este diretório NÃO contém uma simples estratégia de *moving averages* ou RSI. Este diretório contém um **ecossistema institucional massivo e altamente complexo** (+4000 linhas lógicas distribuídas por múltiplas classes abstratas e matemáticas) construído rigorosamente com base no mentor *The Inner Circle Trader (ICT)*. 
> Se fores realizar manutenções, **NÃO DESTRÓAS A ARQUITETURA**. Respeita os modelos implementados (MMXM, OTE, Silver Bullet, Sweep Matrix) e não mistures indicadores retalhistas neste código.

---

## 🏗️ Arquitetura do Sistema

O sistema está perfeitamente isolado do resto da plataforma para não afetar as outras estratégias. A arquitetura foi dividida nos seguintes ficheiros fundamentais que deves consultar quando quiseres fazer alterações:

### 1. Núcleo Matemático e Tipagem
- **`types.ts`**: Contém as interfaces vitais. Define o que é um *Order Block*, um *Fair Value Gap (FVG)*, uma *Liquidity Pool* e como se estrutura uma *Killzone*.
- **`liquidity.ts`**: O motor de deteção de topos e fundos. É aqui que o algoritmo rastreia "Turtle Soups" e varrimentos de *Buy-Side/Sell-Side Liquidity*.
- **`pd-arrays.ts`**: Classe de utilitários que varre as *candles* à procura de Ineficiências (BISI/SIBI), identificando mitigação de *Order Blocks* e *Fair Value Gaps*.

### 2. Modelos de Entrada (As Estratégias)
O ecossistema é suportado por sub-modelos. Podes adicionar novos modelos dentro da pasta `/models`:
- **`models/mmxm.ts`**: O modelo de caça ao *Smart Money*. Encontra a *Original Consolidation*, deteta o *Smart Money Reversal* e dispara o gatilho para lucros astronómicos.
- **`models/silver-bullet.ts`**: Opera **apenas** nas janelas de tempo estritas do ICT (London, NY AM, NY PM).
- **`models/ote.ts`**: Calcula a matriz Fibonacci em *Displacements* violentos e tenta a entrada no nível dourado de **70.5%**.
- **`killzones.ts`**: Temporizador que garante que as ordens (como a *Silver Bullet*) não são executadas no vazio asiático ou em "Dead Zones".

### 3. Orquestrador Central
- **`core.ts`**: O cérebro da operação. Ele recebe os dados limpos do Gráfico Diário, H4, M15 e M5. Dispara todos os motores de liquidez e testa os modelos MMXM, OTE, Silver Bullet e 2022 Setup. Quando um modelo valida uma entrada perfeita (com *Displacement* alinhado ao *Bias* Institucional), ele emite o sinal.

### 4. Integrações
- **`telegram.ts`**: Formata a saída do algoritmo num template visual altamente premium para ser enviado via Bot de Telegram para o telemóvel do utilizador, explicando o que motivou a entrada.
- **Painel UI (Frontend)**: Localizado em `apps/dashboard/app/components/ict/ICTPanel.tsx`, exibe a informação com *Glassmorphism* e estética Framer/Figma (com base em React).

---

## 🛠️ Como Manter e Alterar

- **Para alterar o nível de risco ou RR (Risk/Reward):** Vai diretamente aos ficheiros de modelo na pasta `/models` (ex: `mmxm.ts` ou `silver-bullet.ts`) e altera a variável `maxRMultiple`.
- **Para alterar fusos horários da Silver Bullet:** Vai a `killzones.ts` e ajusta os relógios (atualmente parametrizados para o fuso horário de *New York* - EST/EDT).
- **Para afinar os cálculos de Liquidez (se o algoritmo estiver muito sensível a ruído):** Edita as regras de verificação dos fractais em `liquidity.ts` (variáveis `isSwingHigh` e `isSwingLow`).

**Sistema construído para máxima rentabilidade e isolamento lógico.**
