'use client';

/**
 * Seletor de timeframe.
 *
 * Navega por query string (`?tf=4h`) em vez de estado local: assim o timeframe
 * escolhido fica no URL, sobrevive a um refresh, pode ser partilhado como link
 * e o Server Component volta a correr a análise no timeframe certo.
 */

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

export function TimeframeSwitch({
  current,
  options,
  labels,
}: {
  current: string;
  options: string[];
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const escolher = (tf: string) => {
    const next = new URLSearchParams(params.toString());
    next.set('tf', tf);
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  };

  return (
    <div className="tfswitch" role="group" aria-label="Timeframe">
      {options.map((tf) => (
        <button
          key={tf}
          type="button"
          className={tf === current ? 'active' : ''}
          onClick={() => escolher(tf)}
          disabled={pending}
          title={labels[tf] ?? tf}
        >
          {tf}
        </button>
      ))}
      {pending && <span className="faint">a carregar…</span>}
    </div>
  );
}
