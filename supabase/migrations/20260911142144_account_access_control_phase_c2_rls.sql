-- ============================================================================
-- Account Access Control — Phase C.2 — RLS policy repair
-- ============================================================================
--
-- SCOPE (strict): DROP POLICY / CREATE POLICY only, on exactly 10 tables —
-- public.coaches, public.coach_data, public.messages, public.invites,
-- public.student_auth, public.students, public.classes, public.packages,
-- public.courts, public.expenses. Nothing else: no ALTER TABLE, no
-- ENABLE/FORCE ROW LEVEL SECURITY, no GRANT/REVOKE, no function, no index,
-- no change to any earlier migration file. RLS enabled on all 10 tables is
-- CONFIRMED, not assumed (student_auth/invites/messages explicitly, via
-- 20260831180000_security_hardening.sql and
-- 20260831200000_messages_rls_hardening.sql; coaches/coach_data/the five
-- legacy tables predate this repo's versioned migration history — see
-- supabase/README.md — and were confirmed via the preflight query below,
-- run against production; see the "LEGACY-TABLE ASSUMPTIONS" note further
-- down for exactly what was confirmed and how).
--
-- WHY THIS EXISTS: NONE of the policies touched here — not coaches, not
-- coach_data, not messages, not invites' own coach_select_own_invites, not
-- the five legacy tables — called coach_has_access()/
-- student_portal_has_access() before this migration. Confirmed by reading
-- messages'/invites' actual current definitions (see
-- 20260831200000_messages_rls_hardening.sql and section 6 of
-- 20260831180000_security_hardening.sql): coach_select_own_messages,
-- coach_insert_own_messages, student_select_own_messages,
-- student_insert_own_messages, and coach_select_own_invites all predate
-- Phase A's gate functions (20260907150000_account_access_control_phase_a.sql)
-- and only ever checked ownership (coach_id = auth.uid() / the student_auth
-- relation), never status. So this migration's primary, load-bearing change
-- everywhere is ADDING the access-control gate for the first time — a
-- blocked/deactivated coach's (or their students') row-level access was
-- never actually revoked at the database layer despite Phase A/B/C.0/C.1
-- closing that gap everywhere else (RPCs, grants, frontend) — this is not
-- an optimization pass. The `(select auth.uid())` / `(select
-- public.xxx_has_access(...))` scalar-subquery form (Supabase's own RLS
-- performance guidance: a bare `auth.uid()` or bare function call is
-- re-evaluated once per row; wrapping either lets the planner evaluate it
-- once per statement) is bundled into the same policy bodies here purely
-- because they had to be rewritten anyway to add the gate — it is a
-- secondary improvement riding along, not the reason this migration exists.
--
-- Every new/redefined policy: TO authenticated. Every ownership predicate:
-- `(select auth.uid())`. Every "does this identity currently have access"
-- gate: `(select public.coach_has_access((select auth.uid())))` or
-- `(select public.student_portal_has_access((select auth.uid())))` — the
-- one documented exception is student_insert_own_messages's gate on the
-- COACH the message is addressed to, which is necessarily row-correlated
-- (`messages.coach_id`, not the caller's own uid) and is therefore left
-- unwrapped, exactly as it must be to evaluate per row.
--
-- UPDATE semantics (coaches/coach_data and the five legacy ALL policies):
-- every UPDATE policy below uses the identical predicate in USING and WITH
-- CHECK. A row a blocked/deactivated identity no longer owns-with-access
-- is therefore excluded by USING before WITH CHECK is ever reached — the
-- observable result is an UPDATE that matches and affects ZERO ROWS,
-- silently, not a raised "new row violates row-level security policy"
-- error. That error can only be raised here by a caller who successfully
-- matched USING (a row they still own-with-access) and then tried, in the
-- same UPDATE, to change it into a row that would fail the same predicate
-- (e.g. reassigning coach_id) — not a path any current frontend code
-- exercises. Smoke expectations must check "0 rows affected", not an
-- error, for the blocked/deactivated UPDATE case.
--
-- LEGACY-TABLE ASSUMPTIONS — CONFIRMED, not still open. public.students/
-- classes/packages/courts/expenses have no versioned CREATE TABLE anywhere
-- in this repo (confirmed by grep — see the session's investigation) and
-- zero application consumer of any kind, live or dead (confirmed by C.0's
-- own investigation, restated in
-- 20260908010000_account_access_control_phase_c0_grant_hardening.sql, and
-- re-confirmed here by grep against src/ finding no `.from("students")` /
-- `.from("classes")` / `.from("packages")` / `.from("courts")` /
-- `.from("expenses")` call anywhere). This migration originally assumed
-- each of the five carries a `coach_id uuid` ownership column, matching
-- the pattern of every other table in this schema — that assumption, and
-- the exact current policy names ("Coaches manage own <table>", used
-- below) and RLS-enabled status of all ten tables, have since been
-- CONFIRMED by running the preflight query below directly against
-- production (reported back, not independently re-verified from this
-- session's own tooling): `coach_id uuid` is present on all five, the
-- existing policy names match exactly what the DROP statements below
-- target, and `relrowsecurity = true` holds on all ten tables. This
-- migration is written on that confirmed basis — it is not a hedge against
-- an unverified guess anymore. If this file is ever reused against a
-- DIFFERENT database, re-run the preflight query first; do not assume the
-- same result holds elsewhere.
--
-- PERMISSIVE-POLICY BYPASS WARNING: every DROP below is IF EXISTS
-- specifically so a name that turns out to be wrong never aborts the whole
-- transaction — but if a DROP silently no-ops because the real name
-- differs from what is written here, the OLD policy is NOT harmless
-- leftover: Postgres OR's multiple PERMISSIVE policies for the same
-- command together, so a surviving old policy can grant access this
-- migration's new, more restrictive policy was specifically written to
-- deny — a real bypass, not a redundancy. The names below are now
-- confirmed correct (see above) for the database this was written against;
-- if this is ever applied somewhere that confirmation doesn't hold, treat
-- every DROP as a thing to verify actually matched a real policy (e.g. via
-- the pg_policies preflight query, run again immediately after applying),
-- not as something safe to leave unchecked.
--
-- NOT IDEMPOTENT — do not re-run this file. Postgres has no
-- `CREATE POLICY IF NOT EXISTS`. A first run succeeds; DROP POLICY IF
-- EXISTS makes every DROP safe to repeat, but every CREATE POLICY on a
-- second run will fail with "policy already exists" the moment it reaches
-- the first one, aborting that entire second transaction (BEGIN/COMMIT
-- guarantees the abort is all-or-nothing, so a second run cannot leave the
-- schema half-migrated — but it is a hard failure to fix by re-running,
-- not a safe no-op).
-- ============================================================================

-- ============================================================================
-- PREFLIGHT — already run against production and confirmed (see the
-- "LEGACY-TABLE ASSUMPTIONS" note above); kept here, read-only, not part of
-- this migration, so it can be re-run immediately before actually applying
-- (to catch drift since it was last confirmed) and reused verbatim if this
-- file is ever adapted for a different database:
--
-- select schemaname, tablename, policyname, cmd, roles
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in (
--     'coaches','coach_data','messages','invites','student_auth',
--     'students','classes','packages','courts','expenses'
--   )
-- order by tablename, policyname;
--
-- select table_name, column_name, data_type
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name in ('students','classes','packages','courts','expenses')
-- order by table_name, ordinal_position;
--
-- select relname, relrowsecurity, relforcerowsecurity
-- from pg_class
-- where relnamespace = 'public'::regnamespace
--   and relname in (
--     'coaches','coach_data','messages','invites','student_auth',
--     'students','classes','packages','courts','expenses'
--   );
--
-- Already confirmed: (1) the legacy five have `coach_id`; (2) their current
-- policy names match "Coaches manage own <table>", exactly as targeted by
-- the DROP statements below; (3) relrowsecurity = true on all 10 tables.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. public.coaches — 5 historical policies -> 4.
-- ============================================================================
DROP POLICY IF EXISTS "Coaches can view own profile" ON public.coaches;
DROP POLICY IF EXISTS "Coaches can insert own profile" ON public.coaches;
DROP POLICY IF EXISTS "Coaches can update own profile" ON public.coaches;
DROP POLICY IF EXISTS "coach_own_profile" ON public.coaches;
DROP POLICY IF EXISTS "student_read_coach" ON public.coaches;

-- Own-row SELECT is deliberately ungated: resolveSession's own identity
-- read of a coach's row must succeed even when coach_has_access() would
-- say no — status itself is determined from get_my_account_status()
-- (Phase A), not from whether this SELECT succeeds. Gating this would risk
-- a blocked/deactivated coach's own client being unable to read its own
-- row for reasons unrelated to authorization.
CREATE POLICY "coach_select_own_profile"
  ON public.coaches
  FOR SELECT
  TO authenticated
  USING (id = (select auth.uid()));

CREATE POLICY "coach_insert_own_profile"
  ON public.coaches
  FOR INSERT
  TO authenticated
  WITH CHECK (
    id = (select auth.uid())
    AND (select public.coach_has_access((select auth.uid())))
  );

CREATE POLICY "coach_update_own_profile"
  ON public.coaches
  FOR UPDATE
  TO authenticated
  USING (
    id = (select auth.uid())
    AND (select public.coach_has_access((select auth.uid())))
  )
  WITH CHECK (
    id = (select auth.uid())
    AND (select public.coach_has_access((select auth.uid())))
  );

-- Relation preserved from the pre-existing policy: a student reads their
-- own coach's profile row via the student_auth link, never the coach's own
-- access gate — a blocked/deactivated coach's profile must still resolve
-- (mode/account status) for a student who is themselves still active.
CREATE POLICY "student_read_coach"
  ON public.coaches
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.student_auth sa
      WHERE sa.id = (select auth.uid())
        AND sa.coach_id = coaches.id
    )
    AND (select public.student_portal_has_access((select auth.uid())))
  );

-- No DELETE, no ALL policy on public.coaches — matches the instruction and
-- the confirmed live grant (SELECT, INSERT, UPDATE only — see
-- 20260908010000_account_access_control_phase_c0_grant_hardening.sql).

-- ============================================================================
-- 2. public.coach_data — coach_own_data -> 3 granular policies;
-- student_read_coach_data redefined (same name) with the caller's own gate.
-- ============================================================================
DROP POLICY IF EXISTS "coach_own_data" ON public.coach_data;
DROP POLICY IF EXISTS "student_read_coach_data" ON public.coach_data;

CREATE POLICY "coach_select_own_data"
  ON public.coach_data
  FOR SELECT
  TO authenticated
  USING (
    coach_id = (select auth.uid())
    AND (select public.coach_has_access((select auth.uid())))
  );

CREATE POLICY "coach_insert_own_data"
  ON public.coach_data
  FOR INSERT
  TO authenticated
  WITH CHECK (
    coach_id = (select auth.uid())
    AND (select public.coach_has_access((select auth.uid())))
  );

CREATE POLICY "coach_update_own_data"
  ON public.coach_data
  FOR UPDATE
  TO authenticated
  USING (
    coach_id = (select auth.uid())
    AND (select public.coach_has_access((select auth.uid())))
  )
  WITH CHECK (
    coach_id = (select auth.uid())
    AND (select public.coach_has_access((select auth.uid())))
  );

-- Relation preserved: a student reads their own coach's business data via
-- the student_auth link, gated on the STUDENT's own access only — never
-- the coach's. A blocked coach's data must still be readable by their
-- still-active students (matches coaches.student_read_coach above).
CREATE POLICY "student_read_coach_data"
  ON public.coach_data
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.student_auth sa
      WHERE sa.id = (select auth.uid())
        AND sa.coach_id = coach_data.coach_id
    )
    AND (select public.student_portal_has_access((select auth.uid())))
  );

-- No DELETE, no ALL policy on public.coach_data — matches the instruction
-- and the confirmed live grant (SELECT, INSERT, UPDATE only — see
-- 20260908010000_account_access_control_phase_c0_grant_hardening.sql).

-- ============================================================================
-- 3. public.messages — 4 existing policies (already minimal, from
-- 20260831200000_messages_rls_hardening.sql) redefined with the
-- `(select ...)` form and the access-control gates added.
-- ============================================================================
DROP POLICY IF EXISTS "coach_select_own_messages" ON public.messages;
DROP POLICY IF EXISTS "coach_insert_own_messages" ON public.messages;
DROP POLICY IF EXISTS "student_select_own_messages" ON public.messages;
DROP POLICY IF EXISTS "student_insert_own_messages" ON public.messages;

CREATE POLICY "coach_select_own_messages"
  ON public.messages
  FOR SELECT
  TO authenticated
  USING (
    coach_id = (select auth.uid())
    AND (select public.coach_has_access((select auth.uid())))
  );

CREATE POLICY "coach_insert_own_messages"
  ON public.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    coach_id = (select auth.uid())
    AND from_coach = true
    AND (select public.coach_has_access((select auth.uid())))
  );

CREATE POLICY "student_select_own_messages"
  ON public.messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.student_auth sa
      WHERE sa.id = (select auth.uid())
        AND sa.coach_id = messages.coach_id
        AND sa.student_id = messages.student_id
    )
    AND (select public.student_portal_has_access((select auth.uid())))
  );

-- coach_has_access(messages.coach_id) here is deliberately row-correlated
-- (the COACH THE MESSAGE IS ADDRESSED TO, taken from the row being
-- inserted) — never the caller's own uid, and left unwrapped by a `select`
-- subquery on purpose: unlike the caller-identity gates above, this value
-- varies per row and cannot be hoisted to a single per-statement
-- evaluation. A student loses the ability to message a coach who has lost
-- access, even though the student's own access (student_portal_has_access
-- above) is unaffected by it. This gate exists ONLY on this INSERT policy
-- — student_select_own_messages above has no equivalent check on the
-- coach's status. A still-active student whose coach is blocked/
-- deactivated can therefore keep reading the full existing message
-- history with that coach (SELECT unaffected) but cannot insert a new
-- message to them (INSERT blocked here) — reading history and sending a
-- new one are deliberately not symmetric for this one case.
CREATE POLICY "student_insert_own_messages"
  ON public.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    from_coach = false
    AND is_alert = false
    AND EXISTS (
      SELECT 1 FROM public.student_auth sa
      WHERE sa.id = (select auth.uid())
        AND sa.coach_id = messages.coach_id
        AND sa.student_id = messages.student_id
    )
    AND (select public.student_portal_has_access((select auth.uid())))
    AND public.coach_has_access(messages.coach_id)
  );

-- ============================================================================
-- 4. public.invites — coach_select_own_invites redefined with the gate
-- added. No write policy — matches the confirmed live grant (SELECT only —
-- see 20260831180000_security_hardening.sql section 7); all writes go
-- through create_student_invite/accept_student_invite (both SECURITY
-- DEFINER, bypass RLS entirely).
-- ============================================================================
DROP POLICY IF EXISTS "coach_select_own_invites" ON public.invites;

CREATE POLICY "coach_select_own_invites"
  ON public.invites
  FOR SELECT
  TO authenticated
  USING (
    coach_id = (select auth.uid())
    AND (select public.coach_has_access((select auth.uid())))
  );

-- ============================================================================
-- 5. public.student_auth — student_select_own_row left EXACTLY as it is
-- (20260831180000_security_hardening.sql): `USING (id = auth.uid())`, no
-- access-control gate. Reading your own identity/auth row must never be
-- gated by your own account status — that row is how the frontend (and
-- get_my_account_status) determines what your status even is. No DROP, no
-- CREATE here; this section exists only to document that the omission is
-- intentional, not an oversight.
--
-- This is the same design as coaches.coach_select_own_profile (section 1
-- above), not a one-off: this migration leaves EXACTLY two ungated "read
-- your own identity row" policies in the whole schema —
-- coach_select_own_profile on public.coaches and student_select_own_row on
-- public.student_auth — one per identity kind, both deliberately excluded
-- from coach_has_access()/student_portal_has_access() for the identical
-- reason. Every other own-identity read (coach_select_own_data,
-- coach_select_own_messages, coach_select_own_invites and their student-
-- side counterparts) is gated; these two are not, because they are what
-- the frontend/get_my_account_status uses to determine status in the first
-- place — gating them would make a blocked/deactivated identity unable to
-- discover that it's blocked/deactivated.
-- ============================================================================

-- ============================================================================
-- 6. Legacy — public.students, public.classes, public.packages,
-- public.courts, public.expenses. One ALL policy per table (unlike the
-- granular SELECT/INSERT/UPDATE split above) — these five tables have zero
-- application consumer (confirmed by C.0's investigation and re-confirmed
-- here) and, as of
-- 20260908010000_account_access_control_phase_c0_grant_hardening.sql,
-- `authenticated` holds NO table-level grant on any of them at all — these
-- policies are therefore currently inert (a table-level GRANT is checked
-- before RLS is ever evaluated) and grants are NOT restored here, exactly
-- as instructed. This is RLS-layer hygiene for whenever/if that grant
-- question is revisited, not a change in what's actually reachable today.
-- Concretely: any SELECT/INSERT/UPDATE/DELETE attempt against any of these
-- five tables as `authenticated` fails at the grant-check stage with
-- Postgres error 42501 ("permission denied for relation <table>") — RLS is
-- never even reached, so this is not an RLS-filtered empty result. Smoke
-- expectations for the legacy five must check for that 42501, not for a
-- zero-row SELECT or a policy-violation error.
-- ============================================================================
DROP POLICY IF EXISTS "Coaches manage own students" ON public.students;
CREATE POLICY "students_coach_access"
  ON public.students
  FOR ALL
  TO authenticated
  USING (
    coach_id = (select auth.uid())
    AND (select public.coach_has_access((select auth.uid())))
  )
  WITH CHECK (
    coach_id = (select auth.uid())
    AND (select public.coach_has_access((select auth.uid())))
  );

DROP POLICY IF EXISTS "Coaches manage own classes" ON public.classes;
CREATE POLICY "classes_coach_access"
  ON public.classes
  FOR ALL
  TO authenticated
  USING (
    coach_id = (select auth.uid())
    AND (select public.coach_has_access((select auth.uid())))
  )
  WITH CHECK (
    coach_id = (select auth.uid())
    AND (select public.coach_has_access((select auth.uid())))
  );

DROP POLICY IF EXISTS "Coaches manage own packages" ON public.packages;
CREATE POLICY "packages_coach_access"
  ON public.packages
  FOR ALL
  TO authenticated
  USING (
    coach_id = (select auth.uid())
    AND (select public.coach_has_access((select auth.uid())))
  )
  WITH CHECK (
    coach_id = (select auth.uid())
    AND (select public.coach_has_access((select auth.uid())))
  );

DROP POLICY IF EXISTS "Coaches manage own courts" ON public.courts;
CREATE POLICY "courts_coach_access"
  ON public.courts
  FOR ALL
  TO authenticated
  USING (
    coach_id = (select auth.uid())
    AND (select public.coach_has_access((select auth.uid())))
  )
  WITH CHECK (
    coach_id = (select auth.uid())
    AND (select public.coach_has_access((select auth.uid())))
  );

DROP POLICY IF EXISTS "Coaches manage own expenses" ON public.expenses;
CREATE POLICY "expenses_coach_access"
  ON public.expenses
  FOR ALL
  TO authenticated
  USING (
    coach_id = (select auth.uid())
    AND (select public.coach_has_access((select auth.uid())))
  )
  WITH CHECK (
    coach_id = (select auth.uid())
    AND (select public.coach_has_access((select auth.uid())))
  );

COMMIT;
