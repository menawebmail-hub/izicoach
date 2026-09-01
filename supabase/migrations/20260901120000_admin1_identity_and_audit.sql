-- ============================================================================
-- Admin-1 — administrative identity, authorization, and audit infrastructure
-- ============================================================================
--
-- SCOPE: brand-new tables/functions only. Does not touch coaches, invites,
-- student_auth, coach_data, or messages in any way — no RLS/grants/data on
-- any existing table is modified by this migration.
--
-- Design decisions locked in for Admin-1 (see planning session, not
-- versioned here):
--   - admins is a separate identity, NOT admins.id = auth.uid(). Own
--     surrogate PK (`id`), with `auth_user_id` as the unique link to
--     auth.users. Deliberately different from the coaches/student_auth
--     convention (id = auth.uid()) used elsewhere in this schema.
--   - A single auth.users.id may legitimately exist in BOTH `coaches` and
--     `admins.auth_user_id` at the same time — no constraint prevents this,
--     by explicit decision. resolveSession() (coach/student identity) and
--     is_admin()/admin_get_session() (admin identity) are fully independent
--     — neither reads from nor writes to the other's tables.
--   - No RLS policies on admins/audit_logs at all — RLS is enabled with zero
--     permissive policies (deny-all for anon/authenticated), and table
--     grants to anon/authenticated are zero. The only sanctioned access path
--     is through is_admin()/admin_get_session() (and future admin_* RPCs),
--     never direct table access, never a `USING (is_admin(...))` policy on
--     admins/audit_logs or on any business table.
--   - audit_logs.actor_id/coach_id are plain uuid columns with NO foreign
--     key. A historical log entry must never be deleted or nulled out as a
--     side effect of deleting the auth user/coach it refers to — audit
--     history has to survive account deletion.
--
-- Wrapped in a single transaction. Idempotent (CREATE TABLE IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION, IF NOT EXISTS on indexes) — safe to re-run.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. admins
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id),
  name text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

-- No policies, intentionally — see file header. Zero table grants either.
REVOKE ALL ON public.admins FROM anon;
REVOKE ALL ON public.admins FROM authenticated;

-- ============================================================================
-- 2. audit_logs
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_type text NOT NULL CHECK (actor_type IN ('admin','system','coach','student','anon','authenticated')),
  actor_id uuid,
  action text NOT NULL,
  target_type text,
  target_id text,
  coach_id uuid,
  result text NOT NULL CHECK (result IN ('success','rejected','error')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON public.audit_logs (actor_type, actor_id);
CREATE INDEX IF NOT EXISTS audit_logs_coach_id_idx ON public.audit_logs (coach_id) WHERE coach_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON public.audit_logs (action);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- No policies, intentionally. Zero table grants — even INSERT: the only
-- writer is admin_get_session() (SECURITY DEFINER, owner postgres), which
-- bypasses RLS/grants as the table owner. The frontend never inserts here
-- directly.
REVOKE ALL ON public.audit_logs FROM anon;
REVOKE ALL ON public.audit_logs FROM authenticated;

-- ============================================================================
-- 3. is_admin(uuid) — internal helper, never called directly by the
-- frontend. Callable by other SECURITY DEFINER functions (owner postgres)
-- without needing an EXECUTE grant for `authenticated`, since a nested call
-- from within a SECURITY DEFINER function runs with the calling function's
-- owner privileges.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_admin(p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS(
    SELECT 1 FROM public.admins
    WHERE auth_user_id = p_uid AND active = true
  );
$function$
;

ALTER FUNCTION public.is_admin(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO postgres, service_role;

-- ============================================================================
-- 4. admin_get_session() — the only RPC the admin frontend calls directly.
-- Never exposes anything from auth.users. Logs a denial (not a grant) into
-- audit_logs whenever an authenticated non-admin calls this — real admins
-- calling it on every page load are NOT logged (that would just be noise,
-- not an event).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_get_session()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid;
  v_is_admin boolean;
  v_admin record;
begin
  v_uid := auth.uid();

  if v_uid is null then
    return jsonb_build_object('authenticated', false, 'is_admin', false);
  end if;

  v_is_admin := public.is_admin(v_uid);

  if not v_is_admin then
    insert into public.audit_logs (actor_type, actor_id, action, result, metadata)
    values ('authenticated', v_uid, 'admin.access.denied', 'rejected', jsonb_build_object('reason','not_admin'));
    return jsonb_build_object('authenticated', true, 'is_admin', false);
  end if;

  select id, name into v_admin from public.admins where auth_user_id = v_uid;

  return jsonb_build_object(
    'authenticated', true,
    'is_admin', true,
    'admin', jsonb_build_object('id', v_admin.id, 'name', v_admin.name)
  );
end;
$function$
;

ALTER FUNCTION public.admin_get_session() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_get_session() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_session() TO authenticated, postgres, service_role;

COMMIT;
