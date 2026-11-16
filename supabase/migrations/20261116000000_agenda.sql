-- =====================================================================
--  Agenda: tutte le sessioni di tutte le materie in un intervallo di date,
--  con interrogati, ora, orari e prof. Lettura protetta dal codice di classe.
--  Questo file è IDEMPOTENTE: si può eseguire più volte senza errori.
-- =====================================================================

create or replace function public.get_agenda(p_code text, p_dal date default null, p_al date default null)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v text := private.check_code(p_code);
  v_dal date := coalesce(p_dal, private.oggi());
  v_al  date := coalesce(p_al, coalesce(p_dal, private.oggi()) + 60);
begin
  if v <> 'ok' then return private.code_error(v); end if;
  if v_al < v_dal or v_al - v_dal > 400 then raise exception 'Intervallo di date non valido'; end if;
  return jsonb_build_object(
    'generato_il', now(),
    'oggi', private.oggi(),
    'dal', v_dal, 'al', v_al,
    'sessioni', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'data', x.data, 'argomento', x.argomento, 'max_interrogati', x.max_interrogati,
        'materia', jsonb_build_object('id', sb.id, 'nome', sb.nome, 'slug', sb.slug, 'colore', sb.colore),
        'interrogati', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', a.id, 'nome', st.nome, 'cognome', st.cognome, 'stato', a.stato,
            'volontario', a.volontario, 'nota', a.nota) order by a.ordine, st.cognome, st.nome)
          from public.assignments a join public.students st on st.id = a.student_id
          where a.session_id = x.id and a.stato in ('assegnato', 'interrogato')), '[]'::jsonb),
        'non_presenti', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', a.id, 'nome', st.nome, 'cognome', st.cognome, 'stato', a.stato,
            'volontario', a.volontario, 'nota', a.nota) order by st.cognome, st.nome)
          from public.assignments a join public.students st on st.id = a.student_id
          where a.session_id = x.id and a.stato in ('assente', 'rimandato')), '[]'::jsonb)
      ) || private.info_sessione(x.ora, x.teacher_id)
        order by x.data, x.ora nulls last, sb.ordine, x.id)
      from public.sessions x join public.subjects sb on sb.id = x.subject_id
      where x.data between v_dal and v_al), '[]'::jsonb)
  );
end $$;

revoke execute on function public.get_agenda(text, date, date) from public;
grant execute on function public.get_agenda(text, date, date) to anon, authenticated;
