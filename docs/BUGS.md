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