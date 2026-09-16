/**
 * Preferências do onboarding — nome, objetivos, estratégia, mercados.
 *
 * ── PORQUÊ UM COOKIE E NÃO SÓ O SUPABASE ───────────────────────────────────
 *
 * A verdade vive no Supabase, na tabela `perfis_utilizador`, protegida por RLS.
 * Mas a sessão do Supabase é do CLIENTE: o servidor que rende o Início não a
 * tem, e sem ela não sabe que mercados desenhar na fita.
 *
 * As alternativas eram piores:
 *
 *   · render no cliente — o primeiro ecrã ficaria vazio até o Supabase
 *     responder, o que é meio segundo de nada no ecrã mais visto da app;
 *   · ler no servidor com a chave secreta — obrigaria a pôr no servidor uma
 *     chave que ignora RLS, para ler uma lista de símbolos.
 *
 * O onboarding grava as duas coisas: o Supabase (fonte de verdade, sincroniza
 * entre dispositivos) e este cookie (cópia local, para o servidor pintar o
 * primeiro ecrã já certo). Se divergirem, o Supabase ganha na próxima gravação.
 *
 * Este ficheiro é NEUTRO: não importa `next/headers` nem nada de servidor, por
 * isso pode ser incluído num bundle de cliente. A leitura do lado do servidor
 * vive em `preferencias-servidor.ts` — separá-las não é arrumação, é o que
 * impede o build de falhar quando um componente de cliente precisa só do tipo.
 *
 * Nada aqui é sensível: são nomes de instrumentos e uma preferência de estilo.
 * Não é `httpOnly` de propósito — o cliente precisa de o ler para saber se já
 * fez onboarding sem ir à rede.
 */

export const COOKIE_PREFS = 'prefs';

/**
 * Objetivos de utilização.
 *
 * O pedido foi "investir, day trading, intraday, swing trading, escolher até 2".
 * O limite de dois não é arbitrário: o objetivo decide o timeframe por omissão
 * e o ritmo dos avisos, e quem escolhe tudo não escolheu nada.
 */
export const OBJETIVOS = [
  {
    id: 'investir',
    rotulo: 'Investir',
    descricao: 'Posições de meses. Índices e ouro, pouco ecrã.',
    timeframe: '1d',
    horizonte: 'meses',
  },
  {
    id: 'swing',
    rotulo: 'Swing trading',
    descricao: 'Entrar e segurar semanas. É para isto que o MMXM foi escrito.',
    timeframe: '1d',
    horizonte: 'semanas',
  },
  {
    id: 'intraday',
    rotulo: 'Intradiário',
    descricao: 'Abrir e fechar no mesmo dia, sem deixar posição aberta à noite.',
    timeframe: '1h',
    horizonte: 'horas',
  },
  {
    id: 'day',
    rotulo: 'Day trading',
    descricao: 'Várias operações por sessão, minutos a horas.',
    timeframe: '15m',
    horizonte: 'minutos',
  },
] as const;

export type ObjetivoId = (typeof OBJETIVOS)[number]['id'];

export interface Preferencias {
  nome: string | null;
  estrategia: string;
  objetivos: string[];
  instrumentos: string[];
  /** Rótulo pronto a mostrar no cabeçalho, ex. "Swing trading · Investir". */
  objetivoRotulo: string | null;
  /** Timeframe por omissão dos gráficos, derivado do objetivo mais curto. */
  timeframe: string;
  concluido: boolean;
}

/**
 * Escolha inicial: um de cada classe, com preferência pelos pares SMT fiáveis.
 *
 * Os dois sintéticos no fim não são enfeite. Quem instala a app a um sábado vê
 * tudo fechado se a lista for só de mercados reais, e conclui que está
 * avariada — estes negoceiam 24/7 e mantêm o ecrã vivo.
 */
export const INSTRUMENTOS_OMISSAO = [
  'EURUSD',
  'GBPUSD',
  'US100',
  'SP500',
  'XAUUSD',
  'BTCUSD',
  'V75',
  'V100S',
];

export const OMISSAO: Preferencias = {
  nome: null,
  estrategia: 'mmxm-smt',
  objetivos: ['swing'],
  instrumentos: INSTRUMENTOS_OMISSAO,
  objetivoRotulo: null,
  timeframe: '1d',
  concluido: false,
};

/** Timeframe do objetivo mais curto escolhido — o mais exigente manda. */
export function timeframeDe(objetivos: string[]): string {
  const ordem = ['15m', '1h', '1d'];
  const tfs: string[] = [];
  for (const o of objetivos) {
    const t = OBJETIVOS.find((x) => x.id === o)?.timeframe;
    if (t) tfs.push(t);
  }
  if (tfs.length === 0) return '1d';
  return tfs.sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b))[0] ?? '1d';
}

export function rotuloDe(objetivos: string[]): string | null {
  const nomes: string[] = [];
  for (const o of objetivos) {
    const n = OBJETIVOS.find((x) => x.id === o)?.rotulo;
    if (n) nomes.push(n);
  }
  return nomes.length > 0 ? nomes.join(' · ') : null;
}

/** Interpreta o conteúdo do cookie, tolerando lixo e versões antigas. */
export function interpretar(bruto: string | undefined): Preferencias {
  if (!bruto) return OMISSAO;
  try {
    const j = JSON.parse(decodeURIComponent(bruto)) as Partial<Preferencias>;
    const objetivos = Array.isArray(j.objetivos) && j.objetivos.length > 0 ? j.objetivos : ['swing'];
    const instrumentos =
      Array.isArray(j.instrumentos) && j.instrumentos.length > 0
        ? j.instrumentos
        : INSTRUMENTOS_OMISSAO;
    return {
      nome: typeof j.nome === 'string' && j.nome.trim() ? j.nome.trim() : null,
      estrategia: typeof j.estrategia === 'string' ? j.estrategia : 'mmxm-smt',
      objetivos,
      instrumentos,
      objetivoRotulo: rotuloDe(objetivos),
      timeframe: timeframeDe(objetivos),
      concluido: j.concluido === true,
    };
  } catch {
    // Um cookie corrompido não pode impedir a app de abrir.
    return OMISSAO;
  }
}

/** Lê as preferências no browser. */
export function lerPreferenciasCliente(): Preferencias {
  if (typeof document === 'undefined') return OMISSAO;
  const m = new RegExp(`(?:^|; )${COOKIE_PREFS}=([^;]*)`).exec(document.cookie);
  return interpretar(m?.[1]);
}

/** Grava as preferências no browser, para o servidor as ler no próximo pedido. */
export function guardarPreferenciasCliente(p: Partial<Preferencias>): void {
  if (typeof document === 'undefined') return;
  const actual = lerPreferenciasCliente();
  const novo = { ...actual, ...p };
  const valor = encodeURIComponent(
    JSON.stringify({
      nome: novo.nome,
      estrategia: novo.estrategia,
      objetivos: novo.objetivos,
      instrumentos: novo.instrumentos,
      concluido: novo.concluido,
    }),
  );
  // 180 dias: mais do que isso e o cookie sobrevive a mudanças de estratégia
  // que a pessoa já não se lembra de ter feito.
  document.cookie = `${COOKIE_PREFS}=${valor}; path=/; max-age=${60 * 60 * 24 * 180}; samesite=lax`;
}
