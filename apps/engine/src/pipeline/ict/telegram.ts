// @ts-nocheck
import { TradeSignal } from '@trading/core';

/**
 * Subagente 3 (Extensão): Módulo de formatação de alertas VIP para o Telegram.
 * Formata os sinais da Master Engine ICT para mensagens de alta conversão visual
 * a serem entregues no telemóvel do utilizador com explicações detalhadas.
 */
export class TelegramFormatter {
  
  public static formatIctSignal(signal: any): string {
    const isBullish = signal.direction === 'bullish';
    const directionEmoji = isBullish ? '🟢 COMPRA (LONG)' : '🔴 VENDA (SHORT)';
    const targetEmoji = isBullish ? '🚀' : '🩸';
    
    // Formatação em MarkdownV2 suportada nativamente pela API do Telegram
    return `
🏦 <b>ICT ALGO: INSTITUTIONAL FLOW</b> 🏦
<i>ALERTA DE ALTA PRECISÃO</i>

📊 <b>Ativo:</b> ${signal.symbol || 'EURUSD'}
🎯 <b>Direção:</b> ${directionEmoji}
📐 <b>Modelo Usado:</b> <code>${signal.model}</code>

--- <b>ZONAS DE EXECUÇÃO</b> ---
📍 <b>Entrada Exata:</b> <code>${signal.entry}</code>
⛔ <b>Invalidação (SL):</b> <code>${signal.stop}</code>
✅ <b>Alvo Final (TP):</b> <code>${signal.target}</code> ${targetEmoji}

--- <b>NARRATIVA INSTITUCIONAL</b> ---
💡 <b>Bias Macro:</b> ${signal.bias}
🔍 <b>Justificação do Setup:</b>
<i>"${signal.explanation}"</i>

⚠️ <i>Gestão de Risco: Risco Máximo Recomendado de 1% a 2% do capital.</i>
⏳ <b>Timestamp:</b> ${new Date().toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' })}
    `.trim();
  }
}
