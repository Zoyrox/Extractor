// Animazione dell'estrazione a ROULETTE. Mostra SOLO un risultato già
// deciso e salvato dal server: l'animazione non influisce sull'esito.
//
// La ruota è un nastro verticale con i nomi del sorteggio in ordine
// alfabetico (che si ripete): gira, rallenta e si ferma sull'estratto,
// lasciando vedere i due nomi prima e i due dopo. Chi esce viene tolto
// dalla ruota per i giri successivi.

import { h, icon, dataTitolo } from './ui.js';

const DURATA_GIRO = 3200;      // suspense per ogni nome (ms)
const PAUSA_TRA_NOMI = 1100;
const VISIBILI_SOPRA = 2;      // nomi visibili sopra e sotto il centro

/**
 * @param {object} o
 * @param {string} o.materia       nome della materia
 * @param {string} o.data          data della sessione (YYYY-MM-DD)
 * @param {Array}  o.estratti      [{nome, cognome}] nell'ordine di estrazione
 * @param {Array}  o.nomiPool      nomi del sorteggio ("Nome Cognome"), in ordine
 * @returns {Promise<void>} risolta alla chiusura
 */
export function mostraEstrazione({ materia, data, estratti, nomiPool }) {
  return new Promise((resolve) => {
    const ridotto = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const nomeDi = (p) => `${p.nome} ${p.cognome}`;

    // Nomi sulla ruota: il pool, più eventuali estratti mancanti.
    let ruota = [...nomiPool];
    for (const p of estratti) if (!ruota.includes(nomeDi(p))) ruota.push(nomeDi(p));
    let posizione = 0; // indice del nome attualmente al centro

    const contatore = h('div', { class: 'contatore' });
    const nastro = h('ul', { class: 'ruota-nastro', 'aria-hidden': 'true' });
    const ruotaEl = h('div', { class: 'ruota' }, nastro);
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
        h('div', { style: 'width:100%;display:grid;justify-items:center;gap:.5rem' }, contatore, ruotaEl, annuncio)),
      lista,
      h('div', { class: 'estrazione-azioni' }, btnSalta, btnTutto, btnChiudi));

    const focusPrima = document.activeElement;
    document.body.append(overlay);
    document.body.style.overflow = 'hidden';
    overlay.focus();

    let saltaCorrente = null;
    let saltaTutto = false;
    let raf = null;
    let timer = null;

    /** Disegna il nastro a partire da `posizione` per `passi` nomi. */
    function preparaNastro(passi) {
      const n = ruota.length;
      const voci = [];
      for (let k = -VISIBILI_SOPRA; k <= passi + VISIBILI_SOPRA; k++) {
        voci.push(h('li', {}, ruota[(((posizione + k) % n) + n) % n]));
      }
      nastro.replaceChildren(...voci);
      nastro.style.transform = 'translateY(0)';
      return voci;
    }

    /** Un giro della ruota che si ferma su `nome`. */
    function gira(nome) {
      return new Promise((fine) => {
        const n = ruota.length;
        const bersaglio = ruota.indexOf(nome);
        const distanza = (((bersaglio - posizione) % n) + n) % n;
        // Almeno ~30 nomi che scorrono: con pochi nomi si fanno più giri.
        const giri = ridotto || saltaTutto ? 0 : Math.max(1, Math.ceil((30 - distanza) / n));
        const passi = distanza + giri * n;
        const voci = preparaNastro(passi);
        const altezza = voci[0].getBoundingClientRect().height || 80;
        let centroPrec = -1;

        const imposta = (avanzamento) => {
          const pos = avanzamento * passi;
          nastro.style.transform = `translateY(${-pos * altezza}px)`;
          const centro = Math.round(pos) + VISIBILI_SOPRA;
          if (centro !== centroPrec) {
            voci[centroPrec]?.classList.remove('centro');
            voci[centro]?.classList.add('centro');
            centroPrec = centro;
          }
        };
        const termina = () => {
          cancelAnimationFrame(raf);
          imposta(1);
          voci[passi + VISIBILI_SOPRA].classList.add('vinto');
          posizione = bersaglio;
          fine();
        };
        saltaCorrente = termina;

        if (passi === 0 || ridotto || saltaTutto) {
          imposta(0);
          timer = setTimeout(termina, ridotto && !saltaTutto ? 700 : 0);
          return;
        }
        const inizio = performance.now();
        // Rallentamento finale (ease-out quartico): suspense sugli ultimi nomi.
        const easing = (t) => 1 - (1 - t) ** 4;
        const passo = (ora) => {
          const t = Math.min(1, (ora - inizio) / DURATA_GIRO);
          if (t >= 1) return termina();
          imposta(easing(t));
          raf = requestAnimationFrame(passo);
        };
        raf = requestAnimationFrame(passo);
      });
    }

    const attendi = (ms) => new Promise((r) => {
      if (saltaTutto) return r();
      timer = setTimeout(r, ms);
      saltaCorrente = () => { clearTimeout(timer); r(); };
    });

    /** Toglie dalla ruota chi è appena uscito (il centro passa al successivo). */
    function rimuoviDallaRuota(nome) {
      const i = ruota.indexOf(nome);
      if (i < 0 || ruota.length <= 1) return;
      ruota.splice(i, 1);
      posizione = i % ruota.length;
    }

    async function esegui() {
      for (let i = 0; i < estratti.length; i++) {
        const nome = nomeDi(estratti[i]);
        contatore.textContent = `${i + 1} di ${estratti.length}`;
        if (i > 0) { rimuoviDallaRuota(nomeDi(estratti[i - 1])); }
        await gira(nome);
        lista.append(h('li', {}, nome));
        annuncio.textContent = `Estratto: ${nome}`;
        if (i < estratti.length - 1) await attendi(PAUSA_TRA_NOMI);
      }
      contatore.textContent = estratti.length === 1 ? 'Estratto' : `${estratti.length} estratti`;
      btnSalta.hidden = true; btnTutto.hidden = true; btnChiudi.hidden = false;
      btnChiudi.focus();
    }

    function chiudi() {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      overlay.remove();
      document.body.style.overflow = '';
      focusPrima?.focus?.();
      resolve();
    }

    btnSalta.addEventListener('click', () => saltaCorrente?.());
    btnTutto.addEventListener('click', () => { saltaTutto = true; saltaCorrente?.(); });
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
