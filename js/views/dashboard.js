// Dashboard personale: home ("tocca a te tra N giorni"), agenda di tutte le
// materie giorno per giorno e pagina Profilo / Gestione.
// Tutti i dati arrivano dal database e finiscono nel DOM solo come testo.

import { api, sessione, sb } from '../api.js';
import { prefs } from '../prefs.js';
import { vai, sostituisciQuery } from '../router.js';
import {
  h, icon, mount, vuoto, toast, conferma, dialogo, dataTitolo, dataLunga, giorniDa, oggiRoma, norm,
  iniziali, nomeCompleto, testoConLink, STATI,
} from '../ui.js';
import { creaVista, firma, vistaEl } from './common.js';
import { coloreMateria, descriviOraProf, aggiungiGiorni, giornoSettimana } from '../orario.js';
import { impostaTema } from '../tema.js';
import { puoInstallare, installa } from '../pwa.js';
import { dialogoMateria, eliminaMateria } from './staff.js';

const VERSIONE_APP = '4.0';

// ---------------------------------------------------------------------
//  Utilità
// ---------------------------------------------------------------------

const fermo = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** "MARIO ROSSI" → "Mario Rossi" (solo per la visualizzazione). */
function bello(s) {
  return String(s || '').toLocaleLowerCase('it-IT').replace(/(^|[\s'-])(\p{L})/gu, (_, a, b) => a + b.toLocaleUpperCase('it-IT'));
}

const fmtGiornoBreve = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
const fmtSigla = new Intl.DateTimeFormat('it-IT', { weekday: 'short', timeZone: 'UTC' });
const pura = (iso) => new Date(iso + 'T12:00:00Z');
/** "ven 20" */
const giornoBreve = (iso) => fmtGiornoBreve.format(pura(iso)).replace('.', '');
/** "VEN" */
const sigla = (iso) => fmtSigla.format(pura(iso)).replace('.', '').slice(0, 3).toUpperCase();

/** Dal risultato di "cerca" sceglie la persona che corrisponde al nome salvato. */
export function trovaMe(mie, mioNome) {
  const r = mie?.risultati;
  if (!r?.length || !mioNome) return null;
  const n = norm(mioNome);
  return r.find((x) => norm(`${x.nome} ${x.cognome}`) === n || norm(`${x.cognome} ${x.nome}`) === n)
    || (r.length === 1 ? r[0] : null);
}
const sonoIo = (me, p) => !!me && norm(p.nome) === norm(me.nome) && norm(p.cognome) === norm(me.cognome);

/**
 * Numero che "conta" fino al valore la prima volta che compare (o quando
 * cambia). Con "riduci movimento" mostra subito il valore.
 */
const numeriVisti = new Map();
function numero(chiave, valore, suffisso = '') {
  const el = h('span', { class: 'num' }, `${valore}${suffisso}`);
  const prima = numeriVisti.get(chiave);
  numeriVisti.set(chiave, valore);
  if (typeof valore !== 'number' || valore <= 0 || prima === valore || fermo()) return el;
  const da = typeof prima === 'number' && prima < valore ? prima : 0;
  el.textContent = `${da}${suffisso}`;
  const durata = Math.min(1100, 450 + (valore - da) * 45);
  let t0 = null;
  const passo = (t) => {
    t0 ??= t;
    const p = Math.min(1, (t - t0) / durata);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = `${Math.round(da + (valore - da) * e)}${suffisso}`;
    if (p < 1) requestAnimationFrame(passo);
  };
  setTimeout(() => requestAnimationFrame(passo), 250);
  return el;
}

/** Lunedì della settimana da mostrare (nel weekend: la prossima). */
function settimanaDi(oggi) {
  const g = giornoSettimana(oggi);
  const prossima = g >= 6;
  const lunedi = aggiungiGiorni(oggi, (prossima ? 8 : 1) - g);
  return { prossima, lunedi };
}

// ---------------------------------------------------------------------
//  Home
// ---------------------------------------------------------------------

function scheletroHome() {
  return h('div', { 'aria-busy': 'true', 'aria-label': 'Caricamento in corso' },
    h('section', { class: 'hero hero-attesa' },
      h('div', { class: 'hero-sfondo', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')),
      h('div', { class: 'sk sk-chiaro', style: 'width:30%;height:1rem;margin-bottom:.8rem' }),
      h('div', { class: 'sk sk-chiaro', style: 'width:80%;height:2.4rem;margin-bottom:1.4rem' }),
      h('div', { class: 'hero-card', style: 'min-height:190px' })),
    h('div', { class: 'settimana-strip', style: 'margin-top:1.5rem' },
      Array.from({ length: 5 }, () => h('div', { class: 'giorno-strip sk' }))));
}

export function home() {
  const cont = h('div', { class: 'home' });
  mount(vistaEl(), cont);
  return creaVista(cont, {
    scheletro: scheletroHome,
    carica: async () => {
      const oggi = oggiRoma();
      const { lunedi } = settimanaDi(oggi);
      const dal = lunedi < oggi ? lunedi : oggi;
      const [classe, agenda, mie] = await Promise.all([
        api.classe(),
        api.agenda(dal, aggiungiGiorni(oggi, 21)),
        prefs.mioNome ? api.cerca(prefs.mioNome).catch(() => null) : null,
      ]);
      return { ...classe, agenda: agenda.sessioni, oggi: agenda.oggi || oggi, me: trovaMe(mie, prefs.mioNome) };
    },
    disegna: disegnaHome,
  });
}

function disegnaHome(d) {
  const { me, oggi } = d;
  return h('div', {},
    hero(d),
    me ? mieAltreDate(d) : null,
    stripSettimana(d),
    sessione.isStaff ? daEstrarre(d) : null,
    tileMaterie(d),
    h('nav', { class: 'link-rapidi', 'aria-label': 'Altre pagine' },
      h('a', { href: '#/cerca' }, icon('cerca', 18), 'Cerca un nome'),
      h('a', { href: '#/registro' }, icon('storia', 18), 'Registro modifiche'),
      h('a', { href: '#/agenda' }, icon('calendario', 18), 'Agenda completa')),
    h('p', { class: 'piede-home' }, `Dati aggiornati in tempo reale · ${dataLunga(oggi)}`));
}

/** Prossima interrogazione della classe (tra tutte le materie). */
function prossimaClasse(materie) {
  return materie.filter((m) => m.prossima)
    .map((m) => ({ ...m.prossima, materia: m }))
    .sort((a, b) => (a.data + String(a.ora || 9).padStart(2, '0')).localeCompare(b.data + String(b.ora || 9).padStart(2, '0')))[0] || null;
}

/** Le prossime date della persona salvata (stato assegnato, da oggi in poi). */
function mieProssime(d) {
  if (!d.me) return [];
  return d.me.date.filter((x) => giorniDa(x.data) >= 0 && x.stato === 'assegnato')
    .sort((a, b) => (a.data + String(a.ora || 9).padStart(2, '0')).localeCompare(b.data + String(b.ora || 9).padStart(2, '0')));
}

function hero(d) {
  const { me } = d;
  const mia = mieProssime(d)[0];
  const classe = prossimaClasse(d.materie);
  const x = mia || classe;
  const g = x ? giorniDa(x.data) : null;

  let titolo;
  if (mia) {
    titolo = g === 0 ? ['Tocca a te ', h('em', {}, 'oggi')]
      : g === 1 ? ['Tocca a te ', h('em', {}, 'domani')]
      : ['Tocca a te tra ', numero('hero-g', g), ' giorni'];
  } else if (classe) {
    titolo = g === 0 ? [me ? 'Oggi tu sei libero, ' : 'Oggi ', h('em', {}, 'si interroga')]
      : g === 1 ? ['Domani ', h('em', {}, 'si interroga')]
      : ['Prossima interrogazione tra ', numero('hero-g', g), ' giorni'];
    if (me) titolo = ['Per ora ', h('em', {}, 'nessuna'), ' interrogazione per te'];
  } else {
    titolo = ['Nessuna interrogazione ', h('em', {}, 'in programma')];
  }

  // Posizione nell'ordine di interrogazione (dall'agenda).
  let posizione = null;
  if (mia) {
    const s = d.agenda.find((y) => y.data === mia.data && y.materia.slug === mia.slug && (!mia.ora || y.ora === mia.ora))
      || d.agenda.find((y) => y.data === mia.data && y.materia.slug === mia.slug);
    const i = s ? s.interrogati.findIndex((p) => sonoIo(me, p)) : -1;
    if (i >= 0) posizione = { n: i + 1, di: s.interrogati.length };
  }

  const materia = mia ? { nome: mia.materia, slug: mia.slug, colore: mia.colore } : classe?.materia;
  const stat = (chiave, valore, etichetta) => h('div', { class: 'hc-stat' }, h('strong', {}, valore), h('span', {}, etichetta));

  const card = x
    ? h('a', {
        class: 'hero-card', href: `#/materia/${encodeURIComponent(materia.slug)}`, style: `--colore:${coloreMateria(materia)}`,
        'aria-label': `${mia ? 'La tua prossima interrogazione' : 'Prossima interrogazione della classe'}: ${materia.nome}, ${dataLunga(x.data)}`,
      },
        h('span', { class: 'hc-etichetta' }, h('span', { class: 'hc-pallino', style: `--colore:${coloreMateria(materia)}` }),
          mia ? 'La tua prossima interrogazione' : 'Prossima della classe'),
        h('span', { class: 'hc-materia' }, materia.nome),
        h('span', { class: 'hc-quando' }, dataTitolo(x.data), descriviOraProf(x) ? ` · ${descriviOraProf(x)}` : ''),
        x.argomento ? h('span', { class: 'hc-argomento' }, testoConLink(x.argomento, false)) : null,
        h('div', { class: 'hc-stats' },
          g === 0 ? stat('g', 'Oggi', 'è il giorno') : stat('g', numero('stat-g', g), g === 1 ? 'giorno' : 'giorni'),
          stat('o', x.ora ? `${x.ora}ª` : '—', 'ora'),
          mia
            ? stat('p', posizione ? `${posizione.n}°` : '—', posizione ? `in ordine su ${posizione.di}` : 'in ordine')
            : stat('p', x.n_assegnati ? `${x.n_assegnati}/${x.max_interrogati}` : '0', x.n_assegnati ? 'estratti' : `da estrarre su ${x.max_interrogati}`)))
    : h('div', { class: 'hero-card hero-card-vuota' },
        h('span', { class: 'hc-etichetta' }, 'Calendario libero'),
        h('span', { class: 'hc-quando' }, 'Quando verranno fissate nuove date le vedrai qui.'));

  return h('section', { class: 'hero', 'data-key': 'hero', 'data-firma': firma([mia, classe, posizione, me?.nome]) },
    h('div', { class: 'hero-sfondo', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')),
    h('p', { class: 'hero-ciao' }, me ? `Ciao ${bello(me.nome)}` : 'Ciao', ' ', h('span', { class: 'saluto', 'aria-hidden': 'true' }, '👋')),
    h('h1', { class: 'hero-titolo' }, titolo),
    card,
    !me
      ? h('a', { class: 'hero-cta', href: '#/profilo?nome=1' }, icon('utente', 18),
          prefs.mioNome ? 'Non ti trovo: scegli di nuovo il tuo nome' : 'Dimmi chi sei: vedrai le tue date', icon('freccia', 16))
      : null);
}

/** Le altre date della persona (oltre alla prima, già nell'hero). */
function mieAltreDate(d) {
  const altre = mieProssime(d).slice(1);
  if (!altre.length) return null;
  return h('section', { class: 'sezione-home', 'data-key': 'mie', 'data-firma': firma(altre) },
    h('h2', { class: 'etichetta-sezione' }, 'Dopo tocca a te in'),
    h('div', { class: 'mie-scorri' }, altre.map((x, i) =>
      h('a', { class: 'mia-data', href: `#/materia/${encodeURIComponent(x.slug)}`, style: `--colore:${coloreMateria(x)};--i:${i}` },
        h('span', { class: 'md-materia' }, x.materia),
        h('span', { class: 'md-quando' }, giornoBreve(x.data)),
        h('span', { class: 'md-rel' }, giorniDa(x.data) === 1 ? 'domani' : `tra ${giorniDa(x.data)} giorni`)))));
}

function stripSettimana(d) {
  const { prossima, lunedi } = settimanaDi(d.oggi);
  let giorni = Array.from({ length: 6 }, (_, i) => aggiungiGiorni(lunedi, i));
  if (!d.agenda.some((s) => s.data === giorni[5])) giorni = giorni.slice(0, 5);
  const perGiorno = (g) => d.agenda.filter((s) => s.data === g);
  const totale = giorni.reduce((n, g) => n + perGiorno(g).length, 0);

  return h('section', { class: 'sezione-home', 'data-key': 'settimana', 'data-firma': firma(giorni.map(perGiorno).map((l) => l.map((s) => [s.id, s.materia.colore, s.interrogati.length]))) },
    h('div', { class: 'riga-sezione' },
      h('h2', { class: 'etichetta-sezione' }, prossima ? 'Settimana prossima in classe' : 'Questa settimana in classe'),
      h('a', { class: 'link-sezione', href: '#/agenda' }, 'Agenda', icon('freccia', 14))),
    h('div', { class: 'settimana-strip', style: `--n:${giorni.length}` }, giorni.map((g, i) => {
      const sessioni = perGiorno(g);
      const mio = sessioni.some((s) => s.interrogati.some((p) => sonoIo(d.me, p)));
      const cls = ['giorno-strip', g === d.oggi ? 'oggi' : '', g < d.oggi ? 'passato' : '', mio ? 'mio' : ''].join(' ');
      const descr = sessioni.length ? sessioni.map((s) => s.materia.nome).join(', ') : 'nessuna interrogazione';
      return h('a', {
        class: cls, href: `#/agenda?giorno=${g}`, style: `--i:${i}`,
        'aria-label': `${dataTitolo(g)}${g === d.oggi ? ' (oggi)' : ''}: ${descr}${mio ? ', tocca anche a te' : ''}`,
      },
        h('span', { class: 'gs-nome' }, sigla(g)),
        h('span', { class: 'gs-num' }, String(Number(g.slice(8)))),
        h('span', { class: 'gs-barre' }, sessioni.slice(0, 3).map((s, j) => h('i', { style: `--colore:${coloreMateria(s.materia)};--j:${j}` }))),
        mio ? h('span', { class: 'gs-tu' }, 'tu') : null);
    })),
    totale === 0 ? h('p', { class: 'nota-strip' }, 'Nessuna interrogazione in questi giorni.') : null);
}

function daEstrarre(d) {
  const lista = d.agenda.filter((s) => s.data >= d.oggi && s.interrogati.length < s.max_interrogati).slice(0, 5);
  if (!lista.length) return null;
  return h('section', { class: 'sezione-home', 'data-key': 'da-estrarre', 'data-firma': firma(lista.map((s) => [s.id, s.interrogati.length])) },
    h('h2', { class: 'etichetta-sezione' }, icon('dado', 14), 'Da estrarre'),
    h('div', { class: 'lista-card' }, lista.map((s) =>
      h('a', { class: 'riga-estrarre', href: `#/materia/${encodeURIComponent(s.materia.slug)}`, style: `--colore:${coloreMateria(s.materia)}` },
        h('span', { class: 're-data' }, h('b', {}, String(Number(s.data.slice(8)))), h('small', {}, sigla(s.data))),
        h('span', { class: 're-testo' }, h('strong', {}, s.materia.nome), h('small', {}, descriviOraProf(s) || dataTitolo(s.data))),
        h('span', { class: 're-posti' }, `${s.interrogati.length}/${s.max_interrogati}`),
        icon('freccia', 16)))));
}

function tileMaterie(d) {
  if (!d.materie.length) {
    return h('section', { class: 'sezione-home' },
      vuoto('Nessuna materia', sessione.isAdmin ? 'Crea la prima materia da Gestione.' : 'L\'amministratore non ha ancora creato le materie.', 'libro',
        sessione.isAdmin ? h('a', { class: 'btn btn-primary', href: '#/profilo' }, 'Vai a Gestione') : null));
  }
  return h('section', { class: 'sezione-home' },
    h('h2', { class: 'etichetta-sezione' }, 'Materie'),
    h('div', { class: 'tiles' }, d.materie.map((m, i) => {
      const p = m.prossima;
      const info = p
        ? `${giornoBreve(p.data)} · ${p.n_assegnati ? `${p.n_assegnati}/${p.max_interrogati}` : 'da estrarre'}`
        : (m.n_sessioni ? 'nessuna data in programma' : 'nessuna sessione');
      const perc = p ? Math.round(Math.min(1, (p.n_assegnati || 0) / (p.max_interrogati || 1)) * 100) : 0;
      return h('a', {
        class: 'tile', href: `#/materia/${encodeURIComponent(m.slug)}`, style: `--colore:${coloreMateria(m)};--i:${i}`,
        'data-key': `m-${m.id}`, 'data-firma': firma([m.nome, m.colore, p]),
      },
        h('span', { class: 'tile-nome' }, m.nome),
        h('span', { class: 'tile-info' }, info),
        p ? h('span', { class: 'tile-barra', 'aria-hidden': 'true' }, h('i', { style: `--p:${perc}%` })) : null,
        h('span', { class: 'tile-lettera', 'aria-hidden': 'true' }, (m.nome || '?').trim().charAt(0).toUpperCase()));
    })));
}

// ---------------------------------------------------------------------
//  Agenda
// ---------------------------------------------------------------------

export function agenda(_params, query) {
  const stato = {
    scheda: query.get('passate') ? 'passate' : 'prossime',
    materia: query.get('materia') || '',
    mie: query.get('mie') === '1',
    giorno: /^\d{4}-\d{2}-\d{2}$/.test(query.get('giorno') || '') ? query.get('giorno') : null,
  };
  const cont = h('div');
  mount(vistaEl(),
    h('div', { class: 'titolo-pagina' },
      h('div', {}, h('h1', {}, 'Agenda'), h('p', { class: 'sotto' }, 'Tutte le interrogazioni della classe, giorno per giorno.'))),
    cont);

  let vista = null;
  vista = creaVista(cont, {
    righeSkeleton: 4,
    carica: async () => {
      const oggi = oggiRoma();
      const g = stato.giorno;
      const [ag, mie] = await Promise.all([
        stato.scheda === 'passate'
          ? api.agenda(aggiungiGiorni(oggi, -180), aggiungiGiorni(oggi, -1))
          : api.agenda(g && g < oggi ? g : oggi, aggiungiGiorni(g && g > oggi ? g : oggi, 120)),
        prefs.mioNome ? api.cerca(prefs.mioNome).catch(() => null) : null,
      ]);
      return { ...ag, me: trovaMe(mie, prefs.mioNome) };
    },
    disegna: (d) => disegnaAgenda(d, stato, {
      ridisegna: () => vista.ridisegna(),
      ricarica: () => vista.ricarica(),
    }),
  });
  return vista;
}

function disegnaAgenda(d, stato, { ridisegna, ricarica }) {
  const oggi = d.oggi || oggiRoma();
  const aggiornaQuery = () => sostituisciQuery({ passate: stato.scheda === 'passate' ? '1' : '', materia: stato.materia, mie: stato.mie ? '1' : '' });

  // Materie presenti nell'intervallo, per i filtri.
  const materie = [...new Map(d.sessioni.map((s) => [s.materia.slug, s.materia])).values()]
    .sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
  if (stato.materia && !materie.some((m) => m.slug === stato.materia)) stato.materia = '';

  let sessioni = d.sessioni.filter((s) => !stato.materia || s.materia.slug === stato.materia);
  if (stato.mie && d.me) sessioni = sessioni.filter((s) => [...s.interrogati, ...s.non_presenti].some((p) => sonoIo(d.me, p)));
  if (stato.scheda === 'passate') sessioni = [...sessioni].reverse();

  const gruppi = new Map();
  for (const s of sessioni) {
    if (!gruppi.has(s.data)) gruppi.set(s.data, []);
    gruppi.get(s.data).push(s);
  }
  // Giorno richiesto dalla home anche se vuoto.
  const richiesto = stato.giorno;
  if (richiesto && stato.scheda === 'prossime' && !gruppi.has(richiesto)) {
    gruppi.set(richiesto, []);
    const ordinati = [...gruppi].sort(([a], [b]) => a.localeCompare(b));
    gruppi.clear();
    ordinati.forEach(([k, v]) => gruppi.set(k, v));
  }
  if (richiesto) {
    stato.giorno = null;
    requestAnimationFrame(() => {
      const el = document.getElementById(`g-${richiesto}`);
      if (!el) return;
      el.scrollIntoView({ block: 'start', behavior: fermo() ? 'auto' : 'smooth' });
      el.classList.add('richiesto');
      setTimeout(() => el.classList.remove('richiesto'), 2200);
    });
  }

  const scheda = (id, testo) => h('button', {
    type: 'button', role: 'tab', 'aria-selected': String(stato.scheda === id),
    onclick: () => { if (stato.scheda === id) return; stato.scheda = id; aggiornaQuery(); ricarica(); },
  }, testo);
  const chip = (attivo, testo, onclick, colore = null) => h('button', {
    type: 'button', class: 'chip-filtro', 'aria-pressed': String(attivo), onclick,
    style: colore ? `--colore:${colore}` : null,
  }, colore ? h('span', { class: 'pallino', 'aria-hidden': 'true' }) : null, testo);

  return h('div', { class: 'agenda' },
    h('div', { class: 'agenda-barra' },
      h('div', { class: 'tabs tabs-piene', role: 'tablist', 'aria-label': 'Periodo' }, scheda('prossime', 'In programma'), scheda('passate', 'Passate')),
      h('div', { class: 'chip-scorri', role: 'group', 'aria-label': 'Filtra per materia' },
        d.me ? chip(stato.mie, 'Solo le mie', () => { stato.mie = !stato.mie; aggiornaQuery(); ridisegna(); }) : null,
        chip(!stato.materia, 'Tutte', () => { stato.materia = ''; aggiornaQuery(); ridisegna(); }),
        materie.map((m) => chip(stato.materia === m.slug, m.nome, () => { stato.materia = stato.materia === m.slug ? '' : m.slug; aggiornaQuery(); ridisegna(); }, coloreMateria(m))))),

    gruppi.size === 0
      ? vuoto(stato.mie ? 'Nessuna interrogazione per te' : 'Nessuna interrogazione',
          stato.scheda === 'passate' ? 'Non ci sono interrogazioni passate con questi filtri.' : 'Non ci sono interrogazioni in programma con questi filtri.', 'calendario')
      : h('div', { class: 'agenda-giorni stack' }, [...gruppi].map(([data, lista]) => giornoAgenda(data, lista, oggi, d.me))));
}

function giornoAgenda(data, lista, oggi, me) {
  const g = giorniDa(data);
  const rel = data === oggi ? 'Oggi' : g === 1 ? 'Domani' : g === -1 ? 'Ieri' : '';
  return h('section', { class: `ag-giorno ${data === oggi ? 'oggi' : ''}`, id: `g-${data}`, 'aria-label': dataTitolo(data) },
    h('h2', { class: 'ag-data' },
      h('span', { class: 'ag-num', 'aria-hidden': 'true' }, h('b', {}, String(Number(data.slice(8)))), h('small', {}, sigla(data))),
      h('span', { class: 'ag-titolo' }, rel ? h('strong', {}, rel) : null, h('span', {}, dataTitolo(data)))),
    lista.length
      ? h('div', { class: 'ag-lista' }, lista.map((s) => sessioneAgenda(s, me)))
      : h('p', { class: 'vuoto-card' }, 'Nessuna interrogazione in questo giorno.'));
}

function sessioneAgenda(s, me) {
  const tutti = [...s.interrogati, ...s.non_presenti];
  const mio = tutti.some((p) => sonoIo(me, p));
  return h('article', {
    class: `ag-sessione ${mio ? 'mia' : ''}`, style: `--colore:${coloreMateria(s.materia)}`,
    'data-key': `ag-${s.id}`, 'data-firma': firma([s.data, s.ora, s.argomento, s.max_interrogati, s.interrogati, s.non_presenti, mio]),
  },
    h('a', { class: 'ag-testa', href: `#/materia/${encodeURIComponent(s.materia.slug)}` },
      h('span', { class: 'ag-materia' }, s.materia.nome),
      mio ? h('span', { class: 'tag-tu' }, 'Tocca a te') : null,
      h('span', { class: 'ag-posti' }, `${s.interrogati.length}/${s.max_interrogati}`),
      icon('freccia', 16)),
    descriviOraProf(s) ? h('p', { class: 'ag-ora' }, icon('orologio', 14), descriviOraProf(s)) : null,
    s.argomento ? h('p', { class: 'ag-argomento' }, testoConLink(s.argomento)) : null,
    tutti.length
      ? h('ul', { class: 'ag-persone' }, tutti.map((p, i) =>
          h('li', { class: `chip-persona st-${p.stato} ${sonoIo(me, p) ? 'io' : ''}`, title: STATI[p.stato]?.testo || '' },
            p.stato === 'assegnato' || p.stato === 'interrogato' ? h('span', { class: 'cp-n', 'aria-hidden': 'true' }, String(i + 1)) : null,
            h('span', {}, bello(nomeCompleto(p))),
            p.stato !== 'assegnato' ? h('span', { class: 'cp-stato' }, ` · ${STATI[p.stato]?.testo || p.stato}`) : null)))
      : h('p', { class: 'ag-vuoto' }, icon('dado', 16), `Da estrarre · ${s.max_interrogati} ${s.max_interrogati === 1 ? 'posto' : 'posti'}`));
}

// ---------------------------------------------------------------------
//  Profilo / Gestione
// ---------------------------------------------------------------------

export function profilo(_params, query) {
  const cont = h('div', { class: 'profilo' });
  mount(vistaEl(), cont);
  let vista = null;
  const ricarica = () => vista?.aggiorna('azione');
  vista = creaVista(cont, {
    righeSkeleton: 3,
    carica: async () => {
      const [mie, materie, staff] = await Promise.all([
        prefs.mioNome && sessione.haAccesso ? api.cerca(prefs.mioNome).catch(() => null) : null,
        sessione.isStaff ? api.tabella('subjects', 'id,nome,slug,ordine,colore', 'ordine') : [],
        sessione.isAdmin ? api.tabella('staff', 'user_id,approvato', 'creato_il') : [],
      ]);
      return { me: trovaMe(mie, prefs.mioNome), materie, inAttesa: staff.filter((s) => !s.approvato).length };
    },
    disegna: (d) => disegnaProfilo(d, ricarica),
  });
  // Dalla home ("Dimmi chi sei"): apre subito la scelta del nome.
  if (query.get('nome') && sessione.haAccesso) {
    sostituisciQuery({});
    setTimeout(() => scegliNome(ricarica), 150);
  }
  // Il pulsante "Installa" compare/scompare senza ricaricare i dati.
  const suInstallabile = () => vista.ridisegna();
  document.addEventListener('installabile', suInstallabile);
  return {
    aggiorna: (m) => vista.aggiorna(m),
    distruggi: () => { vista.distruggi(); document.removeEventListener('installabile', suInstallabile); },
  };
}

/** Riga di una lista raggruppata: link o pulsante. */
function voce({ href, onclick, ic, titolo, sotto, extra, pericolo = false, colore }) {
  const contenuto = [
    colore ? h('span', { class: 'voce-ic colorata', style: `--colore:${colore}`, 'aria-hidden': 'true' }, titolo.trim().charAt(0).toUpperCase())
      : h('span', { class: `voce-ic ${pericolo ? 'pericolo' : ''}`, 'aria-hidden': 'true' }, icon(ic, 18)),
    h('span', { class: 'rl-testo' }, h('span', { class: pericolo ? 'testo-pericolo' : '' }, titolo), sotto ? h('small', {}, sotto) : null),
    extra || null,
    href || onclick ? icon('freccia', 16) : null,
  ];
  if (href) return h('li', {}, h('a', { class: 'riga-lista riga-cliccabile', href }, contenuto));
  if (onclick) return h('li', {}, h('button', { type: 'button', class: 'riga-lista riga-cliccabile', onclick }, contenuto));
  return h('li', {}, h('div', { class: 'riga-lista' }, contenuto));
}

function gruppo(titolo, ...voci) {
  const v = voci.flat().filter(Boolean);
  if (!v.length) return null;
  return h('section', { class: 'gruppo-profilo' },
    titolo ? h('h2', { class: 'etichetta-sezione' }, titolo) : null,
    h('ul', { class: 'lista-gruppo' }, v));
}

function selettoreTema() {
  const opzioni = [[null, 'Sistema', 'auto'], ['chiaro', 'Chiaro', 'sole'], ['scuro', 'Scuro', 'luna']];
  const box = h('div', { class: 'seg-tema', role: 'radiogroup', 'aria-label': 'Tema' });
  const aggiorna = () => {
    const attuale = prefs.tema;
    box.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-checked', String(opzioni[i][0] === attuale)));
    box.style.setProperty('--idx', String(Math.max(0, opzioni.findIndex(([v]) => v === attuale))));
  };
  box.append(h('span', { class: 'seg-pill', 'aria-hidden': 'true' }),
    ...opzioni.map(([v, testo, ic]) => h('button', {
      type: 'button', role: 'radio',
      onclick: (e) => impostaTema(v, e.currentTarget),
    }, icon(ic, 18), testo)));
  aggiorna();
  // Il tema cambia in modo asincrono (transizione): aggiorna quando è applicato.
  const suCambio = () => (box.isConnected ? aggiorna() : document.removeEventListener('tema-cambiato', suCambio));
  document.addEventListener('tema-cambiato', suCambio);
  return box;
}

function disegnaProfilo(d, ricarica) {
  const { me } = d;
  const p = sessione.profilo;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);

  const esciDispositivo = async () => {
    const ok = await conferma({ titolo: 'Uscire?', messaggio: 'Il codice di classe e il tuo nome verranno dimenticati su questo dispositivo e i dati salvati per l\'uso offline verranno cancellati.', ok: 'Esci', pericolo: true });
    if (!ok) return;
    prefs.codice = null;
    prefs.mioNome = null;
    try { await caches.delete('dati-v1'); } catch { /* cache non disponibile */ }
    vai(sessione.isStaff ? '/' : '/accesso');
  };
  const esciStaff = async () => {
    const ok = await conferma({ titolo: 'Uscire dall\'area staff?', messaggio: 'Potrai continuare a vedere le interrogazioni con il codice di classe.', ok: 'Esci' });
    if (ok) await sb.auth.signOut();
  };

  // Intestazione
  const testa = h('header', { class: 'profilo-testa' },
    h('span', { class: 'profilo-avatar', 'aria-hidden': 'true' }, me ? iniziali(me) : icon('utente', 34)),
    h('div', {},
      h('h1', {}, me ? bello(nomeCompleto(me)) : 'Profilo'),
      h('p', { class: 'sotto' }, '5C Informatica',
        p ? h('span', { class: 'tag ruolo' }, p.ruolo === 'admin' ? 'Amministratore' : 'Rappresentante') : null)));

  const tu = sessione.haAccesso ? gruppo('Tu',
    voce({ onclick: () => scegliNome(ricarica), ic: 'utente', titolo: 'Il tuo nome', sotto: me ? bello(nomeCompleto(me)) : 'Scegli il tuo nome per vedere le tue date in home' }),
    voce({ href: '#/cerca', ic: 'cerca', titolo: 'Cerca un nome', sotto: 'Date e storico di chiunque in classe' }),
    voce({ href: '#/registro', ic: 'storia', titolo: 'Registro modifiche', sotto: 'Estrazioni, spostamenti, assenze' })) : null;

  const aspetto = h('section', { class: 'gruppo-profilo' },
    h('h2', { class: 'etichetta-sezione' }, 'Aspetto'),
    selettoreTema());

  const app = gruppo('App',
    puoInstallare() ? voce({ onclick: installa, ic: 'installa', titolo: 'Installa l\'app', sotto: 'Aprila dalla schermata Home come un\'app vera' }) : null,
    !puoInstallare() && ios ? voce({ ic: 'condividi', titolo: 'Installa su iPhone', sotto: 'Tocca Condividi e poi "Aggiungi a Home"' }) : null,
    prefs.codice ? voce({ onclick: esciDispositivo, ic: 'esci', titolo: 'Esci da questo dispositivo', sotto: 'Dimentica codice di classe e nome', pericolo: true }) : null);

  let staff;
  if (!sb) staff = null;
  else if (!sessione.utente) {
    staff = h('section', { class: 'gruppo-profilo' },
      h('h2', { class: 'etichetta-sezione' }, 'Gestione'),
      h('a', { class: 'card-staff', href: '#/staff' },
        h('span', { class: 'voce-ic grande', 'aria-hidden': 'true' }, icon('scudo', 22)),
        h('span', { class: 'rl-testo' }, h('strong', {}, 'Sei rappresentante o admin?'), h('small', {}, 'Accedi per fare estrazioni e gestire le date')),
        icon('freccia', 18)));
  } else if (!sessione.isStaff) {
    staff = gruppo('Gestione',
      voce({ href: '#/staff', ic: 'orologio', titolo: 'In attesa di approvazione', sotto: sessione.utente.email }),
      voce({ onclick: esciStaff, ic: 'esci', titolo: 'Esci dall\'account', pericolo: true }));
  } else {
    staff = [
      h('section', { class: 'gruppo-profilo' },
        h('div', { class: 'riga-sezione' },
          h('h2', { class: 'etichetta-sezione' }, 'Materie'),
          sessione.isAdmin ? h('button', { class: 'btn btn-tinted btn-sm', type: 'button', onclick: async () => { if (await dialogoMateria(null)) ricarica(); } }, icon('piu', 16), 'Nuova') : null),
        d.materie.length
          ? h('ul', { class: 'lista-gruppo' }, d.materie.map((m) => voce({
              href: `#/materia/${encodeURIComponent(m.slug)}`, colore: coloreMateria(m), titolo: m.nome, sotto: 'Sessioni ed estrazioni',
              extra: sessione.isAdmin ? h('span', { class: 'azioni-voce' },
                h('button', { class: 'btn-icon sm', type: 'button', 'aria-label': `Modifica ${m.nome}`, onclick: async (e) => { e.preventDefault(); if (await dialogoMateria(m)) ricarica(); } }, icon('matita', 17)),
                h('button', { class: 'btn-icon sm', type: 'button', 'aria-label': `Elimina ${m.nome}`, onclick: async (e) => { e.preventDefault(); await eliminaMateria(m); ricarica(); } }, icon('cestino', 17))) : null,
            })))
          : h('p', { class: 'vuoto-card' }, sessione.isAdmin ? 'Nessuna materia: tocca "Nuova".' : 'L\'amministratore non ha ancora creato materie.')),
      sessione.isAdmin ? gruppo('Classe',
        voce({ href: '#/staff/orario', ic: 'calendario', titolo: 'Orario e prof', sotto: 'Ore di lezione, orario settimanale, prof' }),
        voce({ href: '#/staff/studenti', ic: 'gruppo', titolo: 'Elenco studenti', sotto: 'Importa il JSON, aggiungi, disattiva' }),
        voce({ href: '#/staff/utenti', ic: 'scudo', titolo: 'Staff e rappresentanti', sotto: d.inAttesa ? `${d.inAttesa} in attesa di approvazione` : 'Approva o revoca',
          extra: d.inAttesa ? h('span', { class: 'contatore' }, String(d.inAttesa)) : null }),
        voce({ href: '#/staff/impostazioni', ic: 'impostazioni', titolo: 'Codice di classe', sotto: 'Il codice per i compagni' }),
        voce({ href: '#/staff/cestino', ic: 'cestino', titolo: 'Cestino', sotto: 'Sessioni eliminate da ripristinare' }),
        voce({ href: '#/staff/backup', ic: 'download', titolo: 'Backup', sotto: 'Copie settimanali e download' })) : null,
      gruppo('Account',
        voce({ ic: 'scudo', titolo: p.email, sotto: p.ruolo === 'admin' ? 'Amministratore' : 'Rappresentante' }),
        voce({ onclick: esciStaff, ic: 'esci', titolo: 'Esci dall\'area staff', pericolo: true })),
    ];
  }

  return h('div', {},
    testa,
    h('div', { class: 'profilo-colonne' },
      h('div', {}, tu, aspetto, app),
      h('div', {}, staff)),
    h('p', { class: 'piede-home' }, `Interrogazioni 5C · versione ${VERSIONE_APP}`));
}

/** Dialogo "Chi sei?": cerca e scegli il tuo nome (salvato solo su questo dispositivo). */
async function scegliNome(ricarica) {
  const scelto = await dialogo('Chi sei?', (chiudi) => {
    const input = h('input', { type: 'search', placeholder: 'Scrivi nome o cognome', 'aria-label': 'Nome o cognome', autocomplete: 'off' });
    const lista = h('ul', { class: 'lista-nomi', 'aria-live': 'polite' });
    let t;
    let ultimo = '';
    const cerca = async () => {
      const q = input.value.trim();
      ultimo = q;
      if (q.length < 2) { mount(lista, h('li', { class: 'muted piccolo' }, 'Almeno 2 lettere.')); return; }
      try {
        const r = await api.cerca(q);
        if (q !== ultimo) return;
        mount(lista, r.risultati.length
          ? r.risultati.map((p) => h('li', {},
              h('button', { type: 'button', class: 'nome-scelta', onclick: () => chiudi(p) },
                h('span', { class: 'avatar-persona', 'aria-hidden': 'true' }, iniziali(p)),
                h('span', {}, bello(nomeCompleto(p))))))
          : h('li', { class: 'muted piccolo' }, `Nessuno trovato per "${q}".`));
      } catch (e) {
        mount(lista, h('li', { class: 'campo-errore' }, e.message));
      }
    };
    input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(cerca, 250); });
    setTimeout(() => input.focus(), 50);
    return h('div', {},
      h('p', { class: 'muted piccolo', style: 'margin-top:0' }, 'Il nome resta solo su questo dispositivo: serve a mostrarti in home quando tocca a te.'),
      h('div', { class: 'cerca-box' }, icon('cerca', 18), input),
      lista,
      prefs.mioNome
        ? h('button', { class: 'btn btn-ghost btn-blocco', type: 'button', style: 'margin-top:.5rem', onclick: () => chiudi('rimuovi') }, 'Non mostrare più il mio nome')
        : null);
  });
  if (!scelto) return;
  if (scelto === 'rimuovi') { prefs.mioNome = null; toast('Nome rimosso da questo dispositivo'); }
  else { prefs.mioNome = `${scelto.nome} ${scelto.cognome}`; toast(`Ciao ${bello(scelto.nome)}!`, 'ok'); }
  ricarica();
}
