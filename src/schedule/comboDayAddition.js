import { resolveComboDateStatus } from "./rescheduleChain.js";

/*
 * "Agregar día al combo": add ONE concrete date to the current combo of every combo student of a class and drop
 * the last eligible future date of each, so the total, the price and the payments stay the same.
 * Pure, no React; the caller passes the latest state and "today", and checks the slot readings (payments,
 * given, paused) before and after with the real Cobros functions.
 *
 * Example: combo of 8 Mondays 26/10 … 14/12; add Thursday 29/10 -> dates 26/10, 29/10, 02/11 … 07/12 (14/12 goes
 * back to a grey "Sin pagar" date). combo.dates stays sorted: Cobros assigns payments by position, and a later
 * sort (resume, package edit) must never move them; a partly paid combo where the new date would land before a
 * paid class is refused by the caller's readings check.
 *
 * Durable record, written students first, then the class:
 *   - combo.dateAdditions: [{id, date, removed, classId, at}]
 *   - class.addedDates:    [{id, date, studentIds, at}] — the date also joins class.occurrences when missing;
 *     EditClassScreen keeps these dates when it regenerates the occurrences.
 * A half-written addition (students saved, class not) counts nothing twice; findPendingAdditionCompletions
 * finishes the class part idempotently.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isIsoDate = (d) => {
  if (typeof d !== "string" || !ISO.test(d)) return false;
  const x = new Date(d + "T12:00:00");
  if (isNaN(x.getTime())) return false;
  return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0") === d;
};
const fail = (reason, extra) => ({ ok: false, reason, ...(extra || {}) });
const belongsToSeries = (combo, series, knownSeriesIds) =>
  combo.sourceClassId === undefined || combo.sourceClassId === series.id || (knownSeriesIds && !knownSeriesIds.has(combo.sourceClassId));
const isCurrentClassCombo = (combo, todayDate) =>
  !!combo && Array.isArray(combo.dates) && (combo.packType || "combo") === "combo" && (combo.total || 0) > 0 && combo.dates.some((d) => d >= todayDate);

/**
 * The addition for every combo student of the class. ok -> { ok, seriesId, date, addOccurrence,
 * affected:[{studentId, comboIndex, comboId, removed, total}] }. Never partial: one refusal refuses all.
 */
export function resolveComboDayAddition({ series, students, date, todayDate, knownSeriesIds }) {
  if (!series || !Array.isArray(series.occurrences) || !isIsoDate(todayDate)) return fail("not-applicable");
  if (!isIsoDate(date)) return fail("invalid-date");
  if (date < todayDate) return fail("past", { blockDate: date });
  const dc = series.dateCancellations && typeof series.dateCancellations === "object" ? series.dateCancellations : {};
  const log = Array.isArray(series.attendanceLog) ? series.attendanceLog : [];
  const chainTargets = new Set(Object.values(dc).map((e) => e && e.rescheduledTo).filter(Boolean));
  if (dc[date] || chainTargets.has(date)) return fail("date-busy", { blockDate: date });
  if (log.some((e) => e && e.date === date)) return fail("attendance-on-date", { blockDate: date });
  const planned = series.plannedResume && !series.plannedResume.completed ? series.plannedResume : null;
  if (planned) return fail("planned-resume", { blockDate: planned.resumeDate || null });

  const affected = [];
  for (const sid of series.students || []) {
    const st = (students || []).find((s) => s.id === sid);
    if (!st) continue;
    const mine = (st.combos || []).map((combo, comboIndex) => ({ combo, comboIndex })).filter(({ combo }) => combo && belongsToSeries(combo, series, knownSeriesIds));
    // Mensual / individual students of the class are out of scope in this version: refuse, never skip them.
    if (mine.some(({ combo }) => combo.packType === "mensual" || (combo.packType === "individual" && Array.isArray(combo.dates) && combo.dates.some((d) => d >= todayDate)))) return fail("mixed-class", { studentId: sid });
    const current = mine.filter(({ combo }) => isCurrentClassCombo(combo, todayDate));
    if (current.length === 0) continue;
    if (current.length > 1) return fail("ambiguous", { studentId: sid });
    const { combo, comboIndex } = current[0];
    if (combo.dates.includes(date)) return fail("already-in-combo", { studentId: sid, blockDate: date });
    // A combo in an active pause is never edited.
    for (const d0 of combo.dates) {
      const r = resolveComboDateStatus(dc, d0);
      if (r.broken) return fail("chain", { studentId: sid });
      if (r.cancelInfo && r.cancelInfo.cancelType === "paused" && !r.cancelInfo.compensated) return fail("paused", { studentId: sid, blockDate: r.terminal });
    }
    const ops = Array.isArray(combo.resumeOperations) ? combo.resumeOperations : [];
    const resumeDates = new Set(ops.flatMap((op) => [...((op && op.pausedDates) || []), ...((op && op.replacementDates) || [])]));
    if (resumeDates.has(date)) return fail("resume-date", { studentId: sid, blockDate: date });
    // The date that leaves: the latest future date after the new one that nothing depends on.
    const removable = combo.dates.filter((d) =>
      d > date && d > todayDate && !dc[d] && !chainTargets.has(d) && !resumeDates.has(d) && !log.some((e) => e && e.date === d));
    if (removable.length === 0) return fail("no-removable", { studentId: sid, blockDate: date });
    const removed = removable.reduce((m, d) => (d > m ? d : m));
    affected.push({ studentId: sid, comboIndex, comboId: combo.id, removed, total: combo.total });
  }
  if (affected.length === 0) return fail("no-combo");
  return { ok: true, seriesId: series.id, date, addOccurrence: !series.occurrences.includes(date), affected };
}

/** Combo after the addition: the new date in, the removed one out, still sorted; idempotent by operation id. */
export function applyAdditionToCombo(combo, { opId, date, removed, classId, at }) {
  const records = Array.isArray(combo.dateAdditions) ? combo.dateAdditions : [];
  if (records.some((r) => r && r.id === opId)) return combo;
  if (!Array.isArray(combo.dates) || combo.dates.includes(date) || !combo.dates.includes(removed)) return combo;
  return {
    ...combo,
    dates: [...combo.dates.filter((d) => d !== removed), date].sort(),
    dateAdditions: [...records, { id: opId, date, removed, classId, at }],
  };
}

/** Every affected student's combo after the addition (one students write). */
export function applyAdditionToStudents(students, addition, { opId, at }) {
  return (students || []).map((st) => {
    const a = addition.affected.find((x) => x.studentId === st.id);
    if (!a) return st;
    return { ...st, combos: (st.combos || []).map((c, i) => (i === a.comboIndex ? applyAdditionToCombo(c, { opId, date: addition.date, removed: a.removed, classId: addition.seriesId, at }) : c)) };
  });
}

/** Class row after the addition: the date in occurrences and the durable record; idempotent. */
export function applyAdditionToClassRow(c, { opId, date, studentIds, at }) {
  const occ = Array.isArray(c.occurrences) ? c.occurrences : [];
  const records = Array.isArray(c.addedDates) ? c.addedDates : [];
  const needOcc = !occ.includes(date);
  const needRecord = !records.some((r) => r && r.id === opId);
  if (!needOcc && !needRecord) return c;
  return {
    ...c,
    occurrences: needOcc ? [...new Set([...occ, date])].sort() : occ,
    addedDates: needRecord ? [...records, { id: opId, date, studentIds: studentIds || [], at }] : records,
  };
}

/** Additions whose students part is saved but whose class part is not (recovery after a partial write). */
export function findPendingAdditionCompletions(classes, students) {
  const out = [];
  const seen = new Set();
  for (const st of students || []) {
    for (const combo of st.combos || []) {
      for (const r of Array.isArray(combo.dateAdditions) ? combo.dateAdditions : []) {
        if (!r || seen.has(r.id)) continue;
        seen.add(r.id);
        const series = (classes || []).find((c) => c.id === r.classId);
        if (!series) continue;
        const done = (series.occurrences || []).includes(r.date) && (series.addedDates || []).some((x) => x && x.id === r.id);
        if (done) continue;
        const studentIds = (students || []).filter((s) => (s.combos || []).some((k) => (k.dateAdditions || []).some((x) => x && x.id === r.id))).map((s) => s.id);
        out.push({ seriesId: r.classId, opId: r.id, date: r.date, studentIds, at: r.at });
      }
    }
  }
  return out;
}

/** Whether the class has at least one combo student with a current combo (shows the Agenda action). */
export function hasCurrentComboForDayAddition({ series, students, todayDate, knownSeriesIds }) {
  if (!series) return false;
  return (series.students || []).some((sid) => {
    const st = (students || []).find((s) => s.id === sid);
    return !!st && (st.combos || []).some((c) => c && belongsToSeries(c, series, knownSeriesIds) && isCurrentClassCombo(c, todayDate));
  });
}

const ddmm = (d) => (typeof d === "string" && ISO.test(d) ? d.slice(8, 10) + "/" + d.slice(5, 7) : String(d));
const DATED = {
  past: (d) => `El ${d} ya pasó: elegí una fecha de hoy en adelante.`,
  "date-busy": (d) => `El ${d} ya tiene una reprogramación, cancelación o pausa en esta clase.`,
  "attendance-on-date": (d) => `El ${d} ya tiene asistencia registrada.`,
  "already-in-combo": (d) => `El ${d} ya es una clase del combo.`,
  "no-removable": (d) => `No hay una fecha futura del combo después del ${d} que se pueda reemplazar sin tocar clases realizadas, reprogramadas o con asistencia.`,
  paused: (d) => `No se puede mientras haya una pausa activa (el ${d}) en el combo.`,
  "planned-resume": (d) => `No se puede mientras la clase tenga una reanudación planificada desde el ${d}.`,
  "resume-date": (d) => `El ${d} forma parte de una reanudación del combo.`,
  "payment-shift": (d) => `El combo está pagado en parte: agregar esa fecha cambiaría qué clases figuran pagadas. Elegí una fecha posterior al ${d}.`,
};
const MESSAGES = {
  "invalid-date": "Elegí una fecha válida.",
  "mixed-class": "La clase tiene alumnos con plan mensual o individual: todavía no se puede agregar un día a esta clase.",
  ambiguous: "Un alumno tiene más de un combo vigente en esta clase: no se puede elegir cuál cambiar.",
  "no-combo": "Ningún alumno de esta clase tiene un combo vigente.",
  "payment-shift": "El combo está pagado en parte: agregar esa fecha cambiaría qué clases figuran pagadas.",
  chain: "Hay reprogramaciones inconsistentes en el combo: no se puede agregar un día.",
  changed: "La clase o el combo cambiaron mientras revisabas. Cerrá y volvé a abrir.",
  "write-pending": "Hay cambios pendientes de sincronizar. Esperá unos segundos e intentá de nuevo.",
  "write-failed": "No se pudo guardar. Revisá la conexión e intentá de nuevo; lo que ya se guardó se completa solo.",
};
/** Readable text for a refusal; `info.blockDate` (when present) names the exact date. */
export const additionMessage = (reason, info) =>
  (DATED[reason] && info && info.blockDate ? DATED[reason](ddmm(info.blockDate)) : null) ||
  MESSAGES[reason] || "No se pudo agregar el día al combo. Revisá la clase e intentá de nuevo.";
