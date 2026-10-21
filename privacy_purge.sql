-- VotaComunidad · Finalización y eliminación de datos activos
-- Ejecutar DESPUÉS de schema.sql y upgrade_viviendas.sql.
-- Esta función es SECURITY DEFINER; verifica por sí misma al organizador.
-- NOTA: asume los nombres de tabla utilizados en app.js.
create or replace function public.finish_and_purge_session(p_session uuid)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_users uuid[];
begin
  if auth.uid() is null then
    raise exception 'Se requiere autenticación';
  end if;
  -- Bloquear la sesión mientras se borra, evitando votos concurrentes.
  select owner_id into v_owner
  from public.sessions where id=p_session for update;
  if not found then raise exception 'Sesión inexistente o ya eliminada'; end if;
  if v_owner <> auth.uid() then raise exception 'Solo el organizador puede finalizar la sesión'; end if;
  -- No destruir mientras haya preguntas abiertas. El organizador debe cerrarlas.
  if exists(select 1 from public.questions where session_id=p_session and status='open') then
    raise exception 'Cierra todas las votaciones antes de finalizar';
  end if;
  select coalesce(array_agg(distinct person_id),array[]::uuid[]) into v_users
  from (
    select owner_id as person_id from public.sessions where id=p_session
    union all
    select user_id from public.members where session_id=p_session
  ) t where person_id is not null;
  delete from public.unit_votes
  where question_id in (select id from public.questions where session_id=p_session);
  delete from public.dwellings where session_id=p_session;
  delete from public.members where session_id=p_session;
  delete from public.questions where session_id=p_session;
  delete from public.sessions where id=p_session;
  -- Sólo devolver IDs que ya no aparecen como organizadores/participantes en otras sesiones.
  return array(
    select x from unnest(v_users) x
    where not exists(select 1 from public.sessions s where s.owner_id=x)
      and not exists(select 1 from public.members m where m.user_id=x)
  );
end;
$$;
revoke all on function public.finish_and_purge_session(uuid) from public, anon;
grant execute on function public.finish_and_purge_session(uuid) to authenticated;
-- Importante: esta operación no elimina auth.users ni backups; ver Edge Function.
