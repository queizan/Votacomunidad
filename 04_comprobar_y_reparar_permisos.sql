-- VotaComunidad: correccion no destructiva de permisos para crear sesiones.
-- Ejecutar desde Supabase SQL Editor en el proyecto correcto.
-- No desactiva RLS ni concede permisos al rol anon o al publico.
BEGIN;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT ON TABLE public.sessions TO authenticated;
COMMIT;

-- Diagnostico: estos cinco campos deberian mostrar true.
SELECT
  has_schema_privilege('authenticated', 'public', 'USAGE') AS schema_access,
  has_table_privilege('authenticated', 'public.sessions', 'SELECT') AS sessions_select,
  has_table_privilege('authenticated', 'public.sessions', 'INSERT') AS sessions_insert,
  (SELECT c.relrowsecurity
   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'sessions') AS rls_active,
  EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = 'sessions'
      AND p.policyname = 'session_insert'
      AND p.cmd IN ('INSERT', 'ALL')
  ) AS insert_policy_present;
