'use client';

/**
 * Onboarding — cinco passos, um ecrã.
 *
 *   1. quem é       — nome e foto
 *   2. para quê     — objetivo (até dois)
 *   3. como         — estratégia
 *   4. o quê        — mercados
 *   5. corretora    — conta Deriv cTrader (opcional, liga-se nas definições)
 *
 * Um passo por rota obrigaria a guardar o estado entre elas e a lidar com o
 * botão "voltar" do browser a meio de um formulário. Cinco passos num só
 * componente mantêm tudo em memória e o "voltar" continua a significar "sair do
 * onboarding", que é o que a pessoa espera.
 *
 * ── PORQUE O OBJETIVO VEM ANTES DA ESTRATÉGIA ──────────────────────────────
 *
 * Porque decide-a. Quem escolhe "day trading" não devia ver como primeira opção
 * uma estratégia desenhada para segurar posições semanas — e é isso que o MMXM
 * é. O passo 3 reordena-se conforme o passo 2, e diz porquê.
 *
 * ── NA CONTA ────────────────────────────────────────────────────────────────
 *
 * O middleware só deixa chegar aqui com sessão iniciada. Tudo fica no perfil
 * da conta (Supabase, com RLS: cada pessoa só lê e escreve o seu), e o fim do
 * onboarding fica marcado na própria conta — é o que o middleware lê para
 * deixar de mandar a pessoa para aqui. O cookie `prefs` é só uma cópia local
 * para os ecrãs do browser não esperarem pela rede.
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ESTRATEGIAS, guardarPerfil, lerPerfil, marcarOnboarding, utilizadorAtual } from '@/lib/auth';
import { timeframesDoObjetivo } from '@trading/core';
import { OBJETIVOS, guardarPreferenciasCliente } from '@/lib/preferencias';
import { CRIPTO, FOREX, INDICES, METAIS, SINTETICOS } from '@/lib/deriv/simbolos';
import { usarCtrader } from '@/components/vivo/usarCtrader';
import '../onboarding.css';

const GRUPOS = [
  { rotulo: 'Índices mundiais', lista: INDICES, nota: 'S&P, Nasdaq, Dow, DAX…' },
  { rotulo: 'Forex', lista: FOREX, nota: 'pares maiores' },
  { rotulo: 'Metais', lista: METAIS, nota: 'ouro e prata' },
  { rotulo: 'Cripto', lista: CRIPTO, nota: '24/7' },
  { rotulo: 'Sintéticos', lista: SINTETICOS, nota: 'geradas pela Deriv, negoceiam 24/7' },
];

const SUGERIDOS = ['EURUSD', 'GBPUSD', 'US100', 'SP500', 'XAUUSD', 'BTCUSD', 'V75', 'V100S'];

const TOTAL_PASSOS = 5;

export default function Page() {
  const router = useRouter();
  const [passo, setPasso] = useState(0);
  const [nome, setNome] = useState('');
  const [foto, setFoto] = useState<string | null>(null);
  const [objetivos, setObjetivos] = useState<string[]>(['swing']);
  const [estrategia, setEstrategia] = useState('mmxm-smt');
  const [instrumentos, setInstrumentos] = useState<string[]>(SUGERIDOS);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aVerificar, setAVerificar] = useState(true);

  useEffect(() => {
    void (async () => {
      const [utilizador, p] = await Promise.all([utilizadorAtual(), lerPerfil()]);
      const nomeDaConta = (utilizador?.user_metadata as { nome?: string } | undefined)?.nome;

      // Contas de antes das contas obrigatórias: o onboarding já estava feito
      // no perfil, só faltava a marca na conta. Não se repete.
      const marcado = (utilizador?.user_metadata as { onboarding?: boolean } | undefined)?.onboarding;
      if (p?.onboarding_em && marcado !== true) {
        await marcarOnboarding(p.nome ?? nomeDaConta ?? null);
        window.location.assign('/');
        return;
      }

      // Quem volta para mudar preferências encontra as que tem.
      if (p?.nome || nomeDaConta) setNome(p?.nome ?? nomeDaConta ?? '');
      if (p?.objetivos?.length) setObjetivos(p.objetivos);
      if (p?.estrategia) setEstrategia(p.estrategia);
      if (p?.instrumentos?.length) setInstrumentos(p.instrumentos);
      setAVerificar(false);
    })();
  }, [router]);

  /**
   * As estratégias reordenadas pelo objetivo escolhido.
   *
   * Não esconde nenhuma: quem quer usar o MMXM para day trading pode. Só deixa
   * de ser a primeira coisa que aparece, porque para esse objetivo não é.
   */
  const estrategiasOrdenadas = useMemo(() => {
    const curto = objetivos.some((o) => o === 'day' || o === 'intraday');
    return [...ESTRATEGIAS].sort((a, b) => {
      /*
       * `pronta` decide PRIMEIRO, sempre.
       *
       * Uma versão anterior ordenava só por adequação ao horizonte, e para quem
       * escolhia "day trading" o ecrã abria com duas opções cinzentas e
       * desativadas no topo — a única utilizável ficava em último. Uma lista
       * cuja primeira entrada não se pode escolher lê-se como avaria.
       */
      if (a.pronta !== b.pronta) return Number(b.pronta) - Number(a.pronta);
      return adequacao(b.id, curto) - adequacao(a.id, curto);
    });
  }, [objetivos]);

  const alternarObjetivo = (id: string) =>
    setObjetivos((atual) => {
      if (atual.includes(id)) return atual.filter((o) => o !== id);
      // Máximo dois: o terceiro empurra o mais antigo para fora, em vez de
      // simplesmente não reagir ao toque — um botão que não faz nada lê-se como
      // avariado.
      return atual.length >= 2 ? [atual[1]!, id] : [...atual, id];
    });

  const alternarInstrumento = (codigo: string) =>
    setInstrumentos((atual) =>
      atual.includes(codigo) ? atual.filter((s) => s !== codigo) : [...atual, codigo],
    );

  const concluir = async () => {
    setErro(null);
    setOcupado(true);
    const nomeLimpo = nome.trim() || null;

    const r = await guardarPerfil({
      nome: nomeLimpo,
      estrategia,
      instrumentos,
      objetivos,
      onboarding_em: new Date().toISOString(),
    });
    if (!r.ok) {
      setOcupado(false);
      setErro(`Não foi possível guardar: ${r.erro}`);
      return;
    }
    const m = await marcarOnboarding(nomeLimpo);
    if (!m.ok) {
      setOcupado(false);
      setErro(`Guardado, mas não foi possível concluir: ${m.erro}`);
      return;
    }

    guardarPreferenciasCliente({ nome: nomeLimpo, estrategia, objetivos, instrumentos, concluido: true });
    if (foto) {
      try {
        localStorage.setItem('avatar', foto);
      } catch {
        /* modo privado — a foto não é essencial */
      }
    }
    // Navegação completa: a sessão renovada tem de chegar ao middleware.
    window.location.assign('/');
  };

  if (aVerificar) {
    return (
      <div className="wrap ob">
        <div className="brilho" style={{ height: 240, borderRadius: 20 }} />
      </div>
    );
  }

  return (
    <div className="wrap ob">
      <div className="ob__passos" aria-hidden="true">
        {Array.from({ length: TOTAL_PASSOS }, (_, i) => (
          <i key={i} className={i <= passo ? 'feito' : ''} />
        ))}
      </div>

      {passo === 0 && (
        <PassoNome
          nome={nome}
          setNome={setNome}
          foto={foto}
          setFoto={setFoto}
          avancar={() => setPasso(1)}
        />
      )}

      {passo === 1 && (
        <>
          <Titulo
            titulo="O que quer fazer?"
            sub={`Escolha até dois · ${objetivos.length} selecionado${objetivos.length === 1 ? '' : 's'}`}
          />

          {OBJETIVOS.map((o) => (
            <button
              key={o.id}
              type="button"
              className="escolha"
              aria-pressed={objetivos.includes(o.id)}
              onClick={() => alternarObjetivo(o.id)}
            >
              <span className="escolha__marca" aria-hidden="true">
                {objetivos.includes(o.id) ? '✓' : ''}
              </span>
              <span className="grow">
                <span className="escolha__nome">{o.rotulo}</span>
                <span className="escolha__desc">{o.descricao}</span>
                <span className="escolha__meta">
                  sinais em {timeframesDoObjetivo(o.id).map((t) => t.toUpperCase()).join(' e ')} · horizonte de{' '}
                  {o.horizonte}
                </span>
              </span>
            </button>
          ))}

          <p className="ob__ajuda">
            Isto define os timeframes dos sinais e dos avisos que recebe — quem escolhe horas e
            dias não recebe sinais de 15 minutos. Pode mudar depois nas definições.
          </p>

          <Acoes voltar={() => setPasso(0)} avancar={() => setPasso(2)} podeAvancar={objetivos.length > 0} />
        </>
      )}

      {passo === 2 && (
        <>
          <Titulo titulo="Que estratégia?" sub="Ordenadas pelo que escolheu antes" />

          {estrategiasOrdenadas.map((e) => (
            <button
              key={e.id}
              type="button"
              className="escolha"
              aria-pressed={estrategia === e.id}
              disabled={!e.pronta}
              onClick={() => setEstrategia(e.id)}
            >
              <span className="escolha__marca" aria-hidden="true">
                {estrategia === e.id ? '✓' : ''}
              </span>
              <span className="grow">
                <span className="escolha__nome">
                  {e.nome}
                  {!e.pronta && ' · em construção'}
                </span>
                <span className="escolha__desc">{e.descricao}</span>
                <span className="escolha__meta">{e.escala}</span>
              </span>
            </button>
          ))}

          <p className="ob__ajuda">
            <strong>Nenhuma destas tem vantagem demonstrada.</strong> O backtest do MMXM deu 17
            operações em 6 anos, e um único negócio em ouro vale 81% do lucro. Comece na conta
            demo.
          </p>

          <Acoes voltar={() => setPasso(1)} avancar={() => setPasso(3)} />
        </>
      )}

      {passo === 3 && (
        <>
          <Titulo
            titulo="Que mercados?"
            sub={`${instrumentos.length} selecionado${instrumentos.length === 1 ? '' : 's'}`}
          />

          {GRUPOS.map((g) => (
            <div key={g.rotulo}>
              <div className="ob__grupo">
                {g.rotulo} <em>{g.nota}</em>
              </div>
              <div className="ob__grelha">
                {g.lista.map((i) => (
                  <button
                    key={i.codigo}
                    type="button"
                    className="ob__chip"
                    aria-pressed={instrumentos.includes(i.codigo)}
                    onClick={() => alternarInstrumento(i.codigo)}
                    title={i.nome}
                  >
                    {i.codigo}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <p className="ob__ajuda">
            O SMT compara pares correlacionados — escolher US100 e SP500, ou EURUSD e GBPUSD, dá
            mais sinais do que um instrumento isolado. Os sintéticos negoceiam ao fim de semana,
            quando tudo o resto está fechado.
          </p>

          <Acoes
            voltar={() => setPasso(2)}
            avancar={() => setPasso(4)}
            podeAvancar={instrumentos.length > 0}
          />
        </>
      )}

      {passo === 4 && (
        <>
          <Titulo titulo="Quase pronto" sub="A ligação à corretora é opcional" />
          <PassoCorretora />

          <div className="ob__acoes">
            <button type="button" className="btn ghost" onClick={() => setPasso(3)}>
              Voltar
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => void concluir()}
              disabled={ocupado}
            >
              {ocupado ? 'a guardar…' : 'Concluir'}
            </button>
          </div>
        </>
      )}

      {erro && <div className="ob__erro">{erro}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Peso de adequação de uma estratégia a um horizonte curto. */
function adequacao(id: string, curto: boolean): number {
  const curtas = ['supply-demand', 'support-resistance', 'vwap', 'volume-profile', 'institucional'];
  const ehCurta = curtas.some((c) => id.includes(c));
  if (curto) return ehCurta ? 2 : 0;
  return ehCurta ? 0 : 2;
}

function Titulo({ titulo, sub }: { titulo: string; sub: string }) {
  return (
    <div className="ob__marca">
      <div>
        <h1>{titulo}</h1>
        <p className="dim">{sub}</p>
      </div>
    </div>
  );
}

function Acoes({
  voltar,
  avancar,
  podeAvancar = true,
}: {
  voltar: () => void;
  avancar: () => void;
  podeAvancar?: boolean;
}) {
  return (
    <div className="ob__acoes">
      <button type="button" className="btn ghost" onClick={voltar}>
        Voltar
      </button>
      <button type="button" className="btn primary" onClick={avancar} disabled={!podeAvancar}>
        Continuar
      </button>
    </div>
  );
}

/**
 * Nome e foto.
 *
 * A foto fica em `localStorage` como data URL e não vai para o servidor. É um
 * avatar de 96px no canto de um ecrã — não justifica um bucket, uma política de
 * acesso e uma fotografia da pessoa guardada numa base de dados.
 */
function PassoNome({
  nome,
  setNome,
  foto,
  setFoto,
  avancar,
}: {
  nome: string;
  setNome: (v: string) => void;
  foto: string | null;
  setFoto: (v: string | null) => void;
  avancar: () => void;
}) {
  const escolher = (ficheiro: File | undefined) => {
    if (!ficheiro) return;
    const leitor = new FileReader();
    leitor.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Redimensiona para 96px antes de guardar: uma foto de telemóvel são
        // 4 MB e o localStorage tem ~5 MB no total.
        const lado = 96;
        const cv = document.createElement('canvas');
        cv.width = lado;
        cv.height = lado;
        const ctx = cv.getContext('2d');
        if (!ctx) return;
        const menor = Math.min(img.width, img.height);
        ctx.drawImage(
          img,
          (img.width - menor) / 2,
          (img.height - menor) / 2,
          menor,
          menor,
          0,
          0,
          lado,
          lado,
        );
        setFoto(cv.toDataURL('image/jpeg', 0.8));
      };
      img.src = String(leitor.result);
    };
    leitor.readAsDataURL(ficheiro);
  };

  return (
    <>
      <div className="ob__marca">
        <label className="ob__foto">
          {foto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={foto} alt="" />
          ) : (
            <span aria-hidden="true">＋</span>
          )}
          <input
            type="file"
            accept="image/*"
            onChange={(e) => escolher(e.target.files?.[0])}
            aria-label="Escolher foto de perfil"
          />
        </label>
        <div>
          <h1>Como se chama?</h1>
          <p className="dim">Para personalizar os alertas</p>
        </div>
      </div>

      <div className="card">
        <label className="ob__label" htmlFor="nome">
          Nome
        </label>
        <input
          id="nome"
          className="ob__input"
          type="text"
          autoComplete="name"
          placeholder="O seu nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') avancar();
          }}
        />
        <p className="ob__ajuda">
          A foto fica só neste dispositivo — não é enviada para lado nenhum.
        </p>
      </div>

      <div className="ob__acoes">
        <button type="button" className="btn primary" onClick={avancar}>
          Continuar
        </button>
      </div>
    </>
  );
}

/**
 * A corretora: Deriv cTrader (CFD).
 *
 * Não abre a autorização a meio do onboarding — sair para a cTrader perdia as
 * escolhas dos passos anteriores. Mostra o estado e diz onde se liga depois.
 */
function PassoCorretora() {
  const c = usarCtrader();

  if (c.aCarregar) return <div className="brilho" style={{ height: 120, borderRadius: 16 }} />;

  if (c.ligada) {
    return (
      <div className="card">
        <div className="ob__ok">
          <span aria-hidden="true">✓</span>
          <div>
            <strong>Deriv cTrader ligada</strong>
            <p className="dim" style={{ margin: '4px 0 0', fontSize: 13 }}>
              {c.contas.length} conta(s) CFD autorizada(s).
              {c.conta && (
                <>
                  {' '}
                  Conta activa: <code>#{c.conta.login ?? c.conta.id}</code> ({c.conta.real ? 'real' : 'demo'}).
                </>
              )}
            </p>
          </div>
        </div>
        <p className="ob__ajuda" style={{ marginTop: 12, marginBottom: 0 }}>
          A conta real só passa a ser usada se a escolher nas definições, e essa troca pede
          confirmação. Nenhuma ordem sai sem um toque seu.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <strong>Negociar com a sua conta Deriv cTrader</strong>
      <p className="ob__ajuda" style={{ marginTop: 8 }}>
        As ordens saem da sua própria conta CFD da Deriv, na plataforma cTrader — nunca da conta de
        outra pessoa. Depois de concluir, ligue-a em <strong>Definições → Corretora</strong>: abre a
        página da cTrader, entra com o seu cTrader ID e autoriza. A sua palavra-passe nunca passa
        por esta aplicação.
      </p>
      <p className="ob__ajuda" style={{ marginBottom: 0 }}>
        {c.configurado
          ? 'Pode concluir sem isto: a análise, os gráficos e os sinais funcionam sem corretora ligada.'
          : 'A negociação CFD ainda não está disponível neste servidor; a análise, os gráficos e os sinais já funcionam.'}
      </p>
    </div>
  );
}
