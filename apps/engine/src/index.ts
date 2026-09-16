/**
 * Ponto de entrada dos motores.
 *
 *   npm run engine:scan          motor principal (MMXM diário), uma passagem
 *   npm run engine:tempo-real    motor de tempo real, uma passagem
 *   npm run engine:dev           agendador com os dois motores, contínuo
 *   npm run sistema              agendador + painel, tudo junto
 *
 * ── DOIS MOTORES, DOIS RITMOS ──────────────────────────────────────────────
 *
 * PRINCIPAL — MMXM + SMT sobre velas diárias. Por omissão às 22:15 UTC nos dias
 * úteis, depois do fecho de Nova Iorque, para a vela diária já estar fechada.
 * Inclui a gestão das posições paper: preenchimentos, alvos, stops.
 *
 * TEMPO REAL — as quatro estratégias institucionais em 15m e 1h, a cada minuto,
 * sobre o que os utilizadores escolheram. Só pede velas a um par quando lá
 * fechou uma vela nova, por isso a maior parte das passagens não faz pedidos.
 *
 * Nenhum dos dois envia ordens. Nunca.
 */

import cron from 'node-cron';
import { loadEnvFile } from './env.js';

/*
 * O .env tem de ser carregado ANTES de `loadConfig()` e antes de qualquer
 * módulo que leia `process.env` no topo. Por isso os restantes imports são
 * dinâmicos e vêm a seguir.
 */
const envResult = loadEnvFile();

const { describeConfig, loadConfig } = await import('./config.js');
const { formatScanReport, runScan } = await import('./pipeline/scan.js');
const { correrTempoReal, formatarRelatorioTempoReal } = await import('./pipeline/tempo-real.js');
const estado = await import('./pipeline/estado.js');
const { iniciarOuvinteConta, ouvinteConfigurado } = await import('./pipeline/conta-ouvinte.js');
const { closeDerivConnection } = await import('@trading/data');

const config = loadConfig();
const iso = (ms: number) => new Date(ms).toISOString();
const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

// Guardas contra sobreposição: uma passagem lenta não pode acumular outras.
let principalACorrer = false;
let tempoRealACorrer = false;

async function motorPrincipal(): Promise<void> {
  if (principalACorrer) {
    console.log('[motor principal] a passagem anterior ainda não acabou — disparo ignorado');
    return;
  }
  principalACorrer = true;
  const inicio = Date.now();
  estado.marcarInicio('diario');
  try {
    const report = await runScan(config);
    console.log(formatScanReport(report, config));
    await estado.registarExecucao('diario', {
      iniciadoEm: iso(inicio),
      terminadoEm: iso(Date.now()),
      duracaoMs: Date.now() - inicio,
      instrumentos: report.symbolsAnalyzed,
      sinais: report.signalsGenerated,
      novos: report.newSignals.length,
      ok: true,
      resumo: `${report.symbolsAnalyzed} instrumentos · ${report.signalsGenerated} sinal(is) MMXM`,
      erros: report.errors.slice(0, 20),
    });
  } catch (err) {
    console.error('[motor principal] falhou:', err instanceof Error ? err.stack : err);
    process.exitCode = 1;
    await estado.registarExecucao('diario', {
      iniciadoEm: iso(inicio),
      terminadoEm: iso(Date.now()),
      duracaoMs: Date.now() - inicio,
      instrumentos: 0,
      sinais: 0,
      novos: 0,
      ok: false,
      resumo: 'falhou',
      erros: [msg(err)],
    });
  } finally {
    principalACorrer = false;
  }
}

async function motorTempoReal(): Promise<void> {
  if (tempoRealACorrer) return;
  tempoRealACorrer = true;
  const inicio = Date.now();
  estado.marcarInicio('tempoReal');
  try {
    const r = await correrTempoReal(config);
    // Passagem sem vela nova em lado nenhum: não suja a consola.
    if (r.analises.length > 0 || r.erros.length > 0) console.log(formatarRelatorioTempoReal(r));
    await estado.registarExecucao('tempoReal', {
      iniciadoEm: iso(inicio),
      terminadoEm: iso(Date.now()),
      duracaoMs: Date.now() - inicio,
      instrumentos: r.simbolos.length,
      sinais: r.analises.filter((a) => a.escolhido).length,
      novos: r.novos.length,
      ok: true,
      resumo: `${r.simbolos.length} instrumentos × ${r.timeframes.join('/')} · ${r.novos.length} novo(s)`,
      erros: r.erros.slice(0, 20),
    });
  } catch (err) {
    console.error('[motor tempo real] falhou:', err instanceof Error ? err.stack : err);
    await estado.registarExecucao('tempoReal', {
      iniciadoEm: iso(inicio),
      terminadoEm: iso(Date.now()),
      duracaoMs: Date.now() - inicio,
      instrumentos: 0,
      sinais: 0,
      novos: 0,
      ok: false,
      resumo: 'falhou',
      erros: [msg(err)],
    });
  } finally {
    tempoRealACorrer = false;
  }
}

/**
 * Espera que o painel responda antes da primeira passagem.
 *
 * O push não sai do motor: é o painel que o envia. Quando os dois arrancam
 * juntos (`npm run sistema`), o motor fica pronto em dois segundos e o painel
 * em vinte — e a primeira passagem do tempo real anunciava os sinais com o
 * painel ainda a compilar. O Telegram chegava, o push falhava, e como a
 * deduplicação marca o sinal como anunciado, nunca mais era reenviado.
 *
 * Só espera se o push estiver configurado, e desiste ao fim de dois minutos:
 * um painel em baixo não pode impedir os motores de trabalhar.
 */
async function esperarPainel(): Promise<void> {
  if (!process.env['MOTOR_SEGREDO']) return;
  const url = (
    process.env['DASHBOARD_URL'] || `http://127.0.0.1:${process.env['PORT'] || '3000'}`
  ).replace(/\/+$/, '');
  const limite = Date.now() + 120_000;
  let avisou = false;

  while (Date.now() < limite) {
    try {
      const r = await fetch(`${url}/api/motores`, { signal: AbortSignal.timeout(15_000) });
      if (r.ok) {
        console.log(`[motores] painel disponível em ${url} — avisos push activos`);
        return;
      }
    } catch {
      /* ainda a arrancar */
    }
    if (!avisou) {
      console.log(`[motores] à espera do painel em ${url} para os avisos push…`);
      avisou = true;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.warn(
    `[motores] o painel não respondeu em ${url} em 2 minutos. Os motores arrancam na mesma: ` +
      'Telegram e n8n seguem normalmente, o push falha até o painel voltar.',
  );
}

const comando = process.argv[2] ?? 'scan';

if (envResult.path) {
  console.log(`[motores] .env carregado de ${envResult.path} (${envResult.loaded} variáveis)`);
} else {
  console.log('[motores] sem .env — a usar apenas as variáveis do ambiente');
}

if (comando === 'scan') {
  console.log(`[motor principal] passagem única | ${describeConfig(config)}`);
  estado.marcarArranque('unico', null);
  await motorPrincipal();
  closeDerivConnection();
} else if (comando === 'tempo-real') {
  console.log(
    `[motor tempo real] passagem única | ${config.tempoReal.timeframes.join('/')} | ` +
      `minR=${config.tempoReal.minR} minConvicção=${config.tempoReal.minConviccao}`,
  );
  estado.marcarArranque('unico', null);
  await motorTempoReal();
  closeDerivConnection();
} else if (comando === 'schedule') {
  const crons: Array<[string, string]> = [
    ['principal', config.cron],
    ['tempo real', config.tempoReal.cron],
  ];
  for (const [nome, expr] of crons) {
    if (!cron.validate(expr)) {
      console.error(`[motores] cron do motor ${nome} inválido: "${expr}"`);
      process.exit(1);
    }
  }

  estado.marcarArranque('agendador', { diario: config.cron, tempoReal: config.tempoReal.cron });
  console.log(`[motor principal]  cron="${config.cron}" | ${describeConfig(config)}`);
  console.log(
    `[motor tempo real] cron="${config.tempoReal.cron}" | ${config.tempoReal.timeframes.join('/')} | ` +
      `vigilância=${config.tempoReal.simbolos.length > 0 ? config.tempoReal.simbolos.join(',') : 'perfis/omissão'}`,
  );

  // Antes dos crons: um disparo do minuto seguinte não pode passar à frente.
  await esperarPainel();

  cron.schedule(config.cron, () => void motorPrincipal());
  cron.schedule(config.tempoReal.cron, () => void motorTempoReal());

  // Ouvinte da conta Deriv: ordens, fechos e depósitos passam a avisos.
  let pararOuvinte: (() => void) | null = null;
  if (ouvinteConfigurado()) {
    pararOuvinte = await iniciarOuvinteConta();
  } else {
    console.log('[conta] ouvinte desligado (sem DERIV_TOKEN/DERIV_APP_ID, ou DERIV_OUVIR_CONTAS=nenhuma)');
  }

  // Batimento: é o que permite ao painel distinguir "à espera" de "morto".
  setInterval(() => estado.batimento(), 60_000);

  const parar = () => {
    pararOuvinte?.();
    estado.marcarParagem();
    closeDerivConnection();
    process.exit(0);
  };
  process.on('SIGINT', parar);
  process.on('SIGTERM', parar);

  // Arranque: tempo real primeiro (segundos), depois o principal (inclui posições).
  await motorTempoReal();
  await motorPrincipal();
  console.log('[motores] a aguardar os próximos disparos. Ctrl+C para sair.');
} else if (comando === 'estado') {
  console.log(JSON.stringify(estado.lerEstado(), null, 2));
} else {
  console.error(`Comando desconhecido: "${comando}". Use scan, tempo-real, schedule ou estado.`);
  process.exit(1);
}
