'use client';

/**
 * Painel da automação — o robô que envia ordens sem ninguém tocar no botão.
 *
 * Antes disto, o painel guardava as escolhas em `localStorage` e mais nada as
 * lia: o interruptor "Estado da automação" não ligava coisa nenhuma. Agora as
 * definições vão para a base de dados (migração 0012) e é o motor que as lê.
 *
 * Três coisas têm de estar verdadeiras para sair uma ordem automática:
 *   1. a automação ligada aqui, com estratégias e instrumentos escolhidos
 *   2. o motor autorizado na conta cTrader (o botão em baixo)
 *   3. `AUTOMACAO_UTILIZADOR_ID` e `MOTOR_SEGREDO` no servidor
 * Qualquer uma em falta e não sai nada. É de propósito.
 */

import { useCallback, useEffect, useState } from 'react';
import { ESTRATEGIAS_ACTIVAS, estrategiaEmTeste } from '@trading/core';

interface Definicoes {
  activa: boolean;
  contaRealPermitida: boolean;
  estrategias: string[];
  instrumentos: string[];
  modoLote: 'fixo' | 'risco';
  loteFixo: number;
  riscoPct: number;
  maxOrdensAbertas: number;
  perdaDiariaPct: number;
  perdaTotalPct: number;
  contaCtrader: number | null;
}

interface OrdemRegistada {
  id: number;
  simbolo: string;
  estrategia: string | null;
  lado: string | null;
  lotes: number | null;
  resultado: string;
  motivo: string | null;
  criado_em: string;
}

interface ContaCtrader {
  id: number;
  login: number | null;
  real: boolean;
}

const INSTRUMENTOS = [...new Set(ESTRATEGIAS_ACTIVAS.flatMap((e) => e.instrumentos))].sort();

export function PainelAutomacao() {
  const [d, setD] = useState<Definicoes | null>(null);
  const [motorAutorizado, setMotorAutorizado] = useState(false);
  const [ligadoAMim, setLigadoAMim] = useState(false);
  const [contas, setContas] = useState<ContaCtrader[]>([]);
  const [registo, setRegisto] = useState<OrdemRegistada[]>([]);
  const [estado, setEstado] = useState<'a-ler' | 'pronto' | 'a-gravar' | 'gravado' | 'erro'>('a-ler');
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch('/api/automacao', { cache: 'no-store' });
      const j = (await r.json()) as {
        definicoes?: Definicoes;
        motorAutorizado?: boolean;
        motorLigadoAEsteUtilizador?: boolean;
        erro?: string;
      };
      if (!r.ok || !j.definicoes) throw new Error(j.erro ?? 'Não foi possível ler a automação.');
      setD(j.definicoes);
      setMotorAutorizado(j.motorAutorizado === true);
      setLigadoAMim(j.motorLigadoAEsteUtilizador === true);
      setEstado('pronto');
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setEstado('erro');
    }
    try {
      const r = await fetch('/api/ctrader/estado', { cache: 'no-store' });
      const j = (await r.json()) as { contas?: ContaCtrader[] };
      setContas(j.contas ?? []);
    } catch {
      /* sem cTrader ligada: o painel continua a funcionar */
    }
    try {
      const r = await fetch('/api/automacao/registo', { cache: 'no-store' });
      const j = (await r.json()) as { ordens?: OrdemRegistada[] };
      setRegisto(j.ordens ?? []);
    } catch {
      /* o registo é informativo */
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const mudar = (parcial: Partial<Definicoes>) => setD((x) => (x ? { ...x, ...parcial } : x));

  const guardar = async () => {
    if (!d) return;
    setEstado('a-gravar');
    setErro(null);
    try {
      const r = await fetch('/api/automacao', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(d),
      });
      const j = (await r.json()) as { erro?: string };
      if (!r.ok) throw new Error(j.erro ?? 'Não gravou.');
      setEstado('gravado');
      setTimeout(() => setEstado('pronto'), 2000);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setEstado('erro');
    }
  };

  const autorizarMotor = async () => {
    setErro(null);
    try {
      const r = await fetch('/api/automacao/motor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmacao: 'sim' }),
      });
      const j = (await r.json()) as { erro?: string; autorizado?: boolean };
      if (!r.ok) throw new Error(j.erro ?? 'Não autorizou.');
      setMotorAutorizado(j.autorizado === true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  };

  const retirarMotor = async () => {
    setErro(null);
    try {
      await fetch('/api/automacao/motor', { method: 'DELETE' });
      setMotorAutorizado(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  };

  if (estado === 'a-ler') return <p className="dim">A ler a automação…</p>;
  if (!d) return <p className="nt-erro">{erro ?? 'Automação indisponível.'}</p>;

  const contaEscolhida = contas.find((c) => c.id === d.contaCtrader) ?? null;
  const emTesteEscolhidas = d.estrategias.filter((id) => estrategiaEmTeste(id) !== undefined);
  const aFaltar: string[] = [];
  if (!d.activa) aFaltar.push('a automação está desligada');
  if (!motorAutorizado) aFaltar.push('o motor não está autorizado na cTrader');
  if (!ligadoAMim) aFaltar.push('o servidor não tem AUTOMACAO_UTILIZADOR_ID com a sua conta');
  if (d.estrategias.length === 0) aFaltar.push('nenhuma estratégia escolhida');
  if (d.instrumentos.length === 0) aFaltar.push('nenhum instrumento escolhido');
  if (d.contaCtrader === null) aFaltar.push('nenhuma conta cTrader escolhida');
  if (contaEscolhida?.real && !d.contaRealPermitida) aFaltar.push('a conta é real e não há autorização para conta real');

  return (
    <>
      <h2>Automação</h2>

      <div className={aFaltar.length === 0 ? 'nt-ok' : 'nt-aviso'} style={{ marginBottom: '16px' }}>
        {aFaltar.length === 0 ? (
          <>
            <strong>A automação está a funcionar.</strong> O motor envia ordens{' '}
            {contaEscolhida?.real ? 'na sua conta REAL' : 'na conta demo'} assim que um sinal das estratégias
            escolhidas aparecer nos instrumentos escolhidos.
          </>
        ) : (
          <>
            <strong>Não sai nenhuma ordem automática.</strong> Falta: {aFaltar.join('; ')}.
          </>
        )}
      </div>

      <div className="rows">
        <div>
          <span className="k">Estado da automação</span>
          <span className="v">
            <button
              type="button"
              className="switch"
              aria-checked={d.activa}
              role="switch"
              onClick={() => mudar({ activa: !d.activa })}
              aria-label={d.activa ? 'Desligar automação' : 'Ligar automação'}
            />
          </span>
        </div>

        <div>
          <span className="k">Conta cTrader</span>
          <span className="v">
            <select
              value={d.contaCtrader ?? ''}
              onChange={(e) => mudar({ contaCtrader: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">— escolher —</option>
              {contas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.real ? 'REAL' : 'demo'} · {c.login ?? c.id}
                </option>
              ))}
            </select>
          </span>
        </div>

        {contaEscolhida?.real ? (
          <div>
            <span className="k">Autorizo ordens automáticas na conta REAL</span>
            <span className="v">
              <button
                type="button"
                className="switch"
                role="switch"
                aria-checked={d.contaRealPermitida}
                onClick={() => mudar({ contaRealPermitida: !d.contaRealPermitida })}
                aria-label="Autorizar conta real"
              />
            </span>
          </div>
        ) : null}
      </div>

      <h3>Estratégias</h3>
      <p className="dim">
        As que aparecem sem percentagem não têm taxa de acerto medida. São as que dão mais sinais — e as que
        podem perder dinheiro sem aviso.
      </p>
      <div className="rows">
        {ESTRATEGIAS_ACTIVAS.map((e) => {
          const teste = estrategiaEmTeste(e.id) !== undefined;
          const ligada = d.estrategias.includes(e.id);
          return (
            <div key={e.id}>
              <span className="k">
                {e.nome} {teste ? <span className="selo-sem-taxa">sem taxa medida</span> : null}
              </span>
              <span className="v">
                <button
                  type="button"
                  className="switch"
                  role="switch"
                  aria-checked={ligada}
                  aria-label={e.nome}
                  onClick={() =>
                    mudar({
                      estrategias: ligada
                        ? d.estrategias.filter((x) => x !== e.id)
                        : [...d.estrategias, e.id],
                    })
                  }
                />
              </span>
            </div>
          );
        })}
      </div>

      <h3>Instrumentos</h3>
      <div className="fichas">
        {INSTRUMENTOS.map((s) => {
          const ligado = d.instrumentos.includes(s);
          return (
            <button
              key={s}
              type="button"
              className={`ficha${ligado ? ' ficha--on' : ''}`}
              aria-pressed={ligado}
              onClick={() =>
                mudar({ instrumentos: ligado ? d.instrumentos.filter((x) => x !== s) : [...d.instrumentos, s] })
              }
            >
              {s}
            </button>
          );
        })}
      </div>

      <h3>Tamanho e limites</h3>
      <div className="rows">
        <div>
          <span className="k">Tamanho da posição</span>
          <span className="v">
            <select value={d.modoLote} onChange={(e) => mudar({ modoLote: e.target.value as 'fixo' | 'risco' })}>
              <option value="fixo">Lote fixo</option>
              <option value="risco">% do saldo em risco</option>
            </select>
          </span>
        </div>
        {d.modoLote === 'fixo' ? (
          <div>
            <span className="k">Lote por ordem</span>
            <span className="v">
              <input
                inputMode="decimal"
                value={d.loteFixo}
                onChange={(e) => mudar({ loteFixo: Number(e.target.value.replace(',', '.')) || 0 })}
              />
            </span>
          </div>
        ) : (
          <div>
            <span className="k">Risco por operação (%)</span>
            <span className="v">
              <input
                inputMode="decimal"
                value={d.riscoPct}
                onChange={(e) => mudar({ riscoPct: Number(e.target.value.replace(',', '.')) || 0 })}
              />
            </span>
          </div>
        )}
        <div>
          <span className="k">Máximo de posições abertas</span>
          <span className="v">
            <input
              inputMode="numeric"
              value={d.maxOrdensAbertas}
              onChange={(e) => mudar({ maxOrdensAbertas: Number(e.target.value) || 1 })}
            />
          </span>
        </div>
        <div>
          <span className="k">Pára no dia ao perder (%)</span>
          <span className="v">
            <input
              inputMode="decimal"
              value={d.perdaDiariaPct}
              onChange={(e) => mudar({ perdaDiariaPct: Number(e.target.value.replace(',', '.')) || 0 })}
            />
          </span>
        </div>
        <div>
          <span className="k">Pára de vez ao perder (%)</span>
          <span className="v">
            <input
              inputMode="decimal"
              value={d.perdaTotalPct}
              onChange={(e) => mudar({ perdaTotalPct: Number(e.target.value.replace(',', '.')) || 0 })}
            />
          </span>
        </div>
      </div>

      {d.modoLote === 'risco' ? (
        <p className="dim">
          A conta do lote é feita na moeda em que o instrumento está cotado. Num par que não acabe na moeda da
          conta fica aproximada — o tecto por ordem (CTRADER_LIMITE_LOTES) é o travão.
        </p>
      ) : null}

      {emTesteEscolhidas.length > 0 && d.activa ? (
        <div className="nt-aviso" style={{ marginTop: '16px' }}>
          Escolheu {emTesteEscolhidas.length} estratégia(s) sem vantagem medida para automação
          {contaEscolhida?.real ? ' numa conta REAL' : ''}. Não têm vantagem medida: o resultado pode ser
          negativo e o robô não pára até atingir os limites acima.
        </div>
      ) : null}

      <h3>Autorização do motor</h3>
      <p className="dim">
        O motor corre sem browser, por isso precisa da sua própria cópia da ligação à cTrader — guardada cifrada
        no servidor. Retirar a autorização pára todas as ordens automáticas de imediato.
      </p>
      <div className="nt-acoes">
        {motorAutorizado ? (
          <button type="button" className="btn" onClick={() => void retirarMotor()}>
            Retirar autorização do motor
          </button>
        ) : (
          <button type="button" className="btn btn--principal" onClick={() => void autorizarMotor()}>
            Autorizar o motor a negociar
          </button>
        )}
        <button type="button" className="btn btn--principal" onClick={() => void guardar()}>
          {estado === 'a-gravar' ? 'A guardar…' : estado === 'gravado' ? 'Guardado' : 'Guardar definições'}
        </button>
      </div>

      {erro ? (
        <div className="nt-erro" style={{ marginTop: '16px' }}>
          {erro}
        </div>
      ) : null}

      {registo.length > 0 ? (
        <>
          <h3>O que o motor fez</h3>
          <div className="rows">
            {registo.slice(0, 12).map((o) => (
              <div key={o.id}>
                <span className="k">
                  {new Date(o.criado_em).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })} ·{' '}
                  {o.simbolo} {o.lado ?? ''}
                </span>
                <span className="v">
                  {o.resultado === 'enviada' ? `${o.lotes} lotes` : (o.motivo ?? o.resultado)}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
