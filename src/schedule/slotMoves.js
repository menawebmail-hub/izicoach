import { resolveComboDateStatus } from "./rescheduleChain.js";
import { countAttendedSlots } from "./releaseReprogrammedDate.js";

/*
 * Per-student moves of ONE combo slot — BUG-AGENDA-05 / BUG-AGENDA-03 stage 1d. READ SUPPORT ONLY: nothing in
 * the app writes `combo.slotMoves` yet (no recovery UI, no extension), so every existing combo reads exactly as
 * before (no `slotMoves` -> no change anywhere).
 *
 * Kept apart from `combo.slotRelocations` on purpose: those are class-level releases (BUG-AGENDA-04) that
 * rewrite combo.dates[i] and are completed by findPendingReleaseCompletions, which would misread any other record.
 * A move NEVER touches combo.dates, payments or amounts: the slot keeps its position and its original date
 * (its identity), and the move only says where this student takes that class instead.
 *
 * Shape (one entry per step, oldest first; history is never deleted):
 *   combo.slotMoves = [{
 *     id,                                  // unique operation id
 *     slot: { index, date },               // identity: combo.dates[index] === date (the original date)
 *     kind: "recovery" | "extension",      // recovery in another group / individually, or an extra date at the end
 *     from: { classId, date },             // where the slot was pending (base terminal, or the previous move's `to`)
 *     to:   { classId, date },             // where the student takes it (any class: another group, an individual class)
 *     at,                                  // ISO timestamp
 *     undoneAt?,                           // set when the coach cancels the move before it is attended (kept as history)
 *   }]
 *
 * Rules (owner, 2026-11-21): Ausente – Dada consumes, Ausente – No dada does not; a recovery is consumed only by an
 * explicit Presente / Ausente – Dada at its destination (no time fallback, it stays pending however late); a slot
 * has at most one active recovery; it belongs to the original combo, never to the destination group; every
 * student's balance is independent; individual packages follow the same rules; no expiry.
 *
 * A step is VALID only when, in order: its slot exists at that position, it leaves from the slot's current
 * location, that location is pending for THIS student (class-level "A Reprogramar", Ausente – No dada, or a
 * previous recovery that was not held or was missed again), and its destination is not already a location of
 * another slot of the combo (no fused dates, no double consumption). The first invalid step stops the slot's
 * chain; it and every later step are reported as conflicts and ignored.
 */

export const SLOT_MOVE_KINDS = ["recovery", "extension"];

const seriesKeyOf = (c) => (c ? (c._seriesId !== undefined ? c._seriesId : c.id) : undefined);
const sameId = (a, b) => a !== undefined && a !== null && String(a) === String(b);
const locKey = (classId, date) => String(classId) + "|" + date;

/** The attendance entry of `classId` on `date` (raw class rows or expanded Agenda cards). */
export function attendanceAt(classes, classId, date) {
  for (const c of classes || []) {
    if (!sameId(seriesKeyOf(c), classId)) continue;
    const e = (c.attendanceLog || []).find((x) => x && x.date === date);
    if (e) return e;
  }
  return null;
}

/** The dateCancellations entry of `classId` on `date` (pause, cancellation, reprogramming), or null. */
export function dateEntryAt(classes, classId, date) {
  for (const c of classes || []) {
    if (!sameId(seriesKeyOf(c), classId)) continue;
    const dc = c.dateCancellations;
    if (dc && Object.prototype.hasOwnProperty.call(dc, date)) return dc[date];
  }
  return null;
}

/** "present" | "ausente_dada" | "ausente_reprog" | null for one student in one attendance entry. */
export function attendanceState(entry, studentId) {
  if (!entry) return null;
  if ((entry.present || []).includes(studentId)) return "present";
  if ((entry.ausente_dada || []).includes(studentId)) return "ausente_dada";
  if ((entry.ausente_reprog || []).includes(studentId)) return "ausente_reprog";
  return null;
}
const consumes = (state) => state === "present" || state === "ausente_dada";

const wellFormed = (m) =>
  !!m && typeof m === "object" && !m.undoneAt && SLOT_MOVE_KINDS.includes(m.kind) &&
  m.slot && typeof m.slot.date === "string" &&
  m.from && typeof m.from.date === "string" && m.from.classId !== undefined && m.from.classId !== null &&
  m.to && typeof m.to.date === "string" && m.to.classId !== undefined && m.to.classId !== null;

export const hasSlotMoves = (combo) => !!combo && Array.isArray(combo.slotMoves) && combo.slotMoves.length > 0;

/**
 * The state of a move destination for one student:
 *   given     explicit Presente / Ausente – Dada there, and the class was held that day (no dateCancellations entry)
 *   missed    Ausente – No dada there, or the class was not held (paused/cancelled/reprogrammed that day)
 *   scheduled nothing recorded yet (pending; never consumed by the passing of time)
 */
export function moveDestinationState(classes, to, studentId) {
  if (dateEntryAt(classes, to.classId, to.date)) return "missed";
  const st = attendanceState(attendanceAt(classes, to.classId, to.date), studentId);
  if (consumes(st)) return "given";
  if (st === "ausente_reprog") return "missed";
  return "scheduled";
}

/**
 * Resolves every slot's moves for one student and one combo.
 * baseOf(date) -> { classId, date, pending } | null : where the slot is WITHOUT student moves (its base terminal) and
 * whether it is pending for this student there.
 * -> { bySlot: Map(originalDate -> { moves, location:{classId,date,state}, history }), conflicts: [{move, reason}] }
 * Slots without valid moves are absent from bySlot (they read exactly as before).
 */
export function resolveComboMoves({ combo, studentId, classes, baseOf }) {
  const bySlot = new Map();
  const conflicts = [];
  if (!hasSlotMoves(combo)) return { bySlot, conflicts };
  const dates = Array.isArray(combo.dates) ? combo.dates : [];
  const bases = new Map();
  const occupied = new Set();
  for (const d of new Set(dates)) {
    const b = baseOf(d);
    bases.set(d, b);
    if (b && b.date) occupied.add(locKey(b.classId, b.date));
  }
  const groups = new Map();
  for (const m of combo.slotMoves) {
    if (!wellFormed(m)) {
      if (m && !m.undoneAt) conflicts.push({ move: m, reason: "malformed" });
      continue;
    }
    if (!groups.has(m.slot.date)) groups.set(m.slot.date, []);
    groups.get(m.slot.date).push(m);
  }
  for (const [slotDate, moves] of groups) {
    const index = dates.indexOf(slotDate);
    let cur = bases.get(slotDate);
    if (index < 0 || !cur) {
      moves.forEach((m) => conflicts.push({ move: m, reason: "unknown-slot" }));
      continue;
    }
    cur = { classId: cur.classId, date: cur.date, pending: !!cur.pending };
    const valid = [];
    let stop = null;
    for (const m of moves) {
      if (stop) { conflicts.push({ move: m, reason: "after-conflict" }); continue; }
      let reason = null;
      if (m.slot.index !== undefined && dates[m.slot.index] !== slotDate) reason = "position";
      else if (!sameId(m.from.classId, cur.classId) || m.from.date !== cur.date) reason = "not-from-current-location";
      else if (!cur.pending) reason = "not-pending";
      else if (occupied.has(locKey(m.to.classId, m.to.date))) reason = "collision";
      if (reason) { stop = reason; conflicts.push({ move: m, reason }); continue; }
      occupied.add(locKey(m.to.classId, m.to.date));
      valid.push(m);
      const state = moveDestinationState(classes, m.to, studentId);
      cur = { classId: m.to.classId, date: m.to.date, pending: state === "missed", state };
    }
    if (valid.length > 0) {
      bySlot.set(slotDate, {
        moves: valid,
        location: { classId: cur.classId, date: cur.date, state: cur.state },
        history: valid.map((m) => ({ id: m.id, kind: m.kind, from: { ...m.from }, to: { ...m.to }, at: m.at || null })),
      });
    }
  }
  return { bySlot, conflicts };
}

/**
 * `used` of ONE combo for ONE student, wherever its classes were taken. Without slotMoves this IS
 * countAttendedSlots({dates, dc, attendanceLog, studentId}) (same inputs handleAttendance has always passed).
 * With moves: a moved slot never counts at its origin; it counts once if its current destination was given.
 * `classes` must hold the destinations' attendance (raw rows or cards), with the class being saved already merged.
 */
export function countUsedForCombo({ combo, studentId, dc, attendanceLog, baseClassId, classes }) {
  const dates = Array.isArray(combo && combo.dates) ? combo.dates : (combo && combo.date ? [combo.date] : []);
  if (!hasSlotMoves(combo)) return countAttendedSlots({ dates, dc, attendanceLog, studentId });
  const baseOf = (d) => {
    const r = resolveComboDateStatus(dc || {}, d);
    if (r.broken || !r.terminal) return { classId: baseClassId, date: d, pending: true };
    const t = r.cancelInfo && r.cancelInfo.cancelType;
    if (t === "cancelled_reprog") return { classId: baseClassId, date: r.terminal, pending: true };
    if (t) return { classId: baseClassId, date: r.terminal, pending: false };
    const entry = (attendanceLog || []).find((e) => e && e.date === r.terminal);
    return { classId: baseClassId, date: r.terminal, pending: attendanceState(entry, studentId) === "ausente_reprog" };
  };
  const { bySlot } = resolveComboMoves({ combo: { ...combo, dates }, studentId, classes, baseOf });
  const unmoved = dates.filter((d) => !bySlot.has(d));
  let n = countAttendedSlots({ dates: unmoved, dc, attendanceLog, studentId });
  for (const v of bySlot.values()) if (v.location.state === "given") n++;
  return n;
}

/** Students holding an active, well-formed move INTO (classId, date) — for the attendance recount of guests. */
export function studentsWithMoveInto(students, classId, date) {
  return (students || [])
    .filter((s) => (s.combos || []).some((c) => hasSlotMoves(c) && c.slotMoves.some((m) => wellFormed(m) && sameId(m.to.classId, classId) && m.to.date === date)))
    .map((s) => s.id);
}

/** The index of the student's combo that moves a slot INTO (classId, date) (last one wins, like the attendance target), or -1. */
export function comboIndexWithMoveInto(combos, classId, date) {
  for (let i = (combos || []).length - 1; i >= 0; i--) {
    const c = combos[i];
    if (hasSlotMoves(c) && c.slotMoves.some((m) => wellFormed(m) && sameId(m.to.classId, classId) && m.to.date === date)) return i;
  }
  return -1;
}

/**
 * Planner for a FUTURE writer (no UI uses it yet): whether `slot` of `combo` may move to `to` for this student.
 * baseOfFor(combo) -> baseOf for that combo. Refuses: unknown slot/position, a slot that is not pending (already given,
 * paused, cancelled, or with an active recovery not yet attended — one active recovery per slot), a destination the
 * class does not hold that day, the slot's own location, and any destination that already holds a slot of ANY of the
 * student's combos. -> { ok:true, move } | { ok:false, reason }
 */
export function planSlotMove({ student, combo, slot, to, kind, classes, baseOfFor, id, at }) {
  if (!SLOT_MOVE_KINDS.includes(kind)) return { ok: false, reason: "kind" };
  if (!to || to.classId === undefined || to.classId === null || typeof to.date !== "string") return { ok: false, reason: "destination" };
  const dates = Array.isArray(combo && combo.dates) ? combo.dates : [];
  if (!slot || dates[slot.index] !== slot.date) return { ok: false, reason: "unknown-slot" };
  const sid = student.id;
  const own = resolveComboMoves({ combo, studentId: sid, classes, baseOf: baseOfFor(combo) });
  const base = baseOfFor(combo)(slot.date);
  if (!base) return { ok: false, reason: "unknown-slot" };
  const moved = own.bySlot.get(slot.date);
  const cur = moved ? { classId: moved.location.classId, date: moved.location.date, pending: moved.location.state === "missed" } : base;
  if (!cur.pending) return { ok: false, reason: moved && moved.location.state === "scheduled" ? "active-recovery" : "not-pending" };
  if (sameId(to.classId, cur.classId) && to.date === cur.date) return { ok: false, reason: "same-location" };
  if (dateEntryAt(classes, to.classId, to.date)) return { ok: false, reason: "destination-not-held" };
  for (const c of student.combos || []) {
    const b = baseOfFor(c);
    const r = resolveComboMoves({ combo: c, studentId: sid, classes, baseOf: b });
    for (const d of new Set(c.dates || [])) {
      const loc = r.bySlot.has(d) ? r.bySlot.get(d).location : b(d);
      if (loc && sameId(loc.classId, to.classId) && loc.date === to.date) return { ok: false, reason: "collision" };
      if (r.bySlot.has(d)) {
        const bd = b(d);
        if (bd && sameId(bd.classId, to.classId) && bd.date === to.date) return { ok: false, reason: "collision" };
      }
    }
  }
  return { ok: true, move: { id, slot: { index: slot.index, date: slot.date }, kind, from: { classId: cur.classId, date: cur.date }, to: { classId: to.classId, date: to.date }, at } };
}
