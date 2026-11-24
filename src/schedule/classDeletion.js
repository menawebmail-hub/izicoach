// Safe class deletion (Eliminar clase) — the write plan and the per-combo readings (pure, no React).
// The only write is the class row: deleted dates get a marker in dateCancellations (see deletedDates.js) and the row
// keeps a `deletion` cut plus a `deletions` history. Students, combos, payments, attendance and expenses are never
// touched; every economic effect is derived when reading, by the shared slot reader.
import { DELETED, isDeletedEntry, normalizeDeletedDates } from "./deletedDates.js";
import { createSlotReader, isClassDone } from "./slotStatus.js";
import { effectiveTimeEnd } from "./occurrenceOverrides.js";

/** Classes a pending "clase a favor" keeps after its class was deleted (internal; nothing shows it). */
export const DELETED_CREDIT_DAYS = 60;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const addDays = (date, n) => {
  const d = new Date(date + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};

/**
 * Deletes every date of the series ("all") or every date from `fromDate` on ("future"), including reprogramming
 * destinations. A date whose class had already ended (or that has attendance recorded) is `held`: it is only hidden,
 * its reading never changes. Idempotent: a date already deleted keeps its first marker.
 * Returns { status: "deleted", series, dates } | { status: "nothing", series } | { status: "refused", reason }.
 */
export function planClassDeletion({ series, scope, fromDate, at, op }) {
  if (!series) return { status: "refused", reason: "not-found" };
  if (scope !== "all" && scope !== "future") return { status: "refused", reason: "scope" };
  if (scope === "future" && !(typeof fromDate === "string" && ISO_DATE.test(fromDate))) return { status: "refused", reason: "date" };
  const cut = scope === "all" ? "" : fromDate;
  const raw = series.dateCancellations || {};
  const candidates = new Set([...(series.occurrences || []), ...(series.occurrences ? [] : [series.date].filter(Boolean))]);
  for (const e of Object.values(raw)) if (e && e.cancelType === "cancelled_reprog" && e.rescheduledTo) candidates.add(e.rescheduledTo);
  const loggedDates = new Set((series.attendanceLog || []).filter(Boolean).map((e) => e.date));
  const dc = { ...raw };
  const dates = [];
  for (const d of [...candidates].sort()) {
    if (typeof d !== "string" || d < cut || isDeletedEntry(dc[d])) continue;
    const held = loggedDates.has(d) || isClassDone(d, effectiveTimeEnd(series, d));
    dc[d] = { cancelType: DELETED, at, op: op || null, scope, held, prev: raw[d] || null };
    dates.push(d);
  }
  const prevCut = series.deletion && typeof series.deletion.from === "string" ? series.deletion.from : null;
  const nextCut = prevCut === null ? cut : (cut < prevCut ? cut : prevCut);
  if (dates.length === 0 && nextCut === prevCut) return { status: "nothing", series };
  const next = {
    ...series,
    dateCancellations: dc,
    deletion: { from: nextCut, at, op: op || null, scope: nextCut === "" ? "all" : "future" },
    deletions: [...(Array.isArray(series.deletions) ? series.deletions : []), { op: op || null, scope, from: cut, at, dates }],
  };
  return { status: "deleted", series: next, dates };
}

/**
 * One combo's deleted slots (read by the shared reader) and the internal expiry of its paid ones: 60 days after the
 * last class it actually gave (a definitive cancellation is not a given class), or after the deletion when it gave
 * none. Expired = those slots stop counting as remaining and the combo can close; nothing else changes.
 */
export function comboDeletionState({ reader, combo, todayDate }) {
  const dates = [...new Set((combo && combo.dates) || [])];
  const deleted = new Set();
  let lastGiven = null;
  let firstDeletedAt = null;
  for (const d of dates) {
    const s = reader.status(d);
    if (s.isDeleted) {
      deleted.add(d);
      const at = (s.cancelInfo && s.cancelInfo.deletedAt) || null;
      const day = typeof at === "string" ? at.slice(0, 10) : null;
      if (day && (!firstDeletedAt || day < firstDeletedAt)) firstDeletedAt = day;
      continue;
    }
    if (s.isCancelled) continue;
    if (reader.isGiven(d)) {
      const f = s.terminalDate || d;
      if (!lastGiven || f > lastGiven) lastGiven = f;
    }
  }
  if (deleted.size === 0) return { deleted, expired: false, expiresOn: null };
  const anchor = lastGiven || firstDeletedAt || todayDate;
  const expiresOn = addDays(anchor, DELETED_CREDIT_DAYS);
  return { deleted, expired: todayDate >= expiresOn, expiresOn };
}

/** comboDeletionState for one student's combo over expanded cards (the same reading Cobros uses). */
export function comboDeletionOf({ cards, combo, studentId, todayDate }) {
  const mine = (cards || []).filter((c) => (c.students || []).includes(studentId));
  const reader = createSlotReader({ classes: mine, combo, studentId, allClasses: cards });
  return comboDeletionState({ reader, combo, todayDate });
}

/**
 * True when the class of this combo was deleted and nothing of it is still to happen: every slot is given, cancelled,
 * a compensated pause, or deleted (at least one). A student who comes back then starts a new combo from scratch.
 */
export function comboEndedByDeletion({ cards, combo, studentId }) {
  if (!combo || combo.packType === "mensual") return false;
  const mine = (cards || []).filter((c) => (c.students || []).includes(studentId));
  const reader = createSlotReader({ classes: mine, combo, studentId, allClasses: cards });
  let anyDeleted = false;
  for (const d of new Set(combo.dates || [])) {
    const s = reader.status(d);
    if (s.isDeleted) { anyDeleted = true; continue; }
    if (s.isCancelled || (s.isPaused && s.isCompensated)) continue;
    if (reader.isGiven(d)) continue;
    return false;
  }
  return anyDeleted;
}

/** Whether a raw series row has any deleted date (cheap guard before the readings above). */
export const seriesHasDeletedDates = (series) => Object.values((series && series.dateCancellations) || {}).some(isDeletedEntry);

export { normalizeDeletedDates };
