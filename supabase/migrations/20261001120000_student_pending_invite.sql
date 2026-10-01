-- ============================================================================
-- Student pending invite — server-side recognition of an invited student
-- (bug #3: an invited student lands in the COACH onboarding). Additive.
--
-- WHY: student_auth is created only by accept_student_invite(p_code), and only
-- when the browser carries the invite code all the way there (Confirm Email
-- callback with ?invite=&invite_callback=1, the tab's sessionStorage, or the
-- "Ya tengo una cuenta" screen). Any other way back — a callback that lost the
-- query string, the email confirmed in another browser, a link consumed by a
-- mail scanner followed by a plain login — reaches get_my_account_status with
-- no coaches and no student_auth row: {null,null}, the same answer as a
-- genuinely new coach, so the app routes the invitee to the coach onboarding.
--
-- WHAT THIS MIGRATION DOES:
--   1. public._my_pending_student_invites() — internal helper (not executable
--      by any client role) returning the caller's VALID pending invites. The
--      single definition shared by (2) and (3), so status and acceptance can
--      never disagree. Identity = auth.uid() and that same row of auth.users
--      (email + email_confirmed_at). No parameters.
--   2. get_my_account_status() — same body, same priorities, same grants, plus
--      ONE additive key, "pending_invite": null | "single" | "multiple",
--      computed only when coach_status and student_status are both null.
--      Invariant: pending_invite <> null  =>  coach_status = null AND
--      student_status = null. The current frontend validates only the two
--      existing keys and ignores extra ones, so it keeps working unchanged.
--   3. accept_my_pending_invite() — no parameters. Links auth.uid() to its
--      single valid pending invite (student_auth row + invite used=true),
--      atomically. Never picks one of several. Never returns ids, codes,
--      emails or names.
--
-- WHAT THIS MIGRATION DOES NOT DO: no table, column, policy, RLS or table
-- grant changes; accept_student_invite(p_code) and create_student_invite are
-- untouched (the code flow keeps working and stays the primary path); a uid
-- that already has a coaches / coach_access_control row is never converted
-- (not_eligible) — that needs a controlled manual repair.
--
-- Contracts:
--   get_my_account_status() ->
--     { "coach_status":   null | "active" | "blocked" | "deactivated",
--       "student_status": null | "active" | "blocked",
--       "pending_invite": null | "single" | "multiple" }
--   accept_my_pending_invite() ->
--       { "ok": true }
--     | { "ok": true,  "already_linked": true }   -- caller already has student_auth
--     | { "ok": false, "reason": "none" }         -- no valid pending invite
--     | { "ok": false, "reason": "multiple" }     -- 2+ valid: nothing modified
--     | { "ok": false, "reason": "not_eligible" } -- coach / coach_access_control / email not confirmed
--
-- Concurrency (accept_my_pending_invite):
--   * pg_advisory_xact_lock per auth.uid() serializes repeated calls by the
--     same user (double click, two tabs): the second one sees student_auth and
--     returns already_linked.
--   * The candidate invite rows are locked FOR UPDATE with used = false in
--     the locking query itself, so a row concurrently consumed by
--     accept_student_invite(p_code) (which also locks the invite row FOR
--     UPDATE) is re-checked after the lock and drops out. Whichever runs
--     second converges: accept_student_invite sees used + "already mine" ->
--     ok; this function sees student_auth -> already_linked.
--   * Last line: the existing unique indexes (student_auth PK on id,
--     student_auth_coach_student_unique, invites_active_per_student) and the
--     used = false guard on the final UPDATE (row_count must be exactly 1).
--   * An invite created for the same email while an acceptance is running is
--     not seen by it (it was exactly one at decision time); it stays pending
--     and is never considered again once the caller has student_auth.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Internal helper — the caller's valid pending student invites.
--    SECURITY INVOKER on purpose: it is only ever called from the SECURITY
--    DEFINER functions below (running as their owner); a client role could not
--    read auth.users through it even if it could execute it — and it cannot.
-- ----------------------------------------------------------------------------
create or replace function public._my_pending_student_invites()
 returns table(code text, coach_id uuid, student_id bigint)
 language sql
 stable
 set search_path to ''
as $function$
  select i.code, i.coach_id, i.student_id
  from auth.users u
  join public.invites i
    on lower(trim(i.invited_email)) = lower(trim(u.email))
  where u.id = auth.uid()
    and auth.uid() is not null
    and u.email_confirmed_at is not null
    and nullif(trim(u.email), '') is not null
    and i.used = false
    and nullif(trim(i.invited_email), '') is not null
    and i.coach_id is not null
    and i.student_id is not null
    and exists (select 1 from public.coaches c where c.id = i.coach_id)
    and public.coach_has_access(i.coach_id)
    and not exists (
      select 1 from public.student_auth sa
      where sa.coach_id = i.coach_id
        and sa.student_id = i.student_id
    )
$function$
;

alter function public._my_pending_student_invites() owner to postgres;
revoke all on function public._my_pending_student_invites() from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. get_my_account_status — phase A body unchanged + additive pending_invite.
-- ----------------------------------------------------------------------------
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
  v_pending_count integer;
  v_pending_invite text;
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

  -- Additive (student pending invite): only for a caller that is neither a
  -- coach nor a student. Counts at most 2 — the exact number is never exposed.
  v_pending_invite := null;
  if v_coach_status is null and v_student_status is null then
    select count(*) into v_pending_count
    from (select 1 from public._my_pending_student_invites() limit 2) s;

    v_pending_invite := case
      when v_pending_count = 1 then 'single'
      when v_pending_count >= 2 then 'multiple'
      else null
    end;
  end if;

  return jsonb_build_object(
    'coach_status', v_coach_status,
    'student_status', v_student_status,
    'pending_invite', v_pending_invite
  );
end;
$function$
;

ALTER FUNCTION public.get_my_account_status() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_my_account_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_account_status() TO authenticated, postgres, service_role;

-- ----------------------------------------------------------------------------
-- 3. accept_my_pending_invite — no parameters; identity only from auth.uid().
-- ----------------------------------------------------------------------------
create or replace function public.accept_my_pending_invite()
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_uid uuid;
  v_auth_email text;
  v_email_confirmed_at timestamptz;
  v_codes text[];
  v_coach_id uuid;
  v_student_id bigint;
  v_rows_updated integer;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'accept_my_pending_invite: no authenticated user'
      using errcode = 'P0001';
  end if;

  -- Serializes concurrent calls by the same user for the rest of this transaction.
  perform pg_advisory_xact_lock(hashtextextended('accept_my_pending_invite:' || v_uid::text, 0));

  -- A coach (or any coach access-control record) is never converted into a student here.
  if exists (select 1 from public.coaches where id = v_uid)
     or exists (select 1 from public.coach_access_control where coach_id = v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'not_eligible');
  end if;

  if exists (select 1 from public.student_auth where id = v_uid) then
    return jsonb_build_object('ok', true, 'already_linked', true);
  end if;

  select email, email_confirmed_at
  into v_auth_email, v_email_confirmed_at
  from auth.users
  where id = v_uid;

  if nullif(trim(v_auth_email), '') is null or v_email_confirmed_at is null then
    return jsonb_build_object('ok', false, 'reason', 'not_eligible');
  end if;

  -- Lock every candidate row; used = false is part of the locking query so a
  -- row consumed concurrently is re-evaluated after the lock and excluded.
  v_codes := array(
    select i.code
    from public.invites i
    where i.code in (select p.code from public._my_pending_student_invites() p)
      and i.used = false
    order by i.code
    for update of i
  );

  if coalesce(cardinality(v_codes), 0) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'none');
  end if;

  if cardinality(v_codes) > 1 then
    return jsonb_build_object('ok', false, 'reason', 'multiple');
  end if;

  select coach_id, student_id
  into v_coach_id, v_student_id
  from public.invites
  where code = v_codes[1];

  begin
    insert into public.student_auth (id, coach_id, student_id, email)
    values (v_uid, v_coach_id, v_student_id, v_auth_email);
  exception
    when unique_violation then
      raise exception 'accept_my_pending_invite: invalid state'
        using errcode = 'P0001';
  end;

  update public.invites
  set used = true
  where code = v_codes[1]
    and used = false;

  get diagnostics v_rows_updated = row_count;

  if v_rows_updated <> 1 then
    raise exception 'accept_my_pending_invite: invalid state'
      using errcode = 'P0001';
  end if;

  return jsonb_build_object('ok', true);
end;
$function$
;

alter function public.accept_my_pending_invite() owner to postgres;
revoke all on function public.accept_my_pending_invite() from public, anon;
grant execute on function public.accept_my_pending_invite() to authenticated, postgres, service_role;

commit;
