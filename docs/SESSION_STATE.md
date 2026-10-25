SESSION_STATE.md — IziCoach

# Current task — Agenda: used, released dates, fused chains, add a day (branch `fix/combo-used-release-date`)

- Branch from `main` `79ea17c`, pushed for local QA; not merged, not deployed; no SQL, no migration.
  - `ca54ba0`: BUG-COMBO-01 (`used` by original date) and BUG-AGENDA-04 (release of a single-hop reprogrammed
    original date; renewal from it in Agenda and Cobros).
  - `070c582`: BUG-AGENDA-03 prevention (no reprogramming onto a date that would fuse two classes) and the
    "Separar clases fusionadas" repair in Detalles de Pagos (preview + confirmation, class row only, audit record).
  - `c5a0fa0`: pause/resume checks made precise (only this class and its students, only the involved dates, a
    planned resume only if it could take a freed date), dated messages.
  - `eb303e5`: FEATURE-AGENDA-01 "Agregar día al combo" — validated locally by the owner with a test coach account.
- Real case (Pato Ojeda): classes 3 and 7 fused on 02/10; the owner ran "Separar clases fusionadas" from localhost
  on 2026-10-25 (result OK: class 3 28/09→02/10, class 7 12/10→19/10, 26/10 freed). Owner's follow-up: register
  the 19/10 attendance and renew from 26/10 in Cobros (not confirmed here).
- Verified on `eb303e5`: `npm test` 92/92; `vite build` clean; `oxlint` 364 = main. Details: `docs/BUGS.md`.
- Pending, not implemented: BUG-AGENDA-05 (Editar clase "Solo esta clase" changes the whole class; a weekday
  change leaves the combo behind and drops past dates from the Agenda) — postponed by the owner.
- Next decision: merge the branch to `main` (automatic Production deploy) — separate authorization.

# Previous task — account isolation (device storage), closed

- Branch `fix/iso-device-storage` (from `main` `c241570`): BUG-ISO-01 (Chat groups per coach)
  and BUG-ISO-02 (legacy local copies: writes removed, `clearLegacyBusinessCaches()`
  implemented but not called). Details: `docs/BUGS.md`.
- Owner's manual check on the Mac (2026-10-25, `localhost:5173`, branch at `83df8a5`):
  - R1 validated: each coach's groups are stored under `izi_chat_groups:<coach uuid>` (two
    test coaches, two different keys); they survive logout/login; coach B never sees coach A's
    group and A sees only its own. (An earlier failed test ran `validate/cobros-01-02`, the old
    code.)
  - R2 validated: `izi_groups` is no longer written. Code check (2026-10-25, `c35da97`):
    in the production bundle the six legacy keys (`izi_students`, `izi_classes`, `izi_courts`,
    `izi_packages`, `izi_families`, `izi_expenses`) appear only in the preserved-keys list; no
    write and no read uses them (the old files `src/1App.jsx`, `6.jsx`, `7.jsx`,
    `8_funcional1.jsx`, `izicoach.jsx` still mention them but are not imported or bundled).
    Browser check on the Mac (2026-10-25, `c35da97`, read-only console snapshot + write
    watcher, nothing deleted): none of the six keys nor `izi_groups` existed before; after
    browsing Alumnos/Agenda/Cobros/Finanzas/Chat with coach A, logout and the same with coach
    B, all seven still do not exist. R2 validated for loading, browsing and logout/login; data
    edits were not exercised (Production accounts) and are covered by the code check and
    `localCaches.test.js`.
- Chat improvement (`c35da97`, pushed to the branch for validation): group chats show
  "N integrantes · Ver" in the header; "Ver" opens the member names in selection order (a
  deleted student reads "Alumno no disponible") with a close button; if saving the group on
  the device fails, the coach is warned on the confirm screen and the group is not added.
  Individual chats and the per-coach isolation are unchanged. Helper `src/chat/groupMembers.js`.
  Validated by the owner on the Mac (2026-10-25, `localhost:5173`).
- BUG-CHAT-03 mitigated (option D, `a0ffa53`): group chats hide the text field,
  send and 📢 buttons and show "El envío a grupos todavía no está disponible. Podés escribirle a
  cada alumno desde su chat individual."; no message query, Realtime subscription or
  mark-as-read call is made with a group id. Group creation, per-coach storage and members view
  kept; individual chats unchanged. No SQL. Future option (not implemented): broadcast to the
  members' individual chats (details in `docs/BUGS.md`). Validated by the owner on the Mac
  (2026-10-25, `localhost:5173`): group chat shows the notice with no input, send or 📢 button;
  members view works; individual chats unchanged.
- Closed 2026-10-25: `main` fast-forwarded to `79ea17c` and deployed by Vercel (Production success);
  no SQL, migration or data cleanup; R4 and the outbox untouched.
- Verified on the branch vs `main` `c241570`: `npm test` 41/41 (main 15/15); `vite build` clean
  on both; `oxlint` 364 problems on both, same warnings (no new one).
- Open risks before Production (merge to `main` = automatic Vercel deploy):
  - Chat groups remain device-local (not in Supabase): another device or browser, or cleared
    site data, shows no groups. Same as before.
  - Existing `izi_groups` on a device: a group is adopted only if every member is one of the
    coach's current students; a group with a deleted or foreign member stays hidden (kept,
    not deleted). Adoption runs when Chat opens: if the students list is still empty then,
    it waits for the next opening.
  - Group messages: sending is disabled (BUG-CHAT-03, option D); a coach who used groups loses
    nothing that worked, but cannot message a group until a broadcast is decided.
  - Individual `send` still ignores insert errors (separate, not changed).
  - The six legacy caches stay on devices that have them (not read, not removed) until
    `clearLegacyBusinessCaches()` is authorized.
  - Server-side identity check (R4) and outbox isolation tests are not done.
  - No SQL in this branch; do not run any migration while the migration history is out of
    sync (see below).
- Production RLS/grants/functions/trigger verified read-only (2026-10-25): they match the
  repository. Difference: `supabase_migrations.schema_migrations` stops at `20260915120000`
  although the effects of `20260929230000`, `20260930120000`, `20260930150000` and
  `20261001120000` are present (applied manually). Reconcile the history (migration repair)
  before any new migration — separate step, owner's authorization.
- Next, each separately authorized: outbox isolation tests (coachData with a mocked Supabase),
  the migration history repair, a separate Supabase test project (D5), R4 (CAS with
  `p_expected_coach_id`: SQL first, then client), and calling `clearLegacyBusinessCaches()`.
- BUG-CHAT-03: mitigated by option D; real group messages (broadcast) pending a product decision.

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
