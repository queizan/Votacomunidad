-- VotaComunidad v1.3 — selección de viviendas, seguridad y apertura de votaciones.
-- Ejecutar DESPUÉS de los tres scripts iniciales, en SQL Editor de Supabase.
-- No borra sesiones, censos ni votos existentes. Repetible.
BEGIN;

-- Los participantes inscritos pueden ver qué viviendas siguen disponibles,
-- pero NUNCA reciben la identidad de quién ocupa las otras viviendas.
CREATE OR REPLACE FUNCTION public.list_session_dwellings(p_session uuid)
RETURNS TABLE(id uuid, label text, occupied boolean, mine boolean, selection_locked boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_user uuid;
DECLARE v_locked boolean;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL OR
     NOT (public.is_session_member(p_session) OR public.is_session_owner(p_session)) THEN
    RAISE EXCEPTION 'No tienes acceso al censo de esta sesión';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.unit_votes uv
    JOIN public.questions q ON q.id=uv.question_id
    WHERE q.session_id=p_session AND uv.representative_id=v_user
  ) INTO v_locked;
  RETURN QUERY
    SELECT d.id, d.label, (d.representative_id IS NOT NULL),
           (d.representative_id=v_user), v_locked
    FROM public.dwellings d
    WHERE d.session_id=p_session ORDER BY d.label;
END;
$$;

-- La selección se aplica como conjunto completo (cambiar/añadir/quitar viviendas).
-- El bloqueo FOR UPDATE sobre sessions serializa dos selecciones simultáneas.
-- Un usuario NO puede reclamar una vivienda previamente asignada a otro.
CREATE OR REPLACE FUNCTION public.claim_my_dwellings(p_session uuid, p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_user uuid; v_count integer;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL OR NOT public.is_session_member(p_session) THEN
    RAISE EXCEPTION 'Debes entrar en la sesión antes de seleccionar viviendas';
  END IF;
  PERFORM 1 FROM public.sessions s WHERE s.id=p_session FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sesión no disponible'; END IF;
  IF p_ids IS NULL OR cardinality(p_ids)>5000 OR
     (SELECT count(DISTINCT x) FROM unnest(p_ids) x)<>cardinality(p_ids) OR
     EXISTS(SELECT 1 FROM unnest(p_ids) x WHERE x IS NULL) THEN
    RAISE EXCEPTION 'Selección inválida';
  END IF;
  IF EXISTS(
    SELECT 1 FROM public.unit_votes uv
    JOIN public.questions q ON q.id=uv.question_id
    WHERE q.session_id=p_session AND uv.representative_id=v_user
  ) THEN
    RAISE EXCEPTION 'Ya has votado: tus viviendas están bloqueadas';
  END IF;
  SELECT count(*) INTO v_count FROM public.dwellings d
  WHERE d.session_id=p_session AND d.id=ANY(p_ids);
  IF v_count<>cardinality(p_ids) THEN
    RAISE EXCEPTION 'Hay viviendas que no existen en esta sesión';
  END IF;
  IF EXISTS(
    SELECT 1 FROM public.dwellings d
    WHERE d.session_id=p_session AND d.id=ANY(p_ids)
      AND d.representative_id IS NOT NULL AND d.representative_id<>v_user
  ) THEN
    RAISE EXCEPTION 'Una o más viviendas ya están asignadas a otra persona. Actualiza la lista';
  END IF;
  UPDATE public.dwellings d SET representative_id=NULL
    WHERE d.session_id=p_session AND d.representative_id=v_user
      AND NOT(d.id=ANY(p_ids));
  UPDATE public.dwellings d SET representative_id=v_user
    WHERE d.session_id=p_session AND d.id=ANY(p_ids)
      AND (d.representative_id IS NULL OR d.representative_id=v_user);
  RETURN cardinality(p_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.list_session_dwellings(uuid),public.claim_my_dwellings(uuid,uuid[])
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_session_dwellings(uuid),public.claim_my_dwellings(uuid,uuid[])
  TO authenticated;

-- Corregir el bloqueo que impedía abrir una pregunta sin viviendas ya asignadas.
-- Una reunión puede empezar con participantes todavía registrándose.
CREATE OR REPLACE FUNCTION public.validate_question_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF new.session_id IS DISTINCT FROM old.session_id OR new.id IS DISTINCT FROM old.id THEN
    RAISE EXCEPTION 'No se permite mover la pregunta';
  END IF;
  IF old.status='closed'
     OR (old.status='open' AND new.status<>'closed')
     OR (old.status='draft' AND new.status NOT IN ('draft','open')) THEN
    RAISE EXCEPTION 'Transición de estado no permitida';
  END IF;
  IF old.status<>'draft' AND
     (new.title IS DISTINCT FROM old.title OR new.options IS DISTINCT FROM old.options) THEN
    RAISE EXCEPTION 'No se puede modificar una pregunta iniciada';
  END IF;
  RETURN new;
END;
$$;

COMMIT;
