// Punto di ingresso: tema, autenticazione, rotte, realtime e PWA.

import { sb, sessione, caricaProfilo, erroreAvvio } from './api.js';
import { prefs } from './prefs.js';
import { rotta, avviaRouter, risolvi, vistaCorrente, percorsoCorrente } from './router.js';
import { avviaRealtime } from './realtime.js';
import { avviaPwa } from './pwa.js';
import { h, icon, mount, vuoto, toast } from './ui.js';
import * as pub from './views/public.js';
import * as staff from './views/staff.js';

const view = () => document.getElementById('view');

// ---------------------------------------------------------------------
//  Tema: sistema → chiaro → scuro → sistema
// ---------------------------------------------------------------------

function applicaTema() {
  const t = prefs.tema;
  const root = document.documentElement;
  if (t === 'chiaro') root.dataset.theme = 'light';
  else if (t === 'scuro') root.dataset.theme = 'dark';
  else delete root.dataset.theme;

  const btn = document.getElementById('btn-tema');
  const etichette = { chiaro: 'Tema chiaro', scuro: 'Tema scuro' };
  const testo = etichette[t] || 'Tema automatico (come il sistema)';
  btn.replaceChildren(icon(t === 'chiaro' ? 'sole' : t === 'scuro' ? 'luna' : 'auto'));
  btn.setAttribute('aria-label', `${testo}. Cambia tema`);
  btn.title = testo;
}

function cambiaTema() {
  const ordine = [null, 'chiaro', 'scuro'];
  prefs.tema = ordine[(ordine.indexOf(prefs.tema) + 1) % ordine.length];
  applicaTema();
}

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

rotta('/', protetta(pub.home));
rotta('/materia/:slug', protetta(pub.materia));
rotta('/registro', protetta(pub.registro));
rotta('/cerca', protetta(pub.cerca));
rotta('/accesso', pub.accesso);
rotta('/staff', staff.staffHome);
rotta('/staff/materia/:slug', staff.staffMateria);
rotta('/staff/studenti', staff.staffStudenti);
rotta('/staff/utenti', staff.staffUtenti);
rotta('/staff/impostazioni', staff.staffImpostazioni);
rotta('/staff/backup', staff.staffBackup);
rotta('/staff/orario', staff.staffOrario);
rotta('/staff/cestino', staff.staffCestino);
rotta('/staff/nuova-password', staff.staffNuovaPassword);

let primaNavigazione = true;
function dopoCambioRotta(path) {
  const sezione = path.startsWith('/staff') ? 'staff'
    : path.startsWith('/registro') ? 'registro'
    : path.startsWith('/cerca') ? 'cerca'
    : path.startsWith('/accesso') ? '' : 'home';
  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === sezione) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
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
  document.querySelectorAll('[data-icon]').forEach((el) => el.replaceWith(icon(el.dataset.icon, 22)));
  applicaTema();
  document.getElementById('btn-tema').addEventListener('click', cambiaTema);
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
