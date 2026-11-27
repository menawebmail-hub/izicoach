// Which of a student's combos belong to ONE class (Agenda grey "Sin pagar" cards, Asistencia lock, Renovar Combo,
// Pausar → end of package). Pure, no imports beyond the shared id helper.
//
// A combo belongs to a class when:
//   - its sourceClassId names that class. A sourceClassId naming ANOTHER existing class means another class. With
//     `knownSeriesIds` given, an id naming no existing class is orphan legacy data (same rule as Pausar's
//     resolveEndOfPackageTarget) and is read like a missing one;
//   - legacy (no sourceClassId, or orphan): exactly ONE class the student is enrolled in holds the combo's dates and
//     it is this class. No class, or more than one, is ambiguous: never assumed to be this class.
// A mensual belongs to a class by sourceClassId; a legacy mensual (no id, or orphan) only when the student is
// enrolled in exactly one class.

import { seriesIdOf } from "./attendanceRead.js";

const sameId = (a, b) => a !== undefined && a !== null && b !== undefined && b !== null && String(a) === String(b);

/** Every class (raw rows or expanded cards, grouped by series) with the dates it holds and its students. */
function indexClasses(classes) {
  const bySeries = new Map();
  for (const c of classes || []) {
    const id = seriesIdOf(c);
    if (id === undefined || id === null) continue;
    const key = String(id);
    let e = bySeries.get(key);
    if (!e) bySeries.set(key, (e = { id, dates: new Set(), students: new Set() }));
    for (const d of Array.isArray(c.occurrences) ? c.occurrences : []) e.dates.add(d);
    if (c.date) e.dates.add(c.date);
    for (const sid of c.students || []) e.students.add(String(sid));
  }
  return bySeries;
}

const memo = new WeakMap();
const indexOf = (classes) => {
  if (!classes || typeof classes !== "object") return indexClasses(classes);
  if (!memo.has(classes)) memo.set(classes, indexClasses(classes));
  return memo.get(classes);
};

/** sourceClassId names a class (true), names no existing class (orphan → legacy, false), or is missing (false). */
function hasAuthoritativeId(combo, knownSeriesIds) {
  if (!combo || combo.sourceClassId === undefined || combo.sourceClassId === null) return false;
  if (!knownSeriesIds) return true;
  for (const k of knownSeriesIds) if (sameId(k, combo.sourceClassId)) return true;
  return false;
}

const enrolledClasses = (index, studentId) => [...index.values()].filter((e) => e.students.has(String(studentId)));

/** "own" | "other" | "ambiguous": whether a class combo (combo / individual) belongs to class `seriesId`. */
export function comboClassMembership({ combo, seriesId, studentId, classes, knownSeriesIds }) {
  if (hasAuthoritativeId(combo, knownSeriesIds)) return sameId(combo.sourceClassId, seriesId) ? "own" : "other";
  const dates = (combo && Array.isArray(combo.dates) && combo.dates.length ? combo.dates : [combo && combo.date]).filter(Boolean);
  const holders = enrolledClasses(indexOf(classes), studentId).filter((e) => dates.some((d) => e.dates.has(d)));
  if (holders.length !== 1) return "ambiguous";
  return sameId(holders[0].id, seriesId) ? "own" : "other";
}

/** "own" | "other" | "ambiguous": whether a mensual entry belongs to class `seriesId`. */
export function mensualClassMembership({ combo, seriesId, studentId, classes, knownSeriesIds }) {
  if (hasAuthoritativeId(combo, knownSeriesIds)) return sameId(combo.sourceClassId, seriesId) ? "own" : "other";
  const mine = enrolledClasses(indexOf(classes), studentId);
  if (mine.length !== 1) return "ambiguous";
  return sameId(mine[0].id, seriesId) ? "own" : "other";
}

const startOf = (combo) => {
  const ds = (combo && Array.isArray(combo.dates) ? combo.dates : []).filter(Boolean).sort();
  return ds[0] || (combo && combo.date) || "";
};

/**
 * The class combos of class `seriesId` that decide its card on `date` for one student.
 *   classCombos  = the student's class entitlements (combos / individuals, any class)
 *   mensuals     = the student's mensual entries (any class)
 * Only this class's combos count. When a mensual of this class has started on or before `date`, it is the current
 * modality: combos that started before it never make the card grey (whatever the mensual's payment state); only a
 * combo of this class started after the mensual (the student went back to combos) still counts.
 */
export function classCombosAt({ classCombos, mensuals, seriesId, studentId, date, classes, knownSeriesIds }) {
  const scope = { seriesId, studentId, classes, knownSeriesIds };
  const own = (classCombos || []).filter((combo) => comboClassMembership({ ...scope, combo }) === "own");
  const mensualStarts = (mensuals || [])
    .filter((m) => m && (m.date || "") <= (date || "") && mensualClassMembership({ ...scope, combo: m }) === "own")
    .map((m) => m.date || "");
  if (mensualStarts.length === 0) return own;
  const mensualStart = mensualStarts.sort()[mensualStarts.length - 1];
  return own.filter((combo) => startOf(combo) > mensualStart);
}
