-- ============================================================================
-- Admin-4B — expose real account access status on the existing read RPCs
-- ============================================================================
--
-- SCOPE: exclusively CREATE OR REPLACE on the two existing functions
-- public.admin_get_coach(uuid) and public.admin_get_student(uuid,bigint).
-- Signatures, SECURITY DEFINER, search_path, the is_admin()/auth.uid()
-- guard, every existing audit_logs insert, every previously-returned field,
-- and the exact existing grants are all preserved unchanged — this
-- migration only adds a new top-level 'access' key to each function's
-- returned jsonb. No other table, policy, grant, or function (including the
-- six Account Access Control Phase A mutation RPCs — admin_block_coach/
-- admin_unblock_coach/admin_deactivate_coach/admin_reactivate_coach/
-- admin_block_student/admin_unblock_student — and the Phase C.2 RLS
-- policies) is touched here.
--
-- Why this is safe as a plain CREATE OR REPLACE: Postgres only preserves a
-- function's OID, owner, and existing grants across CREATE OR REPLACE when
-- BOTH the argument list AND the return type are unchanged from the
-- existing definition — changing either one is rejected by CREATE OR
-- REPLACE and requires DROP + CREATE instead, which would lose the
-- existing grants. Confirmed true here on both counts: the argument lists
-- (uuid) and (uuid, bigint) are byte-for-byte identical to the versions in
-- 20260901140000_admin2_coach_read_api.sql and
-- 20260903020000_admin3_student_read_api.sql, and both functions keep
-- returning jsonb, unchanged. The ALTER FUNCTION OWNER TO
-- / REVOKE ALL / GRANT EXECUTE block after each CREATE OR REPLACE below is
-- therefore not strictly required by Postgres, but is reasserted anyway —
-- reaffirming the exact existing grants, not adding new ones — because
-- every function-defining migration in this repo (Admin-1/2/3/4A, Account
-- Access Control Phase A) follows that same defensive pattern immediately
-- after every CREATE OR REPLACE FUNCTION.
--
-- coach_access_control / student_access_control (both from Account Access
-- Control Phase A) are read here for the first time by any admin-facing
-- RPC. Both functions already run SECURITY DEFINER owned by postgres, so
-- this read bypasses those two tables' own RLS (they carry no policies and
-- zero grants to authenticated/anon, same as admins/audit_logs) exactly the
-- way coach_has_access()/student_portal_has_access() already do from inside
-- RLS policies — no new access path is opened, this is the same owner-
-- bypass read pattern used everywhere else in this schema.
--
-- Status resolution — "absence of row = active" (the same convention Phase
-- A's own admin mutation RPCs and get_my_account_status() already use):
--   admin_get_coach:   no coach_access_control row -> access.status='active'
--                       row present -> its real status/reason/changed_at
--   admin_get_student: no student_auth row (no portal identity at all) ->
--                       access.available=false, access.status=null
--                       student_auth row present, no student_access_control
--                       row -> access.available=true, access.status='active'
--                       both rows present -> access.available=true, real
--                       status/reason/changed_at
--
-- Wrapped in a single transaction, matching every other migration here.
-- ============================================================================

BEGIN;

-- ============================================================================
-- admin_get_coach — unchanged behavior/fields, plus a new 'access' object
-- resolved from coach_access_control (Phase A). v_access_status/_reason/
-- _changed_at follow the same plpgsql idiom already used by every Phase A
-- admin mutation RPC: a SELECT ... INTO that matches zero rows leaves the
-- target variables NULL (no exception), then v_access_status is defaulted
-- to 'active' only when that happens — status_reason/status_changed_at are
-- correctly left NULL in that case, since there is no real change to report.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_get_coach(p_coach_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid;
  v_admin_id uuid;
  v_coach record;
  v_auth record;
  v_students_count int;
  v_classes_count int;
  v_portal_count int;
  v_invites_active int;
  v_invites_total int;
  v_access_status text;
  v_access_reason text;
  v_access_changed_at timestamptz;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'admin_get_coach: no authenticated user'
      using errcode = 'P0001';
  end if;

  if not public.is_admin(v_uid) then
    raise exception 'admin_get_coach: not authorized'
      using errcode = 'P0001';
  end if;

  select id into v_admin_id from public.admins where auth_user_id = v_uid;

  if p_coach_id is null then
    -- No target to attach — log with target_id/coach_id left null rather
    -- than inventing a placeholder value.
    insert into public.audit_logs (actor_type, actor_id, action, target_type, target_id, coach_id, result, metadata)
    values ('admin', v_admin_id, 'admin.coach.view', 'coach', null, null, 'error', jsonb_build_object('reason', 'invalid_parameter'));
    return jsonb_build_object('ok', false, 'error', 'invalid_parameter');
  end if;

  select id, name, email, phone, country, sport, onboarded, created_at
  into v_coach
  from public.coaches
  where id = p_coach_id;

  if not found then
    insert into public.audit_logs (actor_type, actor_id, action, target_type, target_id, coach_id, result, metadata)
    values ('admin', v_admin_id, 'admin.coach.view', 'coach', p_coach_id::text, p_coach_id, 'error', jsonb_build_object('reason', 'not_found'));
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select email_confirmed_at, last_sign_in_at
  into v_auth
  from auth.users
  where id = p_coach_id;

  -- Counters: never let a missing row, an empty array, or a malformed
  -- data_value break the call. coach_data.data_value itself is never
  -- returned — only the derived integer.
  select coalesce(
    (
      select case when jsonb_typeof(data_value) = 'array' then jsonb_array_length(data_value) else 0 end
      from public.coach_data
      where coach_id = p_coach_id and data_key = 'students'
    ),
    0
  ) into v_students_count;

  select coalesce(
    (
      select case when jsonb_typeof(data_value) = 'array' then jsonb_array_length(data_value) else 0 end
      from public.coach_data
      where coach_id = p_coach_id and data_key = 'classes'
    ),
    0
  ) into v_classes_count;

  select count(*) into v_portal_count
  from public.student_auth
  where coach_id = p_coach_id;

  select count(*) filter (where used = false), count(*)
  into v_invites_active, v_invites_total
  from public.invites
  where coach_id = p_coach_id;

  -- New in Admin-4B: real access status, sourced from Account Access
  -- Control Phase A's coach_access_control. Absence of a row means active.
  select status, status_reason, status_changed_at
  into v_access_status, v_access_reason, v_access_changed_at
  from public.coach_access_control
  where coach_id = p_coach_id;

  if v_access_status is null then
    v_access_status := 'active';
  end if;

  insert into public.audit_logs (actor_type, actor_id, action, target_type, target_id, coach_id, result, metadata)
  values ('admin', v_admin_id, 'admin.coach.view', 'coach', p_coach_id::text, p_coach_id, 'success', '{}'::jsonb);

  return jsonb_build_object(
    'ok', true,
    'coach', jsonb_build_object(
      'id', v_coach.id,
      'name', v_coach.name,
      'email', v_coach.email,
      'phone', v_coach.phone,
      'country', v_coach.country,
      'sport', v_coach.sport,
      'onboarded', v_coach.onboarded,
      'created_at', v_coach.created_at,
      'email_confirmed_at', v_auth.email_confirmed_at,
      'last_sign_in_at', v_auth.last_sign_in_at
    ),
    'counts', jsonb_build_object(
      'students', v_students_count,
      'class_definitions', v_classes_count,
      'students_with_portal', v_portal_count,
      'invites_active', v_invites_active,
      'invites_total', v_invites_total
    ),
    'access', jsonb_build_object(
      'status', v_access_status,
      'status_reason', v_access_reason,
      'status_changed_at', v_access_changed_at
    )
  );
end;
$function$
;

ALTER FUNCTION public.admin_get_coach(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_get_coach(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_coach(uuid) TO authenticated, postgres, service_role;

-- ============================================================================
-- admin_get_student — unchanged behavior/fields, plus a new 'access' object
-- resolved from student_access_control (Phase A) via student_auth.id. The
-- existing v_has_portal lookup is extended to also capture sa.id (needed to
-- address student_access_control, whose PK is student_auth_id, not the
-- composite (coach_id, student_id) this RPC is addressed by) — no new query
-- against student_auth is added, the existing one just selects one more
-- column.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_get_student(
  p_coach_id uuid,
  p_student_id bigint
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid;
  v_admin_id uuid;
  v_coach record;
  v_elem jsonb;
  v_name text;
  v_status text;
  v_email text;
  v_phone text;
  v_family_id_text text;
  v_family_resolved_id text;
  v_family_name text;
  v_has_portal boolean;
  v_student_auth_id uuid;
  v_email_confirmed_at timestamptz;
  v_last_sign_in_at timestamptz;
  v_invite_active boolean;
  v_message_count int;
  v_access_available boolean;
  v_access_status text;
  v_access_reason text;
  v_access_changed_at timestamptz;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'admin_get_student: no authenticated user'
      using errcode = 'P0001';
  end if;

  if not public.is_admin(v_uid) then
    raise exception 'admin_get_student: not authorized'
      using errcode = 'P0001';
  end if;

  select id into v_admin_id from public.admins where auth_user_id = v_uid;

  if p_coach_id is null or p_student_id is null then
    insert into public.audit_logs (actor_type, actor_id, action, target_type, target_id, coach_id, result, metadata)
    values ('admin', v_admin_id, 'admin.student.view', 'student', null, p_coach_id, 'error', jsonb_build_object('reason', 'invalid_parameter'));
    return jsonb_build_object('ok', false, 'error', 'invalid_parameter');
  end if;

  select id, name into v_coach
  from public.coaches
  where id = p_coach_id;

  if not found then
    insert into public.audit_logs (actor_type, actor_id, action, target_type, target_id, coach_id, result, metadata)
    values ('admin', v_admin_id, 'admin.student.view', 'student', p_coach_id::text || ':' || p_student_id::text, p_coach_id, 'error', jsonb_build_object('reason', 'coach_not_found'));
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- Zero duplicate (coach_id, student_id) pairs confirmed in production
  -- (2026-09-03 data check) — plain LIMIT 1, no ordinality tie-break needed.
  -- Also the expected path for an orphaned student_auth row navigated to
  -- directly: no matching element here just means "not found", not an error.
  select elem into v_elem
  from public.coach_data cd
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(cd.data_value) = 'array' then cd.data_value else '[]'::jsonb end
  ) as elem
  where cd.coach_id = p_coach_id
    and cd.data_key = 'students'
    and elem->>'id' = p_student_id::text
  limit 1;

  if v_elem is null then
    insert into public.audit_logs (actor_type, actor_id, action, target_type, target_id, coach_id, result, metadata)
    values ('admin', v_admin_id, 'admin.student.view', 'student', p_coach_id::text || ':' || p_student_id::text, p_coach_id, 'error', jsonb_build_object('reason', 'not_found'));
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_name := nullif(v_elem->>'name','');
  v_status := v_elem->>'status';
  v_email := nullif(v_elem->>'email','');
  v_phone := nullif(v_elem->>'phone','');
  v_family_id_text := nullif(v_elem->>'familyId','');

  -- Unresolved familyId (confirmed real: 2 rows in production) is treated
  -- as "no family", never an error.
  v_family_resolved_id := null;
  v_family_name := null;
  if v_family_id_text is not null then
    select f_elem->>'id', nullif(f_elem->>'name','')
    into v_family_resolved_id, v_family_name
    from public.coach_data fd
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(fd.data_value) = 'array' then fd.data_value else '[]'::jsonb end
    ) as f_elem
    where fd.coach_id = p_coach_id and fd.data_key = 'families'
      and f_elem->>'id' = v_family_id_text
    limit 1;
  end if;

  select exists(
    select 1 from public.student_auth sa
    where sa.coach_id = p_coach_id and sa.student_id = p_student_id
  ) into v_has_portal;

  v_student_auth_id := null;
  v_email_confirmed_at := null;
  v_last_sign_in_at := null;
  if v_has_portal then
    select sa.id, au.email_confirmed_at, au.last_sign_in_at
    into v_student_auth_id, v_email_confirmed_at, v_last_sign_in_at
    from public.student_auth sa
    join auth.users au on au.id = sa.id
    where sa.coach_id = p_coach_id and sa.student_id = p_student_id;
  end if;

  -- New in Admin-4B: real portal access status, sourced from Account Access
  -- Control Phase A's student_access_control, keyed by student_auth_id (not
  -- the (coach_id, student_id) composite this RPC is addressed by). No
  -- portal identity at all -> available=false, status=null. Portal exists
  -- with no control row -> available=true, status='active'. Control row
  -- present -> available=true, real status/reason/changed_at.
  v_access_available := v_has_portal;
  v_access_status := null;
  v_access_reason := null;
  v_access_changed_at := null;

  if v_has_portal then
    select status, status_reason, status_changed_at
    into v_access_status, v_access_reason, v_access_changed_at
    from public.student_access_control
    where student_auth_id = v_student_auth_id;

    if v_access_status is null then
      v_access_status := 'active';
    end if;
  end if;

  select exists(
    select 1 from public.invites i
    where i.coach_id = p_coach_id and i.student_id = p_student_id and i.used = false
  ) into v_invite_active;

  select count(*)
  into v_message_count
  from public.messages m
  where m.coach_id = p_coach_id and m.student_id = p_student_id;

  insert into public.audit_logs (actor_type, actor_id, action, target_type, target_id, coach_id, result, metadata)
  values ('admin', v_admin_id, 'admin.student.view', 'student', p_coach_id::text || ':' || p_student_id::text, p_coach_id, 'success', '{}'::jsonb);

  return jsonb_build_object(
    'ok', true,
    'student', jsonb_build_object(
      'student_id', p_student_id,
      'name', v_name,
      'status', v_status,
      'email', v_email,
      'phone', v_phone
    ),
    'coach', jsonb_build_object('id', v_coach.id, 'name', v_coach.name),
    'family', case when v_family_resolved_id is not null then jsonb_build_object('id', v_family_resolved_id, 'name', v_family_name) else null end,
    'portal', case when v_has_portal then jsonb_build_object('connected', true, 'email_confirmed_at', v_email_confirmed_at, 'last_sign_in_at', v_last_sign_in_at) else jsonb_build_object('connected', false) end,
    'diagnostics', jsonb_build_object('invite_active', v_invite_active, 'message_count', v_message_count),
    'access', jsonb_build_object(
      'available', v_access_available,
      'status', v_access_status,
      'status_reason', v_access_reason,
      'status_changed_at', v_access_changed_at
    )
  );
end;
$function$
;

ALTER FUNCTION public.admin_get_student(uuid, bigint) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_get_student(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_student(uuid, bigint) TO authenticated, postgres, service_role;

COMMIT;
