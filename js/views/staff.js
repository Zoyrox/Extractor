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

    if (modo === 'recupera') {
      const em = h('input', { type: 'email', autocomplete: 'email', required: true });
      const err = h('p', { class: 'campo-errore', role: 'alert' });
      const btn = h('button', { class: 'btn btn-primary btn-blocco', type: 'submit' }, 'Invia link per reimpostare');
      mount(cont, h('form', {
        class: 'card',
        onsubmit: async (e) => {
          e.preventDefault();
          btn.disabled = true; err.textContent = '';
          const { error } = await sb.auth.resetPasswordForEmail(em.value.trim(), { redirectTo: location.origin + location.pathname });
          btn.disabled = false;
          if (error) { err.textContent = traduciErroreAuth(error); return; }
          mount(cont, h('div', { class: 'card' },
            h('h2', {}, 'Controlla la tua email'),
            h('p', {}, 'Se l\'indirizzo è registrato, riceverai un link per scegliere una nuova password.'),
            h('button', { class: 'btn', onclick: () => { modo = 'accedi'; disegna(); } }, 'Torna all\'accesso')));
        },
      },
        h('h2', {}, 'Password dimenticata'),
        h('p', { class: 'muted piccolo' }, 'Inserisci l\'email del tuo account staff: ti mandiamo un link per reimpostare la password.'),
        campo('Email', em), err, btn,
        h('button', { class: 'btn btn-ghost btn-blocco', type: 'button', style: 'margin-top:.5rem', onclick: () => { modo = 'accedi'; disegna(); } }, 'Annulla')));
      em.focus();
      return;
    }

    const tab = (id, testo) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(modo === id),
      onclick: () => { modo = id; disegna(); },
    }, testo);

    mount(cont,
      h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Accesso o registrazione' }, tab('accedi', 'Accedi'), tab('registrati', 'Registrati')),
      form,
      modo === 'accedi'
        ? h('p', { style: 'margin-top:.75rem;text-align:center' },
            h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { modo = 'recupera'; disegna(); } }, 'Password dimenticata?'))
        : null,
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
                linkCard('#/staff/impostazioni', 'impostazioni', 'Codice di classe', 'Imposta o cambia il codice per i compagni.'),
                linkCard('#/staff/backup', 'download', 'Backup', 'Copie automatiche settimanali e download dei dati.')))
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
  const barra = h('div', { class: 'barra-selezione', hidden: true, role: 'region', 'aria-label': 'Azioni sulle persone selezionate' });
  mount(vistaEl(), cont, barra);
  // Stato della pagina, conservato tra un aggiornamento realtime e l'altro.
  const stato = { sel: new Map(), riordino: null, ordine: null, dati: null, trascinando: false };
  let vista = null;
  const aggiornaBarra = () => disegnaBarra(barra, stato, () => vista.aggiorna('azione'));
  vista = creaVista(cont, {
    carica: () => api.staffMateria(slug),
    disegna: (d) => {
      stato.dati = d;
      // Togli dalla selezione chi non c'è più (es. rimosso da un'altra scheda).
      const presenti = new Map(d.sessioni.flatMap((s) => s.assegnazioni.map((a) => [a.id, { a, s }])));
      for (const id of [...stato.sel.keys()]) {
        if (presenti.has(id)) stato.sel.set(id, presenti.get(id)); else stato.sel.delete(id);
      }
      const nodo = disegnaGestione(d, vista, stato, aggiornaBarra);
      queueMicrotask(aggiornaBarra);
      return nodo;
    },
    righeSkeleton: 4,
    inPausa: () => stato.trascinando,
  });
  return {
    aggiorna: (m) => vista.aggiorna(m),
    distruggi: () => { vista.distruggi(); document.body.classList.remove('con-selezione'); },
  };
}

/** Barra in basso con le azioni rapide sulle persone selezionate. */
function disegnaBarra(barra, stato, aggiorna) {
  const n = stato.sel.size;
  document.body.classList.toggle('con-selezione', n > 0);
  if (!n) { barra.hidden = true; barra.replaceChildren(); return; }
  const ids = [...stato.sel.keys()];
  const svuota = () => {
    stato.sel.clear();
    document.querySelectorAll('.persona .sel').forEach((c) => { c.checked = false; c.closest('.persona').classList.remove('selezionata'); });
    disegnaBarra(barra, stato, aggiorna);
  };
  const fatto = () => { stato.sel.clear(); aggiorna(); };
  const eseguiStato = async (stat, etichetta) => {
    const r = await conferma({ titolo: `${etichetta}: ${n} ${n === 1 ? 'persona' : 'persone'}?`, messaggio: nomiSelezionati(stato), ok: 'Conferma', chiediMotivo: true });
    if (r && await esegui(() => api.bulk(ids, stat, null, r.motivo), `${n} ${n === 1 ? 'aggiornata' : 'aggiornate'}`)) fatto();
  };
  const az = (ic, testo, fn, extra = {}) => h('button', { class: 'btn btn-sm', type: 'button', onclick: fn, ...extra }, icon(ic, 16), testo);
  barra.replaceChildren(
    h('div', { class: 'riga' },
      h('strong', {}, `${n} ${n === 1 ? 'selezionata' : 'selezionate'}`),
      h('span', { class: 'spazio' }),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: svuota }, icon('x', 16), 'Deseleziona')),
    h('div', { class: 'riga-azioni' },
      az('check', 'Interrogati', () => eseguiStato('interrogato', 'Segna come interrogati')),
      az('x', 'Assenti', () => eseguiStato('assente', 'Segna come assenti')),
      az('rimanda', 'Rimandati', () => eseguiStato('rimandato', 'Segna come rimandati')),
      az('calendario', 'Assegnati', () => eseguiStato('assegnato', 'Riporta ad assegnati')),
      az('sposta', 'Sposta…', async () => { if (await dialogoSpostaMolti(stato, ids)) fatto(); }),
      az('cestino', 'Rimuovi', async () => {
        const r = await conferma({
          titolo: `Rimuovere ${n} ${n === 1 ? 'persona' : 'persone'} dal giorno?`,
          messaggio: `${nomiSelezionati(stato)}. Torneranno nel sorteggio della materia.`,
          ok: 'Rimuovi', pericolo: true, chiediMotivo: true,
        });
        if (r && await esegui(() => api.bulk(ids, 'rimuovi', null, r.motivo), 'Rimossi')) fatto();
      }, { style: 'color:var(--danger)' })));
  barra.hidden = false;
}

function nomiSelezionati(stato) {
  return [...stato.sel.values()].map(({ a }) => nomeCompleto(a)).join(', ');
}

async function dialogoSpostaMolti(stato, ids) {
  const d = stato.dati;
  const n = ids.length;
  return dialogo(`Sposta ${n} ${n === 1 ? 'persona' : 'persone'}`, (chiudi) => {
    const opzioni = d.sessioni.map((s) => {
      const giaDentro = ids.filter((id) => s.assegnazioni.some((a) => a.id === id)).length;
      return { s, liberi: s.max_interrogati - s.assegnazioni.length, servono: n - giaDentro };
    });
    const sel = h('select', { required: true },
      h('option', { value: '' }, 'Scegli una sessione…'),
      opzioni.map(({ s, liberi }) => h('option', { value: String(s.id) },
        `${dataCompleta(s.data)}${s.data < d.oggi ? ' (passata)' : ''} · ${Math.max(0, liberi)} liberi${s.argomento ? ' · ' + testoBreve(s.argomento) : ''}`)));
    const aumenta = h('input', { type: 'checkbox', checked: true });
    const rigaAumenta = h('label', { class: 'check', hidden: true }, aumenta, 'Aumenta i posti se non bastano');
    sel.addEventListener('change', () => {
      const o = opzioni.find((x) => String(x.s.id) === sel.value);
      rigaAumenta.hidden = !o || o.servono <= o.liberi;
    });
    const motivo = h('textarea', { rows: 2, maxlength: 200, placeholder: 'Facoltativo (es. "gita")' });
    return h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        if (!sel.value) return;
        const r = await esegui(() => api.bulk(ids, 'sposta', Number(sel.value), motivo.value.trim(), aumenta.checked), `${n} ${n === 1 ? 'spostata' : 'spostate'}`);
        if (r) chiudi(true);
      },
    },
      h('p', { class: 'muted piccolo' }, nomiSelezionati(stato)),
      campo('Nuova data', sel), rigaAumenta, campo('Motivo', motivo, 'Visibile a tutti nel registro modifiche.'),
      h('div', { class: 'azioni' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => chiudi(null) }, 'Annulla'),
        h('button', { class: 'btn btn-primary', type: 'submit' }, 'Sposta')));
  });
}

/** Casella di selezione per una persona. */
function casella(a, s, stato, aggiornaBarra) {
  const cb = h('input', { type: 'checkbox', class: 'sel', 'aria-label': `Seleziona ${nomeCompleto(a)}`, checked: stato.sel.has(a.id) });
  cb.addEventListener('change', () => {
    if (cb.checked) stato.sel.set(a.id, { a, s }); else stato.sel.delete(a.id);
    cb.closest('.persona').classList.toggle('selezionata', cb.checked);
    aggiornaBarra();
  });
  return cb;
}

function disegnaGestione(d, vista, stato, aggiornaBarra) {
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
            h('li', { class: `persona ${stato.sel.has(a.id) ? 'selezionata' : ''}` },
              casella(a, a.sessione, stato, aggiornaBarra),
              h('span', { class: 'nome' }, nomeCompleto(a)), badge(a.stato),
              h('span', { class: 'muted piccolo' }, `dal ${dataCompleta(a.sessione.data)}`),
              h('button', { class: 'btn btn-sm btn-primary azioni-persona', onclick: async () => { if (await dialogoSposta(a, d, true)) aggiorna(); } }, icon('calendario', 16), 'Nuova data'),
              a.nota ? h('span', { class: 'nota' }, 'Motivo: ', a.nota) : null))))
      : null,

    d.sessioni.length === 0
      ? vuoto('Nessuna sessione', sessione.isAdmin ? 'Crea le sessioni con data, argomento e numero di interrogati.' : 'L\'amministratore non ha ancora creato sessioni.')
      : h('div', { class: 'stack' },
          future.map((s, i) => cardGestione(s, d, aggiorna, i === 0, false, stato, aggiornaBarra, vista)),
          passate.length
            ? dettagli(`staff-passate-${d.materia.slug}`, false,
                h('span', { class: 'btn btn-ghost btn-sm' }, icon('orologio', 16), `Sessioni passate (${passate.length})`),
                h('div', { class: 'stack', style: 'margin-top:.75rem' }, passate.map((s) => cardGestione(s, d, aggiorna, false, true, stato, aggiornaBarra, vista))))
            : null),

    sessione.isAdmin ? sezioneEsclusi(d, aggiorna) : null);
}

function cardGestione(s, d, aggiorna, prossima, passata, stato, aggiornaBarra, vista) {
  const liberi = s.max_interrogati - s.assegnazioni.length;
  const estraibili = Math.min(liberi, d.pool.length);
  const inRiordino = stato.riordino === s.id;
  const ridisegna = () => vista.ridisegna();

  let elenco;
  if (inRiordino) {
    elenco = listaRiordino(s, stato);
  } else if (s.assegnazioni.length) {
    elenco = h('ul', { class: 'persone' }, s.assegnazioni.map((a) =>
      h('li', { class: `persona ${stato.sel.has(a.id) ? 'selezionata' : ''}`, 'data-key': `a-${a.id}`, 'data-firma': firma([a.stato, a.nota, a.volontario]) },
        casella(a, s, stato, aggiornaBarra),
        h('span', { class: 'nome' }, nomeCompleto(a)),
        badge(a.stato),
        a.volontario ? h('span', { class: 'tag' }, icon('mano', 14), 'Volontario') : null,
        h('button', {
          class: 'btn btn-sm azioni-persona', 'aria-label': `Azioni per ${nomeCompleto(a)}`,
          onclick: async () => { if (await dialogoAzioni(a, s, d)) aggiorna(); },
        }, icon('menu', 16), 'Gestisci'),
        a.nota ? h('span', { class: 'nota' }, 'Motivo: ', a.nota) : null)));
  } else {
    elenco = h('p', { class: 'muted piccolo', style: 'margin:.75rem 0 0' }, 'Nessuno ancora assegnato.');
  }

  const tuttiSelezionati = s.assegnazioni.length > 0 && s.assegnazioni.every((a) => stato.sel.has(a.id));
  const azioni = inRiordino
    ? h('div', { class: 'azioni-card' },
        h('button', {
          class: 'btn btn-primary btn-sm',
          onclick: async () => {
            if (await esegui(() => api.riordina(s.id, stato.ordine), 'Ordine salvato')) { stato.riordino = null; stato.ordine = null; aggiorna(); }
          },
        }, icon('check', 16), 'Salva ordine'),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { stato.riordino = null; stato.ordine = null; ridisegna(); } }, 'Annulla'))
    : h('div', { class: 'azioni-card' },
        liberi > 0
          ? h('button', {
              class: 'btn btn-primary btn-sm', disabled: estraibili === 0,
              title: estraibili === 0 ? 'Nessuno studente disponibile nel sorteggio' : null,
              onclick: () => avviaEstrazione(s, d, estraibili, aggiorna),
            }, icon('dado', 16), `Estrai ${estraibili || ''}`.trim())
          : h('span', { class: 'tag' }, icon('check', 14), 'Sessione al completo'),
        h('button', { class: 'btn btn-sm', onclick: async () => { if (await dialogoAggiungi(s, d)) aggiorna(); } }, icon('mano', 16), 'Volontari / aggiungi'),
        s.assegnazioni.length
          ? h('button', {
              class: 'btn btn-sm',
              onclick: () => {
                for (const a of s.assegnazioni) { if (tuttiSelezionati) stato.sel.delete(a.id); else stato.sel.set(a.id, { a, s }); }
                ridisegna();
              },
            }, icon('seleziona', 16), tuttiSelezionati ? 'Deseleziona tutti' : 'Seleziona tutti')
          : null,
        s.assegnazioni.length > 1
          ? h('button', { class: 'btn btn-sm', onclick: () => { stato.riordino = s.id; stato.ordine = s.assegnazioni.map((a) => a.id); ridisegna(); } }, icon('ordina', 16), 'Ordina')
          : null,
        s.assegnazioni.some((a) => a.stato === 'assegnato' || a.stato === 'interrogato')
          ? h('button', { class: 'btn btn-sm', onclick: async () => { if (await dialogoCopia(s, d)) aggiorna(); } }, icon('sposta', 16), 'Copia in altra materia')
          : null,
        s.ultima_estrazione ? h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { if (await annullaEstrazione(s)) aggiorna(); } }, icon('annulla', 16), 'Annulla ultima estrazione') : null);

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
        h('p', { class: 'posti' }, inRiordino ? 'Trascina o usa le frecce per scegliere chi va per primo' : `${s.assegnazioni.length} di ${s.max_interrogati} posti occupati`)),
      h('button', { class: 'btn-icon sm', 'aria-label': `Modifica sessione del ${dataCompleta(s.data)}`, onclick: async () => { if (await dialogoSessione(s)) aggiorna(); } }, icon('matita', 18)),
      sessione.isAdmin ? h('button', { class: 'btn-icon sm', 'aria-label': `Elimina sessione del ${dataCompleta(s.data)}`, onclick: async () => { if (await eliminaSessione(s)) aggiorna(); } }, icon('cestino', 18)) : null),
    elenco,
    azioni);
}

/** Elenco in modalità "Ordina": maniglia per trascinare + frecce su/giù. */
function listaRiordino(s, stato) {
  const perId = new Map(s.assegnazioni.map((a) => [a.id, a]));
  // Tiene l'ordine scelto anche se nel frattempo arrivano aggiornamenti.
  stato.ordine = [...stato.ordine.filter((id) => perId.has(id)), ...s.assegnazioni.map((a) => a.id).filter((id) => !stato.ordine.includes(id))];
  const ul = h('ul', { class: 'persone' });
  const sposta = (da, a) => {
    if (a < 0 || a >= stato.ordine.length || da === a) return;
    const [x] = stato.ordine.splice(da, 1);
    stato.ordine.splice(a, 0, x);
    disegna(a);
  };
  function disegna(focusIndice = null) {
    ul.replaceChildren(...stato.ordine.map((id, i) => {
      const a = perId.get(id);
      return h('li', { class: 'persona trascinabile' },
        h('span', { class: 'maniglia', title: 'Trascina', 'aria-hidden': 'true' }, icon('grip', 18)),
        h('span', { class: 'numero-ordine' }, `${i + 1}.`),
        h('span', { class: 'nome' }, nomeCompleto(a)),
        badge(a.stato),
        h('span', { class: 'azioni-persona riga' },
          h('button', { class: 'btn-icon sm', type: 'button', 'aria-label': `Sposta su ${nomeCompleto(a)}`, disabled: i === 0, onclick: () => sposta(i, i - 1) }, icon('su', 18)),
          h('button', { class: 'btn-icon sm', type: 'button', 'aria-label': `Sposta giù ${nomeCompleto(a)}`, disabled: i === stato.ordine.length - 1, onclick: () => sposta(i, i + 1) }, icon('giu', 18))));
    }));
    if (focusIndice !== null) {
      const btns = ul.children[focusIndice]?.querySelectorAll('button');
      (btns?.[0]?.disabled ? btns?.[1] : btns?.[0])?.focus();
    }
  }
  // Trascinamento con il dito o il mouse (pointer events).
  ul.addEventListener('pointerdown', (e) => {
    const man = e.target.closest('.maniglia');
    if (!man) return;
    e.preventDefault();
    const li = man.closest('li');
    const voci = [...ul.children];
    const da = voci.indexOf(li);
    const passo = voci.length > 1 ? voci[1].getBoundingClientRect().top - voci[0].getBoundingClientRect().top : li.offsetHeight;
    const y0 = e.clientY;
    let a = da;
    li.classList.add('trascinata');
    stato.trascinando = true;
    man.setPointerCapture(e.pointerId);
    const muovi = (ev) => {
      const dy = ev.clientY - y0;
      li.style.transform = `translateY(${dy}px)`;
      a = Math.max(0, Math.min(voci.length - 1, da + Math.round(dy / passo)));
      voci.forEach((v, i) => {
        if (v === li) return;
        let sh = 0;
        if (da < a && i > da && i <= a) sh = -passo;
        if (da > a && i < da && i >= a) sh = passo;
        v.style.transform = sh ? `translateY(${sh}px)` : '';
        v.style.transition = 'transform .15s';
      });
    };
    const fine = () => {
      stato.trascinando = false;
      man.removeEventListener('pointermove', muovi);
      voci.forEach((v) => { v.style.transform = ''; v.style.transition = ''; });
      li.classList.remove('trascinata');
      if (a !== da) sposta(da, a); else disegna();
    };
    man.addEventListener('pointermove', muovi);
    man.addEventListener('pointerup', fine, { once: true });
    man.addEventListener('pointercancel', fine, { once: true });
  });
  disegna();
  return ul;
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

// ---------------------------------------------------------------------
//  Nuova password (dopo il link "password dimenticata")
// ---------------------------------------------------------------------

export function staffNuovaPassword() {
  if (!sb) { guardia(); return; }
  if (!sessione.utente) {
    mount(vistaEl(), h('div', { class: 'accesso' }, vuoto('Link scaduto o non valido',
      'Richiedi un nuovo link da "Password dimenticata?".', 'esclamativo',
      h('a', { class: 'btn btn-primary', href: '#/staff' }, 'Vai all\'accesso'))));
    return;
  }
  const p1 = h('input', { type: 'password', minlength: 8, required: true, autocomplete: 'new-password' });
  const p2 = h('input', { type: 'password', minlength: 8, required: true, autocomplete: 'new-password' });
  const err = h('p', { class: 'campo-errore', role: 'alert' });
  mount(vistaEl(), h('div', { class: 'accesso' },
    h('h1', {}, 'Nuova password'),
    h('p', { class: 'muted' }, sessione.utente.email),
    h('form', {
      class: 'card',
      onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = '';
        if (p1.value !== p2.value) { err.textContent = 'Le due password non coincidono.'; return; }
        const { error } = await sb.auth.updateUser({ password: p1.value });
        if (error) { err.textContent = traduciErroreAuth(error); return; }
        toast('Password aggiornata', 'ok');
        vai('/staff');
      },
    },
      campo('Nuova password', p1, 'Almeno 8 caratteri.'),
      campo('Ripeti la password', p2),
      err,
      h('button', { class: 'btn btn-primary btn-blocco', type: 'submit' }, 'Salva password'))));
  p1.focus();
}

// ---------------------------------------------------------------------
//  Backup (solo admin)
// ---------------------------------------------------------------------

function scaricaJson(dati, nome) {
  const blob = new Blob([JSON.stringify(dati, null, 2) + '\n'], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: nome });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function staffBackup() {
  if (!guardia({ admin: true })) return;
  const cont = h('div');
  mount(vistaEl(),
    indietro('#/staff', 'Area staff'),
    intestazione('Backup', 'Ogni lunedì il database salva da solo una copia di tutti i dati (le ultime 12). Puoi anche scaricarne una adesso.',
      h('button', {
        class: 'btn btn-primary btn-sm',
        onclick: async () => {
          const dati = await esegui(() => api.backupOra());
          if (dati) { scaricaJson(dati, `backup-5c-${oggiRoma()}.json`); toast('Backup creato e scaricato', 'ok'); vista.aggiorna('azione'); }
        },
      }, icon('download', 16), 'Scarica backup ora')),
    cont,
    h('p', { class: 'muted piccolo', style: 'margin-top:1.5rem' },
      'Il file contiene nomi, materie, sessioni, assegnazioni e registro: conservalo in un posto privato (non nel repository). ',
      'Il codice di classe non è incluso.'));
  const vista = creaVista(cont, {
    carica: () => api.elencoBackup(),
    disegna: (lista) => lista.length
      ? h('ul', { class: 'persone' }, lista.map((b) => h('li', { class: 'persona' },
          h('span', { class: 'nome' }, dataOraBreve(b.creato_il)),
          h('span', { class: 'tag' }, b.tipo === 'manuale' ? 'Manuale' : 'Automatico'),
          h('span', { class: 'muted piccolo' }, `${b.n_studenti} studenti · ${b.n_sessioni} sessioni`),
          h('button', {
            class: 'btn btn-sm azioni-persona',
            onclick: async () => { const d = await esegui(() => api.backup(b.id)); if (d) scaricaJson(d, `backup-5c-${b.creato_il.slice(0, 10)}.json`); },
          }, icon('download', 16), 'Scarica'))))
      : vuoto('Nessun backup ancora', 'Il primo backup automatico arriverà lunedì; intanto puoi scaricarne uno adesso.', 'download'),
  });
  return vista;
}

function dataOraBreve(ts) {
  return new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Rome' }).format(new Date(ts));
}
