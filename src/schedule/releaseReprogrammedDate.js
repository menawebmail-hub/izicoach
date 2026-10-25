import { resolveComboDateStatus, traceRescheduleHistory } from "./rescheduleChain.js";

/*
 * BUG-COMBO-01 and the release of an ORIGINAL date whose class was reprogrammed and already given.
 * Pure, no React; the caller passes the latest state and "today".
 *
 * Example (Pato Ojeda): series Mon/Wed, combo of 8 ending Mon 26/10, the 26/10 class was
 * reprogrammed to Fri 02/10 and given there. dateCancellations is keyed by DATE, so
 * dateCancellations["2026-10-26"] is both the history of that class and the state of the day:
 * the 26th stays a green "Reprogramada" card and a new combo starting on the 26th would read
 * that entry as its own (counting the 02/10 class twice).
 *
 * Releasing turns that finished reprogramming into plain data, keeping every fact:
 *   - combo:  the slot keeps its POSITION in combo.dates (payments are assigned by position) and
 *             its date becomes the destination; slotRelocations records {from, to, classId}.
 *   - class:  dateCancellations[date] is removed only while it still says exactly that
 *             reprogramming; the destination joins occurrences (its card and attendance stay);
 *             releasedReschedules keeps the removed entry.
 * Write order (the caller): students first, then the class. A combo carrying the relocation
 * never reads the old entry again (the date is no longer in it), so a half-done release counts
 * nothing twice; releaseStateOf / findPendingReleaseCompletions finish the class part.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isIsoDate = (d) => {
  if (typeof d !== "string" || !ISO.test(d)) return false;
  const x = new Date(d + "T12:00:00");
  if (isNaN(x.getTime())) return false;
  const back = x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
  return back === d;
};
const isGivenEntry = (entry, studentId) =>
  !!entry && ((entry.present || []).includes(studentId) || (entry.ausente_dada || []).includes(studentId));
const isClassCombo = (c) => !!c && Array.isArray(c.dates) && c.packType !== "mensual" && c.packType !== "individual" && (c.total || 0) > 0;

/**
 * BUG-COMBO-01: classes of a combo given by EXPLICIT attendance (present / ausente-dada), each
 * slot read where it really happened: the terminal of its reschedule chain. A date with no chain
 * is its own terminal, so unchanged combos count exactly as before. Each terminal counts once.
 * A slot whose terminal is paused or still "A Reprogramar" was not given (same as Cobros), even if
 * a contradictory attendance record exists there.
 */
export function countAttendedSlots({ dates, dc, attendanceLog, studentId }) {
  const seen = new Set();
  for (const d0 of new Set(Array.isArray(dates) ? dates : [])) {
    const r = resolveComboDateStatus(dc || {}, d0);
    if (r.broken || !r.terminal || seen.has(r.terminal)) continue;
    const t = r.cancelInfo && r.cancelInfo.cancelType;
    if (t === "paused" || t === "cancelled_reprog") continue;
    const entry = (attendanceLog || []).find((e) => e && e.date === r.terminal);
    if (isGivenEntry(entry, studentId)) seen.add(r.terminal);
  }
  return seen.size;
}

const fail = (reason) => ({ ok: false, reason });

/**
 * Whether `date` (an original date of `series`) can be released. Every check is explicit; the
 * mere passing of time never proves a class was given.
 * ok -> { ok:true, seriesId, date, destination, entry, affected:[{studentId, comboIndex, comboId}] }
 */
export function resolveReleasableDate({ series, students, date, todayDate, knownSeriesIds }) {
  if (!series || !isIsoDate(date) || !isIsoDate(todayDate)) return fail("not-applicable");
  if (!Object.prototype.hasOwnProperty.call(series, "cancelledDates") || !Array.isArray(series.occurrences) || !series.occurrences.includes(date)) return fail("not-applicable");
  const dc = series.dateCancellations && typeof series.dateCancellations === "object" ? series.dateCancellations : null;
  const entry = dc && dc[date];
  if (!entry || entry.cancelType !== "cancelled_reprog" || !entry.rescheduledTo) return fail("not-applicable");
  const destination = entry.rescheduledTo;
  if (!isIsoDate(destination) || destination === date) return fail("chain");
  // One direct hop to a live destination; nothing else arrived at either date.
  const trace = traceRescheduleHistory(dc, date);
  if (trace.broken || trace.path.length !== 2 || dc[destination]) return fail("chain");
  if (Object.entries(dc).some(([k, e]) => k !== date && e && (e.rescheduledTo === date || e.rescheduledTo === destination))) return fail("shared");
  if (date < todayDate) return fail("past");
  const log = Array.isArray(series.attendanceLog) ? series.attendanceLog : [];
  if (log.some((e) => e && e.date === date)) return fail("attendance-on-date");
  // Pauses anywhere in the series block it, like "Volver a fecha original".
  if (Object.values(dc).some((e) => e && e.cancelType === "paused" && !e.compensated)) return fail("paused");
  if (series.plannedResume && !series.plannedResume.completed) return fail("paused");

  const affected = [];
  for (const sid of series.students || []) {
    const st = (students || []).find((s) => s.id === sid);
    if (!st) continue;
    const holders = [];
    (st.combos || []).forEach((combo, comboIndex) => {
      if (!isClassCombo(combo) || !combo.dates.includes(date)) return;
      if (combo.sourceClassId !== undefined && combo.sourceClassId !== series.id && (!knownSeriesIds || knownSeriesIds.has(combo.sourceClassId))) return;
      holders.push({ combo, comboIndex });
    });
    if (holders.length === 0) continue;
    if (holders.length > 1) return fail("ambiguous");
    const { combo, comboIndex } = holders[0];
    if (combo.dates.includes(destination)) return fail("fused");
    if (!isGivenEntry(log.find((e) => e && e.date === destination), sid)) return fail("not-attended");
    for (const op of Array.isArray(combo.resumeOperations) ? combo.resumeOperations : []) {
      const touched = [...(op.pausedDates || []), ...(op.replacementDates || [])];
      if (touched.includes(date) || touched.includes(destination)) return fail("paused");
    }
    // Every other slot already sits before the released date and is settled.
    for (const d0 of combo.dates) {
      if (d0 === date) continue;
      const r = resolveComboDateStatus(dc, d0);
      if (r.broken || !r.terminal) return fail("chain");
      const info = r.cancelInfo;
      if (info && info.cancelType === "cancelled_reprog") return fail("combo-open");
      if (info && info.cancelType === "paused" && !info.compensated) return fail("paused");
      if (r.terminal >= date) return fail("combo-open");
    }
    affected.push({ studentId: sid, comboIndex, comboId: combo.id });
  }
  if (affected.length === 0) return fail("no-combo");
  return { ok: true, seriesId: series.id, date, destination, entry: { ...entry }, affected };
}

/** Combo after the release: same slot position, new date; idempotent by operation id. */
export function applyReleaseToCombo(combo, { opId, date, destination, classId, at, usedAfter }) {
  const relocations = Array.isArray(combo.slotRelocations) ? combo.slotRelocations : [];
  if (relocations.some((r) => r && r.id === opId)) return combo;
  if (!Array.isArray(combo.dates) || !combo.dates.includes(date)) return combo;
  return {
    ...combo,
    dates: combo.dates.map((d) => (d === date ? destination : d)),
    used: Math.max(Number(combo.used || 0), Number(usedAfter || 0)),
    slotRelocations: [...relocations, { id: opId, from: date, to: destination, classId, at }],
  };
}

const sameReprog = (e, destination) => !!e && e.cancelType === "cancelled_reprog" && e.rescheduledTo === destination;

/** Class row after the release; idempotent. Never removes an entry that no longer says date -> destination. */
export function applyReleaseToClassRow(c, { opId, date, destination, entry, at }) {
  const dc = { ...(c.dateCancellations || {}) };
  const occ = Array.isArray(c.occurrences) ? c.occurrences : [];
  const records = Array.isArray(c.releasedReschedules) ? c.releasedReschedules : [];
  const removeEntry = sameReprog(dc[date], destination);
  const addOccurrence = !occ.includes(destination);
  const addRecord = !records.some((r) => r && r.id === opId);
  if (!removeEntry && !addOccurrence && !addRecord) return c;
  if (dc[date] && !removeEntry) return c; // the date changed meanwhile: touch nothing
  if (removeEntry) delete dc[date];
  let next;
  if (Object.keys(dc).length > 0) next = { ...c, dateCancellations: dc };
  else { const { dateCancellations: _removed, ...rest } = c; next = rest; }
  next.occurrences = addOccurrence ? [...new Set([...occ, destination])].sort() : occ;
  next.releasedReschedules = addRecord ? [...records, { id: opId, date, destination, entry: entry || null, at }] : records;
  if (Object.prototype.hasOwnProperty.call(c, "rescheduled")) next.rescheduled = Object.values(dc).some((e) => e && e.cancelType === "cancelled_reprog" && !!e.rescheduledTo);
  return next;
}

/** The relocation records of `seriesId` for an original `date`, across every student. */
function relocationsFor(students, seriesId, date) {
  const out = [];
  for (const st of students || []) {
    for (const combo of st.combos || []) {
      for (const r of Array.isArray(combo.slotRelocations) ? combo.slotRelocations : []) {
        if (r && r.classId === seriesId && r.from === date) out.push({ ...r, studentId: st.id });
      }
    }
  }
  return out;
}

/**
 * State of a release of (series, date):
 *   { state:null }                          nothing relocated
 *   { state:"class-pending", record }       students done, the class part still to apply
 *   { state:"released", record }            both parts applied
 *   { state:"inconsistent", record }        the date holds something else now: never touched
 */
export function releaseStateOf({ series, students, date }) {
  if (!series) return { state: null };
  const recs = relocationsFor(students, series.id, date);
  if (recs.length === 0) return { state: null };
  const destination = recs[0].to;
  if (recs.some((r) => r.to !== destination)) return { state: "inconsistent", record: recs[0] };
  const e = (series.dateCancellations || {})[date];
  const occ = Array.isArray(series.occurrences) ? series.occurrences : [];
  const record = { opId: recs[0].id, date, destination, entry: sameReprog(e, destination) ? { ...e } : null, at: recs[0].at };
  if (e && !sameReprog(e, destination)) return { state: "inconsistent", record };
  if (e || !occ.includes(destination)) return { state: "class-pending", record };
  return { state: "released", record };
}

/** Every release whose class part is still pending (recovery after a partial write). */
export function findPendingReleaseCompletions(classes, students) {
  const out = [];
  const seen = new Set();
  for (const st of students || []) {
    for (const combo of st.combos || []) {
      for (const r of Array.isArray(combo.slotRelocations) ? combo.slotRelocations : []) {
        const key = r && r.classId + "|" + r.from;
        if (!r || seen.has(key)) continue;
        seen.add(key);
        const series = (classes || []).find((c) => c.id === r.classId);
        const st2 = releaseStateOf({ series, students, date: r.from });
        if (st2.state === "class-pending") out.push({ seriesId: r.classId, ...st2.record });
      }
    }
  }
  return out;
}

const RELEASE_MESSAGES = {
  "write-pending": "Hay cambios pendientes de sincronizar. Esperá unos segundos e intentá de nuevo.",
  "not-attended": "No se puede renovar desde esta fecha: falta registrar la asistencia de la clase en su nueva fecha.",
  "payment-shift": "No se puede renovar desde esta fecha sin cambiar qué clases figuran como pagadas.",
  "combo-open": "No se puede renovar desde esta fecha: el combo anterior todavía tiene clases pendientes.",
  paused: "No se puede renovar desde esta fecha mientras haya una pausa o reanudación en esta clase.",
  "start-mismatch": "No se pudo calcular el combo nuevo desde esta fecha con el calendario de la clase.",
  "write-failed": "No se pudo guardar el cambio. Revisá la conexión e intentá de nuevo; lo que ya se guardó se completa solo.",
  inconsistent: "Esta fecha cambió mientras se renovaba. Cerrá y volvé a abrir la Agenda.",
};
export const releaseMessage = (reason) =>
  RELEASE_MESSAGES[reason] || "No se pudo renovar desde esta fecha. Revisá la clase e intentá de nuevo.";
