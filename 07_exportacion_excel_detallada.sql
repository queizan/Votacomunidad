-- VotaComunidad v1.5 · exportación Excel con detalle vivienda-voto.
-- Ejecutar DESPUÉS del SQL 06. No modifica ni elimina los votos.
-- Únicamente el organizador puede obtener este informe sensible.
BEGIN;

CREATE OR REPLACE FUNCTION public.export_session_details(p_session uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE
  v_code text;
  v_questions jsonb;
  v_dwellings jsonb;
  v_votes jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Se requiere autenticación';
  END IF;

  SELECT s.code INTO v_code
    FROM public.sessions s
    WHERE s.id=p_session AND s.owner_id=auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solo el organizador puede exportar las respuestas por vivienda';
  END IF;

  SELECT coalesce(jsonb_agg(
      jsonb_build_object('id',q.id,'title',q.title,'status',q.status,'options',q.options)
      ORDER BY q.created_at,q.id
    ),'[]'::jsonb)
    INTO v_questions
    FROM public.questions q
    WHERE q.session_id=p_session;

  SELECT coalesce(jsonb_agg(
      jsonb_build_object('id',d.id,'label',d.label)
      ORDER BY d.label,d.id
    ),'[]'::jsonb)
    INTO v_dwellings
    FROM public.dwellings d
    WHERE d.session_id=p_session;

  SELECT coalesce(jsonb_agg(
      jsonb_build_object('question_id',v.question_id,'dwelling_id',v.dwelling_id,'choice',v.choice)
      ORDER BY v.question_id,v.dwelling_id
    ),'[]'::jsonb)
    INTO v_votes
    FROM public.unit_votes v
    JOIN public.questions q ON q.id=v.question_id
    WHERE q.session_id=p_session;

  RETURN jsonb_build_object(
    'session',v_code,
    'questions',v_questions,
    'dwellings',v_dwellings,
    'votes',v_votes,
    'revision',md5(v_questions::text||'|'||v_dwellings::text||'|'||v_votes::text),
    'generated_at',transaction_timestamp()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.export_session_details(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.export_session_details(uuid) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;

SELECT to_regprocedure('public.export_session_details(uuid)') IS NOT NULL AS excel_export_ready;
