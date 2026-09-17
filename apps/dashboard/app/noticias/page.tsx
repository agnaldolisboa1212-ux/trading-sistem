'use client';

/**
 * Notícias — só alto impacto.
 *
 *   calendário       eventos marcados como de alto impacto nesta semana, com os
 *                    instrumentos que movem; os do seu portfólio em destaque
 *   bancos centrais  comunicados de política monetária da Fed, BCE e Banco de
 *                    Inglaterra, com ligação para o texto oficial
 *   fundos (COT)     como os gestores de activos e os hedge funds estão
 *                    posicionados nos futuros de índices e Bitcoin (CFTC)
 *
 * O que isto faz aos sinais: um sinal de 1h não sai nos 30 minutos antes e
 * depois de uma notícia de alto impacto do instrumento; em 4h e 1D sai com o
 * aviso. O COT é contexto: testado contra 15 anos de operações, não melhorou o
 * acerto, por isso não mexe na convicção.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { usarPortfolio } from '@/components/vivo/usarPortfolio';
import { quandoNoticia, usarNoticias, type CotNoticia, type EventoNoticia } from '@/components/vivo/usarNoticias';

const BANDEIRA: Record<string, string> = {
  USD: '🇺🇸',
  EUR: '🇪🇺',
  GBP: '🇬🇧',
  JPY: '🇯🇵',
  CAD: '🇨🇦',
  AUD: '🇦🇺',
  NZD: '🇳🇿',
  CHF: '🇨🇭',
  CNY: '🇨🇳',
};

export default function Page() {
  const { dados, aCarregar } = usarNoticias();
  const portfolio = usarPortfolio();
  const [agora, setAgora] = useState(0);
  const [soMeus, setSoMeus] = useState(true);
  useEffect(() => {
    setAgora(Date.now());
    const id = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const meus = useMemo(() => new Set((portfolio.instrumentos ?? []).map((c) => c.toUpperCase())), [portfolio.instrumentos]);
  const afecta = (e: EventoNoticia) => e.instrumentos.filter((i) => meus.has(i));

  const eventos = (dados?.eventos ?? []).filter((e) => !soMeus || meus.size === 0 || afecta(e).length > 0);
  const proximos = eventos.filter((e) => e.em >= agora - 60 * 60_000);
  const passados = eventos.filter((e) => e.em < agora - 60 * 60_000);

  // Agrupar por dia (local).
  const porDia = new Map<string, EventoNoticia[]>();
  for (const e of proximos) {
    const k = new Date(e.em).toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'short' });
    porDia.set(k, [...(porDia.get(k) ?? []), e]);
  }

  return (
    <div className="wrap">
      <div className="cabeca">
        <div className="cabeca__id">
          <p className="cabeca__saudacao">Só alto impacto</p>
          <h1>Notícias</h1>
        </div>
      </div>

      <section>
        <div className="section-head">
          <h2>Calendário desta semana</h2>
          <span className="grow" />
          {meus.size > 0 && (
            <label className="noticias__filtro">
              <input type="checkbox" checked={soMeus} onChange={(e) => setSoMeus(e.target.checked)} />
              só o meu portfólio
            </label>
          )}
        </div>
        <p className="section-cap">
          Decisões de juros, inflação, emprego e PIB. Um sinal de 1h não sai nos 30 minutos antes e
          depois de uma destas notícias do seu instrumento; em 4h e 1D sai com o aviso.
        </p>

        {aCarregar && !dados ? (
          <div className="brilho" style={{ height: 160, borderRadius: 20 }} />
        ) : proximos.length === 0 ? (
          <div className="empty">
            <strong>Sem notícias de alto impacto {soMeus && meus.size > 0 ? 'para o seu portfólio ' : ''}até ao fim da semana.</strong>
            {soMeus && meus.size > 0 ? 'Desligue o filtro para ver as de todos os mercados.' : ''}
          </div>
        ) : (
          [...porDia].map(([dia, lista]) => (
            <div key={dia} className="noticias__dia">
              <div className="noticias__dia-titulo">{dia}</div>
              <div className="grupo__caixa">
                {lista.map((e, i) => (
                  <LinhaEvento key={`${e.em}-${i}`} e={e} agora={agora} meus={afecta(e)} />
                ))}
              </div>
            </div>
          ))
        )}

        {passados.length > 0 && (
          <details className="noticias__passados">
            <summary>Já saíram esta semana ({passados.length})</summary>
            <div className="grupo__caixa">
              {passados.map((e, i) => (
                <LinhaEvento key={`${e.em}-${i}`} e={e} agora={agora} meus={afecta(e)} />
              ))}
            </div>
          </details>
        )}
      </section>

      <section>
        <div className="section-head">
          <h2>Bancos centrais</h2>
        </div>
        <p className="section-cap">Comunicados de política monetária — o texto oficial, não resumos.</p>
        {(dados?.comunicados ?? []).length === 0 ? (
          <div className="empty">
            <strong>{aCarregar ? 'A carregar…' : 'Sem comunicados de política monetária nas últimas semanas.'}</strong>
          </div>
        ) : (
          <div className="grupo__caixa">
            {dados!.comunicados.map((c) => (
              <a key={c.url} href={c.url} target="_blank" rel="noopener noreferrer" className="noticia-linha">
                <span className="noticia-linha__fonte">{c.fonte}</span>
                <span className="grow">
                  <strong>{c.titulo}</strong>
                  <em>{agora ? quandoNoticia(c.em, agora) : ''}</em>
                </span>
                <span aria-hidden="true">↗</span>
              </a>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="section-head">
          <h2>Como os fundos estão posicionados</h2>
        </div>
        <p className="section-cap">
          Relatório COT da CFTC (semanal): posição líquida nos futuros, em % do total em aberto, e onde
          está face aos últimos 3 anos. <strong>É contexto:</strong> testado contra 15 anos de
          operações, não melhorou o acerto dos sinais, por isso não mexe na convicção.
        </p>
        {(dados?.cot ?? []).length === 0 ? (
          <div className="empty">
            <strong>{aCarregar ? 'A carregar…' : 'O relatório da CFTC não respondeu agora.'}</strong>
          </div>
        ) : (
          <div className="grupo__caixa">
            {dados!.cot.map((c) => (
              <LinhaCot key={c.simbolo} c={c} />
            ))}
          </div>
        )}
      </section>

      <p className="section-cap" style={{ marginTop: 8 }}>
        Fontes: calendário Forex Factory; Federal Reserve, Banco Central Europeu e Bank of England;
        Commodity Futures Trading Commission. Rumores e fóruns ficam de fora — não são verificáveis.
        Ver também <Link href="/portfolio">o seu portfólio</Link>.
      </p>
    </div>
  );
}

function LinhaEvento({ e, agora, meus }: { e: EventoNoticia; agora: number; meus: string[] }) {
  const falta = e.em - agora;
  const breve = falta > 0 && falta < 60 * 60_000;
  return (
    <div className={`noticia-linha ${breve ? 'noticia-linha--breve' : ''}`}>
      <span className="noticia-linha__moeda" title={e.moeda}>
        {BANDEIRA[e.moeda] ?? ''} {e.moeda}
      </span>
      <span className="grow">
        <strong>{e.titulo}</strong>
        <em>
          {agora ? quandoNoticia(e.em, agora) : ''}
          {breve ? ` · daqui a ${Math.round(falta / 60_000)} min` : ''}
          {e.previsao ? ` · previsão ${e.previsao}` : ''}
          {e.anterior ? ` · anterior ${e.anterior}` : ''}
        </em>
        {meus.length > 0 && (
          <span className="noticia-linha__chips">
            {meus.map((m) => (
              <Link key={m} href={`/grafico?s=${encodeURIComponent(m)}&tf=1h`} className="noticia-chip">
                {m}
              </Link>
            ))}
          </span>
        )}
      </span>
    </div>
  );
}

function LinhaCot({ c }: { c: CotNoticia }) {
  const leitura = (pct: number) =>
    pct >= 0.8 ? 'no topo de 3 anos' : pct <= 0.2 ? 'no fundo de 3 anos' : `percentil ${Math.round(pct * 100)}`;
  const sinal = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
  return (
    <div className="noticia-linha noticia-linha--cot">
      <span className="grow">
        <strong>{c.mercado}</strong>
        <em>relatório de {new Date(c.relatorio).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' })}</em>
      </span>
      <span className="cot">
        <span>
          gestores de activos <b className={c.gestores.liquidoPct >= 0 ? 'bull-t' : 'bear-t'}>{sinal(c.gestores.liquidoPct)}%</b>
          <em>{leitura(c.gestores.percentil3a)} · semana {sinal(c.gestores.variacaoSemana)}</em>
        </span>
        <span>
          hedge funds <b className={c.alavancados.liquidoPct >= 0 ? 'bull-t' : 'bear-t'}>{sinal(c.alavancados.liquidoPct)}%</b>
          <em>{leitura(c.alavancados.percentil3a)} · semana {sinal(c.alavancados.variacaoSemana)}</em>
        </span>
      </span>
    </div>
  );
}
