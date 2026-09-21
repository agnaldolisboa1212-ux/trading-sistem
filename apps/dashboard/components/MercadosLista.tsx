'use client';

/**
 * Lista de mercados com procura e filtro por classe de ativo.
 *
 * PORQUÊ NO CLIENTE: são 17 instrumentos. Filtrar isto no servidor — por query
 * string, com um `router.push` a cada tecla — custaria uma ida ao servidor por
 * letra escrita para reordenar uma lista que já está toda no ecrã. A procura
 * tem de responder ao ritmo do teclado, e a única forma de garantir isso é não
 * sair da máquina.
 *
 * A página continua a ser um Server Component: é ela que lê o varrimento e
 * decide o que existe. Este componente só recebe dados já prontos e escolhe o
 * que mostrar — nenhuma regra de negócio atravessou a fronteira.
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Sparkline, formaDoProgresso } from './Sparkline';

export interface ItemMercado {
  symbol: string;
  name: string;
  assetClass: string;
  /** Progresso do checklist em 0..1, ou null se o símbolo não foi varrido. */
  score: number | null;
  modelo: string | null;
  fase: string | null;
  passo: number | null;
  smt: number;
}

const CLASSE_LABEL: Record<string, string> = {
  forex: 'Forex',
  index: 'Índices',
  metal: 'Metais',
  crypto: 'Cripto',
  commodity: 'Commodities',
};

const FASE_LABEL: Record<string, string> = {
  'original-consolidation': 'consolidação original',
  'left-curve': 'curva esquerda',
  'smart-money-reversal': 'Smart Money Reversal',
  'right-curve-low-risk-entry': 'curva direita · Low Risk Entry',
  'right-curve-stage-1': 'curva direita · 1ª Acc/Dist',
  'right-curve-silver-bullet': 'curva direita · Silver Bullet',
  completed: 'completo',
  invalidated: 'invalidado',
};

const PASSO_LABEL: Record<number, string> = {
  1: 'draw on liquidity',
  2: 'fluxo HTF',
  3: 'point of interest',
  4: 'Time & Price',
  5: 'SMT divergence',
  6: 'CISD / MSS',
  7: 'modelo de entrada',
  8: 'invalidação',
  9: 'alvos',
};

/**
 * Normaliza para comparação: minúsculas e sem acentos.
 *
 * Quem procura "indices" no telemóvel raramente escreve o acento, e uma procura
 * que falha por causa de um til passa por avariada.
 */
function chave(s: string): string {
  return s
    .normalize('NFD')
    // {M} = qualquer marca combinante; o `u` liga as propriedades Unicode.
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

/** Frase única que resume o estado do checklist — para `title` e leitor de ecrã. */
function resumo(item: ItemMercado): string {
  if (item.score === null) return `${item.symbol} — ${item.name}. Sem varrimento.`;
  const passo =
    item.passo === null
      ? 'checklist completo'
      : `parou no passo ${item.passo} de 9 (${PASSO_LABEL[item.passo] ?? '—'})`;
  return `${item.symbol} — ${item.name}. ${Math.round(item.score * 100)}% do checklist, ${passo}. ${item.smt} divergência(s) SMT.`;
}

export function MercadosLista({ itens }: { itens: ItemMercado[] }) {
  const [procura, setProcura] = useState('');
  const [classe, setClasse] = useState<string>('todas');

  // As classes vêm dos dados, não de uma lista fixa: acrescentar um
  // instrumento ao universo faz o filtro aparecer sozinho.
  const classes = useMemo(() => {
    const contagem = new Map<string, number>();
    for (const i of itens) contagem.set(i.assetClass, (contagem.get(i.assetClass) ?? 0) + 1);
    return [...contagem.entries()].map(([id, n]) => ({ id, n }));
  }, [itens]);

  const filtrados = useMemo(() => {
    const q = chave(procura.trim());
    return itens.filter((i) => {
      if (classe !== 'todas' && i.assetClass !== classe) return false;
      if (!q) return true;
      return chave(i.symbol).includes(q) || chave(i.name).includes(q);
    });
  }, [itens, procura, classe]);

  /*
   * Agrupar só faz sentido quando há mais do que uma classe à vista. Com um
   * filtro ativo o cabeçalho repetiria o que o chip já diz, e durante uma
   * procura os separadores partem uma lista curta em pedaços ainda mais curtos.
   */
  const agrupar = classe === 'todas' && procura.trim() === '';

  const grupos = useMemo(() => {
    if (!agrupar) return [{ id: '', itens: filtrados }];
    const mapa = new Map<string, ItemMercado[]>();
    for (const i of filtrados) mapa.set(i.assetClass, [...(mapa.get(i.assetClass) ?? []), i]);
    return [...mapa.entries()].map(([id, lista]) => ({ id, itens: lista }));
  }, [agrupar, filtrados]);

  return (
    <>
      <div className="busca" role="search">
        <span className="lupa" aria-hidden="true">
          ⌕
        </span>
        <input
          type="search"
          value={procura}
          onChange={(e) => setProcura(e.target.value)}
          placeholder="Procurar símbolo ou nome"
          aria-label="Procurar instrumento"
          autoComplete="off"
          // `off` porque o teclado do telemóvel a corrigir "eurusd" para uma
          // palavra do dicionário tornaria o campo inútil.
          autoCorrect="off"
          spellCheck={false}
        />
        {procura !== '' && (
          <button
            type="button"
            className="limpar"
            onClick={() => setProcura('')}
            aria-label="Limpar procura"
          >
            ✕
          </button>
        )}
      </div>

      <div className="filtros" role="group" aria-label="Filtrar por classe de ativo">
        <button
          type="button"
          className={`filtro ${classe === 'todas' ? 'on' : ''}`}
          onClick={() => setClasse('todas')}
          aria-pressed={classe === 'todas'}
        >
          Todos <em>{itens.length}</em>
        </button>
        {classes.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`filtro ${classe === c.id ? 'on' : ''}`}
            onClick={() => setClasse(c.id)}
            aria-pressed={classe === c.id}
          >
            {CLASSE_LABEL[c.id] ?? c.id} <em>{c.n}</em>
          </button>
        ))}
      </div>

      {filtrados.length === 0 ? (
        <div className="empty">
          <strong>Nada corresponde a “{procura}”.</strong>
          Procure pelo símbolo (EURUSD, NQ, XAUUSD) ou pelo nome do mercado.
          <div>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setProcura('');
                setClasse('todas');
              }}
            >
              Limpar filtros
            </button>
          </div>
        </div>
      ) : (
        grupos.map((g) => (
          <section key={g.id || 'todos'}>
            {agrupar && <h2>{CLASSE_LABEL[g.id] ?? g.id}</h2>}
            <div className="lista">
              {g.itens.map((i) => (
                <CartaoLinha key={i.symbol} item={i} />
              ))}
            </div>
          </section>
        ))
      )}

      {/* Contagem para quem usa leitor de ecrã: sem isto, filtrar não anuncia
          nada e a lista muda em silêncio. */}
      <p className="faint" aria-live="polite" style={{ fontSize: 12 }}>
        {filtrados.length} de {itens.length} instrumentos
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------

function IconeAtivo({ symbol, assetClass }: { symbol: string; assetClass: string }) {
  const base = symbol.slice(0, 3);
  
  if (symbol === 'XAGUSD' || base === 'XAG') {
    return (
      <svg viewBox="0 0 24 24" style={{ width: '24px', height: '24px' }}>
        <rect x="2" y="7" width="20" height="10" rx="2" fill="#cbd5e1" stroke="#94a3b8" strokeWidth="1" />
        <text x="12" y="14.5" fontSize="8" fill="#475569" textAnchor="middle" fontWeight="bold" fontFamily="sans-serif">PRATA</text>
      </svg>
    );
  }
  
  if (symbol === 'XAUUSD' || base === 'XAU') {
    return (
      <svg viewBox="0 0 24 24" style={{ width: '24px', height: '24px' }}>
        <rect x="2" y="7" width="20" height="10" rx="2" fill="#fde047" stroke="#eab308" strokeWidth="1" />
        <text x="12" y="14.5" fontSize="8" fill="#854d0e" textAnchor="middle" fontWeight="bold" fontFamily="sans-serif">OURO</text>
      </svg>
    );
  }

  if (base === 'BTC') {
    return (
      <svg viewBox="0 0 24 24" style={{ width: '24px', height: '24px' }}>
        <circle cx="12" cy="12" r="10" fill="#f59e0b" />
        <text x="12" y="16" fontSize="12" fill="#fff" textAnchor="middle" fontWeight="bold" fontFamily="sans-serif">₿</text>
      </svg>
    );
  }
  
  if (base === 'ETH') {
    return (
      <svg viewBox="0 0 24 24" style={{ width: '24px', height: '24px' }}>
        <circle cx="12" cy="12" r="10" fill="#627eea" />
        <text x="12" y="16" fontSize="12" fill="#fff" textAnchor="middle" fontWeight="bold" fontFamily="sans-serif">Ξ</text>
      </svg>
    );
  }

  if (base === 'SOL') {
    return (
      <svg viewBox="0 0 24 24" style={{ width: '24px', height: '24px' }}>
        <circle cx="12" cy="12" r="10" fill="#14F195" />
        <text x="12" y="16" fontSize="12" fill="#000" textAnchor="middle" fontWeight="bold" fontFamily="sans-serif">S</text>
      </svg>
    );
  }

  // Bandeiras (aproximações vetoriais)
  if (base === 'EUR') {
     return (
       <svg viewBox="0 0 24 24" style={{ width: '24px', height: '24px', borderRadius: '4px' }}>
         <rect width="24" height="24" fill="#1d4ed8" />
         <circle cx="12" cy="12" r="6" fill="none" stroke="#fde047" strokeWidth="2" strokeDasharray="2 3" />
       </svg>
     );
  }

  if (base === 'USD' || symbol === 'DXY') {
     return (
       <svg viewBox="0 0 24 24" style={{ width: '24px', height: '24px', borderRadius: '4px' }}>
         <rect width="24" height="24" fill="#fff" />
         <path d="M0 4h24M0 10h24M0 16h24M0 22h24" stroke="#ef4444" strokeWidth="2" />
         <rect x="0" y="0" width="12" height="12" fill="#1e3a8a" />
         <circle cx="6" cy="6" r="2" fill="#fff" />
       </svg>
     );
  }

  if (base === 'GBP') {
     return (
       <svg viewBox="0 0 24 24" style={{ width: '24px', height: '24px', borderRadius: '4px' }}>
         <rect width="24" height="24" fill="#1e3a8a" />
         <path d="M0 0l24 24M0 24L24 0" stroke="#fff" strokeWidth="3" />
         <path d="M12 0v24M0 12h24" stroke="#fff" strokeWidth="6" />
         <path d="M12 0v24M0 12h24" stroke="#ef4444" strokeWidth="4" />
       </svg>
     );
  }
  
  if (base === 'JPY' || symbol.endsWith('JPY')) {
     return (
       <svg viewBox="0 0 24 24" style={{ width: '24px', height: '24px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
         <rect width="24" height="24" fill="#fff" />
         <circle cx="12" cy="12" r="6" fill="#ef4444" />
       </svg>
     );
  }

  if (base === 'AUD') {
     return (
       <svg viewBox="0 0 24 24" style={{ width: '24px', height: '24px', borderRadius: '4px' }}>
         <rect width="24" height="24" fill="#1e3a8a" />
         <path d="M0 0l12 12M0 12l12-12" stroke="#fff" strokeWidth="1.5" />
         <path d="M6 0v12M0 6h12" stroke="#fff" strokeWidth="3" />
         <path d="M6 0v12M0 6h12" stroke="#ef4444" strokeWidth="2" />
         <circle cx="18" cy="18" r="2" fill="#fff" />
         <circle cx="16" cy="6" r="3" fill="#fff" />
       </svg>
     );
  }

  if (base === 'NZD') {
     return (
       <svg viewBox="0 0 24 24" style={{ width: '24px', height: '24px', borderRadius: '4px' }}>
         <rect width="24" height="24" fill="#1e3a8a" />
         <path d="M0 0l12 12M0 12l12-12" stroke="#fff" strokeWidth="1.5" />
         <path d="M6 0v12M0 6h12" stroke="#fff" strokeWidth="3" />
         <path d="M6 0v12M0 6h12" stroke="#ef4444" strokeWidth="2" />
         <circle cx="18" cy="18" r="2" fill="#ef4444" stroke="#fff" strokeWidth="1" />
       </svg>
     );
  }

  if (base === 'CAD' || symbol.endsWith('CAD')) {
     return (
       <svg viewBox="0 0 24 24" style={{ width: '24px', height: '24px', borderRadius: '4px' }}>
         <rect width="24" height="24" fill="#ef4444" />
         <rect x="6" y="0" width="12" height="24" fill="#fff" />
         <path d="M12 4l3 6h2l-2 4h1l-4 6-4-6h1l-2-4h2z" fill="#ef4444" />
       </svg>
     );
  }

  if (base === 'CHF' || symbol.endsWith('CHF')) {
     return (
       <svg viewBox="0 0 24 24" style={{ width: '24px', height: '24px', borderRadius: '4px' }}>
         <rect width="24" height="24" fill="#ef4444" />
         <path d="M12 4v16M4 12h16" stroke="#fff" strokeWidth="4" />
       </svg>
     );
  }

  if (assetClass === 'index') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '24px', height: '24px', color: '#6366f1' }}>
        <path d="M3 3v18h18" />
        <path d="M18 9l-5 5-4-4-6 6" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" style={{ width: '24px', height: '24px', borderRadius: '4px' }}>
      <rect width="24" height="24" fill="#e2e8f0" />
      <text x="12" y="16" fontSize="10" fill="#475569" textAnchor="middle" fontWeight="bold" fontFamily="sans-serif">{symbol.slice(0, 2)}</text>
    </svg>
  );
}

// ---------------------------------------------------------------------------

function CartaoLinha({ item }: { item: ItemMercado }) {
  const varrido = item.score !== null;
  const pct = Math.round((item.score ?? 0) * 100);
  const alta = item.modelo === 'MMBM';

  return (
    /*
     * O cartão mostra o essencial e o `aria-label` carrega o resto. Um leitor
     * de ecrã anunciaria "EURUSD, curva direita, 30%, MMBM" — três fragmentos
     * sem ligação entre si; a frase completa diz o que eles significam sem
     * ocupar um pixel do ecrã.
     */
    <Link
      href={`/instrumento/${item.symbol}`}
      className="asset asset--linha"
      title={resumo(item)}
      aria-label={resumo(item)}
    >
      <span className="asset__logo" aria-hidden="true" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <IconeAtivo symbol={item.symbol} assetClass={item.assetClass} />
      </span>

      <span className="asset__id">
        <span className="asset__name" style={{ display: 'block' }}>
          {item.symbol}
        </span>
        <span className="asset__sub" style={{ display: 'block' }}>
          {varrido ? (FASE_LABEL[item.fase ?? ''] ?? item.fase ?? item.name) : item.name}
        </span>
      </span>

      <span className="asset__valores">
        <span className="asset__price" style={{ display: 'block' }}>
          {varrido ? `${pct}%` : '—'}
        </span>
        <span
          className={`asset__meta ${varrido ? (alta ? 'bull-t' : 'bear-t') : ''}`}
          style={{ display: 'block' }}
        >
          {varrido ? (item.modelo ?? '—') : 'por varrer'}
        </span>
      </span>

      <span className="asset__spark">
        {varrido ? (
          <Sparkline
            values={formaDoProgresso(item.score ?? 0, alta)}
            /* Verde/vermelho porque a forma diz a direção do MODELO — alta ou
               baixa — e isso é dado de mercado, não decoração de interface. */
            color={alta ? 'var(--bull)' : 'var(--bear)'}
          />
        ) : (
          /* Sem varrimento não há forma nenhuma a desenhar: uma linha reta
             seria uma afirmação falsa sobre um instrumento que ninguém mediu. */
          <span className="asset__meta" aria-hidden="true">
            ·
          </span>
        )}
      </span>
    </Link>
  );
}
