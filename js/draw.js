// Animazione dell'estrazione (slot machine). Mostra SOLO un risultato già
// deciso e salvato dal server: l'animazione non influisce sull'esito.

import { h, icon, dataTitolo } from './ui.js';

const DURATA_PERSONA = 3000;   // suspense per ogni nome (ms)
const PAUSA_TRA_NOMI = 900;

/**
 * @param {object} o
 * @param {string} o.materia       nome della materia
 * @param {string} o.data          data della sessione (YYYY-MM-DD)
 * @param {Array}  o.estratti      [{nome, cognome}] nell'ordine di estrazione
 * @param {Array}  o.nomiPool      nomi da far scorrere durante la suspense
 * @returns {Promise<void>} risolta alla chiusura
 */
export function mostraEstrazione({ materia, data, estratti, nomiPool }) {
  return new Promise((resolve) => {
    const ridotto = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const nomi = nomiPool.length ? nomiPool : estratti.map((p) => `${p.nome} ${p.cognome}`);

    const contatore = h('div', { class: 'contatore' });
    const slot = h('div', { class: 'slot', 'aria-hidden': 'true' }, '…');
    const annuncio = h('div', { class: 'sr-only', 'aria-live': 'assertive' });
    const lista = h('ul', { class: 'estratti-lista', 'aria-label': 'Estratti' });
    const btnSalta = h('button', { class: 'btn', type: 'button' }, 'Salta animazione');
    const btnTutto = h('button', { class: 'btn', type: 'button' }, 'Salta tutto');
    const btnChiudi = h('button', { class: 'btn btn-primary', type: 'button', hidden: true }, icon('check', 18), 'Chiudi');

    const overlay = h('div', {
      class: 'estrazione', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Estrazione di ${materia}`, tabindex: '-1',
    },
      h('div', { class: 'estrazione-head' },
        h('h2', {}, `Estrazione · ${materia}`),
        h('p', {}, dataTitolo(data))),
      h('div', { class: 'estrazione-centro' },
        h('div', {}, contatore, slot, annuncio)),
      lista,
      h('div', { class: 'estrazione-azioni' }, btnSalta, btnTutto, btnChiudi));

    const focusPrima = document.activeElement;
    document.body.append(overlay);
    document.body.style.overflow = 'hidden';
    overlay.focus();

    let indice = 0;
    let saltaCorrente = null;   // funzione che chiude subito la suspense corrente
    let saltaTutto = false;
    let timer = null;

    const rivela = (p) => {
      const nome = `${p.nome} ${p.cognome}`;
      slot.classList.remove('gira');
      slot.textContent = nome;
      slot.classList.remove('rivelato'); void slot.offsetWidth; slot.classList.add('rivelato');
      lista.append(h('li', {}, nome));
      annuncio.textContent = `Estratto: ${nome}`;
    };

    // Suspense per una persona: i nomi scorrono rallentando, poi si ferma.
    const suspense = () => new Promise((fine) => {
      if (saltaTutto) return fine();
      const inizio = performance.now();
      const durata = ridotto ? 900 : DURATA_PERSONA;
      saltaCorrente = () => { clearTimeout(timer); fine(); };
      if (ridotto) {
        slot.textContent = '…';
        timer = setTimeout(fine, durata);
        return;
      }
      slot.classList.add('gira');
      const passo = () => {
        const t = (performance.now() - inizio) / durata;
        if (t >= 1) return fine();
        slot.textContent = nomi[Math.floor(Math.random() * nomi.length)]; // solo effetto visivo
        // Intervallo crescente: da 55 ms a ~320 ms (rallentamento).
        timer = setTimeout(passo, 55 + 265 * t * t);
      };
      passo();
    });

    const attendi = (ms) => new Promise((r) => { if (saltaTutto) return r(); timer = setTimeout(r, ms); saltaCorrente = () => { clearTimeout(timer); r(); }; });

    async function esegui() {
      for (indice = 0; indice < estratti.length; indice++) {
        contatore.textContent = `${indice + 1} di ${estratti.length}`;
        await suspense();
        rivela(estratti[indice]);
        if (indice < estratti.length - 1) await attendi(PAUSA_TRA_NOMI);
      }
      fineEstrazione();
    }

    function fineEstrazione() {
      contatore.textContent = estratti.length === 1 ? 'Estratto' : `${estratti.length} estratti`;
      btnSalta.hidden = true; btnTutto.hidden = true; btnChiudi.hidden = false;
      btnChiudi.focus();
    }

    function chiudi() {
      clearTimeout(timer);
      overlay.remove();
      document.body.style.overflow = '';
      focusPrima?.focus?.();
      resolve();
    }

    btnSalta.addEventListener('click', () => saltaCorrente?.());
    btnTutto.addEventListener('click', () => {
      saltaTutto = true;
      saltaCorrente?.();
    });
    btnChiudi.addEventListener('click', chiudi);
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (btnChiudi.hidden) { saltaTutto = true; saltaCorrente?.(); } else chiudi();
      } else if ((e.key === ' ' || e.key === 'Enter') && e.target === overlay) {
        e.preventDefault(); saltaCorrente?.();
      } else if (e.key === 'Tab') {
        // Mantiene il focus dentro l'overlay.
        const btns = [...overlay.querySelectorAll('button:not([hidden])')];
        const i = btns.indexOf(document.activeElement);
        e.preventDefault();
        btns[(i + (e.shiftKey ? -1 : 1) + btns.length) % btns.length]?.focus();
      }
    });

    esegui();
  });
}
