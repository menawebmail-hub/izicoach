import { attendanceState, NOTICE_STATUSES, noticeOf } from "./attendanceRead.js";

export { NOTICE_STATUSES, noticeOf };

/*
 * Advance absence notices — BUG-AGENDA-05 stage 2.1. Pure, no React.
 *
 * Stored on the CLASS row, apart from attendanceLog, by the real date of the class and the student:
 *   class.attendanceNotices = { [date]: { [studentId]: { status, at, history: [{ status, at }] } } }
 *   status: "ausente_dada" | "ausente_reprog" | null (null = the notice was withdrawn; kept as history)
 * A notice is never attendance: the explicit attendance of that class and date always wins (readAttendance), and the
 * Asistencia screen starts from the notice so the coach confirms or corrects it (e.g. the student came after all).
 * Owner rules (2026-11-21): Ausente – Dada consumes the class only once its date and time have passed; Ausente – No
 * dada never consumes and shows in Inicio as pending only after the class; classmates are never touched; a notice is
 * refused when the day's attendance is already recorded (correct Asistencia instead), on a paused / cancelled /
 * reprogrammed date, and on a past date; for mensual students it is informational (Ausente only, no billing effect).
 */

const NOTICE_TEXT = {
  "not-live": "Esta fecha está pausada, cancelada o reprogramada: no admite avisos.",
  past: "Para una fecha pasada registrá la asistencia en «Asistencia».",
  "attendance-recorded": "Ya hay asistencia registrada para esta fecha. Si algo cambió, corregila en «Asistencia».",
  "not-in-class": "El alumno no pertenece a esta clase.",
  status: "Estado de aviso no válido.",
  mensual: "Para un alumno mensual el aviso solo puede ser «Ausente».",
  "no-notice": "No hay un aviso para quitar.",
  "unknown-class": "No se encontró la clase.",
  "write-pending": "Hay cambios guardándose; probá de nuevo en un momento.",
};
export const noticeMessage = (reason) => NOTICE_TEXT[reason] || "No se pudo guardar el aviso.";

/** Every record (active or withdrawn) of a class row or card for (date, studentId), for its history. */
export const noticeRecordOf = (classOrCard, date, studentId) =>
  (classOrCard && classOrCard.attendanceNotices && classOrCard.attendanceNotices[date] && classOrCard.attendanceNotices[date][studentId]) || null;

/** Why an Agenda card cannot take notices now (null = it can). The card carries its own date's attendance entry. */
export function cardNoticeRefusal(card, todayDate) {
  if (!card) return "unknown-class";
  if (card.cancelled || card.paused || card.cancelType === "paused" || card.cancelType === "cancelled_reprog" || card.cancelType === "cancelled") return "not-live";
  if (todayDate && card.date < todayDate) return "past";
  if ((card.attendanceLog || []).some((e) => e && e.date === card.date)) return "attendance-recorded";
  return null;
}

/** Whether `date` is a live date of the class row: an occurrence without its own entry, or a live reprogramming destination. */
function isLiveDate(row, date) {
  const dc = row.dateCancellations || {};
  if (Object.prototype.hasOwnProperty.call(dc, date)) return false;
  if ((row.occurrences || []).includes(date)) return true;
  return Object.values(dc).some((e) => e && e.cancelType === "cancelled_reprog" && e.rescheduledTo === date);
}

/**
 * Write-time check on the LATEST class row (nothing is written when refused).
 * changes: [{ studentId, status }] with status in NOTICE_STATUSES or null (withdraw). isMensual(studentId) -> bool.
 */
export function noticeWriteRefusal({ row, date, changes, todayDate, isMensual }) {
  if (!row) return "unknown-class";
  if (todayDate && date < todayDate) return "past";
  if (!isLiveDate(row, date)) return "not-live";
  if ((row.attendanceLog || []).some((e) => e && e.date === date)) return "attendance-recorded";
  for (const ch of changes || []) {
    if (!(row.students || []).includes(ch.studentId)) return "not-in-class";
    if (ch.status !== null && !NOTICE_STATUSES.includes(ch.status)) return "status";
    if (ch.status === "ausente_reprog" && isMensual && isMensual(ch.studentId)) return "mensual";
    if (ch.status === null && !noticeOf(row, date, ch.studentId)) return "no-notice";
  }
  return null;
}

/** The class row with the notices applied; each change is appended to that notice's history. Never mutates. */
export function applyNoticesToClassRow(row, { date, changes, at }) {
  const all = { ...(row.attendanceNotices || {}) };
  const day = { ...(all[date] || {}) };
  let changed = false;
  for (const { studentId, status } of changes || []) {
    const prev = day[studentId] || null;
    if (prev && prev.status === status) continue;
    if (!prev && status === null) continue;
    day[studentId] = { status, at, history: [...((prev && prev.history) || []), { status, at }] };
    changed = true;
  }
  if (!changed) return row;
  all[date] = day;
  return { ...row, attendanceNotices: all };
}

/** Students of an Agenda card with an Ausente – No dada notice that the day's attendance does not decide yet. */
export function pendingNoticeStudentIds(card) {
  const entry = (card.attendanceLog || []).find((e) => e && e.date === card.date) || null;
  const day = (card.attendanceNotices && card.attendanceNotices[card.date]) || {};
  return Object.keys(day)
    .map((k) => ((card.students || []).find((sid) => String(sid) === k)))
    .filter((sid) => sid !== undefined && noticeOf(card, card.date, sid) && noticeOf(card, card.date, sid).status === "ausente_reprog" && !attendanceState(entry, sid));
}

/**
 * Inicio "para reprogramar" alerts (stage 2.1 review). Students of an Agenda card who owe a makeup that day: explicit
 * Ausente – No dada in the day's attendance, or a No dada notice the day's attendance does not decide.
 */
export function noGivenStudentIds(card) {
  const entry = (card.attendanceLog || []).find((e) => e && e.date === card.date) || null;
  return (card.students || []).filter((sid) => {
    const st = attendanceState(entry, sid);
    if (st) return st === "ausente_reprog";
    const n = noticeOf(card, card.date, sid);
    return !!n && n.status === "ausente_reprog";
  });
}

/**
 * True only when EVERY known student of the card owes that class (nobody took it): then reprogramming the whole class
 * moves nobody's consumed class and the existing class-level flow stays legitimate. Otherwise the absence is
 * individual and must never reprogram the whole class (individual recovery: stage 3).
 */
export function isWholeClassAbsence(card, knownStudentIds) {
  const known = new Set((knownStudentIds || []).map(String));
  const roster = (card.students || []).filter((sid) => !knownStudentIds || known.has(String(sid)));
  if (roster.length === 0) return false;
  const absent = new Set(noGivenStudentIds(card).map(String));
  return roster.every((sid) => absent.has(String(sid)));
}

/** Coach-facing text of an individual pending recovery in Inicio (names: one or more first names). */
export const individualRecoveryMessage = (names) => {
  const list = (Array.isArray(names) ? names : [names]).filter(Boolean);
  const who = list.length <= 1 ? list[0] || "El alumno" : list.slice(0, -1).join(", ") + " y " + list[list.length - 1];
  return list.length > 1
    ? who + " tienen una recuperación individual pendiente. Esta función estará disponible próximamente."
    : who + " tiene una recuperación individual pendiente. Esta función estará disponible próximamente.";
};
