/**
 * Estratégias em teste ao vivo — geram sinais sem taxa de acerto medida.
 *
 * Os testes fixam as regras que vão ser avaliadas ao fim da semana: se alguém
 * mudar um limiar a meio, os resultados deixam de ser de uma regra só.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acompanharOperacao,
  estrategiaActiva,
  estrategiaEmTeste,
  estrategiaValidada,
  estrategiasPara,
  executarEstrategiasValidadas,
  fraseEvento,
  planAberturaDaxTeste,
  planTendenciaBaixaCripto,
  sessaoDax,
} from '../dist/index.js';

const H = 3_600_000;
const vela = (time, open, high, low, close) => ({ time, open, high, low, close, volume: 0 });

test('em teste: forex e ouro intradiário, nunca como validadas', () => {
  // O VWAP do forex foi DESLIGADO em 23/09/2026 (−0,079R, t=−5,5 em 5487
  // operações). O EURUSD ficou sem estratégia nenhuma, e é a leitura honesta.
  assert.deepEqual(estrategiasPara('EURUSD', '1h').map((e) => e.id), []);
  assert.equal(estrategiaActiva('vwap-forex-teste'), undefined);
  assert.deepEqual(estrategiasPara('GBPJPY', '4h').map((e) => e.id), []);
  // Em 15M só os dois algos, em teste desde 25/09/2026.
  assert.deepEqual(estrategiasPara('XAUUSD', '15m').map((e) => e.id), ['ict-algo']);
  assert.deepEqual(estrategiasPara('XAUUSD', '1d').map((e) => e.id), ['tendencia-ouro']);
  assert.deepEqual(estrategiasPara('USDJPY', '15m').map((e) => e.id), ['ict-algo', 'asia-range-algo']);
  assert.equal(estrategiaValidada('ict-algo'), undefined);
  assert.equal(estrategiaValidada('asia-range-algo'), undefined);
  assert.equal(estrategiaValidada('tendencia-baixa-cripto'), undefined);
  assert.equal(estrategiaActiva('tendencia-baixa-cripto')?.id, 'tendencia-baixa-cripto');
  // O SMT foi retirado em 22/09/2026: não é estratégia nenhuma.
  assert.equal(estrategiaActiva('smt-teste'), undefined);
});

/** Um mês de velas de 1h a oscilar e um movimento final forte (para cima ou para baixo). */
function mesComMovimento(delta) {
  const inicio = Date.UTC(2026, 8, 1);
  const v = [];
  let p = 1.1;
  for (let i = 0; i < 200; i++) {
    const c = 1.1 + Math.sin(i / 3) * 0.0006;
    v.push(vela(inicio + i * H, p, Math.max(p, c) + 0.0003, Math.min(p, c) - 0.0003, c));
    p = c;
  }
  for (let k = 1; k <= 5; k++) {
    const c = 1.1 + (delta * k) / 6;
    v.push(vela(inicio + (200 + k) * H, p, Math.max(p, c) + 0.00005, Math.min(p, c) - 0.00005, c));
    p = c;
  }
  // A vela do SINAL vira contra o movimento, mantendo-se além dos 2σ: é a
  // confirmação que a regra passou a exigir em 23/09/2026 (não entrar enquanto
  // o preço ainda vai a correr no sentido do movimento).
  if (delta !== 0) {
    const fim = 1.1 + delta;
    const abre = fim + delta * 0.05;
    v.push(vela(inicio + 206 * H, abre, Math.max(abre, fim) + 0.00005, Math.min(abre, fim) - 0.00005, fim));
  }
  return v;
}

/** 220 diárias a subir (ou a descer), que acabam antes do sinal. */
function diarias(subir) {
  const fim = Date.UTC(2026, 8, 1);
  const v = [];
  for (let i = 0; i < 220; i++) {
    const c = subir ? 1.0 + i * 0.001 : 1.3 - i * 0.001;
    v.push(vela(fim - (220 - i) * 86_400_000, c, c + 0.002, c - 0.002, c));
  }
  return v;
}

const D = 86_400_000;

/** Declínio para ~100 (200 velas), depois um patamar plano — SMA200 fica acima do preço actual. */
function tendenciaBaixaCripto() {
  const v = [];
  let p = 300;
  for (let i = 0; i < 150; i++) {
    const c = p - 200 / 150;
    v.push(vela(i * D, p, Math.max(p, c) + 0.3, Math.min(p, c) - 0.3, c));
    p = c;
  }
  for (let i = 150; i < 230; i++) {
    const c = 100 + (i % 3) * 0.1 - 0.1;
    v.push(vela(i * D, p, Math.max(p, c) + 0.2, Math.min(p, c) - 0.2, c));
    p = c;
  }
  return v;
}

test('Tendência de baixa — cripto: vende no rompimento do mínimo, abaixo da SMA200, sem convicção', () => {
  const base = tendenciaBaixaCripto();
  const rompe = [...base, vela(230 * D, 100, 100.2, 94, 95)];
  const s = planTendenciaBaixaCripto(rompe, { symbol: 'BTCUSD', timeframe: '1d' });
  assert.equal(s.length, 1);
  assert.equal(s[0].strategy, 'tendencia-baixa-cripto');
  assert.equal(s[0].direction, 'bearish');
  assert.equal(s[0].targets.length, 0, 'sem alvo fixo');
  assert.ok(s[0].stopLoss > s[0].entryPrice, 'stop acima da entrada, numa venda');
  assert.equal(s[0].conviction, 0);
  assert.match(s[0].rationale, /Sem taxa de acerto medida/);

  // Só o PRIMEIRO fecho abaixo do mínimo: continuar a descer não repete o sinal.
  const segueAbaixo = [...rompe, vela(231 * D, 95, 96, 92, 93)];
  assert.equal(planTendenciaBaixaCripto(segueAbaixo, { symbol: 'BTCUSD', timeframe: '1d' }).length, 0);

  // O motor passa pelo mesmo caminho das validadas.
  assert.deepEqual(
    executarEstrategiasValidadas(rompe, { symbol: 'BTCUSD', timeframe: '1d' }).map((x) => x.strategy),
    ['tendencia-baixa-cripto'],
  );
  assert.equal(estrategiaEmTeste('tendencia-baixa-cripto')?.emTeste.revisao, '2026-12-18');
});

test('Tendência de baixa — cripto: acima da SMA200 não é sinal, mesmo rompendo o mínimo recente', () => {
  // Subida forte (50→200 em 150 velas) e só depois uma correcção suave (200→190
  // em 80 velas): rompe o mínimo dos ÚLTIMOS 55 dias, mas a média de 200 dias
  // continua bem abaixo do preço — o regime de fundo ainda não é de baixa.
  const v = [];
  let p = 50;
  for (let i = 0; i < 150; i++) {
    const c = p + 1;
    v.push(vela(i * D, p, Math.max(p, c) + 0.3, Math.min(p, c) - 0.3, c));
    p = c;
  }
  for (let i = 150; i < 230; i++) {
    const c = p - 10 / 80;
    v.push(vela(i * D, p, Math.max(p, c) + 0.2, Math.min(p, c) - 0.2, c));
    p = c;
  }
  const rompe = [...v, vela(230 * D, p, p + 0.2, 187, 187.8)];
  assert.equal(planTendenciaBaixaCripto(rompe, { symbol: 'BTCUSD', timeframe: '1d' }).length, 0);
});

test('Acompanhamento: tendência de baixa segue o stop no MÁXIMO das últimas 20 velas', () => {
  const inicio = Date.UTC(2026, 8, 1);
  const velas = [vela(inicio, 100, 100, 100, 100)];
  // 25 velas a descer, sempre com máximos cada vez mais baixos.
  let p = 100;
  for (let k = 1; k <= 25; k++) {
    const c = p - 1;
    velas.push(vela(inicio + k * D, p, p + 0.2, c - 0.1, c));
    p = c;
  }
  const plano = {
    estrategia: 'tendencia-baixa-cripto',
    direccao: 'bearish',
    entrada: 100,
    stop: 108,
    alvos: [],
    geradoEm: inicio,
  };
  const a = acompanharOperacao(plano, velas);
  assert.ok(a.stopActual < 108, 'o stop desceu com o máximo das últimas 20 velas');
  assert.ok(a.stopActual > 75, 'nunca abaixo do preço actual — é um TECTO, não um alvo');
  assert.equal(a.resultadoR, null, 'ainda em curso, sem alvo fixo');
  const movel = a.eventos.find((e) => e.tipo === 'stop-movel');
  assert.match(fraseEvento(movel, 2, 'tendencia-baixa-cripto').titulo, /desceu/);
});

// --- Abertura de Londres no DAX ---------------------------------------------------

const M30 = 30 * 60_000;

test('Sessão do DAX: abertura e fecho em UTC mudam com o horário de verão europeu', () => {
  assert.deepEqual(sessaoDax(Date.UTC(2026, 8, 17)), { abre: Date.UTC(2026, 8, 17, 7), fecha: Date.UTC(2026, 8, 17, 15, 30) });
  assert.deepEqual(sessaoDax(Date.UTC(2026, 0, 15)), { abre: Date.UTC(2026, 0, 15, 8), fecha: Date.UTC(2026, 0, 15, 16, 30) });
  // 2026: verão de 29/03 a 25/10.
  assert.equal(sessaoDax(Date.UTC(2026, 2, 27)).abre, Date.UTC(2026, 2, 27, 8));
  assert.equal(sessaoDax(Date.UTC(2026, 2, 30)).abre, Date.UTC(2026, 2, 30, 7));
  assert.equal(sessaoDax(Date.UTC(2026, 9, 23)).abre, Date.UTC(2026, 9, 23, 7));
  assert.equal(sessaoDax(Date.UTC(2026, 9, 26)).abre, Date.UTC(2026, 9, 26, 8));
});

/** 40 dias úteis de velas diárias do GER30, a subir (sobe=true) ou a descer, a acabar em `fim`. */
function diariasDax(fim, de, ate) {
  const v = [];
  let t = fim - D;
  const dias = [];
  while (dias.length < 40) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) dias.unshift(t);
    t -= D;
  }
  dias.forEach((tt, k) => {
    const c = de + ((ate - de) * k) / 39;
    v.push(vela(tt, c, c + 20, c - 20, c));
  });
  return v;
}

/** Um dia de 30m no GER30 (17/09/2026, verão: abre 07:00 UTC). `fechos` a partir das 07:30. */
function diaDax(fechos) {
  const dia = Date.UTC(2026, 8, 17);
  const v = [vela(dia + 6 * H, 24990, 25010, 24980, 25000), vela(dia + 6.5 * H, 25000, 25015, 24990, 25005)];
  v.push(vela(dia + 7 * H, 25005, 25040, 25000, 25020)); // 1.ª vela: faixa 25000–25040, meio 25020
  fechos.forEach((c, k) => v.push(vela(dia + 7 * H + (k + 1) * M30, c - 5, c + 5, c - 10, c)));
  return v;
}

test('Abertura do DAX: compra no primeiro fecho acima da 1.ª vela, a favor da EMA 20 diária', () => {
  const dia = Date.UTC(2026, 8, 17);
  const ctx = { symbol: 'GER30', timeframe: '30m' };
  const subida = { velas1d: diariasDax(dia, 24000, 24900) };
  const velas = diaDax([25030, 25050]); // 07:30 dentro da faixa; 08:00 fecha acima
  const s = planAberturaDaxTeste(velas, ctx, subida);
  assert.equal(s.length, 1);
  assert.equal(s[0].strategy, 'abertura-dax-teste');
  assert.equal(s[0].direction, 'bullish');
  assert.equal(s[0].entryPrice, 25050);
  assert.equal(s[0].stopLoss, 25020, 'stop no meio da faixa');
  assert.equal(s[0].targets.length, 0, 'sem alvo fixo');
  assert.equal(s[0].conviction, 0);
  assert.match(s[0].rationale, /Sem taxa de acerto medida/);
  assert.deepEqual(estrategiasPara('GER30', '30m').map((e) => e.id), ['abertura-dax-teste']);
  assert.equal(executarEstrategiasValidadas(velas, ctx, subida)[0]?.strategy, 'abertura-dax-teste');

  // Só o primeiro fecho fora da faixa: a vela seguinte já não dá sinal.
  assert.equal(planAberturaDaxTeste(diaDax([25030, 25050, 25060]), ctx, subida).length, 0);
  // Contra a EMA 20 diária (tendência de baixa): não compra.
  assert.equal(planAberturaDaxTeste(velas, ctx, { velas1d: diariasDax(dia, 26000, 25500) }).length, 0);
  // Sem as velas diárias não corre.
  assert.equal(planAberturaDaxTeste(velas, ctx, {}).length, 0);
  // Outro timeframe: nada.
  assert.equal(planAberturaDaxTeste(velas, { symbol: 'GER30', timeframe: '1h' }, subida).length, 0);
  // Depois da janela de 3h (rompimento às 10:00 UTC): não conta.
  assert.equal(planAberturaDaxTeste(diaDax([25030, 25030, 25030, 25030, 25030, 25050]), ctx, subida).length, 0);
});

test('Abertura do DAX: vende no primeiro fecho abaixo, em tendência de baixa', () => {
  const dia = Date.UTC(2026, 8, 17);
  const s = planAberturaDaxTeste(diaDax([24980]), { symbol: 'GER30', timeframe: '30m' }, { velas1d: diariasDax(dia, 26000, 25500) });
  assert.equal(s.length, 1);
  assert.equal(s[0].direction, 'bearish');
  assert.equal(s[0].stopLoss, 25020);
});

test('Abertura do DAX: sai no fecho do DAX à vista se o stop não for tocado', () => {
  const dia = Date.UTC(2026, 8, 17);
  const velas = diaDax([25030, 25050]);
  for (let t = dia + 8.5 * H; t <= dia + 17 * H; t += M30) velas.push(vela(t, 25060, 25080, 25040, 25070));
  const plano = { estrategia: 'abertura-dax-teste', direccao: 'bullish', entrada: 25050, stop: 25020, alvos: [], geradoEm: dia + 8 * H };
  const a = acompanharOperacao(plano, velas);
  assert.equal(a.estado, 'fechada');
  const saida = a.eventos.at(-1);
  assert.equal(saida.tipo, 'saida-tempo');
  assert.equal(saida.em, dia + 15 * H, 'a vela das 15:00 fecha às 15:30, o fecho do DAX no verão');
  assert.ok(Math.abs(a.resultadoR - 20 / 30) < 1e-9, '+20 pontos com 30 de risco');
  assert.match(fraseEvento(saida, 1, 'abertura-dax-teste').titulo, /fecho do DAX/);
});
