/*
 * Per-occurrence time and court — BUG-AGENDA-05 stage 2.2. Pure, no React.
 *
 * Stored on the CLASS row by the real date of the occurrence (never by the slot's original date):
 *   class.occurrenceOverrides = { [date]: { time, timeEnd, court, at, history: [{ time, timeEnd, court, at }] } }
 * Only fields that differ from the series are kept (null = the series value). An entry whose fields are all null is
 * "restored" and kept as history. expandClasses applies the active fields to that date's card only, so the day and
 * week views, the card's end time read by Cobros (isClassDone) and every card consumer see them; every other date keeps
 * the series values. A class reprogrammed to another date does NOT carry the origin's override: the destination has
 * its own entry (Reprogramar writes it when the coach picks another time).
 * Never touches students, attendance, payments or combo dates.
 */

export const OVERRIDE_FIELDS = ["time", "timeEnd", "court"];

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isValidTime = (t) => typeof t === "string" && TIME.test(t);
const text = (v) => (v === undefined || v === null ? "" : String(v));

/** The active per-date fields ({time?, timeEnd?, court?}) of a class row or card for `date`, or null. */
export function activeOverrideOf(row, date) {
  const e = row && row.occurrenceOverrides && row.occurrenceOverrides[date];
  if (!e) return null;
  const out = {};
  for (const k of OVERRIDE_FIELDS) if (e[k] !== null && e[k] !== undefined) out[k] = e[k];
  return Object.keys(out).length ? out : null;
}

/** The series value of a field, also from a card that shows its own date's value (card.seriesValues). */
const seriesValue = (row, k) => (row && row.seriesValues ? row.seriesValues[k] : row && row[k]);

/** The effective end time of a class row/card on `date` (that date's override, else the series). */
export const effectiveTimeEnd = (row, date) => {
  const o = activeOverrideOf(row, date);
  return (o && o.timeEnd) || seriesValue(row, "timeEnd") || "23:59";
};

/**
 * The per-date values an edit asks for, relative to the series: a field equal to the series is null (series value).
 * -> { time, timeEnd, court } (each value or null); all null = restore the series values.
 */
export function overrideValuesFrom(series, edited) {
  const out = {};
  for (const k of OVERRIDE_FIELDS) {
    const v = edited && edited[k];
    const base = series && series[k];
    if (k === "timeEnd") out[k] = (v || "09:00") === (base || "09:00") ? null : v || null;
    else out[k] = text(v) === text(base) ? null : v === undefined ? null : v;
  }
  return out;
}

const sameValues = (a, b) => OVERRIDE_FIELDS.every((k) => (a ? a[k] ?? null : null) === (b ? b[k] ?? null : null));

/** Whether `values` would change what is stored for that date. */
export function overrideChanges(row, date, values) {
  const e = row && row.occurrenceOverrides && row.occurrenceOverrides[date];
  return !sameValues(e || { time: null, timeEnd: null, court: null }, values);
}

/** Whether `date` is a live date of the class row: an occurrence without its own entry, or a live reprogramming destination. */
function isLiveDate(row, date) {
  const dc = row.dateCancellations || {};
  if (Object.prototype.hasOwnProperty.call(dc, date)) return false;
  if ((row.occurrences || []).includes(date)) return true;
  return Object.values(dc).some((e) => e && e.cancelType === "cancelled_reprog" && e.rescheduledTo === date);
}

const OVERRIDE_TEXT = {
  "not-live": "Esta fecha está pausada, cancelada o reprogramada: su horario y cancha no se cambian.",
  "time-format": "Revisá el horario: usá el formato HH:MM.",
  "time-order": "La hora de inicio tiene que ser anterior a la hora de finalización.",
  "attendance-recorded": "Esta clase ya tiene asistencia registrada. Confirmá el cambio para guardarlo.",
  "unknown-class": "No se encontró la clase.",
};
export const overrideMessage = (reason) => OVERRIDE_TEXT[reason] || "No se pudo guardar el cambio de esta fecha.";

/**
 * Write-time check on the LATEST class row (nothing is written when refused). values: overrideValuesFrom(...).
 * A date with recorded attendance needs `confirmedAttendance` (explicit validation by the coach).
 */
export function overrideRefusal({ row, date, values, confirmedAttendance }) {
  if (!row) return "unknown-class";
  if (!isLiveDate(row, date)) return "not-live";
  const start = values.time || row.time;
  const end = values.timeEnd || row.timeEnd;
  if ((values.time && !isValidTime(values.time)) || (values.timeEnd && !isValidTime(values.timeEnd))) return "time-format";
  if (isValidTime(start) && isValidTime(end) && start >= end) return "time-order";
  if (!confirmedAttendance && (row.attendanceLog || []).some((e) => e && e.date === date)) return "attendance-recorded";
  return null;
}

/** The class row with the date's values applied; the change is appended to that date's history. Never mutates. */
export function applyOverrideToClassRow(row, { date, values, at }) {
  if (!overrideChanges(row, date, values)) return row;
  const all = { ...(row.occurrenceOverrides || {}) };
  const prev = all[date] || null;
  const v = { time: values.time ?? null, timeEnd: values.timeEnd ?? null, court: values.court ?? null };
  all[date] = { ...v, at, history: [...((prev && prev.history) || []), { ...v, at }] };
  return { ...row, occurrenceOverrides: all };
}

/**
 * "A Todas las Clases" from a card with its own time/court: a field the coach did not touch on that card keeps the
 * SERIES value (the per-date value never spreads to the series); a field the coach changed is applied.
 */
export function seriesEditFromCard({ series, card, edited }) {
  const own = card && card.occurrenceOverride ? activeOverrideOf(card, card.date) : null;
  if (!own || !series) return edited;
  const out = { ...edited };
  for (const k of OVERRIDE_FIELDS) if (k in own && text(edited[k]) === text(card[k])) out[k] = series[k];
  return out;
}

/** End time for a destination at `newTime`, keeping the series duration (null when the series has no end time). */
export function shiftedTimeEnd(series, newTime) {
  if (!isValidTime(newTime) || !series || !isValidTime(series.time) || !isValidTime(series.timeEnd)) return null;
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const end = toMin(newTime) + (toMin(series.timeEnd) - toMin(series.time));
  if (end >= 24 * 60 || end <= toMin(newTime)) return null;
  return String(Math.floor(end / 60)).padStart(2, "0") + ":" + String(end % 60).padStart(2, "0");
}

/**
 * Reprogramar to a destination at a chosen time: the destination's values (null when the time is the series one).
 * -> { time, timeEnd, court:null } | null
 */
export function reprogDestinationValues(series, newTime) {
  if (!series || !isValidTime(newTime) || newTime === series.time) return null;
  const timeEnd = shiftedTimeEnd(series, newTime);
  // a time whose class would end after midnight cannot keep the series duration: nothing is stored (no start > end)
  if (timeEnd === null && isValidTime(series.timeEnd)) return null;
  return { time: newTime, timeEnd: timeEnd === series.timeEnd ? null : timeEnd, court: null };
}

/**
 * Card fields for expandClasses: the date's active values plus `occurrenceOverride:true` and the series values the card
 * replaces (`seriesValues`), or nothing at all.
 */
export const overrideCardFields = (row, date) => {
  const o = activeOverrideOf(row, date);
  return o ? { ...o, occurrenceOverride: true, seriesValues: { time: row.time, timeEnd: row.timeEnd, court: row.court } } : {};
};

/**
 * Per-date flows (pause, cancel, reprogram, reactivate, resume) merge the edited CARD into the series row. A card that
 * shows its date's own time/court must never write them to the series: they are dropped (with the card marker), so
 * the series keeps its values. Without a per-date override this returns the same fields minus the marker.
 */
export function withoutCardOverride(fields, card) {
  const out = { ...fields };
  delete out.occurrenceOverride;
  delete out.seriesValues;
  if (card && card.occurrenceOverride) for (const k of OVERRIDE_FIELDS) delete out[k];
  return out;
}
