// Aggiornamento istantaneo con il pattern "ping senza dati".
// Il database invia sul canale pubblico un messaggio 'changed' che NON
// contiene dati: è solo un segnale. Alla ricezione rileggiamo i dati con le
// RPC protette dal codice di classe. Il contenuto del messaggio non viene
// mai usato (chiunque abbia l'anon key può inviare su un canale pubblico).
//
// Fallback: polling ogni 60 s, refetch quando la scheda torna visibile e
// quando torna la connessione.

import { sb } from './api.js';
import { CONFIG } from './config.js';
import { h } from './ui.js';

const DEBOUNCE_MS = 300;
const POLLING_MS = 60_000;

let canale = null;
let timerDebounce = null;
let timerPolling = null;
let timerRiconnessione = null;
let tentativi = 0;
let callback = () => {};
let indicatore = null;

/** Stato mostrato nell'indicatore discreto in alto. */
function impostaStato(stato) {
  if (!indicatore) return;
  const testi = {
    live: 'Aggiornato in tempo reale',
    connessione: 'Connessione…',
    riconnessione: 'Riconnessione…',
    offline: 'Offline',
    polling: 'Aggiornamento periodico',
  };
  indicatore.dataset.stato = stato;
  indicatore.replaceChildren(h('span', { class: 'live-dot', 'aria-hidden': 'true' }), h('span', { class: 'live-testo' }, testi[stato]));
  indicatore.title = testi[stato];
}

/** Richiede un refresh con debounce (raggruppa raffiche di ping). */
export function richiediAggiornamento(motivo = 'ping') {
  clearTimeout(timerDebounce);
  timerDebounce = setTimeout(() => callback(motivo), DEBOUNCE_MS);
}

function iscrivi() {
  if (!sb) return;
  if (canale) { sb.removeChannel(canale); canale = null; }
  impostaStato(tentativi ? 'riconnessione' : 'connessione');

  // Canale PUBBLICO (private: false) come il realtime.send(..., false) lato SQL.
  canale = sb.channel(CONFIG.CANALE_REALTIME, { config: { private: false, broadcast: { self: false } } })
    .on('broadcast', { event: 'changed' }, () => richiediAggiornamento('ping'))
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        const eraRiconnessione = tentativi > 0;
        tentativi = 0;
        impostaStato('live');
        // Dopo una riconnessione rileggiamo: potremmo aver perso dei ping.
        if (eraRiconnessione) richiediAggiornamento('riconnessione');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (!navigator.onLine) { impostaStato('offline'); return; }
        impostaStato('riconnessione');
        programmaRiconnessione();
      }
    });
}

function programmaRiconnessione() {
  clearTimeout(timerRiconnessione);
  tentativi++;
  const attesa = Math.min(30_000, 1000 * 2 ** Math.min(tentativi, 5));
  timerRiconnessione = setTimeout(iscrivi, attesa);
}

/**
 * Avvia realtime e fallback.
 *   onAggiorna(motivo): funzione chiamata quando i dati vanno riletti.
 */
export function avviaRealtime(onAggiorna, elementoIndicatore) {
  callback = onAggiorna;
  indicatore = elementoIndicatore;
  if (!sb) { impostaStato('offline'); return; }

  iscrivi();

  timerPolling = setInterval(() => {
    if (document.visibilityState === 'visible' && navigator.onLine) callback('polling');
  }, POLLING_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') richiediAggiornamento('visibile');
  });

  window.addEventListener('online', () => {
    tentativi = Math.max(tentativi, 1);
    iscrivi();
    richiediAggiornamento('online');
  });
  window.addEventListener('offline', () => impostaStato('offline'));
  if (!navigator.onLine) impostaStato('offline');
}

