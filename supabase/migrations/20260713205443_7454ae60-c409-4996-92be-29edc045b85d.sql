
-- 1. Fix RLS: authenticated must be able to execute helper functions used inside policies.
-- The `private` schema is NOT exposed via PostgREST, so these are not callable as RPC.
GRANT USAGE ON SCHEMA private TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_admin(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.my_assigned_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.admin_seats_available() TO anon, authenticated;

-- 2. Immutable audit log
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  target_owner_admin_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON public.audit_logs (actor_admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_target_idx ON public.audit_logs (target_type, target_id);

GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Admins can only read audit entries scoped to their own workspace
DROP POLICY IF EXISTS audit_logs_select ON public.audit_logs;
CREATE POLICY audit_logs_select ON public.audit_logs FOR SELECT TO authenticated
USING (
  private.is_admin(auth.uid())
  AND (actor_admin_id = auth.uid() OR target_owner_admin_id = auth.uid())
);

-- No INSERT/UPDATE/DELETE policies -> writes only via service_role (server functions).

-- Immutability trigger: block UPDATE and DELETE from every role except service_role/postgres.
CREATE OR REPLACE FUNCTION public.audit_logs_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_user IN ('service_role', 'postgres') THEN
    -- Even privileged roles are blocked from mutating audit rows to keep the trail immutable.
    RAISE EXCEPTION 'audit_logs are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RAISE EXCEPTION 'audit_logs are immutable' USING ERRCODE = 'insufficient_privilege';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.audit_logs_immutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS audit_logs_no_update ON public.audit_logs;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_immutable();

DROP TRIGGER IF EXISTS audit_logs_no_delete ON public.audit_logs;
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_immutable();
