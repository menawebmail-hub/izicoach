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

**Status:** Fixed (local branch `fix/cobros-stepper-no-calendar`; pending the coach's real payment test and publication)  
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

**Status:** Fixed (local branch `fix/cobros-reprog-badges`; pending review and publication)  
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

**Status:** Fixed (local branch `fix/iso-device-storage`; pending review and publication)  
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

**Status:** Partially fixed (local branch `fix/iso-device-storage`): writes removed; existing copies kept pending authorization  
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

**Status:** Fixed on branch `fix/combo-used-release-date` (local, not committed)  
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

**Status:** Fixed on branch `fix/combo-used-release-date` (local, not committed)  
**Area:** Agenda (grey cards, "Renovar Combo desde esta fecha"), Cobros (both renewal buttons)  
**Priority:** High

### Description
`dateCancellations` is keyed by DATE, so `dateCancellations["2026-10-26"] = {cancelled_reprog → 2026-10-02}` is both the history of the class moved to 02/10 and the state of Monday 26/10. The 26th stayed a green "Reprogramada" card (not grey, no renewal), Cobros renewed from 28/10, and a combo starting on the 26th would have read that entry as its own (the 02/10 class counted twice, the new combo born 1/8). Same root as BUG-AGENDA-03 (date used as key); fixed narrowly, without plan B.

### Rule
An original date is released when all of this holds: one direct reprogramming to a live destination; nothing else arrived at either date; the date is today or later and has no attendance; every affected student has EXPLICIT attendance (present / ausente-dada) on the destination — the passing of time is never proof; every other slot of the affected combo is settled and before the date; no pause, planned resume or resume operation involved; the destination is not already a date of the combo; exactly one combo per student holds the date; no later combo of the series exists; and no slot changes its paid / displayed / given state (checked with `buildPersonSlotRows`, for the final and for the half-written state).

### What the release writes
1. **Students first:** the slot keeps its POSITION in `combo.dates` (payments are assigned by position, so re-sorting would move them) and takes its real date; `slotRelocations: [{id, from, to, classId, at}]`; `used` = max(used, explicit attendance count). Total, payments, paidCount, amount: untouched.
2. **Then the class:** `dateCancellations[date]` is removed only while it still says exactly that reprogramming; the destination joins `occurrences` (its card and attendance stay); `releasedReschedules: [{id, date, destination, entry, at}]` keeps the removed entry.
3. **Then the renewal** from the released date (`buildRenewalDates`, the same rule as Cobros, on the series' days; refused if it would not start on the date), with `sourceClassId`.

A half-done release (students saved, class not) counts nothing twice and is completed by the next attempt or by the recovery effect in App, idempotently, only when the classes queue is settled; a date that changed meanwhile is never touched.

### Tests
Pato regression on the real App functions with "today" = 25/10/2026: 26/10 grey, 28/10 grey, new combo 0/8 from 26/10, previous combo 8/8, payments unchanged for 8, 5, 3 and 0 paid, two students, partial write and recovery, and every refusal (`src/schedule/patoRelease.test.js`).

---

## BUG-AGENDA-03 — Reprogramming onto a date with its own entry fuses two classes (prevention + repair)

**Status:** Prevented and repairable on branch `fix/combo-used-release-date`; the full fix (plan B, slot identity by original date) is still pending  
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
Combos, payments, amounts and attendance are never written. Attendance is per date, so it stays where it was; the 19/10 attendance is reported, never assumed (classes with explicit attendance: 7 → 7 until it is registered). Refused for three or more classes on one date, a class that was already living on the date, pauses or resume operations, or other references to the shared step.

### Tests
`src/schedule/fusedChains.test.js` (fictitious data shaped exactly like the reported case, real App functions), `src/schedule/fusedWiring.test.js`.

---
