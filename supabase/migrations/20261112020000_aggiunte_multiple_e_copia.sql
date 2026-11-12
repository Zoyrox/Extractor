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
