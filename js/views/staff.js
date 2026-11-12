// Area staff: accesso/registrazione, gestione materie, sessioni,
// estrazioni, imprevisti, elenco nomi, utenti e codice di classe.
// Ogni scrittura passa da una RPC che controlla ruolo e permessi sul server:
// i controlli qui nel client servono solo a mostrare l'interfaccia giusta.

import { sb, api, sessione, caricaProfilo } from '../api.js';
import { vai } from '../router.js';
import {
  h, icon, mount, badge, toast, vuoto, conferma, dialogo, dataLunga, dataTitolo, dataCompleta,
  meseBreve, giornoNumero, testoConLink, testoBreve, nomeCompleto, norm, slugify, STATI, oggiRoma,
} from '../ui.js';
import { creaVista, firma, dettagli, vistaEl } from './common.js';
import { mostraEstrazione } from '../draw.js';

// ---------------------------------------------------------------------
//  Utilità
// ---------------------------------------------------------------------

/** Esegue un'azione con gestione errori e messaggio di conferma. */
async function esegui(fn, messaggioOk) {
  try {
    const r = await fn();
    if (messaggioOk) toast(messaggioOk, 'ok');
    return r ?? true;
  } catch (e) {
    toast(e.message, 'errore', 6000);
    return null;
  }
}

function intestazione(titolo, sotto, ...azioni) {
  return h('div', { class: 'titolo-pagina' },
    h('div', { style: 'flex:1 1 220px;min-width:0' }, h('h1', {}, titolo), sotto ? h('p', { class: 'sotto' }, sotto) : null),
    azioni.length ? h('div', { class: 'riga' }, azioni) : null);
}

function indietro(href, testo) {
  return h('a', { href, class: 'btn btn-ghost btn-sm', style: 'margin-bottom:.5rem' }, icon('indietro', 16), testo);
}

/** Controlla i permessi lato client (solo per l'interfaccia). */
function guardia({ admin = false } = {}) {
  if (!sb) { mount(vistaEl(), vuoto('App non configurata', 'Inserisci URL e anon key in js/config.js.', 'esclamativo')); return false; }
  if (!sessione.isStaff) { vai('/staff'); return false; }
  if (admin && !sessione.isAdmin) {
    mount(vistaEl(), vuoto('Riservato all\'amministratore', 'Questa sezione è disponibile solo per l\'admin.', 'scudo',
      h('a', { class: 'btn', href: '#/staff' }, 'Torna all\'area staff')));
    return false;
  }
  return true;
}

function campo(etichetta, input, aiuto) {
  return h('label', { class: 'campo' }, h('span', {}, etichetta), input, aiuto ? h('small', {}, aiuto) : null);
}

// ---------------------------------------------------------------------
//  Accesso / registrazione / attesa approvazione / dashboard
// ---------------------------------------------------------------------

export function staffHome() {
  if (!sb) { guardia(); return; }
  if (!sessione.utente) return formAccesso();
  if (!sessione.isStaff) return attesaApprovazione();
  return dashboard();
}

function traduciErroreAuth(e) {
  const m = e?.message || '';
  if (/Invalid login credentials/i.test(m)) return 'Email o password errati.';
  if (/Email not confirmed/i.test(m)) return 'Devi prima confermare l\'email: controlla la posta (anche lo spam).';
  if (/already registered|already exists/i.test(m)) return 'Esiste già un account con questa email.';
  if (/Password should be/i.test(m)) return 'La password è troppo debole: usa almeno 8 caratteri.';
  if (/rate limit|too many/i.test(m)) return 'Troppi tentativi: riprova tra qualche minuto.';
  if (/Signups not allowed/i.test(m)) return 'Le registrazioni sono disattivate.';
  return m || 'Operazione non riuscita.';
}

function formAccesso() {
  let modo = 'accedi';
  const cont = h('div');
  const disegna = () => {
    const email = h('input', { type: 'email', autocomplete: 'email', required: true });
    const password = h('input', { type: 'password', autocomplete: modo === 'accedi' ? 'current-password' : 'new-password', required: true, minlength: 8 });
    const errore = h('p', { class: 'campo-errore', role: 'alert' });
    const invia = h('button', { class: 'btn btn-primary btn-blocco', type: 'submit' }, modo === 'accedi' ? 'Accedi' : 'Registrati');

    const form = h('form', {
      class: 'card',
      onsubmit: async (e) => {
        e.preventDefault();
        errore.textContent = '';
        invia.disabled = true;
        try {
          if (modo === 'accedi') {
            const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
            if (error) throw error;
            // app.js ricarica profilo e vista su SIGNED_IN.
          } else {
            const { data, error } = await sb.auth.signUp({
              email: email.value.trim(), password: password.value,
              options: { emailRedirectTo: location.origin + location.pathname },
            });
            if (error) throw error;
            if (!data.session) {
              mount(cont, h('div', { class: 'card' },
                h('h2', {}, 'Controlla la tua email'),
                h('p', {}, 'Ti abbiamo inviato un link di conferma. Dopo la conferma, l\'amministratore dovrà approvare il tuo account prima che tu possa fare modifiche.'),
                h('button', { class: 'btn', onclick: () => { modo = 'accedi'; disegna(); } }, 'Torna all\'accesso')));
            }
          }
        } catch (err) {
          errore.textContent = traduciErroreAuth(err);
        } finally {
          invia.disabled = false;
        }
      },
    },
      campo('Email', email),
      campo('Password', password, modo === 'registrati' ? 'Almeno 8 caratteri.' : null),
      errore, invia);

    const tab = (id, testo) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(modo === id),
      onclick: () => { modo = id; disegna(); },
    }, testo);

    mount(cont,
      h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Accesso o registrazione' }, tab('accedi', 'Accedi'), tab('registrati', 'Registrati')),
      form,
      modo === 'registrati'
        ? h('p', { class: 'muted piccolo', style: 'margin-top:1rem' }, 'La registrazione è riservata ai rappresentanti. Un account appena creato non ha alcun permesso finché l\'amministratore non lo approva.')
        : null);
    email.focus();
  };
  mount(vistaEl(), h('div', { class: 'accesso' },
    h('h1', {}, 'Area staff'),
    h('p', { class: 'muted' }, 'Per amministratore e rappresentanti.'),
    cont));
  disegna();
}

async function esci() {
  await sb.auth.signOut();
}

function attesaApprovazione() {
  mount(vistaEl(), h('div', { class: 'accesso' },
    vuoto('In attesa di approvazione',
      `Sei collegato come ${sessione.utente.email}. L'amministratore deve approvare il tuo account prima che tu possa fare estrazioni o modifiche.`,
      'orologio',
      h('div', { class: 'azioni', style: 'justify-content:center' },
        h('button', { class: 'btn', onclick: async () => { await caricaProfilo(); vai('/staff'); } }, 'Ricontrolla'),
        h('button', { class: 'btn btn-ghost', onclick: esci }, icon('esci', 16), 'Esci')))));
}

function dashboard() {
  const cont = h('div');
  const p = sessione.profilo;
  mount(vistaEl(),
    intestazione('Area staff', `${p.email} · ${p.ruolo === 'admin' ? 'Amministratore' : 'Rappresentante'}`,
      h('button', { class: 'btn btn-sm', onclick: esci }, icon('esci', 16), 'Esci')),
    cont);

  return creaVista(cont, {
    carica: async () => ({
      materie: await api.tabella('subjects', 'id,nome,slug,ordine', 'ordine'),
      staff: sessione.isAdmin ? await api.tabella('staff', 'user_id,approvato', 'creato_il') : [],
    }),
    disegna: (d) => {
      const inAttesa = d.staff.filter((s) => !s.approvato).length;
      return h('div', {},
        h('section', {},
          h('div', { class: 'riga', style: 'margin-bottom:.75rem' },
            h('h2', { style: 'margin:0' }, 'Materie'),
            h('span', { class: 'spazio' }),
            sessione.isAdmin ? h('button', { class: 'btn btn-primary btn-sm', onclick: () => dialogoMateria(null) }, icon('piu', 16), 'Nuova materia') : null),
          d.materie.length
            ? h('div', { class: 'griglia' }, d.materie.map((m) =>
                h('div', { class: 'card', 'data-key': `m-${m.id}`, 'data-firma': firma(m) },
                  h('div', { class: 'card-head' },
                    h('h3', { style: 'flex:1' }, m.nome),
                    sessione.isAdmin ? h('button', { class: 'btn-icon sm', 'aria-label': `Modifica ${m.nome}`, onclick: () => dialogoMateria(m) }, icon('matita', 18)) : null,
                    sessione.isAdmin ? h('button', { class: 'btn-icon sm', 'aria-label': `Elimina ${m.nome}`, onclick: () => eliminaMateria(m) }, icon('cestino', 18)) : null),
                  h('p', { class: 'meta' }, `#/materia/${m.slug}`),
                  h('div', { class: 'azioni-card' },
                    h('a', { class: 'btn btn-primary btn-sm', href: `#/staff/materia/${encodeURIComponent(m.slug)}` }, icon('dado', 16), 'Sessioni ed estrazioni'),
                    h('a', { class: 'btn btn-sm', href: `#/materia/${encodeURIComponent(m.slug)}` }, 'Vista pubblica')))))
            : vuoto('Nessuna materia', sessione.isAdmin ? 'Crea la prima materia per iniziare.' : 'L\'amministratore non ha ancora creato materie.', 'libro')),
        sessione.isAdmin
          ? h('section', { class: 'sezione' },
              h('h2', {}, icon('impostazioni', 16), 'Amministrazione'),
              h('div', { class: 'griglia tre' },
                linkCard('#/staff/studenti', 'gruppo', 'Elenco studenti', 'Carica il JSON, aggiungi, modifica o disattiva.'),
                linkCard('#/staff/utenti', 'scudo', 'Staff e rappresentanti', inAttesa ? `${inAttesa} in attesa di approvazione` : 'Approva o revoca i rappresentanti.', inAttesa > 0),
                linkCard('#/staff/impostazioni', 'impostazioni', 'Codice di classe', 'Imposta o cambia il codice per i compagni.')))
          : null);
    },
  });
}

function linkCard(href, ic, titolo, testo, evidenziato = false) {
  return h('a', { class: `card ${evidenziato ? 'prossima' : ''}`, href },
    h('div', { class: 'riga' }, icon(ic, 20), h('h3', { style: 'margin:0' }, titolo)),
    h('p', { class: 'meta' }, testo));
}

async function dialogoMateria(m) {
  await dialogo(m ? 'Modifica materia' : 'Nuova materia', (chiudi) => {
    const nome = h('input', { required: true, maxlength: 60, value: m?.nome || '' });
    const slug = h('input', { required: true, maxlength: 60, pattern: '[a-z0-9]+(-[a-z0-9]+)*', value: m?.slug || '' });
    const ordine = h('input', { type: 'number', min: 0, max: 999, value: String(m?.ordine ?? 0) });
    let slugToccato = !!m;
    slug.addEventListener('input', () => { slugToccato = true; });
    nome.addEventListener('input', () => { if (!slugToccato) slug.value = slugify(nome.value); });
    return h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const ok = await esegui(() => api.salvaMateria(m?.id ?? null, nome.value.trim(), slug.value.trim(), Number(ordine.value) || 0), 'Materia salvata');
        if (ok) chiudi(true);
      },
    },
      campo('Nome', nome),
      campo('Indirizzo (slug)', slug, 'Solo lettere minuscole, numeri e trattini. Cambiandolo, i link già condivisi smettono di funzionare.'),
      campo('Ordine', ordine, 'Le materie sono mostrate in ordine crescente.'),
      h('div', { class: 'azioni' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => chiudi(null) }, 'Annulla'),
        h('button', { class: 'btn btn-primary', type: 'submit' }, 'Salva')));
  });
}

async function eliminaMateria(m) {
  const ok = await conferma({
    titolo: `Eliminare "${m.nome}"?`,
    messaggio: 'Verranno eliminate anche tutte le sessioni e le assegnazioni di questa materia. Il registro modifiche resta. L\'operazione non si può annullare.',
    ok: 'Elimina definitivamente', pericolo: true,
  });
  if (ok) await esegui(() => api.eliminaMateria(m.id), 'Materia eliminata');
}

// ---------------------------------------------------------------------
//  Gestione di una materia: sessioni, estrazioni, imprevisti
// ---------------------------------------------------------------------

export function staffMateria({ slug }) {
  if (!guardia()) return;
  const cont = h('div');
  mount(vistaEl(), cont);
  const vista = creaVista(cont, {
    carica: () => api.staffMateria(slug),
    disegna: (d) => disegnaGestione(d, vista),
    righeSkeleton: 4,
  });
  return vista;
}

function disegnaGestione(d, vista) {
  const aggiorna = () => vista.aggiorna('azione');
  const oggi = d.oggi;
  const daRiassegnare = d.sessioni.flatMap((s) => s.assegnazioni
    .filter((a) => a.stato === 'assente' || a.stato === 'rimandato')
    .map((a) => ({ ...a, sessione: s })));
  const future = d.sessioni.filter((s) => s.data >= oggi);
  const passate = d.sessioni.filter((s) => s.data < oggi).reverse();

  return h('div', {},
    indietro('#/staff', 'Area staff'),
    intestazione(d.materia.nome, `Nel sorteggio: ${d.pool.length} ${d.pool.length === 1 ? 'studente' : 'studenti'}`,
      sessione.isAdmin ? h('button', { class: 'btn btn-primary btn-sm', onclick: async () => { if (await dialogoNuoveSessioni(d)) aggiorna(); } }, icon('piu', 16), 'Nuove sessioni') : null,
      h('a', { class: 'btn btn-sm', href: `#/materia/${encodeURIComponent(d.materia.slug)}` }, 'Vista pubblica')),

    daRiassegnare.length
      ? h('section', { class: 'card', style: 'margin-bottom:1rem;border-color:var(--b-rimandato-fg)', 'data-key': 'riassegna', 'data-firma': firma(daRiassegnare.map((a) => a.id)) },
          h('h2', { class: 'riga' }, icon('esclamativo', 18), `Da riassegnare (${daRiassegnare.length})`),
          h('ul', { class: 'persone' }, daRiassegnare.map((a) =>
            h('li', { class: 'persona' },
              h('span', { class: 'nome' }, nomeCompleto(a)), badge(a.stato),
              h('span', { class: 'muted piccolo' }, `dal ${dataCompleta(a.sessione.data)}`),
              h('button', { class: 'btn btn-sm btn-primary azioni-persona', onclick: async () => { if (await dialogoSposta(a, d, true)) aggiorna(); } }, icon('calendario', 16), 'Nuova data'),
              a.nota ? h('span', { class: 'nota' }, 'Motivo: ', a.nota) : null))))
      : null,

    d.sessioni.length === 0
      ? vuoto('Nessuna sessione', sessione.isAdmin ? 'Crea le sessioni con data, argomento e numero di interrogati.' : 'L\'amministratore non ha ancora creato sessioni.')
      : h('div', { class: 'stack' },
          future.map((s, i) => cardGestione(s, d, aggiorna, i === 0)),
          passate.length
            ? dettagli(`staff-passate-${d.materia.slug}`, false,
                h('span', { class: 'btn btn-ghost btn-sm' }, icon('orologio', 16), `Sessioni passate (${passate.length})`),
                h('div', { class: 'stack', style: 'margin-top:.75rem' }, passate.map((s) => cardGestione(s, d, aggiorna, false, true))))
            : null),

    sessione.isAdmin ? sezioneEsclusi(d, aggiorna) : null);
}

function cardGestione(s, d, aggiorna, prossima, passata = false) {
  const liberi = s.max_interrogati - s.assegnazioni.length;
  const estraibili = Math.min(liberi, d.pool.length);
  return h('article', {
    class: `card ${prossima ? 'prossima' : ''} ${passata ? 'passata' : ''}`,
    'data-key': `s-${s.id}`, 'data-firma': firma([s.data, s.argomento, s.max_interrogati, s.assegnazioni]),
  },
    h('div', { class: 'card-head' },
      h('div', { class: 'data-blocco', 'aria-hidden': 'true' },
        h('span', { class: 'giorno' }, giornoNumero(s.data)), h('span', { class: 'mese' }, meseBreve(s.data))),
      h('div', { style: 'flex:1;min-width:0' },
        h('h3', {}, dataTitolo(s.data)),
        s.argomento ? h('p', { class: 'meta' }, testoConLink(s.argomento)) : null,
        h('p', { class: 'posti' }, `${s.assegnazioni.length} di ${s.max_interrogati} posti occupati`)),
      h('button', { class: 'btn-icon sm', 'aria-label': `Modifica sessione del ${dataCompleta(s.data)}`, onclick: async () => { if (await dialogoSessione(s)) aggiorna(); } }, icon('matita', 18)),
      sessione.isAdmin ? h('button', { class: 'btn-icon sm', 'aria-label': `Elimina sessione del ${dataCompleta(s.data)}`, onclick: async () => { if (await eliminaSessione(s)) aggiorna(); } }, icon('cestino', 18)) : null),

    s.assegnazioni.length
      ? h('ul', { class: 'persone' }, s.assegnazioni.map((a) =>
          h('li', { class: 'persona', 'data-key': `a-${a.id}`, 'data-firma': firma([a.stato, a.nota, a.volontario]) },
            h('span', { class: 'nome' }, nomeCompleto(a)),
            badge(a.stato),
            a.volontario ? h('span', { class: 'tag' }, icon('mano', 14), 'Volontario') : null,
            h('button', {
              class: 'btn btn-sm azioni-persona', 'aria-label': `Azioni per ${nomeCompleto(a)}`,
              onclick: async () => { if (await dialogoAzioni(a, s, d)) aggiorna(); },
            }, icon('menu', 16), 'Gestisci'),
            a.nota ? h('span', { class: 'nota' }, 'Motivo: ', a.nota) : null)))
      : h('p', { class: 'muted piccolo', style: 'margin:.75rem 0 0' }, 'Nessuno ancora assegnato.'),

    h('div', { class: 'azioni-card' },
      liberi > 0
        ? h('button', {
            class: 'btn btn-primary btn-sm', disabled: estraibili === 0,
            title: estraibili === 0 ? 'Nessuno studente disponibile nel sorteggio' : null,
            onclick: () => avviaEstrazione(s, d, estraibili, aggiorna),
          }, icon('dado', 16), `Estrai ${estraibili || ''}`.trim())
        : h('span', { class: 'tag' }, icon('check', 14), 'Sessione al completo'),
      h('button', { class: 'btn btn-sm', onclick: async () => { if (await dialogoAggiungi(s, d)) aggiorna(); } }, icon('mano', 16), 'Volontari / aggiungi'),
      s.assegnazioni.some((a) => a.stato === 'assegnato' || a.stato === 'interrogato')
        ? h('button', { class: 'btn btn-sm', onclick: async () => { if (await dialogoCopia(s, d)) aggiorna(); } }, icon('sposta', 16), 'Copia in altra materia')
        : null,
      s.ultima_estrazione ? h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { if (await annullaEstrazione(s)) aggiorna(); } }, icon('annulla', 16), 'Annulla ultima estrazione') : null));
}

async function avviaEstrazione(s, d, quanti, aggiorna) {
  const ok = await conferma({
    titolo: 'Avviare l\'estrazione?',
    messaggio: `Verranno estratti ${quanti} ${quanti === 1 ? 'nome' : 'nomi'} per ${dataLunga(s.data)} tra ${d.pool.length} studenti nel sorteggio. Il risultato è deciso dal server, salvato subito e visibile a tutti.`,
    ok: 'Estrai',
  });
  if (!ok) return;
  const res = await esegui(() => api.estrai(s.id));
  if (!res) return;
  await mostraEstrazione({
    materia: d.materia.nome,
    data: s.data,
    estratti: res.estratti,
    nomiPool: d.pool.map((p) => `${p.nome} ${p.cognome}`),
  });
  aggiorna();
}

async function annullaEstrazione(s) {
  const n = s.assegnazioni.filter((a) => a.estrazione_id === s.ultima_estrazione).length;
  const r = await conferma({
    titolo: 'Annullare l\'ultima estrazione?',
    messaggio: `${n} ${n === 1 ? 'persona estratta tornerà' : 'persone estratte torneranno'} nel sorteggio. L'annullamento viene registrato nel registro modifiche, visibile a tutti.`,
    ok: 'Annulla estrazione', pericolo: true, chiediMotivo: true, motivoObbligatorio: true,
  });
  if (!r) return false;
  return !!(await esegui(() => api.annullaEstrazione(s.id, r.motivo), 'Estrazione annullata'));
}

async function dialogoAzioni(a, s, d) {
  return dialogo(nomeCompleto(a), (chiudi) => {
    const motivo = h('textarea', { rows: 2, maxlength: 200, placeholder: 'Facoltativo (es. "malato", "gita")' });
    const azioneStato = (stato) => h('button', {
      class: 'btn', type: 'button', disabled: a.stato === stato,
      onclick: async () => {
        const ok = await esegui(() => api.stato(a.id, stato, motivo.value.trim()), `${nomeCompleto(a)}: ${STATI[stato].testo.toLowerCase()}`);
        if (ok) chiudi(true);
      },
    }, icon(STATI[stato].icona, 18), stato === 'assegnato' ? 'Riporta ad assegnato' : STATI[stato].testo);

    return h('div', {},
      h('p', { class: 'riga' }, 'Stato attuale: ', badge(a.stato), h('span', { class: 'muted piccolo' }, `· ${dataLunga(s.data)}`)),
      campo('Motivo', motivo, 'Viene mostrato ai compagni nel registro modifiche.'),
      h('div', { class: 'scelte' },
        azioneStato('interrogato'), azioneStato('assente'), azioneStato('rimandato'), azioneStato('assegnato'),
        h('button', {
          class: 'btn', type: 'button',
          onclick: async () => { chiudi(null); await dialogoSposta(a, d, false, motivo.value.trim(), s.id); },
        }, icon('sposta', 18), 'Sposta ad altra data'),
        h('button', {
          class: 'btn', type: 'button', style: 'color:var(--danger)',
          onclick: async () => {
            const r = await conferma({
              titolo: `Rimuovere ${nomeCompleto(a)}?`,
              messaggio: 'Verrà tolto da questa sessione e tornerà nel sorteggio della materia.',
              ok: 'Rimuovi', pericolo: true,
            });
            if (r && await esegui(() => api.rimuovi(a.id, motivo.value.trim()), 'Rimosso dalla sessione')) chiudi(true);
          },
        }, icon('cestino', 18), 'Rimuovi dalla sessione')));
  });
}

async function dialogoSposta(a, d, riassegna, motivoIniziale = '', idCorrente = null) {
  const oggi = d.oggi;
  // Per uno spostamento si esclude la sessione attuale; per una
  // riassegnazione (assente/rimandato) va bene anche la stessa data.
  const opzioni = d.sessioni
    .filter((s) => riassegna || s.id !== idCorrente)
    .map((s) => ({ s, liberi: s.max_interrogati - s.assegnazioni.length + (s.assegnazioni.some((x) => x.id === a.id) ? 1 : 0) }));
  const ok = await dialogo(riassegna ? `Nuova data per ${nomeCompleto(a)}` : `Sposta ${nomeCompleto(a)}`, (chiudi) => {
    const sel = h('select', { required: true },
      h('option', { value: '' }, 'Scegli una sessione…'),
      opzioni.map(({ s, liberi }) => h('option', { value: String(s.id), disabled: liberi <= 0 },
        `${dataCompleta(s.data)}${s.data < oggi ? ' (passata)' : ''} · ${liberi > 0 ? `${liberi} ${liberi === 1 ? 'posto libero' : 'posti liberi'}` : 'al completo'}${s.argomento ? ' · ' + testoBreve(s.argomento) : ''}`)));
    const motivo = h('textarea', { rows: 2, maxlength: 200, value: motivoIniziale, placeholder: 'Facoltativo' });
    return h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        if (!sel.value) return;
        const r = await esegui(() => api.sposta(a.id, Number(sel.value), motivo.value.trim()), riassegna ? 'Riassegnato' : 'Spostato');
        if (r) chiudi(true);
      },
    },
      opzioni.length ? null : h('p', { class: 'muted' }, 'Non ci sono altre sessioni: creane una nuova.'),
      campo('Sessione', sel, 'Se non c\'è posto, aumenta prima il numero di interrogati della sessione.'),
      campo('Motivo', motivo),
      h('div', { class: 'azioni' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => chiudi(null) }, 'Annulla'),
        h('button', { class: 'btn btn-primary', type: 'submit' }, riassegna ? 'Riassegna' : 'Sposta')));
  });
  return ok;
}

async function dialogoAggiungi(s, d) {
  const disponibili = d.studenti.filter((x) => !x.assegnato);
  const liberi = s.max_interrogati - s.assegnazioni.length;
  return dialogo(`Aggiungi al ${dataCompleta(s.data)}`, (chiudi) => {
    const scelti = new Set();
    const filtro = h('input', { type: 'search', placeholder: 'Filtra…', 'aria-label': 'Filtra studenti', autocomplete: 'off' });
    const contatore = h('p', { class: 'piccolo', role: 'status' });
    const aumenta = h('input', { type: 'checkbox' });
    const rigaAumenta = h('label', { class: 'check', hidden: true }, aumenta, '');
    const tipoVol = h('input', { type: 'radio', name: 'tipo', value: 'vol', checked: true });
    const tipoMano = h('input', { type: 'radio', name: 'tipo', value: 'mano' });
    const motivo = h('textarea', { rows: 2, maxlength: 200, placeholder: 'Facoltativo' });
    const errore = h('p', { class: 'campo-errore', role: 'alert' });

    const aggiornaContatore = () => {
      const n = scelti.size;
      contatore.textContent = `${n} ${n === 1 ? 'selezionato' : 'selezionati'} · posti liberi: ${Math.max(0, liberi)}`;
      const oltre = n > liberi;
      rigaAumenta.hidden = !oltre;
      rigaAumenta.lastChild.textContent = `Aumenta i posti della sessione a ${s.assegnazioni.length + n}`;
      if (oltre && !aumenta.dataset.toccato) aumenta.checked = true;
    };
    aumenta.addEventListener('change', () => { aumenta.dataset.toccato = '1'; });

    const lista = h('ul', { class: 'lista-scelta' }, disponibili.map((x) => {
      const cb = h('input', { type: 'checkbox', value: String(x.id) });
      cb.addEventListener('change', () => { if (cb.checked) scelti.add(x.id); else scelti.delete(x.id); aggiornaContatore(); });
      return h('li', { dataset: { nome: norm(`${x.cognome} ${x.nome} ${x.nome} ${x.cognome}`) } },
        h('label', { class: 'check' }, cb, `${x.cognome} ${x.nome}`));
    }));
    filtro.addEventListener('input', () => {
      const q = norm(filtro.value);
      for (const li of lista.children) li.hidden = !!q && !li.dataset.nome.includes(q);
    });
    aggiornaContatore();

    return h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        errore.textContent = '';
        if (!scelti.size) { errore.textContent = 'Seleziona almeno uno studente.'; return; }
        if (scelti.size > liberi && !aumenta.checked) { errore.textContent = 'I posti non bastano: attiva "Aumenta i posti" o seleziona meno persone.'; return; }
        const r = await esegui(() => api.aggiungiMolti(s.id, [...scelti], tipoVol.checked, motivo.value.trim(), aumenta.checked),
          scelti.size === 1 ? 'Aggiunto' : `${scelti.size} persone aggiunte`);
        if (r) chiudi(true);
      },
    },
      disponibili.length
        ? [
            h('fieldset', { class: 'scelta-tipo' },
              h('legend', {}, 'Come vengono aggiunti'),
              h('label', { class: 'check' }, tipoVol, 'Volontari'),
              h('label', { class: 'check' }, tipoMano, 'Messi a mano per questo giorno')),
            filtro, lista, contatore, rigaAumenta,
          ]
        : h('p', { class: 'muted' }, 'Tutti gli studenti attivi sono già in elenco per questa materia.'),
      campo('Motivo', motivo, 'Visibile nel registro modifiche.'),
      errore,
      h('div', { class: 'azioni' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => chiudi(null) }, 'Annulla'),
        h('button', { class: 'btn btn-primary', type: 'submit', disabled: !disponibili.length }, 'Aggiungi')));
  });
}

/** Copia gli interrogati di questa sessione in una sessione di un'altra materia. */
async function dialogoCopia(s, d) {
  let materie;
  try { materie = (await api.tabella('subjects', 'id,nome,slug,ordine', 'ordine')).filter((m) => m.id !== d.materia.id); }
  catch (e) { toast(e.message, 'errore'); return null; }
  if (!materie.length) { toast('Non ci sono altre materie in cui copiare.', 'info'); return null; }
  const copiabili = s.assegnazioni.filter((a) => a.stato === 'assegnato' || a.stato === 'interrogato');

  return dialogo(`Copia in un'altra materia`, (chiudi) => {
    const selMateria = h('select', { required: true }, materie.map((m) => h('option', { value: String(m.id) }, m.nome)));
    const selSessione = h('select', { required: true });
    const motivo = h('textarea', { rows: 2, maxlength: 200, placeholder: 'Facoltativo' });
    const invia = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Copia');

    const caricaSessioni = async () => {
      selSessione.replaceChildren(h('option', { value: '' }, 'Caricamento…'));
      invia.disabled = true;
      try {
        const sessioni = await api.sessioniMateria(Number(selMateria.value));
        const opzioni = [];
        if (sessione.isAdmin) opzioni.push(h('option', { value: 'nuova' }, `Nuova sessione il ${dataCompleta(s.data)}`));
        for (const x of sessioni) opzioni.push(h('option', { value: String(x.id) },
          `${dataCompleta(x.data)}${x.argomento ? ' · ' + testoBreve(x.argomento) : ''} (${x.max_interrogati} posti)`));
        if (!opzioni.length) opzioni.push(h('option', { value: '' }, 'Nessuna sessione: chiedi all\'admin di crearne una'));
        selSessione.replaceChildren(...opzioni);
        // Preferisci una sessione esistente con la stessa data.
        const stessa = sessioni.find((x) => x.data === s.data);
        if (stessa) selSessione.value = String(stessa.id);
        invia.disabled = !selSessione.value;
      } catch (e) {
        selSessione.replaceChildren(h('option', { value: '' }, 'Errore nel caricamento'));
        toast(e.message, 'errore');
      }
    };
    selMateria.addEventListener('change', caricaSessioni);
    selSessione.addEventListener('change', () => { invia.disabled = !selSessione.value; });
    caricaSessioni();

    return h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        if (!selSessione.value) return;
        const r = await esegui(() => api.copiaSessione(s.id, Number(selMateria.value),
          selSessione.value === 'nuova' ? null : Number(selSessione.value), motivo.value.trim()));
        if (r) {
          const nomeMat = selMateria.selectedOptions[0].textContent;
          toast(`${r.copiati} ${r.copiati === 1 ? 'persona copiata' : 'persone copiate'} in ${nomeMat}` +
            (r.saltati.length ? ` · già presenti e saltati: ${r.saltati.join(', ')}` : ''), r.copiati ? 'ok' : 'info', 7000);
          chiudi(true);
        }
      },
    },
      h('p', {}, `Da ${d.materia.nome}, ${dataTitolo(s.data)}: `, h('strong', {}, copiabili.map(nomeCompleto).join(', ') || 'nessuno')),
      campo('Materia di destinazione', selMateria),
      campo('Sessione', selSessione, 'Chi è già in elenco in quella materia viene saltato. Se servono più posti vengono aggiunti.'),
      campo('Motivo', motivo),
      h('div', { class: 'azioni' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => chiudi(null) }, 'Annulla'),
        invia));
  });
}

async function dialogoSessione(s) {
  return dialogo('Modifica sessione', (chiudi) => {
    const data = h('input', { type: 'date', required: true, value: s.data });
    const arg = h('input', { maxlength: 200, value: s.argomento });
    const max = h('input', { type: 'number', min: Math.max(1, s.assegnazioni.length), max: 40, required: true, value: String(s.max_interrogati) });
    const motivo = h('textarea', { rows: 2, maxlength: 200, placeholder: 'Facoltativo (es. "verifica spostata")' });
    return h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const r = await esegui(() => api.modificaSessione(s.id, data.value, arg.value.trim(), Number(max.value), motivo.value.trim()), 'Sessione aggiornata');
        if (r) chiudi(true);
      },
    },
      campo('Data', data),
      campo('Argomento', arg),
      campo('Numero di interrogati', max, s.assegnazioni.length ? `Minimo ${s.assegnazioni.length} (già assegnati).` : null),
      campo('Motivo', motivo, 'Le modifiche finiscono nel registro, visibile a tutti.'),
      h('div', { class: 'azioni' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => chiudi(null) }, 'Annulla'),
        h('button', { class: 'btn btn-primary', type: 'submit' }, 'Salva')));
  });
}

async function eliminaSessione(s) {
  const r = await conferma({
    titolo: `Eliminare la sessione del ${dataCompleta(s.data)}?`,
    messaggio: s.assegnazioni.length
      ? `Le ${s.assegnazioni.length} persone assegnate torneranno nel sorteggio. L'operazione non si può annullare.`
      : 'L\'operazione non si può annullare.',
    ok: 'Elimina', pericolo: true, chiediMotivo: true,
  });
  if (!r) return false;
  return !!(await esegui(() => api.eliminaSessione(s.id, r.motivo), 'Sessione eliminata'));
}

async function dialogoNuoveSessioni(d) {
  return dialogo(`Nuove sessioni · ${d.materia.nome}`, (chiudi) => {
    const righe = h('div', { class: 'stack' });
    const aggiungiRiga = (valori = {}) => {
      const data = h('input', { type: 'date', required: true, value: valori.data || '', 'aria-label': 'Data' });
      const arg = h('input', { maxlength: 200, placeholder: 'Argomento (facoltativo)', 'aria-label': 'Argomento' });
      const max = h('input', { type: 'number', min: 1, max: 40, required: true, value: String(valori.max || 3), 'aria-label': 'Numero di interrogati', style: 'max-width:90px' });
      const riga = h('div', { class: 'card', style: 'padding:.75rem' },
        h('div', { class: 'riga' }, h('div', { style: 'flex:1;min-width:140px' }, data), max,
          h('button', { class: 'btn-icon sm', type: 'button', 'aria-label': 'Rimuovi riga', onclick: () => { if (righe.children.length > 1) riga.remove(); } }, icon('x', 18))),
        h('div', { style: 'margin-top:.5rem' }, arg));
      riga._valori = () => ({ data: data.value, argomento: arg.value.trim(), max_interrogati: Number(max.value) });
      righe.append(riga);
      data.focus();
    };
    // Proposta: una settimana dopo l'ultima sessione esistente.
    const ultima = d.sessioni.at(-1)?.data;
    const base = ultima && ultima >= oggiRoma() ? new Date(ultima + 'T12:00:00Z') : null;
    if (base) base.setUTCDate(base.getUTCDate() + 7);
    aggiungiRiga({ data: base ? base.toISOString().slice(0, 10) : '' });

    return h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const sessioni = [...righe.children].map((r) => r._valori());
        const r = await esegui(() => api.nuoveSessioni(d.materia.id, sessioni), sessioni.length === 1 ? 'Sessione creata' : `${sessioni.length} sessioni create`);
        if (r) chiudi(true);
      },
    },
      h('p', { class: 'muted piccolo' }, 'Ogni riga è una data con il suo numero di interrogati.'),
      righe,
      h('button', {
        class: 'btn btn-sm', type: 'button', style: 'margin-top:.75rem',
        onclick: () => {
          const ultimaRiga = righe.lastElementChild?._valori();
          let prossima = '';
          if (ultimaRiga?.data) { const x = new Date(ultimaRiga.data + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + 7); prossima = x.toISOString().slice(0, 10); }
          aggiungiRiga({ data: prossima, max: ultimaRiga?.max_interrogati });
        },
      }, icon('piu', 16), 'Aggiungi un\'altra data'),
      h('div', { class: 'azioni' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => chiudi(null) }, 'Annulla'),
        h('button', { class: 'btn btn-primary', type: 'submit' }, 'Crea sessioni')));
  }, { larghezza: 'larga' });
}

function sezioneEsclusi(d, aggiorna) {
  const sel = h('select', { 'aria-label': 'Studente da escludere' },
    h('option', { value: '' }, 'Escludi qualcuno dal sorteggio…'),
    d.pool.map((p) => h('option', { value: String(p.id) }, `${p.cognome} ${p.nome}`)));
  return h('section', { class: 'sezione' },
    h('h2', {}, icon('pausa', 16), 'Esclusi dal sorteggio'),
    h('div', { class: 'card', 'data-key': 'esclusi', 'data-firma': firma(d.esclusi) },
      h('p', { class: 'muted piccolo' }, 'Chi è escluso non viene estratto in questa materia, ma può essere aggiunto a mano.'),
      d.esclusi.length
        ? h('ul', { class: 'persone' }, d.esclusi.map((x) => h('li', { class: 'persona' },
            h('span', { class: 'nome' }, `${x.nome} ${x.cognome}`),
            h('button', {
              class: 'btn btn-sm azioni-persona',
              onclick: async () => { if (await esegui(() => api.esclusione(d.materia.id, x.student_id, false), 'Rimesso nel sorteggio')) aggiorna(); },
            }, 'Rimetti nel sorteggio'),
            x.motivo ? h('span', { class: 'nota' }, 'Motivo: ', x.motivo) : null)))
        : h('p', { class: 'piccolo', style: 'margin:0 0 .5rem' }, 'Nessuno escluso.'),
      h('div', { class: 'riga', style: 'margin-top:.75rem' },
        h('div', { style: 'flex:1;min-width:200px' }, sel),
        h('button', {
          class: 'btn btn-sm',
          onclick: async () => {
            if (!sel.value) return;
            const r = await conferma({ titolo: 'Escludere dal sorteggio?', messaggio: sel.selectedOptions[0].textContent, ok: 'Escludi', chiediMotivo: true });
            if (r && await esegui(() => api.esclusione(d.materia.id, Number(sel.value), true, r.motivo), 'Escluso dal sorteggio')) aggiorna();
          },
        }, 'Escludi'))));
}

// ---------------------------------------------------------------------
//  Elenco studenti (solo admin)
// ---------------------------------------------------------------------

export function staffStudenti() {
  if (!guardia({ admin: true })) return;
  const cont = h('div');
  const filtro = h('input', { type: 'search', placeholder: 'Filtra per nome', 'aria-label': 'Filtra per nome' });
  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  let studenti = [];

  mount(vistaEl(),
    indietro('#/staff', 'Area staff'),
    intestazione('Elenco studenti', 'Ogni modifica finisce nel registro, visibile a tutti.'),
    h('div', { class: 'riga', style: 'margin-bottom:1rem' },
      h('button', { class: 'btn btn-primary btn-sm', onclick: () => dialogoStudente(null) }, icon('piu', 16), 'Aggiungi'),
      h('button', { class: 'btn btn-sm', onclick: () => file.click() }, icon('upload', 16), 'Carica JSON'),
      h('button', { class: 'btn btn-sm', onclick: () => scaricaElenco(studenti) }, icon('download', 16), 'Scarica JSON'),
      file),
    h('div', { class: 'cerca-box', style: 'margin-bottom:1rem' }, icon('cerca', 18), filtro),
    cont);

  file.addEventListener('change', async () => {
    const f = file.files[0];
    file.value = '';
    if (f) await importaFile(f, studenti);
  });

  const vista = creaVista(cont, {
    carica: () => api.tabella('students', 'id,nome,cognome,attivo', 'cognome'),
    disegna: (lista) => {
      studenti = lista;
      const q = norm(filtro.value);
      const filtra = (s) => !q || norm(`${s.nome} ${s.cognome}`).includes(q) || norm(`${s.cognome} ${s.nome}`).includes(q);
      const attivi = lista.filter((s) => s.attivo && filtra(s));
      const inattivi = lista.filter((s) => !s.attivo && filtra(s));
      if (!lista.length) return vuoto('Elenco vuoto', 'Carica il file JSON con i nomi della classe o aggiungili uno alla volta.', 'gruppo');
      const riga = (s) => h('li', { class: 'persona', 'data-key': `st-${s.id}`, 'data-firma': firma(s) },
        h('span', { class: 'nome' }, `${s.cognome} ${s.nome}`),
        s.attivo ? null : h('span', { class: 'tag' }, 'Disattivato'),
        h('span', { class: 'azioni-persona riga' },
          h('button', { class: 'btn-icon sm', 'aria-label': `Modifica ${s.nome} ${s.cognome}`, onclick: () => dialogoStudente(s) }, icon('matita', 18)),
          h('button', {
            class: 'btn btn-sm',
            onclick: async () => {
              const r = await conferma({
                titolo: s.attivo ? `Disattivare ${s.nome} ${s.cognome}?` : `Riattivare ${s.nome} ${s.cognome}?`,
                messaggio: s.attivo ? 'Non verrà più estratto. Le assegnazioni già fatte e lo storico restano.' : 'Tornerà disponibile per le estrazioni.',
                ok: s.attivo ? 'Disattiva' : 'Riattiva', pericolo: s.attivo, chiediMotivo: true,
              });
              if (r) await esegui(() => api.attivaStudente(s.id, !s.attivo, r.motivo), s.attivo ? 'Disattivato' : 'Riattivato');
            },
          }, s.attivo ? 'Disattiva' : 'Riattiva')));
      return h('div', {},
        h('p', { class: 'muted piccolo' }, `${lista.filter((s) => s.attivo).length} attivi`),
        h('ul', { class: 'persone' }, attivi.map(riga)),
        inattivi.length
          ? dettagli('studenti-inattivi', false, h('span', { class: 'btn btn-ghost btn-sm', style: 'margin-top:1rem' }, `Disattivati (${inattivi.length})`),
              h('ul', { class: 'persone' }, inattivi.map(riga)))
          : null);
    },
  });
  filtro.addEventListener('input', () => vista.aggiorna('filtro'));
  return vista;
}

async function dialogoStudente(s) {
  await dialogo(s ? 'Modifica studente' : 'Nuovo studente', (chiudi) => {
    const nome = h('input', { required: true, maxlength: 60, value: s?.nome || '', autocomplete: 'off' });
    const cognome = h('input', { required: true, maxlength: 60, value: s?.cognome || '', autocomplete: 'off' });
    const motivo = h('textarea', { rows: 2, maxlength: 200, placeholder: 'Facoltativo' });
    return h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const r = await esegui(() => api.salvaStudente(s?.id ?? null, nome.value.trim(), cognome.value.trim(), motivo.value.trim()), 'Salvato');
        if (r) chiudi(true);
      },
    },
      campo('Nome', nome), campo('Cognome', cognome), campo('Motivo', motivo, 'Visibile nel registro modifiche.'),
      h('div', { class: 'azioni' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => chiudi(null) }, 'Annulla'),
        h('button', { class: 'btn btn-primary', type: 'submit' }, 'Salva')));
  });
}

function scaricaElenco(studenti) {
  const dati = studenti.filter((s) => s.attivo).map(({ nome, cognome }) => ({ nome, cognome }));
  const blob = new Blob([JSON.stringify(dati, null, 2) + '\n'], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `studenti-5c-${oggiRoma()}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Valida il JSON: [{"nome":"Mario","cognome":"Rossi"}, ...]. */
export function validaElenco(testo) {
  let dati;
  try { dati = JSON.parse(testo); } catch { throw new Error('Il file non è un JSON valido.'); }
  if (!Array.isArray(dati)) throw new Error('Il file deve contenere un elenco: [{"nome": "...", "cognome": "..."}, ...]');
  if (dati.length === 0) throw new Error('L\'elenco è vuoto.');
  if (dati.length > 200) throw new Error('Elenco troppo lungo (massimo 200 nomi).');
  const visti = new Set();
  return dati.map((x, i) => {
    if (!x || typeof x !== 'object') throw new Error(`Voce ${i + 1}: deve essere un oggetto con nome e cognome.`);
    const nome = typeof x.nome === 'string' ? x.nome.trim().replace(/\s+/g, ' ') : '';
    const cognome = typeof x.cognome === 'string' ? x.cognome.trim().replace(/\s+/g, ' ') : '';
    if (!nome || !cognome) throw new Error(`Voce ${i + 1}: mancano nome o cognome.`);
    if (nome.length > 60 || cognome.length > 60) throw new Error(`Voce ${i + 1}: nome o cognome troppo lungo.`);
    const k = `${nome.toLowerCase()}|${cognome.toLowerCase()}`;
    if (visti.has(k)) throw new Error(`Nome ripetuto: ${nome} ${cognome}.`);
    visti.add(k);
    return { nome, cognome };
  });
}

/** Calcola le differenze tra il file e l'elenco attuale (stessa logica del server). */
export function diffElenco(nuovo, attuale) {
  const chiave = (s) => `${s.nome.trim().toLowerCase()}|${s.cognome.trim().toLowerCase()}`;
  const mappa = new Map(attuale.map((s) => [chiave(s), s]));
  const nelFile = new Set(nuovo.map(chiave));
  const aggiunti = [], modificati = [];
  for (const n of nuovo) {
    const e = mappa.get(chiave(n));
    if (!e) aggiunti.push(n);
    else if (!e.attivo) modificati.push({ ...n, nota: 'riattivato' });
    else if (e.nome !== n.nome || e.cognome !== n.cognome) modificati.push({ ...n, nota: `prima: ${e.nome} ${e.cognome}` });
  }
  const disattivati = attuale.filter((s) => s.attivo && !nelFile.has(chiave(s)));
  return { aggiunti, modificati, disattivati };
}

async function importaFile(file, attuale) {
  let elenco;
  try {
    if (file.size > 200_000) throw new Error('File troppo grande.');
    elenco = validaElenco(await file.text());
  } catch (e) {
    toast(e.message, 'errore', 6000);
    return;
  }
  const diff = diffElenco(elenco, attuale);
  if (!diff.aggiunti.length && !diff.modificati.length && !diff.disattivati.length) {
    toast('Nessuna differenza rispetto all\'elenco attuale.', 'info');
    return;
  }
  const lista = (titolo, classe, voci, testo) => voci.length
    ? h('div', {}, h('strong', { class: classe }, `${titolo} (${voci.length})`), h('ul', {}, voci.map((v) => h('li', {}, testo(v)))))
    : null;

  await dialogo('Conferma import', (chiudi) => {
    const motivo = h('textarea', { rows: 2, maxlength: 200, placeholder: 'Facoltativo (es. "elenco aggiornato a novembre")' });
    return h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const r = await esegui(() => api.importaStudenti(elenco, motivo.value.trim()));
        if (r) {
          toast(`Import completato: ${r.aggiunti} aggiunti, ${r.modificati} modificati, ${r.disattivati} disattivati`, 'ok', 5000);
          chiudi(true);
        }
      },
    },
      h('p', {}, `Il file contiene ${elenco.length} nomi. Ecco cosa cambierà:`),
      h('div', { class: 'diff' },
        lista('Aggiunti', 'add', diff.aggiunti, (v) => `${v.nome} ${v.cognome}`),
        lista('Modificati o riattivati', 'mod', diff.modificati, (v) => `${v.nome} ${v.cognome} (${v.nota})`),
        lista('Disattivati (non presenti nel file)', 'del', diff.disattivati, (v) => `${v.nome} ${v.cognome}`)),
      h('p', { class: 'muted piccolo', style: 'margin-top:.75rem' }, 'Gli studenti disattivati non vengono cancellati: restano nello storico e non vengono più estratti.'),
      campo('Motivo', motivo),
      h('div', { class: 'azioni' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => chiudi(null) }, 'Annulla'),
        h('button', { class: 'btn btn-primary', type: 'submit' }, 'Applica modifiche')));
  }, { larghezza: 'larga' });
}

// ---------------------------------------------------------------------
//  Staff e rappresentanti (solo admin)
// ---------------------------------------------------------------------

export function staffUtenti() {
  if (!guardia({ admin: true })) return;
  const cont = h('div');
  mount(vistaEl(),
    indietro('#/staff', 'Area staff'),
    intestazione('Staff e rappresentanti', 'Chi si registra non ha permessi finché non lo approvi.'),
    cont);

  const vista = creaVista(cont, {
    carica: () => api.tabella('staff', 'user_id,email,ruolo,approvato,creato_il', 'creato_il'),
    disegna: (lista) => {
      const inAttesa = lista.filter((s) => !s.approvato);
      const approvati = lista.filter((s) => s.approvato);
      const azione = (s, ruolo, approvato, testo, msg, pericolo = false) => h('button', {
        class: 'btn btn-sm', style: pericolo ? 'color:var(--danger)' : null,
        onclick: async () => {
          if (pericolo) {
            const ok = await conferma({ titolo: `Revocare ${s.email}?`, messaggio: 'Perderà subito ogni permesso. Potrai riapprovarlo in seguito.', ok: 'Revoca', pericolo: true });
            if (!ok) return;
          }
          if (await esegui(() => (pericolo ? api.revocaStaff(s.user_id) : api.impostaStaff(s.user_id, ruolo, approvato)), msg)) vista.aggiorna('azione');
        },
      }, testo);
      const riga = (s) => {
        const io = s.user_id === sessione.utente.id;
        return h('li', { class: 'persona', 'data-key': `u-${s.user_id}`, 'data-firma': firma(s) },
          h('span', { class: 'nome', style: 'word-break:break-all' }, s.email),
          h('span', { class: 'tag' }, s.ruolo === 'admin' ? 'Admin' : 'Rappresentante'),
          io ? h('span', { class: 'tag accent' }, 'Tu') : null,
          io ? null : h('span', { class: 'azioni-persona riga' },
            s.approvato
              ? [
                  s.ruolo === 'admin'
                    ? azione(s, 'rappresentante', true, 'Rendi rappresentante', 'Ruolo aggiornato')
                    : azione(s, 'admin', true, 'Rendi admin', 'Ruolo aggiornato'),
                  azione(s, null, false, 'Revoca', 'Permessi revocati', true),
                ]
              : [
                  azione(s, 'rappresentante', true, 'Approva come rappresentante', 'Approvato'),
                ]));
      };
      return h('div', {},
        h('section', {},
          h('h2', {}, `In attesa (${inAttesa.length})`),
          inAttesa.length ? h('ul', { class: 'persone' }, inAttesa.map(riga)) : h('p', { class: 'muted' }, 'Nessuna richiesta in attesa.')),
        h('section', { class: 'sezione' },
          h('h2', {}, `Approvati (${approvati.length})`),
          h('ul', { class: 'persone' }, approvati.map(riga))));
    },
  });
  return vista;
}

// ---------------------------------------------------------------------
//  Codice di classe (solo admin)
// ---------------------------------------------------------------------

export function staffImpostazioni() {
  if (!guardia({ admin: true })) return;
  const c1 = h('input', { type: 'password', minlength: 6, maxlength: 100, required: true, autocomplete: 'new-password' });
  const c2 = h('input', { type: 'password', minlength: 6, maxlength: 100, required: true, autocomplete: 'new-password' });
  const errore = h('p', { class: 'campo-errore', role: 'alert' });
  mount(vistaEl(),
    indietro('#/staff', 'Area staff'),
    intestazione('Codice di classe', 'Serve ai compagni per vedere le date. Viene salvato solo come hash (bcrypt).'),
    h('form', {
      class: 'card', style: 'max-width:520px',
      onsubmit: async (e) => {
        e.preventDefault();
        errore.textContent = '';
        if (c1.value !== c2.value) { errore.textContent = 'I due codici non coincidono.'; return; }
        const ok = await conferma({
          titolo: 'Cambiare il codice?',
          messaggio: 'Chi usa il vecchio codice dovrà inserire quello nuovo. Ricordati di comunicarlo nel gruppo della classe.',
          ok: 'Cambia codice',
        });
        if (!ok) return;
        if (await esegui(() => api.impostaCodice(c1.value), 'Codice aggiornato')) { c1.value = ''; c2.value = ''; }
      },
    },
      campo('Nuovo codice', c1, 'Almeno 6 caratteri; meglio 8 o più, con lettere e numeri.'),
      campo('Ripeti il codice', c2),
      errore,
      h('div', { class: 'azioni' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Salva codice'))));
}
