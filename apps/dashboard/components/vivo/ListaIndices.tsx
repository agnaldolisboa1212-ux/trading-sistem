'use client';

/**
 * Lista de instrumentos com preço ao vivo e mini-gráfico.
 *
 * Usada no Portfólio (índices mundiais) e nos Mercados (tudo). Cada linha
 * carrega 40 velas para desenhar a curva e subscreve os ticks para o preço.
 *
 * ── SÓ O QUE ESTÁ VISÍVEL SUBSCREVE ────────────────────────────────────────
 *
 * Com 40+ instrumentos, subscrever todos ao montar seria pedir à Deriv 40
 * fluxos que ninguém está a ver. Um `IntersectionObserver` liga o fluxo quando
 * a linha entra no ecrã e desliga-o quando sai — o mesmo que as apps de bolsa
 * fazem, e a diferença nota-se na bateria.
 */

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { acharSimbolo, formatarPreco, type SimboloDeriv } from '@/lib/deriv/simbolos';
import { usarPreco, usarVelas, variacao } from './usarPreco';
import { rotuloHorario, usarHorario } from '@/lib/deriv/horarios';
import { Variacao } from './Preco';
import { IconeAtivo } from './IconeAtivo';

export function ListaIndices({
  simbolos,
  href = (c: string) => `/instrumento/${c}`,
  aoTocar,
  activo,
}: {
  simbolos: readonly SimboloDeriv[];
  href?: (codigo: string) => string;
  /**
   * Quando presente, a linha passa a ser um botão em vez de um link.
   *
   * É o que o selector do terminal precisa: escolher um mercado ali não deve
   * navegar — desmontaria o gráfico e o painel de ordem que estão por baixo da
   * folha.
   */
  aoTocar?: (codigo: string) => void;
  /** Código atualmente aberto, marcado com um visto. */
  activo?: string;
}) {
  return (
    <div className="grupo__caixa">
      {simbolos.map((s) => (
        <LinhaIndice
          key={s.codigo}
          s={s}
          href={href(s.codigo)}
          aoTocar={aoTocar}
          activo={activo === s.codigo}
        />
      ))}
    </div>
  );
}

function LinhaIndice({
  s,
  href,
  aoTocar,
  activo,
}: {
  s: SimboloDeriv;
  href: string;
  aoTocar?: (codigo: string) => void;
  activo: boolean;
}) {
  const alvo = useRef<HTMLElement | null>(null);

  /*
   * Começa LIGADO, e é o observador que desliga o que está fora do ecrã.
   *
   * O contrário — começar desligado à espera do observador — parecia mais
   * económico e tinha um modo de falha silencioso e total: se o
   * `IntersectionObserver` não emitir (aconteceu num contexto de renderização
   * fora do ecrã, com o elemento a 235px do topo de uma janela de 812px), NADA
   * subscrevia e a lista inteira ficava a mostrar travessões, sem erro nenhum.
   *
   * Nesta ordem, a falha do observador degrada para "carrega tudo", que é lento
   * mas correto. A poupança mantém-se: em listas longas o observador desliga as
   * linhas fora de vista logo no primeiro ciclo.
   */
  const [visivel, setVisivel] = useState(true);

  useEffect(() => {
    const el = alvo.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;

    const obs = new IntersectionObserver(
      (entradas) => {
        const e = entradas[entradas.length - 1];
        if (e) setVisivel(e.isIntersecting);
      },
      // 240px de margem: começa a carregar bem antes de aparecer, para a linha
      // nunca surgir vazia debaixo do polegar a rolar.
      { rootMargin: '240px 0px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const classe = `indice ${activo ? 'indice--activo' : ''}`;

  if (aoTocar) {
    return (
      <button
        ref={alvo as React.RefObject<HTMLButtonElement>}
        type="button"
        className={classe}
        onClick={() => aoTocar(s.codigo)}
        aria-current={activo ? 'true' : undefined}
      >
        <Conteudo s={s} activo={visivel} />
      </button>
    );
  }

  return (
    <Link ref={alvo as React.RefObject<HTMLAnchorElement>} href={href} className={classe}>
      <Conteudo s={s} activo={visivel} />
    </Link>
  );
}



function Conteudo({ s, activo }: { s: SimboloDeriv; activo: boolean }) {
  const p = usarPreco(s.codigo, activo);
  const v = usarVelas(s.codigo, '1d', 40, activo);
  const horario = usarHorario(s.codigo, activo);

  const valor = p.preco ?? v.actual?.c ?? null;
  const pct = variacao(v.velas, valor);
  /*
   * O horário da Deriv manda; a heurística só vale enquanto ele não chega.
   *
   * A heurística sozinha ("há velas mas não há tick") acerta no facto e falha
   * na mensagem: não sabe dizer quando reabre, e "fechado" sem mais nada, a
   * meio da semana, lê-se como avaria.
   */
  const fechado = horario ? !horario.aberto : v.pronto && v.velas.length > 0 && !s.continuo && p.preco === null;
  const quandoAbre = rotuloHorario(horario);

  return (
    <>
      <span className="indice__marca" aria-hidden="true" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <IconeAtivo symbol={s.codigo} assetClass={s.classe} />
      </span>

      <span className="indice__id">
        <span className="indice__nome">{s.codigo}</span>
        <span className="indice__sub">{s.nome}</span>
      </span>

      <span className="indice__grafico" aria-hidden="true">
        <MiniCurva valores={v.velas.map((c) => c.c)} sobe={(pct ?? 0) >= 0} />
      </span>

      <span className="indice__lado">
        <span
          key={p.geracao}
          className={`indice__valor ${p.direccao ? `preco--${p.direccao}` : ''}`}
        >
          {valor === null ? '—' : formatarPreco(valor, s.casas)}
        </span>
        {fechado ? (
          <span className="fechado" title="Horário da própria Deriv">
            {quandoAbre ?? 'fechado'}
          </span>
        ) : (
          <Variacao pct={pct} />
        )}
      </span>
    </>
  );
}

/**
 * Curva minúscula.
 *
 * SVG e não canvas: são 40 pontos que mudam uma vez por minuto, não 300 que
 * mudam por segundo. Um `<path>` é mais barato do que um contexto 2D por linha.
 */
function MiniCurva({ valores, sobe }: { valores: number[]; sobe: boolean }) {
  if (valores.length < 2) return <svg viewBox="0 0 62 30" width="62" height="30" />;

  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const amplitude = max - min || 1;
  const passo = 62 / (valores.length - 1);

  const d = valores
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * passo).toFixed(1)},${(28 - ((v - min) / amplitude) * 26).toFixed(1)}`)
    .join(' ');

  return (
    <svg viewBox="0 0 62 30" width="62" height="30" preserveAspectRatio="none">
      <path
        d={d}
        fill="none"
        stroke={sobe ? 'var(--bull)' : 'var(--bear)'}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
