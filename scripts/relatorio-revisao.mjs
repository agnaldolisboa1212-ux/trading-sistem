/**
 * Relatório das estratégias EM TESTE ao vivo — o que já se mediu desde que
 * começaram, para a conversa da revisão.
 *
 * Lê `sinais_tempo_real` (o motor grava aí o estado e o resultado em R de cada
 * sinal acompanhado) e resume por estratégia. Não decide nada: mostra os
 * números ao lado do que o backtest dizia antes, a decisão é de quem lê.
 *
 * Uso: node scripts/relatorio-revisao.mjs
 * Precisa de SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env. Com
 * TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID definidos, envia também por Telegram.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { ESTRATEGIAS_EM_TESTE } from '../packages/core/dist/strategies/em-teste.js';
import { sendTelegram } from '../packages/notify/dist/index.js';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Faltam SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no .env');
  process.exit(1);
}

const db = createClient(supabaseUrl, supabaseKey);

/** Média, acerto e pior queda de uma lista de resultados em R. */
function estatisticas(rs) {
  const n = rs.length;
  if (n === 0) return { n: 0, acerto: 0, expectativaR: 0, piorQueda: 0 };
  const soma = rs.reduce((a, r) => a + r, 0);
  let acumulado = 0;
  let pico = 0;
  let piorQueda = 0;
  for (const r of rs) {
    acumulado += r;
    if (acumulado > pico) pico = acumulado;
    if (pico - acumulado > piorQueda) piorQueda = pico - acumulado;
  }
  return {
    n,
    acerto: rs.filter((r) => r > 0).length / n,
    expectativaR: soma / n,
    piorQueda,
  };
}

async function run() {
  console.log('A gerar relatório de revisão das estratégias em teste...');
  let markdown = '📝 *RELATÓRIO DE REVISÃO (ESTRATÉGIAS EM TESTE)*\n\n';

  for (const est of ESTRATEGIAS_EM_TESTE) {
    // As datas e o que o backtest disse vivem em `emTeste`, não na raiz.
    const { desde, revisao, antes } = est.emTeste;

    const { data: sinais, error } = await db
      .from('sinais_tempo_real')
      .select('id,simbolo,timeframe,estado,resultado_r,gerado_em')
      .eq('estrategia', est.id)
      .gte('gerado_em', desde)
      .order('gerado_em', { ascending: true });

    if (error) {
      console.error(`Erro ao buscar sinais para ${est.id}:`, error.message);
      continue;
    }

    const fechados = (sinais ?? []).filter((s) => s.estado === 'fechada' && s.resultado_r !== null);
    const perdidos = (sinais ?? []).filter((s) => s.estado === 'perdido');
    const st = estatisticas(fechados.map((s) => Number(s.resultado_r)));

    markdown += `*${est.nome}*\n`;
    markdown += `📅 Desde: \`${desde}\` · Revisão: \`${revisao}\`\n`;
    markdown += `📊 Sinais: \`${(sinais ?? []).length}\` · fechados: \`${st.n}\` · sem entrada: \`${perdidos.length}\`\n`;

    if (st.n === 0) {
      markdown += `_Sem operações fechadas — nada a concluir ainda._\n`;
    } else {
      markdown += `• Acerto: \`${(st.acerto * 100).toFixed(1)}%\`\n`;
      markdown += `• Expectativa: \`${st.expectativaR.toFixed(2)}R\` por operação\n`;
      markdown += `• Pior queda acumulada: \`${st.piorQueda.toFixed(2)}R\`\n`;
      if (st.n < 30) {
        markdown += `⚠️ Só \`${st.n}\` operações: demasiado pouco para decidir.\n`;
      }
    }

    // `antes` é o texto do que o backtest disse — não um objecto de números.
    markdown += `_Antes do teste: ${antes}_\n\n`;
  }

  console.log(markdown);

  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    console.log('A enviar para o Telegram...');
    await sendTelegram(markdown);
    console.log('Enviado.');
  } else {
    console.log('Sem Telegram configurado.');
  }
}

run().catch(console.error);
