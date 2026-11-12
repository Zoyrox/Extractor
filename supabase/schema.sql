-- =====================================================================
--  Estrazioni Interrogazioni · Classe 5C Informatica
--  Schema completo: tabelle, RLS, funzioni RPC, changelog, ping realtime.
--
--  Questo file è sia la migrazione applicata dall'integrazione GitHub di
--  Supabase (supabase/migrations/) sia lo schema da incollare a mano nello
--  SQL Editor (supabase/schema.sql è una copia identica).
--  NON eseguirlo due volte sullo stesso progetto.
--
--  Principi di sicurezza:
--   * RLS attiva ovunque; anon NON ha alcun privilegio sulle tabelle.
--   * I compagni leggono solo tramite RPC SECURITY DEFINER che verificano
--     il codice di classe (hash bcrypt in settings).
--   * Tutte le scritture passano da RPC che controllano ruolo e
--     approvazione in staff e scrivono il changelog.
--   * Il ping realtime non contiene dati: solo un timestamp.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- Schema per le funzioni interne: non è esposto dall'API REST.
create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------
--  TABELLE
-- ---------------------------------------------------------------------

create table public.students (
  id         bigint generated always as identity primary key,
  nome       text not null check (char_length(btrim(nome)) between 1 and 60),
  cognome    text not null check (char_length(btrim(cognome)) between 1 and 60),
  attivo     boolean not null default true,
  creato_il  timestamptz not null default now()
);
-- Nome e cognome identificano lo studente (il JSON di import non ha id).
create unique index students_nome_cognome_uq
  on public.students (lower(btrim(nome)), lower(btrim(cognome)));

create table public.subjects (
  id         bigint generated always as identity primary key,
  nome       text not null check (char_length(btrim(nome)) between 1 and 60),
  slug       text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  ordine     integer not null default 0,
  creato_il  timestamptz not null default now()
);

create table public.sessions (
  id               bigint generated always as identity primary key,
  subject_id       bigint not null references public.subjects(id) on delete cascade,
  data             date not null,
  argomento        text not null default '' check (char_length(argomento) <= 200),
  max_interrogati  integer not null check (max_interrogati between 1 and 40),
  creato_il        timestamptz not null default now()
);
create index sessions_subject_data_idx on public.sessions (subject_id, data);

create table public.assignments (
  id             bigint generated always as identity primary key,
  session_id     bigint not null references public.sessions(id) on delete cascade,
  -- Copia della materia della sessione (mantenuta da trigger): serve al
  -- vincolo "uno studente al massimo una volta per materia".
  subject_id     bigint not null references public.subjects(id) on delete cascade,
  student_id     bigint not null references public.students(id) on delete restrict,
  stato          text not null default 'assegnato'
                 check (stato in ('assegnato','interrogato','assente','rimandato')),
  volontario     boolean not null default false,
  nota           text check (char_length(nota) <= 300),
  -- Raggruppa le persone uscite nella stessa estrazione (per l'annullamento).
  estrazione_id  uuid,
  ordine         integer not null default 0,
  creato_il      timestamptz not null default now(),
  aggiornato_il  timestamptz not null default now(),
  unique (subject_id, student_id)
);
create index assignments_session_idx on public.assignments (session_id);

-- Studenti esclusi a mano dal sorteggio di una materia.
create table public.exclusions (
  subject_id  bigint not null references public.subjects(id) on delete cascade,
  student_id  bigint not null references public.students(id) on delete cascade,
  motivo      text check (char_length(motivo) <= 200),
  creato_il   timestamptz not null default now(),
  primary key (subject_id, student_id)
);

create table public.changelog (
  id                bigint generated always as identity primary key,
  creato_il         timestamptz not null default now(),
  -- Testo, così resta leggibile anche se lo studente viene disattivato.
  studente_nome     text,
  studente_cognome  text,
  subject_id        bigint references public.subjects(id) on delete set null,
  materia_nome      text,
  sessione_data     date,
  tipo              text not null,   -- codice per icone e filtri
  azione            text not null,   -- descrizione leggibile in italiano
  motivo            text,
  autore            uuid             -- mai esposto al pubblico
);
create index changelog_creato_idx on public.changelog (creato_il desc);
create index changelog_subject_idx on public.changelog (subject_id, creato_il desc);

create table public.staff (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  ruolo      text not null default 'rappresentante' check (ruolo in ('admin','rappresentante')),
  approvato  boolean not null default false,
  creato_il  timestamptz not null default now()
);

create table public.settings (
  id             integer primary key default 1 check (id = 1),
  codice_hash    text,
  aggiornato_il  timestamptz not null default now()
);
insert into public.settings (id) values (1);

-- Tentativi errati del codice di classe (limitazione dei tentativi).
create table private.access_attempts (
  id         bigint generated always as identity primary key,
  ip         text not null,
  creato_il  timestamptz not null default now()
);
create index access_attempts_idx on private.access_attempts (ip, creato_il);

-- ---------------------------------------------------------------------
--  PERMESSI DI BASE: nessun accesso diretto per anon, sola lettura (con
--  RLS) per gli utenti autenticati. Le scritture passano solo dalle RPC.
-- ---------------------------------------------------------------------

alter table public.students    enable row level security;
alter table public.subjects    enable row level security;
alter table public.sessions    enable row level security;
alter table public.assignments enable row level security;
alter table public.exclusions  enable row level security;
alter table public.changelog   enable row level security;
alter table public.staff       enable row level security;
alter table public.settings    enable row level security;
alter table private.access_attempts enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on public.students, public.subjects, public.sessions,
  public.assignments, public.exclusions, public.changelog, public.staff
  to authenticated;

-- ---------------------------------------------------------------------
--  FUNZIONI INTERNE (schema private)
-- ---------------------------------------------------------------------

-- Ruolo dell'utente corrente se è staff approvato, altrimenti null.
create or replace function private.staff_role()
returns text
language sql stable security definer
set search_path = ''
as $$
  select s.ruolo from public.staff s
  where s.user_id = auth.uid() and s.approvato
$$;

create or replace function private.is_staff()
returns boolean
language sql stable security definer
set search_path = ''
as $$ select private.staff_role() is not null $$;

create or replace function private.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$ select coalesce(private.staff_role() = 'admin', false) $$;

-- Usate dalle policy RLS: servono a 'authenticated'.
grant usage on schema private to authenticated;
grant execute on function private.staff_role(), private.is_staff(), private.is_admin() to authenticated;

-- Blocca la chiamata se l'utente non ha il ruolo richiesto.
create or replace function private.require_staff(p_admin boolean default false)
returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if p_admin and not private.is_admin() then
    raise exception 'Operazione riservata all''amministratore' using errcode = '42501';
  elsif not private.is_staff() then
    raise exception 'Non hai i permessi per questa operazione' using errcode = '42501';
  end if;
end $$;

-- IP del client (header impostati dal proxy di Supabase). Serve solo a
-- limitare i tentativi: non è una garanzia assoluta.
create or replace function private.client_ip()
returns text
language plpgsql stable
set search_path = ''
as $$
declare h json;
begin
  h := nullif(current_setting('request.headers', true), '')::json;
  return coalesce(
    h->>'cf-connecting-ip',
    btrim(split_part(h->>'x-forwarded-for', ',', 1)),
    'sconosciuto');
exception when others then
  return 'sconosciuto';
end $$;

-- Verifica il codice di classe. Ritorna:
--   'ok' | 'errato' | 'bloccato' | 'non_impostato'
-- Gli utenti staff approvati passano sempre (non serve il codice).
-- NB: la funzione scrive i tentativi falliti, per cui chi la chiama non
-- deve sollevare eccezioni dopo un esito negativo (annullerebbe la scrittura).
create or replace function private.check_code(p_code text)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_ip   text := private.client_ip();
  v_fail integer;
begin
  if private.is_staff() then
    return 'ok';
  end if;

  select codice_hash into v_hash from public.settings where id = 1;
  if v_hash is null then
    return 'non_impostato';
  end if;

  -- Max 20 tentativi errati ogni 15 minuti per IP (la scuola può avere un
  -- solo IP per tutti, quindi il limite non è troppo basso).
  select count(*) into v_fail from private.access_attempts
  where ip = v_ip and creato_il > now() - interval '15 minutes';
  if v_fail >= 20 then
    return 'bloccato';
  end if;

  if p_code is not null and char_length(p_code) <= 100
     and extensions.crypt(p_code, v_hash) = v_hash then
    return 'ok';
  end if;

  insert into private.access_attempts (ip) values (v_ip);
  delete from private.access_attempts where creato_il < now() - interval '1 day';
  perform pg_sleep(0.4);  -- rallenta i tentativi a forza bruta
  return 'errato';
end $$;

-- Risposta d'errore standard per le RPC pubbliche.
create or replace function private.code_error(p_esito text)
returns jsonb
language sql immutable
set search_path = ''
as $$ select jsonb_build_object('errore', p_esito) $$;

-- Scrive una riga nel registro modifiche.
create or replace function private.log(
  p_tipo text, p_azione text,
  p_student_id bigint default null, p_subject_id bigint default null,
  p_data date default null, p_motivo text default null)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_nome text; v_cognome text; v_materia text;
begin
  if p_student_id is not null then
    select nome, cognome into v_nome, v_cognome from public.students where id = p_student_id;
  end if;
  if p_subject_id is not null then
    select nome into v_materia from public.subjects where id = p_subject_id;
  end if;
  insert into public.changelog
    (studente_nome, studente_cognome, subject_id, materia_nome, sessione_data, tipo, azione, motivo, autore)
  values
    (v_nome, v_cognome, p_subject_id, v_materia, p_data, p_tipo, p_azione,
     nullif(btrim(coalesce(p_motivo, '')), ''), auth.uid());
end $$;

-- Data in formato italiano per i testi del changelog.
create or replace function private.it_date(p_data date)
returns text
language sql immutable
set search_path = ''
as $$ select to_char(p_data, 'DD/MM/YYYY') $$;

-- Oggi secondo il fuso Europe/Rome.
create or replace function private.oggi()
returns date
language sql stable
set search_path = ''
as $$ select (now() at time zone 'Europe/Rome')::date $$;

-- ---------------------------------------------------------------------
--  TRIGGER
-- ---------------------------------------------------------------------

-- Mantiene assignments.subject_id allineato alla sessione.
create or replace function private.assignment_subject()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select subject_id into new.subject_id from public.sessions where id = new.session_id;
  new.aggiornato_il := now();
  return new;
end $$;

create trigger assignments_subject
  before insert or update of session_id, stato, nota, volontario on public.assignments
  for each row execute function private.assignment_subject();

-- Ping realtime SENZA DATI: a livello di istruzione e al massimo uno per
-- transazione (una RPC che tocca più tabelle invia un solo messaggio).
-- realtime.send(payload, event, topic, private): private=false → canale
-- pubblico, ricevibile con la sola anon key. Il payload è solo un timestamp.
create or replace function private.ping_realtime()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.ping_inviato', true), '') <> '1' then
    perform set_config('app.ping_inviato', '1', true);
    perform realtime.send(
      jsonb_build_object('ts', floor(extract(epoch from clock_timestamp()) * 1000)),
      'changed',
      'classe-5c',
      false
    );
  end if;
  return null;
end $$;

create trigger ping_students    after insert or update or delete on public.students    for each statement execute function private.ping_realtime();
create trigger ping_subjects    after insert or update or delete on public.subjects    for each statement execute function private.ping_realtime();
create trigger ping_sessions    after insert or update or delete on public.sessions    for each statement execute function private.ping_realtime();
create trigger ping_assignments after insert or update or delete on public.assignments for each statement execute function private.ping_realtime();
create trigger ping_exclusions  after insert or update or delete on public.exclusions  for each statement execute function private.ping_realtime();
create trigger ping_changelog   after insert or update or delete on public.changelog   for each statement execute function private.ping_realtime();

-- Ogni nuovo utente registrato entra in staff come rappresentante NON
-- approvato: non ha alcun permesso finché l'admin non lo approva.
create or replace function private.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.staff (user_id, email) values (new.id, coalesce(new.email, ''))
  on conflict (user_id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------
--  POLICY RLS (solo lettura per lo staff approvato; nessuna policy di
--  scrittura: si scrive solo tramite RPC SECURITY DEFINER)
-- ---------------------------------------------------------------------

create policy staff_legge_students    on public.students    for select to authenticated using (private.is_staff());
create policy staff_legge_subjects    on public.subjects    for select to authenticated using (private.is_staff());
create policy staff_legge_sessions    on public.sessions    for select to authenticated using (private.is_staff());
create policy staff_legge_assignments on public.assignments for select to authenticated using (private.is_staff());
create policy staff_legge_exclusions  on public.exclusions  for select to authenticated using (private.is_staff());
create policy staff_legge_changelog   on public.changelog   for select to authenticated using (private.is_staff());
-- Ognuno vede la propria riga; l'admin le vede tutte.
create policy staff_legge_staff on public.staff for select to authenticated
  using (user_id = auth.uid() or private.is_admin());
-- settings: nessuna policy → nessuno legge l'hash via API.

-- ---------------------------------------------------------------------
--  RPC PUBBLICHE (lettura con codice di classe)
-- ---------------------------------------------------------------------

-- Verifica del codice (schermata di accesso).
create or replace function public.verify_class_code(p_code text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare v text := private.check_code(p_code);
begin
  if v = 'ok' then return jsonb_build_object('ok', true); end if;
  return private.code_error(v);
end $$;

-- Home: materie con la prossima sessione.
create or replace function public.get_class_data(p_code text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare v text := private.check_code(p_code);
begin
  if v <> 'ok' then return private.code_error(v); end if;
  return jsonb_build_object(
    'generato_il', now(),
    'materie', coalesce((
      select jsonb_agg(m order by m.ordine, m.nome) from (
        select s.id, s.nome, s.slug, s.ordine,
          (select count(*) from public.sessions x where x.subject_id = s.id) as n_sessioni,
          (select jsonb_build_object('data', x.data, 'argomento', x.argomento,
                    'max_interrogati', x.max_interrogati,
                    'n_assegnati', (select count(*) from public.assignments a where a.session_id = x.id))
             from public.sessions x
            where x.subject_id = s.id and x.data >= private.oggi()
            order by x.data, x.id limit 1) as prossima
        from public.subjects s
      ) m), '[]'::jsonb)
  );
end $$;

-- Pagina materia: sessioni con interrogati e lista "da riassegnare".
create or replace function public.get_subject(p_code text, p_slug text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v text := private.check_code(p_code);
  v_sub public.subjects;
begin
  if v <> 'ok' then return private.code_error(v); end if;
  select * into v_sub from public.subjects where slug = p_slug;
  if not found then return jsonb_build_object('errore', 'materia_non_trovata'); end if;

  return jsonb_build_object(
    'generato_il', now(),
    'oggi', private.oggi(),
    'materia', jsonb_build_object('id', v_sub.id, 'nome', v_sub.nome, 'slug', v_sub.slug),
    'sessioni', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'data', x.data, 'argomento', x.argomento,
        'max_interrogati', x.max_interrogati,
        'interrogati', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', a.id, 'nome', st.nome, 'cognome', st.cognome,
            'stato', a.stato, 'volontario', a.volontario, 'nota', a.nota,
            'aggiornato_il', a.aggiornato_il)
            order by a.ordine, st.cognome, st.nome)
          from public.assignments a join public.students st on st.id = a.student_id
          where a.session_id = x.id and a.stato in ('assegnato', 'interrogato')), '[]'::jsonb),
        -- Assenti e rimandati restano visibili nella sessione originale.
        'non_presenti', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', a.id, 'nome', st.nome, 'cognome', st.cognome,
            'stato', a.stato, 'volontario', a.volontario, 'nota', a.nota, 'aggiornato_il', a.aggiornato_il)
            order by st.cognome, st.nome)
          from public.assignments a join public.students st on st.id = a.student_id
          where a.session_id = x.id and a.stato in ('assente', 'rimandato')), '[]'::jsonb)
      ) order by x.data, x.id)
      from public.sessions x where x.subject_id = v_sub.id), '[]'::jsonb),
    'ultime_modifiche', coalesce((
      select jsonb_agg(c) from (
        select c.creato_il, c.studente_nome, c.studente_cognome, c.tipo, c.azione, c.motivo
        from public.changelog c where c.subject_id = v_sub.id
        order by c.creato_il desc, c.id desc limit 5) c), '[]'::jsonb)
  );
end $$;

-- Registro modifiche filtrabile per materia (slug) e/o studente (testo).
create or replace function public.get_changelog(
  p_code text, p_slug text default null, p_studente text default null,
  p_limit integer default 100, p_offset integer default 0)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v text := private.check_code(p_code);
  v_q text := nullif(lower(btrim(coalesce(p_studente, ''))), '');
begin
  if v <> 'ok' then return private.code_error(v); end if;
  return jsonb_build_object(
    'generato_il', now(),
    'voci', coalesce((
      select jsonb_agg(r) from (
        select c.id, c.creato_il, c.studente_nome, c.studente_cognome,
               c.materia_nome, s.slug, c.sessione_data, c.tipo, c.azione, c.motivo
        from public.changelog c
        left join public.subjects s on s.id = c.subject_id
        where (p_slug is null or s.slug = p_slug)
          and (v_q is null or
               lower(coalesce(c.studente_nome, '') || ' ' || coalesce(c.studente_cognome, '')) like '%' || v_q || '%' or
               lower(coalesce(c.studente_cognome, '') || ' ' || coalesce(c.studente_nome, '')) like '%' || v_q || '%')
        order by c.creato_il desc, c.id desc
        limit least(greatest(coalesce(p_limit, 100), 1), 300)
        offset greatest(coalesce(p_offset, 0), 0)) r), '[]'::jsonb)
  );
end $$;

-- "Cerca il mio nome": tutte le date di uno studente, in tutte le materie.
create or replace function public.cerca_studente(p_code text, p_q text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v text := private.check_code(p_code);
  v_q text := lower(btrim(coalesce(p_q, '')));
begin
  if v <> 'ok' then return private.code_error(v); end if;
  if char_length(v_q) < 2 then
    return jsonb_build_object('generato_il', now(), 'risultati', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'generato_il', now(),
    'risultati', coalesce((
      select jsonb_agg(r order by r.cognome, r.nome) from (
        select st.nome, st.cognome,
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'materia', sb.nome, 'slug', sb.slug, 'data', x.data,
              'argomento', x.argomento, 'stato', a.stato, 'volontario', a.volontario)
              order by x.data)
            from public.assignments a
            join public.sessions x on x.id = a.session_id
            join public.subjects sb on sb.id = a.subject_id
            where a.student_id = st.id), '[]'::jsonb) as date
        from public.students st
        where st.attivo and (
          lower(st.nome || ' ' || st.cognome) like '%' || v_q || '%' or
          lower(st.cognome || ' ' || st.nome) like '%' || v_q || '%')
        limit 10) r), '[]'::jsonb)
  );
end $$;

-- Usata dalla GitHub Action settimanale per tenere attivo il progetto
-- (piano gratuito). Non legge né restituisce dati.
create or replace function public.keepalive()
returns boolean
language sql stable
set search_path = ''
as $$ select true $$;

-- ---------------------------------------------------------------------
--  RPC STAFF (admin e rappresentanti approvati)
-- ---------------------------------------------------------------------

-- Profilo dell'utente loggato (anche se non approvato).
create or replace function public.my_staff_profile()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('email', email, 'ruolo', ruolo, 'approvato', approvato)
       from public.staff where user_id = auth.uid()),
    jsonb_build_object('approvato', false))
$$;

-- Dati completi di una materia per la gestione (id, pool, esclusi...).
create or replace function public.staff_get_subject(p_slug text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare v_sub public.subjects;
begin
  perform private.require_staff();
  select * into v_sub from public.subjects where slug = p_slug;
  if not found then raise exception 'Materia non trovata'; end if;

  return jsonb_build_object(
    'generato_il', now(),
    'oggi', private.oggi(),
    'materia', to_jsonb(v_sub),
    'sessioni', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'data', x.data, 'argomento', x.argomento,
        'max_interrogati', x.max_interrogati,
        'ultima_estrazione', (
          select a.estrazione_id from public.assignments a
          where a.session_id = x.id and a.estrazione_id is not null
          order by a.creato_il desc limit 1),
        'assegnazioni', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', a.id, 'student_id', a.student_id, 'nome', st.nome, 'cognome', st.cognome,
            'stato', a.stato, 'volontario', a.volontario, 'nota', a.nota,
            'estrazione_id', a.estrazione_id)
            order by a.ordine, st.cognome, st.nome)
          from public.assignments a join public.students st on st.id = a.student_id
          where a.session_id = x.id), '[]'::jsonb)
      ) order by x.data, x.id)
      from public.sessions x where x.subject_id = v_sub.id), '[]'::jsonb),
    'pool', coalesce((
      select jsonb_agg(jsonb_build_object('id', st.id, 'nome', st.nome, 'cognome', st.cognome)
                       order by st.cognome, st.nome)
      from public.students st
      where st.attivo
        and not exists (select 1 from public.assignments a where a.subject_id = v_sub.id and a.student_id = st.id)
        and not exists (select 1 from public.exclusions e where e.subject_id = v_sub.id and e.student_id = st.id)
    ), '[]'::jsonb),
    'esclusi', coalesce((
      select jsonb_agg(jsonb_build_object('student_id', st.id, 'nome', st.nome, 'cognome', st.cognome, 'motivo', e.motivo)
                       order by st.cognome, st.nome)
      from public.exclusions e join public.students st on st.id = e.student_id
      where e.subject_id = v_sub.id), '[]'::jsonb),
    'studenti', coalesce((
      select jsonb_agg(jsonb_build_object('id', st.id, 'nome', st.nome, 'cognome', st.cognome,
        'assegnato', exists (select 1 from public.assignments a where a.subject_id = v_sub.id and a.student_id = st.id))
        order by st.cognome, st.nome)
      from public.students st where st.attivo), '[]'::jsonb)
  );
end $$;

-- ESTRAZIONE lato server. Riempie i posti liberi della sessione pescando
-- dal pool con random crittograficamente sicuro (gen_random_uuid usa
-- pg_strong_random). Il risultato è salvato subito: non si può "rifare".
create or replace function public.staff_draw(p_session_id bigint)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_ses     public.sessions;
  v_posti   integer;
  v_eid     uuid := gen_random_uuid();
  v_ord     integer;
  v_estratti jsonb;
begin
  perform private.require_staff();

  -- Blocca la sessione: due estrazioni contemporanee non si sovrappongono.
  select * into v_ses from public.sessions where id = p_session_id for update;
  if not found then raise exception 'Sessione non trovata'; end if;
  -- Blocca anche la materia: estrazioni parallele su sessioni diverse
  -- della stessa materia non pescano la stessa persona.
  perform 1 from public.subjects where id = v_ses.subject_id for update;

  v_posti := v_ses.max_interrogati
           - (select count(*) from public.assignments where session_id = v_ses.id);
  if v_posti <= 0 then
    raise exception 'Nessun posto libero in questa sessione';
  end if;

  select coalesce(max(ordine), 0) into v_ord from public.assignments where session_id = v_ses.id;

  with pool as (
    select st.id from public.students st
    where st.attivo
      and not exists (select 1 from public.assignments a where a.subject_id = v_ses.subject_id and a.student_id = st.id)
      and not exists (select 1 from public.exclusions e where e.subject_id = v_ses.subject_id and e.student_id = st.id)
    order by gen_random_uuid()
    limit v_posti
  ), numerati as (
    select id, row_number() over () as n from pool
  ), ins as (
    insert into public.assignments (session_id, subject_id, student_id, stato, estrazione_id, ordine)
    select v_ses.id, v_ses.subject_id, n.id, 'assegnato', v_eid, v_ord + n.n from numerati n
    returning student_id, ordine
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', st.id, 'nome', st.nome, 'cognome', st.cognome) order by ins.ordine), '[]'::jsonb)
    into v_estratti
  from ins join public.students st on st.id = ins.student_id;

  if jsonb_array_length(v_estratti) = 0 then
    raise exception 'Nessuno studente disponibile per l''estrazione in questa materia';
  end if;

  insert into public.changelog (studente_nome, studente_cognome, subject_id, materia_nome, sessione_data, tipo, azione, autore)
  select e->>'nome', e->>'cognome', v_ses.subject_id,
         (select nome from public.subjects where id = v_ses.subject_id),
         v_ses.data, 'estrazione', 'Estratto per il ' || private.it_date(v_ses.data), auth.uid()
  from jsonb_array_elements(v_estratti) e;

  return jsonb_build_object(
    'estrazione_id', v_eid,
    'estratti', v_estratti,
    'posti_richiesti', v_posti);
end $$;

-- Annulla l'ultima estrazione di una sessione (motivo obbligatorio).
create or replace function public.staff_undo_last_draw(p_session_id bigint, p_motivo text)
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_ses public.sessions;
  v_eid uuid;
  v_n   integer;
  r     record;
begin
  perform private.require_staff();
  if char_length(btrim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Indica il motivo dell''annullamento';
  end if;
  select * into v_ses from public.sessions where id = p_session_id for update;
  if not found then raise exception 'Sessione non trovata'; end if;

  select estrazione_id into v_eid from public.assignments
  where session_id = p_session_id and estrazione_id is not null
  order by creato_il desc limit 1;
  if v_eid is null then raise exception 'Nessuna estrazione da annullare in questa sessione'; end if;

  for r in select student_id from public.assignments where session_id = p_session_id and estrazione_id = v_eid loop
    perform private.log('annullamento', 'Estrazione del ' || private.it_date(v_ses.data) || ' annullata',
                        r.student_id, v_ses.subject_id, v_ses.data, p_motivo);
  end loop;

  delete from public.assignments where session_id = p_session_id and estrazione_id = v_eid;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Aggiunta manuale (anche volontari) a una sessione.
create or replace function public.staff_add_to_session(
  p_session_id bigint, p_student_id bigint, p_volontario boolean default false, p_motivo text default null)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_ses public.sessions;
  v_st  public.students;
  v_altra date;
begin
  perform private.require_staff();
  select * into v_ses from public.sessions where id = p_session_id for update;
  if not found then raise exception 'Sessione non trovata'; end if;
  select * into v_st from public.students where id = p_student_id;
  if not found or not v_st.attivo then raise exception 'Studente non valido o non attivo'; end if;

  select x.data into v_altra from public.assignments a join public.sessions x on x.id = a.session_id
  where a.subject_id = v_ses.subject_id and a.student_id = p_student_id;
  if found then
    raise exception '% % è già in elenco per il % in questa materia: usa "Sposta"',
      v_st.nome, v_st.cognome, private.it_date(v_altra);
  end if;

  if (select count(*) from public.assignments where session_id = p_session_id) >= v_ses.max_interrogati then
    raise exception 'La sessione è al completo: aumenta prima il numero di interrogati';
  end if;

  insert into public.assignments (session_id, subject_id, student_id, volontario, ordine)
  values (p_session_id, v_ses.subject_id, p_student_id, coalesce(p_volontario, false),
          (select coalesce(max(ordine), 0) + 1 from public.assignments where session_id = p_session_id));
  delete from public.exclusions where subject_id = v_ses.subject_id and student_id = p_student_id;

  perform private.log('aggiunta',
    case when p_volontario then 'Volontario per il ' else 'Aggiunto a mano al ' end || private.it_date(v_ses.data),
    p_student_id, v_ses.subject_id, v_ses.data, p_motivo);
end $$;

-- Cambio stato: assegnato | interrogato | assente | rimandato.
create or replace function public.staff_set_state(p_assignment_id bigint, p_stato text, p_motivo text default null)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_a public.assignments;
  v_data date;
  v_label text;
begin
  perform private.require_staff();
  if p_stato not in ('assegnato','interrogato','assente','rimandato') then
    raise exception 'Stato non valido';
  end if;
  select * into v_a from public.assignments where id = p_assignment_id for update;
  if not found then raise exception 'Assegnazione non trovata'; end if;
  if v_a.stato = p_stato then return; end if;

  update public.assignments
     set stato = p_stato,
         nota = coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), case when p_stato = 'assegnato' then null else nota end)
   where id = p_assignment_id;

  select data into v_data from public.sessions where id = v_a.session_id;
  v_label := case p_stato
    when 'interrogato' then 'Segnato come interrogato'
    when 'assente'     then 'Segnato come assente'
    when 'rimandato'   then 'Interrogazione rimandata'
    else 'Riportato a "assegnato"' end;
  perform private.log('stato', v_label || ' (' || private.it_date(v_data) || ')',
                      v_a.student_id, v_a.subject_id, v_data, p_motivo);
end $$;

-- Rimozione dalla sessione: lo studente torna nel pool della materia.
create or replace function public.staff_remove_assignment(p_assignment_id bigint, p_motivo text default null)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_a public.assignments;
  v_data date;
begin
  perform private.require_staff();
  select * into v_a from public.assignments where id = p_assignment_id for update;
  if not found then raise exception 'Assegnazione non trovata'; end if;
  select data into v_data from public.sessions where id = v_a.session_id;
  delete from public.assignments where id = p_assignment_id;
  perform private.log('rimozione', 'Rimosso dalla sessione del ' || private.it_date(v_data),
                      v_a.student_id, v_a.subject_id, v_data, p_motivo);
end $$;

-- Spostamento (o riassegnazione di assenti/rimandati) a un'altra sessione
-- della stessa materia. Lo stato torna 'assegnato'.
create or replace function public.staff_move_assignment(
  p_assignment_id bigint, p_target_session_id bigint, p_motivo text default null)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_a   public.assignments;
  v_da  public.sessions;
  v_a_s public.sessions;
begin
  perform private.require_staff();
  select * into v_a from public.assignments where id = p_assignment_id for update;
  if not found then raise exception 'Assegnazione non trovata'; end if;
  select * into v_a_s from public.sessions where id = p_target_session_id for update;
  if not found then raise exception 'Sessione di destinazione non trovata'; end if;
  if v_a_s.subject_id <> v_a.subject_id then
    raise exception 'Si può spostare solo in una sessione della stessa materia';
  end if;
  select * into v_da from public.sessions where id = v_a.session_id;
  if v_a.session_id = p_target_session_id and v_a.stato = 'assegnato' then return; end if;
  if v_a.session_id <> p_target_session_id and
     (select count(*) from public.assignments where session_id = p_target_session_id) >= v_a_s.max_interrogati then
    raise exception 'La sessione del % è al completo', private.it_date(v_a_s.data);
  end if;

  update public.assignments
     set session_id = p_target_session_id, stato = 'assegnato', estrazione_id = null,
         nota = nullif(btrim(coalesce(p_motivo, '')), ''),
         ordine = (select coalesce(max(ordine), 0) + 1 from public.assignments where session_id = p_target_session_id)
   where id = p_assignment_id;

  perform private.log(
    case when v_a.stato in ('assente','rimandato') then 'riassegnazione' else 'spostamento' end,
    case when v_a.stato in ('assente','rimandato') then 'Riassegnato' else 'Spostato' end
      || ' dal ' || private.it_date(v_da.data) || ' al ' || private.it_date(v_a_s.data),
    v_a.student_id, v_a.subject_id, v_a_s.data, p_motivo);
end $$;

-- Modifica di una sessione (data, argomento, numero di interrogati).
create or replace function public.staff_update_session(
  p_session_id bigint, p_data date, p_argomento text, p_max integer, p_motivo text default null)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_s public.sessions;
  v_n integer;
  v_cambi text[] := '{}';
begin
  perform private.require_staff();
  select * into v_s from public.sessions where id = p_session_id for update;
  if not found then raise exception 'Sessione non trovata'; end if;
  select count(*) into v_n from public.assignments where session_id = p_session_id;
  if p_max < v_n then
    raise exception 'Ci sono già % persone in questa sessione: non puoi scendere sotto questo numero', v_n;
  end if;

  update public.sessions
     set data = p_data, argomento = btrim(coalesce(p_argomento, '')), max_interrogati = p_max
   where id = p_session_id;

  if v_s.data <> p_data then
    v_cambi := v_cambi || ('data spostata dal ' || private.it_date(v_s.data) || ' al ' || private.it_date(p_data));
  end if;
  if v_s.argomento <> btrim(coalesce(p_argomento, '')) then
    v_cambi := v_cambi || ('argomento: "' || btrim(coalesce(p_argomento, '')) || '"');
  end if;
  if v_s.max_interrogati <> p_max then
    v_cambi := v_cambi || ('interrogati: ' || v_s.max_interrogati || ' → ' || p_max);
  end if;
  if array_length(v_cambi, 1) > 0 then
    perform private.log('sessione', 'Sessione del ' || private.it_date(v_s.data) || ' modificata: '
                        || array_to_string(v_cambi, ', '), null, v_s.subject_id, p_data, p_motivo);
  end if;
end $$;

-- ---------------------------------------------------------------------
--  RPC SOLO ADMIN
-- ---------------------------------------------------------------------

-- Crea più sessioni in una volta: [{"data":"2026-11-20","argomento":"...","max_interrogati":3}, ...]
create or replace function public.admin_add_sessions(p_subject_id bigint, p_sessioni jsonb)
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  e jsonb;
  n integer := 0;
begin
  perform private.require_staff(true);
  if not exists (select 1 from public.subjects where id = p_subject_id) then
    raise exception 'Materia non trovata';
  end if;
  if jsonb_typeof(p_sessioni) <> 'array' or jsonb_array_length(p_sessioni) = 0 then
    raise exception 'Nessuna sessione da creare';
  end if;
  for e in select * from jsonb_array_elements(p_sessioni) loop
    insert into public.sessions (subject_id, data, argomento, max_interrogati)
    values (p_subject_id, (e->>'data')::date, btrim(coalesce(e->>'argomento', '')), (e->>'max_interrogati')::integer);
    perform private.log('sessione', 'Nuova sessione il ' || private.it_date((e->>'data')::date)
                        || ' (' || (e->>'max_interrogati') || ' interrogati)',
                        null, p_subject_id, (e->>'data')::date, null);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Elimina una sessione: chi era assegnato torna nel pool.
create or replace function public.admin_delete_session(p_session_id bigint, p_motivo text default null)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_s public.sessions;
  r record;
begin
  perform private.require_staff(true);
  select * into v_s from public.sessions where id = p_session_id for update;
  if not found then raise exception 'Sessione non trovata'; end if;
  for r in select student_id from public.assignments where session_id = p_session_id loop
    perform private.log('rimozione', 'Rimosso: sessione del ' || private.it_date(v_s.data) || ' eliminata',
                        r.student_id, v_s.subject_id, v_s.data, p_motivo);
  end loop;
  delete from public.sessions where id = p_session_id;
  perform private.log('sessione', 'Sessione del ' || private.it_date(v_s.data) || ' eliminata',
                      null, v_s.subject_id, v_s.data, p_motivo);
end $$;

-- Crea o modifica una materia.
create or replace function public.admin_save_subject(p_id bigint, p_nome text, p_slug text, p_ordine integer default 0)
returns bigint
language plpgsql volatile security definer
set search_path = ''
as $$
declare v_id bigint;
begin
  perform private.require_staff(true);
  if p_id is null then
    insert into public.subjects (nome, slug, ordine) values (btrim(p_nome), p_slug, coalesce(p_ordine, 0))
    returning id into v_id;
    perform private.log('materia', 'Nuova materia: ' || btrim(p_nome), null, v_id);
  else
    update public.subjects set nome = btrim(p_nome), slug = p_slug, ordine = coalesce(p_ordine, 0)
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Materia non trovata'; end if;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'Esiste già una materia con questo indirizzo (slug)';
end $$;

create or replace function public.admin_delete_subject(p_id bigint)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare v_nome text;
begin
  perform private.require_staff(true);
  select nome into v_nome from public.subjects where id = p_id;
  if v_nome is null then raise exception 'Materia non trovata'; end if;
  delete from public.subjects where id = p_id;
  perform private.log('materia', 'Materia eliminata: ' || v_nome);
end $$;

-- Esclusione manuale dal sorteggio di una materia.
create or replace function public.admin_set_exclusion(
  p_subject_id bigint, p_student_id bigint, p_escluso boolean, p_motivo text default null)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform private.require_staff(true);
  if p_escluso then
    insert into public.exclusions (subject_id, student_id, motivo)
    values (p_subject_id, p_student_id, nullif(btrim(coalesce(p_motivo, '')), ''))
    on conflict (subject_id, student_id) do update set motivo = excluded.motivo;
    perform private.log('esclusione', 'Escluso dal sorteggio', p_student_id, p_subject_id, null, p_motivo);
  else
    delete from public.exclusions where subject_id = p_subject_id and student_id = p_student_id;
    perform private.log('esclusione', 'Rimesso nel sorteggio', p_student_id, p_subject_id, null, p_motivo);
  end if;
end $$;

-- Aggiunge o modifica uno studente.
create or replace function public.admin_save_student(
  p_id bigint, p_nome text, p_cognome text, p_motivo text default null)
returns bigint
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_old public.students;
  v_id  bigint;
begin
  perform private.require_staff(true);
  if p_id is null then
    insert into public.students (nome, cognome) values (btrim(p_nome), btrim(p_cognome)) returning id into v_id;
    perform private.log('elenco', 'Aggiunto all''elenco', v_id, null, null, p_motivo);
  else
    select * into v_old from public.students where id = p_id;
    if not found then raise exception 'Studente non trovato'; end if;
    update public.students set nome = btrim(p_nome), cognome = btrim(p_cognome) where id = p_id returning id into v_id;
    if v_old.nome <> btrim(p_nome) or v_old.cognome <> btrim(p_cognome) then
      perform private.log('elenco', 'Nome modificato (prima: ' || v_old.nome || ' ' || v_old.cognome || ')',
                          v_id, null, null, p_motivo);
    end if;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'Esiste già uno studente con questo nome e cognome';
end $$;

-- Attiva o disattiva uno studente (non si cancella mai: resta lo storico).
create or replace function public.admin_set_student_active(p_id bigint, p_attivo boolean, p_motivo text default null)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare v_old boolean;
begin
  perform private.require_staff(true);
  select attivo into v_old from public.students where id = p_id;
  if v_old is null then raise exception 'Studente non trovato'; end if;
  if v_old = p_attivo then return; end if;
  update public.students set attivo = p_attivo where id = p_id;
  perform private.log('elenco', case when p_attivo then 'Riattivato nell''elenco' else 'Disattivato dall''elenco' end,
                      p_id, null, null, p_motivo);
end $$;

-- Import dell'elenco da JSON [{"nome":"..","cognome":".."}].
-- Confronto per nome+cognome (senza maiuscole/spazi):
--  * nuovi → aggiunti; * assenti dal file → disattivati;
--  * presenti ma inattivi o con maiuscole diverse → aggiornati/riattivati.
create or replace function public.admin_import_students(p_elenco jsonb, p_motivo text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  e jsonb;
  v_nome text; v_cognome text;
  v_st public.students;
  v_add integer := 0; v_mod integer := 0; v_dis integer := 0;
  v_chiavi text[] := '{}';
  r record;
begin
  perform private.require_staff(true);
  if jsonb_typeof(p_elenco) <> 'array' then raise exception 'Il file deve contenere un elenco (array)'; end if;
  if jsonb_array_length(p_elenco) > 200 then raise exception 'Elenco troppo lungo (max 200 nomi)'; end if;

  for e in select * from jsonb_array_elements(p_elenco) loop
    v_nome := btrim(coalesce(e->>'nome', ''));
    v_cognome := btrim(coalesce(e->>'cognome', ''));
    if v_nome = '' or v_cognome = '' then raise exception 'Ogni voce deve avere nome e cognome'; end if;
    if lower(v_nome) || '|' || lower(v_cognome) = any(v_chiavi) then
      raise exception 'Nome ripetuto nel file: % %', v_nome, v_cognome;
    end if;
    v_chiavi := v_chiavi || (lower(v_nome) || '|' || lower(v_cognome));

    select * into v_st from public.students
    where lower(btrim(nome)) = lower(v_nome) and lower(btrim(cognome)) = lower(v_cognome);
    if not found then
      insert into public.students (nome, cognome) values (v_nome, v_cognome) returning * into v_st;
      perform private.log('elenco', 'Aggiunto all''elenco (import)', v_st.id, null, null, p_motivo);
      v_add := v_add + 1;
    elsif not v_st.attivo or v_st.nome <> v_nome or v_st.cognome <> v_cognome then
      update public.students set nome = v_nome, cognome = v_cognome, attivo = true where id = v_st.id;
      perform private.log('elenco',
        case when not v_st.attivo then 'Riattivato (import)' else 'Nome corretto (import)' end,
        v_st.id, null, null, p_motivo);
      v_mod := v_mod + 1;
    end if;
  end loop;

  for r in select id from public.students
           where attivo and not (lower(btrim(nome)) || '|' || lower(btrim(cognome)) = any(v_chiavi)) loop
    update public.students set attivo = false where id = r.id;
    perform private.log('elenco', 'Disattivato (non presente nel nuovo elenco)', r.id, null, null, p_motivo);
    v_dis := v_dis + 1;
  end loop;

  return jsonb_build_object('aggiunti', v_add, 'modificati', v_mod, 'disattivati', v_dis);
end $$;

-- Approva, cambia ruolo o revoca un membro dello staff.
create or replace function public.admin_set_staff(p_user_id uuid, p_ruolo text, p_approvato boolean)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform private.require_staff(true);
  if p_ruolo not in ('admin', 'rappresentante') then raise exception 'Ruolo non valido'; end if;
  if p_user_id = auth.uid() and (p_ruolo <> 'admin' or not p_approvato) then
    raise exception 'Non puoi togliere i permessi di amministratore a te stesso';
  end if;
  update public.staff set ruolo = p_ruolo, approvato = p_approvato where user_id = p_user_id;
  if not found then raise exception 'Utente non trovato'; end if;
end $$;

-- Rimuove la richiesta/ruolo (l'account Auth resta, senza permessi).
create or replace function public.admin_remove_staff(p_user_id uuid)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform private.require_staff(true);
  if p_user_id = auth.uid() then raise exception 'Non puoi rimuovere te stesso'; end if;
  update public.staff set approvato = false, ruolo = 'rappresentante' where user_id = p_user_id;
end $$;

-- Imposta il codice di classe (salvato solo come hash bcrypt).
create or replace function public.admin_set_class_code(p_code text)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform private.require_staff(true);
  if char_length(coalesce(p_code, '')) < 6 or char_length(p_code) > 100 then
    raise exception 'Il codice deve avere almeno 6 caratteri';
  end if;
  update public.settings
     set codice_hash = extensions.crypt(p_code, extensions.gen_salt('bf', 8)), aggiornato_il = now()
   where id = 1;
end $$;

-- ---------------------------------------------------------------------
--  PERMESSI DI ESECUZIONE
--  Supabase concede di default EXECUTE ad anon su ogni nuova funzione:
--  togliamo tutto e riconcediamo solo ciò che serve.
-- ---------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.staff_role(), private.is_staff(), private.is_admin() to authenticated;

-- Lettura pubblica (protetta dal codice di classe).
grant execute on function
  public.verify_class_code(text),
  public.get_class_data(text),
  public.get_subject(text, text),
  public.get_changelog(text, text, text, integer, integer),
  public.cerca_studente(text, text),
  public.keepalive()
to anon, authenticated;

-- Funzioni dello staff: solo utenti autenticati (il ruolo è verificato dentro).
grant execute on function
  public.my_staff_profile(),
  public.staff_get_subject(text),
  public.staff_draw(bigint),
  public.staff_undo_last_draw(bigint, text),
  public.staff_add_to_session(bigint, bigint, boolean, text),
  public.staff_set_state(bigint, text, text),
  public.staff_remove_assignment(bigint, text),
  public.staff_move_assignment(bigint, bigint, text),
  public.staff_update_session(bigint, date, text, integer, text),
  public.admin_add_sessions(bigint, jsonb),
  public.admin_delete_session(bigint, text),
  public.admin_save_subject(bigint, text, text, integer),
  public.admin_delete_subject(bigint),
  public.admin_set_exclusion(bigint, bigint, boolean, text),
  public.admin_save_student(bigint, text, text, text),
  public.admin_set_student_active(bigint, boolean, text),
  public.admin_import_students(jsonb, text),
  public.admin_set_staff(uuid, text, boolean),
  public.admin_remove_staff(uuid),
  public.admin_set_class_code(text)
to authenticated;

-- Le funzioni create in futuro non saranno eseguibili da anon per default.
alter default privileges in schema public revoke execute on functions from public, anon;

-- =====================================================================
--  Primo admin automatico: il PRIMO utente che si registra (quando non
--  esiste ancora nessun admin approvato) diventa admin approvato.
--  Tutti i successivi entrano come rappresentanti NON approvati.
--  Registrati subito dopo la pubblicazione, prima di condividere il link.
-- =====================================================================

create or replace function private.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare v_primo boolean;
begin
  -- Evita che due registrazioni simultanee diventino entrambe admin.
  lock table public.staff in share row exclusive mode;
  v_primo := not exists (select 1 from public.staff where ruolo = 'admin' and approvato);
  insert into public.staff (user_id, email, ruolo, approvato)
  values (new.id, coalesce(new.email, ''),
          case when v_primo then 'admin' else 'rappresentante' end, v_primo)
  on conflict (user_id) do nothing;
  return new;
end $$;

revoke execute on function private.handle_new_user() from public, anon, authenticated;

-- =====================================================================
--  Aggiunta di più persone insieme e copia degli interrogati da una
--  sessione a una sessione di un'altra materia.
-- =====================================================================

-- Aggiunge più studenti a una sessione (volontari o messi a mano) in
-- un'unica operazione. Con p_aumenta_max = true, se i posti non bastano
-- il numero di interrogati della sessione viene aumentato.
create or replace function public.staff_add_many(
  p_session_id bigint, p_student_ids bigint[], p_volontario boolean default false,
  p_motivo text default null, p_aumenta_max boolean default false)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_ses   public.sessions;
  v_id    bigint;
  v_st    public.students;
  v_altra date;
  v_n     integer;
  v_tot   integer;
  v_ord   integer;
  v_errori text[] := '{}';
begin
  perform private.require_staff();
  if coalesce(array_length(p_student_ids, 1), 0) = 0 then
    raise exception 'Seleziona almeno uno studente';
  end if;
  select * into v_ses from public.sessions where id = p_session_id for update;
  if not found then raise exception 'Sessione non trovata'; end if;
  perform 1 from public.subjects where id = v_ses.subject_id for update;

  -- Controlla tutti prima di inserire (tutto o niente).
  foreach v_id in array p_student_ids loop
    select * into v_st from public.students where id = v_id;
    if not found or not v_st.attivo then
      v_errori := v_errori || ('studente ' || v_id || ' non valido');
      continue;
    end if;
    select x.data into v_altra from public.assignments a join public.sessions x on x.id = a.session_id
    where a.subject_id = v_ses.subject_id and a.student_id = v_id;
    if found then
      v_errori := v_errori || (v_st.nome || ' ' || v_st.cognome || ' (già il ' || private.it_date(v_altra) || ')');
    end if;
  end loop;
  if array_length(v_errori, 1) > 0 then
    raise exception 'Non aggiunti: %. Per chi è già in elenco usa "Sposta".', array_to_string(v_errori, ', ');
  end if;

  select count(*), coalesce(max(ordine), 0) into v_n, v_ord from public.assignments where session_id = p_session_id;
  v_tot := v_n + (select count(distinct x) from unnest(p_student_ids) x);
  if v_tot > v_ses.max_interrogati then
    if not coalesce(p_aumenta_max, false) then
      raise exception 'Posti liberi: %, selezionati: %. Attiva "aumenta i posti" o seleziona meno persone.',
        v_ses.max_interrogati - v_n, v_tot - v_n;
    end if;
    if v_tot > 40 then raise exception 'Massimo 40 persone per sessione'; end if;
    update public.sessions set max_interrogati = v_tot where id = p_session_id;
    perform private.log('sessione', 'Sessione del ' || private.it_date(v_ses.data) || ' modificata: interrogati: '
                        || v_ses.max_interrogati || ' → ' || v_tot, null, v_ses.subject_id, v_ses.data, p_motivo);
  end if;

  foreach v_id in array (select array_agg(distinct x) from unnest(p_student_ids) x) loop
    v_ord := v_ord + 1;
    insert into public.assignments (session_id, subject_id, student_id, volontario, ordine)
    values (p_session_id, v_ses.subject_id, v_id, coalesce(p_volontario, false), v_ord);
    delete from public.exclusions where subject_id = v_ses.subject_id and student_id = v_id;
    perform private.log('aggiunta',
      case when p_volontario then 'Volontario per il ' else 'Aggiunto a mano al ' end || private.it_date(v_ses.data),
      v_id, v_ses.subject_id, v_ses.data, p_motivo);
  end loop;

  return jsonb_build_object('aggiunti', v_tot - v_n,
    'max_interrogati', greatest(v_ses.max_interrogati, v_tot));
end $$;

-- Copia gli interrogati (assegnati/interrogati) di una sessione in una
-- sessione di un'altra materia. Se p_to_session è null crea una nuova
-- sessione nella materia di destinazione con la stessa data (solo admin).
-- Chi è già in elenco nella materia di destinazione viene saltato.
-- Se servono più posti, il numero di interrogati viene aumentato.
create or replace function public.staff_copy_session(
  p_from_session bigint, p_to_subject bigint, p_to_session bigint default null, p_motivo text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_src     public.sessions;
  v_dst     public.sessions;
  v_src_mat text;
  v_n       integer;
  v_ord     integer;
  v_copiati integer := 0;
  v_saltati text[] := '{}';
  r         record;
begin
  perform private.require_staff(p_to_session is null);
  select * into v_src from public.sessions where id = p_from_session;
  if not found then raise exception 'Sessione di origine non trovata'; end if;
  if v_src.subject_id = p_to_subject then raise exception 'Scegli una materia diversa da quella di origine'; end if;
  select nome into v_src_mat from public.subjects where id = v_src.subject_id;
  perform 1 from public.subjects where id = p_to_subject for update;
  if not found then raise exception 'Materia di destinazione non trovata'; end if;

  if p_to_session is null then
    insert into public.sessions (subject_id, data, argomento, max_interrogati)
    values (p_to_subject, v_src.data, '', v_src.max_interrogati)
    returning * into v_dst;
    perform private.log('sessione', 'Nuova sessione il ' || private.it_date(v_dst.data)
                        || ' (copiata da ' || v_src_mat || ')', null, p_to_subject, v_dst.data, p_motivo);
  else
    select * into v_dst from public.sessions where id = p_to_session for update;
    if not found or v_dst.subject_id <> p_to_subject then
      raise exception 'Sessione di destinazione non valida';
    end if;
  end if;

  select coalesce(max(ordine), 0) into v_ord from public.assignments where session_id = v_dst.id;

  for r in
    select a.student_id, a.volontario, st.nome, st.cognome
    from public.assignments a join public.students st on st.id = a.student_id
    where a.session_id = v_src.id and a.stato in ('assegnato', 'interrogato') and st.attivo
    order by a.ordine, st.cognome
  loop
    if exists (select 1 from public.assignments where subject_id = p_to_subject and student_id = r.student_id) then
      v_saltati := v_saltati || (r.nome || ' ' || r.cognome);
      continue;
    end if;
    v_ord := v_ord + 1;
    insert into public.assignments (session_id, subject_id, student_id, volontario, ordine)
    values (v_dst.id, p_to_subject, r.student_id, r.volontario, v_ord);
    delete from public.exclusions where subject_id = p_to_subject and student_id = r.student_id;
    perform private.log('aggiunta', 'Copiato da ' || v_src_mat || ' (' || private.it_date(v_src.data) || ') al '
                        || private.it_date(v_dst.data), r.student_id, p_to_subject, v_dst.data, p_motivo);
    v_copiati := v_copiati + 1;
  end loop;

  select count(*) into v_n from public.assignments where session_id = v_dst.id;
  if v_n > v_dst.max_interrogati then
    update public.sessions set max_interrogati = v_n where id = v_dst.id;
    perform private.log('sessione', 'Sessione del ' || private.it_date(v_dst.data) || ' modificata: interrogati: '
                        || v_dst.max_interrogati || ' → ' || v_n, null, p_to_subject, v_dst.data, p_motivo);
  end if;

  return jsonb_build_object('copiati', v_copiati, 'saltati', to_jsonb(v_saltati),
    'session_id', v_dst.id, 'data', v_dst.data);
end $$;

revoke execute on function public.staff_add_many(bigint, bigint[], boolean, text, boolean) from public, anon;
revoke execute on function public.staff_copy_session(bigint, bigint, bigint, text) from public, anon;
grant execute on function public.staff_add_many(bigint, bigint[], boolean, text, boolean) to authenticated;
grant execute on function public.staff_copy_session(bigint, bigint, bigint, text) to authenticated;
