// Safe class deletion (Eliminar clase): dates removed from the schedule, read with the existing semantics (pure, no
// imports, so every reader can depend on it). A deleted date is a marker in the series' dateCancellations:
//   dateCancellations[date] = { cancelType: "deleted", at, op, scope: "all" | "future", held, prev }
// held = the class of that date had already ended when it was deleted; prev = the entry the date had before (pause,
// cancellation, reprogramming) or null. Nothing else is ever removed: combos, payments, attendance and expenses stay.
//
// normalizeDeletedDates() is applied before any reading, so the existing logic sees:
//   - a held date: exactly its previous entry (its attendance, pause or cancellation reading is unchanged);
//   - a date not held whose previous entry already decided its slot (definitive cancellation, or a reprogramming with a
//     destination): that entry, unchanged;
//   - any other date not held: a pending reprogramming without date ("A Reprogramar") flagged `deleted` — never given
//     by time, billed by position like any pending slot (an unpaid one is then excluded from debt by the counters).

export const DELETED = "deleted";

export const isDeletedEntry = (e) => !!(e && e.cancelType === DELETED);

const memo = new WeakMap();

/** dateCancellations as every existing reader understands it (memoized per object; the input is never mutated). */
export function normalizeDeletedDates(dateCancellations) {
  const dc = dateCancellations || {};
  if (typeof dc !== "object") return {};
  if (memo.has(dc)) return memo.get(dc);
  let out = dc;
  for (const date of Object.keys(dc)) {
    const e = dc[date];
    if (!isDeletedEntry(e)) continue;
    if (out === dc) out = { ...dc };
    const prev = e.prev && typeof e.prev === "object" ? e.prev : null;
    if (e.held) {
      if (prev) out[date] = prev;
      else delete out[date];
    } else if (prev && (prev.cancelType === "cancelled" || (prev.cancelType === "cancelled_reprog" && prev.rescheduledTo))) {
      out[date] = prev;
    } else {
      out[date] = { cancelType: "cancelled_reprog", rescheduledTo: null, deleted: true, deletedAt: e.at || null };
    }
  }
  memo.set(dc, out);
  return out;
}

/** The first date from which every date added to the series is deleted too ("" = all), or null when never deleted. */
export function deletionCutOf(series) {
  const d = series && series.deletion;
  if (!d || typeof d !== "object") return null;
  return typeof d.from === "string" ? d.from : null;
}

/**
 * Dates a pause or a resume adds to an already deleted series are deleted as well (never shown, never given by time):
 * returns a new dateCancellations with a deleted, not held marker on each added date at or after the cut.
 */
export function markAddedDatesDeleted(series, dateCancellations, dates) {
  const cut = deletionCutOf(series);
  if (cut === null) return dateCancellations;
  const dc = { ...(dateCancellations || {}) };
  const at = (series.deletion && series.deletion.at) || null;
  for (const d of dates || []) {
    if (typeof d !== "string" || d < cut || isDeletedEntry(dc[d])) continue;
    dc[d] = { cancelType: DELETED, at, op: series.deletion.op || null, scope: series.deletion.scope || "future", held: false, prev: dc[d] || null };
  }
  return dc;
}
