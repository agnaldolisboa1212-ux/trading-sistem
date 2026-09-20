/**
 * @trading/notify — entrega de sinais ao exterior.
 *
 * Tres canais, com papeis distintos:
 *
 *  - PUSH: notificacao no ecra do telemovel, com a app fechada. O motor nao a
 *    envia directamente — pede ao painel, que e quem guarda as subscricoes e as
 *    chaves VAPID. Assim ha UMA implementacao de push, nao duas.
 *
 *  - TELEGRAM: entrega direta ao operador. Usa-se quando se quer a mensagem no
 *    telemovel sem depender de mais nada estar de pe.
 *  - N8N: webhook generico. O n8n recebe o evento estruturado e reencaminha para
 *    onde o utilizador quiser (Telegram, email, Sheets, Discord, uma ordem
 *    manual...). E o ponto de extensao sem tocar em codigo.
 *
 * Ambos sao opcionais e auto-desativam-se se as variaveis de ambiente faltarem —
 * o motor continua a correr e a gravar na base de dados.
 */

import type { ExitSignal, TradeSignal } from '@trading/core';
import { estrategiaActiva } from '@trading/core';

/** Nome legível de uma estratégia — fonte única: @trading/core. */
const nomeEstrategia = (id: string) => estrategiaActiva(id)?.nome ?? id;

export interface NotifyResult {
  channel: string;
  ok: boolean;
  skipped: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Formatacao
// ---------------------------------------------------------------------------

/** Escapa os caracteres que o MarkdownV2 do Telegram exige escapar. */
function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

const stageLabel: Record<string, string> = {
  'low-risk-buy-sell': 'Low Risk Entry',
  'first-stage-acc-dist': '1a Acumulacao/Distribuicao',
  'silver-bullet': 'Silver Bullet',
};

/**
 * Mensagem de ENTRADA para Telegram (MarkdownV2).
 *
 * REESCRITA para ser decidível em cinco segundos no telemovel. A versao
 * anterior despejava os nove passos do checklist com o texto completo de cada
 * um, todos os alvos e todos os eventos SMT — quem a recebia tinha de ler
 * trinta linhas para saber o que fazer.
 *
 * A ordem agora responde as perguntas pela urgencia com que surgem:
 *
 *   1. o que e para onde   — simbolo e lado, na primeira linha
 *   2. os numeros para agir — entrada, stop, alvos
 *   3. quanto vale          — R maximo
 *   4. porque               — UMA linha
 *
 * O detalhe auditavel nao desaparece: continua inteiro na base de dados e no
 * painel. O que mudou foi a hierarquia, nao a informacao.
 */
export function formatEntryMessage(signal: TradeSignal): string {
  const compra = signal.direction === 'bullish';
  const seta = compra ? '🟢' : '🔴';
  const lado = compra ? 'COMPRA' : 'VENDA';

  const num = (v: number) => escapeMarkdown(v.toFixed(5));

  // Alvos numa so linha cada, sem a justificacao — essa vive no painel.
  const alvos = signal.targets
    .map((t, i) => `  TP${i + 1} \`${num(t.price)}\`  ${escapeMarkdown(t.rMultiple.toFixed(1))}R`)
    .join(String.fromCharCode(10));

  /*
   * O "porque" numa linha: a fase do modelo, o padrao de entrada e a
   * divergencia que o sustenta. Sao os tres factos que distinguem este sinal de
   * um qualquer toque num nivel.
   */
  const smt = signal.smtEvents[0];
  const porque = [
    `${signal.model.type} ${stageLabel[signal.entryStage ?? ''] ?? ''}`.trim(),
    signal.entryPattern?.kind,
    smt ? `SMT vs ${smt.reference}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const linhas = [
    `${seta} *SINAL: ${lado} ${escapeMarkdown(signal.symbol)}*`,
    '',
    `📍 Entrada: \`${num(signal.entryPrice)}\``,
    `🛑 Stop Loss: \`${num(signal.stopLoss)}\``,
    `🎯 Alvos:`,
    alvos,
    '',
    `📈 Risco/Retorno: *${escapeMarkdown(signal.maxRMultiple.toFixed(1))}R*`,
  ];

  if (signal.warnings.length > 0) {
    linhas.push(`⚠️ ${escapeMarkdown(signal.warnings[0] ?? '')}`);
  }

  return linhas.join(String.fromCharCode(10));
}

/** Mensagem de SAIDA pronta para Telegram. */
export function formatExitMessage(exit: ExitSignal): string {
  const emojiByReason: Record<string, string> = {
    'target-hit': '🎯',
    'stop-hit': '🛑',
    'model-completed': '🏁',
    'model-invalidated': '⚠️',
    'structure-broken': '⚠️',
    'smt-reversed': '🔄',
    'time-stop': '⏳',
  };

  return [
    `${emojiByReason[exit.reason] ?? '📌'} *SAIDA — ${escapeMarkdown(exit.symbol)}*`,
    '',
    `*Motivo:* ${escapeMarkdown(exit.reason)}`,
    `*Preco:* \`${exit.price.toFixed(5)}\``,
    `*Fechar:* ${(exit.closeFraction * 100).toFixed(0)}% da posicao`,
    `*Resultado:* ${exit.rMultipleRealized >= 0 ? '\\+' : ''}${exit.rMultipleRealized.toFixed(2)}R`,
    exit.newStopLoss !== null ? `*Novo stop:* \`${exit.newStopLoss.toFixed(5)}\`` : '',
    '',
    escapeMarkdown(exit.narrative),
  ]
    .filter(Boolean)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

function telegramConfig(): TelegramConfig | null {
  const botToken = process.env['TELEGRAM_BOT_TOKEN'] ?? '';
  const chatId = process.env['TELEGRAM_CHAT_ID'] ?? '';
  return botToken && chatId ? { botToken, chatId } : null;
}

export function isTelegramConfigured(): boolean {
  return telegramConfig() !== null;
}

/**
 * Envia uma mensagem ao Telegram.
 *
 * Faz fallback para texto simples se o MarkdownV2 for rejeitado: uma mensagem
 * entregue sem formatacao e infinitamente melhor do que um alerta perdido por
 * causa de um caractere mal escapado.
 */
export async function sendTelegram(text: string): Promise<NotifyResult> {
  const config = telegramConfig();
  if (!config) return { channel: 'telegram', ok: false, skipped: true };

  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    return { ok: res.ok, body: await res.text() };
  };

  try {
    const first = await post({
      chat_id: config.chatId,
      text,
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: true,
    });
    if (first.ok) return { channel: 'telegram', ok: true, skipped: false };

    // MarkdownV2 rejeitado — reenviar sem formatacao.
    const plain = text.replace(/\\([_*[\]()~`>#+\-=|{}.!\\])/g, '$1').replace(/[*_`]/g, '');
    const second = await post({
      chat_id: config.chatId,
      text: plain,
      disable_web_page_preview: true,
    });

    return second.ok
      ? { channel: 'telegram', ok: true, skipped: false }
      : { channel: 'telegram', ok: false, skipped: false, error: second.body.slice(0, 200) };
  } catch (err) {
    return {
      channel: 'telegram',
      ok: false,
      skipped: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// n8n
// ---------------------------------------------------------------------------

export function isN8nConfigured(): boolean {
  return Boolean(process.env['N8N_WEBHOOK_URL']);
}

/**
 * Envia um evento estruturado ao n8n.
 *
 * O payload e deliberadamente completo: o n8n nao deve ter de adivinhar nada
 * nem voltar a consultar a base de dados para montar uma mensagem ou uma acao.
 */
export async function sendToN8n(
  event:
    | 'signal.entry'
    | 'signal.exit'
    | 'signal.realtime'
    | 'signal.progress'
    | 'account.transaction'
    | 'scan.completed'
    | 'system.error',
  payload: unknown,
): Promise<NotifyResult> {
  const url = process.env['N8N_WEBHOOK_URL'] ?? '';
  if (!url) return { channel: 'n8n', ok: false, skipped: true };

  const secret = process.env['N8N_WEBHOOK_SECRET'] ?? '';

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { 'X-Webhook-Secret': secret } : {}),
      },
      body: JSON.stringify({
        event,
        emittedAt: new Date().toISOString(),
        source: 'sistema-de-trading',
        payload,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    return res.ok
      ? { channel: 'n8n', ok: true, skipped: false }
      : {
          channel: 'n8n',
          ok: false,
          skipped: false,
          error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`,
        };
  } catch (err) {
    return {
      channel: 'n8n',
      ok: false,
      skipped: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Payload compacto de um sinal, para o n8n e para webhooks genericos. */
export function signalPayload(signal: TradeSignal): Record<string, unknown> {
  return {
    id: signal.id,
    symbol: signal.symbol,
    timeframe: signal.timeframe,
    direction: signal.direction,
    side: signal.direction === 'bullish' ? 'BUY' : 'SELL',
    model: signal.model.type,
    phase: signal.model.phase,
    entryStage: signal.entryStage,
    entryPattern: signal.entryPattern?.kind ?? null,
    entryZone: [signal.entryZoneLow, signal.entryZoneHigh],
    entry: signal.entryPrice,
    stopLoss: signal.stopLoss,
    targets: signal.targets.map((t) => ({
      price: t.price,
      r: t.rMultiple,
      closeFraction: t.closeFraction,
    })),
    maxR: signal.maxRMultiple,
    confidence: signal.confidence,
    checklistScore: signal.checklist.score,
    smt: signal.smtEvents.map((e) => ({
      reference: e.reference,
      correlation: e.correlation,
      at: e.at,
      strength: e.strength,
    })),
    expectedHorizonDays: signal.expectedHorizonDays,
    generatedAt: new Date(signal.generatedAt).toISOString(),
    warnings: signal.warnings,
  };
}

// ---------------------------------------------------------------------------
// Push (via painel)
// ---------------------------------------------------------------------------

export interface AvisoPush {
  titulo: string;
  corpo: string;
  url?: string;
  /** Avisos com a mesma tag substituem-se no ecra em vez de empilharem. */
  tag?: string;
  /**
   * Segundos que o servico de push pode segurar o aviso ate o entregar. Por
   * omissao (no painel) uma hora; um sinal de 15 minutos nao serve depois disso.
   */
  validadeS?: number;
  /**
   * `high` para sinais: o Android em repouso atrasa avisos de urgencia normal
   * durante minutos. `normal` para o que pode esperar.
   */
  urgencia?: 'high' | 'normal';
  /** Um aviso por entregar com o mesmo topico e substituido pelo novo. */
  topico?: string;
  /** Instrumento do aviso: so chega a quem o escolheu nas preferencias. */
  simbolo?: string;
  /**
   * Timeframe do sinal: so chega a quem o tem no objetivo do onboarding
   * (intradiario 1h, swing 4h e 1d...). Sem ele, conta so o instrumento.
   */
  timeframe?: string;
}

function pushConfig(): { url: string; segredo: string } | null {
  const segredo = process.env['MOTOR_SEGREDO'] ?? '';
  if (!segredo) return null;
  // Sem DASHBOARD_URL, o painel e o processo irmao na mesma maquina, na porta
  // que a plataforma deu em PORT (a Hostinger escolhe-a; nao e sempre 3000).
  const url = (
    process.env['DASHBOARD_URL'] || `http://127.0.0.1:${process.env['PORT'] || '3000'}`
  ).replace(/\/+$/, '');
  return { url, segredo };
}

export function isPushConfigured(): boolean {
  return pushConfig() !== null;
}

/**
 * Pede ao painel que envie uma notificacao push a todos os subscritores.
 *
 * ── PORQUE PASSA PELO PAINEL ───────────────────────────────────────────────
 *
 * As subscricoes (endpoint + chaves de cada browser) sao registadas pelo painel,
 * que tambem guarda o par VAPID. O motor enviar directamente obrigaria a copiar
 * a chave privada VAPID para outro processo e a ler as subscricoes de dois
 * sitios. Uma chamada HTTP autenticada por segredo partilhado mantem uma so
 * implementacao.
 *
 * O segredo viaja num cabecalho e e comparado em tempo constante do outro lado.
 * Sem ele, qualquer pessoa que descobrisse o URL podia mandar notificacoes para
 * o telemovel de todos os utilizadores.
 */
export async function sendPush(aviso: AvisoPush): Promise<NotifyResult> {
  const cfg = pushConfig();
  if (!cfg) return { channel: 'push', ok: false, skipped: true };

  try {
    const res = await fetch(`${cfg.url}/api/push/enviar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Motor-Segredo': cfg.segredo },
      body: JSON.stringify(aviso),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return {
        channel: 'push',
        ok: false,
        skipped: false,
        error: `HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`,
      };
    }
    return { channel: 'push', ok: true, skipped: false };
  } catch (err) {
    // O painel em baixo nao pode derrubar o varrimento — o Telegram ja saiu.
    return {
      channel: 'push',
      ok: false,
      skipped: false,
      error: `painel inacessivel em ${cfg.url}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Difunde um sinal de entrada por todos os canais configurados. */
export async function broadcastEntry(signal: TradeSignal): Promise<NotifyResult[]> {
  const compra = signal.direction === 'bullish';
  return Promise.all([
    sendTelegram(formatEntryMessage(signal)),
    sendToN8n('signal.entry', signalPayload(signal)),
    sendPush({
      titulo: `${compra ? 'COMPRA' : 'VENDA'} ${signal.symbol} · ${signal.maxRMultiple.toFixed(1)}R`,
      corpo: `Entrada ${signal.entryPrice.toFixed(5)} · stop ${signal.stopLoss.toFixed(5)} · MMXM ${signal.timeframe}`,
      url: `/instrumento/${signal.symbol}?tf=${signal.timeframe}`,
      tag: signal.id,
      // Swing em velas diárias: continua útil durante horas.
      validadeS: 6 * 3600,
      urgencia: 'high',
      simbolo: signal.symbol,
    }),
  ]);
}

/** Difunde um sinal de saida por todos os canais configurados. */
export async function broadcastExit(exit: ExitSignal): Promise<NotifyResult[]> {
  return Promise.all([
    sendTelegram(formatExitMessage(exit)),
    sendPush({
      titulo: `SAIDA ${exit.symbol} · ${exit.rMultipleRealized >= 0 ? '+' : ''}${exit.rMultipleRealized.toFixed(2)}R`,
      corpo: `${exit.reason} a ${exit.price.toFixed(5)} · fechar ${(exit.closeFraction * 100).toFixed(0)}%`,
      url: `/instrumento/${exit.symbol}`,
      tag: `saida-${exit.signalId}`,
      validadeS: 6 * 3600,
      urgencia: 'high',
      simbolo: exit.symbol,
    }),
    sendToN8n('signal.exit', {
      signalId: exit.signalId,
      symbol: exit.symbol,
      reason: exit.reason,
      closeFraction: exit.closeFraction,
      price: exit.price,
      rMultiple: exit.rMultipleRealized,
      newStopLoss: exit.newStopLoss,
      narrative: exit.narrative,
      occurredAt: new Date(exit.time).toISOString(),
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Sinais do motor de tempo real
// ---------------------------------------------------------------------------

/**
 * Sinal do motor secundario (estrategias institucionais, intradiario).
 *
 * Tipo proprio e nao `TradeSignal`: estes sinais nao passam pelo checklist
 * MMXM, nao tem modelo, nem SMT, nem dimensionamento. Forca-los na mesma forma
 * obrigaria a inventar campos — e um campo inventado numa mensagem de trading e
 * pior do que um campo ausente.
 */
export interface SinalTempoReal {
  id: string;
  simbolo: string;
  nome?: string;
  timeframe: string;
  estrategia: string;
  direccao: 'bullish' | 'bearish';
  regime?: string;
  referencia?: number;
  zonaBaixa?: number;
  zonaAlta?: number;
  entrada: number;
  stop: number;
  alvos: Array<{ preco: number; r: number }>;
  rMaximo: number;
  /**
   * 0..1 — nas estrategias validadas e a taxa de acerto MEDIDA no backtest
   * (chegar ao primeiro alvo, ou fechar a ganhar, antes do stop).
   */
  conviccao: number;
  /** Quantas estrategias distintas apontam no mesmo sentido nesta vela. */
  concordam?: number;
  razao: string;
  casas: number;
  /** Abertura da vela que gerou o sinal (ms UTC). */
  geradoEm: number;
  avisos: string[];
  /** Preco no momento do anuncio (a vela seguinte, em formacao). */
  precoActual?: number;
  /** Onde esta esse preco em relacao ao plano. */
  estadoPreco?: 'na-entrada' | 'a-aguardar' | 'melhor-que-entrada';
  /** Distancia do preco a entrada, em R; positivo = a favor. */
  distanciaR?: number;
  /** Segundos que o push pode esperar pela entrega. */
  validadeAvisoS?: number;
  /** Notícia de alto impacto do instrumento por perto (calendário económico). */
  noticia?: string;
  /** Estratégia em teste ao vivo: sem taxa de acerto medida (a convicção é 0). */
  emTeste?: boolean;
}

/** Frase curta sobre o preco actual, para o aviso e para o Telegram. */
export function frasePreco(s: SinalTempoReal): string | null {
  if (s.precoActual === undefined || s.estadoPreco === undefined) return null;
  const compra = s.direccao === 'bullish';
  const r = s.distanciaR ?? 0;
  const dist = `${r >= 0 ? '+' : '-'}${Math.abs(r).toFixed(1)}R`;
  switch (s.estadoPreco) {
    case 'na-entrada':
      return 'no preco de entrada agora';
    case 'a-aguardar':
      return `${dist} da entrada · esperar ${compra ? 'recuo' : 'subida'} ate ${s.entrada.toFixed(s.casas)}`;
    case 'melhor-que-entrada':
      return `${dist} · ${compra ? 'abaixo' : 'acima'} da entrada, stop intacto`;
  }
}



/** Mensagem de Telegram para um sinal de tempo real — mesma hierarquia da de entrada. */
export function formatarSinalTempoReal(s: SinalTempoReal): string {
  const compra = s.direccao === 'bullish';
  // Dentro de `codigo` o MarkdownV2 so exige escapar crase e barra — nunca aparecem num numero.
  const n = (v: number) => v.toFixed(s.casas);
  const nl = String.fromCharCode(10);

  const alvos = s.alvos
    .slice(0, 3)
    .map((a, i) => `  TP${i + 1} \`${n(a.preco)}\`  ${escapeMarkdown(a.r.toFixed(1))}R`)
    .join(nl);

  const razao = s.razao.length > 320 ? `${s.razao.slice(0, 317)}...` : s.razao;
  const acordo = s.concordam && s.concordam > 1 ? ` · ${s.concordam} estrategias de acordo` : '';

  const agora = frasePreco(s);
  const linhas = [
    `${compra ? '🟢' : '🔴'} *${compra ? 'COMPRA' : 'VENDA'} ${escapeMarkdown(s.simbolo)}* · ${escapeMarkdown(s.timeframe)}`,
    '',
    `entrada \`${n(s.entrada)}\``,
    `stop    \`${n(s.stop)}\``,
    alvos,
    ...(agora && s.precoActual !== undefined
      ? ['', `agora   \`${n(s.precoActual)}\` · ${escapeMarkdown(agora)}`]
      : []),
    '',
    `*${s.emTeste ? 'EM TESTE, sem acerto medido' : `${Math.round(s.conviccao * 100)}% de acerto medido`}* · ${escapeMarkdown((nomeEstrategia(s.estrategia)) + acordo)}`,
    '',
    `_${escapeMarkdown(razao)}_`,
  ];
  if (s.avisos[0]) linhas.push(`⚠️ ${escapeMarkdown(s.avisos[0].slice(0, 160))}`);
  return linhas.join(nl);
}

/** Difunde um sinal de tempo real por Telegram, n8n e push. */
export async function difundirSinalTempoReal(s: SinalTempoReal): Promise<NotifyResult[]> {
  const compra = s.direccao === 'bullish';
  const estrategia = nomeEstrategia(s.estrategia);
  return Promise.all([
    sendTelegram(formatarSinalTempoReal(s)),
    sendToN8n('signal.realtime', {
      ...s,
      lado: compra ? 'BUY' : 'SELL',
      estrategiaNome: estrategia,
      geradoEm: new Date(s.geradoEm).toISOString(),
    }),
    sendPush({
      titulo: `${compra ? 'COMPRA' : 'VENDA'} ${s.simbolo} ${s.timeframe} · ${s.emTeste ? 'EM TESTE' : `${Math.round(s.conviccao * 100)}% de acerto medido`}`,
      corpo: [
        `Entrada ${s.entrada.toFixed(s.casas)} · stop ${s.stop.toFixed(s.casas)}` +
          (s.alvos[0] ? ` · alvo ${s.alvos[0].preco.toFixed(s.casas)}` : ''),
        s.precoActual !== undefined ? `Agora ${s.precoActual.toFixed(s.casas)} · ${frasePreco(s)}` : null,
        s.noticia ? `⚠ ${s.noticia.slice(0, 140)}` : null,
        estrategia,
      ]
        .filter(Boolean)
        .join(String.fromCharCode(10)),
      // Abre o gráfico já na estratégia que deu o sinal.
      url: `/grafico?s=${encodeURIComponent(s.simbolo)}&tf=${s.timeframe}&v=${s.estrategia}`,
      tag: s.id,
      validadeS: s.validadeAvisoS,
      urgencia: 'high',
      topico: `${s.simbolo}-${s.timeframe}`,
      simbolo: s.simbolo,
      timeframe: s.timeframe,
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Movimentos da conta Deriv (o "webhook" que a Deriv nao tem)
// ---------------------------------------------------------------------------

export interface TransaccaoConta {
  contaId: string;
  tipoConta: 'demo' | 'real';
  /** `buy`, `sell`, `deposit`, `withdrawal`… tal como a Deriv o escreve. */
  accao: string;
  /** Negativo numa compra, o pagamento recebido num fecho. */
  montante: number;
  saldo: number;
  moeda: string;
  contratoId: number | null;
  simbolo: string | null;
  descricao: string;
  transaccaoId: string;
  em: number;
}

function tituloTransaccao(t: TransaccaoConta): string {
  switch (t.accao) {
    case 'buy':
      return '🟦 ORDEM EXECUTADA';
    case 'sell':
      return t.montante > 0 ? '✅ CONTRATO FECHADO COM PAGAMENTO' : '❌ CONTRATO FECHADO SEM PAGAMENTO';
    case 'deposit':
      return '💵 DEPOSITO';
    case 'withdrawal':
      return '🏧 LEVANTAMENTO';
    default:
      return `📌 MOVIMENTO (${t.accao})`;
  }
}

/** Mensagem de Telegram para um movimento: o que aconteceu, quanto, saldo. */
export function formatarTransaccao(t: TransaccaoConta): string {
  const sinal = t.montante > 0 ? '+' : '';
  const nl = String.fromCharCode(10);
  return [
    `*${escapeMarkdown(tituloTransaccao(t))}* · ${t.tipoConta === 'real' ? 'REAL' : 'DEMO'} ${escapeMarkdown(t.contaId)}`,
    '',
    `movimento \`${sinal}${t.montante.toFixed(2)} ${t.moeda}\``,
    `saldo     \`${t.saldo.toFixed(2)} ${t.moeda}\``,
    t.simbolo ? `instrumento ${escapeMarkdown(t.simbolo)}` : '',
    t.descricao ? `_${escapeMarkdown(t.descricao.slice(0, 200))}_` : '',
  ]
    .filter((l, i) => l !== '' || i === 1)
    .join(nl);
}

/**
 * Telegram e n8n — e NAO push.
 *
 * As subscricoes push sao de todos os utilizadores; um movimento na conta de uma
 * pessoa nao pode aparecer no telemovel de outra. Telegram e n8n sao canais do
 * dono do servidor, que e de quem e a conta que o motor ouve.
 */
export async function difundirTransaccao(t: TransaccaoConta): Promise<NotifyResult[]> {
  return Promise.all([
    sendTelegram(formatarTransaccao(t)),
    sendToN8n('account.transaction', { ...t, em: new Date(t.em).toISOString() }),
  ]);
}

// ---------------------------------------------------------------------------
// Andamento das operacoes (entrada, +1R, alvo, stop, saida, stop movel, vies)
// ---------------------------------------------------------------------------

export interface AvisoOperacao {
  sinalId: string;
  simbolo: string;
  timeframe: string;
  estrategia: string;
  /** Ex.: "+1R atingido", ja com o resultado quando o ha. */
  titulo: string;
  corpo: string;
  /** Stop, saida e mudanca de vies pedem accao ja; o resto pode esperar. */
  urgente: boolean;
}

/**
 * Difunde um evento do andamento de uma operacao.
 *
 * Usa a `tag` do sinal: no telemovel, o aviso de andamento substitui o anterior
 * do mesmo sinal em vez de empilhar. Chega a quem segue o instrumento no
 * timeframe do sinal, como o proprio sinal.
 */
export async function difundirAvisoOperacao(a: AvisoOperacao): Promise<NotifyResult[]> {
  const nome = nomeEstrategia(a.estrategia);
  const nl = String.fromCharCode(10);
  return Promise.all([
    sendTelegram(
      [
        `${a.urgente ? '⚠️' : 'ℹ️'} *${escapeMarkdown(a.simbolo)}* · ${escapeMarkdown(a.timeframe)} · ${escapeMarkdown(a.titulo)}`,
        '',
        escapeMarkdown(a.corpo),
        `_${escapeMarkdown(nome)}_`,
      ].join(nl),
    ),
    sendToN8n('signal.progress', { ...a, estrategiaNome: nome }),
    sendPush({
      titulo: `${a.simbolo} ${a.timeframe} · ${a.titulo}`,
      corpo: `${a.corpo}${nl}${nome}`,
      url: `/grafico?s=${encodeURIComponent(a.simbolo)}&tf=${a.timeframe}&v=${a.estrategia}&sinal=${encodeURIComponent(a.sinalId)}`,
      tag: a.sinalId,
      validadeS: a.urgente ? 1800 : 7200,
      urgencia: a.urgente ? 'high' : 'normal',
      simbolo: a.simbolo,
      timeframe: a.timeframe,
    }),
  ]);
}
