'use client';

/**
 * Os sinais da conta, no início.
 *
 *   só do portfólio       o que a conta segue; o resto não aparece nem avisa
 *   ordenados             pelo momento do anúncio, mais recente primeiro
 *   dois grupos           "Activos" (à espera da entrada, em curso) e
 *                         "Terminados" (alvo, invalidados, expirados), este
 *                         fechado por omissão para não misturar velho e novo
 *   etiqueta de estado    invalidado · stop, invalidado · sem entrada,
 *                         expirado, alvo atingido
 *   eliminar              um a um, ou todos os terminados de uma vez
 *
 * Sonda `/api/sinais` de 30 em 30 segundos, só com o separador visível.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { acharSimbolo, formatarPreco } from '@/lib/deriv/simbolos';
import { planoInvalidado, planoVivo, ROTULO_PLANO, type EstadoPlano } from '@/lib/estado-sinal';

interface Sinal {
  id: string;
  simbolo: string;
  timeframe: string;
  estrategia: string;
  direccao: 'bullish' | 'bearish';
  entrada: number;
  stop: number;
  alvos: Array<{ preco: number; r: number }>;
  rMaximo: number;
  geradoEm: string;
  anunciadoEm: string;
  estado: EstadoPlano | null;
  resultadoR?: number | null;
  ultimoEvento?: string | null;
  stopActual?: number | null;
  conviccao?: number;
  emTeste?: boolean;
}

const NOME_ESTRATEGIA: Record<string, string> = {
  'compra-vwap-indices': 'Compra na banda −2σ do VWAP',
  'connors-rsi2-indices': 'RSI(2) de Connors',
  'tendencia-cripto': 'Tendência 55 dias',
  'tendencia-ouro': 'Tendência 55 dias (ouro)',
  'vwap-forex-teste': 'VWAP ±2σ no forex (em teste)',
  'smt-teste': 'SMT sem MMXM (em teste)',
  'tendencia-baixa-cripto': 'Tendência de baixa — cripto (em teste)',
  'supply-demand': 'Oferta e procura',
  'support-resistance': 'Suporte/resistência',
  'vwap-bands': 'Bandas de VWAP',
  'volume-profile': 'Perfil de volume',
};

function ha(iso: string, agora: number): string {
  const s = Math.max(0, Math.round((agora - Date.parse(iso)) / 1000));
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86_400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86_400)} d`;
}

export function ListaSinais() {
  const [dados, setDados] = useState<{
    portfolio: string[];
    /** Timeframes que os objetivos do onboarding pedem. */
    timeframes?: string[];
    sinais: Sinal[];
    ocultarDisponivel: boolean;
  } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [agora, setAgora] = useState(0);
  const [verTerminados, setVerTerminados] = useState(false);

  const buscar = useCallback(async () => {
    try {
      const r = await fetch('/api/sinais', { cache: 'no-store' });
      const j = (await r.json()) as typeof dados & { erro?: string };
      if (!r.ok || !j) throw new Error(j?.erro ?? `HTTP ${r.status}`);
      setDados(j);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    setAgora(Date.now());
    void buscar();
    const sondagem = setInterval(() => {
      if (!document.hidden) void buscar();
    }, 30_000);
    const relogio = setInterval(() => setAgora(Date.now()), 30_000);
    return () => {
      clearInterval(sondagem);
      clearInterval(relogio);
    };
  }, [buscar]);

  const eliminar = async (ids: string[]) => {
    if (!dados || ids.length === 0) return;
    const antes = dados;
    setDados({ ...dados, sinais: dados.sinais.filter((s) => !ids.includes(s.id)) });
    try {
      const r = await fetch('/api/sinais/ocultar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const j = (await r.json()) as { erro?: string };
      if (!r.ok) throw new Error(j.erro ?? `HTTP ${r.status}`);
    } catch (e) {
      setDados(antes);
      setErro(e instanceof Error ? e.message : String(e));
    }
  };

  if (!dados) {
    return erro ? (
      <div className="empty">
        <strong>Não consegui ler os sinais.</strong>
        {erro}
      </div>
    ) : (
      <div className="brilho" style={{ height: 180, borderRadius: 20 }} />
    );
  }

  const activos = dados.sinais.filter((s) => s.estado === null || planoVivo(s.estado));
  const terminados = dados.sinais.filter((s) => s.estado !== null && !planoVivo(s.estado));

  const tfs = (dados.timeframes ?? []).map((t) => t.toUpperCase()).join(' · ');

  return (
    <section>
      <div className="section-head">
        <h2>Sinais</h2>
        <span className="grow" />
        <span className="section-note">
          {tfs ? `${tfs} · ` : ''}
          {activos.length} activo{activos.length === 1 ? '' : 's'}
        </span>
      </div>

      {dados.portfolio.length === 0 ? (
        <div className="empty">
          <strong>O seu portfólio está vazio.</strong>
          Só recebe sinais dos instrumentos que segue. Adicione-os no{' '}
          <Link href="/portfolio">Portfólio</Link> ou com a estrela ☆ no gráfico.
        </div>
      ) : activos.length === 0 ? (
        <div className="empty">
          <strong>Nenhum sinal activo nos seus {dados.portfolio.length} instrumentos.</strong>
          Um sinal nasce quando fecha uma vela {tfs ? `de ${tfs}` : ''} com um plano que passa os
          filtros de qualidade. Escolha os timeframes em{' '}
          <Link href="/definicoes">Definições</Link>.
        </div>
      ) : (
        <div className="grupo__caixa">
          {activos.map((s) => (
            <LinhaSinal
              key={s.id}
              s={s}
              agora={agora}
              aoEliminar={dados.ocultarDisponivel ? () => void eliminar([s.id]) : undefined}
            />
          ))}
        </div>
      )}

      {terminados.length > 0 && (
        <div className="sinais-terminados">
          <div className="section-head" style={{ marginTop: 16 }}>
            <button type="button" className="sinais-terminados__abrir" onClick={() => setVerTerminados((v) => !v)}>
              {verTerminados ? '▾' : '▸'} Terminados e invalidados ({terminados.length})
            </button>
            <span className="grow" />
            {verTerminados && dados.ocultarDisponivel && (
              <button
                type="button"
                className="sinais-terminados__limpar"
                onClick={() => void eliminar(terminados.map((s) => s.id))}
              >
                eliminar todos
              </button>
            )}
          </div>
          {verTerminados && (
            <div className="grupo__caixa">
              {terminados.map((s) => (
                <LinhaSinal
                  key={s.id}
                  s={s}
                  agora={agora}
                  aoEliminar={dados.ocultarDisponivel ? () => void eliminar([s.id]) : undefined}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {!dados.ocultarDisponivel && dados.sinais.length > 0 && (
        <p className="section-cap" style={{ marginTop: 10 }}>
          Para poder eliminar sinais, aplique a migração 0006 no Supabase.
        </p>
      )}
      {erro && <div className="ob__erro">{erro}</div>}
    </section>
  );
}

function LinhaSinal({
  s,
  agora,
  aoEliminar,
}: {
  s: Sinal;
  agora: number;
  aoEliminar?: () => void;
}) {
  const compra = s.direccao === 'bullish';
  const casas = acharSimbolo(s.simbolo)?.casas ?? 5;
  const estado = s.estado;
  const classeEstado = !estado
    ? ''
    : estado === 'alvo-atingido'
      ? 'bull'
      : planoInvalidado(estado)
        ? 'bear'
        : estado === 'em-curso'
          ? 'curso'
          : 'espera';

  return (
    <div className={`sinal-linha ${estado && !planoVivo(estado) ? 'sinal-linha--terminado' : ''}`}>
      <Link
        href={`/grafico?s=${encodeURIComponent(s.simbolo)}&tf=${s.timeframe}&v=${s.estrategia}&sinal=${encodeURIComponent(s.id)}`}
        className="sinal-tr"
      >
        <span className={`lado-pill ${compra ? 'compra' : 'venda'}`}>{compra ? 'COMPRA' : 'VENDA'}</span>
        <span className="sinal-tr__id">
          <strong>
            {s.simbolo} · {s.timeframe}
            {estado && <span className={`etiqueta-estado ${classeEstado}`}>{ROTULO_PLANO[estado]}</span>}
          </strong>
          <em>
            entrada {formatarPreco(s.entrada, casas)} · stop{' '}
            {formatarPreco(s.stopActual ?? s.stop, casas)}
            {s.stopActual !== null && s.stopActual !== undefined && s.stopActual !== s.stop ? ' (subiu)' : ''} ·{' '}
            {NOME_ESTRATEGIA[s.estrategia] ?? s.estrategia}
            {s.ultimoEvento ? ` · ${s.ultimoEvento}` : ''}
          </em>
        </span>
        <span className="sinal-tr__r">
          {s.resultadoR !== null && s.resultadoR !== undefined ? (
            <b className={s.resultadoR > 0 ? 'bull-t' : 'bear-t'}>
              {s.resultadoR > 0 ? '+' : ''}
              {s.resultadoR.toFixed(1)}R
            </b>
          ) : s.emTeste ? (
            <span className="selo-em-teste">EM TESTE</span>
          ) : s.conviccao !== undefined ? (
            <>{Math.round(s.conviccao * 100)}%</>
          ) : (
            <>{s.rMaximo.toFixed(1)}R</>
          )}
          <em>{agora ? ha(s.anunciadoEm, agora) : ''}</em>
        </span>
      </Link>
      {aoEliminar && (
        <button type="button" className="sinal-linha__eliminar" onClick={aoEliminar} aria-label={`Eliminar sinal ${s.simbolo}`}>
          ×
        </button>
      )}
    </div>
  );
}
