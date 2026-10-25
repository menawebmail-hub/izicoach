ARCHITECTURE.md — IziCoach
Technical architecture and implementation decisions that must be preserved. General development rules are in CLAUDE.md; functional rules are in PROJECT_CONTEXT.md.
1. SOURCES OF TRUTH
Do not duplicate relationships or derived data unless synchronization is explicitly required.
Before adding relationship fields, inspect the current model and its consumers.
Student → Family
Family membership source of truth:
student.familyId
Do not introduce family.studentIds as a second source of truth.
Family members are derived from Students using familyId.
A Family representative may be:
	•	an existing Student; or
	•	an external person.
If the representative is a Student, preserve that relationship without creating a duplicate Student or unnecessarily duplicating Student data.
2. CLASSES AND SCHEDULING
Scheduling changes can affect:
	•	class records
	•	occurrences
	•	student packs / combos
	•	combo.dates
	•	Agenda
	•	Payments
	•	pause/resume
Do not assume changing one scheduling property automatically synchronizes the others.
occurrences
When editing, use the edited occurrences when provided rather than reverting to the previous class value.
Existing intended pattern where applicable:
cd.occurrences || c.occurrences
combo.dates
combo.dates contains dates associated with a student's package.
Schedule/occurrence changes may require these dates to be synchronized.
Keep this synchronization in the student-pack update flow rather than duplicating it across callers.
Inspect actual pack objects before modifying them; fields vary by packType.
3. CLASS SAVE FLOW
handleSaveClass has been separated into responsibilities including:
	•	applyEditToClass()
	•	removeStudentsFromClass()
	•	updateStudentPacks()
	•	createNewClass()
Preserve this separation. Modify the responsibility associated with the requested behavior rather than rebuilding a monolithic save function.
Pause/resume may remain handled separately where required.
4. PAUSE / RESUME
Pause/resume are special scheduling operations, not ordinary class edits.
Relevant internal indicators include:
	•	_resuming
	•	cancelType: "paused"
Do not modify these without checking all usages.
Paused occurrences are historical records and must not simply be deleted.
Resume must preserve paused records while generating the required future occurrences and synchronizing relevant combo dates, Agenda and Payments.
5. REACT STATE
When new state depends on previous state, always use React functional updates.
Correct pattern:
setState(prev => transform(prev));
This is especially important for classes and students.
Do not calculate functional updates using closure values such as:
const next = typeof v === "function" ? v(classes) : v;
classes may be stale.
Multiple updates affecting the same state must each operate on the latest state.
Do not use setTimeout() as a state-synchronization workaround.
6. PERSISTENCE
State may synchronize with localStorage and Supabase.
Required flow:
previous state → functional update → new state → persistence/backend sync
Never persist a stale closure value.
When persistence changes, verify local state, reload behavior and backend consistency.
7. CANCELLED / OPERATION INTERCEPTORS
Cancellation logic must distinguish boolean values precisely.
Actual cancellation:
cd.cancelled === true
Do not replace this with:
cd.cancelled !== undefined
because that also captures cancelled: false.
Some special operations intentionally use cancelled: false together with operation-specific flags. Always inspect the complete operation context.
8. CONSUMERS
Agenda
Scheduling changes can affect Agenda through dates, occurrences, status, days, times and pause/resume state.
Verify both underlying state and Agenda interpretation.
Payments
Changes to class/package dates, usage, scheduling or pause/resume can affect Payments and Update Payments.
Agenda correctness does not guarantee payment correctness.
UI
Prefer deriving display information from the existing data model rather than creating UI-specific duplicate state.
Example:
Student.familyId → Family membership
8b. RESCHEDULE HISTORY AND RELEASED DATES
Reschedule chains are walked by src/schedule/rescheduleChain.js only (one walk for Agenda, Cobros, pauses and resumes).
combo.dates is positional: Cobros assigns payments by position (resolveSlotPayments). Never re-sort combo.dates to move a slot.
A released original date (BUG-AGENDA-04, src/schedule/releaseReprogrammedDate.js) is recorded on both sides:
	•	combo.slotRelocations: [{id, from, to, classId, at}] — the slot kept its position and took its real date;
	•	class.releasedReschedules: [{id, date, destination, entry, at}] — the dateCancellations entry that was removed.
Write order: students, then the class, then the renewal; recovery completes a pending class part idempotently.
A repaired fused chain (BUG-AGENDA-03, src/schedule/fusedChains.js) is recorded in class.chainRepairs: [{id, kind:"split-fused", at, slots, before, after, freedDates, attendance}]; combos are never written by it.
A dated reprogramming must not land on a date that already carries another class or reprogramming of the series (rescheduleDestinationConflict).
9. ARCHITECTURAL REGRESSION GUARDS
Do not reintroduce:
	•	stale React closure updates;
	•	duplicate relationship sources;
	•	timing-based (setTimeout) state fixes;
	•	broad boolean/property-existence interceptors;
	•	duplicated combo-date synchronization;
	•	monolithic handleSaveClass.
10. DOCUMENTATION VS CODE
If current code and this document disagree:
	1	Inspect the implementation.
	2	Determine whether the documentation is outdated.
	3	Do not force outdated documentation into working code.
	4	Update documentation after confirming the intended architecture.
