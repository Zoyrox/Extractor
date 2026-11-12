// Utility per l'interfaccia: creazione sicura di elementi (mai innerHTML
// con dati del database), icone, formattazione date, toast e dialoghi.

import { CONFIG } from './config.js';

// ---------------------------------------------------------------------
//  Creazione elementi
// ---------------------------------------------------------------------

/**
 * Crea un elemento DOM. I figli stringa diventano nodi di testo, quindi i
 * dati provenienti dal database non vengono mai interpretati come HTML.
 *   h('button', { class: 'btn', onclick: fn, 'aria-label': 'Chiudi' }, 'Testo')
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'class') {
      el.className = v;
    } else if (k === 'dataset') {
      Object.assign(el.dataset, v);
    } else if (k === 'value') {
      el.value = v;
    } else if (v === true) {
      el.setAttribute(k, '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Svuota un contenitore e inserisce i nuovi figli. */
export function mount(container, ...children) {
  container.replaceChildren();
  appendChildren(container, children);
}

// ---------------------------------------------------------------------
//  Icone SVG inline (stringhe costanti, nessun dato esterno)
// ---------------------------------------------------------------------

const PATHS = {
  sole: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  luna: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  libro: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  calendario: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  storia: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 3"/>',
  cerca: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  utente: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  scudo: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  orologio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  freccia: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  indietro: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  pausa: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
  rimanda: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  mano: '<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>',
  dado: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  annulla: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  sposta: '<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>',
  cestino: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  matita: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  piu: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/>',
  immagine: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  esci: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  installa: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M12 18h.01"/>',
  condividi: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/>',
  segnale: '<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/>',
  gruppo: '<circle cx="9" cy="8" r="3.5"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M22 21a7 7 0 0 0-4-6.3"/>',
  impostazioni: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  auto: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
  menu: '<circle cx="12" cy="5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="19" r="1.3" fill="currentColor"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  esclamativo: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
};

/** Restituisce un elemento <svg> con l'icona richiesta. */
export function icon(name, size = 20) {
  const tpl = document.createElement('template');
  tpl.innerHTML = `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name] || ''}</svg>`;
  return tpl.content.firstElementChild;
}

// ---------------------------------------------------------------------
//  Stati delle assegnazioni: colore + icona + testo (mai solo colore)
// ---------------------------------------------------------------------

export const STATI = {
  assegnato:   { testo: 'Assegnato',   icona: 'calendario', classe: 'b-assegnato' },
  interrogato: { testo: 'Interrogato', icona: 'check',      classe: 'b-interrogato' },
  assente:     { testo: 'Assente',     icona: 'x',          classe: 'b-assente' },
  rimandato:   { testo: 'Rimandato',   icona: 'rimanda',    classe: 'b-rimandato' },
};

export function badge(stato) {
  const s = STATI[stato] || STATI.assegnato;
  return h('span', { class: `badge ${s.classe}` }, icon(s.icona, 14), s.testo);
}

// ---------------------------------------------------------------------
//  Date (formato italiano, fuso Europe/Rome)
// ---------------------------------------------------------------------

const TZ = CONFIG.FUSO_ORARIO;

/** Le date di sessione arrivano come 'YYYY-MM-DD': le trattiamo come date "pure". */
function parseDataPura(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function dataLunga(iso) {
  return new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(parseDataPura(iso));
}

/** Come dataLunga ma con l'iniziale maiuscola (per i titoli): "Venerdì 13 novembre". */
export function dataTitolo(iso) {
  const t = dataLunga(iso);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function dataBreve(iso) {
  return new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' })
    .format(parseDataPura(iso));
}

export function dataCompleta(iso) {
  return new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
    .format(parseDataPura(iso));
}

export function dataOra(ts) {
  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ,
  }).format(new Date(ts));
}

/** Oggi a Roma in formato 'YYYY-MM-DD'. */
export function oggiRoma() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

/** Differenza in giorni tra una data di sessione e oggi (Roma). */
export function giorniDa(iso) {
  return Math.round((parseDataPura(iso) - parseDataPura(oggiRoma())) / 86400000);
}

export function quandoRelativo(iso) {
  const g = giorniDa(iso);
  if (g === 0) return 'oggi';
  if (g === 1) return 'domani';
  if (g === -1) return 'ieri';
  if (g > 1 && g < 7) return `tra ${g} giorni`;
  if (g < 0) return 'passata';
  return '';
}

export function nomeCompleto(p) {
  return `${p.nome} ${p.cognome}`;
}

// ---------------------------------------------------------------------
//  Toast, dialoghi, stati di caricamento
// ---------------------------------------------------------------------

export function toast(msg, tipo = 'info', durata = 3500) {
  let box = document.getElementById('toasts');
  const t = h('div', { class: `toast toast-${tipo}`, role: tipo === 'errore' ? 'alert' : 'status' },
    icon(tipo === 'errore' ? 'esclamativo' : tipo === 'ok' ? 'check' : 'info', 18), h('span', {}, msg));
  box.append(t);
  setTimeout(() => { t.classList.add('esce'); setTimeout(() => t.remove(), 300); }, durata);
}

/**
 * Dialogo modale generico basato su <dialog>. Restituisce una Promise con
 * il valore passato a chiudi(), o null se annullato.
 *   corpo: funzione (chiudi) => Node
 */
export function dialogo(titolo, corpo, { larghezza = '' } = {}) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: `dialog ${larghezza}`, 'aria-labelledby': 'dlg-titolo' });
    let valore = null;
    const chiudi = (v = null) => { valore = v; dlg.close(); };
    dlg.append(
      h('div', { class: 'dialog-head' },
        h('h2', { id: 'dlg-titolo' }, titolo),
        h('button', { class: 'btn-icon', type: 'button', 'aria-label': 'Chiudi', onclick: () => chiudi(null) }, icon('x'))),
      h('div', { class: 'dialog-body' }, corpo(chiudi)));
    dlg.addEventListener('close', () => { dlg.remove(); resolve(valore); });
    document.body.append(dlg);
    dlg.showModal();
    // Porta il focus sul primo campo utile.
    const primo = dlg.querySelector('.dialog-body input, .dialog-body select, .dialog-body textarea, .dialog-body button');
    primo?.focus();
  });
}

/**
 * Conferma prima di un'azione. Con chiediMotivo mostra un campo di testo
 * (obbligatorio se motivoObbligatorio). Ritorna { motivo } oppure null.
 */
export function conferma({ titolo, messaggio, ok = 'Conferma', pericolo = false, chiediMotivo = false, motivoObbligatorio = false }) {
  return dialogo(titolo, (chiudi) => {
    const motivo = h('textarea', { id: 'cf-motivo', rows: 2, maxlength: 200, placeholder: motivoObbligatorio ? 'Obbligatorio' : 'Facoltativo' });
    const err = h('p', { class: 'campo-errore', role: 'alert' });
    const form = h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        const m = motivo.value.trim();
        if (motivoObbligatorio && m.length < 3) { err.textContent = 'Scrivi il motivo (almeno 3 caratteri).'; motivo.focus(); return; }
        chiudi({ motivo: m });
      },
    },
      messaggio ? h('p', {}, messaggio) : null,
      chiediMotivo ? h('label', { class: 'campo' }, h('span', {}, 'Motivo'), motivo) : null,
      err,
      h('div', { class: 'azioni' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => chiudi(null) }, 'Annulla'),
        h('button', { class: `btn ${pericolo ? 'btn-danger' : 'btn-primary'}`, type: 'submit' }, ok)));
    return form;
  });
}

/** Blocchi "skeleton" durante il caricamento. */
export function skeleton(righe = 3) {
  return h('div', { class: 'stack', 'aria-busy': 'true', 'aria-label': 'Caricamento in corso' },
    Array.from({ length: righe }, () => h('div', { class: 'card skeleton' },
      h('div', { class: 'sk sk-titolo' }), h('div', { class: 'sk sk-riga' }), h('div', { class: 'sk sk-riga corta' }))));
}

export function vuoto(titolo, testo, iconaNome = 'calendario', ...extra) {
  return h('div', { class: 'vuoto' },
    h('div', { class: 'vuoto-icona' }, icon(iconaNome, 32)),
    h('h2', {}, titolo), testo ? h('p', {}, testo) : null, ...extra);
}

export function erroreBox(msg, riprova) {
  return h('div', { class: 'vuoto errore' },
    h('div', { class: 'vuoto-icona' }, icon('esclamativo', 32)),
    h('h2', {}, 'Qualcosa è andato storto'),
    h('p', {}, msg),
    riprova ? h('button', { class: 'btn btn-primary', onclick: riprova }, 'Riprova') : null);
}

/** Evidenzia brevemente un elemento cambiato (rispetta reduced motion via CSS). */
export function evidenzia(el) {
  el.classList.remove('cambiato');
  void el.offsetWidth; // riavvia l'animazione
  el.classList.add('cambiato');
  setTimeout(() => el.classList.remove('cambiato'), 2000);
}

/** Sostituisce il contenuto della vista con una dissolvenza leggera. */
export function aggiornaVista(container, nuovoContenuto) {
  container.classList.add('in-aggiornamento');
  requestAnimationFrame(() => {
    mount(container, nuovoContenuto);
    container.classList.remove('in-aggiornamento');
  });
}

/** Normalizza una stringa per la ricerca (minuscole, senza accenti). */
export function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

/** Genera uno slug valido dal nome della materia. */
export function slugify(s) {
  return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/**
 * Mostra "dati aggiornati al …" quando i dati non sono freschi (risposta
 * servita dalla cache offline del service worker). I dati appena letti dal
 * server hanno generato_il ≈ adesso.
 */
export function segnalaFreschezza(generatoIl) {
  const b = document.getElementById('banner-offline');
  if (!b || !generatoIl) return;
  const eta = Date.now() - new Date(generatoIl).getTime();
  if (eta > 90_000) {
    b.replaceChildren(icon('segnale', 18),
      h('span', {}, `${navigator.onLine ? 'Connessione instabile' : 'Sei offline'}: dati aggiornati al ${dataOra(generatoIl)}.`));
    b.hidden = false;
  } else {
    b.hidden = true;
  }
}

export function meseBreve(iso) {
  return new Intl.DateTimeFormat('it-IT', { month: 'short', timeZone: 'UTC' }).format(parseDataPura(iso)).replace('.', '');
}
export function giornoNumero(iso) {
  return String(Number(iso.split('-')[2]));
}

/**
 * Trasforma un testo in nodi, rendendo i link http(s) cliccabili e
 * abbreviati (es. "classroom.google.com/…"). Mai innerHTML: solo nodi.
 * Con cliccabile = false (es. dentro un'altra <a>) mostra solo il testo breve.
 */
export function testoConLink(testo, cliccabile = true) {
  const out = [];
  const re = /https?:\/\/[^\s<>"']+/g;
  let ultimo = 0;
  for (const m of String(testo || '').matchAll(re)) {
    if (m.index > ultimo) out.push(testo.slice(ultimo, m.index));
    let url = null;
    try { url = new URL(m[0]); } catch { /* non è un URL valido */ }
    if (url && (url.protocol === 'https:' || url.protocol === 'http:')) {
      const breve = url.hostname.replace(/^www\./, '') + (url.pathname.length > 1 ? '/…' : '');
      out.push(cliccabile
        ? h('a', { class: 'link-esterno', href: url.href, target: '_blank', rel: 'noopener noreferrer', title: url.href },
            icon('link', 14), h('span', {}, breve))
        : breve);
    } else {
      out.push(m[0]);
    }
    ultimo = m.index + m[0].length;
  }
  if (ultimo < String(testo || '').length) out.push(String(testo).slice(ultimo));
  return out;
}

/** Versione solo testo (per export e messaggi): URL abbreviati. */
export function testoBreve(testo) {
  return testoConLink(testo, false).join('');
}
