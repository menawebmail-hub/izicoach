-- ============================================================================
-- Account Access Control — Phase B — SECURITY DEFINER RPC enforcement
-- ============================================================================
--
-- SCOPE: redefines exactly six existing functions, via CREATE OR REPLACE
-- FUNCTION with their unchanged signatures — create_student_invite,
-- mark_coach_messages_read, get_student_invite_preview, accept_student_invite,
-- mark_student_messages_read, update_my_student_profile. Touches nothing
-- else: no table, no RLS policy (that is Phase C), no other function
-- (coach_has_access/student_portal_has_access/get_my_account_status/the six
-- admin_* mutation RPCs from Phase A are read-only dependencies here, never
-- modified; the dormant coach_invites RPCs from Admin-4A/4A.1 are untouched
-- and remain dormant — coach→student invitations, gated here, are the real
-- product flow). Does not modify supabase/migrations/
-- 20260907150000_account_access_control_phase_a.sql, which is already
-- applied to production and stays immutable.
--
-- Each of the six functions below is otherwise byte-for-byte identical to
-- its currently-deployed body (verified against
-- 20260831180000_security_hardening.sql and
-- 20260831200000_messages_rls_hardening.sql immediately before writing this
-- file) — the only addition in each is the access-control gate described
-- below, inserted at one precise point, using only the two Phase A helpers
-- (coach_has_access(uuid), student_portal_has_access(uuid)). Neither helper
-- exposes status_reason or any other detail beyond a plain boolean — none of
-- these six functions ever reads coach_access_control/student_access_control
-- directly.
--
-- Gates added:
--   create_student_invite      — coach_has_access(v_coach_id), right after
--     the existing v_is_coach check. A blocked/deactivated coach can no
--     longer generate new student invitations.
--   mark_coach_messages_read   — coach_has_access(v_uid), right after the
--     existing v_is_coach check.
--   accept_student_invite      — coach_has_access(v_coach_id) of the
--     INVITE's own coach (never the accepting party's identity), inserted
--     right after the invite row is resolved (after the existing
--     "if not found" check), before the email-match checks. Uses the
--     EXACT SAME uniform message this function already raises for every
--     other rejection reason — 'accept_student_invite: invalid invite' —
--     preserving its existing, deliberate anti-enumeration property: a
--     blocked/deactivated coach's pending invite must fail in a way
--     indistinguishable from a wrong code or a wrong email, never revealing
--     the coach's account state to whoever is trying to accept.
--   mark_student_messages_read — student_portal_has_access(v_uid), right
--     after student_auth is resolved.
--   update_my_student_profile  — student_portal_has_access(auth.uid()),
--     right after student_auth is resolved. This function has no v_uid
--     local variable in its existing body (it calls auth.uid() inline,
--     repeatedly, matching its own established style) — the new check
--     follows that exact existing convention rather than introducing a new
--     variable, to keep the diff to the smallest possible addition.
--   get_student_invite_preview — coach_has_access(v_coach_id), right after
--     v_coach_id is resolved (after the existing null check), before the
--     coach-name lookup. Returns the SAME {'valid': false} shape this
--     function already returns for every other invalid case — no new
--     field, no exception, preserving the exact existing return contract
--     the frontend already treats generically (`!data?.valid`).
--
-- Frontend compatibility (verified against every one of the six real call
-- sites in the repo before writing this migration, not assumed): all six
-- already handle their error/return value generically today — a bare
-- console.error, a generic string error flag, or a generic `!ok`/`!valid`
-- branch — none of them pattern-match on specific error text that a new
-- exception message could collide with (create_student_invite's frontend
-- only special-cases the literal substring "has no email on file", which
-- none of the new exception messages contain). No frontend file is touched
-- or needs to be for this migration to be safe to deploy.
--
-- Messaging rule ("an active student may not send NEW messages to a
-- blocked/deactivated coach") is deliberately NOT implemented here — no
-- function in this migration's scope sends messages (student message
-- sending is a direct INSERT against public.messages under the
-- student_insert_own_messages RLS policy, not a SECURITY DEFINER RPC).
-- That belongs entirely to Phase C, to avoid duplicating enforcement across
-- two layers for a rule that has exactly one real enforcement point.
--
-- Every function: SECURITY DEFINER, OWNER TO postgres, SET search_path TO
-- '', explicit schema qualification throughout (public.coach_has_access,
-- public.student_portal_has_access) — all reasserted below exactly as
-- currently deployed, never widened or narrowed. get_student_invite_preview
-- is the only one of the six granted to anon (unchanged, matches its
-- existing public-preview role); the other five keep their existing
-- authenticated/postgres/service_role-only grant.
--
-- Wrapped in a single transaction. CREATE OR REPLACE FUNCTION is naturally
-- idempotent — safe to re-run.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. create_student_invite — gate added: coach_has_access(v_coach_id)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_student_invite(p_student_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_coach_id uuid;
  v_is_coach boolean;
  v_students jsonb;
  v_match_count integer;
  v_student jsonb;
  v_invited_email text;
  v_existing record;
  v_new_code text;
  v_constraint_name text;
  v_attempt integer;
begin
  -- Fail closed: debe existir un usuario autenticado.
  if auth.uid() is null then
    raise exception 'create_student_invite: no authenticated user'
      using errcode = 'P0001';
  end if;

  -- El coach_id se obtiene exclusivamente de auth.uid().
  v_coach_id := auth.uid();

  -- Verificar que el usuario autenticado sea realmente un coach.
  select exists(
    select 1
    from public.coaches
    where id = v_coach_id
  )
  into v_is_coach;

  if not v_is_coach then
    raise exception
      'create_student_invite: auth.uid()=% is not a coach',
      v_coach_id
      using errcode = 'P0001';
  end if;

  -- Account Access Control Phase B: un coach bloqueado/desactivado no
  -- puede generar invitaciones nuevas.
  if not public.coach_has_access(v_coach_id) then
    raise exception 'create_student_invite: coach is blocked or deactivated'
      using errcode = 'P0001';
  end if;

  -- Obtener exclusivamente el roster de alumnos de este coach.
  select data_value
  into v_students
  from public.coach_data
  where coach_id = v_coach_id
    and data_key = 'students';

  if v_students is null then
    raise exception
      'create_student_invite: no students dataset for coach_id=%',
      v_coach_id
      using errcode = 'P0001';
  end if;

  -- El dataset debe ser un array JSON válido.
  if jsonb_typeof(v_students) <> 'array' then
    raise exception
      'create_student_invite: coach_data.students is not a JSON array for coach_id=%',
      v_coach_id
      using errcode = 'P0001';
  end if;

  -- El alumno debe existir exactamente una vez dentro del roster del coach.
  select count(*)
  into v_match_count
  from jsonb_array_elements(v_students) as elem
  where elem->>'id' = p_student_id::text;

  if v_match_count = 0 then
    raise exception
      'create_student_invite: student_id=% not found for coach_id=%',
      p_student_id,
      v_coach_id
      using errcode = 'P0001';
  elsif v_match_count > 1 then
    raise exception
      'create_student_invite: integrity error — student_id=% matched % entries for coach_id=%, expected exactly 1',
      p_student_id,
      v_match_count,
      v_coach_id
      using errcode = 'P0001';
  end if;

  select elem
  into v_student
  from jsonb_array_elements(v_students) as elem
  where elem->>'id' = p_student_id::text;

  -- El email sale exclusivamente del roster y se normaliza.
  v_invited_email :=
    nullif(lower(trim(v_student->>'email')), '');

  if v_invited_email is null then
    raise exception
      'create_student_invite: student_id=% has no email on file, cannot create invite',
      p_student_id
      using errcode = 'P0001';
  end if;

  -- Buscar una invitación activa existente.
  select code, invited_email
  into v_existing
  from public.invites
  where coach_id = v_coach_id
    and student_id = p_student_id
    and used = false;

  if v_existing.code is not null then

    -- Mismo email: reutilizar exactamente el mismo código.
    if lower(trim(v_existing.invited_email)) = v_invited_email then
      return jsonb_build_object(
        'ok', true,
        'code', v_existing.code
      );

    else
      -- El email cambió: invalidar la invitación anterior.
      update public.invites
      set used = true
      where code = v_existing.code;
    end if;

  end if;

  -- Generar código fuerte exclusivamente server-side.
  v_new_code := replace(gen_random_uuid()::text, '-', '');

  -- Máximo 3 intentos ante una extraordinaria colisión del código.
  for v_attempt in 1..3 loop

    begin

      insert into public.invites (
        code,
        coach_id,
        student_id,
        used,
        invited_email
      )
      values (
        v_new_code,
        v_coach_id,
        p_student_id,
        false,
        v_invited_email
      );

      return jsonb_build_object(
        'ok', true,
        'code', v_new_code
      );

    exception
      when unique_violation then

        get stacked diagnostics
          v_constraint_name = constraint_name;

        -- Carrera contra el índice que permite
        -- una sola invitación activa por alumno/coach.
        if v_constraint_name = 'invites_active_per_student' then

          select code, invited_email
          into v_existing
          from public.invites
          where coach_id = v_coach_id
            and student_id = p_student_id
            and used = false;

          -- Otra llamada creó correctamente la misma invitación.
          if v_existing.code is not null
             and lower(trim(v_existing.invited_email)) = v_invited_email then

            return jsonb_build_object(
              'ok', true,
              'code', v_existing.code
            );

          end if;

          -- Existe una invitación activa pero para otro email.
          if v_existing.code is not null then

            raise exception
              'create_student_invite: active invite exists for student_id=% with a different invited_email (expected %, found %)',
              p_student_id,
              v_invited_email,
              v_existing.invited_email
              using errcode = 'P0001';

          end if;

          -- El índice produjo la violación pero ya no encontramos
          -- la fila activa. Fallar cerrado.
          raise exception
            'create_student_invite: unique_violation on invites_active_per_student but no matching active invite found for student_id=%',
            p_student_id
            using errcode = 'P0001';

        elsif v_constraint_name = 'invites_pkey' then

          -- Colisión extraordinaria del código.
          -- Generar uno nuevo y volver a intentar.
          v_new_code :=
            replace(gen_random_uuid()::text, '-', '');

        else

          -- Nunca asumir que una constraint desconocida es segura.
          raise exception
            'create_student_invite: unexpected unique_violation on constraint % for student_id=%',
            v_constraint_name,
            p_student_id
            using errcode = 'P0001';

        end if;

    end;

  end loop;

  -- Nunca devolver éxito si no se consiguió un código válido.
  raise exception
    'create_student_invite: could not generate a unique invite code after 3 attempts for student_id=%',
    p_student_id
    using errcode = 'P0001';
end;
$function$
;

ALTER FUNCTION public.create_student_invite(bigint) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_student_invite(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_student_invite(bigint) TO authenticated, postgres, service_role;

-- ============================================================================
-- 2. get_student_invite_preview — gate added: coach_has_access(v_coach_id),
-- returning the same {'valid':false} shape, never an exception.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_student_invite_preview(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_coach_id uuid;
  v_coach_name text;
  v_coach_name_check text;
begin
  if p_code is null or p_code = '' then
    return jsonb_build_object('valid', false);
  end if;

  select i.coach_id
  into v_coach_id
  from public.invites i
  where i.code = p_code
    and i.used = false;

  if v_coach_id is null then
    return jsonb_build_object('valid', false);
  end if;

  -- Account Access Control Phase B: una invitación cuyo coach está
  -- bloqueado/desactivado nunca se muestra como aceptable — mismo shape de
  -- retorno que cualquier otro caso inválido, sin campo nuevo.
  if not public.coach_has_access(v_coach_id) then
    return jsonb_build_object('valid', false);
  end if;

  select c.name
  into v_coach_name
  from public.coaches c
  where c.id = v_coach_id;

  v_coach_name_check := nullif(trim(v_coach_name), '');

  if v_coach_name_check is null then
    return jsonb_build_object('valid', false);
  end if;

  return jsonb_build_object(
    'valid', true,
    'coach_name', v_coach_name
  );
end;
$function$
;

ALTER FUNCTION public.get_student_invite_preview(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_student_invite_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_invite_preview(text) TO anon, authenticated, postgres, service_role;

-- ============================================================================
-- 3. accept_student_invite — gate added: coach_has_access(v_coach_id) of
-- the invite's own coach, reusing the exact same uniform rejection message
-- this function already uses for every other case.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.accept_student_invite(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid;
  v_coach_id uuid;
  v_student_id bigint;
  v_invited_email text;
  v_used boolean;
  v_auth_email text;
  v_email_confirmed_at timestamptz;
  v_already_mine boolean;
  v_uid_has_other boolean;
  v_pair_has_other boolean;
  v_rows_updated integer;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'accept_student_invite: invalid invite'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.coaches
    where id = v_uid
  ) then
    raise exception 'accept_student_invite: invalid invite'
      using errcode = 'P0001';
  end if;

  if p_code is null or p_code = '' then
    raise exception 'accept_student_invite: invalid invite'
      using errcode = 'P0001';
  end if;

  select
    coach_id,
    student_id,
    invited_email,
    used
  into
    v_coach_id,
    v_student_id,
    v_invited_email,
    v_used
  from public.invites
  where code = p_code
  for update;

  if not found then
    raise exception 'accept_student_invite: invalid invite'
      using errcode = 'P0001';
  end if;

  -- Account Access Control Phase B: una invitación pendiente cuyo coach
  -- está bloqueado/desactivado no puede aceptarse. Mismo mensaje uniforme
  -- que el resto de la función — nunca revela por qué falló.
  if not public.coach_has_access(v_coach_id) then
    raise exception 'accept_student_invite: invalid invite'
      using errcode = 'P0001';
  end if;

  select
    email,
    email_confirmed_at
  into
    v_auth_email,
    v_email_confirmed_at
  from auth.users
  where id = v_uid;

  if v_auth_email is null
     or v_email_confirmed_at is null then
    raise exception 'accept_student_invite: invalid invite'
      using errcode = 'P0001';
  end if;

  if v_invited_email is null
     or trim(v_invited_email) = '' then
    raise exception 'accept_student_invite: invalid invite'
      using errcode = 'P0001';
  end if;

  if lower(trim(v_auth_email))
     <> lower(trim(v_invited_email)) then
    raise exception 'accept_student_invite: invalid invite'
      using errcode = 'P0001';
  end if;

  if v_used then

    select exists(
      select 1
      from public.student_auth
      where id = v_uid
        and coach_id = v_coach_id
        and student_id = v_student_id
    )
    into v_already_mine;

    if v_already_mine then
      return jsonb_build_object('ok', true);
    end if;

    raise exception 'accept_student_invite: invalid invite'
      using errcode = 'P0001';
  end if;

  select exists(
    select 1
    from public.student_auth
    where id = v_uid
  )
  into v_uid_has_other;

  if v_uid_has_other then
    raise exception 'accept_student_invite: invalid invite'
      using errcode = 'P0001';
  end if;

  select exists(
    select 1
    from public.student_auth
    where coach_id = v_coach_id
      and student_id = v_student_id
  )
  into v_pair_has_other;

  if v_pair_has_other then
    raise exception 'accept_student_invite: invalid invite'
      using errcode = 'P0001';
  end if;

  begin
    insert into public.student_auth (
      id,
      coach_id,
      student_id,
      email
    )
    values (
      v_uid,
      v_coach_id,
      v_student_id,
      v_auth_email
    );

  exception
    when unique_violation then
      raise exception 'accept_student_invite: invalid invite'
        using errcode = 'P0001';
  end;

  update public.invites
  set used = true
  where code = p_code
    and used = false;

  get diagnostics v_rows_updated = row_count;

  if v_rows_updated <> 1 then
    raise exception 'accept_student_invite: invalid invite'
      using errcode = 'P0001';
  end if;

  return jsonb_build_object('ok', true);
end;
$function$
;

ALTER FUNCTION public.accept_student_invite(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.accept_student_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_student_invite(text) TO authenticated, postgres, service_role;

-- ============================================================================
-- 4. update_my_student_profile — gate added:
-- student_portal_has_access(auth.uid()), matching this function's own
-- existing style of calling auth.uid() inline rather than via a local
-- variable (it never declared one).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_my_student_profile(p_name text, p_phone text, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_coach_id uuid;
  v_student_id bigint;
  v_current jsonb;
  v_match_count integer;
  v_patched jsonb;
  v_new_updated_at timestamptz := now();
begin
  select coach_id, student_id
  into v_coach_id, v_student_id
  from public.student_auth
  where id = auth.uid();

  if not found then
    raise exception 'update_my_student_profile: no student_auth row for auth.uid()=%', auth.uid()
      using errcode = 'P0001';
  end if;

  if v_coach_id is null then
    raise exception 'update_my_student_profile: student_auth.coach_id is null for auth.uid()=%', auth.uid()
      using errcode = 'P0001';
  end if;

  -- Account Access Control Phase B: un estudiante con el Portal bloqueado
  -- no puede editar su propio perfil.
  if not public.student_portal_has_access(auth.uid()) then
    raise exception 'update_my_student_profile: student portal access blocked'
      using errcode = 'P0001';
  end if;

  select data_value
  into v_current
  from public.coach_data
  where coach_id = v_coach_id
    and data_key = 'students'
  for update;

  if not found then
    raise exception 'update_my_student_profile: no coach_data row for coach_id=%, data_key=students', v_coach_id
      using errcode = 'P0001';
  end if;

  if v_current is null or jsonb_typeof(v_current) <> 'array' then
    raise exception 'update_my_student_profile: coach_data.data_value is not a JSON array for coach_id=%', v_coach_id
      using errcode = 'P0001';
  end if;

  select count(*)
  into v_match_count
  from jsonb_array_elements(v_current) as elem
  where elem->>'id' = v_student_id::text;

  if v_match_count = 0 then
    raise exception 'update_my_student_profile: student_id=% not found in coach_data for coach_id=%', v_student_id, v_coach_id
      using errcode = 'P0001';
  elsif v_match_count > 1 then
    raise exception 'update_my_student_profile: integrity error — student_id=% matched % entries in coach_data for coach_id=%, expected exactly 1, no write performed', v_student_id, v_match_count, v_coach_id
      using errcode = 'P0001';
  end if;

  select jsonb_agg(
    case
      when elem->>'id' = v_student_id::text
      then elem || jsonb_build_object(
        'name', p_name,
        'phone', p_phone,
        'email', p_email
      )
      else elem
    end
    order by ord
  )
  into v_patched
  from jsonb_array_elements(v_current) with ordinality as t(elem, ord);

  update public.coach_data
  set data_value = v_patched,
      updated_at = v_new_updated_at
  where coach_id = v_coach_id
    and data_key = 'students';

  return jsonb_build_object(
    'ok', true,
    'updated_at', v_new_updated_at
  );
end;
$function$
;

ALTER FUNCTION public.update_my_student_profile(text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_my_student_profile(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_my_student_profile(text, text, text) TO authenticated, postgres, service_role;

-- ============================================================================
-- 5. mark_coach_messages_read — gate added: coach_has_access(v_uid)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mark_coach_messages_read(p_student_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid;
  v_is_coach boolean;
  v_rows_updated integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'mark_coach_messages_read: no authenticated user'
      using errcode = 'P0001';
  end if;

  select exists(select 1 from public.coaches where id = v_uid) into v_is_coach;
  if not v_is_coach then
    raise exception 'mark_coach_messages_read: auth.uid() is not a coach'
      using errcode = 'P0001';
  end if;

  -- Account Access Control Phase B: un coach bloqueado/desactivado no
  -- puede operar su inbox.
  if not public.coach_has_access(v_uid) then
    raise exception 'mark_coach_messages_read: coach is blocked or deactivated'
      using errcode = 'P0001';
  end if;

  update public.messages
  set read = true
  where coach_id = v_uid
    and student_id = p_student_id
    and from_coach = false
    and read = false;

  get diagnostics v_rows_updated = row_count;

  return jsonb_build_object('ok', true, 'updated', v_rows_updated);
end;
$function$
;

ALTER FUNCTION public.mark_coach_messages_read(bigint) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mark_coach_messages_read(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_coach_messages_read(bigint) TO authenticated, postgres, service_role;

-- ============================================================================
-- 6. mark_student_messages_read — gate added: student_portal_has_access(v_uid)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mark_student_messages_read()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid;
  v_coach_id uuid;
  v_student_id bigint;
  v_rows_updated integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'mark_student_messages_read: no authenticated user'
      using errcode = 'P0001';
  end if;

  select coach_id, student_id into v_coach_id, v_student_id
  from public.student_auth
  where id = v_uid;

  if not found then
    raise exception 'mark_student_messages_read: no student_auth row for auth.uid()'
      using errcode = 'P0001';
  end if;

  -- Account Access Control Phase B: un estudiante con el Portal bloqueado
  -- no puede operar su bandeja de mensajes.
  if not public.student_portal_has_access(v_uid) then
    raise exception 'mark_student_messages_read: student portal access blocked'
      using errcode = 'P0001';
  end if;

  update public.messages
  set read = true
  where coach_id = v_coach_id
    and student_id = v_student_id
    and from_coach = true
    and read = false;

  get diagnostics v_rows_updated = row_count;

  return jsonb_build_object('ok', true, 'updated', v_rows_updated);
end;
$function$
;

ALTER FUNCTION public.mark_student_messages_read() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mark_student_messages_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_student_messages_read() TO authenticated, postgres, service_role;

COMMIT;
