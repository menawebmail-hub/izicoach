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