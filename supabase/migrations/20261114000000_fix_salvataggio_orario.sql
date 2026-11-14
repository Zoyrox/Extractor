-- =====================================================================
--  Correzione: Supabase blocca le DELETE/UPDATE senza WHERE fatte tramite
--  l'API (estensione safeupdate) → "DELETE requires a WHERE clause" al
--  salvataggio dell'orario. Aggiunge la WHERE e imposta le ore della 5C.
--  Questo file è IDEMPOTENTE: si può eseguire più volte senza errori.
-- =====================================================================

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
end $$;

-- Ore di lezione della 5C (solo se non ne è ancora stata salvata nessuna).
insert into public.lesson_hours (ora, inizio, fine)
select * from (values
  (1, time '08:00', time '08:55'),
  (2, time '08:55', time '09:50'),
  (3, time '09:50', time '10:45'),
  (4, time '11:00', time '11:55'),
  (5, time '11:55', time '12:50'),
  (6, time '13:05', time '13:55'),
  (7, time '13:55', time '14:50')
) v(ora, inizio, fine)
where not exists (select 1 from public.lesson_hours);
