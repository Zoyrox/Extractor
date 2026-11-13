// Accesso a Supabase: client, RPC pubbliche (con codice di classe) e RPC
// dello staff. Tutte le scritture passano da funzioni RPC lato server.

import { CONFIG, configMancante } from './config.js';
import { prefs } from './prefs.js';

// Versione fissata di supabase-js (aggiornala consapevolmente: il service
// worker la mette in cache per l'uso offline).
export const SUPABASE_JS_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';

/** Motivo per cui il client non è disponibile (null se tutto ok). */
export let erroreAvvio = null;

// Import dinamico: se il CDN non è raggiungibile l'app mostra un messaggio
// invece di una pagina bianca.
async function creaClient() {
  if (configMancante) { erroreAvvio = 'config'; return null; }
  try {
    const { createClient } = await import(SUPABASE_JS_URL);
    return createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  } catch (e) {
    console.warn('supabase-js non caricato', e);
    erroreAvvio = 'cdn';
    return null;
  }
}

export const sb = await creaClient();

/** Errore per codice di classe mancante/errato. */
export class CodiceError extends Error {
  constructor(tipo) {
    const msg = {
      errato: 'Codice di classe non valido.',
      bloccato: 'Troppi tentativi errati. Riprova tra qualche minuto.',
      non_impostato: 'Il codice di classe non è ancora stato impostato dall\'amministratore.',
      mancante: 'Inserisci il codice di classe.',
    }[tipo] || 'Accesso non riuscito.';
    super(msg);
    this.tipo = tipo;
  }
}

/** Traduce gli errori tecnici in messaggi comprensibili. */
function messaggioErrore(error) {
  const m = error?.message || String(error || '');
  if (!navigator.onLine || /Failed to fetch|NetworkError|Load failed/i.test(m)) {
    return 'Connessione assente. Controlla la rete e riprova.';
  }
  if (error?.code === '42501' || /permission denied|permessi/i.test(m)) {
    return m.includes('permessi') || m.includes('riservata') ? m : 'Non hai i permessi per questa operazione.';
  }
  if (error?.code === 'PGRST202') return 'Funzione non trovata sul server: hai eseguito lo schema SQL?';
  if (/JWT expired/i.test(m)) return 'Sessione scaduta: accedi di nuovo.';
  return m || 'Errore sconosciuto.';
}

/** Chiama una RPC e restituisce i dati, oppure lancia un Error leggibile. */
export async function rpc(nome, parametri = {}) {
  if (!sb) {
    throw new Error(erroreAvvio === 'cdn'
      ? 'Impossibile caricare l\'app: sei offline e i file non sono ancora in cache. Riprova con la rete.'
      : 'App non configurata: inserisci URL e anon key in js/config.js.');
  }
  const { data, error } = await sb.rpc(nome, parametri);
  if (error) throw new Error(messaggioErrore(error));
  if (data && typeof data === 'object' && !Array.isArray(data) && data.errore) {
    if (['errato', 'bloccato', 'non_impostato'].includes(data.errore)) throw new CodiceError(data.errore);
    if (data.errore === 'materia_non_trovata') throw new Error('Materia non trovata.');
    throw new Error(data.errore);
  }
  return data;
}

// ---------------------------------------------------------------------
//  Stato di accesso
// ---------------------------------------------------------------------

export const sessione = {
  utente: null,       // utente Supabase Auth (staff)
  profilo: null,      // { email, ruolo, approvato }
  get isStaff() { return !!this.profilo?.approvato; },
  get isAdmin() { return this.profilo?.approvato && this.profilo?.ruolo === 'admin'; },
  get haAccesso() { return this.isStaff || !!prefs.codice; },
};

export async function caricaProfilo() {
  if (!sb) return;
  const { data } = await sb.auth.getSession();
  sessione.utente = data.session?.user || null;
  sessione.profilo = null;
  if (sessione.utente) {
    try { sessione.profilo = await rpc('my_staff_profile'); } catch { sessione.profilo = null; }
  }
}

function codice() {
  // Lo staff approvato non ha bisogno del codice: il server lo riconosce dal token.
  const c = prefs.codice;
  if (!c && !sessione.isStaff) throw new CodiceError('mancante');
  return c || '';
}

// ---------------------------------------------------------------------
//  Letture pubbliche (protette dal codice di classe)
// ---------------------------------------------------------------------

export const api = {
  verificaCodice: (c) => rpc('verify_class_code', { p_code: c }),
  classe: () => rpc('get_class_data', { p_code: codice() }),
  materia: (slug) => rpc('get_subject', { p_code: codice(), p_slug: slug }),
  registro: ({ slug = null, studente = null, limit = 100, offset = 0 } = {}) =>
    rpc('get_changelog', { p_code: codice(), p_slug: slug, p_studente: studente, p_limit: limit, p_offset: offset }),
  cerca: (q) => rpc('cerca_studente', { p_code: codice(), p_q: q }),

  // -------- staff --------
  staffMateria: (slug) => rpc('staff_get_subject', { p_slug: slug }),
  estrai: (sessionId) => rpc('staff_draw', { p_session_id: sessionId }),
  annullaEstrazione: (sessionId, motivo) => rpc('staff_undo_last_draw', { p_session_id: sessionId, p_motivo: motivo }),
  aggiungi: (sessionId, studentId, volontario, motivo) =>
    rpc('staff_add_to_session', { p_session_id: sessionId, p_student_id: studentId, p_volontario: volontario, p_motivo: motivo || null }),
  aggiungiMolti: (sessionId, studentIds, volontario, motivo, aumentaMax) =>
    rpc('staff_add_many', { p_session_id: sessionId, p_student_ids: studentIds, p_volontario: volontario, p_motivo: motivo || null, p_aumenta_max: !!aumentaMax }),
  copiaSessione: (fromId, toSubject, toSession, motivo) =>
    rpc('staff_copy_session', { p_from_session: fromId, p_to_subject: toSubject, p_to_session: toSession, p_motivo: motivo || null }),
  async sessioniMateria(subjectId) {
    const { data, error } = await sb.from('sessions').select('id,data,argomento,max_interrogati').eq('subject_id', subjectId).order('data');
    if (error) throw new Error(messaggioErrore(error));
    return data;
  },
  bulk: (ids, azione, target, motivo, aumentaMax) =>
    rpc('staff_bulk', { p_assignment_ids: ids, p_azione: azione, p_target_session: target ?? null, p_motivo: motivo || null, p_aumenta_max: !!aumentaMax }),
  riordina: (sessionId, ids) => rpc('staff_reorder', { p_session_id: sessionId, p_assignment_ids: ids }),
  backupOra: () => rpc('admin_backup_now'),
  elencoBackup: () => rpc('admin_list_backups'),
  backup: (id) => rpc('admin_get_backup', { p_id: id }),
  stato: (assignmentId, stato, motivo) => rpc('staff_set_state', { p_assignment_id: assignmentId, p_stato: stato, p_motivo: motivo || null }),
  rimuovi: (assignmentId, motivo) => rpc('staff_remove_assignment', { p_assignment_id: assignmentId, p_motivo: motivo || null }),
  sposta: (assignmentId, target, motivo) =>
    rpc('staff_move_assignment', { p_assignment_id: assignmentId, p_target_session_id: target, p_motivo: motivo || null }),
  modificaSessione: (id, data, argomento, max, motivo, ora, teacherId) =>
    rpc('staff_update_session', { p_session_id: id, p_data: data, p_argomento: argomento, p_max: max, p_motivo: motivo || null, p_ora: ora ?? null, p_teacher_id: teacherId ?? null, p_imposta_ora_prof: true }),

  // -------- solo admin --------
  nuoveSessioni: (subjectId, sessioni) => rpc('staff_add_sessions', { p_subject_id: subjectId, p_sessioni: sessioni }),
  eliminaSessione: (id, motivo) => rpc('staff_delete_session', { p_session_id: id, p_motivo: motivo || null }),
  salvaMateria: (id, nome, slug, ordine, colore) => rpc('admin_save_subject_v2', { p_id: id, p_nome: nome, p_slug: slug, p_ordine: ordine, p_colore: colore || null }),
  orario: () => rpc('staff_get_orario'),
  salvaOrario: (ore, slot) => rpc('admin_save_orario', { p_ore: ore, p_slot: slot }),
  salvaProf: (id, nome, materie) => rpc('admin_save_teacher', { p_id: id, p_nome: nome, p_subject_ids: materie }),
  eliminaProf: (id) => rpc('admin_delete_teacher', { p_id: id }),
  cestino: () => rpc('admin_list_cestino'),
  ripristina: (id) => rpc('admin_restore_session', { p_id: id }),
  eliminaMateria: (id) => rpc('admin_delete_subject', { p_id: id }),
  esclusione: (subjectId, studentId, escluso, motivo) =>
    rpc('admin_set_exclusion', { p_subject_id: subjectId, p_student_id: studentId, p_escluso: escluso, p_motivo: motivo || null }),
  salvaStudente: (id, nome, cognome, motivo) => rpc('admin_save_student', { p_id: id, p_nome: nome, p_cognome: cognome, p_motivo: motivo || null }),
  attivaStudente: (id, attivo, motivo) => rpc('admin_set_student_active', { p_id: id, p_attivo: attivo, p_motivo: motivo || null }),
  importaStudenti: (elenco, motivo) => rpc('admin_import_students', { p_elenco: elenco, p_motivo: motivo || null }),
  impostaStaff: (userId, ruolo, approvato) => rpc('admin_set_staff', { p_user_id: userId, p_ruolo: ruolo, p_approvato: approvato }),
  revocaStaff: (userId) => rpc('admin_remove_staff', { p_user_id: userId }),
  impostaCodice: (c) => rpc('admin_set_class_code', { p_code: c }),

  // Letture dirette dello staff (consentite dalle policy RLS).
  async tabella(nome, select = '*', ordine = 'id') {
    const { data, error } = await sb.from(nome).select(select).order(ordine);
    if (error) throw new Error(messaggioErrore(error));
    return data;
  },
};
