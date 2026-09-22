'use client';

/**
 * Os dois motores, e o que o de tempo real anunciou.
 *
 * Responde às duas perguntas que antes exigiam abrir um terminal:
 *
 *   "está a correr?"   — batimento ao minuto; três minutos sem ele é parado
 *   "encontrou algo?"  — os últimos sinais, com o sinal novo a acender
 *
 * Sonda `/api/motores` de 15 em 15 segundos e só enquanto o separador está
 * visível. O relógio relativo ("há 40s") avança ao segundo sem nova sondagem.
 */

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { acharSimbolo, formatarPreco } from '@/lib/deriv/simbolos';
import { ESTRATEGIAS_ACTIVAS, nomeDeEstrategia } from '@trading/core';

interface Execucao {
  iniciadoEm: string;
  terminadoEm: string;
  duracaoMs: number;
  instrumentos: number;
  sinais: number;
  novos: number;
  ok: boolean;
  resumo: string;
  erros: string[];
}

interface Estado {
  fonte: 'ficheiro' | 'supabase' | 'nenhuma';
  vivo: boolean;
  batimentoEm: string | null;
  modo: string | null;
  crons: { diario: string; tempoReal: string } | null;
  aCorrer: string[];
  paradoEm: string | null;
  diario: Execucao | null;
  tempoReal: Execucao | null;
}

interface Sinal {
  id: string;
  simbolo: string;
  timeframe: string;
  estrategia: string;
  direccao: 'bullish' | 'bearish';
  entrada: number;
  stop: number;
  rMaximo: number;
  conviccao: number;
  concordam: number;
  razao: string;
  geradoEm: string;
}


function ha(iso: string | null, agora: number): string {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((agora - Date.parse(iso)) / 1000));
  if (s < 60) return `há ${s}s`;
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86_400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86_400)} d`;
}

export function PainelMotores({ compacto = false }: { compacto?: boolean }) {
  const [dados, setDados] = useState<{ estado: Estado; sinais: Sinal[] } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [agora, setAgora] = useState(0);
  const vistos = useRef<Set<string> | null>(null);
  const [novos, setNovos] = useState<Set<string>>(new Set());

  useEffect(() => {
    let vivo = true;
    const buscar = async () => {
      try {
        const r = await fetch('/api/motores', { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as { estado: Estado; sinais: Sinal[] };
        if (!vivo) return;

        // Sinal que não estava na sondagem anterior acende. Na primeira carga
        // nada acende — seria anunciar como novo o que já lá estava.
        if (vistos.current) {
          const chegaram = j.sinais.filter((s) => !vistos.current!.has(s.id)).map((s) => s.id);
          if (chegaram.length > 0) setNovos(new Set(chegaram));
        }
        vistos.current = new Set(j.sinais.map((s) => s.id));

        setDados(j);
        setErro(null);
      } catch (e) {
        if (vivo) setErro(e instanceof Error ? e.message : String(e));
      }
    };

    setAgora(Date.now());
    void buscar();
    const sondagem = setInterval(() => {
      if (!document.hidden) void buscar();
    }, 15_000);
    const relogio = setInterval(() => setAgora(Date.now()), 1000);
    return () => {
      vivo = false;
      clearInterval(sondagem);
      clearInterval(relogio);
    };
  }, []);

  if (!dados) {
    return erro ? (
      <div className="empty">
        <strong>Não consegui ler o estado dos motores.</strong>
        {erro}
      </div>
    ) : (
      <div className="brilho" style={{ height: compacto ? 132 : 200, borderRadius: 20 }} />
    );
  }

  const e = dados.estado;
  const rotuloVivo = e.vivo ? 'Dude System a correr' : e.fonte === 'nenhuma' ? 'nunca arrancaram' : 'parados';

  return (
    <section>
      <div className="section-head">
        <h2>Motores</h2>
        <span className="grow" />
        <span className={`motores__vivo ${e.vivo ? 'on' : ''}`}>
          <i aria-hidden="true" />
          {rotuloVivo}
        </span>
      </div>

      <div className="grupo__caixa">
        <LinhaMotor
          nome="Principal"
          sub="Gestão de posições · acompanhamento diário"
          exec={e.diario}
          aCorrer={e.aCorrer.includes('diario')}
          agora={agora}
          cron={e.crons?.diario}
        />
        <LinhaMotor
          nome="Tempo real"
          sub={`${ESTRATEGIAS_ACTIVAS.length} estratégias activas · 15m a 4h`}
          exec={e.tempoReal}
          aCorrer={e.aCorrer.includes('tempoReal')}
          agora={agora}
          cron={e.crons?.tempoReal}
        />
      </div>

      {!e.vivo && (
        <p className="section-cap" style={{ marginTop: 10 }}>
          {e.paradoEm ? `Parados ${ha(e.paradoEm, agora)}. ` : ''}
          Para os ligar, na raiz do projeto: <code>npm run sistema</code>. Arranca os dois motores e
          este painel juntos, e reinicia-os se caírem.
        </p>
      )}

      {!compacto && <SinaisTempoReal sinais={dados.sinais} agora={agora} novos={novos} />}
    </section>
  );
}

function LinhaMotor({
  nome,
  sub,
  exec,
  aCorrer,
  agora,
  cron,
}: {
  nome: string;
  sub: string;
  exec: Execucao | null;
  aCorrer: boolean;
  agora: number;
  cron?: string;
}) {
  const classe = aCorrer ? 'corre' : !exec ? '' : exec.ok ? 'ok' : 'falha';
  const avisos = exec?.erros.length ?? 0;

  return (
    <div className="motor" title={exec?.erros.slice(0, 5).join('\n') || undefined}>
      <span className={`motor__ponto ${classe}`} aria-hidden="true" />
      <div className="motor__id">
        <div className="motor__nome">{nome}</div>
        <div className="motor__sub">{sub}</div>
        {exec && (
          <div className="motor__sub">
            {exec.ok ? exec.resumo : `falhou: ${exec.erros[0] ?? 'erro desconhecido'}`}
            {exec.ok && avisos > 0 && ` · ${avisos} aviso${avisos === 1 ? '' : 's'}`}
          </div>
        )}
      </div>
      <div className="motor__quando">
        {aCorrer ? 'a analisar…' : exec ? ha(exec.terminadoEm, agora) : 'ainda não correu'}
        {exec && !aCorrer && <em>{(exec.duracaoMs / 1000).toFixed(1)}s</em>}
        {cron && <em>cron {cron}</em>}
      </div>
    </div>
  );
}

function SinaisTempoReal({
  sinais,
  agora,
  novos,
}: {
  sinais: Sinal[];
  agora: number;
  novos: Set<string>;
}) {
  return (
    <div className="sinais-tr">
      <div className="section-head">
        <h2>Sinais em tempo real</h2>
        <span className="grow" />
        <span className="section-note">{sinais.length}</span>
      </div>

      {sinais.length === 0 ? (
        <div className="empty">
          <strong>Ainda nenhum sinal anunciado.</strong>
          O motor de tempo real só anuncia quando uma vela de 15m ou 1h fecha com um setup de R≥2 e
          as estratégias não se contradizem. Na maior parte das velas isso não acontece — é o
          filtro a funcionar.
        </div>
      ) : (
        <div className="grupo__caixa">
          {sinais.map((s) => {
            const compra = s.direccao === 'bullish';
            const casas = acharSimbolo(s.simbolo)?.casas ?? 5;
            const vela = new Date(s.geradoEm).toLocaleTimeString('pt-PT', {
              hour: '2-digit',
              minute: '2-digit',
            });
            return (
              <Link
                key={s.id}
                href={`/grafico?s=${encodeURIComponent(s.simbolo)}&tf=${s.timeframe}&v=${s.estrategia}`}
                className={`sinal-tr ${novos.has(s.id) ? 'sinal-tr--novo' : ''}`}
              >
                <span className={`lado-pill ${compra ? 'compra' : 'venda'}`}>
                  {compra ? 'COMPRA' : 'VENDA'}
                </span>
                <span className="sinal-tr__id">
                  <strong>
                    {s.simbolo} · {s.timeframe}
                  </strong>
                  <em>
                    entrada {formatarPreco(s.entrada, casas)} · stop {formatarPreco(s.stop, casas)} ·{' '}
                    {nomeDeEstrategia(s.estrategia)}
                  </em>
                </span>
                <span className="sinal-tr__r">
                  {s.rMaximo.toFixed(1)}R
                  <em>
                    vela {vela} · {ha(s.geradoEm, agora)}
                  </em>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
