-- VotaComunidad v1.4: reparación definitiva y sincronización ligera
-- Ejecutar una sola vez en Supabase SQL Editor. Repetible: CREATE OR REPLACE.
-- No borra datos. RLS se mantiene activo.
BEGIN;

-- Asegurar permisos base; usuarios anónimos usan el rol authenticated.
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT ON public.sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.questions TO authenticated;
GRANT SELECT ON public.members, public.dwellings, public.unit_votes TO authenticated;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dwellings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unit_votes ENABLE ROW LEVEL SECURITY;

-- 1. Quitar la prohibición de abrir antes de que haya pisos asignados.
CREATE OR REPLACE FUNCTION public.validate_question_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
 IF NEW.session_id IS DISTINCT FROM OLD.session_id OR NEW.id IS DISTINCT FROM OLD.id THEN
  RAISE EXCEPTION 'No se permite mover la pregunta';
 END IF;
 IF OLD.status='closed'
    OR (OLD.status='open' AND NEW.status<>'closed')
    OR (OLD.status='draft' AND NEW.status NOT IN ('draft','open')) THEN
  RAISE EXCEPTION 'Transición de estado no permitida';
 END IF;
 IF OLD.status<>'draft' AND
   (NEW.title IS DISTINCT FROM OLD.title OR NEW.options IS DISTINCT FROM OLD.options) THEN
  RAISE EXCEPTION 'No se puede modificar una pregunta iniciada';
 END IF;
 RETURN NEW;
END;
$$;

-- 2. Asignación exclusiva: solo asistentes inscritos; operación atómica.
CREATE OR REPLACE FUNCTION public.claim_my_dwellings(p_session uuid, p_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_uid uuid := auth.uid(); v_count integer;
BEGIN
 IF v_uid IS NULL OR NOT public.is_session_member(p_session) THEN
  RAISE EXCEPTION 'Debes acceder a la reunión antes de seleccionar una vivienda';
 END IF;
 PERFORM 1 FROM public.sessions s WHERE s.id=p_session FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Sesión no disponible'; END IF;
 IF p_ids IS NULL OR cardinality(p_ids)>5000
    OR (SELECT count(DISTINCT x.id) FROM unnest(p_ids) AS x(id))<>cardinality(p_ids)
    OR EXISTS(SELECT 1 FROM unnest(p_ids) AS x(id) WHERE x.id IS NULL) THEN
  RAISE EXCEPTION 'Selección inválida';
 END IF;
 IF EXISTS (
  SELECT 1 FROM public.unit_votes uv
  JOIN public.questions q ON q.id=uv.question_id
  WHERE q.session_id=p_session AND uv.representative_id=v_uid
 ) THEN
  RAISE EXCEPTION 'Ya has votado y no puedes cambiar las viviendas representadas';
 END IF;
 SELECT count(*) INTO v_count FROM public.dwellings d
 WHERE d.session_id=p_session AND d.id=ANY(p_ids);
 IF v_count<>cardinality(p_ids) THEN RAISE EXCEPTION 'Viviendas no válidas'; END IF;
 IF EXISTS(SELECT 1 FROM public.dwellings d
  WHERE d.session_id=p_session AND d.id=ANY(p_ids)
  AND d.representative_id IS NOT NULL AND d.representative_id<>v_uid) THEN
  RAISE EXCEPTION 'Una vivienda ya está asignada a otra persona. Actualiza la pantalla';
 END IF;
 UPDATE public.dwellings d SET representative_id=NULL
 WHERE d.session_id=p_session AND d.representative_id=v_uid AND NOT(d.id=ANY(p_ids));
 UPDATE public.dwellings d SET representative_id=v_uid
 WHERE d.session_id=p_session AND d.id=ANY(p_ids);
 RETURN cardinality(p_ids);
END;
$$;

-- 3. Voto individual por vivienda; mismo bloqueo de sesión que la asignación.
CREATE OR REPLACE FUNCTION public.cast_unit_votes(p_question uuid, p_choice text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE q public.questions%ROWTYPE; v_session uuid; n integer; v_count integer;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere autenticación'; END IF;
 SELECT session_id INTO v_session FROM public.questions WHERE id=p_question;
 IF v_session IS NULL THEN RAISE EXCEPTION 'Pregunta no disponible'; END IF;
 PERFORM 1 FROM public.sessions WHERE id=v_session FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Sesión no disponible'; END IF;
 SELECT * INTO q FROM public.questions WHERE id=p_question FOR UPDATE;
 IF q.id IS NULL OR q.status<>'open' THEN RAISE EXCEPTION 'Votación cerrada o inexistente'; END IF;
 IF NOT public.is_session_member(q.session_id) THEN RAISE EXCEPTION 'No perteneces a la sesión'; END IF;
 IF NOT (p_choice=ANY(q.options)) THEN RAISE EXCEPTION 'Respuesta no permitida'; END IF;
 SELECT count(*) INTO v_count FROM public.dwellings
 WHERE session_id=q.session_id AND representative_id=auth.uid();
 IF v_count=0 THEN RAISE EXCEPTION 'Primero selecciona tus viviendas'; END IF;
 INSERT INTO public.unit_votes(question_id,dwelling_id,representative_id,choice)
 SELECT q.id,d.id,auth.uid(),p_choice FROM public.dwellings d
 WHERE d.session_id=q.session_id AND d.representative_id=auth.uid()
 ON CONFLICT(question_id,dwelling_id) DO UPDATE
 SET choice=EXCLUDED.choice,representative_id=EXCLUDED.representative_id,updated_at=now()
 WHERE public.unit_votes.representative_id=auth.uid();
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>v_count THEN RAISE EXCEPTION 'Conflicto de votación; vuelve a intentarlo'; END IF;
 RETURN n;
END;
$$;

-- 4. Una petición: pregunta activa + viviendas disponibles + respuesta propia.
-- NO revela a participantes las identidades ni votos de otras personas.
CREATE OR REPLACE FUNCTION public.participant_state(p_session uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_uid uuid := auth.uid(); v_homes jsonb; v_question jsonb; v_vote text;
        v_locked boolean; v_title text; v_code text;
BEGIN
 IF v_uid IS NULL OR NOT public.is_session_member(p_session) THEN
  RAISE EXCEPTION 'Sin acceso a la reunión o sesión finalizada';
 END IF;
 SELECT s.title,s.code INTO v_title,v_code FROM public.sessions s WHERE s.id=p_session;
 IF NOT FOUND THEN RAISE EXCEPTION 'La sesión ya ha finalizado'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.unit_votes uv JOIN public.questions q ON q.id=uv.question_id
 WHERE q.session_id=p_session AND uv.representative_id=v_uid) INTO v_locked;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',d.id,'label',d.label,'occupied',d.representative_id IS NOT NULL,
   'mine',d.representative_id=v_uid) ORDER BY d.label),'[]'::jsonb)
 INTO v_homes FROM public.dwellings d WHERE d.session_id=p_session;
 SELECT to_jsonb(q) INTO v_question FROM public.questions q
 WHERE q.session_id=p_session AND q.status='open' LIMIT 1;
 IF v_question IS NOT NULL THEN
  SELECT uv.choice INTO v_vote FROM public.unit_votes uv
  WHERE uv.question_id=(v_question->>'id')::uuid AND uv.representative_id=v_uid LIMIT 1;
 END IF;
 RETURN jsonb_build_object('title',v_title,'code',v_code,'homes',v_homes,
  'locked',v_locked,'question',v_question,'my_vote',v_vote);
END;
$$;

-- 5. Una petición: lista de inscritos, viviendas y recuentos agregados.
-- Solo el propietario de la sesión puede acceder a este resumen.
CREATE OR REPLACE FUNCTION public.organizer_state(p_session uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_title text; v_code text; v_q jsonb; v_m jsonb; v_d jsonb; v_c jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere autenticación'; END IF;
 SELECT s.title,s.code INTO v_title,v_code FROM public.sessions s
 WHERE s.id=p_session AND s.owner_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'Solo el organizador puede consultar este panel'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at),'[]'::jsonb)
 INTO v_q FROM public.questions q WHERE q.session_id=p_session;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'user_id',m.user_id,'joined_at',m.joined_at) ORDER BY m.joined_at),'[]'::jsonb)
 INTO v_m FROM public.members m WHERE m.session_id=p_session;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',d.id,'label',d.label,'representative_id',d.representative_id) ORDER BY d.label),'[]'::jsonb)
 INTO v_d FROM public.dwellings d WHERE d.session_id=p_session;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'question_id',v.question_id,'choice',v.choice,'count',v.n)),'[]'::jsonb)
 INTO v_c FROM (
  SELECT uv.question_id,uv.choice,count(*)::integer AS n FROM public.unit_votes uv
  JOIN public.questions q ON q.id=uv.question_id
  WHERE q.session_id=p_session GROUP BY uv.question_id,uv.choice
 ) v;
 RETURN jsonb_build_object('title',v_title,'code',v_code,'questions',v_q,
  'members',v_m,'dwellings',v_d,'counts',v_c);
END;
$$;

REVOKE ALL ON FUNCTION public.participant_state(uuid),
 public.organizer_state(uuid),public.claim_my_dwellings(uuid,uuid[]),
 public.cast_unit_votes(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.participant_state(uuid),
 public.organizer_state(uuid),public.claim_my_dwellings(uuid,uuid[]),
 public.cast_unit_votes(uuid,text) TO authenticated;

-- Invalidar la función antigua para impedir consultas adicionales innecesarias.
-- No se retira porque podría existir un cliente antiguo en caché.
NOTIFY pgrst, 'reload schema';
COMMIT;

-- Diagnóstico tras ejecución.
SELECT
 to_regprocedure('public.participant_state(uuid)') IS NOT NULL AS participant_ready,
 to_regprocedure('public.organizer_state(uuid)') IS NOT NULL AS organizer_ready,
 to_regprocedure('public.claim_my_dwellings(uuid,uuid[])') IS NOT NULL AS housing_ready,
 to_regprocedure('public.cast_unit_votes(uuid,text)') IS NOT NULL AS voting_ready;
