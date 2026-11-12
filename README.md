# Estrazioni Interrogazioni · 5C Informatica

Web app statica (PWA) per gestire le interrogazioni della classe:

- **Compagni**: entrano con il codice di classe e vedono, per ogni materia, le date e chi è stato estratto. La pagina si aggiorna da sola in tempo reale.
- **Admin e rappresentanti**: fanno le estrazioni (con animazione, risultato deciso dal server) e gestiscono assenze, rinvii, spostamenti e volontari.
- **Admin**: gestisce materie, elenco nomi, codice di classe e approvazione dei rappresentanti.

Frontend in HTML, CSS e JavaScript vanilla (ES modules), senza build step, ospitato su GitHub Pages. Backend su Supabase: Postgres con RLS, RPC, Auth e Realtime.

---

## Struttura del progetto

```
index.html                 shell dell'app (meta noindex, manifest, tema)
css/style.css              stile, tema chiaro/scuro, layout mobile-first
js/config.js               ← DA COMPILARE: URL Supabase e anon key pubblica
js/app.js                  avvio, rotte, autenticazione
js/api.js                  client Supabase e chiamate RPC
js/realtime.js             ping realtime + polling/visibilità/online
js/router.js               routing con hash (#/materia/storia)
js/ui.js                   helper DOM sicuri (niente innerHTML con dati), icone, date
js/prefs.js                preferenze in localStorage (tema, codice, nome)
js/draw.js                 animazione dell'estrazione
js/export.js               esportazione PNG (canvas) e PDF (jsPDF)
js/pwa.js                  service worker, "nuova versione", installa app
js/views/common.js         caricamento, errori, evidenziazione delle modifiche
js/views/public.js         home, materia, registro, "il mio nome", accesso
js/views/staff.js          area staff (estrazioni, imprevisti, elenco, utenti, codice)
sw.js                      service worker (cache shell + dati offline)
manifest.json, icons/      PWA (icone 192/512, maskable, Apple)
robots.txt, .nojekyll      non indicizzabile; Pages senza Jekyll
supabase/migrations/*.sql  schema (applicato dall'integrazione GitHub di Supabase)
supabase/schema.sql        tutte le migrazioni in un unico file, da incollare a mano nello SQL Editor
dati-esempio.json          25 nomi FITTIZI per provare l'app
scripts/genera-icone.py    rigenera le icone (solo libreria standard Python)
.github/workflows/keepalive.yml   ping settimanale (facoltativo)
```

Nel repository non c'è alcun dato della classe: nomi, date e codice stanno solo nel database.

---

## 1. Creare il progetto Supabase

1. Su [supabase.com](https://supabase.com) → **New project**.
   - **Region**: Europe.
   - **Database password**: generane una robusta e salvala in un password manager (all'app non serve).
   - **Security**:
     - *Enable Data API*: **attivo** (l'app usa le API REST e le RPC).
     - *Automatically expose new tables*: **consigliato disattivarlo**. Lo schema toglie comunque ogni permesso diretto ad `anon`, ma così si parte più chiusi.
     - *Enable automatic RLS*: indifferente, perché lo schema attiva RLS esplicitamente su tutte le tabelle.
2. Attendi che il progetto sia pronto.

## 2. Creare tabelle, funzioni e trigger

Scegli **una sola** delle due strade. Non eseguire lo schema due volte: fallirebbe con "already exists".

### Strada A: integrazione GitHub (quella che hai già collegato)

L'integrazione applica automaticamente i file in `supabase/migrations/` a ogni push sul branch di produzione.

1. Supabase → **Project Settings → Integrations → GitHub**:
   - **Working directory**: `.` (la cartella `supabase/` è nella radice del repo).
   - **Production branch**: `main`.
   - Attiva **Deploy to production**.
2. Porta il codice su `main` (merge della pull request o push).
3. Controlla l'esito del deploy nella dashboard (sezione Branches / log dell'integrazione). In **Table Editor** devono comparire le tabelle `students`, `subjects`, `sessions`, `assignments`, `exclusions`, `changelog`, `staff` e `settings`.

> Modifiche future allo schema: crea un **nuovo** file in `supabase/migrations/`, con timestamp più recente nel nome. Non modificare una migrazione già applicata.

### Strada B: a mano

Supabase → **SQL Editor** → **New query** → incolla tutto `supabase/schema.sql` → **Run**.
(Se usi questa strada, scollega l'integrazione GitHub o rimuovi la cartella `supabase/migrations/`, altrimenti al primo push lo schema verrebbe rieseguito e fallirebbe.)

## 3. Realtime

L'app usa il pattern **"ping senza dati"**. Un trigger a livello di istruzione invia sul canale pubblico `classe-5c` un evento `changed` con il solo timestamp. Il client, alla ricezione, rilegge i dati tramite le RPC protette dal codice di classe.

- Supabase → **Realtime → Settings**: l'opzione **"Allow public access"** deve essere **attiva** (è il default), altrimenti i canali pubblici vengono rifiutati.
- Non serve abilitare la replica (`postgres_changes`) su nessuna tabella.

## 4. Autenticazione, registrazioni e conferma email

1. **Authentication → Sign In / Providers → Email**: lascia attivo il provider Email e **Confirm email** (consigliato).
2. **Authentication → URL Configuration**:
   - **Site URL**: l'indirizzo GitHub Pages, ad esempio `https://tuonome.github.io/nome-repo/`
   - **Redirect URLs**: aggiungi lo stesso indirizzo (anche con `**` finale, se preferisci).
   Il link di conferma riporta l'utente all'app, che lo porta su `#/staff`.
3. Il server email incluso nel piano gratuito invia **pochissime email all'ora**: per admin e 2–3 rappresentanti basta. Se servisse di più, configura un SMTP tuo in **Authentication → Emails → SMTP Settings**.
4. Chiunque abbia il link può registrarsi, ma **un nuovo account non ha alcun permesso** finché l'admin non lo approva in *Staff → Staff e rappresentanti*. Se a un certo punto non vuoi più registrazioni, puoi disattivare **Allow new users to sign up** nelle impostazioni di Auth.

## 5. Il primo admin (automatico)

**Il primo account che si registra diventa automaticamente admin approvato.** Tutti i successivi entrano come rappresentanti in attesa di approvazione. Quindi, appena il sito è online e **prima di condividere il link**:

1. Apri l'app → **Staff → Registrati** con la tua email e una password (almeno 8 caratteri).
2. Conferma l'email dal link ricevuto. Se il link ti porta su una pagina d'errore (Site URL non ancora impostato), l'email risulta comunque confermata: torna sull'app e accedi.
3. Fatto: vedi la sezione *Amministrazione*.

Se qualcun altro si fosse registrato per primo, correggi da **SQL Editor**:

```sql
update public.staff
   set ruolo = 'admin', approvato = true
 where email = 'la-tua-email@esempio.it';
```

(e revoca l'altro account da *Staff e rappresentanti*).

## 6. Impostare il codice di classe

Il modo consigliato: nell'app, **Staff → Codice di classe**. Il codice viene salvato solo come hash bcrypt e non compare mai nel repository né nel client.

In alternativa, da SQL Editor (la query resta nella cronologia dell'editor):

```sql
update public.settings
   set codice_hash = extensions.crypt('IL-CODICE-DELLA-CLASSE', extensions.gen_salt('bf', 8)),
       aggiornato_il = now()
 where id = 1;
```

Usa almeno 8 caratteri, con lettere e numeri. Comunica il codice nel gruppo della classe. Per cambiarlo basta reimpostarlo: chi aveva il vecchio dovrà inserire quello nuovo.

## 7. Inserire URL e anon key nel client

Supabase → **Project Settings → API Keys** (o **Data API**):

- **Project URL**: `https://xxxxxxxx.supabase.co`
- la chiave **pubblica**: *anon public* (legacy, `eyJ…`) oppure *publishable key* (`sb_publishable_…`). Vanno bene entrambe.

Apri `js/config.js` e sostituisci i due segnaposto:

```js
SUPABASE_URL: 'https://xxxxxxxx.supabase.co',
SUPABASE_ANON_KEY: 'la-tua-chiave-pubblica',
```

**Non inserire mai** la `service_role` key o la *secret key*: darebbero accesso completo al database. La chiave pubblica invece è fatta per stare nel browser: senza codice di classe o account approvato non permette di leggere né scrivere nulla.

## 8. Pubblicare su GitHub Pages

1. Fai commit e push di `js/config.js` compilato sul branch `main`.
2. GitHub → repository → **Settings → Pages** → *Build and deployment*: **Deploy from a branch**, branch `main`, cartella `/ (root)`.
3. Dopo un minuto il sito è su `https://tuonome.github.io/nome-repo/`.
   Tutti i percorsi sono relativi, quindi funziona anche in sottocartella, e i link diretti tipo `…/#/materia/storia` funzionano.
4. Se hai cambiato l'indirizzo, aggiorna anche *Site URL* e *Redirect URLs* in Supabase (punto 4).

**A ogni rilascio** che modifica i file dell'app, aumenta `VERSIONE` in `sw.js` (es. `v1.0.1`). Così chi ha l'app installata vede "Nuova versione disponibile, aggiorna".

## 9. Installare l'app sul telefono

- **Android (Chrome)**: apri il sito → icona "Installa app" in alto (oppure menu ⋮ → *Installa app* / *Aggiungi a schermata Home*).
- **iPhone (Safari)**: apri il sito → **Condividi** → **Aggiungi a Home**. L'app mostra questo suggerimento la prima volta.

Dopo la prima apertura con la rete, la consultazione funziona anche offline, con l'indicazione "dati aggiornati al …".

## 10. GitHub Action keepalive (facoltativa)

Il piano gratuito mette in pausa i progetti inattivi. `.github/workflows/keepalive.yml` chiama ogni lunedì la RPC `keepalive()`, che non legge e non restituisce dati.
Per attivarla: GitHub → **Settings → Secrets and variables → Actions** → aggiungi `SUPABASE_URL` e `SUPABASE_ANON_KEY`. Puoi lanciarla a mano da **Actions → Keepalive Supabase → Run workflow**.

---

## Come si usa

1. **Admin**: *Staff → Elenco studenti → Carica JSON*. Formato `[{"nome":"Mario","cognome":"Rossi"}, …]`; per provare c'è `dati-esempio.json`. Prima di applicare vedi l'anteprima (aggiunti, modificati o riattivati, disattivati).
2. **Admin**: *Nuova materia* → *Sessioni ed estrazioni* → *Nuove sessioni*: più date insieme, ognuna con argomento e numero di interrogati.
3. Facoltativo: *Volontari / aggiungi* per inserire **più persone insieme**, come volontari o messe a mano per quel giorno. Se i posti non bastano, l'app propone di aumentarli.
4. In classe, sul proiettore o sul telefono: **Estrai N**. Il server sceglie e salva; la **roulette** gira tra i nomi del sorteggio (in ordine alfabetico, si vedono i nomi prima e dopo) e si ferma sull'estratto, una persona alla volta (≈3 s), con *Salta animazione* e *Salta tutto*.
   *Copia in altra materia*: copia gli interrogati di una sessione (es. Italiano del 16/11) in una sessione di un'altra materia, esistente o nuova con la stessa data (la nuova la può creare solo l'admin). Chi è già in elenco in quella materia viene saltato.
5. Imprevisti: **Gestisci** su una persona → *Interrogato*, *Assente*, *Rimandato* (con motivo), *Sposta ad altra data* o *Rimuovi*. Assenti e rimandati finiscono in **Da riassegnare**, dove si sceglie la nuova data.
6. *Annulla ultima estrazione* (motivo obbligatorio) riporta nel sorteggio le persone di quell'estrazione.
7. I compagni vedono tutto subito, con i badge di stato (icona + testo) e il **registro modifiche** (chi, cosa, quando, perché).

**Pool di estrazione** (per materia): studenti attivi, non già presenti in nessuna sessione della materia (in qualunque stato) e non esclusi a mano.

---

## Sicurezza: com'è fatta

- **RLS attiva su tutte le tabelle**. Il ruolo `anon` non ha alcun privilegio sulle tabelle; gli utenti autenticati hanno solo `SELECT`, filtrato dalle policy (staff approvato).
- **I compagni leggono solo tramite RPC `SECURITY DEFINER`**: `get_class_data`, `get_subject`, `get_changelog`, `cerca_studente`. Ognuna verifica il codice contro l'hash bcrypt (`pgcrypto`), con `search_path` vuoto e nomi completamente qualificati.
- **Limite tentativi**: massimo 20 codici errati ogni 15 minuti per IP, più un piccolo ritardo a ogni errore. Il limite è largo perché a scuola tutta la classe può avere lo stesso IP.
- **Scritture solo tramite RPC**, che controllano ruolo e approvazione (`require_staff`). Nessuna policy di scrittura sulle tabelle.
- **Estrazione lato server** con `gen_random_uuid()` (random crittografico). Il risultato è salvato subito: non si può "rifare finché esce bene", e l'annullamento resta nel registro, visibile a tutti.
- **Changelog** scritto dentro le RPC a ogni modifica: estrazione, stato, spostamento, aggiunta, rimozione, annullamento, sessioni, elenco nomi. Nome e cognome sono salvati come testo.
- **Realtime senza dati**: il messaggio contiene solo `{ts}`. Il canale pubblico è leggibile e scrivibile da chiunque abbia l'anon key, quindi il client **non usa mai il contenuto** del messaggio: serve solo come segnale per rileggere i dati.
- **XSS**: tutti i dati del database finiscono nel DOM con `textContent` (helper `h()` in `js/ui.js`). `innerHTML` è usato solo per le icone SVG costanti.
- **Service worker**: mette in cache solo le 4 RPC di lettura fatte senza utente loggato, con chiave = hash SHA-256 della richiesta (il codice non compare in chiaro). Scritture, login e chiamate dello staff non vengono mai salvate.
- **Non indicizzabile**: `meta robots noindex` e `robots.txt`. Nota: i crawler leggono `robots.txt` solo nella radice del dominio, quindi su `tuonome.github.io/nome-repo/` vale soprattutto il meta tag.
- **Limite intrinseco**: il codice di classe è condiviso. Chi lo conosce può passarlo ad altri; in quel caso basta cambiarlo.

### Differenze rispetto alle specifiche, verificate sulla documentazione Supabase

- `realtime.send(payload jsonb, event text, topic text, private boolean default true)`: **il default è privato**. Lo schema passa `private => false`, e il client si iscrive con `config: { private: false }`. Le due impostazioni devono coincidere, altrimenti il messaggio non arriva.
- `realtime.send` scrive in `realtime.messages`, partizionata per giorno. Le partizioni le crea il servizio Realtime quando un client si connette: se nessuno è connesso, il ping può andare perso con un semplice WARNING, senza far fallire la modifica. È irrilevante, perché nessuno sta guardando e polling/refetch coprono il resto.
- Il trigger invia **al massimo un ping per transazione** (oltre a essere `FOR EACH STATEMENT`): un'estrazione che inserisce assegnazioni e righe di registro manda un solo messaggio.
- Service worker: per l'app shell uso *stale-while-revalidate*; per i **dati** uso *network-first* con fallback alla cache. Con stale-while-revalidate sui dati, dopo un ping realtime si vedrebbero per un attimo quelli vecchi.

---

## Checklist di test

Prepara: schema applicato, admin impostato, codice impostato, `dati-esempio.json` caricato, una materia con 3 sessioni (es. 3, 4 e 5 interrogati).

- [ ] **Accesso senza codice (deve fallire)**: in una finestra anonima apri `…/#/materia/<slug>` → vieni portato alla schermata del codice; un codice sbagliato mostra "Codice di classe non valido". Dalla console del browser, `fetch` diretto a `/rest/v1/students` con la anon key → errore di permesso.
- [ ] **Estrazione con volontari**: nella sessione da 3 aggiungi un volontario → *Estrai 2* → l'animazione mostra 2 nomi; la sessione ha 3 persone, e il volontario ha il badge "Volontario". Una seconda estrazione non è possibile ("Sessione al completo").
- [ ] **Assente che viene riassegnato**: *Gestisci* → *Assente* con motivo → compare in *Da riassegnare* e non viene più estratto → *Nuova data* → scegli un'altra sessione → torna "Assegnato" nella nuova data; nel registro compaiono "Segnato come assente" e "Riassegnato dal … al …" con il motivo.
- [ ] **Annullamento estrazione**: *Annulla ultima estrazione* senza motivo → bloccato; con motivo → gli estratti tornano nel sorteggio, e il registro mostra "Estrazione del … annullata" con il motivo.
- [ ] **Rappresentante**: registra un secondo account → finché non è approvato non può fare nulla ("In attesa di approvazione"); dopo l'approvazione può estrarre, ma non vede *Amministrazione* e le RPC admin rispondono "Operazione riservata all'amministratore".
- [ ] **Import elenco**: carica un JSON con un nome in più e uno in meno → l'anteprima mostra 1 aggiunto e 1 disattivato → applica → il registro mostra le modifiche; *Scarica JSON* restituisce l'elenco attivo.
- [ ] **Realtime**: apri due schede, una con il codice di classe sulla pagina materia e una da admin. Estrai o sposta qualcuno → l'altra scheda si aggiorna **entro un secondo** senza ricaricare, con una breve evidenziazione. L'indicatore in alto dice "Aggiornato in tempo reale".
- [ ] **Riallineamento dopo la rete**: nella scheda del compagno spegni la rete (DevTools → Network → Offline): l'indicatore passa a "Offline". Dalla scheda admin modifica qualcosa → riaccendi la rete → la scheda del compagno si riallinea da sola e torna "Aggiornato in tempo reale".
- [ ] **Accesso offline**: apri l'app con la rete, visita una materia, poi metti offline e ricarica → l'app si apre con gli ultimi dati e il banner "Sei offline: dati aggiornati al …" (compare quando i dati hanno più di 90 secondi).
- [ ] **Nuova versione**: cambia `VERSIONE` in `sw.js`, pubblica, riapri l'app → "Nuova versione disponibile" → *Aggiorna*.
- [ ] **Export**: pagina materia → *Esporta* → PNG e PDF con titolo, data di aggiornamento e sessioni con gli interrogati.
- [ ] **Tema e accessibilità**: il pulsante del tema passa da automatico a chiaro a scuro, e la scelta resta dopo il ricaricamento; Tab → "Vai al contenuto"; la navigazione e i dialoghi funzionano da tastiera; con "riduci movimento" attivo l'animazione è ridotta.

---

## Sviluppo locale

```bash
python3 -m http.server 8000
```

Poi apri `http://localhost:8000/`. Il service worker funziona anche su `localhost`. Per vedere subito le modifiche ai file, in DevTools → Application → Service Workers spunta *Update on reload*.

Per rigenerare le icone:

```bash
python3 scripts/genera-icone.py
```

## Idee per il futuro (non implementate)

- "Password dimenticata" per lo staff (`resetPasswordForEmail` di Supabase Auth).
- Notifiche push ("domani sei interrogato"): richiederebbero un servizio push e una Edge Function.
- Statistiche per materia (quante volte ciascuno è stato interrogato) e pianificazione automatica del calendario.
- File `.ics` da importare nel calendario del telefono per le proprie date.
