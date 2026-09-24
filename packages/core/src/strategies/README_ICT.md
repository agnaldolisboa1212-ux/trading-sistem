# ICT Advanced Strategy Algo

Este algoritmo foi desenvolvido puramente com base nos conceitos ensinados por [The Inner Circle Trader (ICT)](https://www.theinnercircletraders.com/). 

Diferente das outras estratégias existentes neste sistema, o **ICT Algo** é um ecossistema independente e completo que analisa o mercado em múltiplos timeframes ("Top-Down Analysis") para fornecer sinais altamente assertivos, não se misturando com as lógicas das restantes mesas institucionais, a menos que especificado.

## Visão Geral do Ecossistema

Esta framework cobre todo o ciclo de vida:

1. **Subagente 1 (Scraping/Análise de Conteúdo)**: Extraímos as nuances puras dos setups avançados ICT diretamente de toda a base de conhecimento.
2. **Subagente 2 (Lógica Algorítmica)**: Localizado em `packages/core/src/strategies/ict-advanced.ts`. Mapeia as lógicas extraídas: Liquidity Sweeps, FVG (Fair Value Gaps), MSS (Market Structure Shifts), alinhamento de Timeframes.
3. **Subagente 3 (UI/UX e Frontend)**: Criada a secção visual isolada no gráfico através do componente `ICTPanel.tsx` em `apps/dashboard/components/ict/`. Fornece a leitura visual, botões independentes e justificativas claras (`[ICT ALGO]`).
4. **Subagente 4 (DevOps e Monitorização)**: Lógica estruturada para isolamento - se uma estratégia antiga falhar, a ICT não cai. Testado nos fluxos de builds normais do React e Typescript.
5. **Subagente 5 (Segurança)**: O algoritmo trabalha **exclusivamente com os ativos já definidos pelo utilizador no portfólio**. Não abre portas para novos símbolos não solicitados e valida inputs, prevenindo injeções no gráfico.
6. **Subagente 6 (Histórico)**: Estrutura modular preparada para testes de backtest nativos do sistema.

## Documentos e Códigos Criados/Alterados

Se alguma outra Inteligência Artificial assumir a continuidade deste projeto, este é o mapa do que foi construído para o ICT Algo:

- `packages/core/src/strategies/ict-advanced.ts`: **O Motor Principal.** Toda a deteção matemática (FVG, MSS, Sweeps) e geração de sinais com a tag `ict-advanced` é feita aqui.
- `packages/core/src/strategies/types.ts`: Adicionado `ict-advanced` ao tipo global de `StrategyId`.
- `packages/core/src/strategies/index.ts`: Importado o motor no core institucional do sistema e injetado o roteamento do `ALL_STRATEGIES`.
- `apps/dashboard/components/ict/ICTPanel.tsx`: **O Visual.** A secção de interface para o terminal, exibindo justificativas detalhadas e alertas "ICT ALGO".
- `apps/dashboard/app/grafico/page.tsx`: Importação e instanciação do `ICTPanel` para o ecrã ficar perfeitamente enquadrado com os controlos de tempo e de símbolo que já existiam, de modo a ter a análise contínua ao rolar os tempos gráficos.

## Como Alterar ou Melhorar as Condições (Setup ICT)

A Inteligência Artificial seguinte deve ir diretamente a `packages/core/src/strategies/ict-advanced.ts` se quiser:
- Tornar o *Liquidity Sweep* mais sensível.
- Ajustar os parâmetros que configuram um *Fair Value Gap*.
- Adicionar horários de *Killzones* específicas (ex: London, NY, Asian).
