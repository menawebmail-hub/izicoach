SESSION_STATE.md — IziCoach

# Current task — account isolation (device storage)

- Branch `fix/iso-device-storage` (from `main` `c241570`), one local commit, **not pushed**:
  BUG-ISO-01 (Chat groups per coach) and BUG-ISO-02 (legacy local copies: writes removed,
  `clearLegacyBusinessCaches()` implemented but not called). Details: `docs/BUGS.md`.
- Verified: `npm test` 29/29; `vite build` clean; `oxlint` 366 = baseline. Not verified in a
  browser yet (manual check: two test coaches on one device).
- Production RLS/grants/functions/trigger verified read-only (2026-10-25): they match the
  repository. Difference: `supabase_migrations.schema_migrations` stops at `20260915120000`
  although the effects of `20260929230000`, `20260930120000`, `20260930150000` and
  `20261001120000` are present (applied manually). Reconcile the history (migration repair)
  before any new migration — separate step, owner's authorization.
- Next, each separately authorized: outbox isolation tests (coachData with a mocked Supabase),
  the migration history repair, a separate Supabase test project (D5), R4 (CAS with
  `p_expected_coach_id`: SQL first, then client), and calling `clearLegacyBusinessCaches()`.
- BUG-CHAT-03 (group messages never saved) registered separately.

# Previous state

## 1. Last closed task — Cobros bugs (2026-10-24)

- BUG-COBROS-01 (Detalles de Pagos stepper blocked at 0) and BUG-COBROS-02 (rescheduled dates
  showing two badges, plus the approved visual adjustment: "Reprogramada" in the class-state
  column, in the app's existing orange) are in `main` at `83740a4` (fast-forward from
  `15b572d`) and deployed to Production by Vercel's automatic deployment (success).
- Verified on `main` before the push: `npm test` 15/15; `vite build` clean; `oxlint` 366 =
  previous `main`, no new warning. Details: `docs/BUGS.md` → BUG-COBROS-01, BUG-COBROS-02.
- Owner's local validation approved. Still to do by the owner on Production: check Alexia
  Monzon and Pato Ojeda in Cobros and in the Student Portal, and Alexia's real payment
  (expected after paying the 10: No pagadas 0, Pagadas 10, Realizadas 10).
- The branches `fix/cobros-stepper-no-calendar`, `fix/cobros-reprog-badges` and
  `validate/cobros-01-02` remain on `origin`; they can be deleted.

## 2. Open items

- BUG-AGENDA-03 (rescheduling another class of the same series into a vacated original date
  merges both classes): diagnosed. The full fix (solution B: slot identity = original date,
  explicit reschedule `path` per slot, staged rollout behind a coach allowlist) is planned
  and waits for the owner's decisions before Stage 0. Separate branch; nothing implemented.
- BUG-ACCOUNT-01 … 04 (`docs/BUGS.md`): pending, on hold for the PaymentCard presentation
  decision.
- `PagoModal` reads the weekly calendar from `myClasses[0]` only; projections/renewals for
  students with several classes may be affected. Separate task.
- Next: keep identifying IziCoach bugs to fix before publishing a new version.
