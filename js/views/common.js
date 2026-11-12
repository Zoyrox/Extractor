// Logica comune alle viste: caricamento con skeleton, gestione errori e
// aggiornamento "morbido" con evidenziazione di ciò che è cambiato.

import { CodiceError } from '../api.js';
import { prefs } from '../prefs.js';
import { vai, percorsoCorrente } from '../router.js';
import { mount, skeleton, erroreBox, evidenzia, toast, segnalaFreschezza } from '../ui.js';

export const vistaEl = () => document.getElementById('view');

/**
 * Crea una vista che carica dati e li disegna in `container`.
 *  - carica(): Promise con i dati
 *  - disegna(dati): Node
 * Gli elementi con data-key / data-firma vengono confrontati tra un
 * aggiornamento e l'altro: quelli nuovi o cambiati vengono evidenziati.
 * Restituisce { aggiorna(motivo), distruggi() } per il router e il realtime.
 */
export function creaVista(container, { carica, disegna, righeSkeleton = 3 }) {
  let firme = null;          // null = primo caricamento non ancora riuscito
  let attivo = true;
  let inCorso = false;
  let daRifare = false;

  async function aggiorna(motivo = 'iniziale') {
    if (!attivo) return;
    if (inCorso) { daRifare = true; return; }
    inCorso = true;
    const primo = firme === null;
    if (primo) mount(container, skeleton(righeSkeleton));
    try {
      const dati = await carica();
      if (!attivo) return;
      if (dati?.generato_il) segnalaFreschezza(dati.generato_il);
      const nodo = disegna(dati);
      container.classList.add('in-aggiornamento');
      mount(container, nodo);
      requestAnimationFrame(() => container.classList.remove('in-aggiornamento'));
      const nuove = new Map();
      container.querySelectorAll('[data-key]').forEach((el) => {
        const firma = el.dataset.firma || '';
        nuove.set(el.dataset.key, firma);
        if (!primo && firme.get(el.dataset.key) !== firma) evidenzia(el);
      });
      firme = nuove;
    } catch (e) {
      if (!attivo) return;
      if (e instanceof CodiceError && (e.tipo === 'errato' || e.tipo === 'mancante')) {
        // Codice cambiato o mai inserito: torna alla schermata di accesso.
        prefs.codice = null;
        const { path } = percorsoCorrente();
        if (e.tipo === 'errato') toast('Il codice di classe non è più valido: inseriscilo di nuovo.', 'errore');
        vai('/accesso?dopo=' + encodeURIComponent(path));
        return;
      }
      if (primo) mount(container, erroreBox(e.message, () => aggiorna('riprova')));
      else if (motivo !== 'polling' && motivo !== 'visibile') toast(e.message, 'errore');
    } finally {
      inCorso = false;
      if (daRifare && attivo) { daRifare = false; aggiorna('accodato'); }
    }
  }

  aggiorna();
  return {
    aggiorna,
    /** Forza il ricaricamento completo (es. cambio filtri). */
    ricarica() { firme = null; return aggiorna('ricarica'); },
    distruggi() { attivo = false; },
  };
}

/** Firma compatta di un oggetto, per capire se è cambiato. */
export const firma = (o) => JSON.stringify(o);

/** Ricorda lo stato aperto/chiuso dei <details> tra un refresh e l'altro. */
const dettagliAperti = new Map();
export function dettagli(chiave, apertoDefault, summary, ...contenuto) {
  const d = document.createElement('details');
  d.open = dettagliAperti.has(chiave) ? dettagliAperti.get(chiave) : apertoDefault;
  d.addEventListener('toggle', () => dettagliAperti.set(chiave, d.open));
  const s = document.createElement('summary');
  s.append(summary);
  d.append(s, ...contenuto.flat().filter(Boolean));
  return d;
}
