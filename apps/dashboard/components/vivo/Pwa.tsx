'use client';

/**
 * Registo do service worker, instalação da app e notificações push.
 *
 * ── O BOTÃO "INSTALAR" DO CHROME ───────────────────────────────────────────
 *
 * O Chrome dispara `beforeinstallprompt` quando a app cumpre os critérios
 * (manifesto + service worker com handler de `fetch` + origem segura). O evento
 * é guardado e só disparado quando a pessoa toca no nosso botão — chamar
 * `prompt()` sem gesto do utilizador é ignorado pelo browser.
 *
 * No iOS o evento não existe: o Safari instala pelo menu Partilhar. Por isso o
 * componente deteta iOS e mostra a instrução em vez de um botão que não faria
 * nada.
 *
 * ── PERMISSÃO DE NOTIFICAÇÕES ──────────────────────────────────────────────
 *
 * Nunca é pedida ao carregar a página. Pedir permissão sem contexto é a razão
 * número um pela qual as pessoas bloqueiam notificações para sempre — e uma vez
 * bloqueadas, só se desbloqueiam nas definições do browser. Aqui só se pede
 * quando alguém liga o interruptor.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

interface EventoInstalar extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Regista o service worker. Montado uma vez, no layout. */
export function RegistarSW() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // `load` para não competir com o primeiro render pela largura de banda.
    const registar = () => {
      // Em desenvolvimento o service worker sabe que nao pode guardar os
      // ficheiros do Next em cache: nao tem hash e mudam a cada recompilacao.
      const script = process.env.NODE_ENV === 'production' ? '/sw.js' : '/sw.js?dev=1';
      navigator.serviceWorker.register(script, { scope: '/' }).catch(() => undefined);
      void ligarSubscricaoAConta();
    };
    if (document.readyState === 'complete') registar();
    else {
      window.addEventListener('load', registar);
      return () => window.removeEventListener('load', registar);
    }
  }, []);

  return null;
}

/**
 * Liga a subscrição push deste dispositivo à conta que entrou.
 *
 * Os avisos agora seguem as preferências de cada conta (mercados escolhidos,
 * avisos ligados). Uma subscrição feita antes do login obrigatório não tinha
 * dono; outra pessoa pode entrar no mesmo telemóvel. Uma vez por sessão do
 * browser, e só com permissão já dada — nunca pede permissão aqui.
 */
async function ligarSubscricaoAConta(): Promise<void> {
  try {
    if (!('PushManager' in window) || Notification.permission !== 'granted') return;
    if (/^\/(entrar|registar|recuperar|auth)(\/|$)/.test(window.location.pathname)) return;
    if (sessionStorage.getItem('push-ligado') === '1') return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const r = await fetch('/api/push/subscrever', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub.toJSON()),
    });
    if (r.ok) sessionStorage.setItem('push-ligado', '1');
  } catch {
    /* sem rede ou sem sessão: tenta na próxima visita */
  }
}

export type EstadoInstalacao = 'instalada' | 'pronta' | 'ios' | 'indisponivel';

export function usarInstalacao(): {
  estado: EstadoInstalacao;
  instalar: () => Promise<boolean>;
} {
  const [evento, setEvento] = useState<EventoInstalar | null>(null);
  const [instalada, setInstalada] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    // `standalone` diz que já está a correr como app instalada.
    const jaInstalada =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    setInstalada(jaInstalada);

    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));

    const aoPedir = (e: Event) => {
      e.preventDefault();
      setEvento(e as EventoInstalar);
    };
    const aoInstalar = () => {
      setInstalada(true);
      setEvento(null);
    };

    window.addEventListener('beforeinstallprompt', aoPedir);
    window.addEventListener('appinstalled', aoInstalar);
    return () => {
      window.removeEventListener('beforeinstallprompt', aoPedir);
      window.removeEventListener('appinstalled', aoInstalar);
    };
  }, []);

  const instalar = useCallback(async () => {
    if (!evento) return false;
    await evento.prompt();
    const r = await evento.userChoice;
    // O evento é de uso único: depois de disparado, o browser não o repete.
    setEvento(null);
    return r.outcome === 'accepted';
  }, [evento]);

  const estado: EstadoInstalacao = instalada
    ? 'instalada'
    : evento
      ? 'pronta'
      : ios
        ? 'ios'
        : 'indisponivel';

  return { estado, instalar };
}

export type EstadoAvisos = 'sem-suporte' | 'desligado' | 'ligado' | 'bloqueado' | 'a-tratar';

export function usarAvisos(): {
  estado: EstadoAvisos;
  ligar: () => Promise<string | null>;
  desligar: () => Promise<void>;
  testar: () => Promise<string>;
} {
  const [estado, setEstado] = useState<EstadoAvisos>('sem-suporte');

  const sincronizar = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setEstado('sem-suporte');
      return;
    }
    if (Notification.permission === 'denied') {
      setEstado('bloqueado');
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setEstado(sub ? 'ligado' : 'desligado');
    } catch {
      setEstado('desligado');
    }
  }, []);

  useEffect(() => {
    void sincronizar();
  }, [sincronizar]);

  const ligar = useCallback(async (): Promise<string | null> => {
    setEstado('a-tratar');
    try {
      const permissao = await Notification.requestPermission();
      if (permissao !== 'granted') {
        setEstado(permissao === 'denied' ? 'bloqueado' : 'desligado');
        return 'Permissão recusada no browser.';
      }

      const chave = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!chave) {
        setEstado('desligado');
        return 'Falta a chave pública VAPID no servidor.';
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ParaBytes(chave),
      });

      const r = await fetch('/api/push/subscrever', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { erro?: string };
        setEstado('desligado');
        return j.erro ?? 'O servidor recusou a subscrição.';
      }

      setEstado('ligado');
      return null;
    } catch (err) {
      setEstado('desligado');
      return err instanceof Error ? err.message : String(err);
    }
  }, []);

  const desligar = useCallback(async () => {
    setEstado('a-tratar');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push/subscrever', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => undefined);
        await sub.unsubscribe();
      }
    } finally {
      setEstado('desligado');
    }
  }, []);

  const testar = useCallback(async (): Promise<string> => {
    const r = await apiFetch('/api/push/teste', { method: 'POST' });
    const j = (await r.json()) as {
      ok?: boolean;
      enviadas?: number;
      falhas?: number;
      removidas?: number;
      erro?: string;
    };
    if (!j.ok) return j.erro ?? 'Não foi possível enviar.';
    return `Enviadas ${j.enviadas}. Falhas ${j.falhas}. Subscrições mortas removidas: ${j.removidas}.`;
  }, []);

  return { estado, ligar, desligar, testar };
}

/**
 * A chave VAPID viaja em base64url e o `subscribe` quer um `Uint8Array`.
 *
 * base64url usa `-` e `_` onde o base64 normal usa `+` e `/`, e omite o
 * enchimento. `atob` não sabe disso — daí a conversão manual.
 *
 * O buffer é criado explicitamente como `ArrayBuffer` em vez de deixar o
 * construtor inferi-lo: `new Uint8Array(n)` tem tipo `Uint8Array<ArrayBufferLike>`,
 * que inclui `SharedArrayBuffer`, e `applicationServerKey` só aceita
 * `ArrayBuffer`. Sem isto o build falha com um erro de tipos que não descreve
 * nenhum problema real em tempo de execução.
 */
function base64ParaBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const enchimento = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + enchimento).replace(/-/g, '+').replace(/_/g, '/');
  const bruto = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(bruto.length));
  for (let i = 0; i < bruto.length; i++) bytes[i] = bruto.charCodeAt(i);
  return bytes;
}
