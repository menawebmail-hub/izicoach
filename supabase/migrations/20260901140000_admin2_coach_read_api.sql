-- ============================================================================
-- Admin-2, Etapa 1 — read-only admin RPCs for the Coaches module
-- ============================================================================
--
-- SCOPE: exclusively two new functions (admin_list_coaches, admin_get_coach)
-- plus their owner/grants. Does NOT touch any existing table, policy, RLS
-- setting, or index — coaches/coach_data/invites/student_auth/messages/
-- admins/audit_logs are all read-only from here, never written except the
-- audit_logs INSERTs these two functions make themselves. is_admin()'s own
-- grants are untouched.
--
-- Both functions: SECURITY DEFINER, owner postgres, search_path='', and
-- REVOKE ALL ... FROM PUBLIC, anon, authenticated before granting exactly
-- {authenticated, postgres, service_role} — same lesson from Admin-1.
--
-- coach_data.data_value is never returned to the caller — only integer
-- counts derived server-side via jsonb_array_length, defensively guarded
-- against a missing row, an empty array, or a value that isn't a JSON array
-- at all (never lets a malformed data_value break the whole call).
--
-- p_search is never persisted anywhere, including audit_logs — only
-- query_type and result_count are logged, and only when a search was
-- actually performed (non-empty p_search).
--
-- Wrapped in a single transaction.
-- ============================================================================

BEGIN;

-- ============================================================================
-- admin_list_coaches — server-side search/filter/pagination over
-- public.coaches only. Never touches auth.users.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_list_coaches(
  p_search text DEFAULT NULL,
  p_onboarded boolean DEFAULT NULL,
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
  v_limit int;
  v_offset int;
  v_total bigint;
  v_rows jsonb;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'admin_list_coaches: no authenticated user'
      using errcode = 'P0001';
  end if;

  if not public.is_admin(v_uid) then
    raise exception 'admin_list_coaches: not authorized'
      using errcode = 'P0001';
  end if;

  -- Normalize once: NULL, '', and whitespace-only all collapse to NULL —
  -- "no filter" / "no search logged", never persisted in either raw form.
  v_search := nullif(trim(p_search), '');

  -- Clamp defensively: 1..100, never negative offset.
  v_limit := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  select count(*)
  into v_total
  from public.coaches c
  where (p_onboarded is null or c.onboarded = p_onboarded)
    and (
      v_search is null or
      c.name ilike '%' || v_search || '%' or
      c.email ilike '%' || v_search || '%'
    );

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  into v_rows
  from (
    select c.id, c.name, c.email, c.onboarded, c.created_at
    from public.coaches c
    where (p_onboarded is null or c.onboarded = p_onboarded)
      and (
        v_search is null or
        c.name ilike '%' || v_search || '%' or
        c.email ilike '%' || v_search || '%'
      )
    order by c.created_at desc
    limit v_limit offset v_offset
  ) t;

  -- Only log when a real search was performed — never v_search/p_search,
  -- only the fact that a search happened and how many rows it matched.
  if v_search is not null then
    select id into v_admin_id from public.admins where auth_user_id = v_uid;

    insert into public.audit_logs (actor_type, actor_id, action, result, metadata)
    values (
      'admin', v_admin_id, 'admin.coaches.search', 'success',
      jsonb_build_object('query_type', 'name_or_email', 'result_count', v_total)
    );
  end if;

  return jsonb_build_object('ok', true, 'total', v_total, 'coaches', v_rows);
end;
$function$
;

ALTER FUNCTION public.admin_list_coaches(text, boolean, int, int) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_list_coaches(text, boolean, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_coaches(text, boolean, int, int) TO authenticated, postgres, service_role;

-- ============================================================================
-- admin_get_coach — read-only coach detail + server-computed counters.
-- Reads exactly two auth.users columns (email_confirmed_at, last_sign_in_at)
-- — never select *, never any other auth.users field.
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
    )
  );
end;
$function$
;

ALTER FUNCTION public.admin_get_coach(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_get_coach(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_coach(uuid) TO authenticated, postgres, service_role;

COMMIT;
