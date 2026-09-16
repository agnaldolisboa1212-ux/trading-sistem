'use client';

/**
 * Navegacao inferior flutuante.
 *
 * Fica fixa ao fundo porque num telemovel o polegar chega ao fundo do ecra e
 * nao ao topo — e a razao pela qual as apps de trading a puseram aqui.
 *
 * Cinco destinos, que e o maximo antes de os alvos ficarem mais estreitos do
 * que os 44px que um dedo precisa. A ordem segue o percurso normal: ver o
 * estado -> procurar -> negociar -> acompanhar -> configurar.
 *
 * O item ATIVO ganha cor de acento e o rotulo aparece por baixo do icone, como
 * nos mockups. Um destaque fixo no meio indicaria uma seccao que nunca muda.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Item {
  href: string;
  label: string;
  icon: React.ReactNode;
  /** Prefixos que tambem acendem este item. */
  match?: string[];
}

/**
 * Icones em SVG e nao caracteres.
 *
 * Os simbolos tipograficos (⌂ ▤ ◑) dependem da fonte instalada: no Android
 * varios caem para um retangulo vazio, e o utilizador fica com uma barra de
 * quadrados. Um `path` desenha sempre igual em qualquer sistema.
 */
const ITENS: Item[] = [
  {
    href: '/',
    label: 'Inicio',
    icon: (
      <path d="M3 10.2 12 3l9 7.2V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
    ),
  },
  {
    href: '/mercados',
    label: 'Mercados',
    icon: (
      <path d="M4 19V9m5 10V5m5 14v-7m5 7V8" strokeWidth="2.2" fill="none" strokeLinecap="round" />
    ),
  },
  {
    href: '/grafico',
    label: 'Graficos',
    match: ['/grafico', '/instrumento'],
    icon: (
      <path
        d="M3 17.5 9 11l4 4 8-8.5"
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    href: '/portfolio',
    label: 'Portfolio',
    match: ['/portfolio', '/financeiro', '/conta'],
    icon: (
      <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    ),
  },
  {
    href: '/definicoes',
    label: 'Definicoes',
    match: ['/definicoes', '/perfil'],
    icon: (
      <>
        <circle cx="12" cy="12" r="3.2" fill="none" strokeWidth="2" />
        <path
          d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4l-1.6 1.6M7 17l-1.6 1.6M18.6 18.6 17 17M7 7 5.4 5.4"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
      </>
    ),
  },
];

export function BottomNav() {
  const pathname = usePathname() ?? '/';

  const ativo = (item: Item): boolean => {
    if (item.href === '/') return pathname === '/';
    const prefixos = item.match ?? [item.href];
    return prefixos.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  };

  return (
    <nav className="bottomnav" aria-label="Navegacao principal">
      {ITENS.map((item) => {
        const on = ativo(item);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={on ? 'active' : ''}
            aria-label={item.label}
            aria-current={on ? 'page' : undefined}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" fill="currentColor" aria-hidden="true">
              {item.icon}
            </svg>
            <em>{item.label}</em>
          </Link>
        );
      })}
    </nav>
  );
}
