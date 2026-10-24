SESSION_STATE.md — IziCoach

# Current task — BUG-COBROS-01 (Detalles de Pagos stepper blocked at 0)

Replaces the previous handoff (Auth + Data/Persistence, Phases A–D). That work is in
`origin/main` (`src/auth/`, `src/data/coachData.js`, `activeIdentityRef` in `App.jsx`, no
`window._iziUserId`); its history stays in Git.

## 1. Repo state

- Branch: `fix/cobros-stepper-no-calendar`, created from `origin/main` at `15b572d`
  ("fix: save selected combo payment date").
- One local commit with the fix and this documentation. **Not pushed, not merged, not
  deployed** — each needs the owner's explicit approval.

## 2. What was done

- Bug, cause, fix and tests: `docs/BUGS.md` → BUG-COBROS-01.
- Files: `src/payments/classPaymentLimits.js` (new), `src/payments/classPaymentLimits.test.js`
  (new), `src/App.jsx` (`PagoModal` only), `package.json` (`test` script, Node's built-in
  runner, no new dependency), `docs/BUGS.md`, `docs/SESSION_STATE.md`.
- Verified: `npm test` 8/8; `vite build` clean; `oxlint` 366 = baseline (no new warning);
  `git diff --check` clean.

## 3. Pending

1. Owner's real test in the browser: Alexia Monzon — the stepper reaches 10; after paying
   the 10: No pagadas 0, Pagadas 10, Realizadas 10, dates and attendance unchanged. Also a
   combo student with weekly days (expected unchanged).
2. Push / merge / deploy — only with explicit approval.
3. Next: keep identifying IziCoach bugs to fix before publishing a new version.

## 4. Known open items (not part of this fix)

- `PagoModal` still reads the calendar from `myClasses[0]` only; projections/renewals for
  students with several classes may be affected. Separate task.
- BUG-ACCOUNT-01 … 04 (`docs/BUGS.md`) remain pending, on hold for the PaymentCard
  presentation decision.
