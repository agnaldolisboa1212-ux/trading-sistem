/*
 * Service worker.
 *
 * Faz tres coisas, e nada mais:
 *
 *   1. um handler de `fetch` — requisito do Chrome para oferecer "Instalar"
 *   2. cache de casca (shell) para o icone e o manifesto, para a app abrir
 *      instantaneamente e nao ficar em branco offline
 *   3. notificacoes push
 *
 * O QUE ELE NAO FAZ, DE PROPOSITO: nao poe precos em cache. Um preco em cache
 * e pior do que preco nenhum — quem abre a app ve um numero que parece actual e
 * nao e. Por isso a estrategia e "rede primeiro, cache so como ultimo recurso,
 * e so para a casca". Pedidos a `/api/` e ao WebSocket nunca passam pela cache.
 */

/*
 * v4: a v3 guardava `/_next/static/` com "cache primeiro" tambem em
 * desenvolvimento. La, o Next reutiliza os MESMOS nomes de ficheiro a cada
 * recompilacao, e o service worker servia pedacos antigos misturados com novos
 * -> "Cannot read properties of undefined (reading 'call')" que voltava mesmo
 * depois de recarregar. Mudar o nome da cache faz o `activate` apagar a v3
 * envenenada em todos os browsers que a tenham.
 */
const CACHE = 'trading-casca-v4';

/*
 * Registado como `/sw.js?dev=1` em desenvolvimento (ver Pwa.tsx). Em dev nada
 * do Next vai a cache: os ficheiros nao tem hash e mudam sem mudar de nome. Em
 * producao tem hash no nome, e "cache primeiro" e seguro e rapido.
 */
const DESENVOLVIMENTO = new URL(self.location.href).searchParams.has('dev');

/** So a casca. Nada aqui muda ao segundo. */
const CASCA = [
  '/icones/icone-192.png',
  '/icones/icone-512.png',
  '/icones/apple-touch-icon.png',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(CASCA))
      // Falhar a pre-carregar a casca nao pode impedir a instalacao.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  if (pedido.method !== 'GET') return;

  const url = new URL(pedido.url);
  if (url.origin !== self.location.origin) return;
  // Dados nunca vao a cache.
  if (url.pathname.startsWith('/api/')) return;

  // Navegacao: rede primeiro; se a rede falhar, o que houver em cache.
  if (pedido.mode === 'navigate') {
    evento.respondWith(
      fetch(pedido).catch(() => caches.match(pedido).then((r) => r ?? caches.match('/'))),
    );
    return;
  }

  // Estaticos: cache primeiro, e actualiza por tras.
  const estaticoDoNext = !DESENVOLVIMENTO && url.pathname.startsWith('/_next/static/');
  if (CASCA.some((c) => url.pathname === c) || estaticoDoNext) {
    evento.respondWith(
      caches.match(pedido).then(
        (emCache) =>
          emCache ??
          fetch(pedido).then((resposta) => {
            const copia = resposta.clone();
            caches.open(CACHE).then((c) => c.put(pedido, copia)).catch(() => undefined);
            return resposta;
          }),
      ),
    );
  }
});

/**
 * Push.
 *
 * O corpo vem como JSON do servidor. Se vier vazio ou ilegivel mostra-se mesmo
 * assim uma notificacao generica: um push silencioso e, em varios browsers,
 * motivo para revogar a permissao da origem.
 */
self.addEventListener('push', (evento) => {
  let dados = {};
  try {
    dados = evento.data ? evento.data.json() : {};
  } catch {
    dados = { corpo: evento.data ? evento.data.text() : '' };
  }

  const titulo = dados.titulo || 'Sistema de Trading';
  const opcoes = {
    body: dados.corpo || 'Novo evento no mercado.',
    icon: '/icones/icone-192.png',
    badge: '/icones/icone-192.png',
    tag: dados.tag || 'trading',
    // Substitui a notificacao anterior com a mesma tag em vez de empilhar
    // dezenas de alertas do mesmo instrumento.
    renotify: Boolean(dados.tag),
    data: { url: dados.url || '/' },
    // A hora em que o servidor enviou, e nao a da entrega: um aviso que
    // chegou tarde mostra-se com a hora certa.
    timestamp: typeof dados.enviadoEm === 'number' ? dados.enviadoEm : Date.now(),
    vibrate: [60, 40, 60],
    actions: dados.url ? [{ action: 'abrir', title: 'Ver' }] : [],
  };

  evento.waitUntil(self.registration.showNotification(titulo, opcoes));
});

/** Tocar na notificacao foca um separador ja aberto em vez de abrir outro. */
self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  const destino = (evento.notification.data && evento.notification.data.url) || '/';

  evento.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((janelas) => {
      for (const janela of janelas) {
        if ('focus' in janela) {
          janela.navigate?.(destino);
          return janela.focus();
        }
      }
      return self.clients.openWindow(destino);
    }),
  );
});
