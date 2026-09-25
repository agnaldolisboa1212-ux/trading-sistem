/**
 * O modelo "JPY Londres" — o método das notas "Estudos do JPY" do Agnaldo,
 * posto em regras e medido.
 *
 * ── AS REGRAS, FIXADAS ANTES DE MEDIR (tal como saem das notas) ───────────
 *
 *   1  viés      tendência de cima para baixo: viés diário (as 5 perguntas).
 *                Sem viés não se opera ("não operar consolidações").
 *   2  Ásia      faixa das 00:00 às 08:00 de Londres. "Esperar a sessão
 *                asiática terminar."
 *   3  Londres   entre as 08:00 e as 10:00 de Londres (o "9:00" e o "11H" das
 *                notas estão num TradingView em UTC+2, escritas no Verão), o par
 *                passa o extremo asiático CONTRA o viés: numa venda, o máximo.
 *                "A máxima da manipulação de Londres com divergência com a
 *                máxima da sessão asiática."
 *   4  SMT       nesse intervalo o par de referência NÃO passa o seu extremo
 *                asiático ("divergência entre GBPJPY e USDJPY"). Referência:
 *                USDJPY para os cruzados, GBPJPY para o próprio USDJPY.
 *                Divergências antes da abertura não contam.
 *   5  entrada 1 fecho da vela que volta para dentro da faixa asiática, com o
 *                SMT de pé. Stop no extremo da manipulação. Alvo 3R.
 *   6  entrada 2 o MSS a seguir ("0,50% na confirmação e MSS"): fecho além do
 *                último swing confirmado. Mesmo stop. Alvo 3,5R.
 *   7  gestão    break-even a +1,2R; saída na mudança de sessão, às 13:00 de
 *                Londres ("fechamento entre 13:30 e 14:00", em UTC+2). Uma
 *                operação por dia, nada às sextas.
 *   v2           a versão refinada das notas ("o que realmente deve ser
 *                feito", depois das perdas de 13–15/08): a entrada 1 SÓ quando
 *                (a) o extremo da manipulação cai no OTE (62–79%) da última
 *                perna a favor do viés, e (b) há divergência no estocástico
 *                (5,3,3): preço com extremo além do da Ásia, estocástico não.
 *                Fixada antes de medir; medida uma vez.
 *   8  radar     (variante à parte) só compras com AUDJPY e NZDJPY acima da
 *                abertura do dia; só vendas com os dois abaixo.
 *   9  journal   (variante à parte, do export do "Trader's Master Journal",
 *                25/09/2026) o alvo não é 3R fixo: é o extremo OPOSTO da Ásia
 *                — "capturar a alta da sessão asiática", "SESSION HIGH". Nos 13
 *                trades fechados por T/P do journal o alvo foi sempre esse, com
 *                2,24R de média. Regra fixada antes de medir: alvo = máximo da
 *                Ásia numa compra (mínimo numa venda); sem pelo menos 1,5R até
 *                lá não se entra; teto de 6R. O resto igual (stop, BE a 1,2R,
 *                saída às 13:00).
 *
 * Custos de conta normal. Stop e alvo na mesma vela = stop. Metades
 * 2022-01→2024-06 e 2024-07→2026. Controlo: AUDJPY, CADJPY, CHFJPY, NZDJPY —
 * pares que as notas nunca operaram.
 *
 * Aviso de amostra: as notas foram escritas em 2025 a operar GBPJPY. O GBPJPY
 * de 2025 é, por construção, dentro da amostra; mostra-se também sem 2025.
 */

import { readFileSync } from 'node:fs';
import {
  agregar,
  custoTipico,
  prepararEstruturas,
  relogioLondres,
  swingsConfirmados,
  ultimaFechadaAte,
  viesDiario,
} from '../../packages/core/dist/index.js';

const DIR = process.env.HISTDATA_DIR ?? 'E:/projecto Agnaldo 3.0/sistema de trading/data/backtest/histdata/';
const DESDE = Date.UTC(2022, 0, 1);
const AQUECIMENTO = Date.UTC(2021, 0, 1);
const CORTE = Date.UTC(2024, 6, 1);
const DIA = 86_400_000;
const PASSO = 900_000; // 15M

const PRINCIPAIS = [
  ['GBPJPY', 'USDJPY'],
  ['EURJPY', 'USDJPY'],
  ['USDJPY', 'GBPJPY'],
];
const CONTROLO = [
  ['AUDJPY', 'USDJPY'],
  ['CADJPY', 'USDJPY'],
  ['CHFJPY', 'USDJPY'],
  ['NZDJPY', 'USDJPY'],
];

const ler = (par) => {
  try {
    return JSON.parse(readFileSync(`${DIR}${par}_15m.json`, 'utf8')).filter((c) => c.time >= AQUECIMENTO);
  } catch {
    return null;
  }
};

const est = (rs) => {
  const n = rs.length;
  if (n < 3) return { n, media: 0, t: 0, acerto: 0 };
  const m = rs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rs.reduce((a, r) => a + (r - m) ** 2, 0) / (n - 1));
  return { n, media: m, t: sd > 0 ? m / (sd / Math.sqrt(n)) : 0, acerto: rs.filter((r) => r > 0).length / n };
};

/**
 * Simula uma entrada a mercado no fecho da vela `k`: stop, alvo, break-even a
 * +1,2R (a partir da vela seguinte à que o atinge) e saída às 13:00 de Londres.
 */
function simular(v, k, alta, entrada, stop, alvoR, custo) {
  const risco = Math.abs(entrada - stop);
  const alvo = alta ? entrada + alvoR * risco : entrada - alvoR * risco;
  let stopActual = stop;
  let beArmado = false;
  let j = k + 1;
  for (; j < v.length; j++) {
    const c = v[j];
    // Mudança de sessão: a vela que abre às 13:00 de Londres já não conta.
    if (relogioLondres(c.time).minutos >= 13 * 60 || c.time - v[k].time > DIA) break;
    // O break-even armado na vela anterior vale a partir desta.
    if (beArmado) stopActual = entrada;
    if (alta ? c.low <= stopActual : c.high >= stopActual) {
      return ((stopActual - entrada) * (alta ? 1 : -1)) / risco - custo / risco;
    }
    if (alta ? c.high >= alvo : c.low <= alvo) return alvoR - custo / risco;
    if ((alta ? c.high - entrada : entrada - c.low) >= 1.2 * risco) beArmado = true;
  }
  const saida = v[Math.min(j, v.length) - 1];
  return ((saida.close - entrada) * (alta ? 1 : -1)) / risco - custo / risco;
}

function correr(par, ref, radar) {
  const v = ler(par);
  const r = ler(ref);
  if (!v || !r) return null;
  const refPorTempo = new Map(r.map((c) => [c.time, c]));
  const custo = custoTipico(par, v[v.length - 1].close);

  // Estrutura só para o viés diário e para os swings do MSS.
  const diarias = agregar(v, '1d');
  const semanais = agregar(v, '1w');
  const e = prepararEstruturas({
    simbolo: par,
    timeframe: '15m',
    velas: v,
    diarias,
    semanais,
    referencia: diarias,
    timeframeReferencia: '1d',
    par: null,
  });
  const swings = e.swings;

  // Estocástico 5,3,3 das notas: %K lento = média de 3 do %K bruto de 5.
  const bruto = v.map((c, i) => {
    if (i < 4) return 50;
    let hh = -Infinity, ll = Infinity;
    for (let k = i - 4; k <= i; k++) {
      hh = Math.max(hh, v[k].high);
      ll = Math.min(ll, v[k].low);
    }
    return hh > ll ? (100 * (c.close - ll)) / (hh - ll) : 50;
  });
  const estoc = bruto.map((_, i) => (i < 2 ? bruto[i] : (bruto[i] + bruto[i - 1] + bruto[i - 2]) / 3));

  /**
   * A última perna de 1H a favor do viés, conhecida no fecho da vela `i` de 15M
   * e anterior ao extremo da manipulação.
   *
   * 1H e não 15M: as notas mandam marcar o OTE no top-down ("Daily/1h/15min"),
   * e a perna de 15M tem quase sempre origem no próprio extremo da Ásia — um
   * varrimento desse extremo ficava, por construção, além dos 100%.
   */
  const v1h = agregar(v, '1h');
  const swings1h = swingsConfirmados(v1h, 2);
  const HORA = 3_600_000;
  const perna = (alta, iExtremo, i) => {
    const decisao = v[i].time + PASSO;
    const tExtremo = v[iExtremo].time;
    let fim = null;
    for (let s = swings1h.length - 1; s >= 0; s--) {
      const w = swings1h[s];
      const conhecidoEm = v1h[w.confirmadoEm].time + HORA;
      if (conhecidoEm > decisao || w.time >= tExtremo) continue;
      if (!fim) {
        if (w.kind === (alta ? 'high' : 'low')) fim = w;
        continue;
      }
      if (w.kind === (alta ? 'low' : 'high') && w.index < fim.index) return { de: w.price, ate: fim.price };
    }
    return null;
  };

  // Radar: AUDJPY e NZDJPY por tempo.
  const radares = radar ? ['AUDJPY', 'NZDJPY'].map((p) => new Map((ler(p) ?? []).map((c) => [c.time, c]))) : null;

  const ops = { e1: [], e2: [], combinada: [], v2: [], soOte: [], soEstoc: [], e1Asia: [], e2Asia: [] };
  /** Alvo no extremo oposto da Ásia, em R; null se não chega a 1,5R. */
  const rAteAsia = (alta, entrada, stop, alto, baixo) => {
    const risco = Math.abs(entrada - stop);
    const dist = alta ? alto - entrada : entrada - baixo;
    const r = risco > 0 ? dist / risco : 0;
    return r >= 1.5 ? Math.min(r, 6) : null;
  };
  // Índices de cada dia de negociação.
  const porDia = new Map();
  for (let i = 0; i < v.length; i++) {
    const t = v[i].time;
    if (t < DESDE - DIA) continue;
    // Dia de calendário de LONDRES: o desvio face a UTC é 0 ou 60 minutos.
    const utcMin = new Date(t).getUTCHours() * 60 + new Date(t).getUTCMinutes();
    const desvio = (((relogioLondres(t).minutos - utcMin) % 1440) + 1440) % 1440;
    const chave = Math.floor((t + desvio * 60_000) / DIA);
    if (!porDia.has(chave)) porDia.set(chave, []);
    porDia.get(chave).push(i);
  }

  for (const indices of porDia.values()) {
    const primeira = v[indices[0]];
    if (primeira.time < DESDE) continue;
    const dow = relogioLondres(primeira.time).diaSemana;
    if (dow === 5 || dow === 6 || dow === 0) continue; // nada às sextas, nem ao fim-de-semana

    // Ásia: 00:00–08:00 de Londres, no par e na referência.
    let aAltoP = -Infinity, aBaixoP = Infinity, aAltoR = -Infinity, aBaixoR = Infinity, nAsia = 0;
    let iAsiaAlto = -1, iAsiaBaixo = -1;
    const janela = [];
    let abertura = -1;
    for (const i of indices) {
      const m = relogioLondres(v[i].time).minutos;
      const c = v[i];
      const cr = refPorTempo.get(c.time);
      if (m < 8 * 60) {
        if (c.high > aAltoP) {
          aAltoP = c.high;
          iAsiaAlto = i;
        }
        if (c.low < aBaixoP) {
          aBaixoP = c.low;
          iAsiaBaixo = i;
        }
        if (cr) {
          aAltoR = Math.max(aAltoR, cr.high);
          aBaixoR = Math.min(aBaixoR, cr.low);
        }
        nAsia++;
      } else if (m < 10 * 60) {
        if (abertura < 0) abertura = i;
        janela.push(i);
      }
    }
    if (nAsia < 16 || janela.length === 0 || !Number.isFinite(aAltoR)) continue;

    // Viés diário na vela antes da abertura de Londres.
    const i0 = abertura - 1;
    const instante = v[abertura].time;
    const iDia = ultimaFechadaAte(diarias, DIA, instante);
    const iSem = ultimaFechadaAte(semanais, 7 * DIA, instante);
    if (iDia < 20 || iSem < 4) continue;
    const vies = viesDiario({
      velasDiarias: diarias,
      iDia,
      swingsSemanais: e.swingsSemanais,
      iSemanal: iSem,
      pocas: e.pocas,
      iExecucao: i0,
      preco: v[i0].close,
    }).direccao;
    if (vies === 'neutral') continue;
    const alta = vies === 'bullish';

    // Manipulação + SMT, vela a vela na janela de Londres.
    let extremoP = alta ? Infinity : -Infinity;
    let extremoR = alta ? Infinity : -Infinity;
    let varreu = false;
    let e1 = null;
    let e2 = null;
    let iExtremo = -1;
    for (const i of janela) {
      const c = v[i];
      const cr = refPorTempo.get(c.time);
      if (alta) {
        if (c.low < extremoP) {
          extremoP = c.low;
          iExtremo = i;
        }
        if (cr) extremoR = Math.min(extremoR, cr.low);
        if (c.low < aBaixoP) varreu = true;
      } else {
        if (c.high > extremoP) {
          extremoP = c.high;
          iExtremo = i;
        }
        if (cr) extremoR = Math.max(extremoR, cr.high);
        if (c.high > aAltoP) varreu = true;
      }
      // SMT: a referência não passou o seu extremo asiático.
      const smt = alta ? extremoR >= aBaixoR : extremoR <= aAltoR;
      if (!smt) break; // a divergência desfez-se: não há setup hoje
      if (!varreu) continue;

      // Entrada 1: fecho de volta para dentro da faixa asiática.
      if (!e1) {
        const dentro = alta ? c.close > aBaixoP : c.close < aAltoP;
        if (dentro) e1 = { k: i, entrada: c.close, stop: extremoP };
        continue;
      }
      // Entrada 2: MSS — fecho além do último swing confirmado antes do extremo.
      if (!e2 && i > iExtremo) {
        let nivel = null;
        for (let s = swings.length - 1; s >= 0; s--) {
          const w = swings[s];
          if (w.index >= iExtremo || w.confirmadoEm > i) continue;
          if (w.kind === (alta ? 'high' : 'low')) {
            nivel = w.price;
            break;
          }
        }
        if (nivel !== null && (alta ? c.close > nivel : c.close < nivel)) {
          e2 = { k: i, entrada: c.close, stop: extremoP };
          break;
        }
      }
    }
    if (!e1) continue;

    // Radar (variante): AUDJPY e NZDJPY a favor, na vela da entrada 1.
    if (radares) {
      const aFavor = radares.every((m) => {
        const agora = m.get(v[e1.k].time);
        const aberturaDia = m.get(v[indices[0]].time);
        if (!agora || !aberturaDia) return false;
        return alta ? agora.close > aberturaDia.open : agora.close < aberturaDia.open;
      });
      if (!aFavor) continue;
    }

    const risco1 = Math.abs(e1.entrada - e1.stop);

    // v2: OTE da última perna a favor do viés + divergência no estocástico.
    const pe = perna(alta, iExtremo, e1.k);
    let noOte = false;
    if (pe) {
      const tam = Math.abs(pe.ate - pe.de);
      const ret = tam > 0 ? Math.abs(pe.ate - e1.stop) / tam : 0; // retracção do extremo
      noOte = ret >= 0.62 && ret <= 0.79;
    }
    const iAsia = alta ? iAsiaBaixo : iAsiaAlto;
    const divEstoc = iAsia >= 0 && (alta ? estoc[iExtremo] > estoc[iAsia] : estoc[iExtremo] < estoc[iAsia]);
    if (!(risco1 > 0) || custo / risco1 > 0.5) continue;
    const r1 = simular(v, e1.k, alta, e1.entrada, e1.stop, 3, custo);
    ops.e1.push({ t: v[e1.k].time, r: r1, alta });
    const alvoAsia1 = rAteAsia(alta, e1.entrada, e1.stop, aAltoP, aBaixoP);
    if (alvoAsia1 !== null) {
      ops.e1Asia.push({ t: v[e1.k].time, r: simular(v, e1.k, alta, e1.entrada, e1.stop, alvoAsia1, custo), alta });
    }
    if (noOte && divEstoc) ops.v2.push({ t: v[e1.k].time, r: r1, alta });
    if (noOte) ops.soOte.push({ t: v[e1.k].time, r: r1, alta });
    if (divEstoc) ops.soEstoc.push({ t: v[e1.k].time, r: r1, alta });
    let r2 = null;
    if (e2) {
      const risco2 = Math.abs(e2.entrada - e2.stop);
      if (risco2 > 0 && custo / risco2 <= 0.5) {
        r2 = simular(v, e2.k, alta, e2.entrada, e2.stop, 3.5, custo);
        ops.e2.push({ t: v[e2.k].time, r: r2, alta });
        const alvoAsia2 = rAteAsia(alta, e2.entrada, e2.stop, aAltoP, aBaixoP);
        if (alvoAsia2 !== null) {
          ops.e2Asia.push({ t: v[e2.k].time, r: simular(v, e2.k, alta, e2.entrada, e2.stop, alvoAsia2, custo), alta });
        }
      }
    }
    // Combinada: 0,5% em cada entrada, em R de 1% de risco.
    ops.combinada.push({ t: v[e1.k].time, r: 0.5 * r1 + (r2 === null ? 0 : 0.5 * r2), alta });
  }
  return ops;
}

function linha(rotulo, ops) {
  if (ops.length < 15) return `${rotulo.padEnd(30)}${String(ops.length).padStart(5)}  (poucas)`;
  const s = est(ops.map((o) => o.r));
  const a = est(ops.filter((o) => o.t < CORTE).map((o) => o.r));
  const b = est(ops.filter((o) => o.t >= CORTE).map((o) => o.r));
  const passa = a.media > 0 && b.media > 0 && s.t >= 1.5;
  const f = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(3)}`;
  return (
    ((passa ? 'OK ' : '   ') + rotulo).padEnd(30) +
    String(s.n).padStart(5) +
    `${(100 * s.acerto).toFixed(0)}%`.padStart(6) +
    `${f(s.media)}R`.padStart(9) +
    `t=${s.t.toFixed(1)}`.padStart(8) +
    f(a.media).padStart(9) +
    f(b.media).padStart(9)
  );
}

const cab = ''.padEnd(30) + 'n'.padStart(5) + 'acerto'.padStart(6) + 'R/op'.padStart(9) + 't'.padStart(8) + '1.ª met'.padStart(9) + '2.ª met'.padStart(9);

for (const [titulo, lista, radar] of [
  ['PRINCIPAIS (os pares das notas)', PRINCIPAIS, false],
  ['CONTROLO (pares que as notas nunca operaram)', CONTROLO, false],
  ['PRINCIPAIS + radar AUDJPY/NZDJPY', PRINCIPAIS, true],
  ['CADJPY/CHFJPY + radar (controlo do radar)', CONTROLO.filter(([p]) => p === 'CADJPY' || p === 'CHFJPY'), true],
]) {
  console.log(`\n== ${titulo} · 15M · 2022+ · custos incluídos\n${cab}`);
  const todas = { e1: [], e2: [], combinada: [], v2: [], soOte: [], soEstoc: [], e1Asia: [], e2Asia: [] };
  for (const [par, ref] of lista) {
    const o = correr(par, ref, radar);
    if (!o) {
      console.log(`${par}: sem dados`);
      continue;
    }
    for (const k of Object.keys(todas)) todas[k].push(...o[k]);
    console.log(linha(`${par} · entrada 1 (SMT)`, o.e1));
    console.log(linha(`${par} · entrada 2 (MSS)`, o.e2));
    console.log(linha(`${par} · combinada ½+½`, o.combinada));
    console.log(linha(`${par} · v2 OTE+estocástico`, o.v2));
    console.log(linha(`${par} · e1 alvo na Ásia`, o.e1Asia));
    console.log(linha(`${par} · e2 alvo na Ásia`, o.e2Asia));
    if (par === 'GBPJPY') {
      const sem2025 = o.combinada.filter((x) => new Date(x.t).getUTCFullYear() !== 2025);
      console.log(linha(`${par} · combinada sem 2025`, sem2025));
    }
  }
  console.log('');
  console.log(linha('TODOS · entrada 1', todas.e1));
  console.log(linha('TODOS · entrada 2', todas.e2));
  console.log(linha('TODOS · combinada', todas.combinada));
  console.log(linha('TODOS · combinada, compras', todas.combinada.filter((o) => o.alta)));
  console.log(linha('TODOS · combinada, vendas', todas.combinada.filter((o) => !o.alta)));
  console.log(linha('TODOS · v2 (OTE + estocástico)', todas.v2));
  console.log(linha('  diagnóstico: só OTE', todas.soOte));
  console.log(linha('  diagnóstico: só estocástico', todas.soEstoc));
  console.log(linha('TODOS · e1 alvo na Ásia (journal)', todas.e1Asia));
  console.log(linha('TODOS · e2 alvo na Ásia (journal)', todas.e2Asia));
  console.log(linha('TODOS · e2 alvo Ásia, compras', todas.e2Asia.filter((o) => o.alta)));
}
