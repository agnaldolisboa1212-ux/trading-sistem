# Algoritmo ICT (Inner Circle Trader) - Documentação e Estrutura

## Arquitetura Top-Down
Este algoritmo analisa o mercado simulando a mente do Inner Circle Trader:
1. **Bias Diário:** Identifica a direção macro baseada em quebras de estrutura (BOS).
2. **Setup H1/H4:** Localiza zonas de liquidez (Buy-side e Sell-side) que foram varridas (*Liquidity Sweeps*).
3. **Trigger M15:** Procura por uma inversão imediata (Market Structure Shift / MSS) gerando um Fair Value Gap (FVG) ou Order Block (OB).
4. **Sinal:** Dispara o alerta com a tag `"ICT ALGO"` quando todas as condições alinham.

## Integração
- **Backend:** `apps/engine/src/pipeline/ict.ts` orquestra a lógica e envia eventos pelo WebSocket ou Notificações via N8N/Telegram.
- **Frontend:** `apps/dashboard/app/components/ict/ICTPanel.tsx` exibe os sinais na UI de forma premium e elegante. O utilizador pode alternar entre as estratégias no `/grafico`.

## Diferenciação
Ao contrário de robôs comuns, o `ict.ts` não usa médias móveis ou RSI. Trabalha puramente na geometria dos preços e caça à liquidez institucional, garantindo independência no ecossistema e evitando poluir outros modelos.
