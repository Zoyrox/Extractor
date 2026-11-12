// Service worker · Interrogazioni 5C
// - App shell: stale-while-revalidate (risponde subito dalla cache e aggiorna
//   in background). Cambia VERSIONE a ogni rilascio per forzare l'aggiornamento.
// - Librerie da CDN (URL con versione fissata): cache-first.
// - Dati: SOLO le RPC pubbliche di lettura fatte senza utente loggato,
//   network-first con fallback alla cache (consultazione offline).
//   Scelta: non stale-while-revalidate sui dati, altrimenti dopo un ping
//   realtime si vedrebbero per un attimo i dati vecchi.
// - Scritture, login e chiamate dello staff: mai in cache.

const VERSIONE = 'v1.1.0';
const CACHE_SHELL = `shell-${VERSIONE}`;
const CACHE_CDN = 'cdn-v1';
const CACHE_DATI = 'dati-v1';

const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './js/app.js',
  './js/api.js',
  './js/config.js',
  './js/draw.js',
  './js/export.js',
  './js/prefs.js',
  './js/pwa.js',
  './js/realtime.js',
  './js/router.js',
  './js/ui.js',
  './js/views/common.js',
  './js/views/public.js',
  './js/views/staff.js',
];

// RPC di sola lettura che si possono mettere in cache.
const RPC_LETTURA = /\/rest\/v1\/rpc\/(get_class_data|get_subject|get_changelog|cerca_studente)$/;
const CDN = ['cdn.jsdelivr.net'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_SHELL).then((c) =>
      c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
  // Non chiamiamo skipWaiting: aspettiamo che l'utente tocchi "Aggiorna".
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const nomi = await caches.keys();
    await Promise.all(nomi
      .filter((n) => n.startsWith('shell-') && n !== CACHE_SHELL)
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.tipo === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1) Dati pubblici (POST alle RPC di lettura, senza utente loggato).
  if (req.method === 'POST' && RPC_LETTURA.test(url.pathname) && richiestaAnonima(req)) {
    event.respondWith(datiNetworkFirst(req));
    return;
  }

  if (req.method !== 'GET') return; // tutte le altre scritture: rete diretta

  // 2) Librerie CDN con versione fissata.
  if (CDN.includes(url.hostname)) {
    event.respondWith(cacheFirst(req, CACHE_CDN));
    return;
  }

  // 3) App shell (stessa origine).
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      event.respondWith(staleWhileRevalidate(new Request('./index.html'), event));
    } else {
      event.respondWith(staleWhileRevalidate(req, event));
    }
  }
  // Tutto il resto (Supabase Auth, Realtime, chiamate staff): nessuna cache.
});

/** Vero se la richiesta usa solo la chiave pubblica (nessun utente loggato). */
function richiestaAnonima(req) {
  const auth = req.headers.get('authorization');
  const apikey = req.headers.get('apikey');
  return !auth || (apikey && auth === `Bearer ${apikey}`);
}

async function staleWhileRevalidate(req, event) {
  const cache = await caches.open(CACHE_SHELL);
  const inCache = await cache.match(req, { ignoreSearch: true });
  const rete = fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (inCache) {
    event.waitUntil(rete);
    return inCache;
  }
  return (await rete) || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

async function cacheFirst(req, nome) {
  const cache = await caches.open(nome);
  const inCache = await cache.match(req);
  if (inCache) return inCache;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

/**
 * Le richieste POST non si possono mettere in cache così come sono: usiamo
 * come chiave un URL sintetico con l'hash SHA-256 del corpo (che contiene
 * anche il codice di classe, quindi il codice non compare in chiaro).
 */
async function chiaveDati(req) {
  const corpo = await req.clone().text();
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(req.url + '|' + corpo));
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return new Request(`${self.location.origin}/__dati__/${hex}`);
}

async function datiNetworkFirst(req) {
  const chiave = await chiaveDati(req);
  const cache = await caches.open(CACHE_DATI);
  try {
    const res = await Promise.race([
      fetch(req.clone()),
      new Promise((_, ko) => setTimeout(() => ko(new Error('timeout')), 8000)),
    ]);
    // In cache solo risposte valide (non errori di codice).
    if (res.ok) {
      const testo = await res.clone().text();
      let errore = true;
      try { errore = !!JSON.parse(testo)?.errore; } catch { /* non JSON */ }
      if (!errore) {
        cache.put(chiave, new Response(testo, { headers: { 'Content-Type': 'application/json' } }));
      }
    }
    return res;
  } catch {
    const inCache = await cache.match(chiave);
    if (inCache) return inCache;
    return new Response(JSON.stringify({ message: 'Offline e nessun dato salvato' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    });
  }
}
