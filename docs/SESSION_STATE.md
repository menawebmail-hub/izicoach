SESSION_STATE.md — IziCoach

# Current task — BUG-AGENDA-05 stage 2.0: attendance read in each slot's own class (branch `fix/agenda-edit-scope`)

- Committed as `f879be2` and pushed to `origin/fix/agenda-edit-scope` (2026-11-21); not merged, not deployed. On top of `7402d18`: `src/schedule/attendanceRead.js` (single
  reading: explicit attendance of that class and date -> [2.1 notice] -> nothing), fixed `resolveSlotGiven`, reader,
  history rows, `isComboClosed`, `PagoModal`. No notices, overrides, guests, recoveries, Reprogramar change, SQL or
  portal change. Details: `docs/BUGS.md` stage 2.0.
- Verified: `npm test` 151/151; snapshot unchanged; build clean; oxlint 364; harness unchanged + new jsdom PagoModal test;
  real account (read-only): 0 differences, no student with two classes on one day.
- Follow-up committed as `5201fbc` and pushed (2026-11-21); not merged, not deployed: (1) rows per combo + date with `comboIndex`/`sourceClassId`
  and every consumer reading the row of its own class (Agenda chip + replacement detection, Mis Clases per class card,
  release readings); (2) the paused-dates extension reads the combo's own class. 156/156, build clean, oxlint 364,
  new jsdom Mis Clases test (passes here, fails on `72cf5d4`), snapshot changed only by the two added row fields.
  Details: BUGS.md stage 2.0.
- Next: stage 2.1 (advance notices) only with separate authorization.

# Previous step — BUG-AGENDA-05 / BUG-AGENDA-03 stage 1d: reading per-student slot moves (branch `fix/agenda-edit-scope`)

- Committed as `608532b` and pushed to `origin/fix/agenda-edit-scope` (2026-11-21); not merged, not deployed. On top of `eca0224`: `src/schedule/slotMoves.js` (read-only support for
  `combo.slotMoves`, validity rules, per-combo `used`, unused planner), reader overlay + `allClasses`, `handleAttendance`
  recount through `countUsedForCombo` (+ guests with a move into the class/date). Nothing writes slotMoves; no UI, SQL
  or portal change. Without slotMoves everything reads as before (snapshot, harness, 0 differences on real data).
- Verified: `npm test` 142/142; build clean; oxlint 364. Details and pending adaptations: `docs/BUGS.md` stage 1d.
- Next (each with separate authorization): writers (recovery UI, advance notice, extension), `isComboClosed` and the
  other direct `combo.dates` readers, Agenda guest cards and the portal RPC are later stages.

# Previous step — BUG-AGENDA-05 stage 1: shared slot reader (branch `fix/agenda-edit-scope`)

- Committed as `6848b19` and pushed to `origin/fix/agenda-edit-scope` (2026-11-21); not merged, not deployed.
  `src/schedule/slotStatus.js` (helpers moved verbatim +
  `createSlotReader`), consumers switched (Cobros rows, counters, Por dar, PagoModal status). No visible change:
  characterization snapshot identical, 128/128, build clean, oxlint 364, harness failure set unchanged, 0 differences
  on the account's 81 real slots (read-only). Divergent "given" rules left as they are (see BUGS.md stage 1).
- Next: stage 1d (dormant slotMoves + per-combo used recount) only with separate authorization; merge/publication of
  stages 0-1 only with explicit authorization (no recoveries enabled).

# Previous step — BUG-AGENDA-05 phase 1 + stage 0 (branch `fix/agenda-edit-scope`, from `main` `9a26124`)

- Committed as `5db25f9` (code + tests) and `81c3bf8` (docs); pushed to `origin/fix/agenda-edit-scope` 2026-11-21; not merged,
  not deployed.
  No SQL, no data written.
  - Phase 1: "Solo esta clase" refuses days/time/court/title/students and writes only the occurrences.
  - Stage 0: 0.1 dates regenerated from the selected date (or today), no invented past dates, temporary block when a
    weekday change would leave future combo/individual dates without a card; 0.2 a student with payments, paid months,
    attendance or class history cannot be removed (no combo is cut or deleted); 0.3 edits never carry card state, never
    run Pausar/Cancelar, and "A Todas" merges only series fields. Details: `docs/BUGS.md` → BUG-AGENDA-05.
- Verified: `npm test` 119/119; `vite build` clean; `oxlint` 364 (baseline).
- Browser (2026-11-21, owner logged in, "Clase test", nothing saved): refusals and messages OK, revisions unchanged (83/158).
- Combo weekday block verified in the real Agenda UI with synthetic TEST data in the local jsdom harness (5/5, mutation
  check fails as expected); no account data used. Not verified: any real save.
- Approved rules for later stages (2026-11-21): per-student attendance and balance; Ausente – No dada recoverable;
  recoveries linked to one pending slot, pending until explicit Presente / Ausente – Dada; no publication of recoveries
  before the student portal shows them. Stages 0 and 1 may be published separately after validation and explicit
  authorization. Not now: `slotMoves`, `resolveStudentSlot`, recoveries, SQL.
- Next: push/merge/publication of stage 0 only with explicit authorization; then stage 1 (shared slot reader, no visible change).
- The docs corrections from 2026-11-20 (branch merged/deployed statuses) are in the same uncommitted diff.

# Last closed task — Agenda: used, released dates, fused chains, add a day (branch `fix/combo-used-release-date`)

- Branch from `main` `79ea17c`; no SQL, no migration. Integrated: `main` fast-forwarded to `9a26124` (= the
  branch tip; the merge date was not recorded) and reported deployed to Production by Vercel's automatic
  deployment. Check on 2026-11-20 (read-only): `app.izicoach.app` serves `assets/index-B3tA1xVw.js`, which
  contains "Agregar día al combo", "Separar clases fusionadas" and the BUG-CHAT-03 group notice; the Vercel
  deployment record itself was not checked (CLI token not authorized). No Production smoke of these features yet.
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
- Still to do by the owner on Production (test fixtures only): a smoke of "Agregar día al combo", the
  fused-chain prevention and "Separar clases fusionadas"; Pato Ojeda's 19/10 attendance and renewal from 26/10.
- The branch `fix/combo-used-release-date` is fully in `main`; it can be deleted (separate authorization).

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
- Open risks (in Production since `79ea17c`):
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
- The branches `fix/cobros-stepper-no-calendar`, `fix/cobros-reprog-badges`,
  `validate/cobros-01-02` and `fix/iso-device-storage` remain on `origin` and are already in
  `main`; they can be deleted.

## 2. Open items

- BUG-AGENDA-05 (Editar clase "Solo esta clase" changes the whole class; a weekday change leaves
  the combo behind and drops past dates from the Agenda): diagnosed, three corrections proposed
  in `docs/BUGS.md`, not implemented; postponed by the owner.
- BUG-AGENDA-03 (rescheduling another class of the same series into a vacated original date
  merges both classes): prevention and the "Separar clases fusionadas" repair are in `main`
  (`070c582`). The full fix (solution B: slot identity = original date, explicit reschedule
  `path` per slot, staged rollout behind a coach allowlist) is planned and waits for the
  owner's decisions before Stage 0. Separate branch; not implemented.
- BUG-ACCOUNT-01 … 04 (`docs/BUGS.md`): pending, on hold for the PaymentCard presentation
  decision.
- `PagoModal` reads the weekly calendar from `myClasses[0]` only; projections/renewals for
  students with several classes may be affected. Separate task.
- Next: keep identifying IziCoach bugs to fix before publishing a new version.
