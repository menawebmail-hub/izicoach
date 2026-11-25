# BUGS — IziCoach

## BUG-CHAT-01 — Student unread indicator missing for normal chat messages

**Status:** Fixed  
**Area:** Chat / Student Portal  
**Priority:** Low

### Description
When the coach sends a normal chat message to a student, the Student Portal does not show a red unread indicator.

The unread indicator currently appears only for alert messages (📢), not for normal chat messages.

### Expected behavior
A new unread normal message from the coach should produce an unread indicator in the Student Portal.

### Current behavior
Normal messages are received correctly, but no red unread indicator is shown.

### Notes
Confirmed as preexisting behavior and not caused by the Family changes.

Relevant code identified during investigation:
- `App.jsx` around lines 5541, 5687 and 5996.

### Fix
Added a dedicated `unreadChatCount` in `StudentApp`, mirroring the coach-side pattern that already used the `messages.read` column (previously only implemented for the student→coach direction):
- Initial count and Realtime increment for unread `from_coach:true && read:false` messages (`App.jsx` ~5534-5554).
- New effect marks those messages `read:true` and resets the count when the student opens the Chat tab (`App.jsx` ~5556-5562).
- Bottom-nav Chat dot now checks `unreadAlerts>0 || unreadChatCount>0` (`App.jsx` ~5996).

Scoped to `coach_id + student_id`; does not touch coach-side chat, Realtime filtering, RLS, or alert behavior.

Verified in browser: normal message shows the dot, opening Chat clears it, state survives reload, alert bell/banner behavior unchanged.

---

## BUG-CHAT-02 — Coach conversation list does not reorder in real time

**Status:** Fixed  
**Area:** Chat / Coach Portal  
**Priority:** Low

### Description
When a new message is received in an existing conversation, that conversation does not automatically move to the top of the coach's chat list.

### Expected behavior
The conversation with the most recent message should move to the top immediately.

### Current behavior
The new message appears correctly, but the conversation order is not updated until the page/chat is refreshed.

### Notes
`lastMsgTime` appears to be loaded only when the Chat component mounts.

Confirmed as preexisting behavior and not caused by the Family changes.

Relevant code identified during investigation:
- `App.jsx` around lines 3499–3507.

### Fix
`lastMsgTime` (the secondary sort key used when unread counts are tied) was only fetched once on `Chat` mount and never updated afterward. Scoped fix, both using functional `setState`:
- Active-thread Realtime listener now also updates `lastMsgTime[studentId]` with `payload.new.created_at` when a message arrives for the open conversation (`App.jsx` ~3520-3524).
- `send()` now updates `lastMsgTime[active.id]` with the current timestamp after a successful insert (`App.jsx` ~3526-3534).

No global list-level listener was added — a conversation that is neither active nor already leading on unread count may still lag in the tiebreak order until the list remounts. Does not touch `unreadChats`, read-state logic, active conversation state, or BUG-CHAT-01.

Verified in browser (no reload): student message to the active conversation moves it up on return to list; coach-sent message to a non-active, zero-unread conversation moves it to the top of its tier; unread counts (e.g. existing "3" badge) unaffected; production build clean.

---

## BUG-ACCOUNT-01 — `computeAccountStats` counts paused/cancelled dates as unpaid

**Status:** Pending — fix on hold, see Notes  
**Area:** Student Portal (`StudentApp`)  
**Priority:** Medium

### Description
`computeAccountStats` (`App.jsx:5613-5637`), used for the student's own "Estado de Cuenta" and for each child in "Mi Familia", does not exclude `isPaused`/`isCancelled` dates when computing `noPagada`/`pagada`. `getAccountCounters` (the reference implementation used by PaymentCard/Cobros) does exclude them.

### Expected behavior
A paused or cancelled class date should not be counted as "Pendiente" (unpaid) in the Student Portal, matching how Cobros treats the same date.

### Current behavior
A paused class shows up as unpaid debt ("Pendiente") in the Student Portal, even though Cobros does not count that same date as unpaid or paid at all.

### Notes
Confirmed during the C1+C2 investigation (read-only, no code changed). Fix is on hold pending a product decision between two PaymentCard presentations (`No pagadas | Pagadas | Restantes` vs. adding `Realizadas`) — this bug must be fixed regardless of which option is chosen, since it affects the underlying calculation, not the box layout.

Relevant code:
- `App.jsx:5613-5637` (`computeAccountStats`)
- Compare with `App.jsx:360-433` (`getAccountCounters`, the correct reference)

---

## BUG-ACCOUNT-02 — `computeAccountStats` marks non-given past classes as "Realizada"

**Status:** Pending — fix on hold, see Notes  
**Area:** Student Portal (`StudentApp`)  
**Priority:** Medium-High

### Description
In `computeAccountStats` (`App.jsx:5613-5637`), the `realizada` count is computed as:
```js
realizada: deduped.filter(d=>d.isGiven||d.date<=TODAY_DATE).length
```
The `||d.date<=TODAY_DATE` clause counts a date as "Realizada" purely because it's in the past, even when `isGiven` was explicitly computed as `false` for that same date (e.g. a class marked "Ausente — No Dada" / `ausente_reprog`).

### Expected behavior
A past class explicitly marked as not given (needs reschedule) should not be counted as "Realizada" — should match `getAccountCounters`'s `realizadas`, which correctly excludes it.

### Current behavior
The student/family can see a class as "Realizada" that the coach has recorded as pending reschedule — the two portals can disagree about whether a specific class actually happened.

### Notes
Most consequential of the four findings — it's a genuine factual disagreement between what the coach recorded and what the student sees, not just a cosmetic difference. Fix on hold for the same reason as BUG-ACCOUNT-01 (pending product decision on box layout), but the calculation bug itself is independent of that decision.

Relevant code:
- `App.jsx:5613-5637` (`computeAccountStats`)

---

## BUG-ACCOUNT-03 — Mis Alumnos mini "ESTADO DE CUENTA" panel has the same paused/cancelled gap as BUG-ACCOUNT-01

**Status:** Pending — fix on hold, see Notes  
**Area:** Mis Alumnos (`Students` component, expanded student panel)  
**Priority:** Medium

### Description
The 4-column mini summary in the expanded "VER PAGOS" panel (`App.jsx:1943-1989`) computes `isPaid`/`isGiven` from raw combo dates with no `isCancelled`/`isPaused` exclusion at all — same gap as BUG-ACCOUNT-01, in a separate independent calculation.

### Expected behavior
Paused/cancelled dates should not count toward "No Pag." / "Pagada" in this panel, consistent with Cobros.

### Current behavior
A paused or cancelled class inflates "No Pag." or "Pagada" in Mis Alumnos even though the same date is excluded from those buckets in PaymentCard/Cobros for the same student.

### Notes
Confirmed during the C1+C2 investigation. Also noted in passing: `statusLabel`/`statusColor` (`App.jsx:1941-1942`, values like "A cobrar"/"Al día"/"Programadas") are computed but never rendered anywhere — dead code, not a live inconsistency, left untouched per this task's scope (no fixes yet).

Relevant code:
- `App.jsx:1943-1989` (mini "ESTADO DE CUENTA" panel)
- Compare with `App.jsx:360-433` (`getAccountCounters`)

---

## BUG-ACCOUNT-04 — Inconsistent "today" boundary across the three account calculations

**Status:** Pending — fix on hold, see Notes  
**Area:** Cobros / Mis Alumnos / Student Portal (cross-cutting)  
**Priority:** Low

### Description
Three different comparisons decide whether a date counts as "past" or "future":
- `getAccountCounters` (Cobros, reference): `isClassDone(date, timeEnd)` — time-of-day aware, with a 30-minute margin after class end.
- `computeAccountStats` (Student Portal): `date<=TODAY_DATE` / `date>TODAY_DATE` — plain date comparison, no time of day.
- Mis Alumnos mini panel: `date<TODAY_DATE` / `date>=TODAY_DATE` — plain date comparison, opposite inclusive/exclusive boundary from the Student Portal's.

### Expected behavior
The three surfaces should agree on whether "today's" class (before/after it happens) counts as past or future.

### Current behavior
For a class scheduled today, the three surfaces can disagree on whether it's already "done" depending on the time of day the coach/student/family checks, and Mis Alumnos vs. Student Portal use opposite boundary inclusivity even for date-only comparisons (ignoring time of day).

### Notes
Lowest priority of the four — only manifests same-day, and only shifts one date between adjacent buckets rather than misrepresenting payment/attendance facts. Documented for completeness per the C1+C2 investigation; fix on hold along with the other three, pending the product decision on final box layout.

Relevant code:
- `App.jsx:360-433` (`getAccountCounters`, uses `isClassDone`)
- `App.jsx:5613-5637` (`computeAccountStats`)
- `App.jsx:1943-1989` (Mis Alumnos mini panel)

---

## BUG-ATT-01 — `handleAttendance` can increment `combo.used` multiple times for the same class/date

**Status:** Fixed  
**Area:** Agenda / Attendance persistence  
**Priority:** Medium

### Description
`handleAttendance` (`App.jsx:6794-6810` at time of writing) increments `combo.used` by 1 for every student in `givenIds` (`present` + `ausente_dada`) each time it runs, without checking whether that same date was already counted as "given" for that student in a previous save. The `attendanceLog` entry itself is correctly replaced per date (`filter(e=>e.date!==classDate)` before pushing the new entry), but the separate `combo.used` counter is not reconciled against that replacement — it only ever adds, never corrects.

### Expected behavior
Saving attendance for the same class/date more than once (e.g. coach corrects a mismarked student, or an occurrence's attendance is edited after the fact) should leave `combo.used` reflecting the current/final state for that date — incremented at most once per date/student, not once per save.

### Current behavior
Each "Guardar asistencia" call for the same date adds +1 to `combo.used` for every currently-given student, regardless of whether a prior save already counted that same date. Repeated edits to the same occurrence's attendance inflate `used` beyond the true number of classes given.

### Notes
Found while manually verifying the Agenda attendance chip feature: marked a student absent then reverted to presente (two saves for the same date) and noticed `used` is not idempotent per date. Confirmed by code reading, not by inspecting raw Supabase state.

Low practical impact observed in that specific case (individual 1-class combo, already resolved, no remaining class in that combo affected), but the underlying combo-used accounting bug is real and could affect combo-completion/auto-renewal logic (`allGiven` check in the same function) for combos with more classes remaining. Not caused by and unrelated to the attendance chip UI work — pre-existing behavior in `handleAttendance`.

Relevant code:
- `App.jsx:6794-6810` (`handleAttendance`, the `used` increment and `attendanceLog` replacement)

### Fix
`handleAttendance` now builds `mergedLog` once (the same merged `attendanceLog` entry used for both the class-log write and the recount below), then:
1. **Correct combo targeting** — instead of always assuming `combos[combos.length-1]`, it searches `s.combos` from newest to oldest for the combo whose `dates` (or legacy singular `date`) actually contains `classDate`. If more than one combo unexpectedly matches, the most recent one wins. Falls back to the last combo only when no combo contains the date, preserving prior behavior for that case.
2. **Idempotent `used`** — `used` is recalculated from scratch each save by counting, over the target combo's own dates, how many have a `mergedLog` entry with the student in `present` or `ausente_dada`. No longer an unconditional `+1`, so repeated saves or status changes for the same date can't drift.
3. **Business rule unchanged, now applied correctly** — `present` and `ausente_dada` consume (count toward `used`); `ausente_reprog` does not (never appears in the recount condition), including the case where a class flips from a "given" status back to `ausente_reprog` — `used` now correctly decreases, which it never did before.
4. **No spurious auto-renewal** — the "combo complete → generate next combo" check now only runs when the updated combo is the student's current/last one (`lastIdx===combos.length-1`). Editing attendance on an older, already-superseded combo can no longer trigger it.

Does not touch `getAccountCounters`, `getRem`, `AttModal`, payment logic (`PagoModal`), or combo data structure.

**Verification performed:** repeated saves on the same date (fixed a real corrupted `used:2` on a `total:1` combo, corrected to `1`, in the running app); Presente↔Ausente-Dada (no duplication); Presente↔Ausente-No Dada and back (used now correctly decreases then increases); all confirmed end-to-end against the running app via `localStorage.izi_students`. Combo-targeting logic (multi-combo after renewal, individual+combo coexistence, duplicate-date tiebreak, no-match fallback) verified by running the exact selection algorithm against synthetic data in-browser, since no student in the current dataset has multiple simultaneous combos. Production build clean after the change.

---
## BUG-COBROS-01 — Detalles de Pagos stepper blocked at 0 for students whose first class has no weekly days

**Status:** Fixed — in `main` (`83740a4`) and deployed (2026-10-24); the coach's real payment test on Production is still pending  
**Area:** Cobros → Detalles de Pagos (`PagoModal`, class payments)  
**Priority:** High

### Description
In `PagoModal`, `classHasNoCalendar` is computed from the days of the student's FIRST class only (`myClasses[0].days`, `App.jsx:6673`/`6684` at time of writing). When that class has no weekly days — an Individual class with a fixed date, or a student who belongs to several classes and whose first one has no days — the modal capped the stepper at 0 (`maxUnpaid=classHasNoCalendar?0:payableRows.length`), disabled "+", showed "Esta clase no tiene días configurados…" and refused the review and the confirmation, even with real pending classes to pay.

### Expected behavior
Classes that already exist and are pending (given or not) can be paid even when the class has no weekly days: the stepper goes up to the real pending rows, and the payment pays exactly those rows. The weekly calendar matters only when new dates are generated.

### Current behavior (before the fix)
Real case: Alexia Monzon (Individual classes, member of several groups) showed 10 No pagadas / 0 Pagadas / 10 Realizadas, the stepper stuck at 0 with "+" disabled, amount 0, "Confirmar pago" disabled, and the no-calendar warning.

### Notes
The block was added by `f057fcf` ("guard recurring classes without valid days") to stop the date generators from scanning forever without a valid weekday. Paying existing rows never generates dates: the stepper is capped at `payableRows.length` and `handleConfirm` writes exactly `payableRows.slice(0,qty)`; `buildProjectedDates` already returns `[]` when there is no valid weekday. So the guard was broader than needed on this screen.

Still open, out of scope here: `myClasses[0]` alone also drives projections/renewals for students with several classes. The renewal guard in the Agenda (`handleRenovar`, same message) is unchanged.

Relevant code:
- `App.jsx:6673`/`6684` (`classDays`, `classHasNoCalendar`)
- `App.jsx:6821` (`payableRows`: pending or given-unpaid, not cancelled, not paused)
- `App.jsx:6828` (`classPayment`), `App.jsx:7332` (stepper cap)
- `App.jsx:6920` (`selectedRows=payableRows.slice(0,qty)` in `handleConfirm`)
- `src/payments/classPaymentLimits.js`

### Fix
- New pure helper `src/payments/classPaymentLimits.js`:
  - `classPaymentLimits({payableCount, classHasNoCalendar})` → `maxClasses` = real pending rows; `blockedByNoCalendar` only when the class has no calendar AND there is nothing to pay.
  - `isPayableClassQuantity(qty, payableCount)` → a quantity must be ≥ 1 and ≤ the CURRENT pending rows.
- `PagoModal`: the stepper cap and "+" use `classPayment`; the warning and the two refusals (`handleGoToReview`, `handleConfirm`) use `classPayment.blockedByNoCalendar`; both write paths also refuse a quantity above the current pending rows (a stale quantity is never paid silently with fewer classes for the same amount).
- Unchanged: date generation, attendance, renewals, combos, projections, account counters (`getAccountCounters`), the payment write (`payableRows.slice(0,qty)`), the UI design.

**Verification performed:** `npm test` (new script, Node's built-in runner, no new dependency): 8/8 regression tests in `src/payments/classPaymentLimits.test.js` — Individual classes without weekly days (10 payable, 11 refused), a student in several classes whose first class has no days, a class with days (unchanged), no calendar + nothing pending (still blocked), malformed counts, stale/duplicate quantities refused, and a source check that `PagoModal` uses the limits (it FAILS against the code before the fix). `vite build` clean; `oxlint` 366 = baseline, no new warning; `git diff --check` clean. **Not verified in a browser or with real data** (the session could not open the app): the coach tests Alexia's real payment (expected after paying 10: No pagadas 0, Pagadas 10, Realizadas 10) and a combo student with weekly days (expected unchanged).

---

## BUG-COBROS-02 — Rescheduled dates show two badges ("Reprogramada" and "Pagada")

**Status:** Fixed — in `main` (`83740a4`) and deployed (2026-10-24)  
**Area:** Cobros → Detalles de Pagos and Student Portal (`SlotGroup`, presentation only)  
**Priority:** Medium

### Description
In Detalles de Pagos (real case: Pato Ojeda), each date of a reschedule chain showed two badges: the state ("🔄 Reprogramada") and the payment ("✓ Pagada"). The Student Portal uses the same `SlotGroup` and showed the same.

### Expected behavior
One badge per date of a reschedule chain:
- original and intermediate dates: only "🔄 Reprogramada";
- final date, done and paid: only "✓ Pagada";
- any other final state: unchanged;
- dates that were never rescheduled: unchanged (state + payment).
This applies to chains of any length.

### Current behavior (before the fix)
`buildSlotHistoryRows` (`App.jsx:930` at time of writing) repeats the slot's display-paid status on every step of the chain (`isPaid:!!displayPaid`, by design since `07a03e6`), and `SlotGroup` (`App.jsx:2157`) drew the state badge AND the payment badge on the numbered original row and on every "↳" step.

### Notes
How the chain is identified (unchanged): `item.historyRows` comes from `slot.reschedulePath` (original → … → final); depth 0 is the numbered original row; `isTerminal` marks the final step, whose `status` is its real state (done, scheduled, paused, cancelled, pending). A slot is rescheduled when `historyRows.length>1`.

Relevant code:
- `App.jsx:930` (`buildSlotHistoryRows`, unchanged)
- `App.jsx:2157` (`SlotGroup`), `2163` (main row), `2183` (steps)
- Callers: `App.jsx:7486` (`PagoModal`), `App.jsx:9021` (`StudentApp`)
- `src/components/slotRowBadges.js`

### Fix
- New pure helper `src/components/slotRowBadges.js`: `slotRowBadges({rescheduled, isTerminal, status, paid})` → which of the two badges a row shows, following the rules above.
- `SlotGroup` draws the main row and each step through it; `paid` for a step stays `h.isPaid||paidNow` (a final date being paid right now reads "✓ Pagada").
- Unchanged: `buildSlotHistoryRows` and all data (`isPaid`, `displayPaid`, `payableRows`), payments, attendance, dates, reschedule logic, account counters and labels.
- Visual adjustment after the owner's local test (approved): a hidden payment badge leaves an invisible pill of the same size (`visibility:hidden`, `aria-hidden`), so a lone "🔄 Reprogramada" stays in the class-state column next to "✓ Realizada" instead of shifting under "✓ Pagada". "Reprogramada" now reuses the app's existing orange (`#FFF3E0` / `#E65100`, the same tokens as "Pausada"; owner decision) from `SLOT_BADGES.reprogrammed`, which the main rows of Detalles de Pagos and the Student Portal also read. Other states keep their colors.

**Verification performed:** `npm test` (Node's built-in runner, no new dependency): 7/7 regression tests in `src/components/slotRowBadges.test.js` — one reschedule, multiple reschedules, intermediate dates paid or not, other final states unchanged, a final being paid now, never-rescheduled dates unchanged, and a source check of `SlotGroup` (it FAILS against the code before the fix). `vite build` clean; `oxlint` 366 = baseline, identical output. **Not verified in a browser or with real data** (the session could not open the app): check Pato Ojeda in Detalles de Pagos and in the Student Portal.

---

## BUG-ISO-01 — Chat groups shared between coaches on the same device

**Status:** Fixed — in `main` (`79ea17c`) and deployed (2026-10-25)  
**Area:** Chat (`Chat`, `CreateGroupScreen`) / device storage  
**Priority:** Medium

### Description
Chat groups lived only in one shared localStorage key, `izi_groups` (not per coach, not in `coach_data`). It was removed only on an explicit logout or signup — not on login and not when a session expired.

### Expected behavior
A coach never sees another coach's groups. Groups are kept per coach on the device (they exist nowhere else) and survive logout. No group is attributed to a coach by assumption.

### Current behavior (before the fix)
If coach A's session expired (or A closed the browser without logging out) and coach B logged in on the same browser, B's Chat listed A's groups (names, member ids). Every logout also deleted all groups.

### Notes
Found in the account-isolation audit (2026-10-25). Production RLS/grants verified read-only the same day and match the repository; this was device storage only. Student ids are `Date.now()` values, so an id shared by two coaches is practically impossible.

Relevant code:
- `App.jsx:6440` (`Chat` groups state), `App.jsx:6516` (group creation), `App.jsx:11679` (`<Chat key=…>`)
- `src/chat/chatGroupsStorage.js`, `src/data/localCaches.js`, `src/data/coachData.js:97` (`clearLocalStateExceptOutbox`)

### Fix
- `src/chat/chatGroupsStorage.js` (new, pure, storage injected): groups under `izi_chat_groups:<coachId>`. Legacy `izi_groups` groups are adopted only when the member list is non-empty, every member is a valid id and every id is one of the coach's students; anything else (no members, an unknown/foreign member, a malformed group, a corrupt key) stays in the legacy key, neither shown nor deleted. Adopted groups are written to the coach's key before leaving the legacy key (a failed write loses nothing); the legacy key is removed only when empty.
- `Chat` loads/saves through it; `<Chat key={user?.id||"no-user"}>` starts a fresh Chat state for every identity (login, expired session, account switch).
- Session cleanup (`clearLocalStateExceptOutbox` → `clearLocalStateExceptPreserved`) keeps `izi_outbox:*`, `izi_chat_groups:*` and the legacy `izi_groups`. **Behavior change:** groups are no longer deleted on logout.

**Verification performed:** `npm test` 29/29 (`src/chat/chatGroupsStorage.test.js`: per-coach keys, adoption, every ambiguous case left untouched, a mixed legacy key split between two coaches, idempotence, corrupt data, failed write; `src/data/localCaches.test.js`: cleanup rules and a source check of the app wiring, which FAILS against the previous code). `vite build` clean; `oxlint` 366 = baseline. **Not verified in a browser** (manual check: two test coaches on one device).

---

## BUG-ISO-02 — Obsolete local copies of a coach's business data

**Status:** Partially fixed — in `main` (`79ea17c`) and deployed (2026-10-25): writes removed; existing copies kept pending authorization  
**Area:** Device storage (`App` setters)  
**Priority:** Low–Medium

### Description
Every change wrote full copies of the coach's data to non-namespaced localStorage keys — `izi_students`, `izi_classes`, `izi_courts`, `izi_packages`, `izi_families`, `izi_expenses` — that no active code reads (the data lives in `coach_data` and the per-coach outbox).

### Expected behavior
No unnecessary personal data at rest on shared devices; nothing unsynced is ever lost.

### Current behavior (before the fix)
The copies of the last coach stayed on the device until an explicit logout (then the cleanup deleted them), surviving expired sessions and the next coach's login.

### Notes
Verified that no active route reads them (the app loads only `App.jsx`, `AuthProvider`, `AdminApp`; the only generic localStorage readers are the outbox and the cleanup). A device whose last session ran an app version from before the outbox (mid-September 2026) might hold old unsynced changes in them; the current app ignores them.

### Fix
- The 11 writes (8 places) and the unused `lsSet` helper are removed from `App.jsx`.
- `clearLegacyBusinessCaches(storage)` in `src/data/localCaches.js` removes exactly those six keys (never by prefix, never an outbox entry or a Chat group). **Not called by the app** (owner decision 2026-10-25): existing copies are not deleted.
- **Behavior change:** the session cleanup now preserves those six keys too, so a logout no longer deletes them (before, it did). Removing them needs the owner's authorization to call `clearLegacyBusinessCaches()`.

**Verification performed:** `npm test` 29/29 (`src/data/localCaches.test.js`: exactly six keys removed, pending outbox entries untouched, groups and other keys kept, never imported/called by the app). `vite build` clean; `oxlint` 366 = baseline.

---

## BUG-CHAT-03 — Group chat messages are never saved

**Status:** Mitigated (2026-10-25, option D: group sending disabled). Real group messages: not implemented  
**Area:** Chat (`Chat` in `App.jsx`, `src/chat/groupMembers.js`)  
**Priority:** Medium

### Description
Opening a Chat group used the group as if it were a student: `active.id` = the group id (`"g…"`, a string), while `messages.student_id` is `bigint` (confirmed in Production, read-only, 2026-10-25). As a result:
- sending inserted `student_id = "g…"`; Postgres rejected the row and `send` does not check the error, so the text disappeared without a warning;
- an alert (📢) also added a local notification, so the coach believed it had been sent;
- opening the group ran a history query and `mark_coach_messages_read` with the group id; both failed silently (empty history, error only in the console);
- students never received anything; groups exist only on the coach's device.

Messages are one table, `messages` (`coach_id` uuid, `student_id` bigint, `text`, `from_coach`, `read`, `is_alert`, `created_at`); every row is one coach ↔ one student conversation. RLS (`20260911142144`): the coach reads/inserts only rows with its own `coach_id` (insert also `from_coach = true`); a student only rows matching its `student_auth` pair; no UPDATE/DELETE (read flags through `mark_coach_messages_read(bigint)` / `mark_student_messages_read()`).

### Mitigation (option D, no SQL)
- `isGroupChat(target)` (`src/chat/groupMembers.js`): a target flagged `isGroup` or carrying `members`.
- In a group chat the text field, send button and 📢 button are hidden and the coach sees: "El envío a grupos todavía no está disponible. Podés escribirle a cada alumno desde su chat individual."
- For a group, no message query, no Realtime subscription for the group, no `mark_coach_messages_read` call and no unread reset; `send()` refuses a group.
- Kept: group creation, per-coach storage (BUG-ISO-01), members view. Individual chats unchanged.
- Tests: `src/chat/groupMembers.test.js` (a group never reads, subscribes, marks or sends; individual chat calls unchanged).

### Possible future improvement (not implemented)
Broadcast to members: one message per member in their individual chat with the coach, sent in a single insert (all rows or none), only to members who are still the coach's students. Needs no schema or RLS change (`coach_insert_own_messages` already allows it); each student sees only their own copy. Limits: no group history from Supabase (only a device-local copy, if wanted); a student cannot tell it was a group message. Needs product decisions first (broadcast vs shared conversation, alerts in groups, where replies go). A group history marker (new column) or real group tables would need a migration, blocked until the migration history is repaired and a test project (D5) exists.

### Related (separate)
The individual `send` also ignores the insert error: a failed individual message (e.g. a blocked coach) is lost without a warning. Not changed here.

---

## BUG-COMBO-01 — `combo.used` counts a reprogrammed class by its original date

**Status:** Fixed — `ca54ba0`, in `main` (`9a26124`) and reported deployed  
**Area:** `handleAttendance` (used recount), `PagoModal` (given count at payment)  
**Priority:** High

### Description
A class reprogrammed and given on another date (Pato Ojeda: 26/10 → 02/10) never counted in `used`: the attendance recount looked up attendance ON `combo.dates` (the original 26/10), and the payment count skipped any original date after today. `used` stayed 7/8 while Cobros (Realizadas, terminal-aware) read 8/8, which hid "¡Pago registrado! → Renovar Combo" and kept Editar clase treating the combo as active.

### Fix
- `countAttendedSlots` (`src/schedule/releaseReprogrammedDate.js`): each slot is read on the terminal of its reschedule chain in that series, by explicit attendance only (present / ausente-dada); each terminal counts once; paused or "A Reprogramar" terminals never count. Dates without a chain count exactly as before.
- `PagoModal`: a slot counts once its fulfillment date (`getSlotFulfillmentDate`, the destination for a reprogrammed slot) is today or earlier.
- The chain walk (`resolveRescheduleChain`, `resolveComboDateStatus`, `traceRescheduleHistory`) moved verbatim to `src/schedule/rescheduleChain.js`.

### Tests
`src/schedule/releaseReprogrammedDate.test.js`, `src/schedule/patoRelease.test.js`, `src/schedule/releaseWiring.test.js`.

---

## BUG-AGENDA-04 — The original date of a class already given elsewhere stays blocked

**Status:** Fixed — `ca54ba0`, in `main` (`9a26124`) and reported deployed  
**Area:** Agenda (grey cards, "Renovar Combo desde esta fecha"), Cobros (both renewal buttons)  
**Priority:** High

### Description
`dateCancellations` is keyed by DATE, so `dateCancellations["2026-10-26"] = {cancelled_reprog → 2026-10-02}` is both the history of the class moved to 02/10 and the state of Monday 26/10. The 26th stayed a green "Reprogramada" card (not grey, no renewal), Cobros renewed from 28/10, and a combo starting on the 26th would have read that entry as its own (the 02/10 class counted twice, the new combo born 1/8). Same root as BUG-AGENDA-03 (date used as key); fixed narrowly, without plan B.

### Rule
An original date is released when all of this holds: one direct reprogramming to a live destination; nothing else arrived at either date; the date is today or later and has no attendance; every affected student has EXPLICIT attendance (present / ausente-dada) on the destination — the passing of time is never proof; every other slot of the affected combo is settled and before the date; no active pause on the date or its destination, no resume operation of the affected combos on them, and no pending planned resume that could take the freed date (resume date on or before it); the destination is not already a date of the combo; exactly one combo per student holds the date; no later combo of the series exists; and no slot changes its paid / displayed / given state (checked with `buildPersonSlotRows`, for the final and for the half-written state).

### What the release writes
1. **Students first:** the slot keeps its POSITION in `combo.dates` (payments are assigned by position, so re-sorting would move them) and takes its real date; `slotRelocations: [{id, from, to, classId, at}]`; `used` = max(used, explicit attendance count). Total, payments, paidCount, amount: untouched.
2. **Then the class:** `dateCancellations[date]` is removed only while it still says exactly that reprogramming; the destination joins `occurrences` (its card and attendance stay); `releasedReschedules: [{id, date, destination, entry, at}]` keeps the removed entry.
3. **Then the renewal** from the released date (`buildRenewalDates`, the same rule as Cobros, on the series' days; refused if it would not start on the date, or if one of its dates already carries a pause or reprogramming of the class), with `sourceClassId`.

A half-done release (students saved, class not) counts nothing twice and is completed by the next attempt or by the recovery effect in App, idempotently, only when the classes queue is settled; a date that changed meanwhile is never touched.

### Tests
Pato regression on the real App functions with "today" = 25/10/2026: 26/10 grey, 28/10 grey, new combo 0/8 from 26/10, previous combo 8/8, payments unchanged for 8, 5, 3 and 0 paid, two students, partial write and recovery, and every refusal (`src/schedule/patoRelease.test.js`).

---

## BUG-AGENDA-03 — Reprogramming onto a date with its own entry fuses two classes (prevention + repair)

**Status:** Prevented and repairable — `070c582` + `c5a0fa0`, in `main` (`9a26124`) and reported deployed; the full fix (plan B, slot identity by original date) is still pending  
**Area:** `CancelReprogModal` / `handleSaveClass` (prevention), Detalles de Pagos (repair)  
**Priority:** High

### Description
`dateCancellations` is keyed by DATE. Reprogramming a class onto a date that already has its own entry makes the chain walk continue through it, so two contractual classes end on one date. Real case (Pato Ojeda, Mon/Wed): class 3 28/09 → 19/10 → 02/10 and class 7 12/10 → 26/10 → 19/10 → 02/10 both read "given on 02/10" (8/8 shown, 7 classes recorded) and Monday 26/10 stayed blocked. The coach confirmed both 19/10 and 02/10 classes happened.

### Prevention
`rescheduleDestinationConflict` (`src/schedule/fusedChains.js`), in the reprogramming modal (message + disabled confirm) and again in `handleSaveClass` against the latest state. A dated reprogramming is refused when the destination already has an entry in this series, is another reprogramming's destination, has attendance recorded, or is an own class date of a student who holds the moved class. Free dates and grey dates after the package stay allowed; group classes are not blocked by another student's dates; "Mover al final del paquete" keeps its own guard.

### Repair: "Separar clases fusionadas" (Detalles de Pagos)
Shown when two classes of the student end on one date. Preview (before/after of both chains, attendance on both dates, freed dates), explicit confirmation, one write on the class row only:
- the earlier original keeps the shared terminal and skips the shared step (28/09 → 02/10);
- the later original ends on the shared step (12/10 → 19/10); its own steps from today on are freed (26/10), earlier ones stay;
- applied only while every touched entry still equals the preview (re-planned on the latest state right before writing); idempotent;
- `class.chainRepairs` keeps {id, kind:"split-fused", at, slots from/to, before, after, freedDates, attendance}.
Combos, payments, amounts and attendance are never written. Attendance is per date, so it stays where it was; the 19/10 attendance is reported, never assumed (classes with explicit attendance: 7 → 7 until it is registered). Refused for three or more classes on one date, a class that was already living on the date, an active pause on an involved date, a resume operation of THIS class on an involved date, a pending planned resume that could take a freed date, or other references to the shared step. Pauses and resumes of other classes or other students never block it; every refusal names its date.

### Tests
`src/schedule/fusedChains.test.js` (fictitious data shaped exactly like the reported case, real App functions), `src/schedule/fusedWiring.test.js`.

---

## FEATURE-AGENDA-01 — "Agregar día al combo"

**Status:** Implemented — `eb303e5`, in `main` (`9a26124`) and reported deployed. Validated locally by the owner with a test coach account (2026-10-25); no Production smoke yet  
**Area:** Agenda (class menu), `src/schedule/comboDayAddition.js`

### Behavior
From the class menu, "➕ Agregar día al combo" (classes with a current combo). The coach picks a date and sees the preview: date added, date removed per student (the last eligible future date of the combo), total and price unchanged. Confirming writes one students write for every combo student of the class, then the class (the date joins `occurrences`, `addedDates` keeps the record); `combo.dateAdditions` keeps {date, removed, classId}. Nothing is applied to only part of the students; the write re-validates the exact preview; a missing class part is completed by the recovery effect.

### Refused
Past dates; dates already in the combo, with an entry or an arriving reprogramming, or with attendance; no eligible date to remove after the new one; an active pause in the combo, a pending planned resume or a resume date; mensual or individual students in the class; more than one current combo for a student; and any change in which classes read paid (partly paid combos: the new date must come after the last paid class).

### Never removed
Past dates, dates with attendance, reprogrammed or arriving dates, resume (paused/replacement) dates.

### Tests
`src/schedule/comboDayAddition.test.js` (unpaid, partly paid, fully paid, group, refusals, partial write and recovery), `src/schedule/comboDayWiring.test.js`.

---

## BUG-COBROS-07 — Historial de Pagos shows original class dates; Detalles counters 0 for a completed combo; final date hides "Realizada"
**Status:** fixed on branch `fix/payment-history-dates` (from `main` `fbc575e`), committed locally 2026-11-24, NOT pushed, NOT deployed  
**Area:** PaymentCard → Historial de Pagos / Compartir, PagoModal (Detalles de Pagos), `slotRowBadges`  
**Priority:** Medium

### Root causes (real case: Pato Ojeda, class 4 reprogrammed 04/11 -> 23/11)
- A. `payments[].dates` stores the paid slots' contractual dates (their identity); Historial de Pagos and the comprobante (preview + shared image) drew them as-is, never through the slot reader Detalles uses.
- B. PagoModal lists `getVisibleClassEntitlements` (a completed, not archived combo stays listed) but its counters came from `getAccountCounters`, which counts only `getCountedClassEntitlements` (closed combos excluded) -> 0 / 0 / 0.
- C. `slotRowBadges` (BUG-COBROS-02) hid the state badge of a final date that was done and paid ("Pagada" only).

### Fix
- A. `paymentDateChains(student, payment, cards)`: each stored date read with `createSlotReader`; a reprogramming with a destination (chains, recoveries) yields its whole path. Historial and Compartir (preview and image) draw it like Detalles de Pagos: one number, the original date, then "↳" each later date in green, "Pagada" only on the final date; a class never reprogrammed is unchanged. History entries carry their `comboIndex`; the class is also found by `sourceClassId` (archived combos, student no longer on the roster). The panel and Compartir use the same dates; the stored payment (dates, fecha de pago, monto, forma de pago, cantidad) is never changed.
- B. `getAccountCounters(s, classes, {closedVisibleFallback:true})`, used only by PagoModal: when no open combo/individual exists, it counts the visible closed ones (Pato: 8 Pagadas / 8 Realizadas / 0 Restantes). With an open combo the result is identical to Cobros; Cobros and the card are unchanged; the progress bar keeps its previous rule (only with an open combo).
- C. `slotRowBadges({..., showFinalState})`, passed only by PagoModal's SlotGroup: original/intermediate dates keep only "Reprogramada"; the final date shows its real state (Realizada / Programada…) plus its payment badge. The Student Portal keeps the previous presentation (no portal change).

### Verification
`src/schedule/paymentHistoryDates.test.js` (9; mutations of A and B fail as expected), `slotRowBadges.test.js` (+1, wiring updated); `npm test` 209/209; local harness `.local-tests/payment-history-dates.jsdom.test.mjs` (2, real PaymentCard/PagoModal); other harness failures identical on `main`; build clean; oxlint 363 (= main). No production access.

---

## BUG-AGENDA-06 — Eliminar clase (red trash) destroyed combos, payments and Finanzas incomes
**Status:** FIXED and DEPLOYED 2026-11-24 — `6690886` merged via PR menawebmail-hub/izicoach#2 as `main` `10f39bc`; production bundle `index-D4CxLY4T.js`  
**Area:** Agenda class modal / Editar Clase → `handleDeleteClass`  
**Priority:** High

### Root cause
`handleDeleteClass` removed the whole class row (attendance, reprogrammings, notices, overrides), deleted every combo of each roster student that shared ANY date with the series (no `sourceClassId` check, so other classes' combos too), cleared ALL combos of a student left without classes, and deleted "Cobros clases" incomes matched by student NAME and date. Three separate writes, no history, no undo.

### Fix (approved design: only visual change = the modal)
- Modal: "Todas las instancias o instancias futuras de X serán eliminadas del calendario…" + Eliminar todas las instancias / Eliminar las instancias futuras (from the selected card's date) / Cancelar. Editar Clase → Eliminar Clase (unchanged screen) = all.
- ONE classes write (`planClassDeletion`, `src/schedule/classDeletion.js`): each deleted date gets `dateCancellations[date] = {cancelType:"deleted", at, op, scope, held, prev}`; the row keeps `deletion` (cut) and `deletions` (history). Students, combos, payments, attendance and expenses are never written. No SQL (the portal RPC already sends dateCancellations).
- Reading (`normalizeDeletedDates`, `src/schedule/deletedDates.js`, applied in `interpretContractDate` and `expandClasses`): a held date keeps its previous reading; a future one reads as an existing "A Reprogramar" pending slot flagged `isDeleted`. Cards carry `deletedOccurrence`; `scheduleCards` hides them in Agenda, Dashboard (A Reprogramar alerts, today) and the portal's next class / Tus clases / class cards. Cobros keeps reading them.
- Economics: paid deleted slots stay as classes in favour (Restantes) until an internal expiry 60 days after the combo's last given class (or the deletion); then they leave Restantes and the combo can close (`isComboClosed`). Unpaid deleted slots are never debt (No pagadas, Restantes, rows, PagoModal payable rows, xlsx export, Finanzas "por cobrar"). Historical debt is kept.
- A student who comes back starts a new combo (`comboEndedByDeletion` in `updateStudentPacks`). Dates a later pause/resume adds after the cut are deleted too (`markAddedDatesDeleted`), so nothing reappears.
- Mensual combos untouched; no blocking. Pausar, Cancelar, Editar Clase and recoveries unchanged.

### Verification
`src/schedule/classDeletion.test.js` (13; mutations: without the deletion reading 8 fail, without the debt rule 2 fail); `npm test` 199/199 (2 existing tests list the new helper `deletedSlotCounts`); local harness `.local-tests/delete-class-modal.jsdom.test.mjs` (5, real Agenda + Edit screen, spies) — the other harness failures are identical on `main`; build clean; oxlint 363 (baseline 364); dev server visual check of the modal on a TEST fixture, Cancelar, revisions unchanged. No production write.

### Production (2026-11-24)
izicoach.app and app.izicoach.app serve `index-D4CxLY4T.js`, sha256 identical to the local build of `main` `10f39bc`; the bundle contains the approved modal texts. Read-only smoke (Rodri, no writes; revisions unchanged during the smoke): the owner's manual tests had deleted future instances of 5 classes (Lui, SmokeB Combo4, Test Mensual UX, Test Mensual Regresion, Scapinni) — markers with `held`/`prev` present, `deletion` cut + history recorded; students (rev 84) and expenses (rev 60) byte-identical to the baseline before the tests, linked combos (incl. Scapunni's paid combo and a mensual) intact. Everything is restorable by removing the markers (no data was erased).

### Risks / not covered
Legacy single-date classes (no occurrences) are only hidden. A manual "Agregar día al combo" or Editar Clase weekday change after a deletion can add visible dates again (explicit coach action). Students tab / Cobros "GRUPOS" labels still name a fully deleted class.

---

## BUG-AGENDA-05 — Editar clase: "Solo esta clase" changes the whole class; a weekday change leaves the combo behind

**Status:** Phase 1 → stage 2.2 committed on `fix/agenda-edit-scope` (`5db25f9` … `85d0630`); student portal Migration D applied in production 2026-11-22; PR to `main` opened, not merged; recoveries (stage 3) pending  
**Area:** `EditClassScreen` (occurrence regeneration), Agenda scope prompt (`editScopeData`), `applyEditToClass`, `updateStudentPacks`  
**Priority:** High

### How it was found
Owner's local test of FEATURE-AGENDA-01: on a class of that combo, Editar → changed the weekday → "📅 Solo esta clase". The new date showed a grey "Sin pagar" card.

### Diagnosis
1. **"Solo esta clase" is not a single-date edit.** `EditClassScreen` regenerates ALL the class occurrences with the new weekdays and the scope prompt saves that payload. Without `applyToAll`, `applyEditToClass` merges the whole payload into the class row (`{...c,...cd}`): new `days`, the regenerated `occurrences`, and also the card's `date` and internal card fields. There is no path that moves one date only.
2. **The combo is not moved.** A weekday change regenerates `occurrences`, but `combo.dates` is only recalculated when the student's package is also changed. The new weekday dates are not combo dates (grey "Sin pagar"); the original future combo dates lose their Agenda card while Cobros still lists them.
3. **Past dates disappear from the Agenda.** Regeneration starts at the class `startDate` and keeps only occurrences before it (normally none), so past dates, including ones with attendance, lose their card.

Dates added with "Agregar día al combo" are kept (`class.addedDates`). Attendance, payments and combos are not deleted: the damage is what the Agenda shows and which dates are combo classes.

### Impact
Coaches who move one class with "Solo esta clase" actually move the whole class; combo classes vanish from the Agenda and the new dates read "Sin pagar"; past classes vanish from the Agenda. Workaround: Editar → back to the original weekday → "A todas las clases" (occurrences are regenerated from `startDate` again; attendance was never deleted).

### Proposed corrections (not implemented)
1. **"Solo esta clase" + one weekday swapped = reprogram that date** to the same week's new weekday through the existing reprogramming (with the fused-chain prevention); combo, payments and attendance as in "Reprogramar". An ambiguous change (several days added/removed) is refused: "Para mover solo esta clase, usá Reprogramar".
2. **Other structural changes in "Solo esta clase"** (time, students) do not exist per date in the model: say so in the prompt or refuse them ("El horario y los alumnos se cambian para todas las clases").
3. **"A todas las clases" + weekday change:** keep every past occurrence and every date with attendance, reprogramming or pause; move each current combo's future clean dates, in order, to the next dates with the new weekdays (in the student-pack flow, per ARCHITECTURE.md), keeping total, price and payments (same positions); never move past, attended, reprogrammed, paused, resume or added dates; same slot-readings check; all combo students or none; preview before saving.
### Phase 1 (authorized 2026-11-20, committed in `5db25f9` on `fix/agenda-edit-scope`)
Correction 2 plus history protection, in `src/schedule/classEditScope.js`:
- **Scope prompt:** "📅 Solo esta clase" is disabled, with the message "Solo esta clase no puede cambiar días, horario, cancha, título ni alumnos: esos cambios se aplican a todas las clases. Para mover solo esta fecha, usá Reprogramar." (only the changed fields are named), when the edit changes any series field (`singleDateEditChanges`; timeEnd defaults to "09:00" and deleted students are ignored, as in EditClassScreen). "🔄 A Todas las Clases" is unchanged.
- **handleSaveClass:** the choice is marked `_singleDate`; it is re-checked against the latest row before any write (`{status:"single-date-edit-refused",changes}`, nothing written) and never enters the per-date pause/cancel branch, even when the edited card is paused or cancelled. `applyEditToClass` then writes only the occurrences: no card field (`date`, `cancelled`, `_virtualId`…) reaches the series row. Package changes (`updateStudentPacks`) work as before. Removing a student is only possible with "A Todas las Clases".
- **Regenerated occurrences (both choices):** `keepDatesWithHistory` keeps every previous date that is past, has attendance, has a `dateCancellations` entry (paused, cancelled, reprogrammed origin — keeps the destination card) or was added with "Agregar día al combo", read from the real row. Clean future dates of the old weekdays still go.
- Not changed: non-recurring classes (no scope prompt) keep their own path; "A Todas las Clases" still copies the card fields into the row as before, and a weekday change still does not move the combo (correction 3). Editing a paused or cancelled card with "A Todas las Clases" still goes through the per-date branch (found during this work, not changed, to verify separately).
- Tests: `src/schedule/classEditScope.test.js` (fields, message, history kept, real `expandClasses` after a weekday change), `src/schedule/classEditScopeWiring.test.js`; `fusedWiring.test.js` anchor updated to the new per-date condition.
- Verified: `npm test` 101/101; `vite build` clean; `oxlint` 364 = `main`. Browser (localhost:5173, huevo@huevo.com, class "Clase test", nothing saved): unchanged edit → "Solo esta clase" enabled; Friday removed → disabled with the message, click does nothing; coach_data revisions unchanged (classes 82, students 156). A real save with "Solo esta clase" or "A Todas las Clases" was not exercised.

### Stage 0 (authorized 2026-11-21, committed in `5db25f9` on `fix/agenda-edit-scope`)
Safety fixes in `src/schedule/classEditScope.js`, wired in `EditClassScreen`, the scope prompt, `handleSaveClass`, `applyEditToClass`, `removeStudentsFromClass`:
- **0.1 Historical dates.** Phase 1 regenerated from the class `startDate`, so a weekday change invented past dates with the new weekdays (and kept the real ones too). `regenerateOccurrences` now starts at the selected card's date, or today when later: every earlier date is kept exactly; new weekdays up to the class end date or 6 months after the change point; later dates with a `dateCancellations` entry and added dates stay. On save, `keepDatesWithHistory` rejects any past date that was not an occurrence. Temporary block (until combos follow a weekday change): the edit is refused when it would leave future combo or individual dates without a card (`comboDatesLeftWithoutCard`, only dates that are occurrences now; mensual never blocks); the prompt disables "A Todas las Clases" and names the students and date counts. Old and new dates are never mixed to avoid the block. Applies from today inclusive.
- **0.2 Students and combos.** `removeStudentsFromClass` cut every class date from the combo and deleted it when empty, with its payments (also paid mensualidades). `studentRemovalBlock` refuses the edit when a removed student has payments, paid months, used classes, attendance in the class or class history (resume, relocation, added dates, a `dateCancellations` entry on a combo date), judging exactly the combos `cleanCombosAfterClassRemoval` (the previous logic, moved verbatim) would cut or delete. A student without history (added by mistake) is removed as before. Deleted students are not judged. Removing a student from a future date on stays for a later stage.
- **0.3 Paused/cancelled cards.** Editing such a card sent its state, so "A Todas las Clases" ran the pause interceptor (re-pausing every combo date from that day) and copied card ids/state into the series. `editableFromCard` strips the card state before saving; the per-date branch never runs for `applyToAll` or `_singleDate`; "A Todas" merges `seriesFieldsFromEdit` (no `_virtualId`, `_seriesId`, state or scope flags). Pause, reprogram, reactivate, resume and revert flows are unchanged.
- Refusals return `{status}` before any write (`single-date-edit-refused`, `student-removal-blocked`, `weekday-change-blocked`); the prompt and the non-recurring edit path show `editRefusalMessage` and keep the screen open.
- Tests: `classEditScopeStage0.test.js` (new), `classEditScopeWiring.test.js` (rewritten for the new wiring), `classEditScope.test.js` (no invented past date), anchors updated in `fusedWiring.test.js` and `comboDayWiring.test.js`.
- Verified: `npm test` 119/119; `vite build` clean; `oxlint` 364 (known baseline). Browser (2026-11-21, localhost:5173, huevo@huevo.com logged in by the owner, "Clase test" only, nothing saved): unchanged edit → both choices enabled; Friday removed → "Solo esta clase" disabled, "A Todas" enabled (only a mensual student, no combo dates lost); student removed → both disabled, message "Alumno test (mensualidades pagadas)", click on the disabled button does nothing; coach_data revisions unchanged (classes 83, students 158); no console errors. In-memory check of the new module on the account's 4 recurring classes (one weekday removed, nothing written): no invented past date, every past date identical; none blocked (no future combo dates there). The combo block was then verified in the UI with synthetic data only: local harness `.local-tests/agenda-edit-scope-stage0.jsdom.test.mjs` (git-excluded; real `Agenda` → card menu → `EditClassScreen` → scope prompt in jsdom, Supabase mocked, every write callback a spy): TEST combo of 8 future dates on two weekdays, one weekday removed → "A Todas las Clases" and "Solo esta clase" disabled, message names "TEST Alumno Combo" and the lost date count, clicks do nothing, zero write calls; unchanged edit → both enabled; TEST mensual class with a weekday removed → "A Todas" enabled, one save call to the spy with no card state and every past date identical; 5/5, and a mutation (block disabled) makes the combo case fail. Harness note: `refresh.sh` currently stops at `extract.mjs` (looks for `resolveRescheduleChain` in App.jsx, moved to a module in `ca54ba0`); the bundle was built with `node build-app-copy.mjs` after the copy step.
- Still pending: combos following a weekday change, removal from a date on, per-occurrence time/court/students, recoveries (later stages); "A Todas las Clases" still copies `studentPacks` into the row (pre-existing).

### Stage 1 — shared slot reader (= BUG-AGENDA-03 stage 0), committed in `6848b19` (2026-11-21)
No visible change. `src/schedule/slotStatus.js` holds `isClassDone`, `interpretContractDate`, `resolveContractSlotStatus`, `getSlotFulfillmentDate`, `resolveSlotGiven` (moved verbatim from App.jsx, byte-identical apart from `export`) and `createSlotReader({classes, combo, studentId})` → `status(date)`, `isGiven(date)`, `cardFor`, `timeEndFor`: exactly the previous composition, with the slot memoized per date for one reading. Consumers switched: `buildPersonSlotRows` (Cobros rows, Mis Clases, Agenda payment chips), `getAccountCounters`, `getClaseRem` ("Por dar"), `PagoModal.buildAllDates` (status only). No direct `resolveContractSlotStatus`/`resolveSlotGiven` call is left in App.jsx.
- Not switched on purpose (they use different "given" rules today; unifying them would be a visible change and needs a decision): `PagoModal.buildAllDates` own `isGiven` (a reprogrammed slot counts as given without attendance at the destination), `isComboClosed` (card flags, not terminal-aware), `PagoModal` `used` recount at payment (fulfillment date ≤ today), `countAttendedSlots` (explicit attendance only).
- Tests: `slotReaderCharacterization.test.js` + snapshot (5 fictitious students: attendance mix, time fallback, reprogramming chain, pending reprogramming, definitive cancellation, compensated pause + replacement, active pause, released date, partial payments, individual pack, legacy single class) generated from the pre-refactor code — rows, counters and "Por dar" byte-identical after it; `slotStatus.test.js` (reader = old composition on every fixture date, memo, no mutation, wiring). `src/test/loadAppFunctions.js` re-exports helpers App.jsx imports from `./schedule/` (tests stopped listing the two helpers App.jsx no longer calls).
- Verified: `npm test` 128/128; `vite build` clean; `oxlint` 364. Local harness: same 17 failing lines before (HEAD 81c3bf8) and after (pre-existing, stale reference bundles/extracts). Browser (huevo@huevo.com, read-only): Inicio and the app load without console errors; in-memory comparison of the reader vs the old composition on the account's 81 combo slots (39 students): 0 differences; revisions unchanged (83/158).
- Next (stage 1d, not done): per-student moves (`slotMoves`) and the per-combo `used` recount, dormant until recoveries are authorized.

### Stage 1d — reading per-student slot moves (`slotMoves`), committed in `608532b` (2026-11-21)
Read support only: nothing writes `combo.slotMoves` (no recovery UI, no advance notice, no extension, no SQL, no portal change). `src/schedule/slotMoves.js`:
- **Shape:** `combo.slotMoves = [{id, slot:{index,date}, kind:"recovery"|"extension", from:{classId,date}, to:{classId,date}, at, undoneAt?}]`, oldest first, never deleted. Separate from `slotRelocations` (class-level releases rewrite `combo.dates` and are completed by `findPendingReleaseCompletions`, which would misread any other record). A move never touches `combo.dates`, payments or amounts: the slot keeps its position and original date (identity).
- **Validity (`resolveComboMoves`):** a step counts only if its slot exists at that position, it leaves from the slot's current location (base terminal of the class-level chain, or the previous move's destination), that location is pending for THIS student (class-level "A Reprogramar"/inconsistent chain, explicit Ausente – No dada, or a previous recovery missed / not held), and its destination is not already a location of another slot of the combo. The first invalid step and all later ones are reported as conflicts and ignored. One active recovery per slot (a scheduled recovery is not pending).
- **Destination state:** given = explicit Presente / Ausente – Dada and the class held that day; missed = Ausente – No dada or a dateCancellations entry there (pending again, may be recovered again); scheduled = nothing recorded (pending, never consumed by time).
- **Reader (`createSlotReader`, new `allClasses`):** a validly moved slot reads at its destination: base fields kept, `terminalDate`/`rescheduledTo` = destination, path extended, reprogramming with date (or "A Reprogramar" again when missed), `studentMoves`, `terminalClassId`, `recoveryState`; `isGiven` only by explicit attendance there. `buildSlotHistoryRows` reads a moved terminal through `isGiven`. Callers pass every class (`buildPersonSlotRows(…, allClasses)`, counters, Por dar, PagoModal, Agenda payment chips, `slotReadingsOf`); `PagoModal` uses the shared `isGiven` for moved slots only. Without the destination class (the student portal today) a recovery reads pending, never consumed.
- **`used` per student and combo (`countUsedForCombo`, in `handleAttendance`):** same inputs as before; without slotMoves it IS `countAttendedSlots`; with them a moved slot never counts at its origin and counts once if its destination was given. Saving attendance also recounts a student outside the roster whose combo moved a slot into that class and date (that combo only).
- **Planner (`planSlotMove` / `planStudentSlotMove`, unused):** refuses unknown slot/position, not pending, an active recovery, the same location, a destination not held, and any destination that already holds a slot of any of the student's combos.
- Not adapted yet (no moves exist; to do with the stage that writes them): `isComboClosed` (card flags), PagoModal `used` at payment, release/fused/combo-day planners and pause/resume reading `combo.dates` directly, Agenda cards of the destination group (guest not on the roster), the portal RPC.
- Tests: `slotMoves.test.js` (14, synthetic): Juan/Pedro 8-class combos (Pedro 4/4, Juan 3/5), recovery in group B counted once and Pedro identical, recovery without attendance pending, duplicate rejected (reader + planner), missed again then recovered, no double consumption from a given origin, collisions, chained class-level reprogramming, fused terminal + pause, partial payments and individual pack, undone move and destination not held, no destination class in hand, equivalence without moves, guest recount wiring. Wiring anchors updated in `releaseWiring.test.js` and `slotStatus.test.js`.
- Verified: `npm test` 142/142; characterization snapshot unchanged; `vite build` clean; `oxlint` 364; local harness failure set identical to HEAD `eca0224`. Read-only on a real account: no combo has slotMoves; reader vs previous composition 0 differences on 81 slots; `countUsedForCombo` vs `countAttendedSlots` 0 differences on 30 combos; revisions unchanged (83/158).

### Stage 2.0 — attendance read in each slot's own class and date, committed in `f879be2` (2026-11-21)
Cause: Cobros readers took the first attendance entry with that DATE across every class of the student (`myClasses.flatMap(attendanceLog).find(date)`) and the first card with that date, so a student with two classes on one day could read one class's attendance, pause/cancel flags or end time for the other.
- `src/schedule/attendanceRead.js` (new): `attendanceAt` / `dateEntryAt` / `attendanceState` (moved from slotMoves.js, re-exported there), `classCardOn`, `slotCardOn` (the combo's own class card; a legacy combo without `sourceClassId` keeps the first card on that date), `slotClassId`, and `readAttendance({classes, classId, date, studentId})` — the single reading priority: explicit attendance of that class and date (`present` / `ausente_dada` / `ausente_reprog`, or `unmarked`), then (stage 2.1, not implemented) an advance notice, then nothing (each caller keeps its time-based rule).
- Fixed readers: `resolveSlotGiven` (new `classId` argument; without it the previous reading stays for legacy slots with no card), `createSlotReader` (`cardFor` = own class card; `isGiven` passes the class) and `slotBaseLocator`, `buildSlotHistoryRows` (reprogrammed steps read in the slot's class), `isComboClosed` (card flags and attendance), `PagoModal` (row card, attendance, and the given count at payment). The only date-only lookups left are the legacy fallbacks.
- Rules unchanged: Presente / Ausente – Dada consume, Ausente – No dada does not, no record -> previous time rule, balances per student.
- Found during stage 2.0 and FIXED in the follow-up (`5201fbc`, pushed, not merged, 2026-11-21):
  1. **Rows merged across combos on the same date.** `buildPersonSlotRows` deduped the final rows by DATE across all combos, so a student with two combos on one date saw one row (the first combo's). Rows now carry `comboIndex` and `sourceClassId` and are deduped per combo + date (a combo repeating a date in its own `dates` still reads once). Consumers that picked "the row of that date" now pick the row of their class: the Agenda payment chip (`resolveAgendaCardStatus`, which also decided "replacement date" from any combo — now only combos of the card's class), Mis Clases (each class card lists the rows of its own class; cards grouped by title keep every class with that title; a legacy combo without `sourceClassId` shows everywhere, as before), and the release readings (`slotReadingsOf` / `sameSlotReadings`, compared per combo + date).
  2. **Pause extension looked up the card by date only.** `getAccountCounters` (`_pi2`, `_pc2`) now reads the pause flag on the combo's own class card (`slotCardOn`) and takes the extra occurrences from the combo's own class; `PagoModal._pi` (computed but unused) aligned.
  - Tests: `rowsPerCombo.test.js` (5: per-combo rows, Agenda chip and replacement detection, release readings, another class's pause, wiring); `attendanceRead.test.js` updated (two Monday rows); characterization snapshot regenerated only to add `comboIndex`/`sourceClassId` (every other value checked identical first). Local harness: `.local-tests/mis-clases-rows-per-class.jsdom.test.mjs` (real StudentApp "Clases" tab, synthetic data: morning card 4 rows, evening card 4 rows) passes here and fails on HEAD `72cf5d4`; harness failure set otherwise identical. `npm test` 156/156; build clean; oxlint 364. Real account (read-only): no student with combos sharing a date, two classes on one day, or a resume across several classes — no visible change there.
- Tests: `attendanceRead.test.js` (9): reading priority, two classes on one Monday (counters 5, previously 6), the previous crossed reading documented, `isComboClosed` with another class's pause, Juan/Pedro 4/4 and 3/5, chained reprogramming and fused dates against another class's entries, individual and group combos with partial payments, pause and cancellation, equivalence, wiring. Local harness: `.local-tests/attendance-own-class.jsdom.test.mjs` (real PagoModal, synthetic data, no write) passes on this code and fails on HEAD `7402d18`.
- Verified: `npm test` 151/151; characterization snapshot unchanged; `vite build` clean; `oxlint` 364; harness failure set identical to HEAD. Read-only on a real account: no student has two classes on one day; 0 differences on 81 slots; revisions unchanged (83/158).

### Stage 2.1 — advance absence notices ("Avisar ausencia"), committed in `8408d19` and pushed, not merged (2026-11-21)
Branch only: the student portal does not show notices yet (its RPC returns only whitelisted class keys) and must be updated and validated before this is published.
- **Data:** `class.attendanceNotices[date][studentId] = {status: "ausente_dada"|"ausente_reprog"|null, at, history:[{status, at}]}` on the class row, by the real date of the class, apart from `attendanceLog`; a withdrawn notice keeps its record (`status:null`). `src/schedule/absenceNotices.js` (`applyNoticesToClassRow`, `noticeWriteRefusal`, `cardNoticeRefusal`, `pendingNoticeStudentIds`, messages); `noticeOf`/`noticeAt` in `attendanceRead.js`.
- **Reading (`readAttendance`):** explicit attendance listing the student → advance notice → entry without the student ("unmarked") → nothing. `givenByReading` (slotStatus.js): an Ausente – Dada notice consumes only once the class has happened (date + end time + margin, `isClassDone`); an Ausente – No dada notice never. Used by `resolveSlotGiven` (shared reader: Cobros rows, counters, Por dar, Mis Clases), `buildSlotHistoryRows`, `isComboClosed` (a No dada notice keeps a paid combo open), `PagoModal` (before the class the row reads "📣 Avisó: No dada/Dada"; after it, like that attendance), Agenda chips (`getAttendanceChipStatus`: the notice shows on its own card, also before the class).
- **UI simplified (2026-11-22):** the separate menu entry and modal were removed; on a future date Asistencia saves only the absences as notices through `saveAbsenceNotices` (Presente is not recorded and withdraws an existing notice); today/past keep the definitive flow. The original write path was: "Avisar ausencia" in the day and week card menus (disabled on paused/cancelled/reprogrammed or past dates). `AbsenceNoticeModal`: per student Sin aviso / Ausente — No Dada / Ausente — Dada (mensual: Sin aviso / Ausente), last change shown. `saveAbsenceNotices` re-validates on the latest row (past, not live, attendance already recorded → "corregila en Asistencia", not in class, mensual No dada, nothing to withdraw, write pending) and writes the class row only — never attendanceLog, students, combos or payments.
- **Asistencia:** a student without their own attendance starts from the notice ("📣 Avisó: …" under the name) so the coach confirms or corrects it; the notice stays as history. No definitive attendance for a future date: the screen says so and disables "Guardar asistencia"; `handleAttendance` refuses a future date before any write.
- **Inicio:** a No dada notice joins the "para reprogramar" alerts only once that class has happened, unless the day's attendance already decides the student; paused/cancelled/reprogrammed dates and mensual excluded (the alert still opens the class-level Reprogramar flow, as for an attendance-based absence — individual recovery is stage 3).
- **`used`** stays explicit-attendance only (unchanged); counters and "Por dar" read the notice through the reader.
- Not done (later): "Quitar alumno de esta fecha" as a notice, guests, recoveries/slotMoves writes, per-date time/court, SQL and the portal.
- Tests: `absenceNotices.test.js` (8): Juan/Pedro 3/5 and 4/4 in three variants (attendance taken from the prefilled screen, never taken, taken without Juan), Dada before/after the class time, isComboClosed, corrected to Presente with history kept, withdrawn notice, notice without attendance (Inicio only after the class), two classes the same day, paused/cancelled/reprogrammed/destination/past/mensual/individual, no other data touched, equivalence, future attendance blocked, wiring. Local harness: `.local-tests/absence-notice-agenda.jsdom.test.mjs` (3, real Agenda, synthetic data, spies: notice saved for Juan only, chip and prefilled Asistencia, correction to Presente, future date cannot be saved) — fails on HEAD `98b7778`, passes here; other harness results unchanged.
- Verified: `npm test` 164/164; characterization snapshot unchanged; `vite build` clean; `oxlint` 364. Real account (read-only): no notices and no future attendance entries, so nothing changes there; the app loads without console errors; revisions unchanged (83/158).
- **Final validation (2026-11-21):** coach-facing Inicio message without internal wording; double counting audited and none found — the attendance recount is derived from attendance + due notices (idempotent, never from the stored value), `effectiveComboUsed` is max(stored, explicit + due) (never a sum), attendance recorded after a notice replaces it (Presente / Dada counted once, corrected No dada not counted), the payment writes max(stored, given count) with the notice rule (a stored Dada notice is not added again, a No dada notice never), several Dada / No dada notices on different dates count only due Dada ones once each, a notice on a reprogrammed origin is history and a fused terminal counts once. Tests: `absenceNoticesUsedAudit.test.js` (5) and `.local-tests/notice-used-payment.jsdom.test.mjs` (real PagoModal payment: Juan used 3, Pedro 4; on HEAD `98b7778` Juan's would be 4). `npm test` 176/176; build clean; oxlint 364; harness: only the 17 pre-existing failures. Closed: committed in `8408d19`, pushed to `origin/fix/agenda-edit-scope`; not merged, not deployed (portal pending).
- **Review before commit (2026-11-21):**
  1. *Inicio:* an INDIVIDUAL No dada absence (attendance or notice) while someone else took that class stays visible as "Recuperación individual pendiente"; clicking it shows "[Alumno] tiene una recuperación individual pendiente. Esta función estará disponible próximamente." (plural for several) and never opens the class-level Reprogramar flow (it would move everyone's class). Only a whole-class absence (every known student No dada: `isWholeClassAbsence`) and classes "A reprogramar" keep opening it, as before.
  2. *`used` vs realizadas / restantes with an Ausente – Dada notice:* readers through the shared reader (Cobros counters, Por dar) already counted a due notice; stored `used` did not. Unified only where the notice rule applies: `dueDadaNoticeCount` (slots consumed only by a due Dada notice of the combo's own class) is added to the attendance recount (`handleAttendance`, roster and guest paths); `effectiveComboUsed` (= `combo.used` without due notices, else max(stored, explicit + due)) is read by the Cobros export "Restantes", the package checks in `updateStudentPacks` (fully used / active / consumed guard) and the PagoModal mora; the PagoModal given count at payment follows the notice rule for slots read through a notice (Dada only once the class happened, No dada never). Payments, `paidCount` and every reading without notices are unchanged.
  - Tests: `absenceNoticesReview.test.js` (7: individual vs whole-class absence, message, wiring; Dada notice used/realizadas/restantes/export agree; before the time nothing, No dada never; Pedro identical; equivalence on the characterization fixture; wiring). Local harness: `.local-tests/inicio-individual-absence.jsdom.test.mjs` (real Dashboard: individual alert shows the message and does not navigate; whole-class absence still opens Reprogramar; a future notice is not listed). `npm test` 171/171; build clean; oxlint 364; harness: only the 17 pre-existing failures (the 4 new UI tests fail on HEAD `98b7778`).

### Stage 2.2 — time and court of one occurrence (2026-11-22)
Committed in `29381a5` (Asistencia-only notices UI in `85d0630`). The student portal receives `occurrenceOverrides` through Migration D (below), applied in production on 2026-11-22.
- **Data:** `class.occurrenceOverrides[date] = {time, timeEnd, court, at, history}` on the class row, by the real date of the occurrence; only fields that differ from the series are stored (null = series value); an entry with all fields null is a restored date kept as history (`src/schedule/occurrenceOverrides.js`).
- **Reading:** `expandClasses` applies a date's active values to that date's card only (`occurrenceOverride:true`, `seriesValues` kept on the card), so the day and week views, the card's end time read by Cobros (`isClassDone`), the Agenda chips and the due-notice count (`effectiveTimeEnd`) use it; every other date keeps the series values. A reprogrammed origin's values never travel to the destination.
- **Edit:** the existing "Modificar Clase" screen and the "¿Aplicar cambios a?" prompt are unchanged (only its 3 original options). "Solo esta clase" now saves time and court for that date only (days, title and students stay series-wide: `singleDateRefusedChanges`) and applies directly; restoring = the series values back + "Solo esta clase". `handleSaveClass` re-validates on the latest row (live date, HH:MM, start before end). "A Todas las Clases" from a card with its own values keeps the series value for every field the coach did not touch (`seriesEditFromCard`).
- **Reprogramar:** starts from the series time and saves a different chosen time for the destination date, keeping the series duration (`reprogDestinationValues`; nothing stored for the series time or a class ending after midnight). Fixes the earlier defect where the chosen time was shown but not saved.
- **Series protection:** per-date flows that merge the edited card into the series (pause, cancel, reprogram, reactivate, resume) drop the card's own time/court (`withoutCardOverride`), so the series is never changed by a date's values.
- Never touches students, attendance, payments or combo dates.
- Tests: `occurrenceOverrides.test.js` (10), wiring updates in `classEditScopeWiring.test.js`. Local harness: `.local-tests/per-date-time-court.jsdom.test.mjs` (6, real Agenda, synthetic data, spies). `npm test` green; build clean; oxlint 364; `git diff --check` clean; harness: only the pre-existing failures.

### Student portal — Migration D (applied in production 2026-11-22)
- **Why:** `get_my_student_portal()` (Migration A) copies only whitelisted class keys, so without it the portal would show the series time on a moved date and count a date with only a notice differently from Cobros (it uses the same slot reader).
- **What:** `supabase/migrations/20261122120000_student_portal_notices_overrides.sql` redefines the RPC with Migration A's body plus, per class and only when non-empty, `occurrenceOverrides` (active time/timeEnd/court per date, no history or timestamps) and `attendanceNotices` reduced to the authorized ids (`{status}` only, active statuses). Two internal helpers (`portal_class_overrides`, `portal_class_notices`) are not executable by `anon`/`authenticated`. "version" stays 1; backward compatible with the previous frontend.
- **Applied with** `supabase/ops/20261122-migration-d/` (generated and validated on PGlite, 7/7): read-only preflight 32/32; history repair of the 4 hand-applied migrations (`20260929230000`, `20260930120000`, `20260930150000`, `20261001120000`); D in one guarded transaction; read-only post-check 36/36. Rollback script kept (`05_rollback_migration_d.sql`). The migration file is kept exactly as applied (its closing comment about "Migration B/C" is inherited from Migration A; both were already applied by hand).
- **Verified:** PGlite `.local-tests/student-portal-notices-overrides.pglite.test.mjs` 6/6 (mutation without the id filter fails the privacy tests); helpers on synthetic literals in production 5/5; end to end with Rodri's TEST Portal fixtures on the branch code (portal payload: only the student's own notice and the 02/12 time/court, no classmate id, no history; counters equal to Cobros; non-TEST data hash-identical).
- **Not done (visual, needs approval):** Mis Clases card header and Mi Familia summary read a representative card's `time`/`court`; they would show a date's own values if that card is the moved date (`seriesValues` is available on the card).

Tests to add: single-date weekday swap (reprograms only that date, prevention respected), ambiguous change refused, all-classes weekday change with unpaid / partly paid / fully paid combos, past attended dates kept, reprogrammed and added dates not moved, group classes.

---
