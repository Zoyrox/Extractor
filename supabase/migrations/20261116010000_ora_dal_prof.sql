-- =====================================================================
--  Ora della sessione ricavata dall'orario.
--  Se una sessione non ha l'ora ma ha il prof (es. Prof.ssa Artale, lunedì),
--  l'ora si prende dall'orario: l'ora di quel giorno con quel prof.
--  Funziona anche con le ore dell'orario senza materia ("decide il prof"),
--  per i prof che insegnano più materie (Italiano e Storia).
--  Senza prof: si usa l'ora di quella materia in quel giorno (e il suo prof).
--  Questo file è IDEMPOTENTE: si può eseguire più volte senza errori.
-- =====================================================================

create or replace function private.ora_da_orario(p_data date, p_subject_id bigint, p_teacher_id bigint,
  out ora integer, out teacher_id bigint)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  g integer := extract(isodow from p_data)::integer;
begin
  if p_data is null or g > 6 then return; end if;
  if p_teacher_id is not null then
    -- Ore di quel prof in quel giorno: prima quelle della stessa materia o
    -- senza materia, poi le altre; a parità, la prima ora della giornata.
    select t.ora, t.teacher_id into ora, teacher_id
    from public.timetable t
    where t.giorno = g and t.teacher_id = p_teacher_id
    order by (t.subject_id is null or t.subject_id = p_subject_id) desc, t.ora
    limit 1;
    return;
  end if;
  -- Senza prof: l'ora della materia, oppure un'ora "decide il prof" di un
  -- prof che insegna quella materia.
  select t.ora, t.teacher_id into ora, teacher_id
  from public.timetable t
  where t.giorno = g and (
    t.subject_id = p_subject_id or
    (t.subject_id is null and t.teacher_id is not null and exists (
      select 1 from public.teacher_subjects ts where ts.teacher_id = t.teacher_id and ts.subject_id = p_subject_id)))
  order by (t.subject_id = p_subject_id) desc nulls last, t.ora
  limit 1;
end $$;

create or replace function private.completa_ora_sessione()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
begin
  if new.ora is null then
    select * into r from private.ora_da_orario(new.data, new.subject_id, new.teacher_id);
    if r.ora is not null then
      new.ora := r.ora;
      new.teacher_id := coalesce(new.teacher_id, r.teacher_id);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists completa_ora on public.sessions;
create trigger completa_ora before insert or update of data, ora, teacher_id, subject_id on public.sessions
  for each row execute function private.completa_ora_sessione();

-- Completa le sessioni da oggi in poi rimaste senza ora (dopo un cambio d'orario).
create or replace function private.completa_ore_sessioni()
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.sessions set ora = null where ora is null and data >= private.oggi();
end $$;

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
  -- "where true": richiesto da safeupdate per le cancellazioni complete.
  delete from public.timetable where true;
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
  -- Con il nuovo orario completa le sessioni future rimaste senza ora.
  perform private.completa_ore_sessioni();
end $$;

revoke execute on function private.ora_da_orario(date, bigint, bigint) from public, anon, authenticated;
revoke execute on function private.completa_ore_sessioni() from public, anon, authenticated;
revoke execute on function public.admin_save_orario(jsonb, jsonb) from public, anon;
grant execute on function public.admin_save_orario(jsonb, jsonb) to authenticated;

-- Sessioni già create senza ora: le completa subito.
select private.completa_ore_sessioni();
