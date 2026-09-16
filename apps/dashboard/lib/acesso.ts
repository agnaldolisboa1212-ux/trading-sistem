/**
 * Quem pode abrir o quê — a regra, isolada.
 *
 * Função pura, sem imports, testada em `test/acesso.test.mjs`. O
 * `middleware.ts` só junta os factos (há sessão? falta o segundo factor? o
 * onboarding está feito?) e aplica o que isto decidir.
 *
 * ── A REGRA ────────────────────────────────────────────────────────────────
 *
 *   1. Ficheiros da app (ícones, manifesto, service worker) e as rotas que
 *      outros sistemas chamam sem sessão passam sempre.
 *   2. Sem sessão: só as páginas de entrar, criar conta e recuperar. Uma página
 *      manda para `/entrar` e lembra onde ia; uma rota de API responde 401.
 *   3. Com sessão, mas com verificação em dois passos por fazer: só a página do
 *      código. Uma palavra-passe roubada não chega.
 *   4. Com sessão e sem onboarding: o onboarding primeiro.
 *   5. Com sessão, as páginas de entrar e criar conta mandam para o início.
 */

export interface FactosAcesso {
  caminho: string;
  autenticado: boolean;
  /** Tem segundo factor activo e esta sessão ainda não o usou. */
  falta2fa: boolean;
  onboardingFeito: boolean;
}

export type DecisaoAcesso =
  | { tipo: 'seguir' }
  | { tipo: 'redirecionar'; para: string }
  | { tipo: 'recusar'; estado: 401; codigo: 'SemSessao' | 'Falta2FA'; erro: string };

/** Sem sessão, e sem nunca redirecionar. */
const ABERTOS_SEMPRE = [
  '/_next/',
  '/icones/',
  '/sw.js',
  '/manifest.webmanifest',
  '/favicon.ico',
  '/robots.txt',
  // Autenticado pelo segredo do motor, não por sessão.
  '/api/push/enviar',
  // O motor pergunta por aqui se o painel já responde.
  '/api/saude',
  // Links dos emails de confirmação e de recuperação.
  '/auth/',
  // Só apaga cookies da Deriv: tem de funcionar mesmo com a sessão já expirada.
  '/api/deriv/oauth/sair',
];

/** Páginas para quem ainda não entrou. */
const PAGINAS_DE_ENTRADA = ['/entrar', '/registar', '/recuperar'];

const VERIFICAR_2FA = '/entrar/verificar';
const ONBOARDING = '/onboarding';
/** Com a sessão de recuperação do email, a pessoa tem de poder definir a nova palavra-passe. */
const NOVA_PALAVRA_PASSE = '/recuperar/nova';

function comeca(caminho: string, prefixo: string): boolean {
  if (prefixo.endsWith('/')) return caminho.startsWith(prefixo);
  return caminho === prefixo || caminho.startsWith(`${prefixo}/`);
}

/** Passa sem olhar para a sessão — o middleware nem a lê. */
export function caminhoAberto(caminho: string): boolean {
  return ABERTOS_SEMPRE.some((p) => comeca(caminho, p));
}

export function decidirAcesso(f: FactosAcesso): DecisaoAcesso {
  const { caminho } = f;
  const api = comeca(caminho, '/api');

  if (caminhoAberto(caminho)) return { tipo: 'seguir' };

  const deEntrada = PAGINAS_DE_ENTRADA.some((p) => comeca(caminho, p));

  // --- 2. sem sessão ---------------------------------------------------------
  if (!f.autenticado) {
    if (deEntrada && !comeca(caminho, VERIFICAR_2FA) && !comeca(caminho, NOVA_PALAVRA_PASSE)) {
      return { tipo: 'seguir' };
    }
    if (api) {
      return {
        tipo: 'recusar',
        estado: 401,
        codigo: 'SemSessao',
        erro: 'Entre na plataforma para continuar.',
      };
    }
    const voltar = caminho === '/' || deEntrada ? '' : `?voltar=${encodeURIComponent(caminho)}`;
    return { tipo: 'redirecionar', para: `/entrar${voltar}` };
  }

  // --- 3. segundo factor em falta --------------------------------------------
  if (f.falta2fa) {
    if (comeca(caminho, VERIFICAR_2FA)) return { tipo: 'seguir' };
    if (api) {
      return {
        tipo: 'recusar',
        estado: 401,
        codigo: 'Falta2FA',
        erro: 'Confirme o código da verificação em dois passos.',
      };
    }
    return { tipo: 'redirecionar', para: VERIFICAR_2FA };
  }

  // A recuperação da palavra-passe vem antes do onboarding: quem a pediu quer
  // mudá-la, não escolher mercados.
  if (comeca(caminho, NOVA_PALAVRA_PASSE)) return { tipo: 'seguir' };

  // --- 5. já entrou: as páginas de entrada não fazem sentido -----------------
  if (deEntrada) {
    return { tipo: 'redirecionar', para: f.onboardingFeito ? '/' : ONBOARDING };
  }

  // --- 4. onboarding ---------------------------------------------------------
  if (!f.onboardingFeito && !api && !comeca(caminho, ONBOARDING)) {
    return { tipo: 'redirecionar', para: ONBOARDING };
  }

  return { tipo: 'seguir' };
}

/**
 * Destino depois de entrar. Só caminhos internos: `?voltar=https://outro-site`
 * faria da página de login um redireccionador aberto para phishing.
 */
export function destinoSeguro(voltar: string | null | undefined): string {
  if (!voltar || !voltar.startsWith('/') || voltar.startsWith('//') || voltar.startsWith('/\\')) {
    return '/';
  }
  return voltar;
}
