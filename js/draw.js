// Animazione dell'estrazione a ROULETTE. Mostra SOLO un risultato già
// deciso e salvato dal server: l'animazione non influisce sull'esito.
//
// La ruota è un cilindro di nomi (in ordine alfabetico, che si ripete):
// gira, rallenta a lungo e si ferma sull'estratto, lasciando vedere i nomi
// prima e dopo. Chi esce viene tolto dalla ruota per i giri successivi.
// Opzioni (ricordate sul dispositivo): velocità, suoni, schermo intero.

import { h, icon, dataTitolo } from './ui.js';
import { prefs } from './prefs.js';

/** Velocità: durata del giro, nomi minimi che scorrono, pausa tra un nome e l'altro. */
const VELOCITA = {
  veloce:   { etichetta: 'Veloce',   durata: 3000,  minimo: 28, pausa: 1200 },
  normale:  { etichetta: 'Normale',  durata: 6500,  minimo: 45, pausa: 2200 },
  teatrale: { etichetta: 'Teatrale', durata: 10000, minimo: 60, pausa: 3000 },
};
const VISIBILI = 3;  // nomi visibili sopra e sotto il centro

// ---------------------------------------------------------------------
//  Suoni (Web Audio, nessun file da scaricare)
// ---------------------------------------------------------------------
let audio = null;
function ctxAudio() {
  if (!audio) {
    try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { audio = null; }
  }
  if (audio?.state === 'suspended') audio.resume().catch(() => {});
  return audio;
}
function nota(freq, inizio, durata, volume = 0.12, tipo = 'sine') {
  const a = ctxAudio();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = tipo;
  o.frequency.value = freq;
  g.gain.setValueAtTime(volume, a.currentTime + inizio);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + inizio + durata);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + inizio);
  o.stop(a.currentTime + inizio + durata + 0.02);
}
const suono = {
  tic: () => nota(1500 + Math.random() * 300, 0, 0.035, 0.06, 'triangle'),
  vinto: () => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => nota(f, i * 0.09, 0.6, 0.1)),
  fine: () => [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => nota(f, i * 0.12, 0.9, 0.09)),
};

// ---------------------------------------------------------------------
//  Coriandoli su canvas
// ---------------------------------------------------------------------
function coriandoli(contenitore) {
  const canvas = h('canvas', { class: 'coriandoli', 'aria-hidden': 'true' });
  contenitore.append(canvas);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.width = contenitore.clientWidth * dpr;
  const H = canvas.height = contenitore.clientHeight * dpr;
  const ctx = canvas.getContext('2d');
  const colori = ['#ffe27a', '#a5b4fc', '#f472b6', '#4ade80', '#60a5fa', '#fb923c'];
  const pezzi = Array.from({ length: 140 }, () => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: H * 0.45,
    vx: (Math.random() - 0.5) * 22 * dpr, vy: (-Math.random() * 18 - 6) * dpr,
    r: (4 + Math.random() * 6) * dpr, a: Math.random() * Math.PI, va: (Math.random() - 0.5) * 0.4,
    c: colori[Math.floor(Math.random() * colori.length)],
  }));
  const inizio = performance.now();
  const passo = (ora) => {
    const t = ora - inizio;
    ctx.clearRect(0, 0, W, H);
    for (const p of pezzi) {
      p.vy += 0.55 * dpr; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += p.va;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
      ctx.globalAlpha = Math.max(0, 1 - t / 2600);
      ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
      ctx.restore();
    }
    if (t < 2600) requestAnimationFrame(passo); else canvas.remove();
  };
  requestAnimationFrame(passo);
}

// ---------------------------------------------------------------------
//  Overlay dell'estrazione
// ---------------------------------------------------------------------

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
    let vel = VELOCITA[prefs.velocitaEstrazione] || VELOCITA.normale;
    let conSuoni = prefs.suoni;

    // Nomi sulla ruota: il pool, più eventuali estratti mancanti.
    const ruota = [...nomiPool];
    for (const p of estratti) if (!ruota.includes(nomeDi(p))) ruota.push(nomeDi(p));
    let posizione = 0;

    // --- elementi ---
    const contatore = h('div', { class: 'contatore' });
    const nastro = h('ul', { class: 'ruota-nastro', 'aria-hidden': 'true' });
    const ruotaEl = h('div', { class: 'ruota' }, nastro);
    const annuncio = h('div', { class: 'sr-only', 'aria-live': 'assertive' });
    const lista = h('ol', { class: 'estratti-lista', 'aria-label': 'Estratti' });
    const centro = h('div', { class: 'estrazione-centro' }, h('div', { class: 'estrazione-palco' }, contatore, ruotaEl, annuncio));
    const btnSalta = h('button', { class: 'btn', type: 'button' }, 'Salta animazione');
    const btnTutto = h('button', { class: 'btn', type: 'button' }, 'Salta tutto');
    const btnChiudi = h('button', { class: 'btn btn-primary', type: 'button', hidden: true }, icon('check', 18), 'Chiudi');

    const btnVel = Object.entries(VELOCITA).map(([k, v]) => h('button', {
      type: 'button', 'aria-pressed': String(v === vel),
      onclick: (e) => {
        vel = v; prefs.velocitaEstrazione = k;
        for (const b of e.currentTarget.parentNode.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
      },
    }, v.etichetta));
    const btnSuoni = h('button', { class: 'btn-icon sm', type: 'button' });
    const aggiornaSuoni = () => {
      btnSuoni.replaceChildren(icon(conSuoni ? 'volume' : 'muto', 20));
      btnSuoni.setAttribute('aria-label', conSuoni ? 'Disattiva suoni' : 'Attiva suoni');
      btnSuoni.title = btnSuoni.getAttribute('aria-label');
    };
    btnSuoni.addEventListener('click', () => { conSuoni = !conSuoni; prefs.suoni = conSuoni; if (conSuoni) ctxAudio(); aggiornaSuoni(); });
    aggiornaSuoni();
    const btnSchermo = h('button', { class: 'btn-icon sm', type: 'button' });
    const aggiornaSchermo = () => {
      const pieno = !!document.fullscreenElement;
      btnSchermo.replaceChildren(icon(pieno ? 'riduci' : 'espandi', 20));
      btnSchermo.setAttribute('aria-label', pieno ? 'Esci da schermo intero' : 'Schermo intero');
      btnSchermo.title = btnSchermo.getAttribute('aria-label');
    };

    const overlay = h('div', {
      class: 'estrazione', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Estrazione di ${materia}`, tabindex: '-1',
    },
      h('div', { class: 'estrazione-barra' },
        h('div', { class: 'velocita', role: 'group', 'aria-label': 'Velocità' }, btnVel),
        h('span', { class: 'spazio' }),
        btnSuoni,
        document.fullscreenEnabled ? btnSchermo : null),
      h('div', { class: 'estrazione-head' },
        h('h2', {}, materia),
        h('p', {}, dataTitolo(data))),
      centro,
      lista,
      h('div', { class: 'estrazione-azioni' }, btnSalta, btnTutto, btnChiudi));

    const focusPrima = document.activeElement;
    document.body.append(overlay);
    document.body.style.overflow = 'hidden';
    overlay.focus();
    if (conSuoni) ctxAudio();

    // Modalità proiettore: schermo intero automatico (se il browser lo consente).
    btnSchermo.addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else overlay.requestFullscreen?.().catch(() => {});
      prefs.schermoIntero = !document.fullscreenElement;
    });
    document.addEventListener('fullscreenchange', aggiornaSchermo);
    aggiornaSchermo();
    if (prefs.schermoIntero && document.fullscreenEnabled) overlay.requestFullscreen?.().catch(() => {});

    let saltaCorrente = null;
    let saltaTutto = false;
    let raf = null;
    let timer = null;

    function preparaNastro(passi) {
      const n = ruota.length;
      const voci = [];
      for (let k = -VISIBILI - 1; k <= passi + VISIBILI + 1; k++) {
        voci.push(h('li', {}, ruota[(((posizione + k) % n) + n) % n]));
      }
      nastro.replaceChildren(...voci);
      return voci;
    }

    /** Un giro della ruota che si ferma su `nome`. */
    function gira(nome) {
      return new Promise((fine) => {
        const n = ruota.length;
        const bersaglio = ruota.indexOf(nome);
        const distanza = (((bersaglio - posizione) % n) + n) % n;
        const veloce = ridotto || saltaTutto;
        const giri = veloce ? 0 : Math.max(1, Math.ceil((vel.minimo - distanza) / n));
        const passi = distanza + giri * n;
        const voci = preparaNastro(passi);
        const altezza = ruotaEl.clientHeight / (VISIBILI * 2 + 1) || 80;
        const offsetCentro = VISIBILI + 1; // indice della voce al centro a inizio giro
        let centroPrec = -1;

        // Posiziona il nastro: `pos` = quanti nomi sono passati (anche frazionario).
        const imposta = (pos) => {
          nastro.style.transform = `translateY(${(-pos - 1) * altezza}px)`;
          // Effetto cilindro: ruota e sfuma i nomi in base alla distanza dal centro.
          const c = Math.round(pos) + offsetCentro;
          for (let i = Math.max(0, c - VISIBILI - 1); i <= Math.min(voci.length - 1, c + VISIBILI + 1); i++) {
            const d = i - offsetCentro - pos;
            const ang = Math.max(-80, Math.min(80, d * 22));
            voci[i].style.transform = `rotateX(${-ang}deg) scale(${1 - Math.min(Math.abs(d), 3) * 0.06})`;
            voci[i].style.opacity = String(Math.max(0.12, 1 - Math.abs(d) * 0.26));
          }
          if (c !== centroPrec) {
            voci[centroPrec]?.classList.remove('centro');
            voci[c]?.classList.add('centro');
            if (centroPrec !== -1 && conSuoni && !veloce) suono.tic();
            centroPrec = c;
          }
        };
        const termina = () => {
          cancelAnimationFrame(raf);
          clearTimeout(timer);
          imposta(passi);
          voci[passi + offsetCentro].classList.add('vinto');
          ruotaEl.classList.remove('lampo'); void ruotaEl.offsetWidth; ruotaEl.classList.add('lampo');
          posizione = bersaglio;
          if (!saltaTutto) {
            if (conSuoni) suono.vinto();
            if (!ridotto) coriandoli(overlay);
          }
          fine();
        };
        saltaCorrente = termina;
        imposta(0);

        if (passi === 0 || veloce) {
          timer = setTimeout(termina, ridotto && !saltaTutto ? 900 : 0);
          return;
        }
        const inizio = performance.now();
        const durata = vel.durata;
        // Rallentamento lungo (ease-out quintico): gli ultimi nomi passano uno alla volta.
        const easing = (t) => 1 - (1 - t) ** 5;
        const passo = (ora) => {
          const t = Math.min(1, (ora - inizio) / durata);
          if (t >= 1) return termina();
          imposta(easing(t) * passi);
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

    function rimuoviDallaRuota(nome) {
      const i = ruota.indexOf(nome);
      if (i < 0 || ruota.length <= 1) return;
      ruota.splice(i, 1);
      posizione = i % ruota.length;
    }

    async function esegui() {
      // Piccola attesa iniziale: il tempo di guardare il proiettore.
      await attendi(ridotto ? 200 : 700);
      for (let i = 0; i < estratti.length; i++) {
        const nome = nomeDi(estratti[i]);
        contatore.textContent = `${i + 1} di ${estratti.length}`;
        if (i > 0) rimuoviDallaRuota(nomeDi(estratti[i - 1]));
        await gira(nome);
        lista.append(h('li', {}, nome));
        annuncio.textContent = `Estratto: ${nome}`;
        if (i < estratti.length - 1) await attendi(ridotto ? 600 : vel.pausa);
      }
      await attendi(ridotto ? 0 : 900);
      mostraRiepilogo();
    }

    /** Schermata finale: tutti gli estratti numerati, da proiettare o fotografare. */
    function mostraRiepilogo() {
      lista.hidden = true;
      centro.replaceChildren(h('div', { class: 'riepilogo' },
        h('p', { class: 'contatore' }, estratti.length === 1 ? 'Estratto' : `${estratti.length} estratti`),
        h('ol', {}, estratti.map((p) => h('li', {}, nomeDi(p))))));
      btnSalta.hidden = true; btnTutto.hidden = true; btnChiudi.hidden = false;
      if (conSuoni && !saltaTutto) suono.fine();
      btnChiudi.focus();
    }

    function chiudi() {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      document.removeEventListener('fullscreenchange', aggiornaSchermo);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
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
        const btns = [...overlay.querySelectorAll('button:not([hidden])')];
        const i = btns.indexOf(document.activeElement);
        e.preventDefault();
        btns[(i + (e.shiftKey ? -1 : 1) + btns.length) % btns.length]?.focus();
      }
    });

    esegui();
  });
}
