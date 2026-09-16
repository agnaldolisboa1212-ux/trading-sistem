'use client';

/**
 * Painel de compra e venda.
 *
 * ── O DESENHO, E PORQUÊ ────────────────────────────────────────────────────
 *
 * Duas etapas, sempre, mesmo na conta demo:
 *
 *   1. escolher lado, montante e duração  ->  pedir preço
 *   2. ver o que a corretora respondeu    ->  confirmar
 *
 * Um botão único de "COMPRAR" seria mais rápido e é o que várias apps fazem.
 * Não é o que está aqui, por duas razões concretas:
 *
 *   · o pagamento de um contrato não é calculável localmente — vem da Deriv, e
 *     um botão que executa antes de o mostrar está a pedir a alguém que aceite
 *     um preço que ainda não viu;
 *   · o `precoMaximo` enviado na ordem é o preço da proposta. Se o mercado se
 *     mexer entre as duas etapas, a Deriv rejeita em vez de executar mais caro.
 *     Sem a etapa da proposta não há tecto nenhum para enviar.
 *
 * ── NADA DISTO CORRE SOZINHO ───────────────────────────────────────────────
 *
 * As rotas `/api/deriv/proposta` e `/api/deriv/ordem` só têm um chamador em
 * todo o repositório: este ficheiro, a partir de um `onClick`. O motor de
 * sinais não executa; notifica.
 */

import { apiFetch } from '@/lib/api';
import { useState } from 'react';
import { acharSimbolo, formatarPreco } from '@/lib/deriv/simbolos';
import { actualizarConta, usarConta } from './usarConta';
import { usarPreco } from './usarPreco';

interface Proposta {
  id: string;
  pedeMontante: number;
  pagamento: number;
  lucro: number;
  percentagem: number;
  descricao: string;
  pontoDeEntrada: number;
}

const DURACOES = [
  { valor: 5, unidade: 'm' as const, rotulo: '5 min' },
  { valor: 15, unidade: 'm' as const, rotulo: '15 min' },
  { valor: 1, unidade: 'h' as const, rotulo: '1 hora' },
  { valor: 4, unidade: 'h' as const, rotulo: '4 horas' },
  { valor: 1, unidade: 'd' as const, rotulo: '1 dia' },
];

export function Negociar({
  codigo,
  montanteInicial = 10,
}: {
  codigo: string;
  montanteInicial?: number;
}) {
  const conta = usarConta();
  const s = acharSimbolo(codigo);
  const preco = usarPreco(codigo);

  const [montante, setMontante] = useState(montanteInicial);
  const [duracao, setDuracao] = useState(0);
  const [lado, setLado] = useState<'compra' | 'venda' | null>(null);
  const [proposta, setProposta] = useState<Proposta | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aceito, setAceito] = useState(false);
  const [feito, setFeito] = useState<{ id: number; descricao: string } | null>(null);

  if (!s) return null;

  if (!conta.ligada) {
    return (
      <div className="empty">
        <strong>Sem conta ligada.</strong>
        Para negociar a partir daqui é preciso ligar a conta Deriv nas definições.
      </div>
    );
  }

  const d = DURACOES[duracao]!;

  const pedirPreco = async (qual: 'compra' | 'venda') => {
    setErro(null);
    setOcupado(true);
    setLado(qual);
    try {
      const r = await apiFetch('/api/deriv/proposta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          simbolo: codigo,
          direccao: qual,
          montante,
          duracao: d.valor,
          unidade: d.unidade,
        }),
      });
      const j = (await r.json()) as { ok?: boolean; proposta?: Proposta; erro?: string };
      if (!j.ok || !j.proposta) {
        setErro(j.erro ?? 'A corretora não deu preço.');
        setLado(null);
        return;
      }
      setProposta(j.proposta);
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
      setLado(null);
    } finally {
      setOcupado(false);
    }
  };

  const confirmar = async () => {
    if (!proposta) return;
    setErro(null);
    setOcupado(true);
    try {
      const r = await apiFetch('/api/deriv/ordem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propostaId: proposta.id,
          precoMaximo: proposta.pedeMontante,
          confirmacao: 'sim',
          aceitoRisco: conta.tipo === 'real' ? aceito : true,
        }),
      });
      const j = (await r.json()) as {
        ok?: boolean;
        erro?: string;
        ordem?: { contract_id: number; descricao: string };
      };
      if (!j.ok || !j.ordem) {
        setErro(j.erro ?? 'A ordem não foi aceite.');
        return;
      }
      setFeito({ id: j.ordem.contract_id, descricao: j.ordem.descricao });
      setProposta(null);
      setLado(null);
      setAceito(false);
      await actualizarConta();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setOcupado(false);
    }
  };

  const fechar = () => {
    setProposta(null);
    setLado(null);
    setErro(null);
    setAceito(false);
  };

  return (
    <div className="negociar-caixa">
      <div className="negociar-caixa__campos">
        <label className="campo">
          <span>Montante ({conta.moeda})</span>
          <input
            type="number"
            inputMode="decimal"
            min={1}
            step={1}
            value={montante}
            onChange={(e) => setMontante(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>

        <label className="campo">
          <span>Duração</span>
          <select value={duracao} onChange={(e) => setDuracao(Number(e.target.value))}>
            {DURACOES.map((x, i) => (
              <option key={x.rotulo} value={i}>
                {x.rotulo}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="negociar">
        <button
          type="button"
          className="btn-lado venda"
          onClick={() => void pedirPreco('venda')}
          disabled={ocupado}
        >
          VENDER
          <small>{preco.venda !== null ? formatarPreco(preco.venda, s.casas) : '—'}</small>
        </button>
        <button
          type="button"
          className="btn-lado compra"
          onClick={() => void pedirPreco('compra')}
          disabled={ocupado}
        >
          COMPRAR
          <small>{preco.compra !== null ? formatarPreco(preco.compra, s.casas) : '—'}</small>
        </button>
      </div>

      <p className="ob__ajuda" style={{ marginTop: 10, marginBottom: 0 }}>
        {conta.tipo === 'real'
          ? 'Conta REAL — cada ordem usa dinheiro seu.'
          : 'Conta DEMO — nenhuma ordem usa dinheiro real.'}{' '}
        O preço vem da Deriv antes de confirmar.
      </p>

      {erro && !proposta && <div className="ob__erro">{erro}</div>}

      {feito && (
        <div className="notice" role="status">
          <strong>Ordem executada.</strong> Contrato #{feito.id}. {feito.descricao}
          <div>
            <button type="button" className="btn ghost" onClick={() => setFeito(null)}>
              fechar
            </button>
          </div>
        </div>
      )}

      {proposta && lado && (
        <FolhaConfirmar
          proposta={proposta}
          lado={lado}
          simbolo={codigo}
          moeda={conta.moeda}
          real={conta.tipo === 'real'}
          aceito={aceito}
          setAceito={setAceito}
          ocupado={ocupado}
          erro={erro}
          duracao={d.rotulo}
          casas={s.casas}
          aoConfirmar={() => void confirmar()}
          aoFechar={fechar}
        />
      )}
    </div>
  );
}

function FolhaConfirmar({
  proposta,
  lado,
  simbolo,
  moeda,
  real,
  aceito,
  setAceito,
  ocupado,
  erro,
  duracao,
  casas,
  aoConfirmar,
  aoFechar,
}: {
  proposta: Proposta;
  lado: 'compra' | 'venda';
  simbolo: string;
  moeda: string;
  real: boolean;
  aceito: boolean;
  setAceito: (v: boolean) => void;
  ocupado: boolean;
  erro: string | null;
  duracao: string;
  casas: number;
  aoConfirmar: () => void;
  aoFechar: () => void;
}) {
  return (
    <div
      className="folha-fundo"
      role="dialog"
      aria-modal="true"
      aria-label="Confirmar ordem"
      onClick={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <div className="folha">
        <div className="folha__puxador" />
        <h2>
          {lado === 'compra' ? 'Comprar' : 'Vender'} {simbolo}
        </h2>
        <p className="dim" style={{ marginTop: 0, fontSize: 13 }}>
          {proposta.descricao}
        </p>

        <div className="folha__kv">
          <span>Vai pagar</span>
          <strong>
            {proposta.pedeMontante.toFixed(2)} {moeda}
          </strong>
        </div>
        <div className="folha__kv">
          <span>Recebe se acertar</span>
          <strong className="bull-t">
            {proposta.pagamento.toFixed(2)} {moeda}
          </strong>
        </div>
        <div className="folha__kv">
          <span>Lucro possível</span>
          <strong className="bull-t">
            +{proposta.lucro.toFixed(2)} ({proposta.percentagem.toFixed(1)}%)
          </strong>
        </div>
        <div className="folha__kv">
          <span>Perde se falhar</span>
          <strong className="bear-t">
            −{proposta.pedeMontante.toFixed(2)} {moeda}
          </strong>
        </div>
        <div className="folha__kv">
          <span>Preço de entrada</span>
          <strong>{formatarPreco(proposta.pontoDeEntrada, casas)}</strong>
        </div>
        <div className="folha__kv">
          <span>Duração</span>
          <strong>{duracao}</strong>
        </div>

        {real && (
          <>
            <div className="perigo">
              <strong>Esta é a sua conta REAL.</strong> Se este contrato falhar, perde{' '}
              {proposta.pedeMontante.toFixed(2)} {moeda} de dinheiro seu. Não há como desfazer
              depois de confirmar.
            </div>
            <label className="caixa-aceite">
              <input
                type="checkbox"
                checked={aceito}
                onChange={(e) => setAceito(e.target.checked)}
              />
              <span>Percebi que estou a arriscar dinheiro real.</span>
            </label>
          </>
        )}

        {erro && <div className="ob__erro">{erro}</div>}

        <div className="ob__acoes">
          <button type="button" className="btn ghost" onClick={aoFechar} disabled={ocupado}>
            Cancelar
          </button>
          <button
            type="button"
            className={`btn ${lado === 'compra' ? 'primary' : 'perigo-btn'}`}
            onClick={aoConfirmar}
            disabled={ocupado || (real && !aceito)}
          >
            {ocupado ? 'a enviar…' : `Confirmar ${lado}`}
          </button>
        </div>
      </div>
    </div>
  );
}
