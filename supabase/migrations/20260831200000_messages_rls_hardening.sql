-- ============================================================================
-- messages RLS hardening — replace 8 historical policies with 4 minimal ones
-- ============================================================================
--
-- SCOPE: closes a confirmed cross-tenant vulnerability in `public.messages`.
-- The historical policy `student_messages` (PERMISSIVE, FOR ALL) scoped only
-- on `student_id` — never `coach_id` — and `student_id` is not guaranteed
-- globally unique (client-generated, per-coach). Combined with PERMISSIVE
-- policies being OR'd together, this let an authenticated student SELECT/
-- INSERT/UPDATE/DELETE rows belonging to any (coach_id, student_id) pair
-- sharing their own student_id, including setting `coach_id`/`from_coach`/
-- `is_alert` to arbitrary values on INSERT. Full analysis and the 8 verified
-- historical policy definitions are in the SECURITY-MESSAGES audit that
-- preceded this migration (not versioned here — see session history).
--
-- No legitimate frontend flow depended on the removed breadth: every call
-- site in src/App.jsx already scoped both coach_id and student_id/studentId
-- explicitly before this fix.
--
-- Wrapped in a single transaction — any failure rolls back everything.
-- Idempotent: safe to re-run.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Drop the 8 historical policies (verified names) + the 4 new ones
-- (idempotency, in case this file is re-run).
-- ============================================================================
DROP POLICY IF EXISTS "Coaches can update own messages" ON public.messages;
DROP POLICY IF EXISTS "Coaches manage own messages" ON public.messages;
DROP POLICY IF EXISTS "Students can insert own messages" ON public.messages;
DROP POLICY IF EXISTS "Students can read own messages" ON public.messages;
DROP POLICY IF EXISTS "Students insert own messages" ON public.messages;
DROP POLICY IF EXISTS "Students see own messages" ON public.messages;
DROP POLICY IF EXISTS "coach_messages" ON public.messages;
DROP POLICY IF EXISTS "student_messages" ON public.messages;

DROP POLICY IF EXISTS "coach_select_own_messages" ON public.messages;
DROP POLICY IF EXISTS "coach_insert_own_messages" ON public.messages;
DROP POLICY IF EXISTS "student_select_own_messages" ON public.messages;
DROP POLICY IF EXISTS "student_insert_own_messages" ON public.messages;

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. New policies — SELECT/INSERT only, no UPDATE/DELETE for either role.
-- "Mark as read" moves entirely to the two RPCs below.
-- ============================================================================
CREATE POLICY "coach_select_own_messages"
  ON public.messages
  FOR SELECT
  TO authenticated
  USING (coach_id = auth.uid());

CREATE POLICY "coach_insert_own_messages"
  ON public.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (coach_id = auth.uid() AND from_coach = true);

CREATE POLICY "student_select_own_messages"
  ON public.messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.student_auth sa
      WHERE sa.id = auth.uid()
        AND sa.coach_id = messages.coach_id
        AND sa.student_id = messages.student_id
    )
  );

CREATE POLICY "student_insert_own_messages"
  ON public.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    from_coach = false
    AND is_alert = false
    AND EXISTS (
      SELECT 1 FROM public.student_auth sa
      WHERE sa.id = auth.uid()
        AND sa.coach_id = messages.coach_id
        AND sa.student_id = messages.student_id
    )
  );

-- ============================================================================
-- 3. RPCs — the only way to mark messages as read. Touch `read` exclusively;
-- never text/from_coach/coach_id/student_id/is_alert.
-- ============================================================================

-- mark_coach_messages_read: coach_id is always auth.uid(), never client-
-- supplied — that's the entire cross-tenant guarantee, and it holds
-- regardless of what p_student_id is (a non-matching value just updates 0
-- rows). Deliberately does NOT validate p_student_id against
-- coach_data.students: a roster-membership check was evaluated and rejected
-- — coach_id already fully determines whose rows this can touch, so
-- p_student_id is a same-tenant filter, not an authority claim (unlike
-- create_student_invite/accept_student_invite, where the client-supplied ID
-- itself determines ownership of the write). Requiring current roster
-- membership would additionally break "mark as read" for legitimate
-- historical conversations with since-deleted students, for zero security
-- benefit.
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

-- Explicit ownership: CREATE OR REPLACE alone doesn't guarantee owner=postgres
-- for a function that doesn't exist yet — it would take on whatever role runs
-- this migration. Stated explicitly to match the other 4 RPCs (all verified
-- owner=postgres) rather than relying on which role happens to execute this.
ALTER FUNCTION public.mark_coach_messages_read(bigint) OWNER TO postgres;

-- mark_student_messages_read: no parameters at all. coach_id/student_id are
-- derived exclusively from student_auth via auth.uid() — the client cannot
-- influence which conversation gets marked.
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

-- Explicit ownership, same reasoning as mark_coach_messages_read above.
ALTER FUNCTION public.mark_student_messages_read() OWNER TO postgres;

-- ============================================================================
-- 4. EXECUTE privileges — authenticated/postgres/service_role only, no anon.
-- ============================================================================
REVOKE ALL ON FUNCTION public.mark_coach_messages_read(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_student_messages_read() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.mark_coach_messages_read(bigint) TO authenticated, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.mark_student_messages_read() TO authenticated, postgres, service_role;

-- ============================================================================
-- 5. Table grants — anon: nothing. authenticated: SELECT+INSERT only (no
-- UPDATE/DELETE — those now go exclusively through the RPCs above).
-- postgres/service_role: untouched, no REVOKE issued against them.
-- ============================================================================
REVOKE ALL ON public.messages FROM anon;
REVOKE ALL ON public.messages FROM authenticated;
GRANT SELECT, INSERT ON public.messages TO authenticated;

COMMIT;
