SESSION_STATE.md — IziCoach

# Current state — no task in progress

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
