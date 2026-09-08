-- ============================================================================
-- Account Access Control — Phase A — schema, helpers, admin mutation RPCs
-- ============================================================================
--
-- SCOPE: two new tables (coach_access_control, student_access_control), two
-- new RLS-facing helper functions (coach_has_access, student_portal_has_access),
-- one new identity-status RPC (get_my_account_status), and six new admin-only
-- mutation RPCs (admin_block_coach, admin_unblock_coach, admin_deactivate_coach,
-- admin_reactivate_coach, admin_block_student, admin_unblock_student).
--
-- Touches NOTHING else: no existing table (coaches, coach_data, students,
-- classes, packages, courts, expenses, messages, invites, student_auth,
-- admins, audit_logs, coach_invites) is altered — not their columns, not
-- their RLS policies, not their grants. No existing function (is_admin,
-- admin_get_session, admin_list_coaches, admin_get_coach, admin_list_students,
-- admin_get_student, create_student_invite, mark_coach_messages_read,
-- accept_student_invite, mark_student_messages_read, update_my_student_profile,
-- get_student_invite_preview, admin_create_coach_invite, admin_list_coach_invites,
-- admin_revoke_coach_invite, get_coach_invite_preview, coach_invite_is_active)
-- is modified. This migration only reads coaches/student_auth (existence
-- checks + identity-row locking, same pattern already used by admin_get_coach/
-- admin_get_student/create_student_invite) and inserts into audit_logs (same
-- pattern as every existing admin RPC).
--
-- Product semantics (approved, Account Access Control Phase 2/2.1):
--   Coach states:   active | blocked | deactivated
--   Student Portal states (student_auth identity, NOT the business student
--   record inside coach_data): active | blocked
--   blocked    = temporary, reversible administrative suspension
--   deactivated = administratively closed account, no data ever deleted
--   Absence of a row in the relevant *_access_control table means 'active'.
--   unblock only ever handles blocked->active. reactivate only ever handles
--   deactivated->active. Neither silently substitutes for the other — see
--   the explicit guards inside each RPC below.
--   Blocking a coach does NOT block their existing students. Blocking a
--   student blocks only their Student Portal account, never their business
--   record or the coach's ability to manage them. No physical deletion of
--   any coach/student business data in any of this.
--
-- Design decisions locked in for Phase A:
--   - No history/log table here. coach_access_control/student_access_control
--     hold ONLY the current restriction (if any) for a coach/student —
--     historical transitions live exclusively in audit_logs, avoiding a
--     second source of truth for the same information.
--   - "Absence of row = active" is taken literally: returning to `active`
--     DELETEs the row rather than upserting status='active'. The table's
--     row count is therefore always exactly "how many accounts are
--     currently restricted" — audit_logs remains the only place a
--     "returned to active" timestamp/actor is recorded.
--   - coach_id / student_auth_id / status_changed_by carry NO foreign key,
--     deliberately — identical reasoning already established for
--     audit_logs.actor_id/coach_id (Admin-1) and coach_invites.invited_by/
--     revoked_by/accepted_auth_user_id (Admin-4A): an access-control record
--     must survive the deletion of the account it restricts, never be
--     nulled or cascaded away as a side effect of an unrelated change.
--     status_changed_by stores admins.id (the admin identity's own
--     surrogate PK, never auth.uid()) — same convention the rest of the
--     Admin schema already uses.
--   - coach_has_access(uuid) / student_portal_has_access(uuid) are designed
--     to be called from RLS policies added in a LATER phase (Phase C) —
--     this migration does not touch any policy, but the helpers are built
--     SECURITY DEFINER, OWNER TO postgres, SET search_path TO '', and
--     granted EXECUTE to `authenticated` (unlike is_admin(), which is only
--     ever called from within other SECURITY DEFINER RPCs and therefore
--     never needed an authenticated grant) — a policy's USING/WITH CHECK
--     expression evaluates as the querying role, so `authenticated` must
--     itself hold EXECUTE on any function it calls from inside a policy,
--     even though that function's BODY then runs as its owner (postgres),
--     bypassing coach_access_control/student_access_control's own RLS for
--     that internal read. Neither new table uses FORCE ROW LEVEL SECURITY —
--     required for that owner-bypass to work at all, matching every other
--     table in this schema.
--   - Concurrency: every one of the six admin mutation RPCs locks the
--     AUTHORITATIVE identity row first — `coaches` for coach transitions,
--     `student_auth` for student transitions — via SELECT ... FOR UPDATE.
--     That row is guaranteed to exist independently of the optional
--     *_access_control row, so it is what actually serializes concurrent
--     transitions for the same coach/student; a lock attempted directly on
--     *_access_control would not serialize anything when that row does not
--     exist yet (verified: an earlier draft of this design relied on
--     SELECT ... FOR UPDATE on coach_access_control + INSERT ... ON
--     CONFLICT DO UPDATE alone, which does NOT prevent two concurrent
--     transitions — e.g. deactivate and block — from both observing "no
--     row" and one unconditionally overwriting the other's result,
--     producing an invalid deactivated->blocked jump; this migration's
--     locking corrects that). Once the identity row is locked, reading
--     *_access_control's current status is race-free — no other
--     transition for that same coach/student can be in flight — so the
--     transition-validity guards below (reject/idempotent/proceed) are
--     evaluated against a truthful, stable value, and INSERT ... ON
--     CONFLICT DO UPDATE / DELETE only ever run after that validation.
--   - Idempotency: calling a transition RPC when the account is ALREADY at
--     the target state returns {ok:true, already_X:true} and performs no
--     write and no audit_logs insert (nothing changed) — same idiom already
--     established by admin_revoke_coach_invite. Calling a transition RPC
--     from a state it does not apply to (unblock on a deactivated account,
--     reactivate on a merely-blocked one, block on a deactivated one)
--     returns a structured {ok:false, error:...} rejection and IS logged to
--     audit_logs (result 'rejected') — a rejected attempt is itself a
--     meaningful signal, same idiom as admin_revoke_coach_invite's
--     already_accepted rejection.
--
-- Every function here follows the exact pattern already used by every
-- existing admin_* RPC (is_admin/admin_get_session/admin_list_coaches/
-- admin_get_coach/admin_list_students/admin_get_student/
-- admin_create_coach_invite/admin_list_coach_invites/
-- admin_revoke_coach_invite): SECURITY DEFINER, OWNER TO postgres,
-- SET search_path TO '', REVOKE ALL ... FROM PUBLIC, anon, authenticated
-- before granting exactly the roles that need it.
--
-- Wrapped in a single transaction. Idempotent (CREATE TABLE IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION, IF NOT EXISTS on indexes) — safe to re-run.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. coach_access_control
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.coach_access_control (
  coach_id           uuid PRIMARY KEY,
  status             text NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','blocked','deactivated')),
  status_reason      text,
  status_changed_at  timestamptz NOT NULL DEFAULT now(),
  status_changed_by  uuid
);

ALTER TABLE public.coach_access_control ENABLE ROW LEVEL SECURITY;

-- No policies, intentionally — see file header. Zero table grants either,
-- not even SELECT (unlike invites/student_auth, which grant SELECT to back
-- a real policy — this table has none). Mirrors admins/audit_logs/
-- coach_invites exactly.
REVOKE ALL ON public.coach_access_control FROM anon;
REVOKE ALL ON public.coach_access_control FROM authenticated;

-- ============================================================================
-- 2. student_access_control
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.student_access_control (
  student_auth_id    uuid PRIMARY KEY,
  status             text NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','blocked')),
  status_reason      text,
  status_changed_at  timestamptz NOT NULL DEFAULT now(),
  status_changed_by  uuid
);

ALTER TABLE public.student_access_control ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.student_access_control FROM anon;
REVOKE ALL ON public.student_access_control FROM authenticated;

-- ============================================================================
-- 3. coach_has_access(uuid) — RLS-facing helper (wired into policies in a
-- later phase). SECURITY DEFINER is required here, not optional: a policy
-- expression evaluates as the querying role (authenticated), so an
-- INVOKER-security helper would have its internal read of
-- coach_access_control denied by that same table's own zero grants.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.coach_has_access(p_coach_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.coach_access_control
    WHERE coach_id = p_coach_id AND status <> 'active'
  );
$function$
;

ALTER FUNCTION public.coach_has_access(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.coach_has_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_has_access(uuid) TO authenticated, postgres, service_role;

-- ============================================================================
-- 4. student_portal_has_access(uuid) — same rationale as coach_has_access.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.student_portal_has_access(p_student_auth_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.student_access_control
    WHERE student_auth_id = p_student_auth_id AND status <> 'active'
  );
$function$
;

ALTER FUNCTION public.student_portal_has_access(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.student_portal_has_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_portal_has_access(uuid) TO authenticated, postgres, service_role;

-- ============================================================================
-- 5. get_my_account_status() — identity-scoped status read for the
-- frontend (resolveSession, in a later phase). No parameters: auth.uid()
-- only, nobody can probe another identity's status. coach_status/
-- student_status are null when the caller has no row at all in
-- coaches/student_auth respectively (does not apply to them), 'active'
-- when they do but have no restriction row, or the restricted value.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_my_account_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid;
  v_coach_status text;
  v_student_status text;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'get_my_account_status: no authenticated user'
      using errcode = 'P0001';
  end if;

  select status into v_coach_status
  from public.coach_access_control
  where coach_id = v_uid;

  if v_coach_status is null and exists(select 1 from public.coaches where id = v_uid) then
    v_coach_status := 'active';
  end if;

  select status into v_student_status
  from public.student_access_control
  where student_auth_id = v_uid;

  if v_student_status is null and exists(select 1 from public.student_auth where id = v_uid) then
    v_student_status := 'active';
  end if;

  return jsonb_build_object('coach_status', v_coach_status, 'student_status', v_student_status);
end;
$function$
;

ALTER FUNCTION public.get_my_account_status() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_my_account_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_account_status() TO authenticated, postgres, service_role;

-- ============================================================================
-- 6. admin_block_coach — active/no-row -> blocked. Idempotent if already
-- blocked. Rejects (no mutation) if deactivated.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_block_coach(p_coach_id uuid, p_reason text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid;
  v_admin_id uuid;
  v_current_status text;
  v_locked_id uuid;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'admin_block_coach: no authenticated user'
      using errcode = 'P0001';
  end if;

  if not public.is_admin(v_uid) then
    raise exception 'admin_block_coach: not authorized'
      using errcode = 'P0001';
  end if;

  select id into v_admin_id from public.admins where auth_user_id = v_uid;

  if p_coach_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_parameter');
  end if;

  -- Lock the authoritative identity row first — coaches.id is guaranteed to
  -- exist independently of coach_access_control (optional, absent by
  -- default). This is what actually serializes concurrent transitions for
  -- this coach_id; any other admin_*_coach RPC for the same coach blocks
  -- here until this transaction commits or rolls back, so the read below
  -- is race-free.
  select id into v_locked_id from public.coaches where id = p_coach_id for update;

  if v_locked_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select status into v_current_status
  from public.coach_access_control
  where coach_id = p_coach_id;

  if v_current_status = 'deactivated' then
    insert into public.audit_logs (actor_type, actor_id, action, target_type, target_id, coach_id, result, metadata)
    values ('admin', v_admin_id, 'admin.coach.block', 'coach', p_coach_id::text, p_coach_id, 'rejected', jsonb_build_object('reason', p_reason, 'previous_status', 'deactivated'));
    return jsonb_build_object('ok', false, 'error', 'is_deactivated');
  end if;

  if v_current_status = 'blocked' then
    return jsonb_build_object('ok', true, 'already_blocked', true);
  end if;

  insert into public.coach_access_control (coach_id, status, status_reason, status_changed_at, status_changed_by)
  values (p_coach_id, 'blocked', p_reason, now(), v_admin_id)
  on conflict (coach_id) do update
    set status = 'blocked',
        status_reason = excluded.status_reason,
        status_changed_at = now(),
        status_changed_by = excluded.status_changed_by;

  insert into public.audit_logs (actor_type, actor_id, action, target_type, target_id, coach_id, result, metadata)
  values ('admin', v_admin_id, 'admin.coach.block', 'coach', p_coach_id::text, p_coach_id, 'success', jsonb_build_object('reason', p_reason, 'previous_status', coalesce(v_current_status,'active')));

  return jsonb_build_object('ok', true, 'already_blocked', false);
end;
$function$
;

ALTER FUNCTION public.admin_block_coach(uuid, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_block_coach(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_block_coach(uuid, text) TO authenticated, postgres, service_role;

-- ============================================================================
-- 7. admin_unblock_coach — blocked -> active (row deleted). Idempotent if
-- already active/no row. Rejects (no mutation) if deactivated — unblock
-- must never silently reactivate.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_unblock_coach(p_coach_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid;
  v_admin_id uuid;
  v_current_status text;
  v_locked_id uuid;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'admin_unblock_coach: no authenticated user'
      using errcode = 'P0001';
  end if;

  if not public.is_admin(v_uid) then
    raise exception 'admin_unblock_coach: not authorized'
      using errcode = 'P0001';
  end if;

  select id into v_admin_id from public.admins where auth_user_id = v_uid;

  if p_coach_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_parameter');
  end if;

  select id into v_locked_id from public.coaches where id = p_coach_id for update;

  if v_locked_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select status into v_current_status
  from public.coach_access_control
  where coach_id = p_coach_id;

  if v_current_status = 'deactivated' then
    insert into public.audit_logs (actor_type, actor_id, action, target_type, target_id, coach_id, result, metadata)
    values ('admin', v_admin_id, 'admin.coach.unblock', 'coach', p_coach_id::text, p_coach_id, 'rejected', jsonb_build_object('previous_status', 'deactivated'));
    return jsonb_build_object('ok', false, 'error', 'is_deactivated');
  end if;

  if v_current_status is null or v_current_status = 'active' then
    return jsonb_build_object('ok', true, 'already_active', true);
  end if;

  -- Return to active = DELETE, not an upsert to status='active' — see file
  -- header: "absence of row = active" is taken literally.
  delete from public.coach_access_control where coach_id = p_coach_id;

  insert into public.audit_logs (actor_type, actor_id, action, target_type, target_id, coach_id, result, metadata)
  values ('admin', v_admin_id, 'admin.coach.unblock', 'coach', p_coach_id::text, p_coach_id, 'success', jsonb_build_object('previous_status', v_current_status));

  return jsonb_build_object('ok', true, 'already_active', false);
end;
$function$
;

ALTER FUNCTION public.admin_unblock_coach(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_unblock_coach(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unblock_coach(uuid) TO authenticated, postgres, service_role;

-- ============================================================================
-- 8. admin_deactivate_coach — active/blocked/no-row -> deactivated.
-- Idempotent if already deactivated. No rejection branch — allowed from
-- every other state.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_deactivate_coach(p_coach_id uuid, p_reason text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid;
  v_admin_id uuid;
  v_current_status text;
  v_locked_id uuid;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'admin_deactivate_coach: no authenticated user'
      using errcode = 'P0001';
  end if;

  if not public.is_admin(v_uid) then
    raise exception 'admin_deactivate_coach: not authorized'
      using errcode = 'P0001';
  end if;

  select id into v_admin_id from public.admins where auth_user_id = v_uid;

  if p_coach_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_parameter');
  end if;

  select id into v_locked_id from public.coaches where id = p_coach_id for update;

  if v_locked_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select status into v_current_status
  from public.coach_access_control
  where coach_id = p_coach_id;

  if v_current_status = 'deactivated' then
    return jsonb_build_object('ok', true, 'already_deactivated', true);
  end if;

  insert into public.coach_access_control (coach_id, status, status_reason, status_changed_at, status_changed_by)
  values (p_coach_id, 'deactivated', p_reason, now(), v_admin_id)
  on conflict (coach_id) do update
    set status = 'deactivated',
        status_reason = excluded.status_reason,
        status_changed_at = now(),
        status_changed_by = excluded.status_changed_by;

  insert into public.audit_logs (actor_type, actor_id, action, target_type, target_id, coach_id, result, metadata)
  values ('admin', v_admin_id, 'admin.coach.deactivate', 'coach', p_coach_id::text, p_coach_id, 'success', jsonb_build_object('reason', p_reason, 'previous_status', coalesce(v_current_status,'active')));

  return jsonb_build_object('ok', true, 'already_deactivated', false);
end;
$function$
;

ALTER FUNCTION public.admin_deactivate_coach(uuid, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_deactivate_coach(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_deactivate_coach(uuid, text) TO authenticated, postgres, service_role;

-- ============================================================================
-- 9. admin_reactivate_coach — deactivated -> active (row deleted).
-- Idempotent if already active/no row. Rejects (no mutation) if merely
-- blocked — reactivate must never substitute for unblock.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_reactivate_coach(p_coach_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid;
  v_admin_id uuid;
  v_current_status text;
  v_locked_id uuid;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'admin_reactivate_coach: no authenticated user'
      using errcode = 'P0001';
  end if;

  if not public.is_admin(v_uid) then
    raise exception 'admin_reactivate_coach: not authorized'
      using errcode = 'P0001';
  end if;

  select id into v_admin_id from public.admins where auth_user_id = v_uid;

  if p_coach_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_parameter');
  end if;

  select id into v_locked_id from public.coaches where id = p_coach_id for update;

  if v_locked_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select status into v_current_status
  from public.coach_access_control
  where coach_id = p_coach_id;

  if v_current_status is null or v_current_status = 'active' then
    return jsonb_build_object('ok', true, 'already_active', true);
  end if;

  if v_current_status = 'blocked' then
    insert into public.audit_logs (actor_type, actor_id, action, target_type, target_id, coach_id, result, metadata)
    values ('admin', v_admin_id, 'admin.coach.reactivate', 'coach', p_coach_id::text, p_coach_id, 'rejected', jsonb_build_object('previous_status', 'blocked'));
    return jsonb_build_object('ok', false, 'error', 'not_deactivated');
  end if;

  delete from public.coach_access_control where coach_id = p_coach_id;

  insert into public.audit_logs (actor_type, actor_id, action, target_type, target_id, coach_id, result, metadata)
  values ('admin', v_admin_id, 'admin.coach.reactivate', 'coach', p_coach_id::text, p_coach_id, 'success', jsonb_build_object('previous_status', 'deactivated'));

  return jsonb_build_object('ok', true, 'already_active', false);
end;
$function$
;

ALTER FUNCTION public.admin_reactivate_coach(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_reactivate_coach(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reactivate_coach(uuid) TO authenticated, postgres, service_role;

-- ============================================================================
-- 10. admin_block_student — active/no-row -> blocked. Identity is
-- (p_coach_id, p_student_id), resolved to student_auth.id internally — the
-- Admin frontend has no way to obtain a raw student_auth.id today
-- (admin_get_student never returns it), and this mirrors the addressing
-- scheme admin_list_students/admin_get_student already use. Locking happens
-- on that same resolving SELECT (student_auth is the stable identity row
-- here, equivalent to coaches on the coach side).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_block_student(p_coach_id uuid, p_student_id bigint, p_reason text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid;
  v_admin_id uuid;
  v_student_auth_id uuid;
  v_current_status text;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'admin_block_student: no authenticated user'
      using errcode = 'P0001';
  end if;

  if not public.is_admin(v_uid) then
    raise exception 'admin_block_student: not authorized'
      using errcode = 'P0001';
  end if;

  select id into v_admin_id from public.admins where auth_user_id = v_uid;

  if p_coach_id is null or p_student_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_parameter');
  end if;

  select id into v_student_auth_id
  from public.student_auth
  where coach_id = p_coach_id and student_id = p_student_id
  for update;

  if v_student_auth_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select status into v_current_status
  from public.student_access_control
  where student_auth_id = v_student_auth_id;

  if v_current_status = 'blocked' then
    return jsonb_build_object('ok', true, 'already_blocked', true);
  end if;

  insert into public.student_access_control (student_auth_id, status, status_reason, status_changed_at, status_changed_by)
  values (v_student_auth_id, 'blocked', p_reason, now(), v_admin_id)
  on conflict (student_auth_id) do update
    set status = 'blocked',
        status_reason = excluded.status_reason,
        status_changed_at = now(),
        status_changed_by = excluded.status_changed_by;

  insert into public.audit_logs (actor_type, actor_id, action, target_type, target_id, coach_id, result, metadata)
  values ('admin', v_admin_id, 'admin.student.block', 'student', p_coach_id::text || ':' || p_student_id::text, p_coach_id, 'success', jsonb_build_object('reason', p_reason));

  return jsonb_build_object('ok', true, 'already_blocked', false);
end;
$function$
;

ALTER FUNCTION public.admin_block_student(uuid, bigint, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_block_student(uuid, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_block_student(uuid, bigint, text) TO authenticated, postgres, service_role;

-- ============================================================================
-- 11. admin_unblock_student — blocked -> active (row deleted). Idempotent
-- if already active/no row.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_unblock_student(p_coach_id uuid, p_student_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid;
  v_admin_id uuid;
  v_student_auth_id uuid;
  v_current_status text;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'admin_unblock_student: no authenticated user'
      using errcode = 'P0001';
  end if;

  if not public.is_admin(v_uid) then
    raise exception 'admin_unblock_student: not authorized'
      using errcode = 'P0001';
  end if;

  select id into v_admin_id from public.admins where auth_user_id = v_uid;

  if p_coach_id is null or p_student_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_parameter');
  end if;

  select id into v_student_auth_id
  from public.student_auth
  where coach_id = p_coach_id and student_id = p_student_id
  for update;

  if v_student_auth_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select status into v_current_status
  from public.student_access_control
  where student_auth_id = v_student_auth_id;

  if v_current_status is null or v_current_status = 'active' then
    return jsonb_build_object('ok', true, 'already_active', true);
  end if;

  delete from public.student_access_control where student_auth_id = v_student_auth_id;

  insert into public.audit_logs (actor_type, actor_id, action, target_type, target_id, coach_id, result, metadata)
  values ('admin', v_admin_id, 'admin.student.unblock', 'student', p_coach_id::text || ':' || p_student_id::text, p_coach_id, 'success', '{}'::jsonb);

  return jsonb_build_object('ok', true, 'already_active', false);
end;
$function$
;

ALTER FUNCTION public.admin_unblock_student(uuid, bigint) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_unblock_student(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unblock_student(uuid, bigint) TO authenticated, postgres, service_role;

COMMIT;
