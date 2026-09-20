import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { ESTRATEGIAS_EM_TESTE } from '../packages/core/dist/strategies/em-teste.js';
import { sendTelegram } from '../packages/notify/dist/index.js';
import { calcularEstatisticas } from '../packages/core/dist/risk/metrics.js';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Faltam SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no .env');
  process.exit(1);
}

const db = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log('A gerar relatório de revisão das estratégias em teste...');
  let markdown = '📝 *RELATÓRIO DE REVISÃO (ESTRATÉGIAS EM TESTE)*\n\n';

  for (const est of ESTRATEGIAS_EM_TESTE) {
    if (!est.revisao) continue;
    
    // Ler sinais desta estratégia gerados após a data "desde"
    const { data: sinais, error } = await db
      .from('sinais_tempo_real')
      .select('*')
      .eq('estrategia', est.id)
      .gte('gerado_em', est.desde)
      .order('gerado_em', { ascending: true });

    if (error) {
      console.error(`Erro ao buscar sinais para ${est.id}:`, error.message);
      continue;
    }

    const fechados = sinais.filter(s => s.estado === 'fechada' && s.resultado_r !== null);
    const perdidos = sinais.filter(s => s.estado === 'perdido');
    
    const rValues = fechados.map(s => Number(s.resultado_r));
    // As perdas por não atingir a entrada mas ir ao stop não dão draw-down? Se foi perdido (foi pro alvo sem tocar entrada), R = 0 para a conta, ou nem entrou. 
    // Só as fechadas nos dão o acerto e R.
    
    const estatisticas = calcularEstatisticas(rValues);
    
    markdown += `*${est.nome}*\n`;
    markdown += `📅 Desde: \`${est.desde}\` · Revisão: \`${est.revisao}\`\n`;
    
    if (estatisticas.n === 0) {
      markdown += `_Sem operações fechadas._\n\n`;
      continue;
    }

    const antes = est.antes;
    markdown += `*Estatísticas (vs Backtest)*\n`;
    markdown += `• N: \`${estatisticas.n}\` (esperado: \`${antes.operacoes}\`)\n`;
    markdown += `• Acerto: \`${(estatisticas.winRate * 100).toFixed(1)}%\` (antes: \`${(antes.acerto * 100).toFixed(1)}%\`)\n`;
    markdown += `• Expectativa R: \`${estatisticas.expectativaR.toFixed(2)}R\` (antes: \`${antes.expectativaR.toFixed(2)}R\`)\n`;
    markdown += `• Pior Drawdown: \`${estatisticas.maxDrawdown.toFixed(2)}R\`\n`;
    markdown += `• Sinais não acionados (perdidos): \`${perdidos.length}\`\n\n`;
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
