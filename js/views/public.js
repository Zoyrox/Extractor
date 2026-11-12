// Viste pubbliche (compagni, sola lettura): home, materia, registro,
// "cerca il mio nome" e schermata del codice di classe.

import { api, sessione } from '../api.js';
import { prefs } from '../prefs.js';
import { vai, sostituisciQuery } from '../router.js';
import {
  h, icon, mount, badge, toast, vuoto, dataLunga, dataTitolo, dataOra, quandoRelativo, giorniDa,
  meseBreve, giornoNumero, nomeCompleto, conferma,
} from '../ui.js';
import { creaVista, firma, dettagli, vistaEl } from './common.js';
import { apriEsportazione } from '../export.js';

// ---------------------------------------------------------------------
//  Accesso con codice di classe
// ---------------------------------------------------------------------

export function accesso(_params, query) {
  const dopo = query.get('dopo') || '/';
  const input = h('input', {
    id: 'codice', type: 'password', autocomplete: 'current-password', required: true,
    minlength: 1, maxlength: 100, 'aria-describedby': 'codice-aiuto',
  });
  const mostra = h('label', { class: 'check' },
    h('input', { type: 'checkbox', onchange: (e) => { input.type = e.target.checked ? 'text' : 'password'; } }),
    'Mostra il codice');
  const errore = h('p', { class: 'campo-errore', role: 'alert' });
  const invia = h('button', { class: 'btn btn-primary btn-blocco', type: 'submit' }, 'Entra');

  const form = h('form', {
    class: 'card',
    onsubmit: async (e) => {
      e.preventDefault();
      const c = input.value.trim();
      if (!c) { errore.textContent = 'Inserisci il codice.'; return; }
      invia.disabled = true; errore.textContent = '';
      try {
        await api.verificaCodice(c);
        prefs.codice = c;
        toast('Accesso effettuato', 'ok');
        vai(dopo.startsWith('/') && !dopo.startsWith('/accesso') ? dopo : '/');
      } catch (err) {
        errore.textContent = err.message;
        input.focus();
      } finally {
        invia.disabled = false;
      }
    },
  },
    h('label', { class: 'campo', for: 'codice' },
      h('span', {}, 'Codice di classe'),
      input,
      h('small', { id: 'codice-aiuto' }, 'Lo trovi nel gruppo della classe. Verrà ricordato su questo dispositivo.')),
    mostra, errore, invia);

  mount(vistaEl(), h('div', { class: 'accesso' },
    h('img', { class: 'logo-grande', src: 'icons/icon.svg', alt: '' }),
    h('h1', {}, 'Interrogazioni 5C'),
    h('p', { class: 'muted' }, 'Consulta le date delle interrogazioni e chi è stato estratto.'),
    form,
    h('p', { class: 'muted piccolo', style: 'margin-top:1rem' },
      'Sei admin o rappresentante? ', h('a', { href: '#/staff' }, 'Accedi all\'area staff'))));
  input.focus();
}

/** Pulsante "Esci da questo dispositivo" (dimentica il codice). */
function pulsanteEsci() {
  if (!prefs.codice) return null;
  return h('button', {
    class: 'btn btn-ghost btn-sm',
    onclick: async () => {
      const ok = await conferma({ titolo: 'Uscire?', messaggio: 'Il codice di classe verrà dimenticato su questo dispositivo e i dati salvati per l\'uso offline verranno cancellati.', ok: 'Esci' });
      if (!ok) return;
      prefs.codice = null;
      try { await caches.delete('dati-v1'); } catch { /* cache non disponibile */ }
      vai(sessione.isStaff ? '/' : '/accesso');
    },
  }, icon('esci', 16), 'Esci da questo dispositivo');
}

// ---------------------------------------------------------------------
//  Home: materie con la prossima data
// ---------------------------------------------------------------------

export function home() {
  const lista = h('div');
  const cerca = h('input', { type: 'search', placeholder: 'Cerca il tuo nome…', 'aria-label': 'Cerca il tuo nome', autocomplete: 'off' });
  mount(vistaEl(),
    h('div', { class: 'titolo-pagina' },
      h('div', {}, h('h1', {}, 'Materie'), h('p', { class: 'sotto' }, 'Le prossime interrogazioni della classe'))),
    h('form', {
      class: 'cerca-box', role: 'search', style: 'margin-bottom:1.25rem',
      onsubmit: (e) => { e.preventDefault(); vai('/cerca?q=' + encodeURIComponent(cerca.value.trim())); },
    }, icon('cerca', 18), cerca),
    lista,
    h('div', { class: 'azioni', style: 'justify-content:center;margin-top:2rem' }, pulsanteEsci()));

  return creaVista(lista, {
    carica: api.classe,
    disegna: (d) => {
      if (!d.materie.length) {
        return vuoto('Nessuna materia', 'L\'amministratore non ha ancora creato le materie.', 'libro');
      }
      return h('div', { class: 'griglia' }, d.materie.map(cardMateria));
    },
  });
}

function cardMateria(m) {
  const p = m.prossima;
  const rel = p ? quandoRelativo(p.data) : '';
  return h('a', {
    class: 'card materia-card', href: `#/materia/${encodeURIComponent(m.slug)}`,
    'data-key': `m-${m.id}`, 'data-firma': firma([m.nome, p]),
  },
    h('div', { class: 'card-head' },
      h('h2', {}, m.nome),
      h('span', { class: 'freccia' }, icon('freccia', 18))),
    p
      ? [
          h('p', { class: 'prossima-data' }, 'Prossima: ', dataLunga(p.data), rel ? h('span', { class: 'tag accent', style: 'margin-left:.4rem' }, rel) : null),
          p.argomento ? h('p', { class: 'meta' }, p.argomento) : null,
          h('p', { class: 'meta' }, p.n_assegnati ? `${p.n_assegnati} di ${p.max_interrogati} già estratti` : `${p.max_interrogati} da interrogare · estrazione da fare`),
        ]
      : h('p', { class: 'meta' }, m.n_sessioni ? 'Nessuna interrogazione in programma' : 'Nessuna sessione creata'));
}

// ---------------------------------------------------------------------
//  Pagina materia
// ---------------------------------------------------------------------

export function materia({ slug }) {
  const cont = h('div');
  mount(vistaEl(), cont);
  return creaVista(cont, {
    carica: () => api.materia(slug),
    disegna: (d) => disegnaMateria(d),
    righeSkeleton: 4,
  });
}

function disegnaMateria(d) {
  const oggi = d.oggi;
  const future = d.sessioni.filter((s) => s.data >= oggi);
  const passate = d.sessioni.filter((s) => s.data < oggi).reverse();
  const idProssima = future[0]?.id;

  const condividi = async () => {
    const url = location.href;
    try {
      if (navigator.share) await navigator.share({ title: `Interrogazioni di ${d.materia.nome}`, url });
      else { await navigator.clipboard.writeText(url); toast('Link copiato', 'ok'); }
    } catch { /* condivisione annullata */ }
  };

  return h('div', {},
    h('a', { href: '#/', class: 'btn btn-ghost btn-sm', style: 'margin-bottom:.5rem' }, icon('indietro', 16), 'Materie'),
    h('div', { class: 'titolo-pagina' },
      h('div', { style: 'flex:1 1 220px;min-width:0' },
        h('h1', {}, d.materia.nome),
        h('p', { class: 'sotto' }, `${d.sessioni.length} ${d.sessioni.length === 1 ? 'sessione' : 'sessioni'}`)),
      h('div', { class: 'riga' },
        h('button', { class: 'btn btn-sm', onclick: condividi }, icon('link', 16), 'Condividi'),
        h('button', { class: 'btn btn-sm', onclick: () => apriEsportazione(d) }, icon('download', 16), 'Esporta'))),

    d.sessioni.length === 0
      ? vuoto('Nessuna sessione', 'Non sono ancora state fissate date per questa materia.')
      : h('div', { class: 'stack' },
          future.length ? future.map((s) => cardSessione(s, { prossima: s.id === idProssima })) :
            h('div', { class: 'card' }, h('p', { class: 'muted', style: 'margin:0' }, 'Nessuna interrogazione in programma.')),
          passate.length
            ? dettagli(`passate-${d.materia.slug}`, false,
                h('span', { class: 'btn btn-ghost btn-sm' }, icon('orologio', 16), `Sessioni passate (${passate.length})`),
                h('div', { class: 'stack', style: 'margin-top:.75rem' }, passate.map((s) => cardSessione(s, { passata: true }))))
            : null),

    d.ultime_modifiche.length
      ? h('section', { class: 'sezione' },
          h('h2', {}, icon('storia', 16), 'Ultime modifiche'),
          h('div', { class: 'card' }, d.ultime_modifiche.map(voceRegistro)),
          h('p', { style: 'margin-top:.75rem' }, h('a', { href: `#/registro?materia=${encodeURIComponent(d.materia.slug)}` }, 'Vedi tutto il registro di ', d.materia.nome)))
      : null);
}

export function cardSessione(s, { prossima = false, passata = false } = {}) {
  const rel = quandoRelativo(s.data);
  const presenti = s.interrogati;
  return h('article', {
    class: `card ${prossima ? 'prossima' : ''} ${passata ? 'passata' : ''}`,
    'data-key': `s-${s.id}`, 'data-firma': firma([s.data, s.argomento, s.max_interrogati, presenti, s.non_presenti]),
    'aria-label': `Sessione di ${dataLunga(s.data)}`,
  },
    h('div', { class: 'card-head' },
      h('div', { class: 'data-blocco', 'aria-hidden': 'true' },
        h('span', { class: 'giorno' }, giornoNumero(s.data)), h('span', { class: 'mese' }, meseBreve(s.data))),
      h('div', { style: 'flex:1 1 220px;min-width:0' },
        h('div', { class: 'riga' },
          h('h3', {}, dataTitolo(s.data)),
          prossima ? h('span', { class: 'tag accent' }, 'Prossima') : null,
          rel && rel !== 'passata' ? h('span', { class: 'tag' }, rel) : null,
          passata ? h('span', { class: 'tag' }, 'Passata') : null),
        s.argomento ? h('p', { class: 'meta' }, s.argomento) : null,
        h('p', { class: 'posti' }, `${presenti.length} di ${s.max_interrogati} interrogati`))),
    presenti.length || s.non_presenti.length
      ? h('ul', { class: 'persone' },
          presenti.map(rigaPersona),
          s.non_presenti.map(rigaPersona))
      : h('p', { class: 'muted piccolo', style: 'margin:.75rem 0 0' }, passata ? 'Nessun interrogato registrato.' : 'Estrazione non ancora effettuata.'));
}

function rigaPersona(p) {
  return h('li', { class: 'persona', 'data-key': `a-${p.id}`, 'data-firma': firma([p.stato, p.nota]) },
    h('span', { class: 'nome' }, nomeCompleto(p)),
    badge(p.stato),
    p.volontario ? h('span', { class: 'tag' }, icon('mano', 14), 'Volontario') : null,
    p.nota ? h('span', { class: 'nota' }, 'Motivo: ', p.nota) : null);
}

// ---------------------------------------------------------------------
//  Registro modifiche
// ---------------------------------------------------------------------

const ICONE_TIPO = {
  estrazione: 'dado', stato: 'check', spostamento: 'sposta', riassegnazione: 'sposta',
  aggiunta: 'piu', rimozione: 'cestino', annullamento: 'annulla', elenco: 'gruppo',
  sessione: 'calendario', materia: 'libro', esclusione: 'pausa',
};

export function voceRegistro(v) {
  const chi = v.studente_nome ? `${v.studente_nome} ${v.studente_cognome}` : (v.materia_nome || 'Classe');
  return h('div', { class: 'voce' },
    h('div', { class: 'voce-icona', 'aria-hidden': 'true' }, icon(ICONE_TIPO[v.tipo] || 'info', 18)),
    h('div', {},
      h('div', { class: 'voce-titolo' }, chi),
      h('div', { class: 'voce-dettagli' },
        v.azione,
        v.materia_nome && v.studente_nome ? ` · ${v.materia_nome}` : '',
        ' · ', h('time', { datetime: v.creato_il }, dataOra(v.creato_il)))),
    v.motivo ? h('div', { class: 'voce-motivo' }, 'Motivo: ', v.motivo) : null);
}

export function registro(_params, query) {
  const filtro = { slug: query.get('materia') || '', studente: query.get('studente') || '', limit: 100 };
  const selMateria = h('select', { id: 'f-materia', 'aria-label': 'Filtra per materia' }, h('option', { value: '' }, 'Tutte le materie'));
  const inStudente = h('input', { id: 'f-studente', type: 'search', placeholder: 'Filtra per studente', value: filtro.studente, 'aria-label': 'Filtra per studente' });
  const risultati = h('div');

  mount(vistaEl(),
    h('div', { class: 'titolo-pagina' },
      h('div', {}, h('h1', {}, 'Registro modifiche'), h('p', { class: 'sotto' }, 'Estrazioni, spostamenti, assenze e ogni altra modifica.'))),
    h('div', { class: 'filtri' }, selMateria, h('div', { class: 'cerca-box' }, icon('cerca', 18), inStudente)),
    risultati);

  // Elenco materie per il filtro (non bloccante).
  api.classe().then((d) => {
    for (const m of d.materie) selMateria.append(h('option', { value: m.slug }, m.nome));
    selMateria.value = filtro.slug;
  }).catch(() => {});

  const vista = creaVista(risultati, {
    carica: () => api.registro({ slug: filtro.slug || null, studente: filtro.studente || null, limit: filtro.limit }),
    disegna: (d) => disegnaRegistro(d.voci, () => { filtro.limit += 100; vista.aggiorna('altri'); }, filtro.limit),
  });

  const applica = () => {
    sostituisciQuery({ materia: filtro.slug, studente: filtro.studente });
    filtro.limit = 100;
    vista.ricarica();
  };
  selMateria.addEventListener('change', () => { filtro.slug = selMateria.value; applica(); });
  let t;
  inStudente.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => { filtro.studente = inStudente.value.trim(); applica(); }, 350);
  });
  return vista;
}

function disegnaRegistro(voci, caricaAltri, limite) {
  if (!voci.length) return vuoto('Nessuna modifica', 'Non ci sono voci che corrispondono ai filtri.', 'storia');
  // Raggruppa per giorno (fuso di Roma).
  const fmt = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Rome' });
  const gruppi = new Map();
  for (const v of voci) {
    const g = fmt.format(new Date(v.creato_il));
    if (!gruppi.has(g)) gruppi.set(g, []);
    gruppi.get(g).push(v);
  }
  return h('div', {},
    [...gruppi].map(([giorno, lista]) => h('section', { class: 'giorno-registro' },
      h('h3', {}, giorno),
      h('div', { class: 'card' }, lista.map(voceRegistro)))),
    voci.length >= limite
      ? h('div', { class: 'azioni', style: 'justify-content:center' }, h('button', { class: 'btn', onclick: caricaAltri }, 'Carica altre voci'))
      : null);
}

// ---------------------------------------------------------------------
//  Cerca il mio nome
// ---------------------------------------------------------------------

export function cerca(_params, query) {
  let q = query.get('q') ?? prefs.mioNome ?? '';
  const input = h('input', { type: 'search', value: q, placeholder: 'Nome o cognome', 'aria-label': 'Nome o cognome', autocomplete: 'off' });
  const ricorda = h('input', { type: 'checkbox', checked: !!prefs.mioNome });
  const risultati = h('div');

  mount(vistaEl(),
    h('div', { class: 'titolo-pagina' },
      h('div', {}, h('h1', {}, 'Le mie interrogazioni'), h('p', { class: 'sotto' }, 'Trova subito le tue date in tutte le materie.'))),
    h('div', { class: 'cerca-box', style: 'margin-bottom:.6rem' }, icon('cerca', 18), input),
    h('label', { class: 'check piccolo' }, ricorda, 'Ricorda il mio nome su questo dispositivo'),
    risultati);

  const vista = creaVista(risultati, {
    carica: () => (q.length >= 2 ? api.cerca(q) : Promise.resolve({ risultati: null })),
    disegna: (d) => disegnaRicerca(d.risultati, q),
    righeSkeleton: 2,
  });

  const salva = () => { prefs.mioNome = ricorda.checked && q ? q : null; };
  ricorda.addEventListener('change', salva);
  let t;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      q = input.value.trim();
      sostituisciQuery({ q });
      salva();
      vista.ricarica();
    }, 350);
  });
  if (!q) input.focus();
  return vista;
}

function disegnaRicerca(risultati, q) {
  if (risultati === null) return vuoto('Scrivi il tuo nome', 'Almeno 2 lettere, nome o cognome.', 'cerca');
  if (!risultati.length) return vuoto('Nessuno trovato', `Nessuno studente corrisponde a "${q}".`, 'cerca');
  return h('div', { class: 'stack' }, risultati.map((r) =>
    h('article', { class: 'card', 'data-key': `r-${r.nome}-${r.cognome}`, 'data-firma': firma(r.date) },
      h('h2', {}, `${r.nome} ${r.cognome}`),
      r.date.length
        ? h('ul', { class: 'persone' }, r.date.map((x) =>
            h('li', { class: 'persona', style: giorniDa(x.data) < 0 ? 'opacity:.75' : '' },
              h('a', { class: 'nome', href: `#/materia/${encodeURIComponent(x.slug)}` }, x.materia),
              h('span', {}, dataTitolo(x.data)),
              badge(x.stato),
              x.volontario ? h('span', { class: 'tag' }, icon('mano', 14), 'Volontario') : null,
              x.argomento ? h('span', { class: 'nota' }, x.argomento) : null)))
        : h('p', { class: 'muted', style: 'margin:0' }, 'Nessuna interrogazione assegnata per ora.'))));
}

