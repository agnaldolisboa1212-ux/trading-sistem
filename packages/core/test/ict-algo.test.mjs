/**
 * ICT ALGO — os testes que interessam.
 *
 * Não testam "o algoritmo corre". Testam as propriedades que, se falharem,
 * transformam o algoritmo numa máquina de perder dinheiro sem dar sinal disso:
 *
 *   1. LOOK-AHEAD. O teste do corte, aplicado ao algoritmo INTEIRO: a decisão
 *      na vela N com a série completa tem de ser igual à decisão com a série
 *      cortada em N — regime, viés, e o veredicto de cada um dos sete modelos
 *      nos dois sentidos. Se algum pedaço espreitar uma vela para a frente, as
 *      duas divergem. É o teste que teria apanhado o bug dos order blocks que
 *      neste projecto deu t=13,3 antes de ser corrigido.
 *   2. VARRIMENTO vs ROMPIMENTO. A regra mecânica que separa uma reversão de
 *      uma continuação.
 *   3. O SELETOR obedece à estrutura: nunca escolhe um modelo que o regime não
 *      permite, nem um sentido contra o regime.
 *   4. O PLACAR só conhece operações já fechadas.
 *   5. GEOMETRIA de todos os sinais de todos os modelos, em milhares de velas.
 *   6. DETERMINISMO. A versão anterior deste painel escolhia o sinal com
 *      `Math.random()`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agregar,
  avaliarVela,
  calcularPlacar,
  correrIctAlgo,
  escolherModelo,
  faseAmd,
  fairValueGaps,
  killzonesActivas,
  MODELOS_DO_REGIME,
  pocasDeSwings,
  prepararEstruturas,
  quebrasDeEstrutura,
  relogioNy,
  serieAtrIct,
  simularSinal,
  swingsConfirmados,
  varrimentos,
  viesDiario,
  visivelEm,
} from '../dist/index.js';

const HORA = 3_600_000;
const DIA = 24 * HORA;
const vela = (time, open, high, low, close) => ({ time, open, high, low, close, volume: 100 });

/**
 * Série determinista (LCG) com regimes: a deriva muda de sinal e de força a
 * cada ~150 velas, para haver tendências, faixas e reversões — um passeio
 * aleatório puro quase nunca monta um setup e deixava os testes sem objecto.
 */
function serieSintetica(n, inicio = Date.UTC(2024, 0, 1), passo = HORA, semente = 42) {
  let s = semente;
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const out = [];
  let p = 100;
  let deriva = 0;
  for (let i = 0; i < n; i++) {
    if (i % 150 === 0) deriva = (rnd() - 0.5) * 0.4;
    const d = (rnd() - 0.5) * 2 + deriva;
    const open = p;
    const close = p + d;
    const high = Math.max(open, close) + rnd() * 0.6;
    const low = Math.min(open, close) - rnd() * 0.6;
    out.push(vela(inicio + i * passo, open, high, low, close));
    p = close;
  }
  return out;
}

function entrada(h1, par, extra = {}) {
  return {
    simbolo: 'EURUSD',
    timeframe: '1h',
    velas: h1,
    diarias: agregar(h1, '1d'),
    semanais: agregar(h1, '1w'),
    referencia: agregar(h1, '1d'),
    timeframeReferencia: '1d',
    par,
    custo: 0.01,
    ...extra,
  };
}

/** O que conta numa decisão, para comparar duas avaliações. */
function decisao(av) {
  if (!av) return null;
  return {
    vies: av.vies.direccao,
    respostas: av.vies.respostas.map((r) => r.resposta),
    regime: av.regime.regime,
    regimeDir: av.regime.direccao,
    modelos: av.resultados.map((r) => ({
      m: r.modelo,
      d: r.direccao,
      porque: r.porqueNao,
      s: r.sinal && {
        chave: r.sinal.chave,
        entrada: r.sinal.entrada,
        stop: r.sinal.stop,
        alvo: r.sinal.alvo,
        tipo: r.sinal.tipoEntrada,
      },
    })),
  };
}

// ── 1. Look-ahead ───────────────────────────────────────────────────────────

test('swings: um swing só é visível lookback velas depois do pivô', () => {
  for (const s of swingsConfirmados(serieSintetica(300), 2)) {
    assert.equal(s.confirmadoEm, s.index + 2);
    assert.ok(!visivelEm(s, s.index) && !visivelEm(s, s.index + 1) && visivelEm(s, s.index + 2));
  }
});

test('O TESTE DO CORTE nas quebras de estrutura', () => {
  const completa = serieSintetica(500);
  const qc = quebrasDeEstrutura(completa, swingsConfirmados(completa), serieAtrIct(completa));
  for (const corte of [200, 300, 400, 499]) {
    const parcial = completa.slice(0, corte + 1);
    const qp = quebrasDeEstrutura(parcial, swingsConfirmados(parcial), serieAtrIct(parcial));
    assert.deepEqual(
      qp.map((q) => `${q.index}:${q.tipo}:${q.lado}`),
      qc.filter((q) => q.index <= corte).map((q) => `${q.index}:${q.tipo}:${q.lado}`),
      `corte em ${corte}: há look-ahead nas quebras`,
    );
  }
});

test('O TESTE DO CORTE no ALGORITMO INTEIRO: regime, viés e os sete modelos', () => {
  // Uma série e o seu par, com um corte em vários pontos. Para cada corte, a
  // avaliação com a série completa e com a série cortada têm de coincidir em
  // TUDO o que decide.
  const completa = serieSintetica(1600, Date.UTC(2024, 0, 1), HORA, 11);
  const parCompleta = serieSintetica(1600, Date.UTC(2024, 0, 1), HORA, 23);
  const eCompleta = prepararEstruturas(entrada(completa, { simbolo: 'GBPUSD', velas: parCompleta }));
  let comparadas = 0;
  for (const corte of [900, 1000, 1111, 1234, 1350, 1477, 1599]) {
    const parcial = completa.slice(0, corte + 1);
    const parParcial = parCompleta.slice(0, corte + 1);
    const eParcial = prepararEstruturas(entrada(parcial, { simbolo: 'GBPUSD', velas: parParcial }));
    const a = decisao(avaliarVela(eCompleta, corte));
    const b = decisao(avaliarVela(eParcial, corte));
    assert.deepEqual(b, a, `corte em ${corte}: a decisão mudou quando o futuro foi removido — há look-ahead`);
    if (a) comparadas++;
  }
  assert.ok(comparadas >= 5, 'o teste do corte não chegou a comparar decisões');
});

test('O TESTE DO CORTE nos modelos de entrada (meio, OTE, mercado)', () => {
  const completa = serieSintetica(1600, Date.UTC(2024, 0, 1), HORA, 29);
  const parCompleta = serieSintetica(1600, Date.UTC(2024, 0, 1), HORA, 129);
  const eCompleta = prepararEstruturas(entrada(completa, { simbolo: 'GBPUSD', velas: parCompleta }));
  for (const modo of ['meio', 'ote', 'mercado']) {
    for (const corte of [1000, 1234, 1477, 1599]) {
      const eParcial = prepararEstruturas(
        entrada(completa.slice(0, corte + 1), { simbolo: 'GBPUSD', velas: parCompleta.slice(0, corte + 1) }),
      );
      assert.deepEqual(
        decisao(avaliarVela(eParcial, corte, modo)),
        decisao(avaliarVela(eCompleta, corte, modo)),
        `entrada ${modo}, corte em ${corte}: há look-ahead`,
      );
    }
  }
});

test('O TESTE DO CORTE nos FVG', () => {
  const completa = serieSintetica(400, Date.UTC(2024, 0, 1), HORA, 7);
  const k = (f) => `${f.index}:${f.lado}:${f.alto.toFixed(6)}`;
  assert.deepEqual(
    fairValueGaps(completa.slice(0, 301)).map(k),
    fairValueGaps(completa).filter((f) => f.index <= 300).map(k),
  );
});

// ── 2. Varrimento vs rompimento ─────────────────────────────────────────────

function cenarioNivel(velaDoAtaque) {
  const v = [];
  for (let i = 0; i < 20; i++) v.push(vela(i * HORA, 100, 100.5, 99.5, 100));
  v.push(vela(20 * HORA, 100, 100.2, 98, 99.5)); // mínimo claro → poça sell-side
  for (let i = 21; i < 30; i++) v.push(vela(i * HORA, 100, 100.5, 99.5, 100));
  v.push(velaDoAtaque);
  for (let i = 31; i < 40; i++) v.push(vela(i * HORA, 100, 100.5, 99.5, 100));
  return varrimentos(v, pocasDeSwings(swingsConfirmados(v), 1), serieAtrIct(v));
}

test('varrimento: pavio passa o nível e o corpo fecha de volta', () => {
  const vs = cenarioNivel(vela(30 * HORA, 99.8, 100, 97.5, 99.5));
  const x = vs.find((v) => v.index === 30);
  assert.ok(x, 'devia ter detectado o varrimento');
  assert.equal(x.lado, 'bullish', 'varrer mínimos arma uma compra');
  assert.equal(x.extremo, 97.5, 'o stop vai ao extremo do pavio');
});

test('rompimento NÃO é varrimento: corpo a fechar além do nível', () => {
  const vs = cenarioNivel(vela(30 * HORA, 99.8, 100, 96.5, 97));
  assert.ok(!vs.some((v) => v.index === 30));
});

// ── 3. Seletor e 5. geometria, em milhares de velas ─────────────────────────

test('seletor obedece ao regime, e todos os sinais têm geometria coerente', () => {
  let sinais = 0;
  let escolhas = 0;
  for (const semente of [3, 11, 17, 29, 41]) {
    const h1 = serieSintetica(1800, Date.UTC(2024, 0, 1), HORA, semente);
    const par = { simbolo: 'GBPUSD', velas: serieSintetica(1800, Date.UTC(2024, 0, 1), HORA, semente + 100) };
    const e = prepararEstruturas(entrada(h1, par));
    for (let i = 700; i < h1.length; i++) {
      const av = avaliarVela(e, i);
      if (!av) continue;

      for (const r of av.resultados) {
        const s = r.sinal;
        if (!s) continue;
        sinais++;
        assert.equal(s.algoritmo, 'ICT ALGO');
        assert.equal(s.direccao, r.direccao, 'o sinal saiu no sentido em que o modelo foi avaliado');
        if (s.direccao === 'bullish') {
          assert.ok(s.stop < s.entrada && s.alvo > s.entrada, `${s.modelo}: compra com geometria invertida`);
        } else {
          assert.ok(s.stop > s.entrada && s.alvo < s.entrada, `${s.modelo}: venda com geometria invertida`);
        }
        const rr = Math.abs(s.alvo - s.entrada) / Math.abs(s.entrada - s.stop);
        assert.ok(Math.abs(rr - s.rr) < 1e-9, `${s.modelo}: RR declarado não bate com a geometria`);
        assert.ok(s.rr >= 2, `${s.modelo}: emitiu abaixo de 2R`);
        assert.ok(s.passos.length > 0, `${s.modelo}: sinal sem explicação`);
        if (s.tipoEntrada === 'pendente') {
          const fecho = h1[i].close;
          assert.ok(
            s.direccao === 'bullish' ? fecho > s.entrada : fecho < s.entrada,
            `${s.modelo}: ordem pendente com o preço já do outro lado`,
          );
        }
      }

      const esc = escolherModelo(av.regime, av.resultados, [], false);
      if (esc.escolhido) {
        escolhas++;
        assert.ok(
          MODELOS_DO_REGIME[av.regime.regime].includes(esc.escolhido.modelo),
          `escolheu ${esc.escolhido.modelo} num regime ${av.regime.regime} que não o permite`,
        );
        if (av.regime.direccao) {
          assert.equal(esc.escolhido.sinal.direccao, av.regime.direccao, 'escolheu um sentido contra o regime');
        }
      } else {
        assert.ok(esc.porqueNao, 'sem escolha e sem razão');
      }
    }
  }
  // Sem sinais, este teste não testaria nada — melhor saber.
  assert.ok(sinais > 0, 'nenhum modelo montou setup em nenhuma série: o teste de geometria ficou sem objecto');
  assert.ok(escolhas > 0, 'o seletor nunca escolheu nada: o teste do seletor ficou sem objecto');
});

test('Venom NUNCA emite sem par correlacionado (em nenhuma vela)', () => {
  for (const semente of [3, 11, 17]) {
    const h1 = serieSintetica(1500, Date.UTC(2024, 0, 1), HORA, semente);
    const e = prepararEstruturas(entrada(h1, null));
    for (let i = 700; i < h1.length; i++) {
      const av = avaliarVela(e, i);
      if (!av) continue;
      for (const r of av.resultados) {
        if (r.modelo === 'venom') assert.equal(r.sinal, null, `semente ${semente}, vela ${i}: Venom sem par`);
      }
    }
  }
});

// ── 4. Placar ───────────────────────────────────────────────────────────────

test('placar: só conta operações fechadas até ao instante da decisão', () => {
  const regs = [];
  // 12 perdas do Venom, a fechar às horas 1..12.
  for (let k = 1; k <= 12; k++) regs.push({ modelo: 'venom', fechoTime: k * HORA, r: -1 });
  const antes = calcularPlacar(regs, 5 * HORA).find((p) => p.modelo === 'venom');
  assert.equal(antes.n, 5, 'às 5h só existem 5 operações fechadas');
  assert.equal(antes.quarentena, false, 'com 5 operações não há amostra para condenar');
  const depois = calcularPlacar(regs, 12 * HORA).find((p) => p.modelo === 'venom');
  assert.equal(depois.n, 12);
  assert.equal(depois.quarentena, true, '12 perdas seguidas: quarentena');
  const outro = calcularPlacar(regs, 12 * HORA).find((p) => p.modelo === 'crt');
  assert.equal(outro.n, 0, 'o placar de um modelo não contamina o de outro');
});

test('placar: a quarentena tira um modelo da escolha, nunca acrescenta', () => {
  const h1 = serieSintetica(1800, Date.UTC(2024, 0, 1), HORA, 17);
  const e = prepararEstruturas(entrada(h1, { simbolo: 'GBPUSD', velas: serieSintetica(1800, Date.UTC(2024, 0, 1), HORA, 117) }));
  const todosDeQuarentena = ['venom', 'crt', 'reaper-ifvg', 'silver-bullet', 'unicorn', 'turtle-soup', 'continuacao'].map(
    (modelo) => ({ modelo, n: 20, media: -0.5, quarentena: true }),
  );
  for (let i = 700; i < h1.length; i++) {
    const av = avaliarVela(e, i);
    if (!av) continue;
    const esc = escolherModelo(av.regime, av.resultados, todosDeQuarentena, true);
    assert.equal(esc.escolhido, null, 'com todos de quarentena não pode haver escolha');
  }
});

// ── Simulação: as hipóteses pessimistas ─────────────────────────────────────

function sinalTeste(extra) {
  return {
    algoritmo: 'ICT ALGO',
    direccao: 'bullish',
    tipoEntrada: 'pendente',
    entrada: 100,
    stop: 99,
    alvo: 102,
    rr: 2,
    ...extra,
  };
}

test('simulação: stop e alvo na mesma vela conta como STOP', () => {
  const v = [vela(0, 101, 101, 100.5, 100.8), vela(HORA, 100.5, 100.6, 99.9, 100.2), vela(2 * HORA, 100.2, 102.5, 98.5, 101)];
  const r = simularSinal(v, sinalTeste(), 0, { espera: 5, horizonte: 5, custo: 0 });
  assert.equal(r.saida, 'stop');
  assert.equal(r.r, -1);
});

test('simulação: alvo atingido sem tocar na entrada não é ganho', () => {
  const v = [vela(0, 101, 101, 100.5, 100.8), vela(HORA, 100.8, 102.5, 100.5, 102.2)];
  const r = simularSinal(v, sinalTeste(), 0, { espera: 5, horizonte: 5, custo: 0 });
  assert.equal(r.preenchida, false);
  assert.equal(r.r, null);
  assert.equal(r.saida, 'fugiu');
});

test('simulação: o custo desconta-se em R', () => {
  const v = [vela(0, 101, 101, 100.5, 100.8), vela(HORA, 100.5, 100.6, 99.95, 100.3), vela(2 * HORA, 100.3, 102.2, 100.2, 102)];
  const r = simularSinal(v, sinalTeste(), 0, { espera: 5, horizonte: 5, custo: 0.1 });
  assert.equal(r.saida, 'alvo');
  assert.ok(Math.abs(r.r - (2 - 0.1)) < 1e-9, 'alvo de 2R com custo de 0,1 de risco 1 = 1,9R');
});

// ── Determinismo e portfólio ────────────────────────────────────────────────

test('determinista: a mesma entrada dá exactamente o mesmo resultado', () => {
  const h1 = serieSintetica(1500, Date.UTC(2024, 0, 1), HORA, 11);
  const e = entrada(h1, { simbolo: 'GBPUSD', velas: serieSintetica(1500, Date.UTC(2024, 0, 1), HORA, 23) });
  assert.deepEqual(JSON.parse(JSON.stringify(correrIctAlgo(e))), JSON.parse(JSON.stringify(correrIctAlgo(e))));
});

test('travão de portfólio: recusa fora da lista, aceita dentro', () => {
  const h1 = serieSintetica(1500, Date.UTC(2024, 0, 1), HORA, 11);
  const fora = correrIctAlgo({ ...entrada(h1, null), simbolo: 'XAUUSD', portfolio: ['EURUSD', 'GBPUSD'] });
  assert.equal(fora.sinal, null);
  assert.match(fora.porqueNao, /não está no portfólio/);
  const dentro = correrIctAlgo({ ...entrada(h1, null), portfolio: ['EURUSD'] });
  assert.ok(!/não está no portfólio/.test(dentro.porqueNao ?? ''));
  assert.ok(dentro.regime, 'dentro do portfólio a análise corre');
});

test('a análise explica sempre: sinal com passos, ou razão sem sinal', () => {
  for (const semente of [3, 11, 17, 29]) {
    const h1 = serieSintetica(1500, Date.UTC(2024, 0, 1), HORA, semente);
    const r = correrIctAlgo(entrada(h1, { simbolo: 'GBPUSD', velas: serieSintetica(1500, Date.UTC(2024, 0, 1), HORA, semente + 1) }));
    if (r.sinal) assert.ok(r.sinal.passos.length > 0 && r.porqueNao === null);
    else assert.ok(typeof r.porqueNao === 'string' && r.porqueNao.length > 0);
    assert.equal(r.modelos.length, 7, 'o painel mostra o veredicto dos sete modelos');
    assert.equal(r.placar.length, 7);
  }
});

// ── Tempo e calendário ──────────────────────────────────────────────────────

test('hora de Nova Iorque bate com Intl, incluindo nos dias de transição', () => {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false });
  for (let t = Date.UTC(2023, 0, 1); t < Date.UTC(2026, 0, 1); t += 7 * HORA) {
    assert.equal(relogioNy(t).hora, Number(fmt.format(new Date(t))) % 24, new Date(t).toISOString());
  }
});

test('killzones e fases AMD nos instantes que o site nomeia', () => {
  const emNy = (h) => Date.UTC(2024, 0, 15, h + 5); // Inverno: NY = UTC−5
  assert.ok(killzonesActivas(emNy(3)).includes('londres'));
  assert.ok(killzonesActivas(emNy(8)).includes('ny-am'));
  assert.ok(killzonesActivas(emNy(10)).includes('silver-bullet'));
  assert.ok(killzonesActivas(emNy(22)).includes('asia'));
  assert.equal(faseAmd(emNy(0)), 'acumulacao');
  assert.equal(faseAmd(emNy(3)), 'manipulacao');
  assert.equal(faseAmd(emNy(8)), 'distribuicao');
  assert.equal(faseAmd(emNy(6)), 'fora');
});

test('agregar: a semana começa ao domingo, não à quinta-feira', () => {
  // 2024-01-04 é quinta; 2024-01-07 é domingo.
  const h = [];
  for (let t = Date.UTC(2024, 0, 4); t < Date.UTC(2024, 0, 10); t += HORA) h.push(vela(t, 1, 1, 1, 1));
  const semanas = agregar(h, '1w').map((c) => new Date(c.time).getUTCDay());
  assert.ok(semanas.every((d) => d === 0), `semanas a começar em dias ${semanas}`);
});

test('agregar: o domingo curto do forex junta-se à segunda-feira', () => {
  const h = [];
  // Domingo 22h–24h (2 velas), segunda completa.
  for (let t = Date.UTC(2024, 0, 7, 22); t < Date.UTC(2024, 0, 9); t += HORA) h.push(vela(t, 1, 1 + (t % 7) / 100, 1, 1));
  const dias = agregar(h, '1d');
  assert.equal(dias.length, 1, 'o fragmento de domingo não pode ser uma vela diária própria');
  assert.equal(new Date(dias[0].time).getUTCDay(), 1, 'fica a segunda-feira');
});

test('viés diário: devolve sempre as cinco perguntas respondidas', () => {
  const h1 = serieSintetica(1500, Date.UTC(2024, 0, 1), HORA, 5);
  const diarias = agregar(h1, '1d');
  const semanais = agregar(h1, '1w');
  const v = viesDiario({
    velasDiarias: diarias,
    iDia: diarias.length - 2,
    swingsSemanais: swingsConfirmados(semanais, 1),
    iSemanal: semanais.length - 2,
    pocas: pocasDeSwings(swingsConfirmados(h1), 1),
    iExecucao: h1.length - 1,
    preco: h1[h1.length - 1].close,
  });
  assert.equal(v.respostas.length, 5);
  for (const r of v.respostas) assert.ok(r.pergunta && r.detalhe && ['bullish', 'bearish', 'neutral'].includes(r.resposta));
});
