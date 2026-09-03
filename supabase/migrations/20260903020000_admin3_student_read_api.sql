-- ============================================================================
-- Admin-3, Etapa 1 — read-only admin RPCs for the Alumnos (Students) module
-- ============================================================================
--
-- SCOPE: exclusively two new functions (admin_list_students, admin_get_student)
-- plus their owner/grants. Does NOT touch any existing table, policy, RLS
-- setting, or index — coach_data/coaches/student_auth/invites/messages are
-- all read-only from here, never written except the audit_logs INSERTs these
-- two functions make themselves. No admin RLS policy is added to any
-- business table — same non-goal as Admin-2.
--
-- Both functions: SECURITY DEFINER, owner postgres, search_path='', and
-- REVOKE ALL ... FROM PUBLIC, anon, authenticated before granting exactly
-- {authenticated, postgres, service_role} — same pattern as Admin-2.
--
-- Student identity is (coach_id, student_id), never student_id alone —
-- confirmed non-globally-unique (client-generated via Date.now(), one array
-- per coach in coach_data.data_key='students'). admin_get_student takes both
-- as separate parameters; the frontend route is /admin/students/:coachId/:studentId.
--
-- Production data check (2026-09-03, 70 students / 11 coaches) confirmed:
--   - id is always a JSON number, never missing/null/non-bigint, zero
--     duplicate (coach_id, student_id) pairs — admin_get_student therefore
--     uses a plain LIMIT 1 with no ordinality tie-break.
--   - status is always a JSON string (only "active" currently in use, but
--     the field itself is real and coach-settable — safe to filter on).
--   - familyId: legitimately absent/null most of the time; 2 rows reference
--     a familyId that does not resolve against that coach's families array
--     — admin_get_student/admin_list_students treat an unresolved familyId
--     as "no family" (null), never an error.
--   - combos is always a JSON array — never read or returned by either
--     function regardless (out of scope per approved ADMIN-3 scope: no
--     classes, no payments, no financial detail).
--   - orphan_student_auth_count is 0 today, but nothing in the student
--     deletion code path prevents one appearing later (student delete only
--     filters coach_data.students, never touches student_auth/invites/
--     messages) — admin_get_student's "not found" branch already handles
--     this by design, not fixed here.
--
-- coach_data.data_value is never returned to the caller — only individual
-- allowlisted fields extracted from it, and only derived booleans/counts for
-- portal/invite/message state. combos, invites.code, message text, and any
-- auth.users column beyond email_confirmed_at/last_sign_in_at are never
-- read or returned by either function.
--
-- p_search is never persisted anywhere, including audit_logs — only
-- query_type and result_count are logged, and only when a search was
-- actually performed (non-empty p_search), same as admin_list_coaches.
--
-- Wrapped in a single transaction.
-- ============================================================================

BEGIN;

-- ============================================================================
-- admin_list_students — server-side search/filter/pagination over every
-- coach's coach_data.data_key='students' array. Never returns combos, never
-- returns the raw array element.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_list_students(
  p_search text DEFAULT NULL,
  p_coach_id uuid DEFAULT NULL,
  p_portal boolean DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit int DEFAULT 25,
  p_offset int DEFAULT 0
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid;
  v_admin_id uuid;
  v_search text;
  v_status text;
  v_limit int;
  v_offset int;
  v_total bigint;
  v_rows jsonb;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'admin_list_students: no authenticated user'
      using errcode = 'P0001';
  end if;

  if not public.is_admin(v_uid) then
    raise exception 'admin_list_students: not authorized'
      using errcode = 'P0001';
  end if;

  -- Normalize once: NULL, '', and whitespace-only all collapse to NULL —
  -- "no filter" / "no search logged", never persisted in either raw form.
  v_search := nullif(trim(p_search), '');
  v_status := nullif(trim(p_status), '');

  -- Clamp defensively: 1..100, never negative offset.
  v_limit := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  -- Rows with a missing/empty/non-numeric id are excluded entirely — they
  -- can never be addressed by admin_get_student's (coach_id, student_id)
  -- route, so listing them would only produce dead links. Confirmed absent
  -- in production as of the 2026-09-03 data check, kept as a defensive
  -- guard rather than an assumption.
  select count(*)
  into v_total
  from public.coach_data cd
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(cd.data_value) = 'array' then cd.data_value else '[]'::jsonb end
  ) as elem
  where cd.data_key = 'students'
    and (elem->>'id') ~ '^[0-9]{1,18}$'
    and (p_coach_id is null or cd.coach_id = p_coach_id)
    and (v_status is null or elem->>'status' = v_status)
    and (
      v_search is null or
      nullif(elem->>'name','') ilike '%' || v_search || '%' or
      nullif(elem->>'email','') ilike '%' || v_search || '%'
    )
    and (
      p_portal is null or
      exists(
        select 1 from public.student_auth sa
        where sa.coach_id = cd.coach_id and sa.student_id::text = elem->>'id'
      ) = p_portal
    );

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  into v_rows
  from (
    select
      cd.coach_id,
      c.name as coach_name,
      (elem->>'id')::bigint as student_id,
      nullif(elem->>'name','') as name,
      nullif(elem->>'email','') as email,
      nullif(elem->>'phone','') as phone,
      elem->>'status' as status,
      exists(
        select 1 from public.student_auth sa
        where sa.coach_id = cd.coach_id and sa.student_id::text = elem->>'id'
      ) as has_portal,
      (
        select nullif(f_elem->>'name','')
        from public.coach_data fd
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(fd.data_value) = 'array' then fd.data_value else '[]'::jsonb end
        ) as f_elem
        where fd.coach_id = cd.coach_id and fd.data_key = 'families'
          and f_elem->>'id' = nullif(elem->>'familyId','')
        limit 1
      ) as family_name
    from public.coach_data cd
    join public.coaches c on c.id = cd.coach_id
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(cd.data_value) = 'array' then cd.data_value else '[]'::jsonb end
    ) as elem
    where cd.data_key = 'students'
      and (elem->>'id') ~ '^[0-9]{1,18}$'
      and (p_coach_id is null or cd.coach_id = p_coach_id)
      and (v_status is null or elem->>'status' = v_status)
      and (
        v_search is null or
        nullif(elem->>'name','') ilike '%' || v_search || '%' or
        nullif(elem->>'email','') ilike '%' || v_search || '%'
      )
      and (
        p_portal is null or
        exists(
          select 1 from public.student_auth sa
          where sa.coach_id = cd.coach_id and sa.student_id::text = elem->>'id'
        ) = p_portal
      )
    order by c.name asc, nullif(elem->>'name','') asc
    limit v_limit offset v_offset
  ) t;

  -- Only log when a real search was performed — never v_search/p_search,
  -- only the fact that a search happened and how many rows it matched.
  if v_search is not null then
    select id into v_admin_id from public.admins where auth_user_id = v_uid;

    insert into public.audit_logs (actor_type, actor_id, action, result, metadata)
    values (
      'admin', v_admin_id, 'admin.students.search', 'success',
      jsonb_build_object('query_type', 'name_or_email', 'result_count', v_total)
    );
  end if;

  return jsonb_build_object('ok', true, 'total', v_total, 'students', v_rows);
end;
$function$
;

ALTER FUNCTION public.admin_list_students(text, uuid, boolean, text, int, int) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_list_students(text, uuid, boolean, text, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_students(text, uuid, boolean, text, int, int) TO authenticated, postgres, service_role;

-- ============================================================================
-- admin_get_student — read-only student detail. Identity is the composite
-- (p_coach_id, p_student_id) — never p_student_id alone. Never returns
-- combos, invites.code, or message content.
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
  v_email_confirmed_at timestamptz;
  v_last_sign_in_at timestamptz;
  v_invite_active boolean;
  v_message_count int;
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

  v_email_confirmed_at := null;
  v_last_sign_in_at := null;
  if v_has_portal then
    select au.email_confirmed_at, au.last_sign_in_at
    into v_email_confirmed_at, v_last_sign_in_at
    from public.student_auth sa
    join auth.users au on au.id = sa.id
    where sa.coach_id = p_coach_id and sa.student_id = p_student_id;
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
    'diagnostics', jsonb_build_object('invite_active', v_invite_active, 'message_count', v_message_count)
  );
end;
$function$
;

ALTER FUNCTION public.admin_get_student(uuid, bigint) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_get_student(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_student(uuid, bigint) TO authenticated, postgres, service_role;

COMMIT;
