-- ============================================================================
-- Account Access Control — Phase C.0 — grant hardening (table privileges only)
-- ============================================================================
--
-- SCOPE: table-level GRANT/REVOKE on exactly seven tables — public.coaches,
-- public.coach_data, public.students, public.classes, public.packages,
-- public.courts, public.expenses. Touches nothing else: no RLS policy (that
-- is the later Phase C migration, not this one), no function, no other
-- table's grants (public.invites/messages/student_auth are already at the
-- minimum confirmed by the Phase C investigation and are not touched here),
-- no postgres/service_role privilege (never mentioned by any REVOKE/GRANT
-- below), no schema, no existing migration file.
--
-- ROOT CAUSE / WHY THIS EXISTS: these seven tables predate this project's
-- versioned migration history (confirmed — no earlier migration file grants
-- or revokes anything on them). Production carried a blanket
-- DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE grant to BOTH anon
-- and authenticated on all seven, confirmed by direct production
-- introspection during the Phase C investigation. That investigation also
-- produced an exhaustive, verified account of what the live application
-- actually needs:
--
--   anon — zero live consumer on any of the seven tables. Every read/write
--   the frontend performs against coaches/coach_data happens only after
--   auth.onAuthStateChange resolves a real session (resolveSession.js
--   returns immediately on `!session?.user`), so the client is always
--   `authenticated` by the time any of these tables is touched. No code
--   path — live or dead — issues a request against any of the seven tables
--   as `anon`.
--
--   authenticated — confirmed live requirement is SELECT+INSERT+UPDATE on
--   coaches (session resolution + profile load via resolveSession.js/
--   App.jsx's loadData, profile save via saveCoachProfile, onboarding
--   completion via handleOnboardingComplete — all three writes are
--   `.upsert()`, which needs both INSERT and UPDATE, never a bare INSERT or
--   bare UPDATE alone) and the identical SELECT+INSERT+UPDATE shape on
--   coach_data (loadData/loadAllFromSupabase for the coach's own data,
--   syncToSupabase's `.upsert(..., {onConflict:"coach_id,data_key"})`, and
--   the student_portal read of a *different* coach's coach_data row via
--   student_read_coach_data's RLS policy — that RLS policy still requires
--   the base SELECT table privilege on coach_data for `authenticated` to
--   exist at all, which this migration preserves).
--
--   DELETE was NOT assumed — verified absent. A repo-wide grep for
--   `.delete(` across every file under src/ (live and dead) found zero
--   Supabase `.delete()` calls against any table; every hit was a
--   JavaScript `Set.delete()`/`URLSearchParams.delete()` call on local
--   state, unrelated to the database. DELETE is therefore excluded from the
--   authenticated grant on both coaches and coach_data.
--
--   The five legacy tables (students, classes, packages, courts, expenses)
--   have zero confirmed application consumer of any kind — live or dead,
--   any privilege. All actual student/class/package/court/expense data is
--   persisted as JSON inside coach_data.data_value (data_key='students' etc,
--   see src/data/coachData.js), a pattern already in place before this
--   migration. These five tables are NOT dropped here (out of scope for
--   Phase C.0 — a separate decision, if ever made) — only stripped of every
--   privilege for anon and authenticated, since nothing in the application
--   needs any access to them.
--
--   TRUNCATE/REFERENCES/TRIGGER are removed from both roles on all seven
--   tables, deliberately: TRUNCATE is not governed by RLS at all (a
--   privilege gap independent of any RLS policy correctness), and neither
--   REFERENCES nor TRIGGER has any legitimate runtime use by an application
--   role — REFERENCES is needed only at DDL time by whichever role executes
--   `ALTER TABLE ... ADD CONSTRAINT` (the two real foreign keys pointing at
--   coaches — invites_coach_id_fkey and student_auth_coach_id_fkey — were
--   both added by the migration owner, never by anon/authenticated), and
--   TRIGGER is needed only to create/alter triggers, which no migration
--   in this repo does against any of these seven tables via anon/
--   authenticated.
--
-- METHOD: REVOKE ALL (not a selective list of revokes) followed by an
-- explicit minimal re-GRANT, rather than revoking only the specific
-- privileges believed unnecessary. Chosen because these grants were never
-- versioned — there is no guarantee the seven-privilege list captured
-- during introspection is exhaustive for all time, and REVOKE ALL closes
-- anything not explicitly re-granted, including anything not seen during
-- introspection. Naturally idempotent and safe to re-run: REVOKE on a
-- privilege already absent is a no-op in Postgres, never an error.
--
-- Wrapped in a single transaction so no external observer ever sees an
-- intermediate state between the REVOKE and the re-GRANT.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Strip every privilege from anon and authenticated on all seven tables.
-- ----------------------------------------------------------------------------
REVOKE ALL ON public.coaches FROM anon, authenticated;
REVOKE ALL ON public.coach_data FROM anon, authenticated;
REVOKE ALL ON public.students FROM anon, authenticated;
REVOKE ALL ON public.classes FROM anon, authenticated;
REVOKE ALL ON public.packages FROM anon, authenticated;
REVOKE ALL ON public.courts FROM anon, authenticated;
REVOKE ALL ON public.expenses FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Re-grant exactly the confirmed live requirement — authenticated only,
-- SELECT/INSERT/UPDATE only, coaches and coach_data only. No grant is
-- re-issued for anon on any table, and none at all for the five legacy
-- tables (students/classes/packages/courts/expenses) — confirmed zero
-- consumer, so they stay with no privilege for either application role
-- after this migration. postgres/service_role are never mentioned above or
-- below — REVOKE ALL ... FROM anon, authenticated does not touch them.
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON public.coaches TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.coach_data TO authenticated;

COMMIT;
