-- =====================================================================
--  Azioni su più persone insieme, ordine degli interrogati, backup.
--  Questo file è IDEMPOTENTE: si può eseguire più volte senza errori.
--  In fondo registra le migrazioni precedenti (già eseguite a mano) nella
--  cronologia di Supabase, così l'integrazione GitHub non le riesegue.
-- =====================================================================

-- ---------------------------------------------------------------------
--  Azioni rapide su più assegnazioni (tutto o niente)
--   p_azione: 'interrogato' | 'assente' | 'rimandato' | 'assegnato'
--             | 'sposta' (richiede p_target_session) | 'rimuovi'
-- ---------------------------------------------------------------------
create or replace function public.staff_bulk(
  p_assignment_ids bigint[], p_azione text, p_target_session bigint default null,
  p_motivo text default null, p_aumenta_max boolean default false)
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_id   bigint;
  v_n    integer := 0;
  v_dst  public.sessions;
  v_occ  integer;
  v_nuovi integer;
begin
  perform private.require_staff();
  if coalesce(array_length(p_assignment_ids, 1), 0) = 0 then
    raise exception 'Nessuna persona selezionata';
  end if;
  if p_azione not in ('interrogato','assente','rimandato','assegnato','sposta','rimuovi') then
    raise exception 'Azione non valida';
  end if;

  if p_azione = 'sposta' then
    select * into v_dst from public.sessions where id = p_target_session for update;
    if not found then raise exception 'Scegli la sessione di destinazione'; end if;
    -- Posti necessari: chi arriva da altre sessioni.
    select count(*) into v_nuovi from public.assignments
     where id = any(p_assignment_ids) and session_id <> v_dst.id;
    select count(*) into v_occ from public.assignments where session_id = v_dst.id;
    if v_occ + v_nuovi > v_dst.max_interrogati then
      if not coalesce(p_aumenta_max, false) then
        raise exception 'Nella sessione del % ci sono % posti liberi, ne servono %',
          private.it_date(v_dst.data), v_dst.max_interrogati - v_occ, v_nuovi;
      end if;
      perform public.staff_update_session(v_dst.id, v_dst.data, v_dst.argomento, v_occ + v_nuovi, p_motivo);
    end if;
  end if;

  foreach v_id in array p_assignment_ids loop
    if p_azione = 'sposta' then
      perform public.staff_move_assignment(v_id, p_target_session, p_motivo);
    elsif p_azione = 'rimuovi' then
      perform public.staff_remove_assignment(v_id, p_motivo);
    else
      perform public.staff_set_state(v_id, p_azione, p_motivo);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------
--  Ordine degli interrogati in una sessione (chi va per primo)
-- ---------------------------------------------------------------------
create or replace function public.staff_reorder(p_session_id bigint, p_assignment_ids bigint[])
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_ses public.sessions;
  i integer;
begin
  perform private.require_staff();
  select * into v_ses from public.sessions where id = p_session_id for update;
  if not found then raise exception 'Sessione non trovata'; end if;
  if (select count(*) from public.assignments where session_id = p_session_id and id = any(p_assignment_ids))
     <> coalesce(array_length(p_assignment_ids, 1), 0) then
    raise exception 'L''elenco è cambiato nel frattempo: ricarica e riprova';
  end if;
  for i in 1 .. coalesce(array_length(p_assignment_ids, 1), 0) loop
    update public.assignments set ordine = i where id = p_assignment_ids[i];
  end loop;
  perform private.log('sessione', 'Ordine degli interrogati del ' || private.it_date(v_ses.data) || ' modificato',
                      null, v_ses.subject_id, v_ses.data, null);
end $$;

-- ---------------------------------------------------------------------
--  Backup: istantanee dentro il database (settimanali con pg_cron se
--  disponibile) + download dall'app per l'admin.
-- ---------------------------------------------------------------------
create table if not exists private.backups (
  id         bigint generated always as identity primary key,
  creato_il  timestamptz not null default now(),
  tipo       text not null default 'automatico',
  dati       jsonb not null
);
alter table private.backups enable row level security;

-- Tutti i dati della classe (l'hash del codice di classe è escluso).
create or replace function private.dati_backup()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'versione', 1,
    'creato_il', now(),
    'students',    coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.students t), '[]'),
    'subjects',    coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.subjects t), '[]'),
    'sessions',    coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.sessions t), '[]'),
    'assignments', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.assignments t), '[]'),
    'exclusions',  coalesce((select jsonb_agg(to_jsonb(t)) from public.exclusions t), '[]'),
    'changelog',   coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.changelog t), '[]'),
    'staff',       coalesce((select jsonb_agg(jsonb_build_object('email', t.email, 'ruolo', t.ruolo, 'approvato', t.approvato)) from public.staff t), '[]')
  )
$$;

-- Salva un'istantanea e tiene solo le ultime 12.
create or replace function private.crea_backup(p_tipo text default 'automatico')
returns bigint
language plpgsql volatile security definer
set search_path = ''
as $$
declare v_id bigint;
begin
  insert into private.backups (tipo, dati) values (p_tipo, private.dati_backup()) returning id into v_id;
  delete from private.backups where id not in (select id from private.backups order by creato_il desc limit 12);
  return v_id;
end $$;

-- Admin: crea un backup ora e lo restituisce (per scaricarlo).
create or replace function public.admin_backup_now()
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare v_id bigint;
begin
  perform private.require_staff(true);
  v_id := private.crea_backup('manuale');
  return (select dati from private.backups where id = v_id);
end $$;

create or replace function public.admin_list_backups()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform private.require_staff(true);
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'creato_il', creato_il, 'tipo', tipo,
            'n_studenti', jsonb_array_length(dati->'students'), 'n_sessioni', jsonb_array_length(dati->'sessions'))
            order by creato_il desc) from private.backups), '[]'::jsonb);
end $$;

create or replace function public.admin_get_backup(p_id bigint)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform private.require_staff(true);
  return (select dati from private.backups where id = p_id);
end $$;

-- Backup settimanale automatico (lunedì 03:00 UTC) se pg_cron è disponibile.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron non disponibile: backup automatico non attivato (%).', sqlerrm;
    return;
  end;
  begin
    execute $q$ select cron.schedule('backup-settimanale-classe', '0 3 * * 1', 'select private.crea_backup()') $q$;
  exception when others then
    raise notice 'Pianificazione del backup non riuscita: %', sqlerrm;
  end;
end $$;

-- ---------------------------------------------------------------------
--  Permessi
-- ---------------------------------------------------------------------
revoke execute on function public.staff_bulk(bigint[], text, bigint, text, boolean) from public, anon;
revoke execute on function public.staff_reorder(bigint, bigint[]) from public, anon;
revoke execute on function public.admin_backup_now() from public, anon;
revoke execute on function public.admin_list_backups() from public, anon;
revoke execute on function public.admin_get_backup(bigint) from public, anon;
revoke execute on function private.dati_backup() from public, anon, authenticated;
revoke execute on function private.crea_backup(text) from public, anon, authenticated;
grant execute on function public.staff_bulk(bigint[], text, bigint, text, boolean) to authenticated;
grant execute on function public.staff_reorder(bigint, bigint[]) to authenticated;
grant execute on function public.admin_backup_now() to authenticated;
grant execute on function public.admin_list_backups() to authenticated;
grant execute on function public.admin_get_backup(bigint) to authenticated;

-- ---------------------------------------------------------------------
--  Integrazione GitHub: registra le migrazioni già eseguite a mano, così
--  con "Deploy to production" Supabase applica solo quelle nuove.
-- ---------------------------------------------------------------------
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text not null primary key,
  statements text[],
  name text
);
insert into supabase_migrations.schema_migrations (version, name) values
  ('20261112000000', 'estrazioni_init'),
  ('20261112010000', 'primo_admin_automatico'),
  ('20261112020000', 'aggiunte_multiple_e_copia')
on conflict (version) do nothing;
