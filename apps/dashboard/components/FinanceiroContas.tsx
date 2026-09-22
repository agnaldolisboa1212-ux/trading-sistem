'use client';

/**
 * Contas, entradas marcadas e a curva de capital de cada uma.
 *
 * ── O PROBLEMA QUE ISTO RESOLVE ────────────────────────────────────────────
 *
 * `sinais_tempo_real` é do SISTEMA: todos os sinais que qualquer estratégia
 * activa gerou, partilhados com toda a gente que segue aquele instrumento. A
 * pessoa só negoceia alguns — com o toque manual no terminal. Sem marcar
 * quais, o desempenho "pessoal" estaria a medir sinais que nunca foram
 * negociados como se tivessem sido.
 *
 * Este componente deixa marcar, sinal a sinal, "negociei este" — numa CONTA
 * (uma pessoa pode ter várias, uma por corretora), e só o que está marcado
 * entra no resultado acumulado, no agrupamento por par/timeframe/estratégia,
 * na distribuição e na curva de capital dessa conta.
 *
 * `app/api/contas`, `app/api/entradas` e `app/api/saldo` — migrações 0009 e
 * 0010, RLS por conta.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { estrategiaActiva, estrategiaEmTeste } from '@trading/core';
import { acharSimbolo } from '@/lib/deriv/simbolos';
import { agrupar, calcularEstatisticas } from '@/lib/desempenho';
import type { SinalTempoRealRow } from '@/lib/supabase';
import { CurvaDeCapital } from './CurvaDeCapital';
import { DesempenhoAgrupado } from './DesempenhoAgrupado';
import { EstatisticasCard } from './EstatisticasCard';
import { RDistribution } from './FinanceCharts';

interface Conta {
  id: number;
  nome: string;
  corretora: string | null;
  moeda: string;
  arquivada: boolean;
  criado_em: string;
}

interface Entrada {
  conta_id: number;
  sinal_id: string;
}

const CHAVE_CONTA = 'financeiro_conta_id';
const ABERTO = new Set(['a-aguardar-entrada', 'em-curso', 'protegida']);
const FECHADO_MOTIVO: Record<string, string> = {
  fechada: '',
  expirado: 'expirado · sem tocar na entrada',
  perdido: 'foi para o alvo sem tocar na entrada',
};

function nomeEstrategia(id: string): string {
  return estrategiaActiva(id)?.nome ?? id;
}
function emTesteId(id: string): boolean {
  return estrategiaEmTeste(id) !== undefined;
}
function preco(simbolo: string, valor: number): string {
  return valor.toFixed(acharSimbolo(simbolo)?.casas ?? 5);
}
function when(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export function FinanceiroContas({ sinais }: { sinais: SinalTempoRealRow[] }) {
  const [contas, setContas] = useState<Conta[] | null>(null);
  const [entradas, setEntradas] = useState<Entrada[] | null>(null);
  const [semSessao, setSemSessao] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [contaId, setContaId] = useState<number | null>(null);
  const [aCriar, setACriar] = useState(false);
  const [novoNome, setNovoNome] = useState('');
  const [novaCorretora, setNovaCorretora] = useState('');
  const [aGuardarConta, setAGuardarConta] = useState(false);

  const escolherContaEstavel = useCallback((lista: Conta[]) => {
    setContaId((actual) => {
      if (actual !== null && lista.some((c) => c.id === actual)) return actual;
      let guardado: number | null = null;
      try {
        const v = window.localStorage.getItem(CHAVE_CONTA);
        guardado = v ? Number(v) : null;
      } catch {
        /* sem armazenamento */
      }
      if (guardado !== null && lista.some((c) => c.id === guardado)) return guardado;
      return lista[0]?.id ?? null;
    });
  }, []);

  const carregar = useCallback(async () => {
    try {
      const [rc, re] = await Promise.all([
        fetch('/api/contas', { cache: 'no-store' }),
        fetch('/api/entradas', { cache: 'no-store' }),
      ]);
      const jc = (await rc.json()) as { contas?: Conta[]; semSessao?: boolean; erro?: string };
      if (!rc.ok) throw new Error(jc.erro ?? `HTTP ${rc.status}`);
      if (jc.semSessao) {
        setSemSessao(true);
        return;
      }
      let lista = jc.contas ?? [];
      // Zero-fricção: quem nunca criou uma conta ganha logo a primeira.
      if (lista.length === 0) {
        const rn = await fetch('/api/contas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nome: 'Conta principal' }),
        });
        const jn = (await rn.json()) as { conta?: Conta; erro?: string };
        if (rn.ok && jn.conta) lista = [jn.conta];
      }
      const je = re.ok ? ((await re.json()) as { entradas?: Entrada[] }) : { entradas: [] };
      setContas(lista);
      setEntradas(je.entradas ?? []);
      setErro(null);
      escolherContaEstavel(lista);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }, [escolherContaEstavel]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const escolherConta = (id: number) => {
    setContaId(id);
    try {
      window.localStorage.setItem(CHAVE_CONTA, String(id));
    } catch {
      /* sem armazenamento */
    }
  };

  const criarConta = async () => {
    if (!novoNome.trim()) return;
    setAGuardarConta(true);
    try {
      const r = await fetch('/api/contas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: novoNome.trim(), corretora: novaCorretora.trim() || undefined }),
      });
      const j = (await r.json()) as { conta?: Conta; erro?: string };
      if (!r.ok) throw new Error(j.erro ?? `HTTP ${r.status}`);
      if (j.conta) {
        const conta = j.conta;
        setContas((cs) => [...(cs ?? []), conta]);
        escolherConta(conta.id);
      }
      setNovoNome('');
      setNovaCorretora('');
      setACriar(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setAGuardarConta(false);
    }
  };

  const marcarPorSinal = useMemo(() => {
    const m = new Map<string, Set<number>>();
    for (const e of entradas ?? []) {
      const s = m.get(e.sinal_id) ?? new Set<number>();
      s.add(e.conta_id);
      m.set(e.sinal_id, s);
    }
    return m;
  }, [entradas]);

  const alternarEntrada = async (sinalId: string) => {
    if (contaId === null) return;
    const marcado = marcarPorSinal.get(sinalId)?.has(contaId) ?? false;
    const antes = entradas;
    setEntradas((es) => {
      const lista = es ?? [];
      return marcado
        ? lista.filter((e) => !(e.conta_id === contaId && e.sinal_id === sinalId))
        : [...lista, { conta_id: contaId, sinal_id: sinalId }];
    });
    try {
      const r = marcado
        ? await fetch(`/api/entradas?contaId=${contaId}&sinalId=${encodeURIComponent(sinalId)}`, { method: 'DELETE' })
        : await fetch('/api/entradas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contaId, sinalId }),
          });
      if (!r.ok) {
        const j = (await r.json()) as { erro?: string };
        throw new Error(j.erro ?? `HTTP ${r.status}`);
      }
    } catch (e) {
      setEntradas(antes);
      setErro(e instanceof Error ? e.message : String(e));
    }
  };

  if (semSessao) {
    return (
      <div className="empty">
        <strong>Entre na conta para marcar as suas entradas.</strong>
        O desempenho pessoal e a curva de capital são por conta: cada pessoa vê e regista só o seu.
      </div>
    );
  }

  const contaActual = contas?.find((c) => c.id === contaId) ?? null;
  const minhasEntradas = contaId !== null ? sinais.filter((s) => marcarPorSinal.get(s.id)?.has(contaId)) : [];
  const minhasFechadas = minhasEntradas.filter((s) => s.estado === 'fechada');
  const rValues = minhasFechadas.map((r) => Number(r.resultado_r)).filter(Number.isFinite);
  const estatisticas = calcularEstatisticas(rValues);
  const porPar = agrupar(minhasFechadas, 'simbolo', nomeEstrategia, emTesteId);
  const porTimeframe = agrupar(minhasFechadas, 'timeframe', nomeEstrategia, emTesteId);
  const porEstrategia = agrupar(minhasFechadas, 'estrategia', nomeEstrategia, emTesteId);

  const abertos = sinais.filter((r) => r.estado === null || ABERTO.has(r.estado));
  const historico = sinais.filter((r) => r.estado === 'fechada' || r.estado === 'expirado' || r.estado === 'perdido');

  return (
    <div>
      <div className="desempenho-tabs" role="tablist" aria-label="Conta">
        {(contas ?? []).map((c) => (
          <button key={c.id} type="button" role="tab" aria-pressed={contaId === c.id} onClick={() => escolherConta(c.id)}>
            {c.nome}
          </button>
        ))}
        <button type="button" onClick={() => setACriar((v) => !v)} aria-label="Nova conta" title="Nova conta">
          + conta
        </button>
      </div>

      {aCriar && (
        <div className="saldo-form">
          <input
            type="text"
            placeholder="nome da conta"
            value={novoNome}
            onChange={(e) => setNovoNome(e.target.value)}
            aria-label="Nome da conta"
          />
          <input
            type="text"
            placeholder="corretora (opcional)"
            value={novaCorretora}
            onChange={(e) => setNovaCorretora(e.target.value)}
            aria-label="Corretora"
          />
          <button type="button" className="btn primary" onClick={() => void criarConta()} disabled={aGuardarConta || !novoNome.trim()}>
            {aGuardarConta ? 'a criar…' : 'Criar conta'}
          </button>
        </div>
      )}

      {!contaActual ? (
        <div className="brilho" style={{ height: 120, borderRadius: 16 }} />
      ) : (
        <>
          <section>
            <h3>Desempenho pessoal — {contaActual.nome}</h3>
            {estatisticas.n === 0 ? (
              <div className="empty">
                Ainda não marcou nenhuma entrada nesta conta. Nas tabelas abaixo, marque "negociei"
                nos sinais que realmente entrou — só esses contam aqui.
              </div>
            ) : (
              <>
                <EstatisticasCard e={estatisticas} />
                <DesempenhoAgrupado porPar={porPar} porTimeframe={porTimeframe} porEstrategia={porEstrategia} />
                <div className="card pad-chart" style={{ marginTop: 12 }}>
                  <RDistribution values={rValues} />
                </div>
              </>
            )}
          </section>

          <section>
            <h3>Curva de capital — {contaActual.nome}</h3>
            <CurvaDeCapital contaId={contaActual.id} />
          </section>
        </>
      )}

      <section>
        <h3>Posições abertas ({abertos.length})</h3>
        <TabelaSinais
          linhas={abertos}
          contaId={contaId}
          marcarPorSinal={marcarPorSinal}
          contas={contas ?? []}
          aoAlternar={alternarEntrada}
          tipo="abertas"
          vazio="Nenhuma posição aberta."
        />
      </section>

      <section>
        <h3>Histórico ({historico.length})</h3>
        <TabelaSinais
          linhas={historico}
          contaId={contaId}
          marcarPorSinal={marcarPorSinal}
          contas={contas ?? []}
          aoAlternar={alternarEntrada}
          tipo="historico"
          vazio="Nenhuma operação fechada ainda."
        />
      </section>

      {erro && <div className="ob__erro">{erro}</div>}
    </div>
  );
}

function TabelaSinais({
  linhas,
  contaId,
  marcarPorSinal,
  contas,
  aoAlternar,
  tipo,
  vazio,
}: {
  linhas: SinalTempoRealRow[];
  contaId: number | null;
  marcarPorSinal: Map<string, Set<number>>;
  contas: Conta[];
  aoAlternar: (sinalId: string) => void;
  tipo: 'abertas' | 'historico';
  vazio: string;
}) {
  if (linhas.length === 0) return <div className="empty">{vazio}</div>;

  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th>Símbolo</th>
            <th>Estratégia</th>
            <th>Lado</th>
            <th>Gerado</th>
            {tipo === 'abertas' ? (
              <>
                <th className="num">Entrada</th>
                <th className="num">Stop actual</th>
              </>
            ) : (
              <>
                <th className="num">Resultado</th>
                <th>Motivo</th>
              </>
            )}
            <th>Negociei?</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((r) => {
            const marcadas = marcarPorSinal.get(r.id);
            const marcadaAqui = contaId !== null && (marcadas?.has(contaId) ?? false);
            const outras = [...(marcadas ?? [])]
              .filter((id) => id !== contaId)
              .map((id) => contas.find((c) => c.id === id)?.nome)
              .filter((x): x is string => Boolean(x));
            return (
              <tr key={r.id}>
                <td>
                  <Link href={`/grafico?s=${encodeURIComponent(r.simbolo)}&tf=${r.timeframe}`} className="row-link">
                    {r.simbolo} · {r.timeframe.toUpperCase()}
                  </Link>
                </td>
                <td className="dim">
                  {nomeEstrategia(r.estrategia)}
                </td>
                <td className={r.direccao === 'bullish' ? 'bull-t' : 'bear-t'}>
                  {r.direccao === 'bullish' ? 'COMPRA' : 'VENDA'}
                </td>
                <td className="dim">{when(r.gerado_em)}</td>
                {tipo === 'abertas' ? (
                  <>
                    <td className="num">{preco(r.simbolo, r.entrada)}</td>
                    <td className="num">{preco(r.simbolo, r.stop_actual ?? r.stop)}</td>
                  </>
                ) : (
                  <>
                    <td
                      className={`num ${
                        r.estado === 'fechada' && (r.resultado_r ?? 0) >= 0
                          ? 'bull-t'
                          : r.estado === 'fechada'
                            ? 'bear-t'
                            : 'dim'
                      }`}
                    >
                      {r.estado === 'fechada' && r.resultado_r !== null
                        ? <span className={`pill ${r.resultado_r >= 0 ? 'bull' : 'bear'}`}>
                            {r.resultado_r >= 0 ? '+' : ''}{r.resultado_r.toFixed(2)}R
                          </span>
                        : '—'}
                    </td>
                    <td className="dim">
                      {r.estado === 'fechada' 
                        ? <span className="pill" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>Fechada</span> 
                        : r.estado === 'expirado' 
                        ? <span className="pill" style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}>Expirada</span>
                        : r.estado === 'perdido'
                        ? <span className="pill bear">Perdida (Alvo)</span>
                        : '—'}
                    </td>
                  </>
                )}
                <td>
                  <button
                    type="button"
                    className={`btn ${marcadaAqui ? 'ghost' : ''}`}
                    style={{ padding: '4px 10px', fontSize: 12, whiteSpace: 'nowrap' }}
                    disabled={contaId === null}
                    onClick={() => aoAlternar(r.id)}
                  >
                    {marcadaAqui ? '✓ negociei' : 'marquei esta entrada'}
                  </button>
                  {outras.length > 0 && (
                    <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>
                      também: {outras.join(', ')}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
