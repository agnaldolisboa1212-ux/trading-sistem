'use client';

/**
 * Curva de capital de UMA conta — o saldo REAL, introduzido à mão.
 *
 * As ordens só saem com um toque manual no terminal: não há execução
 * automática de que se possa derivar um saldo. Em vez de simular uma conta a
 * partir dos sinais (a página antiga fazia isso, com uma conta que nunca
 * existiu), cada pessoa regista aqui o saldo real quando quiser — a curva liga
 * os pontos. `app/api/saldo/route.ts` guarda-os por conta (RLS, migrações
 * 0009 e 0010). A conta em si é escolhida pelo componente-pai (`FinanceiroContas`).
 */

import { useCallback, useEffect, useState } from 'react';
import { EquityChart, type EquityPoint } from '@/components/FinanceCharts';

interface Ponto {
  id: number;
  saldo: number;
  moeda: string;
  nota: string | null;
  registado_em: string;
}

export function CurvaDeCapital({ contaId }: { contaId: number }) {
  const [pontos, setPontos] = useState<Ponto[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [saldo, setSaldo] = useState('');
  const [nota, setNota] = useState('');
  const [aGuardar, setAGuardar] = useState(false);

  const buscar = useCallback(async () => {
    try {
      const r = await fetch(`/api/saldo?contaId=${contaId}`, { cache: 'no-store' });
      const j = (await r.json()) as { pontos?: Ponto[]; erro?: string };
      if (!r.ok) throw new Error(j.erro ?? `HTTP ${r.status}`);
      setPontos(j.pontos ?? []);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }, [contaId]);

  useEffect(() => {
    setPontos(null);
    void buscar();
  }, [buscar]);

  const adicionar = async () => {
    const valor = Number(saldo.replace(',', '.'));
    if (!Number.isFinite(valor)) return;
    setAGuardar(true);
    try {
      const r = await fetch('/api/saldo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contaId, saldo: valor, nota: nota.trim() || undefined }),
      });
      const j = (await r.json()) as { erro?: string };
      if (!r.ok) throw new Error(j.erro ?? `HTTP ${r.status}`);
      setSaldo('');
      setNota('');
      await buscar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setAGuardar(false);
    }
  };

  const eliminar = async (id: number) => {
    const antes = pontos;
    setPontos((p) => p?.filter((x) => x.id !== id) ?? p);
    try {
      const r = await fetch(`/api/saldo?id=${id}`, { method: 'DELETE' });
      if (!r.ok) {
        const j = (await r.json()) as { erro?: string };
        throw new Error(j.erro ?? `HTTP ${r.status}`);
      }
    } catch (e) {
      setPontos(antes);
      setErro(e instanceof Error ? e.message : String(e));
    }
  };

  const equityPoints: EquityPoint[] = (pontos ?? []).map((p) => ({
    t: Date.parse(p.registado_em),
    balance: p.saldo,
  }));

  return (
    <div>
      <div className="card pad-chart">
        <EquityChart points={equityPoints} />
      </div>

      <div className="saldo-form">
        <input
          type="text"
          inputMode="decimal"
          placeholder="saldo actual"
          value={saldo}
          onChange={(e) => setSaldo(e.target.value)}
          aria-label="Saldo"
        />
        <input
          type="text"
          placeholder="nota (opcional)"
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          aria-label="Nota"
        />
        <button type="button" className="btn primary" onClick={() => void adicionar()} disabled={aGuardar || !saldo}>
          {aGuardar ? 'a guardar…' : 'Registar'}
        </button>
      </div>

      {pontos && pontos.length > 0 && (
        <div className="saldo-lista">
          {[...pontos]
            .reverse()
            .slice(0, 8)
            .map((p) => (
              <div key={p.id} className="saldo-linha">
                <span className="saldo-linha__data">{new Date(p.registado_em).toISOString().slice(0, 10)}</span>
                <strong>
                  {p.saldo.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {p.moeda}
                </strong>
                {p.nota && <em>{p.nota}</em>}
                <button
                  type="button"
                  className="saldo-linha__eliminar"
                  aria-label="Eliminar este ponto"
                  onClick={() => void eliminar(p.id)}
                >
                  ×
                </button>
              </div>
            ))}
        </div>
      )}

      {erro && <div className="ob__erro">{erro}</div>}
    </div>
  );
}
