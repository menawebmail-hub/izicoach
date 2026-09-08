-- ============================================================================
-- Account Access Control — Phase B.1 — remove stray anon EXECUTE grants
-- ============================================================================
--
-- SCOPE: revokes exactly two explicit EXECUTE grants — anon on
-- mark_coach_messages_read(bigint) and anon on mark_student_messages_read().
-- Nothing else: no other grant, no function body, no table, no RLS policy,
-- no other migration file (including
-- 20260907183000_account_access_control_phase_b.sql, which stays immutable
-- and is not modified here).
--
-- ROOT CAUSE: post-apply verification of Phase B found these two functions
-- still executable by anon, when only get_student_invite_preview(text) is
-- meant to be. This is not a Phase B regression in the function bodies
-- themselves — it is a grants artifact of how CREATE OR REPLACE FUNCTION
-- interacts with pre-existing, explicit, per-role grants:
--
--   REVOKE ALL ON FUNCTION ... FROM PUBLIC only revokes the privilege
--   implicitly granted to the PUBLIC pseudo-role. It does NOT revoke an
--   EXECUTE privilege that was granted explicitly and directly to a named
--   role (e.g. `GRANT EXECUTE ON FUNCTION ... TO anon;` from some earlier
--   migration, predating Phase A/B). CREATE OR REPLACE FUNCTION preserves a
--   function's existing grants across the replace — it does not reset them
--   to whatever the new migration's own REVOKE/GRANT block happens to state
--   unless that block explicitly revokes every role that currently holds a
--   grant. Phase B's REVOKE ALL ... FROM PUBLIC (both functions) followed by
--   GRANT EXECUTE ... TO authenticated, postgres, service_role therefore
--   left any legacy explicit anon grant on these two functions untouched —
--   PUBLIC was cleared, anon specifically was not.
--
-- This migration closes that gap with a direct, explicit REVOKE against
-- anon on exactly these two functions. It is idempotent: revoking a
-- privilege a role does not hold is a no-op in Postgres, never an error —
-- safe to re-run.
--
-- Expected end state after this migration (unchanged for the other four
-- Phase B functions, not re-touched here):
--   mark_coach_messages_read(bigint)   — authenticated, postgres, service_role only
--   mark_student_messages_read()       — authenticated, postgres, service_role only
--   get_student_invite_preview(text)   — anon, authenticated, postgres, service_role (unchanged, intentional)
--   create_student_invite(bigint)          — authenticated, postgres, service_role (unchanged)
--   accept_student_invite(text)            — authenticated, postgres, service_role (unchanged)
--   update_my_student_profile(text,text,text) — authenticated, postgres, service_role (unchanged)
-- ============================================================================

BEGIN;

REVOKE EXECUTE ON FUNCTION public.mark_coach_messages_read(bigint) FROM anon;
REVOKE EXECUTE ON FUNCTION public.mark_student_messages_read() FROM anon;

COMMIT;
