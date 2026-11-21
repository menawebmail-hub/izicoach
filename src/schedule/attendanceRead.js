/*
 * Attendance of ONE student in ONE class on ONE date — BUG-AGENDA-05 stage 2.0. Pure, no React.
 *
 * Before: several readers took the first attendance entry with that DATE across every class of the student
 * (myClasses.flatMap(attendanceLog).find(date)) and the first card with that date, so a student with two classes
 * on the same day could read one class's attendance (or pause/cancel flags, or end time) for the other one.
 * Now every slot is read in its own class: combo.sourceClassId, or — for legacy combos without it — the class of the
 * card that holds the slot's date (the previous reading for those combos).
 *
 * Reading priority (readAttendance), one place for every consumer:
 *   1. explicit attendance of that class and date (attendanceLog entry): "present" | "ausente_dada" | "ausente_reprog"
 *      or "unmarked" when the entry exists but does not list the student;
 *   2. (stage 2.1, not implemented) an advance absence notice for that class, date and student;
 *   3. nothing recorded -> state null; each caller keeps its current rule (time-based fallback).
 * Works with expanded Agenda cards (each card carries its own date's entry) and with raw class rows.
 */

export const seriesIdOf = (c) => (c ? (c._seriesId !== undefined ? c._seriesId : c.id) : undefined);
const sameId = (a, b) => a !== undefined && a !== null && b !== undefined && b !== null && String(a) === String(b);

/** The attendance entry of `classId` on `date`, or null. */
export function attendanceAt(classes, classId, date) {
  for (const c of classes || []) {
    if (!sameId(seriesIdOf(c), classId)) continue;
    const e = (c.attendanceLog || []).find((x) => x && x.date === date);
    if (e) return e;
  }
  return null;
}

/** The dateCancellations entry of `classId` on `date` (pause, cancellation, reprogramming), or null. */
export function dateEntryAt(classes, classId, date) {
  for (const c of classes || []) {
    if (!sameId(seriesIdOf(c), classId)) continue;
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

/** The card of `classId` on `date` (an expanded Agenda card), or undefined. */
export function classCardOn(classes, classId, date) {
  return (classes || []).find((cl) => cl.date === date && sameId(seriesIdOf(cl), classId));
}

/**
 * The card that holds a combo slot on `date`: the card of the combo's own class; a legacy combo (no sourceClassId)
 * keeps the previous reading, the first card on that date.
 */
export function slotCardOn(classes, combo, date) {
  if (combo && combo.sourceClassId !== undefined) return classCardOn(classes, combo.sourceClassId, date);
  return (classes || []).find((cl) => cl.date === date);
}

/** The class a combo slot on `date` belongs to: combo.sourceClassId, else the class of its card (legacy). */
export function slotClassId(classes, combo, date) {
  if (combo && combo.sourceClassId !== undefined) return combo.sourceClassId;
  return seriesIdOf(slotCardOn(classes, combo, date));
}

/**
 * The single reading of one student's attendance in one class on one date (see priority above).
 * -> { state: "present"|"ausente_dada"|"ausente_reprog"|"unmarked"|null, source: "attendance"|null, entry }
 */
export function readAttendance({ classes, classId, date, studentId }) {
  const entry = classId === undefined || classId === null ? null : attendanceAt(classes, classId, date);
  if (entry) return { state: attendanceState(entry, studentId) || "unmarked", source: "attendance", entry };
  // Stage 2.1 will read the advance absence notice of (classId, date, studentId) here.
  return { state: null, source: null, entry: null };
}
