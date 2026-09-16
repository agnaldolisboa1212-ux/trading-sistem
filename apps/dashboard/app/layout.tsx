import type { Metadata, Viewport } from 'next';
import { BottomNav } from '@/components/BottomNav';
import { THEME_INIT_SCRIPT } from '@/components/ThemeToggle';
import { RegistarSW } from '@/components/vivo/Pwa';
import './globals.css';
import './vivo.css';

export const metadata: Metadata = {
  title: 'Sistema de Trading — MMXM & SMT',
  description:
    'Painel de sinais de swing trading baseado em Market Maker Models, SMT Divergence e alinhamento Time & Price, com ligacao a conta Deriv.',
  applicationName: 'Trading',
  appleWebApp: {
    // Faz o Safari abrir a app sem barra de endereco quando adicionada ao ecra
    // principal — o equivalente iOS do `display: standalone` do manifesto.
    capable: true,
    title: 'Trading',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [
      { url: '/icones/icone-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icones/icone-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icones/apple-touch-icon.png',
  },
  formatDetection: {
    // Sem isto o iOS transforma precos como 1.16124 em links de telefone.
    telephone: false,
  },
};

/**
 * `viewportFit: cover` mais o `themeColor` por esquema fazem a barra de estado
 * do telemovel acompanhar o tema, em vez de ficar um retangulo branco por cima
 * de um painel escuro.
 *
 * `maximumScale` fica por definir de proposito: bloquear o zoom e uma barreira
 * de acessibilidade real, e os campos ja usam 16px para nao provocar o zoom
 * automatico do iOS.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f2f3ef' },
    { media: '(prefers-color-scheme: dark)', color: '#12170e' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt" suppressHydrationWarning>
      <head>
        {/*
          Corre antes da primeira pintura para aplicar o tema guardado. Sem isto
          o painel pisca no tema errado antes de o React montar.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        {children}
        <BottomNav />
        <RegistarSW />
      </body>
    </html>
  );
}
