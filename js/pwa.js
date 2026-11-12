// PWA: registrazione del service worker, avviso "nuova versione",
// pulsante "Installa app" e istruzioni per iOS.

import { h, icon } from './ui.js';
import { prefs } from './prefs.js';

let promptInstallazione = null;

export function avviaPwa() {
  registraServiceWorker();
  gestisciInstallazione();
  avvisoIos();
}

function registraServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let aggiornamentoRichiesto = false;

  navigator.serviceWorker.register('./sw.js').then((reg) => {
    // Una nuova versione è già pronta e in attesa.
    if (reg.waiting && navigator.serviceWorker.controller) mostraAggiornamento(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const nuovo = reg.installing;
      nuovo?.addEventListener('statechange', () => {
        if (nuovo.state === 'installed' && navigator.serviceWorker.controller) mostraAggiornamento(nuovo);
      });
    });
    // Controlla aggiornamenti ogni ora e quando si torna sulla scheda.
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch((e) => console.warn('Service worker non registrato', e));

  function mostraAggiornamento(worker) {
    const b = document.getElementById('banner-aggiornamento');
    b.replaceChildren(
      icon('info', 18),
      h('span', {}, 'Nuova versione disponibile.'),
      h('button', {
        class: 'btn btn-primary btn-sm',
        onclick: () => { aggiornamentoRichiesto = true; worker.postMessage({ tipo: 'SKIP_WAITING' }); },
      }, 'Aggiorna'));
    b.hidden = false;
  }

  // Ricarica solo quando è l'utente ad aver chiesto l'aggiornamento.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (aggiornamentoRichiesto) location.reload();
  });
}

function gestisciInstallazione() {
  const btn = document.getElementById('btn-installa');
  btn.append(icon('installa'));
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    promptInstallazione = e;
    btn.hidden = false;
  });
  btn.addEventListener('click', async () => {
    if (!promptInstallazione) return;
    promptInstallazione.prompt();
    await promptInstallazione.userChoice.catch(() => {});
    promptInstallazione = null;
    btn.hidden = true;
  });
  window.addEventListener('appinstalled', () => { btn.hidden = true; });
}

/** Su iOS non esiste beforeinstallprompt: mostriamo le istruzioni una volta. */
function avvisoIos() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (!ios || standalone || prefs.iosAvvisoChiuso) return;
  const b = document.getElementById('banner-ios');
  b.replaceChildren(
    icon('condividi', 18),
    h('span', {}, 'Per installare l\'app: tocca Condividi e poi "Aggiungi a Home".'),
    h('button', {
      class: 'btn-icon sm', 'aria-label': 'Chiudi suggerimento',
      onclick: () => { prefs.iosAvvisoChiuso = true; b.hidden = true; },
    }, icon('x', 18)));
  b.hidden = false;
}
