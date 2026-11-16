// Punto di ingresso: tema, autenticazione, rotte, realtime e PWA.

import { sb, sessione, caricaProfilo, erroreAvvio } from './api.js';
import { rotta, avviaRouter, risolvi, vistaCorrente, percorsoCorrente } from './router.js';
import { avviaRealtime } from './realtime.js';
import { avviaPwa } from './pwa.js';
import { h, icon, mount, vuoto, toast } from './ui.js';
import * as pub from './views/public.js';
import * as staff from './views/staff.js';
import * as dash from './views/dashboard.js';
import { applicaTema, ciclaTema } from './tema.js';

const view = () => document.getElementById('view');

// ---------------------------------------------------------------------
//  Rotte
// ---------------------------------------------------------------------

/** Le pagine pubbliche richiedono il codice di classe (o un account staff). */
const protetta = (fn) => (params, query) => {
  if (!sessione.haAccesso) {
    const { path } = percorsoCorrente();
    location.replace('#/accesso?dopo=' + encodeURIComponent(path + (query.toString() ? '?' + query : '')));
    return null;
  }
  return fn(params, query);
};

rotta('/', protetta(dash.home));
rotta('/agenda', protetta(dash.agenda));
// Una sola pagina per materia: lo staff ci trova anche estrazioni e gestione.
rotta('/materia/:slug', (params, query) => (sessione.isStaff ? staff.staffMateria(params) : protetta(pub.materia)(params, query)));
rotta('/registro', protetta(pub.registro));
rotta('/cerca', protetta(pub.cerca));
rotta('/profilo', dash.profilo);
rotta('/accesso', pub.accesso);
rotta('/staff', staff.staffHome);
rotta('/staff/materia/:slug', ({ slug }) => { location.replace('#/materia/' + encodeURIComponent(slug)); return null; });
rotta('/staff/studenti', staff.staffStudenti);
rotta('/staff/utenti', staff.staffUtenti);
rotta('/staff/impostazioni', staff.staffImpostazioni);
rotta('/staff/backup', staff.staffBackup);
rotta('/staff/orario', staff.staffOrario);
rotta('/staff/cestino', staff.staffCestino);
rotta('/staff/nuova-password', staff.staffNuovaPassword);

let primaNavigazione = true;
function sezioneDi(path) {
  if (path === '/' || path.startsWith('/materia')) return 'home';
  if (path.startsWith('/agenda')) return 'agenda';
  if (path.startsWith('/registro')) return 'registro';
  if (path.startsWith('/accesso')) return '';
  return 'profilo';   // profilo, cerca, area staff
}

/** Etichetta della quarta scheda: "Gestione" per lo staff. */
function aggiornaEtichette() {
  const voce = document.querySelector('[data-nav="profilo"] .nav-label');
  if (voce) voce.textContent = sessione.isStaff ? 'Gestione' : 'Profilo';
}

function dopoCambioRotta(path) {
  const sezione = sezioneDi(path);
  document.body.dataset.pagina = path === '/' ? 'home' : sezione === 'home' ? 'materia' : sezione || 'accesso';
  aggiornaEtichette();
  const voci = [...document.querySelectorAll('[data-nav]')];
  voci.forEach((a) => {
    if (a.dataset.nav === sezione) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  // Indicatore della barra: scivola sotto la scheda attiva.
  const nav = document.querySelector('.app-nav');
  const idx = voci.findIndex((a) => a.dataset.nav === sezione);
  nav.dataset.idx = String(idx);
  if (idx >= 0 && nav.style.getPropertyValue('--idx') !== String(idx)) {
    nav.style.setProperty('--idx', String(idx));
    nav.classList.remove('cambia'); void nav.offsetWidth; nav.classList.add('cambia');
  }
  // Transizione di pagina.
  const v = view();
  v.classList.remove('vista-entra'); void v.offsetWidth; v.classList.add('vista-entra');
  if (!primaNavigazione) {
    window.scrollTo(0, 0);
    // Accessibilità: sposta il focus sul contenuto alla navigazione.
    document.getElementById('main').focus({ preventScroll: true });
  }
  primaNavigazione = false;
}

// ---------------------------------------------------------------------
//  Avvio
// ---------------------------------------------------------------------

async function avvio() {
  document.querySelectorAll('[data-icon]').forEach((el) => el.replaceWith(icon(el.dataset.icon, 24)));
  applicaTema();
  document.getElementById('btn-tema').addEventListener('click', (e) => ciclaTema(e.currentTarget));
  // Header in vetro quando si scorre la pagina.
  const suScroll = () => document.body.classList.toggle('scorrendo', window.scrollY > 8);
  window.addEventListener('scroll', suScroll, { passive: true });
  suScroll();
  avviaPwa();

  if (!sb) {
    mount(view(), erroreAvvio === 'config'
      ? vuoto('App da configurare',
          'Apri js/config.js e inserisci l\'URL del progetto Supabase e la anon key pubblica (vedi README).', 'impostazioni')
      : vuoto('Impossibile avviare l\'app',
          'Non è stato possibile caricare le librerie necessarie. Controlla la connessione e ricarica la pagina.', 'segnale',
          h('button', { class: 'btn btn-primary', onclick: () => location.reload() }, 'Ricarica')));
    document.getElementById('live').hidden = true;
    return;
  }

  // Ritorno dal link di conferma email di Supabase (token o errore nell'hash).
  const hashIniziale = location.hash;
  await caricaProfilo();
  if (/access_token=|error_description=|error_code=/.test(hashIniziale)) {
    const p = new URLSearchParams(hashIniziale.slice(1));
    const recupero = p.get('type') === 'recovery';
    if (p.get('error_description')) toast(`Link non valido o scaduto: ${p.get('error_description')}`, 'errore', 8000);
    else if (!recupero) toast('Email confermata.', 'ok');
    // Link "password dimenticata": porta alla pagina per sceglierne una nuova.
    history.replaceState(null, '', location.pathname + (recupero && !p.get('error_description') ? '#/staff/nuova-password' : '#/staff'));
  }

  // Login/logout dello staff: ricarica profilo e vista corrente.
  let utenteId = sessione.utente?.id || null;
  sb.auth.onAuthStateChange((evento, session) => {
    if (evento === 'PASSWORD_RECOVERY') setTimeout(() => { location.hash = '#/staff/nuova-password'; }, 0);
    const nuovoId = session?.user?.id || null;
    if (nuovoId === utenteId) return;
    utenteId = nuovoId;
    // Fuori dal callback: evita blocchi interni di supabase-js.
    setTimeout(async () => {
      await caricaProfilo();
      if (evento === 'SIGNED_OUT') toast('Sei uscito dall\'area staff');
      risolvi();
    }, 0);
  });

  await avviaRouter(dopoCambioRotta);

  // Realtime: al ping (o al fallback) aggiorna solo la vista corrente.
  avviaRealtime((motivo) => vistaCorrente()?.aggiorna?.(motivo), document.getElementById('live'));
}

avvio();
