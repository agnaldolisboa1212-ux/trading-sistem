'use client';

/**
 * Fita de preços — a tira horizontal que rola no topo do Início.
 *
 * Cada cartão subscreve o seu próprio fluxo de ticks. Parece caro e não é: o
 * cliente em `lib/deriv/live.ts` multiplexa tudo numa única ligação, por isso
 * dez cartões são dez subscrições no mesmo socket, não dez sockets.
 *
 * A variação percentual precisa de uma referência, e a referência escolhida é
 * a **abertura da vela diária**. As alternativas eram piores:
 *
 *   · fecho do dia anterior — ao fim de semana compara contra sexta-feira e a
 *     percentagem fica congelada durante dois dias sem o dizer;
 *   · primeiro tick da sessão do browser — mudaria consoante a hora a que a
 *     pessoa abriu a app, o que torna o número incomparável entre pessoas.
 */

import Link from 'next/link';
import { usarPreco, usarVelas, variacao } from './usarPreco';
import { Variacao } from './Preco';
import { acharSimbolo, formatarPreco } from '@/lib/deriv/simbolos';
import { rotuloHorario, usarHorario } from '@/lib/deriv/horarios';

export function Fita({ simbolos }: { simbolos: string[] }) {
  return (
    <div className="fita" role="list" aria-label="Preços ao vivo">
      {simbolos.map((s) => (
        <CartaoTicker key={s} codigo={s} />
      ))}
    </div>
  );
}

function CartaoTicker({ codigo }: { codigo: string }) {
  const s = acharSimbolo(codigo);
  const p = usarPreco(codigo);
  // Duas velas diárias chegam para ter a abertura de hoje.
  const v = usarVelas(codigo, '1d', 2);
  const horario = usarHorario(codigo);

  if (!s) return null;

  const pct = variacao(v.velas, p.preco ?? v.actual?.c ?? null);
  const valor = p.preco ?? v.actual?.c ?? null;

  return (
    <Link href={`/instrumento/${codigo}`} className="ticker" role="listitem">
      <div className="ticker__nome">
        {codigo}
        {(horario ? !horario.aberto : !s.continuo && !p.preco && v.pronto) && (
          <span className="fechado">{rotuloHorario(horario) ?? 'fech.'}</span>
        )}
      </div>
      <div
        key={p.geracao}
        className={`ticker__preco ${p.direccao ? `preco--${p.direccao}` : ''}`}
      >
        {valor === null ? '—' : formatarPreco(valor, s.casas)}
      </div>
      <Variacao pct={pct} tamanho={11.5} />
    </Link>
  );
}
