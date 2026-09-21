/**
 * Os travões da automação.
 *
 * Esta é a função que decide se sai uma ordem com dinheiro real sem ninguém
 * tocar em nada. Cada travão tem aqui o seu teste; se um deles deixar de
 * funcionar, é dinheiro.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { decidirAutomacao } from '../lib/automacao.ts';

const DEFINICOES = {
  activa: true,
  contaRealPermitida: false,
  estrategias: ['compra-vwap-indices'],
  instrumentos: ['US100'],
  modoLote: 'fixo',
  loteFixo: 0.1,
  riscoPct: 1,
  maxOrdensAbertas: 2,
  perdaDiariaPct: 3,
  perdaTotalPct: 10,
  contaCtrader: 123,
};

const SINAL = {
  id: 'sinal-1',
  simbolo: 'US100',
  timeframe: '1h',
  estrategia: 'compra-vwap-indices',
  direccao: 'bullish',
  entrada: 20000,
  stop: 19900,
  alvo: 20200,
};

const factos = (mudancas = {}) => ({
  definicoes: { ...DEFINICOES, ...(mudancas.definicoes ?? {}) },
  sinal: { ...SINAL, ...(mudancas.sinal ?? {}) },
  conta: { real: false, saldo: 10000, ...(mudancas.conta ?? {}) },
  posicoesAbertas: mudancas.posicoesAbertas ?? 0,
  jaProcessado: mudancas.jaProcessado ?? false,
  resultadoHoje: mudancas.resultadoHoje ?? 0,
  resultadoTotal: mudancas.resultadoTotal ?? 0,
  valorPorLote: mudancas.valorPorLote ?? 1,
  limiteLotes: mudancas.limiteLotes ?? 1,
  loteMinimo: mudancas.loteMinimo ?? 0.01,
});

test('deixa passar um sinal dentro de todos os limites', () => {
  const d = decidirAutomacao(factos());
  assert.equal(d.ok, true);
  assert.equal(d.lotes, 0.1);
});

test('não envia nada com a automação desligada', () => {
  assert.equal(decidirAutomacao(factos({ definicoes: { activa: false } })).ok, false);
});

test('nunca repete o mesmo sinal', () => {
  const d = decidirAutomacao(factos({ jaProcessado: true }));
  assert.equal(d.ok, false);
  assert.match(d.motivo, /já tinha sido tratado/);
});

test('conta REAL exige autorização explícita', () => {
  const semAutorizacao = decidirAutomacao(factos({ conta: { real: true } }));
  assert.equal(semAutorizacao.ok, false);
  assert.match(semAutorizacao.motivo, /autorização/i);
  const com = decidirAutomacao(
    factos({ conta: { real: true }, definicoes: { contaRealPermitida: true } }),
  );
  assert.equal(com.ok, true);
});

test('só as estratégias e os instrumentos escolhidos', () => {
  assert.equal(decidirAutomacao(factos({ sinal: { estrategia: 'smt-teste' } })).ok, false);
  assert.equal(decidirAutomacao(factos({ sinal: { simbolo: 'SP500' } })).ok, false);
});

test('respeita o máximo de posições abertas', () => {
  assert.equal(decidirAutomacao(factos({ posicoesAbertas: 1 })).ok, true);
  const cheio = decidirAutomacao(factos({ posicoesAbertas: 2 }));
  assert.equal(cheio.ok, false);
  assert.match(cheio.motivo, /2 posições abertas/);
});

test('pára no limite de perda do dia e no total', () => {
  // 3% de 10000 = 300: perder 299 ainda passa, 300 já não.
  assert.equal(decidirAutomacao(factos({ resultadoHoje: -299 })).ok, true);
  const dia = decidirAutomacao(factos({ resultadoHoje: -300 }));
  assert.equal(dia.ok, false);
  assert.match(dia.motivo, /diário/);
  const total = decidirAutomacao(factos({ resultadoTotal: -1000 }));
  assert.equal(total.ok, false);
  assert.match(total.motivo, /total/);
  // Ganhar não conta como perda.
  assert.equal(decidirAutomacao(factos({ resultadoHoje: 5000, resultadoTotal: 9000 })).ok, true);
});

test('recusa um sinal com o stop do lado errado', () => {
  assert.equal(decidirAutomacao(factos({ sinal: { stop: 20100 } })).ok, false);
  const venda = decidirAutomacao(
    factos({ sinal: { direccao: 'bearish', stop: 20100 }, definicoes: { instrumentos: ['US100'] } }),
  );
  assert.equal(venda.ok, true);
  assert.equal(decidirAutomacao(factos({ sinal: { stop: 20000 } })).ok, false);
});

test('modo risco: dimensiona pelo saldo e nunca passa o tecto de lotes', () => {
  // 1% de 10000 = 100 de risco; 100 pontos de stop; 1 de valor por lote → 1 lote.
  const d = decidirAutomacao(factos({ definicoes: { modoLote: 'risco' }, limiteLotes: 5 }));
  assert.equal(d.ok, true);
  assert.equal(Math.round(d.lotes * 100) / 100, 1);
  // Com o tecto a 0,5 o lote fica no tecto, não no que o risco pedia.
  const travado = decidirAutomacao(factos({ definicoes: { modoLote: 'risco' }, limiteLotes: 0.5 }));
  assert.equal(travado.lotes, 0.5);
});

test('modo risco: recusa quando o risco não chega para o lote mínimo', () => {
  const d = decidirAutomacao(
    factos({ definicoes: { modoLote: 'risco', riscoPct: 0.1 }, valorPorLote: 100, loteMinimo: 0.1 }),
  );
  assert.equal(d.ok, false);
  assert.match(d.motivo, /lote mínimo/);
});

test('arredonda o lote para baixo, ao passo do instrumento', () => {
  const d = decidirAutomacao(
    factos({ definicoes: { modoLote: 'risco', riscoPct: 1.37 }, limiteLotes: 5, loteMinimo: 0.01 }),
  );
  assert.equal(d.ok, true);
  assert.equal(d.lotes, 1.37);
  const passoGrande = decidirAutomacao(
    factos({ definicoes: { modoLote: 'risco', riscoPct: 1.37 }, limiteLotes: 5, loteMinimo: 0.5 }),
  );
  assert.equal(passoGrande.lotes, 1);
});

test('sem conta cTrader escolhida não há ordem', () => {
  assert.equal(decidirAutomacao(factos({ definicoes: { contaCtrader: null } })).ok, false);
});
