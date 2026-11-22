import { overrideMessage } from "./occurrenceOverrides.js";

/*
 * Editar clase — BUG-AGENDA-05, phase 1. Pure, no React.
 *
 * The class model has no per-date version of the weekdays, title or students: they belong to the whole series.
 * Stage 2.2: time and court DO have a per-date version (occurrenceOverrides.js) — singleDateRefusedChanges leaves them
 * out. "📅 Solo esta clase" refuses days, title and students (singleDateEditChanges lists every series field) and only
 * "🔄 A Todas las Clases" applies them; moving one date is "Reprogramar". A package change for a student is not a
 * class field and keeps working from both choices.
 *
 * Regenerating the occurrences (weekday change, or too few occurrences) must never drop a date that already has a
 * history (keepDatesWithHistory): past dates, dates with attendance, dates with a dateCancellations entry (paused,
 * cancelled, reprogrammed — the origin of a reprogramming is what keeps its destination's card) and dates added
 * with "Agregar día al combo". Only dates of the previous occurrences are kept; nothing is invented.
 */

const DAYS = "días";
const TIME = "horario";
const COURT = "cancha";
const TITLE = "título";
const STUDENTS = "alumnos";

const text = (v) => (v === undefined || v === null ? "" : String(v));
const sameSet = (a, b) => {
  const x = new Set((a || []).map(String));
  const y = new Set((b || []).map(String));
  if (x.size !== y.size) return false;
  for (const v of x) if (!y.has(v)) return false;
  return true;
};

/**
 * Which series fields the edit changes, as the labels shown to the coach (empty = nothing to refuse).
 * Compared the way EditClassScreen starts: timeEnd defaults to "09:00" and students unknown to the coach
 * (deleted) are not shown, so neither reads as a change the coach made.
 */
export function singleDateEditChanges(series, edited, knownStudentIds) {
  if (!series || !edited) return [];
  const changes = [];
  if (!sameSet(series.days, edited.days)) changes.push(DAYS);
  if (text(series.time) !== text(edited.time) || (series.timeEnd || "09:00") !== (edited.timeEnd || "09:00")) changes.push(TIME);
  if (text(series.court) !== text(edited.court)) changes.push(COURT);
  if (text(series.title) !== text(edited.title)) changes.push(TITLE);
  const known = knownStudentIds ? new Set([...knownStudentIds].map(String)) : null;
  const before = (series.students || []).filter((id) => !known || known.has(String(id)));
  if (!sameSet(before, edited.students)) changes.push(STUDENTS);
  return changes;
}

/** Stage 2.2: the series fields "Solo esta clase" still refuses (time and court are saved for that date only). */
export function singleDateRefusedChanges(series, edited, knownStudentIds) {
  return singleDateEditChanges(series, edited, knownStudentIds).filter((x) => x !== TIME && x !== COURT);
}

export function singleDateEditMessage(changes) {
  const list = changes || [];
  if (list.length === 0) return "";
  const what = list.length === 1 ? list[0] : list.slice(0, -1).join(", ") + " ni " + list[list.length - 1];
  return "Solo esta clase no puede cambiar " + what + ": esos cambios se aplican a todas las clases. Para mover solo esta fecha, usá Reprogramar.";
}

/**
 * The regenerated occurrences plus every previous date that has a history. Sorted, without duplicates.
 * A past date that was not an occurrence before is never added (stage 0: no invented past dates).
 */
export function keepDatesWithHistory({ previous, next, attendanceLog, dateCancellations, addedDates, todayDate }) {
  const attended = new Set((attendanceLog || []).map((e) => e && e.date).filter((d) => typeof d === "string"));
  const dc = dateCancellations || {};
  const before = new Set((previous || []).filter((d) => typeof d === "string"));
  const kept = [...before].filter(
    (d) => (todayDate && d < todayDate) || attended.has(d) || Object.prototype.hasOwnProperty.call(dc, d)
  );
  const fresh = (next || []).filter((d) => typeof d === "string" && (!todayDate || d >= todayDate || before.has(d)));
  const added = (addedDates || []).map((a) => a && a.date).filter((d) => typeof d === "string");
  return [...new Set([...fresh, ...kept, ...added])].sort();
}

const isoOf = (x) => x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");

/**
 * Stage 0 (BUG-AGENDA-05): the occurrences after a weekday change (or a refill when there are too few).
 * Every previous date before the change point is kept exactly; from the change point on (the selected card's date,
 * or today when that is later) the new weekdays are generated up to the class end date, or 6 months after the change
 * point; previous dates from there on that carry a dateCancellations entry, and added dates, are kept.
 * Dates with attendance are kept by keepDatesWithHistory on save (the card only carries its own attendance).
 * `dowSet` holds JS weekday numbers (classDowSetFrom); an empty set changes nothing.
 */
export function regenerateOccurrences({ previous, dowSet, fromDate, todayDate, endDate, addedDates, dateCancellations }) {
  const prev = (previous || []).filter((d) => typeof d === "string");
  if (!dowSet || dowSet.size === 0) return [...new Set(prev)].sort();
  const from = todayDate && (!fromDate || fromDate < todayDate) ? todayDate : fromDate;
  if (!from) return [...new Set(prev)].sort();
  const dc = dateCancellations || {};
  const added = (addedDates || []).map((a) => a && a.date).filter((d) => typeof d === "string");
  const addedSet = new Set(added);
  const keptBefore = prev.filter((d) => d < from);
  const keptAfter = prev.filter((d) => d >= from && (Object.prototype.hasOwnProperty.call(dc, d) || addedSet.has(d)));
  const start = new Date(from + "T12:00:00");
  const end = endDate ? new Date(endDate + "T12:00:00") : new Date(new Date(from + "T12:00:00").setMonth(start.getMonth() + 6));
  const generated = [];
  for (let cur = new Date(start); cur <= end && generated.length < 200; cur.setDate(cur.getDate() + 1)) {
    if (dowSet.has(cur.getDay())) generated.push(isoOf(cur));
  }
  return [...new Set([...keptBefore, ...generated, ...keptAfter, ...added])].sort();
}

const tiedToSeries = (combo, series, studentId) => {
  if (!combo) return false;
  if (combo.sourceClassId !== undefined) return combo.sourceClassId === series.id;
  return (series.students || []).includes(studentId);
};

/**
 * Stage 0: future combo / individual dates that this edit would leave without an Agenda card.
 * Only dates that are occurrences now and stop being occurrences after the edit count (an older gap is not this
 * edit's doing); mensual has no dated slots. -> [{studentId, name, dates}]
 */
export function comboDatesLeftWithoutCard({ series, students, nextOccurrences, todayDate }) {
  if (!series || !Array.isArray(nextOccurrences)) return [];
  const prev = new Set(series.occurrences || []);
  const final = new Set(
    keepDatesWithHistory({
      previous: series.occurrences,
      next: nextOccurrences,
      attendanceLog: series.attendanceLog,
      dateCancellations: series.dateCancellations,
      addedDates: series.addedDates,
      todayDate,
    })
  );
  const out = [];
  for (const st of students || []) {
    const lost = new Set();
    for (const combo of st.combos || []) {
      if (!combo || combo.packType === "mensual" || !Array.isArray(combo.dates) || !tiedToSeries(combo, series, st.id)) continue;
      for (const d of combo.dates) if (typeof d === "string" && (!todayDate || d >= todayDate) && prev.has(d) && !final.has(d)) lost.add(d);
    }
    if (lost.size > 0) out.push({ studentId: st.id, name: st.name || "Alumno", dates: [...lost].sort() });
  }
  return out;
}

/**
 * The combos removeStudentsFromClass leaves for a student removed from a class (moved here verbatim so the removal
 * guard judges exactly the combos the removal touches). null entries are dropped (combo deleted).
 */
export function cleanComboAfterClassRemoval(combo, realId, classDates) {
  // A combo with a known sourceClassId is only ever touched when it's
  // THIS class — never stripped by date coincidence once we know for
  // certain which class it belongs to. Legacy combos (no
  // sourceClassId) keep the existing date-set heuristic exactly as
  // before — the only signal available for data that predates this.
  if (combo.sourceClassId !== undefined && combo.sourceClassId !== realId) return combo;
  const comboDates = combo.dates || [combo.date].filter(Boolean);
  const filteredDates = comboDates.filter((d) => !classDates.has(d));
  if (filteredDates.length === 0) return null;
  return { ...combo, dates: filteredDates, total: filteredDates.length, date: filteredDates[0] };
}

export function cleanCombosAfterClassRemoval(combos, realId, classDates) {
  return (combos || []).map((combo) => cleanComboAfterClassRemoval(combo, realId, classDates)).filter(Boolean);
}

const PAYMENTS = "pagos";
const MENSUAL_PAID = "mensualidades pagadas";
const ATTENDANCE = "asistencia";
const HISTORY = "historial de clases";

/** Why a combo cannot be cut or deleted (empty = no history). */
function comboHistoryReasons(combo, dc) {
  const r = new Set();
  if ((Array.isArray(combo.payments) && combo.payments.length > 0) || Number(combo.paidCount || 0) > 0 || combo.paid === true) r.add(PAYMENTS);
  if (Array.isArray(combo.historialPagos) && combo.historialPagos.length > 0) r.add(PAYMENTS);
  if ((combo.mensualidades || []).some((m) => m && (m.estado === "pagado" || m.fechaPago))) r.add(MENSUAL_PAID);
  if (Number(combo.used || 0) > 0) r.add(ATTENDANCE);
  if (["resumeOperations", "slotRelocations", "dateAdditions"].some((k) => Array.isArray(combo[k]) && combo[k].length > 0)) r.add(HISTORY);
  if ((combo.dates || []).some((d) => dc && Object.prototype.hasOwnProperty.call(dc, d))) r.add(HISTORY);
  return r;
}

/**
 * Stage 0: students removed from the class who have a history there. Their removal is refused (nothing written):
 * a combo with payments, paid months, attendance or class history is never cut or deleted, and attendance recorded
 * in this class keeps its student. Students unknown to the coach (deleted) are not judged.
 * -> [{studentId, name, reasons}]
 */
export function studentRemovalBlock({ series, students, nextStudentIds }) {
  if (!series || !Array.isArray(nextStudentIds)) return [];
  const next = new Set(nextStudentIds.map(String));
  const classDates = new Set(series.occurrences || [series.date].filter(Boolean));
  const out = [];
  for (const sid of series.students || []) {
    if (next.has(String(sid))) continue;
    const st = (students || []).find((s) => s.id === sid);
    if (!st) continue;
    const reasons = new Set();
    for (const combo of st.combos || []) {
      const after = cleanComboAfterClassRemoval(combo, series.id, classDates);
      // touched = deleted, or its dates/total cut (the removal also rewrites `date` on an untouched legacy combo)
      const touched = after === null || JSON.stringify(after.dates) !== JSON.stringify(combo.dates || [combo.date].filter(Boolean)) || after.total !== combo.total;
      if (touched) comboHistoryReasons(combo, series.dateCancellations).forEach((x) => reasons.add(x));
    }
    for (const e of series.attendanceLog || []) {
      if (e && ["present", "ausente_dada", "ausente_reprog"].some((k) => (e[k] || []).includes(sid))) reasons.add(ATTENDANCE);
    }
    if (reasons.size > 0) out.push({ studentId: sid, name: st.name || "Alumno", reasons: [...reasons] });
  }
  return out;
}

/** Card state that belongs to one date (pause, cancellation, reprogramming, per-date flags), never to an edit. */
const CARD_STATE_KEYS = [
  "cancelled", "cancelType", "paused", "rescheduledTo", "rescheduled", "_isRescheduledInstance", "attendanceLog",
  "_resuming", "_reactivating", "_plannedResumeDate", "_pauseResumeDate", "_endOfPackage", "_revertReprog",
  "_compensatedPausedDates", "_resumeOperationId", "_newOccurrenceDates", "_occOnly",
  "occurrenceOverride", "seriesValues", "_destTime", // stage 2.2: a card's per-date marker/series values, Reprogramar's destination time
];

/** Stage 0: the editable data of an Agenda card; keeps id, _seriesId, _virtualId and date (which class / which date). */
export function editableFromCard(card) {
  const out = { ...(card || {}) };
  for (const k of CARD_STATE_KEYS) delete out[k];
  return out;
}

/** Stage 0: what "A Todas las Clases" may merge into the series row (no card ids, state or scope flags). */
export function seriesFieldsFromEdit(cd) {
  const out = editableFromCard(cd);
  for (const k of ["_virtualId", "_seriesId", "applyToAll", "_singleDate", "_confirmAttended"]) delete out[k];
  return out;
}

const list = (names) => (names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " y " + names[names.length - 1]);

/** The coach-facing message of an edit refused by handleSaveClass (empty when the result is not a refusal). */
export function editRefusalMessage(r) {
  if (!r || typeof r !== "object") return "";
  if (r.status === "single-date-edit-refused") return singleDateEditMessage(r.changes);
  if (r.status === "weekday-change-blocked") return weekdayChangeMessage(r.affected);
  if (r.status === "student-removal-blocked") return studentRemovalMessage(r.blocked);
  if (r.status === "override-refused") return overrideMessage(r.reason);
  return "";
}

export function weekdayChangeMessage(affected) {
  const a = affected || [];
  if (a.length === 0) return "";
  const who = list(a.map((x) => x.name + " (" + x.dates.length + (x.dates.length === 1 ? " fecha" : " fechas") + ")"));
  return "Por ahora no se pueden cambiar los días de esta clase: quedarían sin clase en la Agenda fechas futuras de combos o paquetes individuales de " + who + ".";
}

export function studentRemovalMessage(blocked) {
  const b = blocked || [];
  if (b.length === 0) return "";
  const who = list(b.map((x) => x.name + " (" + x.reasons.join(", ") + ")"));
  return "No se puede quitar de esta clase a " + who + ": tiene" + (b.length > 1 ? "n" : "") + " historial registrado. Solo se puede quitar a un alumno sin pagos, asistencias ni historial (por ejemplo, agregado por error).";
}
