-- =====================================================================
--  Orario della classe, prof, ora e prof nelle sessioni, colore delle
--  materie, sessioni gestite anche dai rappresentanti, cestino (admin).
--  Questo file è IDEMPOTENTE: si può eseguire più volte senza errori.
-- =====================================================================

-- ---------------------------------------------------------------------
--  Tabelle
-- ---------------------------------------------------------------------

-- Prof e materie che possono interrogare.
create table if not exists public.teachers (
  id         bigint generated always as identity primary key,
  nome       text not null check (char_length(btrim(nome)) between 1 and 80),
  creato_il  timestamptz not null default now()
);
create table if not exists public.teacher_subjects (
  teacher_id bigint not null references public.teachers(id) on delete cascade,
  subject_id bigint not null references public.subjects(id) on delete cascade,
  primary key (teacher_id, subject_id)
);

-- Ore di lezione con orari (1ª ora 8:00–9:00, ...).
create table if not exists public.lesson_hours (
  ora     integer primary key check (ora between 1 and 12),
  inizio  time not null,
  fine    time not null,
  check (fine > inizio)
);

-- Orario settimanale: giorno (1 = lunedì ... 6 = sabato), ora, materia, prof.
create table if not exists public.timetable (
  giorno     integer not null check (giorno between 1 and 6),
  ora        integer not null references public.lesson_hours(ora) on delete cascade,
  subject_id bigint references public.subjects(id) on delete cascade,
  teacher_id bigint references public.teachers(id) on delete set null,
  primary key (giorno, ora)
);

-- Ora e prof della sessione; colore della materia.
alter table public.sessions add column if not exists ora integer check (ora between 1 and 12);
alter table public.sessions add column if not exists teacher_id bigint references public.teachers(id) on delete set null;
alter table public.subjects add column if not exists colore text check (colore ~ '^#[0-9a-fA-F]{6}$');

-- Cestino: sessioni eliminate (con chi era assegnato), recuperabili dall'admin.
create table if not exists private.cestino (
  id            bigint generated always as identity primary key,
  eliminata_il  timestamptz not null default now(),
  eliminata_da  uuid,
  subject_id    bigint,
  motivo        text,
  dati          jsonb not null
);

alter table public.teachers         enable row level security;
alter table public.teacher_subjects enable row level security;
alter table public.lesson_hours     enable row level security;
alter table public.timetable        enable row level security;
alter table private.cestino         enable row level security;

revoke all on public.teachers, public.teacher_subjects, public.lesson_hours, public.timetable from anon, authenticated;
grant select on public.teachers, public.teacher_subjects, public.lesson_hours, public.timetable to authenticated;

drop policy if exists staff_legge_teachers on public.teachers;
drop policy if exists staff_legge_teacher_subjects on public.teacher_subjects;
drop policy if exists staff_legge_lesson_hours on public.lesson_hours;
drop policy if exists staff_legge_timetable on public.timetable;
create policy staff_legge_teachers         on public.teachers         for select to authenticated using (private.is_staff());
create policy staff_legge_teacher_subjects on public.teacher_subjects for select to authenticated using (private.is_staff());
create policy staff_legge_lesson_hours     on public.lesson_hours     for select to authenticated using (private.is_staff());
create policy staff_legge_timetable        on public.timetable        for select to authenticated using (private.is_staff());

-- Ping realtime anche per le nuove tabelle.
drop trigger if exists ping_teachers on public.teachers;
drop trigger if exists ping_teacher_subjects on public.teacher_subjects;
drop trigger if exists ping_lesson_hours on public.lesson_hours;
drop trigger if exists ping_timetable on public.timetable;
create trigger ping_teachers         after insert or update or delete on public.teachers         for each statement execute function private.ping_realtime();
create trigger ping_teacher_subjects after insert or update or delete on public.teacher_subjects for each statement execute function private.ping_realtime();
create trigger ping_lesson_hours     after insert or update or delete on public.lesson_hours     for each statement execute function private.ping_realtime();
create trigger ping_timetable        after insert or update or delete on public.timetable        for each statement execute function private.ping_realtime();

-- Descrizione di ora e prof di una sessione (per le letture).
create or replace function private.info_sessione(p_ora integer, p_teacher_id bigint)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'ora', p_ora,
    'inizio', (select to_char(inizio, 'HH24:MI') from public.lesson_hours where ora = p_ora),
    'fine',   (select to_char(fine, 'HH24:MI') from public.lesson_hours where ora = p_ora),
    'prof',   (select nome from public.teachers where id = p_teacher_id))
$$;

-- ---------------------------------------------------------------------
--  Letture pubbliche aggiornate (ora, orari, prof, colore)
-- ---------------------------------------------------------------------

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
        select s.id, s.nome, s.slug, s.ordine, s.colore,
          (select count(*) from public.sessions x where x.subject_id = s.id) as n_sessioni,
          (select jsonb_build_object('data', x.data, 'argomento', x.argomento,
                    'max_interrogati', x.max_interrogati,
                    'n_assegnati', (select count(*) from public.assignments a where a.session_id = x.id))
                  || private.info_sessione(x.ora, x.teacher_id)
             from public.sessions x
            where x.subject_id = s.id and x.data >= private.oggi()
            order by x.data, x.ora nulls last, x.id limit 1) as prossima
        from public.subjects s
      ) m), '[]'::jsonb)
  );
end $$;

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
    'materia', jsonb_build_object('id', v_sub.id, 'nome', v_sub.nome, 'slug', v_sub.slug, 'colore', v_sub.colore),
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
        'non_presenti', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', a.id, 'nome', st.nome, 'cognome', st.cognome,
            'stato', a.stato, 'volontario', a.volontario, 'nota', a.nota, 'aggiornato_il', a.aggiornato_il)
            order by st.cognome, st.nome)
          from public.assignments a join public.students st on st.id = a.student_id
          where a.session_id = x.id and a.stato in ('assente', 'rimandato')), '[]'::jsonb)
      ) || private.info_sessione(x.ora, x.teacher_id)
        order by x.data, x.ora nulls last, x.id)
      from public.sessions x where x.subject_id = v_sub.id), '[]'::jsonb),
    'ultime_modifiche', coalesce((
      select jsonb_agg(c) from (
        select c.creato_il, c.studente_nome, c.studente_cognome, c.tipo, c.azione, c.motivo
        from public.changelog c where c.subject_id = v_sub.id
        order by c.creato_il desc, c.id desc limit 5) c), '[]'::jsonb)
  );
end $$;

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
              'materia', sb.nome, 'slug', sb.slug, 'colore', sb.colore, 'data', x.data,
              'argomento', x.argomento, 'stato', a.stato, 'volontario', a.volontario)
              || private.info_sessione(x.ora, x.teacher_id)
              order by x.data, x.ora nulls last)
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

-- ---------------------------------------------------------------------
--  Lettura staff della materia (con ora, prof e orario)
-- ---------------------------------------------------------------------

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
        'max_interrogati', x.max_interrogati, 'teacher_id', x.teacher_id,
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
      ) || private.info_sessione(x.ora, x.teacher_id)
        order by x.data, x.ora nulls last, x.id)
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
      from public.students st where st.attivo), '[]'::jsonb),
    'orario', public.staff_get_orario()
  );
end $$;

-- Orario completo per lo staff: ore, slot, prof con materie, materie.
create or replace function public.staff_get_orario()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform private.require_staff();
  return jsonb_build_object(
    'ore', coalesce((select jsonb_agg(jsonb_build_object('ora', ora, 'inizio', to_char(inizio, 'HH24:MI'), 'fine', to_char(fine, 'HH24:MI')) order by ora) from public.lesson_hours), '[]'::jsonb),
    'slot', coalesce((select jsonb_agg(jsonb_build_object('giorno', giorno, 'ora', ora, 'subject_id', subject_id, 'teacher_id', teacher_id) order by giorno, ora) from public.timetable), '[]'::jsonb),
    'prof', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'nome', t.nome,
              'materie', coalesce((select jsonb_agg(ts.subject_id) from public.teacher_subjects ts where ts.teacher_id = t.id), '[]'::jsonb))
              order by t.nome) from public.teachers t), '[]'::jsonb),
    'materie', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'slug', slug, 'colore', colore) order by ordine, nome) from public.subjects), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------
--  Sessioni: create, modificate ed eliminate anche dai rappresentanti
-- ---------------------------------------------------------------------

create or replace function private.descr_ora(p_ora integer)
returns text
language sql stable security definer
set search_path = ''
as $$ select case when p_ora is null then '' else ', ' || p_ora || 'ª ora' end $$;

-- [{"data":"2026-11-20","argomento":"...","max_interrogati":3,"ora":2,"teacher_id":1}, ...]
create or replace function public.staff_add_sessions(p_subject_id bigint, p_sessioni jsonb)
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  e jsonb;
  n integer := 0;
  v_ora integer;
begin
  perform private.require_staff();
  if not exists (select 1 from public.subjects where id = p_subject_id) then
    raise exception 'Materia non trovata';
  end if;
  if jsonb_typeof(p_sessioni) <> 'array' or jsonb_array_length(p_sessioni) = 0 then
    raise exception 'Nessuna sessione da creare';
  end if;
  for e in select * from jsonb_array_elements(p_sessioni) loop
    v_ora := nullif(e->>'ora', '')::integer;
    insert into public.sessions (subject_id, data, argomento, max_interrogati, ora, teacher_id)
    values (p_subject_id, (e->>'data')::date, btrim(coalesce(e->>'argomento', '')), (e->>'max_interrogati')::integer,
            v_ora, nullif(e->>'teacher_id', '')::bigint);
    perform private.log('sessione', 'Nuova sessione il ' || private.it_date((e->>'data')::date) || private.descr_ora(v_ora)
                        || ' (' || (e->>'max_interrogati') || ' interrogati)',
                        null, p_subject_id, (e->>'data')::date, null);
    n := n + 1;
  end loop;
  return n;
end $$;

-- La vecchia funzione resta (stesso comportamento) per compatibilità.
create or replace function public.admin_add_sessions(p_subject_id bigint, p_sessioni jsonb)
returns integer
language sql volatile security definer
set search_path = ''
as $$ select public.staff_add_sessions(p_subject_id, p_sessioni) $$;

-- Modifica della sessione con ora e prof (se p_imposta_ora_prof = true).
drop function if exists public.staff_update_session(bigint, date, text, integer, text);
create or replace function public.staff_update_session(
  p_session_id bigint, p_data date, p_argomento text, p_max integer, p_motivo text default null,
  p_ora integer default null, p_teacher_id bigint default null, p_imposta_ora_prof boolean default false)
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
     set data = p_data, argomento = btrim(coalesce(p_argomento, '')), max_interrogati = p_max,
         ora = case when p_imposta_ora_prof then p_ora else ora end,
         teacher_id = case when p_imposta_ora_prof then p_teacher_id else teacher_id end
   where id = p_session_id;

  if v_s.data <> p_data then
    v_cambi := v_cambi || ('data spostata dal ' || private.it_date(v_s.data) || ' al ' || private.it_date(p_data));
  end if;
  if p_imposta_ora_prof and v_s.ora is distinct from p_ora then
    v_cambi := v_cambi || (coalesce(p_ora || 'ª ora', 'ora tolta'));
  end if;
  if p_imposta_ora_prof and v_s.teacher_id is distinct from p_teacher_id then
    v_cambi := v_cambi || ('prof: ' || coalesce((select nome from public.teachers where id = p_teacher_id), 'nessuno'));
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

-- Eliminazione (anche rappresentanti): la sessione finisce nel cestino.
create or replace function public.staff_delete_session(p_session_id bigint, p_motivo text default null)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_s public.sessions;
  r record;
begin
  perform private.require_staff();
  select * into v_s from public.sessions where id = p_session_id for update;
  if not found then raise exception 'Sessione non trovata'; end if;

  insert into private.cestino (eliminata_da, subject_id, motivo, dati)
  values (auth.uid(), v_s.subject_id, nullif(btrim(coalesce(p_motivo, '')), ''), jsonb_build_object(
    'sessione', to_jsonb(v_s),
    'assegnazioni', coalesce((select jsonb_agg(to_jsonb(a) order by a.ordine) from public.assignments a where a.session_id = v_s.id), '[]'::jsonb)));
  delete from private.cestino where eliminata_il < now() - interval '90 days';

  for r in select student_id from public.assignments where session_id = p_session_id loop
    perform private.log('rimozione', 'Rimosso: sessione del ' || private.it_date(v_s.data) || ' eliminata',
                        r.student_id, v_s.subject_id, v_s.data, p_motivo);
  end loop;
  delete from public.sessions where id = p_session_id;
  perform private.log('sessione', 'Sessione del ' || private.it_date(v_s.data) || ' eliminata',
                      null, v_s.subject_id, v_s.data, p_motivo);
end $$;

create or replace function public.admin_delete_session(p_session_id bigint, p_motivo text default null)
returns void
language sql volatile security definer
set search_path = ''
as $$ select public.staff_delete_session(p_session_id, p_motivo) $$;

-- ---------------------------------------------------------------------
--  Solo admin: cestino, orario, prof, colore delle materie
-- ---------------------------------------------------------------------

create or replace function public.admin_list_cestino()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform private.require_staff(true);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'eliminata_il', c.eliminata_il, 'motivo', c.motivo,
      'da', (select email from public.staff where user_id = c.eliminata_da),
      'materia', (select nome from public.subjects where id = c.subject_id),
      'data', c.dati->'sessione'->>'data', 'ora', c.dati->'sessione'->>'ora',
      'argomento', c.dati->'sessione'->>'argomento',
      'persone', (select jsonb_agg(st.nome || ' ' || st.cognome)
                  from jsonb_array_elements(c.dati->'assegnazioni') a
                  join public.students st on st.id = (a->>'student_id')::bigint))
    order by c.eliminata_il desc) from private.cestino c), '[]'::jsonb);
end $$;

-- Ripristina una sessione eliminata. Chi nel frattempo è stato assegnato
-- altrove nella stessa materia non viene rimesso (restituito in 'saltati').
create or replace function public.admin_restore_session(p_id bigint)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c private.cestino;
  s jsonb;
  v_new bigint;
  a jsonb;
  v_ok integer := 0;
  v_saltati text[] := '{}';
  v_nome text;
begin
  perform private.require_staff(true);
  select * into c from private.cestino where id = p_id for update;
  if not found then raise exception 'Elemento non trovato nel cestino'; end if;
  s := c.dati->'sessione';
  if not exists (select 1 from public.subjects where id = (s->>'subject_id')::bigint) then
    raise exception 'La materia di questa sessione non esiste più';
  end if;
  insert into public.sessions (subject_id, data, argomento, max_interrogati, ora, teacher_id)
  values ((s->>'subject_id')::bigint, (s->>'data')::date, coalesce(s->>'argomento', ''), (s->>'max_interrogati')::integer,
          nullif(s->>'ora', '')::integer,
          (select id from public.teachers where id = nullif(s->>'teacher_id', '')::bigint))
  returning id into v_new;
  perform private.log('sessione', 'Sessione del ' || private.it_date((s->>'data')::date) || ' ripristinata dal cestino',
                      null, (s->>'subject_id')::bigint, (s->>'data')::date, null);

  for a in select * from jsonb_array_elements(c.dati->'assegnazioni') loop
    select nome || ' ' || cognome into v_nome from public.students where id = (a->>'student_id')::bigint and attivo;
    if v_nome is null or exists (select 1 from public.assignments
        where subject_id = (s->>'subject_id')::bigint and student_id = (a->>'student_id')::bigint) then
      v_saltati := v_saltati || coalesce(v_nome, 'studente non più attivo');
      continue;
    end if;
    insert into public.assignments (session_id, subject_id, student_id, stato, volontario, nota, ordine)
    values (v_new, (s->>'subject_id')::bigint, (a->>'student_id')::bigint, a->>'stato',
            coalesce((a->>'volontario')::boolean, false), a->>'nota', coalesce((a->>'ordine')::integer, 0));
    perform private.log('aggiunta', 'Rimesso nella sessione ripristinata del ' || private.it_date((s->>'data')::date),
                        (a->>'student_id')::bigint, (s->>'subject_id')::bigint, (s->>'data')::date, null);
    v_ok := v_ok + 1;
  end loop;
  delete from private.cestino where id = p_id;
  return jsonb_build_object('session_id', v_new, 'ripristinati', v_ok, 'saltati', to_jsonb(v_saltati));
end $$;

-- Prof: crea/modifica con l'elenco delle materie che può interrogare.
create or replace function public.admin_save_teacher(p_id bigint, p_nome text, p_subject_ids bigint[])
returns bigint
language plpgsql volatile security definer
set search_path = ''
as $$
declare v_id bigint;
begin
  perform private.require_staff(true);
  if p_id is null then
    insert into public.teachers (nome) values (btrim(p_nome)) returning id into v_id;
  else
    update public.teachers set nome = btrim(p_nome) where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Prof non trovato'; end if;
  end if;
  delete from public.teacher_subjects where teacher_id = v_id;
  insert into public.teacher_subjects (teacher_id, subject_id)
  select v_id, x from unnest(coalesce(p_subject_ids, '{}')) x
  where exists (select 1 from public.subjects where id = x)
  on conflict do nothing;
  return v_id;
end $$;

create or replace function public.admin_delete_teacher(p_id bigint)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform private.require_staff(true);
  delete from public.teachers where id = p_id;
end $$;

-- Sostituisce ore di lezione e orario settimanale in un colpo solo.
--  p_ore:  [{"ora":1,"inizio":"08:00","fine":"09:00"}, ...]
--  p_slot: [{"giorno":1,"ora":1,"subject_id":3,"teacher_id":2}, ...]
create or replace function public.admin_save_orario(p_ore jsonb, p_slot jsonb)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform private.require_staff(true);
  if jsonb_typeof(p_ore) <> 'array' or jsonb_typeof(p_slot) <> 'array' then
    raise exception 'Dati dell''orario non validi';
  end if;
  delete from public.timetable;
  delete from public.lesson_hours where ora not in (select (e->>'ora')::integer from jsonb_array_elements(p_ore) e);
  insert into public.lesson_hours (ora, inizio, fine)
  select (e->>'ora')::integer, (e->>'inizio')::time, (e->>'fine')::time from jsonb_array_elements(p_ore) e
  on conflict (ora) do update set inizio = excluded.inizio, fine = excluded.fine;
  insert into public.timetable (giorno, ora, subject_id, teacher_id)
  select (e->>'giorno')::integer, (e->>'ora')::integer,
         nullif(e->>'subject_id', '')::bigint, nullif(e->>'teacher_id', '')::bigint
  from jsonb_array_elements(p_slot) e
  where nullif(e->>'subject_id', '') is not null or nullif(e->>'teacher_id', '') is not null;
  perform private.log('orario', 'Orario della classe aggiornato');
end $$;

-- Materia con colore (sostituisce admin_save_subject mantenendo la vecchia firma).
create or replace function public.admin_save_subject_v2(p_id bigint, p_nome text, p_slug text, p_ordine integer, p_colore text)
returns bigint
language plpgsql volatile security definer
set search_path = ''
as $$
declare v_id bigint;
begin
  v_id := public.admin_save_subject(p_id, p_nome, p_slug, p_ordine);
  update public.subjects set colore = nullif(p_colore, '') where id = v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
--  Permessi
-- ---------------------------------------------------------------------
revoke execute on function private.info_sessione(integer, bigint) from public, anon, authenticated;
revoke execute on function private.descr_ora(integer) from public, anon, authenticated;
revoke execute on function public.staff_get_orario() from public, anon;
revoke execute on function public.staff_add_sessions(bigint, jsonb) from public, anon;
revoke execute on function public.admin_add_sessions(bigint, jsonb) from public, anon;
revoke execute on function public.staff_update_session(bigint, date, text, integer, text, integer, bigint, boolean) from public, anon;
revoke execute on function public.staff_delete_session(bigint, text) from public, anon;
revoke execute on function public.admin_delete_session(bigint, text) from public, anon;
revoke execute on function public.admin_list_cestino() from public, anon;
revoke execute on function public.admin_restore_session(bigint) from public, anon;
revoke execute on function public.admin_save_teacher(bigint, text, bigint[]) from public, anon;
revoke execute on function public.admin_delete_teacher(bigint) from public, anon;
revoke execute on function public.admin_save_orario(jsonb, jsonb) from public, anon;
revoke execute on function public.admin_save_subject_v2(bigint, text, text, integer, text) from public, anon;
grant execute on function
  public.staff_get_orario(),
  public.staff_add_sessions(bigint, jsonb),
  public.admin_add_sessions(bigint, jsonb),
  public.staff_update_session(bigint, date, text, integer, text, integer, bigint, boolean),
  public.staff_delete_session(bigint, text),
  public.admin_delete_session(bigint, text),
  public.admin_list_cestino(),
  public.admin_restore_session(bigint),
  public.admin_save_teacher(bigint, text, bigint[]),
  public.admin_delete_teacher(bigint),
  public.admin_save_orario(jsonb, jsonb),
  public.admin_save_subject_v2(bigint, text, text, integer, text)
to authenticated;
