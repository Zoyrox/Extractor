// Viste pubbliche (compagni, sola lettura): home, materia, registro,
// "cerca il mio nome" e schermata del codice di classe.

import { api, sessione } from '../api.js';
import { prefs } from '../prefs.js';
import { vai, sostituisciQuery } from '../router.js';
import {
  h, icon, mount, badge, toast, vuoto, dataLunga, dataTitolo, dataOra, quandoRelativo, giorniDa,
  meseBreve, giornoNumero, testoConLink, iniziali, animaEntrata, nomeCompleto, conferma,
} from '../ui.js';
import { creaVista, firma, dettagli, vistaEl } from './common.js';
import { apriEsportazione } from '../export.js';
import { descriviOra, descriviOraProf, coloreMateria } from '../orario.js';

/** Cerchio colorato con l'iniziale della materia. */
export function avatarMateria(m) {
  return h('span', { class: 'avatar-materia', style: `--colore:${coloreMateria(m)}`, 'aria-hidden': 'true' }, (m.nome || '?').trim().charAt(0).toUpperCase());
}

// ---------------------------------------------------------------------
//  Accesso con codice di classe
// ---------------------------------------------------------------------

export function accesso(_params, query) {
  const dopo = query.get('dopo') || '/';
  const input = h('input', {
    id: 'codice', type: 'password', autocomplete: 'current-password', required: true,
    maxlength: 100, 'aria-describedby': 'codice-aiuto codice-errore',
  });
  const errore = h('p', { class: 'campo-errore', id: 'codice-errore', role: 'alert' });
  const invia = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Entra con il codice');

  const form = h('form', {
    class: 'l-form', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      const c = input.value.trim();
      if (!c) { errore.textContent = 'Scrivi il codice di classe.'; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
      invia.disabled = true; errore.textContent = ''; input.removeAttribute('aria-invalid');
      try {
        await api.verificaCodice(c);
        prefs.codice = c;
        toast('Accesso effettuato', 'ok');
        vai(dopo.startsWith('/') && !dopo.startsWith('/accesso') ? dopo : '/');
      } catch (err) {
        errore.textContent = err.message;
        input.setAttribute('aria-invalid', 'true');
        input.focus();
      } finally {
        invia.disabled = false;
      }
    },
  },
    h('label', { class: 'campo', for: 'codice' },
      h('span', {}, 'Codice di classe'),
      h('div', { class: 'l-form__riga' }, input, invia),
      h('small', { id: 'codice-aiuto' }, 'Lo trovi nel gruppo della classe. Resta salvato su questo telefono.')),
    errore);

  const vaiAlCodice = () => { document.getElementById('top-landing')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(() => input.focus({ preventScroll: true }), 350); };

  const root = h('div', { class: 'landing' },
    heroLanding(form),
    sezioneComeFunziona(),
    sezioneMaterie(),
    h('section', { class: 'l-close', 'aria-labelledby': 'close-h' },
      h('div', { class: 'wrap' },
        h('h2', { class: 'l-close__testo', id: 'close-h' }, 'Il codice è nel gruppo della classe.'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: vaiAlCodice }, 'Inserisci il codice'))));

  mount(vistaEl(), root);
  avviaCardEstrazione(root.querySelector('.d-card'), root.querySelector('.l-art .pausa'));
  avviaMarquee(root.querySelector('.marquee'), root.querySelector('.pausa-riga'));
  requestAnimationFrame(() => {
    animaEntrata(root.querySelector('.l-hero'));
    root.querySelector('.l-art')?.classList.add('entrata-arte');
  });
}

/** Hero "collage": testo e codice a sinistra, l'app vera in una finestra a destra. */
function heroLanding(form) {
  const sessione = (giorno, ora, nomi, prossima) => h('div', { class: `d-sess ${prossima ? 'is-next' : ''}` },
    h('div', { class: 'd-sess__h' }, h('b', {}, giorno), h('small', {}, ora)),
    nomi.map(([ini, nome, stato]) => h('div', { class: 'd-row' },
      h('span', { class: 'av' }, ini), h('span', {}, nome), badge(stato))));
  return h('section', { class: 'l-hero', id: 'top-landing', 'aria-labelledby': 'hero-h' },
    h('div', { class: 'wrap l-hero__grid' },
      h('div', { class: 'l-hero__testo' },
        h('p', { class: 'l-pill' }, h('span', { class: 'mark', 'aria-hidden': 'true' }), 'Classe 5C Informatica'),
        h('h1', { id: 'hero-h' }, 'Interrogazioni della 5C, estratte a sorte'),
        h('p', { class: 'l-lead' }, 'Chi è interrogato, in che giorno e a che ora, materia per materia. L\'estrazione la fa il server: tutta la classe vede lo stesso risultato entro un secondo.'),
        form,
        h('p', { class: 'l-proof' },
          h('span', {}, 'Nessun account per i compagni: basta il codice.'),
          h('a', { href: '#/staff' }, 'Accesso staff'))),
      h('div', { class: 'l-art', role: 'img', 'aria-label': 'La pagina di Storia dell\'app con le prossime sessioni e i nomi estratti, e la card dell\'ultima estrazione' },
        h('div', { class: 'd-win', 'aria-hidden': 'true' },
          h('div', { class: 'd-win__bar' }, h('span', { class: 'd-win__dots' }, h('i'), h('i'), h('i')), h('span', {}, 'Interrogazioni · 5C Informatica')),
          h('div', { class: 'd-win__body' },
            h('div', { class: 'd-side' },
              h('span', { class: 'is-on', style: '--c:#0e7490' }, h('i'), 'Storia'),
              h('span', { style: '--c:#b45309' }, h('i'), 'Informatica'),
              h('span', { style: '--c:#be123c' }, h('i'), 'Italiano'),
              h('span', { style: '--c:#15803d' }, h('i'), 'Matematica'),
              h('span', { style: '--c:#1d4ed8' }, h('i'), 'Inglese'),
              h('span', { class: 'd-side__label' }, 'Classe'),
              h('span', {}, h('i'), 'Il mio nome'),
              h('span', {}, h('i'), 'Registro')),
            h('div', { class: 'd-main' },
              h('div', { class: 'd-main__head' }, h('h4', {}, 'Storia'), h('span', { class: 'd-live' }, 'In tempo reale')),
              sessione('Venerdì 20 novembre', '3ª ora · 09:50–10:45', [['GR', 'Giulia Romano', 'assegnato'], ['MC', 'Marco Colombo', 'assegnato'], ['SR', 'Sara Ricci', 'assegnato']], true),
              sessione('Venerdì 13 novembre', '3ª ora · 09:50–10:45', [['LB', 'Luca Bianchi', 'interrogato'], ['AM', 'Alessandro Marino', 'assente']], false)))),
        h('div', { class: 'd-card', 'aria-hidden': 'true' },
          h('div', { class: 'd-card__row' }, h('h5', {}, 'Estrazione · 20 novembre'), h('span', { class: 'd-chip', 'data-step': '' }, 'Salvata')),
          h('div', { class: 'd-line', 'data-step': '' }, h('i', {}, '1'), h('span', {}, 'Giulia Romano')),
          h('div', { class: 'd-line', 'data-step': '' }, h('i', {}, '2'), h('span', {}, 'Marco Colombo')),
          h('div', { class: 'd-line', 'data-step': '' }, h('i', {}, '3'), h('span', {}, 'Sara Ricci'))),
        h('button', { class: 'pausa', type: 'button', 'aria-label': 'Ferma l\'animazione', 'aria-pressed': 'false' }, icon('pausa', 16)))));
}

function sezioneComeFunziona() {
  const card = (titolo, testo, descr, pannello) => h('article', {}, h('h3', {}, titolo), h('p', {}, testo), h('div', { class: 'pannello', role: 'img', 'aria-label': descr }, pannello));
  return h('section', { class: 'l-band', id: 'come', 'aria-labelledby': 'come-h' },
    h('div', { class: 'wrap' },
      h('div', { class: 'section-head' },
        h('h2', { id: 'come-h' }, 'Dall\'estrazione in classe al telefono di tutti. ', h('span', { class: 'muted' }, 'Tre cose che fa l\'app.'))),
      h('div', { class: 'l-feat' },
        card('Estrazione a sorte, una volta sola',
          'Il sorteggio lo fa il server e il risultato resta salvato: non si rifà finché esce il nome giusto.',
          'Card di un\'estrazione del 20 novembre con tre nomi in ordine',
          [h('span', { class: 'l-mono' }, 'Estrazione · ven 20 nov · 3ª ora'),
           h('div', { class: 'riga' }, h('span', {}, '1. Giulia Romano')),
           h('div', { class: 'riga' }, h('span', {}, '2. Marco Colombo')),
           h('div', { class: 'riga' }, h('span', {}, '3. Sara Ricci'))]),
        card('Risultati sul telefono in un secondo',
          'Chi ha l\'app aperta vede i nomi comparire senza ricaricare. Senza rete resta l\'ultima versione scaricata.',
          'Due sessioni aggiornate in tempo reale, con lo stato assegnato',
          [h('span', { class: 'l-mono' }, 'Aggiornato in tempo reale'),
           h('div', { class: 'riga' }, h('span', {}, 'Storia · 20 novembre'), badge('assegnato')),
           h('div', { class: 'riga' }, h('span', {}, 'Informatica · 25 novembre'), badge('assegnato'))]),
        card('Imprevisti scritti nel registro',
          'Assenze, rinvii e spostamenti finiscono nel registro, con giorno, ora e motivo, visibili a tutti.',
          'Un interrogato e un assente, con il motivo e la nuova data',
          [h('div', { class: 'riga' }, h('span', {}, 'Luca Bianchi'), badge('interrogato')),
           h('div', { class: 'riga' }, h('span', {}, 'Alessandro Marino'), badge('assente')),
           h('span', { class: 'l-mono' }, 'Motivo: malato · riassegnato al 27/11')]))));
}

function sezioneMaterie() {
  const materie = ['Italiano', 'Storia', 'Informatica', 'Sistemi e reti', 'TPSIT', 'Matematica', 'Inglese', 'GPOI', 'Educazione civica'];
  const riga = [...materie, ...materie].map((m, i) => h('span', { 'aria-hidden': i >= materie.length ? 'true' : null }, m));
  return h('section', { class: 'l-materie', id: 'materie-l', 'aria-labelledby': 'materie-h' },
    h('div', { class: 'wrap' },
      h('div', { class: 'section-head' },
        h('h2', { id: 'materie-h' }, 'Ogni materia ha le sue date. ', h('span', { class: 'muted' }, 'Ciascuna con il suo calendario, le sue ore e i suoi prof.'))),
      h('div', { class: 'marquee' }, h('div', { class: 'marquee__track' }, riga)),
      h('button', { class: 'btn pausa-riga', type: 'button', 'aria-pressed': 'false' }, icon('pausa', 16), 'Ferma lo scorrimento')));
}

/** Il momento della card: mostra il risultato, lo tiene 1,8 s, poi i tre nomi arrivano a 0,7 s. */
function avviaCardEstrazione(card, pausa) {
  if (!card) return;
  const passi = [...card.querySelectorAll('[data-step]')];
  const ridotto = matchMedia('(prefers-reduced-motion: reduce)').matches;
  passi.forEach((p) => p.classList.add('is-in'));
  if (ridotto) { if (pausa) pausa.hidden = true; return; }
  let fermo = false;
  let timer = null;
  const ciclo = () => {
    clearTimeout(timer);
    if (fermo) return;
    card.classList.add('is-rewinding');
    passi.forEach((p) => p.classList.remove('is-in'));
    // Nomi prima, poi "Salvata".
    const ordine = [...passi.slice(1), passi[0]];
    ordine.forEach((p, i) => setTimeout(() => { if (!fermo) p.classList.add('is-in'); }, 400 + i * 700));
    timer = setTimeout(ciclo, 400 + ordine.length * 700 + 1800);
  };
  timer = setTimeout(ciclo, 1800);
  card.parentElement.addEventListener('pointerenter', () => { if (!fermo) ciclo(); });
  pausa?.addEventListener('click', () => {
    fermo = !fermo;
    pausa.setAttribute('aria-pressed', String(fermo));
    pausa.setAttribute('aria-label', fermo ? 'Riprendi l\'animazione' : 'Ferma l\'animazione');
    pausa.replaceChildren(icon(fermo ? 'freccia' : 'pausa', 16));
    if (fermo) { clearTimeout(timer); passi.forEach((p) => p.classList.add('is-in')); } else ciclo();
  });
}

function avviaMarquee(marquee, btn) {
  if (!marquee || !btn) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { btn.hidden = true; return; }
  btn.addEventListener('click', () => {
    const ferma = !marquee.classList.contains('is-paused');
    marquee.classList.toggle('is-paused', ferma);
    btn.setAttribute('aria-pressed', String(ferma));
    btn.replaceChildren(icon(ferma ? 'freccia' : 'pausa', 16), ferma ? 'Riprendi lo scorrimento' : 'Ferma lo scorrimento');
  });
}

/** Esce dal dispositivo: dimentica il codice e i dati offline. */
export async function esciDalDispositivo() {
  const ok = await conferma({ titolo: 'Uscire?', messaggio: 'Il codice di classe verrà dimenticato su questo dispositivo e i dati salvati per l\'uso offline verranno cancellati.', ok: 'Esci' });
  if (!ok) return;
  prefs.codice = null;
  try { await caches.delete('dati-v1'); } catch { /* cache non disponibile */ }
  vai(sessione.isStaff ? '/' : '/accesso');
}

/** Pulsante "Esci da questo dispositivo" (dimentica il codice). */
function pulsanteEsci() {
  if (!prefs.codice) return null;
  return h('button', {
    class: 'btn btn-ghost btn-sm',
    onclick: esciDalDispositivo,
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
    carica: async () => {
      const mioNome = prefs.mioNome;
      const [classe, mie] = await Promise.all([
        api.classe(),
        mioNome ? api.cerca(mioNome).catch(() => null) : null,
      ]);
      return { ...classe, mie };
    },
    disegna: (d) => {
      if (!d.materie.length) {
        return vuoto('Nessuna materia', 'L\'amministratore non ha ancora creato le materie.', 'libro');
      }
      return h('div', {}, h('div', { class: 'home-top' }, cardProssima(d.materie), cardMieDate(d.mie)), h('h2', { class: 'sottotitolo-sezione' }, 'Tutte le materie'), h('div', { class: 'griglia' }, d.materie.map(cardMateria)));
    },
  });
}

/** Card in evidenza: la prossima interrogazione della classe (tra tutte le materie). */
function cardProssima(materie) {
  const prossime = materie.filter((m) => m.prossima)
    .sort((a, b) => (a.prossima.data + (a.prossima.ora || 9)).localeCompare(b.prossima.data + (b.prossima.ora || 9)));
  const m = prossime[0];
  if (!m) return null;
  const p = m.prossima;
  const rel = quandoRelativo(p.data);
  return h('a', {
    class: 'hero-prossima', href: `#/materia/${encodeURIComponent(m.slug)}`, style: `--colore:${coloreMateria(m)}`,
    'data-key': 'hero', 'data-firma': firma([m.id, p]),
  },
    h('span', { class: 'hp-etichetta' }, 'Prossima interrogazione'),
    h('span', { class: 'hp-materia' }, m.nome),
    h('span', { class: 'hp-data' }, dataTitolo(p.data), rel ? h('span', { class: 'hp-rel' }, rel) : null),
    descriviOraProf(p) ? h('span', { class: 'hp-ora' }, icon('orologio', 16), descriviOraProf(p)) : null,
    h('span', { class: 'hp-posti' }, p.n_assegnati ? `${p.n_assegnati} di ${p.max_interrogati} estratti` : `${p.max_interrogati} da interrogare · estrazione da fare`));
}

/** "Le mie date": le prossime interrogazioni di chi ha salvato il proprio nome. */
function cardMieDate(mie) {
  // Solo se il nome salvato corrisponde a una persona sola.
  if (!mie || mie.risultati?.length !== 1) return null;
  const r = mie.risultati[0];
  const prossime = r.date.filter((x) => giorniDa(x.data) >= 0 && x.stato !== 'interrogato');
  return h('section', { class: 'card mie-date', 'data-key': 'mie-date', 'data-firma': firma(prossime) },
    h('h2', {}, icon('utente', 20), `Le tue date, ${r.nome}`),
    prossime.length
      ? h('ul', { class: 'persone' }, prossime.map((x) =>
          h('li', { class: 'persona' },
            h('a', { class: 'nome', href: `#/materia/${encodeURIComponent(x.slug)}` }, x.materia),
            h('span', {}, dataTitolo(x.data), descriviOra(x) ? ` · ${descriviOra(x)}` : ''),
            quandoRelativo(x.data) ? h('span', { class: 'tag accent' }, quandoRelativo(x.data)) : null,
            badge(x.stato),
            x.volontario ? h('span', { class: 'tag' }, icon('mano', 14), 'Volontario') : null)))
      : h('p', { class: 'muted', style: 'margin:0' }, 'Nessuna interrogazione in programma per te.'),
    h('p', { class: 'piccolo', style: 'margin:.75rem 0 0' }, h('a', { href: '#/cerca' }, 'Cambia nome o vedi lo storico')));
}

function cardMateria(m) {
  const p = m.prossima;
  const rel = p ? quandoRelativo(p.data) : '';
  return h('a', {
    class: 'card materia-card', href: `#/materia/${encodeURIComponent(m.slug)}`,
    'data-key': `m-${m.id}`, 'data-firma': firma([m.nome, m.colore, p]),
    style: `--colore:${coloreMateria(m)}`,
  },
    h('div', { class: 'card-head' },
      avatarMateria(m),
      h('h2', {}, m.nome),
      h('span', { class: 'freccia' }, icon('freccia', 18))),
    p
      ? [
          h('p', { class: 'prossima-data' }, 'Prossima: ', dataLunga(p.data), rel ? h('span', { class: 'tag accent', style: 'margin-left:.4rem' }, rel) : null),
          descriviOraProf(p) ? h('p', { class: 'ora-prof' }, icon('orologio', 14), descriviOraProf(p)) : null,
          p.argomento ? h('p', { class: 'meta' }, testoConLink(p.argomento, false)) : null,
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
  cont.addEventListener('ridisegna', () => vista.ridisegna());
  const vista = creaVista(cont, {
    carica: () => api.materia(slug),
    disegna: (d) => disegnaMateria(d),
    righeSkeleton: 4,
  });
  return vista;
}

/** Scheda scelta (Prossime/Passate) per ogni materia, ricordata tra un aggiornamento e l'altro. */
const schedaMateria = new Map();

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

  const scheda = schedaMateria.get(d.materia.slug) || 'prossime';
  const lista = scheda === 'passate' ? passate : future;
  const tab = (id, testo) => h('button', {
    type: 'button', role: 'tab', 'aria-selected': String(scheda === id),
    onclick: (e) => { schedaMateria.set(d.materia.slug, id); e.currentTarget.dispatchEvent(new CustomEvent('ridisegna', { bubbles: true })); },
  }, testo);

  return h('div', { style: `--colore:${coloreMateria(d.materia)}` },
    h('div', { class: 'barra-pagina' },
      h('a', { href: '#/', class: 'btn btn-ghost btn-sm' }, icon('indietro', 16), 'Materie'),
      h('div', { class: 'riga' },
        h('button', { class: 'btn-icon', type: 'button', 'aria-label': 'Condividi il link', title: 'Condividi', onclick: condividi }, icon('condividi', 20)),
        h('button', { class: 'btn-icon', type: 'button', 'aria-label': 'Esporta immagine o PDF', title: 'Esporta', onclick: () => apriEsportazione(d) }, icon('download', 20)))),
    h('header', { class: 'hero-materia' },
      avatarMateria(d.materia),
      h('div', { class: 'hm-testo' },
        h('h1', {}, d.materia.nome),
        h('p', {}, future.length ? `${future.length} ${future.length === 1 ? 'interrogazione' : 'interrogazioni'} in programma` : 'Nessuna interrogazione in programma'))),

    d.sessioni.length === 0
      ? vuoto('Nessuna sessione', 'Non sono ancora state fissate date per questa materia.', 'calendario')
      : [
          h('div', { class: 'tabs tabs-piene', role: 'tablist', 'aria-label': 'Sessioni' },
            tab('prossime', `Prossime · ${future.length}`), tab('passate', `Passate · ${passate.length}`)),
          lista.length
            ? h('div', { class: 'stack' }, lista.map((s) => cardSessione(s, { prossima: s.id === idProssima, passata: scheda === 'passate' })))
            : vuoto(scheda === 'passate' ? 'Nessuna sessione passata' : 'Nessuna interrogazione in programma', null, 'calendario'),
        ],

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
        descriviOraProf(s) ? h('p', { class: 'ora-prof' }, icon('orologio', 14), descriviOraProf(s)) : null,
        s.argomento ? h('p', { class: 'meta' }, testoConLink(s.argomento)) : null,
        h('p', { class: 'posti' }, `${presenti.length} di ${s.max_interrogati} interrogati`))),
    presenti.length || s.non_presenti.length
      ? h('ul', { class: 'persone' },
          presenti.map(rigaPersona),
          s.non_presenti.map(rigaPersona))
      : h('p', { class: 'muted piccolo', style: 'margin:.75rem 0 0' }, passata ? 'Nessun interrogato registrato.' : 'Estrazione non ancora effettuata.'));
}

function rigaPersona(p) {
  return h('li', { class: 'persona', 'data-key': `a-${p.id}`, 'data-firma': firma([p.stato, p.nota]) },
    h('span', { class: `avatar-persona st-${p.stato}`, 'aria-hidden': 'true' }, iniziali(p)),
    h('span', { class: 'persona-testo' },
      h('span', { class: 'nome' }, nomeCompleto(p)),
      h('span', { class: 'persona-tag' },
        badge(p.stato),
        p.volontario ? h('span', { class: 'tag' }, icon('mano', 14), 'Volontario') : null)),
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
    h('label', { class: 'check piccolo' }, ricorda, 'Ricorda il mio nome su questo dispositivo (le tue date compaiono in home)'),
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
              h('span', {}, dataTitolo(x.data), descriviOra(x) ? ` · ${descriviOra(x)}` : ''),
              badge(x.stato),
              x.volontario ? h('span', { class: 'tag' }, icon('mano', 14), 'Volontario') : null,
              x.argomento ? h('span', { class: 'nota' }, testoConLink(x.argomento)) : null)))
        : h('p', { class: 'muted', style: 'margin:0' }, 'Nessuna interrogazione assegnata per ora.'))));
}

