'use client';

/**
 * Gráfico da página do instrumento — ao vivo, com as visões por estratégia.
 *
 * A página desenhava um gráfico SVG montado no servidor com velas de fonte
 * pública, refeito uma vez por minuto: parecia parado ao lado do terminal, que
 * se mexe ao segundo. Agora usa as mesmas velas da Deriv do terminal, e a
 * análise MMXM do servidor entra como mais uma visão, ao lado das quatro
 * estratégias institucionais.
 *
 * Timeframe e visão vão para o URL: mudar o timeframe refaz a análise MMXM
 * nesse timeframe, no servidor.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AnaliseAoVivo, type MmxmPronto } from '@/components/vivo/AnaliseAoVivo';
import { GraficoVivo } from '@/components/vivo/GraficoVivo';
import { usarEcraLargo } from '@/components/vivo/usarEcraLargo';
import { usarVelas, VELAS_GRAFICO } from '@/components/vivo/usarPreco';
import type { Timeframe } from '@/lib/deriv/simbolos';
import { guardarTimeframeGrafico } from '@/lib/timeframe-grafico';
import { DESENHO_VAZIO, type Desenho, type VisaoId } from '@/lib/visoes';

/** Os timeframes em que a análise MMXM do servidor corre nesta página. */
const TIMEFRAMES_MMXM: readonly Timeframe[] = ['1h', '4h', '1d', '1w'];

export function GraficoInstrumento({
  codigo,
  nome,
  tf,
  casas,
  visao,
  mmxm,
}: {
  codigo: string;
  nome: string;
  tf: Timeframe;
  casas: number;
  visao: VisaoId;
  mmxm: MmxmPronto | null;
}) {
  const router = useRouter();
  const velas = usarVelas(codigo, tf, VELAS_GRAFICO);
  const [desenho, setDesenho] = useState<Desenho>(DESENHO_VAZIO);
  const [cheio, setCheio] = useState(false);
  const ecra = usarEcraLargo();

  const ir = (novoTf: Timeframe, novaVisao: VisaoId) => {
    guardarTimeframeGrafico(novoTf);
    // Timeframes curtos abrem no terminal, que tem todos; os do MMXM ficam aqui.
    if (!TIMEFRAMES_MMXM.includes(novoTf)) {
      router.push(`/grafico?s=${encodeURIComponent(codigo)}&tf=${novoTf}`);
      return;
    }
    router.replace(`/instrumento/${encodeURIComponent(codigo)}?tf=${novoTf}&v=${novaVisao}`, {
      scroll: false,
    });
  };

  useEffect(() => {
    if (!cheio) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCheio(false);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [cheio]);

  const grafico = (
    <GraficoVivo
      velas={velas.velas}
      casas={casas}
      timeframe={tf}
      zonas={desenho.zonas}
      linhas={desenho.linhas}
      curvas={desenho.curvas}
      marcadores={desenho.marcas}
      segmentos={desenho.segmentos}
      altura={cheio ? 0 : ecra.largo ? Math.max(420, ecra.alturaJanela - 320) : Math.max(320, Math.floor(ecra.alturaJanela * 0.55))}
      cheio={cheio}
      titulo={`${codigo} · ${nome}`}
      aoMudarTimeframe={(novo) => ir(novo, visao)}
      aoAlternarCheio={() => setCheio((v) => !v)}
    />
  );

  return (
    <>
      {cheio ? (
        <div className="terminal--cheio" role="dialog" aria-modal="true" aria-label={nome}>
          {grafico}
          <AnaliseAoVivo
            codigo={codigo}
            tf={tf}
            velas={velas.velas}
            casas={casas}
            visao={visao}
            aoMudarVisao={(v) => ir(tf, v)}
            aoMudarDesenho={setDesenho}
            mmxm={mmxm}
            compacto
          />
        </div>
      ) : (
        <div className="terminal">
          <div className="terminal__principal">{grafico}</div>
          <aside className="terminal__lateral">
            <AnaliseAoVivo
              codigo={codigo}
              tf={tf}
              velas={velas.velas}
              casas={casas}
              visao={visao}
              aoMudarVisao={(v) => ir(tf, v)}
              aoMudarDesenho={setDesenho}
              mmxm={mmxm}
            />
            <Link
              className="btn ghost block"
              style={{ marginTop: 12 }}
              href={`/grafico?s=${encodeURIComponent(codigo)}&tf=${tf}${visao === 'mmxm' || visao === 'resumo' ? '' : `&v=${visao}`}`}
            >
              Abrir no terminal para negociar
            </Link>
          </aside>
        </div>
      )}
    </>
  );
}
