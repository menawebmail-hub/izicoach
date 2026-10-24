SESSION_STATE.md — IziCoach

# Current tasks — Cobros bugs before the next release

Replaces the previous handoff (Auth + Data/Persistence, Phases A–D). That work is in
`origin/main` (`src/auth/`, `src/data/coachData.js`, `activeIdentityRef` in `App.jsx`, no
`window._iziUserId`); its history stays in Git.

Each bug lives on its own branch from `origin/main` at `15b572d`. Nothing is merged into
`main` or deployed; push, PR, merge and deploy each need the owner's explicit approval.

Validation: both fixes are integrated on the local branch `validate/cobros-01-02` (from
`origin/main`, two `--no-ff` merges; only documentation conflicts, resolved keeping both
BUGS entries). Not pushed. Pending: the owner's visual/functional checklist before any merge
to `main`.

## 1. BUG-COBROS-01 — Detalles de Pagos stepper blocked at 0

- Branch `fix/cobros-stepper-no-calendar`, commit `ea11313`, **pushed** (no PR, no merge).
- Details: `docs/BUGS.md` → BUG-COBROS-01.
- Pending: the owner's real payment test with Alexia Monzon (stepper up to 10; after paying
  the 10: No pagadas 0, Pagadas 10, Realizadas 10).

## 2. BUG-COBROS-02 — Rescheduled dates show two badges

- Branch `fix/cobros-reprog-badges`, commit `8861712`, **pushed** (no PR, no merge).
- Files: `src/components/slotRowBadges.js` (new), `src/components/slotRowBadges.test.js`
  (new), `src/App.jsx` (`SlotGroup` only), `package.json` (`test` script), `docs/BUGS.md`,
  `docs/SESSION_STATE.md`.
- Verified: `npm test` 7/7; `vite build` clean; `oxlint` 366 = baseline.
- Pending: review; visual check of Pato Ojeda in Detalles de Pagos and in the Student Portal.

## 3. Merging both branches

Done on `validate/cobros-01-02`: code and `package.json` merged cleanly; `docs/BUGS.md` and
this file conflicted (documentation only) and were resolved keeping both BUGS entries.
`npm test` runs both suites together.

## 4. Known open items (not part of these fixes)

- `PagoModal` reads the weekly calendar from `myClasses[0]` only; projections/renewals for
  students with several classes may be affected. Separate task.
- BUG-ACCOUNT-01 … 04 (`docs/BUGS.md`) remain pending, on hold for the PaymentCard
  presentation decision.
- BUG-AGENDA-03 (reschedule into a vacated original date merges classes): diagnosed; the
  plan for the full fix (solution B, staged) is pending the owner's decisions. Separate branch.
- Next: keep identifying IziCoach bugs to fix before publishing a new version.
