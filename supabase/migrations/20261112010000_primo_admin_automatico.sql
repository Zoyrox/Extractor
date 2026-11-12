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
