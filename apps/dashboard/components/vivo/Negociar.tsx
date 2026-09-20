'use client';

/**
 * Terminal de negociação — conta Deriv cTrader (CFD), ao estilo do MetaTrader.
 *
 *   bilhete     mercado, limite ou stop · volume em lotes · SL e TP em preço
 *               · colar a ordem de um sinal (entrada, stop, alvo)
 *   posições    lucro a mexer · alterar SL/TP · fechar tudo ou parte
 *   pendentes   alterar preço e SL/TP · cancelar
 *
 * ── NADA SAI SEM UM TOQUE ──────────────────────────────────────────────────
 *
 * Cada ordem, fecho ou cancelamento abre uma folha com o resumo e só é enviado
 * ao confirmar. Na conta real a folha exige também marcar que se percebe o
 * risco. O motor de sinais não chama nenhuma destas rotas.
 *
 * ── PREÇOS ─────────────────────────────────────────────────────────────────
 *
 * Os preços no ecrã vêm do fluxo público da Deriv. A ordem executa ao preço da
 * conta cTrader, que pode diferir ligeiramente — por isso o SL/TP de uma ordem
 * a mercado é acertado para os valores exactos logo depois de executar.
 */

import { useEffect, useMemo, useState } from 'react';
import { acharSimbolo, formatarPreco } from '@/lib/deriv/simbolos';
import { ordemDoSinal, validarOrdem, type Lado, type TipoOrdem } from '@/lib/ctrader/protocolo';
import {
  dinheiroConta,
  ligarCtrader,
  pedidoCtrader,
  usarCtrader,
  type OrdemPendenteCtrader,
  type PosicaoCtrader,
} from './usarCtrader';
import { usarPreco } from './usarPreco';
import { FolhaCalculadoraLote } from './CalculadoraLote';

/** O plano de um sinal, para colar no bilhete. */
export interface PlanoParaOrdem {
  direccao: 'bullish' | 'bearish';
  entrada: number;
  stop: number;
  alvos: Array<{ preco: number; r?: number }>;
  origem: string;
  id?: string;
}

interface InfoSimbolo {
  existe: boolean;
  nome?: string;
  casas?: number;
  lotesMinimo?: number;
  lotesPasso?: number;
  unidadesPorLote?: number;
}

const limpar = (s: string) => s.replace(/[^A-Z0-9]/gi, '').toUpperCase();

const num = (s: string): number | null => {
  const n = Number(s.replace(',', '.'));
  return s.trim() && Number.isFinite(n) && n > 0 ? n : null;
};

export function Negociar({ codigo, sinal }: { codigo: string; sinal?: PlanoParaOrdem | null }) {
  const c = usarCtrader();
  const s = acharSimbolo(codigo);
  const preco = usarPreco(codigo);
  const [info, setInfo] = useState<InfoSimbolo | null>(null);
  const [erroInfo, setErroInfo] = useState<string | null>(null);

  // O instrumento tal como existe na conta cTrader activa: nome, casas e volumes.
  useEffect(() => {
    if (!c.ligada || !c.conta) return;
    let vivo = true;
    setInfo(null);
    setErroInfo(null);
    void fetch(`/api/ctrader/simbolo?codigo=${encodeURIComponent(codigo)}`, { cache: 'no-store' })
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as InfoSimbolo & { erro?: string };
        if (!vivo) return;
        if (r.ok) setInfo(j);
        else setErroInfo(j.erro ?? `HTTP ${r.status}`);
      })
      .catch((e: unknown) => vivo && setErroInfo(e instanceof Error ? e.message : String(e)));
    return () => {
      vivo = false;
    };
  }, [codigo, c.ligada, c.conta?.id]);

  if (!s) return null;

  if (c.aCarregar) return <div className="brilho" style={{ height: 260, borderRadius: 20 }} />;

  if (!c.configurado) {
    return (
      <div className="empty">
        <strong>Negociação CFD ainda não disponível.</strong>
        O servidor ainda não tem a aplicação cTrader configurada.
      </div>
    );
  }

  if (!c.ligada) return <LigarConta erro={c.erro} />;

  return (
    <div className="negociar-ct">
      <BarraConta />
      {erroInfo && <div className="nt-erro">{erroInfo}</div>}
      <Bilhete
        codigo={codigo}
        info={info}
        casas={s.casas}
        precoCompra={preco.compra}
        precoVenda={preco.venda}
        sinal={sinal ?? null}
      />
      <Carteira codigo={codigo} simboloCtrader={info?.nome} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function LigarConta({ erro }: { erro: string | null }) {
  const [falha, setFalha] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  return (
    <div className="negociar-ct__ligar">
      <strong>Ligue a sua conta Deriv cTrader</strong>
      <p>
        Abre a página da cTrader, onde entra com o seu cTrader ID e autoriza esta app. A sua
        palavra-passe não passa por aqui. Comece por uma conta demo.
      </p>
      <button
        type="button"
        className="btn primary block"
        disabled={ocupado}
        onClick={async () => {
          setOcupado(true);
          const e = await ligarCtrader();
          if (e) {
            setFalha(e);
            setOcupado(false);
          }
        }}
      >
        {ocupado ? 'a abrir…' : 'Ligar conta cTrader'}
      </button>
      {(falha ?? erro) && <div className="nt-erro">{falha ?? erro}</div>}
    </div>
  );
}

function BarraConta() {
  const c = usarCtrader();
  const lucro = c.posicoes.reduce((t, p) => t + p.lucro, 0);
  return (
    <div className="negociar-ct__conta">
      <span className={`saldo-mini__selo ${c.conta?.real ? 'real' : 'demo'}`}>{c.conta?.real ? 'REAL' : 'DEMO'}</span>
      <span className="negociar-ct__login">#{c.conta?.login ?? c.conta?.id}</span>
      <span className="grow" />
      <span className="negociar-ct__valores">
        <span>
          saldo <b>{dinheiroConta(c.saldo, c.moeda)}</b>
        </span>
        <span>
          capital <b className={lucro > 0 ? 'bull-t' : lucro < 0 ? 'bear-t' : ''}>{dinheiroConta(c.capital, c.moeda)}</b>
        </span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bilhete de ordem
// ---------------------------------------------------------------------------

function Bilhete({
  codigo,
  info,
  casas,
  precoCompra,
  precoVenda,
  sinal,
}: {
  codigo: string;
  info: InfoSimbolo | null;
  casas: number;
  precoCompra: number | null;
  precoVenda: number | null;
  sinal: PlanoParaOrdem | null;
}) {
  const [tipo, setTipo] = useState<TipoOrdem>('mercado');
  const [lotes, setLotes] = useState('0.01');
  const [precoOrdem, setPrecoOrdem] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [alvoSinal, setAlvoSinal] = useState(0);
  const [confirmar, setConfirmar] = useState<Lado | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [mostrarCalc, setMostrarCalc] = useState(false);
  const c = usarCtrader();

  // Começa no volume mínimo do instrumento nesta conta.
  useEffect(() => {
    if (info?.lotesMinimo) setLotes(String(info.lotesMinimo));
  }, [info?.lotesMinimo]);

  const casasOrdem = info?.casas ?? casas;
  const meio = precoCompra !== null && precoVenda !== null ? (precoCompra + precoVenda) / 2 : (precoCompra ?? precoVenda);
  const passo = info?.lotesPasso && info.lotesPasso > 0 ? info.lotesPasso : 0.01;

  const colar = () => {
    if (!sinal) return;
    const o = ordemDoSinal({ ...sinal, precoActual: meio, alvo: alvoSinal });
    setTipo(o.tipo);
    setPrecoOrdem(o.preco !== null ? String(o.preco) : '');
    setStopLoss(String(o.stopLoss));
    setTakeProfit(o.takeProfit !== null ? String(o.takeProfit) : '');
    setAviso({
      ok: true,
      texto:
        o.tipo === 'mercado'
          ? 'Colado: o preço está na entrada do sinal, a ordem é a mercado.'
          : `Colado como ordem ${o.tipo} a ${formatarPreco(sinal.entrada, casasOrdem)}: o preço ainda não está na entrada do sinal, a ordem espera que ${o.tipo === 'limite' ? 'volte' : 'chegue'} lá.`,
    });
  };

  const problema = (lado: Lado) =>
    validarOrdem({
      lado,
      tipo,
      lotes: Number(lotes.replace(',', '.')),
      precoActual: lado === 'compra' ? precoCompra : precoVenda,
      preco: num(precoOrdem),
      stopLoss: num(stopLoss),
      takeProfit: num(takeProfit),
    });

  if (info && !info.existe) {
    return (
      <div className="empty">
        <strong>{codigo} não está disponível na sua conta cTrader.</strong>
        Escolha outro instrumento, ou confirme na Deriv se esta conta o negoceia.
      </div>
    );
  }

  const ajustarLotes = (sinalPasso: 1 | -1) => {
    const actual = Number(lotes.replace(',', '.')) || 0;
    const novo = Math.max(info?.lotesMinimo ?? passo, Math.round((actual + sinalPasso * passo) / passo) * passo);
    setLotes(String(Number(novo.toFixed(6))));
  };

  const entradaBase = tipo === 'mercado' ? meio : num(precoOrdem);
  const loteNum = Number(lotes.replace(',', '.'));
  const slNum = num(stopLoss);
  const tpNum = num(takeProfit);

  const riscoPrevisto = entradaBase !== null && slNum !== null && info?.unidadesPorLote ? Math.abs(entradaBase - slNum) * loteNum * info.unidadesPorLote : null;
  const ganhoPrevisto = entradaBase !== null && tpNum !== null && info?.unidadesPorLote ? Math.abs(tpNum - entradaBase) * loteNum * info.unidadesPorLote : null;

  return (
    <div className="bilhete">
      {sinal && (
        <div className="bilhete__sinal">
          <span className={`lado-pill ${sinal.direccao === 'bullish' ? 'compra' : 'venda'}`}>
            {sinal.direccao === 'bullish' ? 'COMPRA' : 'VENDA'}
          </span>
          <span className="grow">
            <b>{sinal.origem}</b>
            <em>
              entrada {formatarPreco(sinal.entrada, casasOrdem)} · stop {formatarPreco(sinal.stop, casasOrdem)}
            </em>
          </span>
          {sinal.alvos.length > 1 && (
            <select value={alvoSinal} onChange={(e) => setAlvoSinal(Number(e.target.value))} aria-label="Alvo a usar">
              {sinal.alvos.slice(0, 3).map((a, i) => (
                <option key={i} value={i}>
                  TP{i + 1}
                </option>
              ))}
            </select>
          )}
          <button type="button" className="btn primary" onClick={colar}>
            Colar
          </button>
        </div>
      )}

      <div className="segmentos" role="radiogroup" aria-label="Tipo de ordem">
        {(['mercado', 'limite', 'stop'] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tipo === t}
            onClick={() => {
              setTipo(t);
              if (t !== 'mercado' && !precoOrdem && meio !== null) setPrecoOrdem(meio.toFixed(casasOrdem));
            }}
          >
            {t === 'mercado' ? 'A mercado' : t === 'limite' ? 'Limite' : 'Stop'}
          </button>
        ))}
      </div>

      <div className="bilhete__campos">
        <div className="campo" role="group" aria-label="Volume em lotes">
          <span style={{ display: 'flex', justifyContent: 'space-between' }}>
            Volume (lotes)
            <button 
              type="button" 
              className="dim" 
              style={{ background: 'transparent', border: 'none', textDecoration: 'underline', fontSize: '11px', padding: 0 }}
              onClick={() => setMostrarCalc(true)}
            >
              Calculadora
            </button>
          </span>
          <span className="campo__passo">
            <button type="button" onClick={() => ajustarLotes(-1)} aria-label="Menos volume">
              −
            </button>
            <input inputMode="decimal" aria-label="Lotes" value={lotes} onChange={(e) => setLotes(e.target.value)} />
            <button type="button" onClick={() => ajustarLotes(1)} aria-label="Mais volume">
              +
            </button>
          </span>
        </div>
        {tipo !== 'mercado' && (
          <label className="campo">
            <span>Preço da ordem</span>
            <input inputMode="decimal" value={precoOrdem} onChange={(e) => setPrecoOrdem(e.target.value)} />
          </label>
        )}
        <label className="campo">
          <span style={{ display: 'flex', justifyContent: 'space-between' }}>
            Stop loss
            {riscoPrevisto !== null && <span className="bear-t">Risco: {dinheiroConta(riscoPrevisto, c.moeda)}</span>}
          </span>
          <input inputMode="decimal" placeholder="opcional" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} />
        </label>
        <label className="campo">
          <span style={{ display: 'flex', justifyContent: 'space-between' }}>
            Take profit
            {ganhoPrevisto !== null && <span className="bull-t">Lucro: {dinheiroConta(ganhoPrevisto, c.moeda)}</span>}
          </span>
          <input inputMode="decimal" placeholder="opcional" value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} />
        </label>
      </div>

      <div className="negociar">
        <button
          type="button"
          className="btn-lado venda"
          onClick={() => {
            setAviso(null);
            const p = problema('venda');
            if (p) setAviso({ ok: false, texto: p });
            else setConfirmar('venda');
          }}
        >
          VENDER
          <small>{precoVenda !== null ? formatarPreco(precoVenda, casasOrdem) : '—'}</small>
        </button>
        <button
          type="button"
          className="btn-lado compra"
          onClick={() => {
            setAviso(null);
            const p = problema('compra');
            if (p) setAviso({ ok: false, texto: p });
            else setConfirmar('compra');
          }}
        >
          COMPRAR
          <small>{precoCompra !== null ? formatarPreco(precoCompra, casasOrdem) : '—'}</small>
        </button>
      </div>

      {aviso && <div className={aviso.ok ? 'nt-ok' : 'nt-erro'}>{aviso.texto}</div>}

      {confirmar && (
        <FolhaOrdem
          codigo={codigo}
          lado={confirmar}
          tipo={tipo}
          lotes={Number(lotes.replace(',', '.'))}
          preco={num(precoOrdem)}
          stopLoss={num(stopLoss)}
          takeProfit={num(takeProfit)}
          precoReferencia={confirmar === 'compra' ? precoCompra : precoVenda}
          casas={casasOrdem}
          sinalId={sinal?.id ?? null}
          info={info}
          aoFechar={(texto) => {
            setConfirmar(null);
            if (texto) setAviso({ ok: true, texto });
          }}
        />
      )}

      {mostrarCalc && (
        <FolhaCalculadoraLote 
          saldoCtrader={c.saldo}
          precoEntrada={num(precoOrdem) || (meio ? Number(meio.toFixed(casasOrdem)) : null)}
          stopLoss={num(stopLoss)}
          aoFechar={() => setMostrarCalc(false)}
          aoCalcular={(novoLote) => {
            const arredondado = Math.max(info?.lotesMinimo ?? passo, Math.round(novoLote / passo) * passo);
            setLotes(String(Number(arredondado.toFixed(6))));
            setMostrarCalc(false);
          }}
        />
      )}
    </div>
  );
}

function FolhaOrdem(p: {
  codigo: string;
  lado: Lado;
  tipo: TipoOrdem;
  lotes: number;
  preco: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  precoReferencia: number | null;
  casas: number;
  sinalId: string | null;
  info: InfoSimbolo | null;
  aoFechar: (sucesso: string | null) => void;
}) {
  const c = usarCtrader();
  const real = c.conta?.real === true;
  const [aceito, setAceito] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fmt = (v: number | null) => (v === null ? '—' : formatarPreco(v, p.casas));
  const entrada = p.tipo === 'mercado' ? p.precoReferencia : p.preco;
  const risco = entrada !== null && p.stopLoss !== null ? Math.abs(entrada - p.stopLoss) : null;
  const ganho = entrada !== null && p.takeProfit !== null ? Math.abs(p.takeProfit - entrada) : null;

  const riscoDinheiro = risco !== null && p.info?.unidadesPorLote ? risco * p.lotes * p.info.unidadesPorLote : null;
  const ganhoDinheiro = ganho !== null && p.info?.unidadesPorLote ? ganho * p.lotes * p.info.unidadesPorLote : null;

  const enviar = async () => {
    setOcupado(true);
    setErro(null);
    const r = await pedidoCtrader('/api/ctrader/ordem', {
      codigo: p.codigo,
      lado: p.lado,
      tipo: p.tipo,
      lotes: p.lotes,
      preco: p.preco,
      stopLoss: p.stopLoss,
      takeProfit: p.takeProfit,
      precoReferencia: p.precoReferencia,
      confirmacao: 'sim',
      aceitoRisco: real ? aceito : true,
      sinalId: p.sinalId,
    });
    setOcupado(false);
    if (!r.ok) return setErro(r.erro);
    p.aoFechar(
      p.tipo === 'mercado'
        ? `Ordem executada: ${p.lado} ${Number(r.dados['lotes'] ?? p.lotes)} lotes de ${p.codigo}.`
        : `Ordem ${p.tipo} colocada a ${fmt(p.preco)}.`,
    );
  };

  return (
    <Folha titulo={`${p.lado === 'compra' ? 'Comprar' : 'Vender'} ${p.codigo}`} aoFechar={() => p.aoFechar(null)}>
      <Kv k="Tipo" v={p.tipo === 'mercado' ? 'a mercado' : `${p.tipo} a ${fmt(p.preco)}`} />
      <Kv k="Volume" v={`${p.lotes} lotes`} />
      <Kv k="Preço agora" v={fmt(p.precoReferencia)} />
      <Kv k="Stop loss" v={p.stopLoss ? `${fmt(p.stopLoss)}${riscoDinheiro ? ` · Risco de ${dinheiroConta(riscoDinheiro, c.moeda)}` : ''}` : 'sem stop'} tom={p.stopLoss ? 'bear' : undefined} />
      <Kv k="Take profit" v={p.takeProfit ? `${fmt(p.takeProfit)}${ganhoDinheiro ? ` · Lucro de ${dinheiroConta(ganhoDinheiro, c.moeda)}` : ''}` : 'sem alvo'} tom={p.takeProfit ? 'bull' : undefined} />
      <Kv k="Conta" v={`${real ? 'REAL' : 'DEMO'} · #${c.conta?.login ?? c.conta?.id}`} tom={real ? 'bear' : undefined} />
      {risco && ganho && (
        <div style={{ marginTop: 12, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
            <span className="bear-t">Risco: 1R</span>
            <span className="bull-t">Ganho: {(ganho / risco).toFixed(2)}R</span>
          </div>
          <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'var(--surface-3)' }}>
            <div style={{ width: `${(1 / (1 + ganho / risco)) * 100}%`, background: 'var(--bear)' }} />
            <div style={{ width: `${((ganho / risco) / (1 + ganho / risco)) * 100}%`, background: 'var(--bull)' }} />
          </div>
        </div>
      )}
      {!p.stopLoss && <div className="perigo">Sem stop loss a perda não tem limite definido.</div>}
      {real && (
        <>
          <div className="perigo">
            <strong>Conta REAL.</strong> Esta ordem usa dinheiro seu e não se desfaz depois de enviada.
          </div>
          <label className="caixa-aceite">
            <input type="checkbox" checked={aceito} onChange={(e) => setAceito(e.target.checked)} />
            <span>Percebi que estou a arriscar dinheiro real.</span>
          </label>
        </>
      )}
      {erro && <div className="nt-erro">{erro}</div>}
      <div className="nt-acoes">
        <button type="button" className="btn ghost" onClick={() => p.aoFechar(null)} disabled={ocupado}>
          Cancelar
        </button>
        <button
          type="button"
          className={`btn ${p.lado === 'compra' ? 'primary' : 'perigo-btn'}`}
          onClick={() => void enviar()}
          disabled={ocupado || (real && !aceito)}
        >
          {ocupado ? 'a enviar…' : `Confirmar ${p.lado}`}
        </button>
      </div>
    </Folha>
  );
}

// ---------------------------------------------------------------------------
// Posições e pendentes
// ---------------------------------------------------------------------------

export function Carteira({ codigo, simboloCtrader }: { codigo?: string; simboloCtrader?: string }) {
  const c = usarCtrader();
  const [aba, setAba] = useState<'posicoes' | 'pendentes'>('posicoes');
  const [soEste, setSoEste] = useState(Boolean(codigo));
  const [alterar, setAlterar] = useState<{ tipo: 'posicao'; p: PosicaoCtrader } | { tipo: 'pendente'; o: OrdemPendenteCtrader } | null>(null);
  const [fechar, setFechar] = useState<PosicaoCtrader | null>(null);
  const [cancelar, setCancelar] = useState<OrdemPendenteCtrader | null>(null);

  // O nome na cTrader (ex.: "Volatility 75 Index") manda; sem ele, compara com o código da app.
  const alvo = useMemo(() => limpar(simboloCtrader ?? codigo ?? ''), [simboloCtrader, codigo]);
  const deste = (simbolo: string) => !alvo || (simboloCtrader ? limpar(simbolo) === alvo : limpar(simbolo).includes(alvo));
  const posicoes = soEste ? c.posicoes.filter((p) => deste(p.simbolo)) : c.posicoes;
  const ordens = soEste ? c.ordens.filter((o) => deste(o.simbolo)) : c.ordens;

  return (
    <div className="carteira">
      <div className="carteira__topo">
        <div className="segmentos" role="tablist">
          <button type="button" aria-pressed={aba === 'posicoes'} onClick={() => setAba('posicoes')}>
            Posições ({c.posicoes.length})
          </button>
          <button type="button" aria-pressed={aba === 'pendentes'} onClick={() => setAba('pendentes')}>
            Pendentes ({c.ordens.length})
          </button>
        </div>
        {codigo && (
          <label className="carteira__filtro">
            <input type="checkbox" checked={soEste} onChange={(e) => setSoEste(e.target.checked)} />
            só {codigo}
          </label>
        )}
      </div>

      {aba === 'posicoes' ? (
        posicoes.length === 0 ? (
          <p className="carteira__vazio">Sem posições abertas{soEste ? ` em ${codigo}` : ''}.</p>
        ) : (
          <div className="metrics-grid" style={{ marginTop: 12 }}>
            {posicoes.map((p) => {
              const temSlTp = p.stopLoss !== null || p.takeProfit !== null;
              return (
                <div key={p.id} className="metric-card">
                  <div className="metric-card__header">
                    <span className="metric-card__title">
                      <span className={p.lado === 'compra' ? 'bull-t' : 'bear-t'}>{p.lado === 'compra' ? 'COMPRA' : 'VENDA'}</span>{' '}
                      {p.simbolo}
                    </span>
                    <span className={`pill ${p.lucro >= 0 ? 'bull' : 'bear'}`}>
                      {p.lucro >= 0 ? '+' : ''}{p.lucro.toFixed(2)}
                    </span>
                  </div>
                  <div className="metric-card__value" style={{ fontSize: 14 }}>
                    {p.lotes} lt a {p.precoEntrada !== null ? formatarPreco(p.precoEntrada, p.casas) : '—'}
                  </div>
                  
                  {temSlTp && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }} className="dim">
                        <span>SL {p.stopLoss !== null ? formatarPreco(p.stopLoss, p.casas) : '—'}</span>
                        <span>TP {p.takeProfit !== null ? formatarPreco(p.takeProfit, p.casas) : '—'}</span>
                      </div>
                      <div style={{ display: 'flex', height: 4, borderRadius: 2, overflow: 'hidden', background: 'var(--surface-3)' }}>
                        {p.stopLoss !== null && <div style={{ width: '50%', background: 'var(--bear)', opacity: 0.8 }} />}
                        {p.stopLoss === null && <div style={{ width: '50%' }} />}
                        {p.takeProfit !== null && <div style={{ width: '50%', background: 'var(--bull)', opacity: 0.8 }} />}
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                    <button type="button" className="btn ghost" style={{ flex: 1, padding: '6px 0' }} onClick={() => setAlterar({ tipo: 'posicao', p })}>
                      Modificar
                    </button>
                    <button type="button" className="btn perigo-btn" style={{ flex: 1, padding: '6px 0' }} onClick={() => setFechar(p)}>
                      Fechar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : ordens.length === 0 ? (
        <p className="carteira__vazio">Sem ordens pendentes{soEste ? ` em ${codigo}` : ''}.</p>
      ) : (
        <div className="metrics-grid" style={{ marginTop: 12 }}>
          {ordens.map((o) => (
            <div key={o.id} className="metric-card">
              <div className="metric-card__header">
                <span className="metric-card__title">
                  <span className={o.lado === 'compra' ? 'bull-t' : 'bear-t'}>
                    {o.lado === 'compra' ? 'COMPRA' : 'VENDA'} {o.tipo.toUpperCase()}
                  </span>{' '}
                  {o.simbolo}
                </span>
                <span className="pill dim">Pendente</span>
              </div>
              <div className="metric-card__value" style={{ fontSize: 14 }}>
                {o.lotes} lt a {o.preco !== null ? formatarPreco(o.preco, o.casas) : '—'}
              </div>
              
              {(o.stopLoss !== null || o.takeProfit !== null) && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }} className="dim">
                    <span>SL {o.stopLoss !== null ? formatarPreco(o.stopLoss, o.casas) : '—'}</span>
                    <span>TP {o.takeProfit !== null ? formatarPreco(o.takeProfit, o.casas) : '—'}</span>
                  </div>
                  <div style={{ display: 'flex', height: 4, borderRadius: 2, overflow: 'hidden', background: 'var(--surface-3)' }}>
                    {o.stopLoss !== null && <div style={{ width: '50%', background: 'var(--bear)', opacity: 0.8 }} />}
                    {o.stopLoss === null && <div style={{ width: '50%' }} />}
                    {o.takeProfit !== null && <div style={{ width: '50%', background: 'var(--bull)', opacity: 0.8 }} />}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button type="button" className="btn ghost" style={{ flex: 1, padding: '6px 0' }} onClick={() => setAlterar({ tipo: 'pendente', o })}>
                  Modificar
                </button>
                <button type="button" className="btn perigo-btn" style={{ flex: 1, padding: '6px 0' }} onClick={() => setCancelar(o)}>
                  Cancelar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {alterar && <FolhaAlterar alvo={alterar} aoFechar={() => setAlterar(null)} />}
      {fechar && <FolhaFechar p={fechar} aoFechar={() => setFechar(null)} />}
      {cancelar && <FolhaCancelar o={cancelar} aoFechar={() => setCancelar(null)} />}
    </div>
  );
}

function FolhaAlterar({
  alvo,
  aoFechar,
}: {
  alvo: { tipo: 'posicao'; p: PosicaoCtrader } | { tipo: 'pendente'; o: OrdemPendenteCtrader };
  aoFechar: () => void;
}) {
  const item = alvo.tipo === 'posicao' ? alvo.p : alvo.o;
  const [precoOrdem, setPrecoOrdem] = useState(alvo.tipo === 'pendente' && alvo.o.preco !== null ? String(alvo.o.preco) : '');
  const [sl, setSl] = useState(item.stopLoss !== null ? String(item.stopLoss) : '');
  const [tp, setTp] = useState(item.takeProfit !== null ? String(item.takeProfit) : '');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const guardar = async () => {
    setOcupado(true);
    setErro(null);
    const r =
      alvo.tipo === 'posicao'
        ? await pedidoCtrader('/api/ctrader/posicao', { accao: 'alterar', positionId: alvo.p.id, stopLoss: num(sl), takeProfit: num(tp) })
        : await pedidoCtrader('/api/ctrader/pendente', {
            accao: 'alterar',
            orderId: alvo.o.id,
            preco: num(precoOrdem),
            stopLoss: num(sl),
            takeProfit: num(tp),
          });
    setOcupado(false);
    if (r.ok) aoFechar();
    else setErro(r.erro);
  };

  return (
    <Folha titulo={`Modificar ${item.simbolo}`} aoFechar={aoFechar}>
      <div className="bilhete__campos">
        {alvo.tipo === 'pendente' && (
          <label className="campo">
            <span>Preço da ordem</span>
            <input inputMode="decimal" value={precoOrdem} onChange={(e) => setPrecoOrdem(e.target.value)} />
          </label>
        )}
        <label className="campo">
          <span>Stop loss</span>
          <input inputMode="decimal" value={sl} onChange={(e) => setSl(e.target.value)} />
        </label>
        <label className="campo">
          <span>Take profit</span>
          <input inputMode="decimal" value={tp} onChange={(e) => setTp(e.target.value)} />
        </label>
      </div>
      {erro && <div className="nt-erro">{erro}</div>}
      <div className="nt-acoes">
        <button type="button" className="btn ghost" onClick={aoFechar} disabled={ocupado}>
          Cancelar
        </button>
        <button type="button" className="btn primary" onClick={() => void guardar()} disabled={ocupado}>
          {ocupado ? 'a guardar…' : 'Guardar'}
        </button>
      </div>
    </Folha>
  );
}

function FolhaFechar({ p, aoFechar }: { p: PosicaoCtrader; aoFechar: () => void }) {
  const [lotes, setLotes] = useState(String(p.lotes));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const parcial = Number(lotes.replace(',', '.'));

  const enviar = async () => {
    setOcupado(true);
    setErro(null);
    const r = await pedidoCtrader('/api/ctrader/posicao', {
      accao: 'fechar',
      positionId: p.id,
      lotes: parcial > 0 && parcial < p.lotes ? parcial : null,
      confirmacao: 'sim',
    });
    setOcupado(false);
    if (r.ok) aoFechar();
    else setErro(r.erro);
  };

  return (
    <Folha titulo={`Fechar ${p.simbolo}`} aoFechar={aoFechar}>
      <Kv k="Posição" v={`${p.lado === 'compra' ? 'compra' : 'venda'} · ${p.lotes} lotes`} />
      <Kv k="Resultado agora" v={`${p.lucro >= 0 ? '+' : ''}${p.lucro.toFixed(2)}`} tom={p.lucro >= 0 ? 'bull' : 'bear'} />
      <label className="campo">
        <span>Lotes a fechar</span>
        <input inputMode="decimal" value={lotes} onChange={(e) => setLotes(e.target.value)} />
      </label>
      {erro && <div className="nt-erro">{erro}</div>}
      <div className="nt-acoes">
        <button type="button" className="btn ghost" onClick={aoFechar} disabled={ocupado}>
          Manter
        </button>
        <button type="button" className="btn perigo-btn" onClick={() => void enviar()} disabled={ocupado || !(parcial > 0)}>
          {ocupado ? 'a fechar…' : parcial > 0 && parcial < p.lotes ? `Fechar ${parcial} lotes` : 'Fechar tudo'}
        </button>
      </div>
    </Folha>
  );
}

function FolhaCancelar({ o, aoFechar }: { o: OrdemPendenteCtrader; aoFechar: () => void }) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  return (
    <Folha titulo={`Cancelar ordem ${o.simbolo}`} aoFechar={aoFechar}>
      <Kv k="Ordem" v={`${o.lado} ${o.tipo} · ${o.lotes} lotes a ${o.preco !== null ? formatarPreco(o.preco, o.casas) : '—'}`} />
      {erro && <div className="nt-erro">{erro}</div>}
      <div className="nt-acoes">
        <button type="button" className="btn ghost" onClick={aoFechar} disabled={ocupado}>
          Manter
        </button>
        <button
          type="button"
          className="btn perigo-btn"
          disabled={ocupado}
          onClick={async () => {
            setOcupado(true);
            const r = await pedidoCtrader('/api/ctrader/pendente', { accao: 'cancelar', orderId: o.id });
            setOcupado(false);
            if (r.ok) aoFechar();
            else setErro(r.erro);
          }}
        >
          {ocupado ? 'a cancelar…' : 'Cancelar ordem'}
        </button>
      </div>
    </Folha>
  );
}

// ---------------------------------------------------------------------------

function Folha({ titulo, aoFechar, children }: { titulo: string; aoFechar: () => void; children: React.ReactNode }) {
  return (
    <div
      className="folha-fundo"
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      onClick={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <div className="folha">
        <div className="folha__puxador" />
        <h2>{titulo}</h2>
        {children}
      </div>
    </div>
  );
}

function Kv({ k, v, tom }: { k: string; v: string; tom?: 'bull' | 'bear' }) {
  return (
    <div className="folha__kv">
      <span>{k}</span>
      <strong className={tom === 'bull' ? 'bull-t' : tom === 'bear' ? 'bear-t' : ''}>{v}</strong>
    </div>
  );
}
