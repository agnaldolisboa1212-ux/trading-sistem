'use client';

/**
 * Os sinais que o algoritmo JÁ ENVIOU neste instrumento (48 h), com o que lhes
 * aconteceu — ficam no painel e no gráfico mesmo quando a análise de agora já
 * mudou de setup.
 */

import type { SinalEnviado } from './usarSinaisEnviados';

const ESTADO: Record<string, string> = {
  'a-aguardar-entrada': 'à espera da entrada',
  'em-curso': 'em curso',
  'alvo-atingido': 'alvo atingido',
  'stop-atingido': 'stop atingido',
  perdido: 'sem entrada',
  expirado: 'expirado',
};

export function SinaisEnviados({
  sinais,
  estrategia,
  fmt,
}: {
  sinais: readonly SinalEnviado[];
  estrategia: string;
  fmt: (v: number) => string;
}) {
  const agora = Date.now();
  const lista = sinais.filter((s) => s.estrategia === estrategia && agora - Date.parse(s.geradoEm) <= 48 * 3_600_000);
  return (
    <div className="visoes__estruturas">
      <div className="visoes__subtitulo">Sinais enviados (48 h)</div>
      {lista.length === 0 ? (
        <p className="analise-viva__nota">Nenhum sinal enviado nas últimas 48 horas neste instrumento.</p>
      ) : (
        <ul className="ict__modelos">
          {lista.map((s) => {
            const compra = s.direccao === 'bullish';
            const alvo = s.alvos[0];
            return (
              <li key={s.id}>
                <span className={`lado-pill ${compra ? 'compra' : 'venda'}`}>{compra ? 'COMPRA' : 'VENDA'}</span>
                <span className="ict__passo-texto">
                  <b>
                    {new Date(s.geradoEm).toLocaleString('pt-PT', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
                    <em>{s.timeframe.toUpperCase()}</em>
                  </b>
                  <span>
                    entrada {fmt(s.entrada)} · stop {fmt(s.stop)}
                    {alvo ? ` · alvo ${fmt(alvo.preco)} (${alvo.r.toFixed(1)}R)` : ''}
                  </span>
                  <span className="faint">
                    {s.estado ? (ESTADO[s.estado] ?? s.estado) : 'sem estado'}
                    {s.resultadoR !== null ? ` · ${s.resultadoR >= 0 ? '+' : ''}${s.resultadoR.toFixed(1)}R` : ''}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
