import { traceRescheduleHistory } from "./rescheduleChain.js";

/*
 * Fused reprogramming chains (BUG-AGENDA-03 damage) — detection, repair plan, and prevention.
 * Pure, no React; the caller passes the latest state and "today".
 *
 * dateCancellations is keyed by DATE. When a class is reprogrammed onto a date that already has its own
 * entry, the chain walk continues through it and two contractual classes end on ONE date. Real case
 * (Pato Ojeda, Mon/Wed): class 3 28/09 -> 19/10 -> 02/10 and class 7 12/10 -> 26/10 -> 19/10 -> 02/10:
 * both read "given on 02/10" (8/8 shown, 7 classes recorded) and the 26/10 stays blocked.
 *
 * Repair (one write, class row only — combos, payments and attendance are never touched):
 *   - the EARLIER original keeps the shared terminal and skips the shared step  (28/09 -> 02/10);
 *   - the LATER original ends on the shared step                                 (12/10 -> 19/10);
 *     its own intermediate steps from today on are freed (26/10), past ones stay as history;
 *   - every touched entry is snapshotted before/after in class.chainRepairs (audit).
 * Attendance is stored per date, so it stays exactly where it was; the plan only reports it.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isIsoDate = (d) => typeof d === "string" && ISO.test(d) && !isNaN(new Date(d + "T12:00:00").getTime());
const isClassCombo = (c) => !!c && Array.isArray(c.dates) && c.packType !== "mensual" && (c.total || 0) > 0;
const fail = (reason, extra) => ({ ok: false, reason, ...(extra || {}) });

/** Attendance of one student on one date, read only. */
export function attendanceStatusOf(attendanceLog, date, studentId) {
  const e = (attendanceLog || []).find((x) => x && x.date === date);
  if (!e) return "none";
  if ((e.present || []).includes(studentId)) return "present";
  if ((e.ausente_dada || []).includes(studentId)) return "ausente_dada";
  if ((e.ausente_reprog || []).includes(studentId)) return "ausente_reprog";
  return "unmarked";
}

/** Whether a combo belongs to the series: its own sourceClassId, or a legacy combo with no known other class. */
const belongsToSeries = (combo, series, knownSeriesIds) =>
  combo.sourceClassId === undefined || combo.sourceClassId === series.id || (knownSeriesIds && !knownSeriesIds.has(combo.sourceClassId));

/** Contract slots of a series: one per ORIGINAL date, with every holder (student, combo, class number). */
function seriesSlots(series, students, knownSeriesIds) {
  const dc = series.dateCancellations || {};
  const byOrigin = new Map();
  for (const sid of series.students || []) {
    const st = (students || []).find((s) => s.id === sid);
    if (!st) continue;
    (st.combos || []).forEach((combo, comboIndex) => {
      if (!isClassCombo(combo) || !belongsToSeries(combo, series, knownSeriesIds)) return;
      combo.dates.forEach((d0, i) => {
        if (!byOrigin.has(d0)) byOrigin.set(d0, { origin: d0, ...traceRescheduleHistory(dc, d0), holders: [] });
        byOrigin.get(d0).holders.push({ studentId: sid, comboIndex, comboId: combo.id, classNumber: i + 1 });
      });
    });
  }
  return [...byOrigin.values()];
}

/** Groups of DIFFERENT original dates whose chains end on the same date. */
export function findFusedGroups({ series, students, knownSeriesIds }) {
  if (!series || !Array.isArray(series.occurrences)) return [];
  const byTerminal = new Map();
  for (const slot of seriesSlots(series, students, knownSeriesIds)) {
    if (slot.broken) continue;
    const t = slot.path[slot.path.length - 1];
    if (!byTerminal.has(t)) byTerminal.set(t, []);
    byTerminal.get(t).push(slot);
  }
  return [...byTerminal.entries()].filter(([, s]) => s.length > 1).sort(([a], [b]) => a.localeCompare(b))
    .map(([terminal, slots]) => ({ terminal, slots: [...slots].sort((a, b) => a.origin.localeCompare(b.origin)) }));
}

const snapshot = (dc, keys) => Object.fromEntries(keys.map((k) => [k, dc[k] ? { ...dc[k] } : null]));

/**
 * Repair plan for the first fused group of a series. Nothing is written here.
 * ok -> { ok, seriesId, terminal, sharedStep, keep:{origin,holders,pathBefore,pathAfter},
 *         move:{...same}, freedDates, before, after, attendance:{sharedStep:[...], terminal:[...]} }
 */
export function planFusedRepair({ series, students, todayDate, knownSeriesIds }) {
  if (!series || !isIsoDate(todayDate)) return fail("not-applicable");
  const groups = findFusedGroups({ series, students, knownSeriesIds });
  if (groups.length === 0) return fail("none");
  const { terminal, slots } = groups[0];
  if (slots.length !== 2) return fail("complex", { terminal });
  const [A, B] = slots; // A: earlier original keeps the terminal; B: later original ends on the shared step
  const dc = series.dateCancellations || {};
  if (A.path.length < 2 || B.path.length < 2) return fail("same-day", { terminal });
  if (dc[terminal]) return fail("terminal-not-live", { terminal, blockDate: terminal });
  const iB = B.path.findIndex((d, i) => i > 0 && A.path.includes(d));
  const X = B.path[iB];
  const iA = A.path.indexOf(X);
  if (iB < 1 || X === terminal || iA < 1 || iA >= A.path.length - 1) return fail("same-day", { terminal });
  // Pauses and resumes count only where they can touch the repaired dates (both chains), and only in THIS class
  // and its students' combos of this class — never another class or another student's pause.
  const involved = new Set([...A.path, ...B.path]);
  const pausedAt = [...involved].sort().find((d) => dc[d] && dc[d].cancelType === "paused" && !dc[d].compensated);
  if (pausedAt) return fail("paused-date", { terminal, blockDate: pausedAt });
  const seriesSids = new Set(series.students || []);
  for (const st of (students || []).filter((x) => seriesSids.has(x.id))) {
    for (const combo of st.combos || []) {
      if (!isClassCombo(combo) || !belongsToSeries(combo, series, knownSeriesIds)) continue;
      for (const op of Array.isArray(combo.resumeOperations) ? combo.resumeOperations : []) {
        if (op && op.classId !== undefined && op.classId !== series.id) continue;
        const hit = [...(op.pausedDates || []), ...(op.replacementDates || [])].filter((d) => involved.has(d)).sort()[0];
        if (hit) return fail("resume-date", { terminal, blockDate: hit });
      }
    }
  }
  const predA = A.path[iA - 1], succA = A.path[iA + 1], predB = B.path[iB - 1];
  // Only the two chains reach the shared step.
  const incoming = Object.entries(dc).filter(([, e]) => e && e.cancelType === "cancelled_reprog" && e.rescheduledTo === X).map(([k]) => k).sort();
  if (JSON.stringify(incoming) !== JSON.stringify([predA, predB].sort())) return fail("shared", { terminal });
  const origins = new Set(seriesSlots(series, students, knownSeriesIds).map((s) => s.origin));
  const log = Array.isArray(series.attendanceLog) ? series.attendanceLog : [];
  // B's own steps before X: from today on they are freed when nothing else uses them; earlier ones stay.
  const steps = B.path.slice(1, iB);
  const freedDates = steps.filter((S) => S >= todayDate && !origins.has(S) && !log.some((e) => e && e.date === S) &&
    Object.entries(dc).filter(([, e]) => e && e.rescheduledTo === S).length === 1);
  // A pending planned resume could later place a replacement class on a date this repair frees: block it then.
  const planned = series.plannedResume && !series.plannedResume.completed ? series.plannedResume : null;
  if (planned && freedDates.some((d) => !planned.resumeDate || d >= planned.resumeDate)) return fail("planned-resume", { terminal, blockDate: planned.resumeDate || null });
  const keptB = [B.origin, ...steps.filter((S) => !freedDates.includes(S))];
  const lastKept = keptB[keptB.length - 1];

  const next = { ...dc };
  next[predA] = { ...dc[predA], rescheduledTo: succA };
  delete next[X];
  for (const S of freedDates) delete next[S];
  next[lastKept] = { ...dc[lastKept], rescheduledTo: X };

  const keepAfter = traceRescheduleHistory(next, A.origin);
  const moveAfter = traceRescheduleHistory(next, B.origin);
  const expectKeep = A.path.filter((d) => d !== X);
  const expectMove = [...keptB, X];
  if (keepAfter.broken || moveAfter.broken || JSON.stringify(keepAfter.path) !== JSON.stringify(expectKeep) || JSON.stringify(moveAfter.path) !== JSON.stringify(expectMove)) return fail("inconsistent", { terminal });
  // No other slot changes its path, and no two slots end on the same date afterwards.
  const nextSeries = { ...series, dateCancellations: next };
  for (const s of seriesSlots(series, students, knownSeriesIds)) {
    if (s.origin === A.origin || s.origin === B.origin) continue;
    if (JSON.stringify(traceRescheduleHistory(next, s.origin).path) !== JSON.stringify(s.path)) return fail("inconsistent", { terminal });
  }
  if (findFusedGroups({ series: nextSeries, students, knownSeriesIds }).some((g) => g.terminal === terminal || g.terminal === X)) return fail("inconsistent", { terminal });

  const touched = [...new Set([predA, X, ...freedDates, lastKept])].sort();
  const view = (slot, pathAfter) => ({ origin: slot.origin, holders: slot.holders, pathBefore: slot.path, pathAfter });
  return {
    ok: true, seriesId: series.id, terminal, sharedStep: X,
    keep: view(A, expectKeep), move: view(B, expectMove), freedDates,
    before: snapshot(dc, touched), after: snapshot(next, touched),
    attendance: {
      sharedStep: B.holders.map((h) => ({ studentId: h.studentId, status: attendanceStatusOf(log, X, h.studentId) })),
      terminal: A.holders.map((h) => ({ studentId: h.studentId, status: attendanceStatusOf(log, terminal, h.studentId) })),
    },
  };
}

/** Class row after the repair. Applies only while every touched entry still equals plan.before; idempotent. */
export function applyFusedRepairToClassRow(c, plan, { opId, at }) {
  const repairs = Array.isArray(c.chainRepairs) ? c.chainRepairs : [];
  if (repairs.some((r) => r && r.id === opId)) return c;
  const dc = c.dateCancellations || {};
  const keys = Object.keys(plan.before);
  if (JSON.stringify(snapshot(dc, keys)) !== JSON.stringify(plan.before)) return c;
  const next = { ...dc };
  for (const k of keys) { if (plan.after[k]) next[k] = { ...plan.after[k] }; else delete next[k]; }
  const record = {
    id: opId, kind: "split-fused", at, terminal: plan.terminal, sharedStep: plan.sharedStep,
    slots: [plan.keep, plan.move].map((s) => ({ origin: s.origin, classNumbers: s.holders.map((h) => h.classNumber), from: s.pathBefore, to: s.pathAfter })),
    freedDates: plan.freedDates, before: plan.before, after: plan.after, attendance: plan.attendance,
  };
  return { ...c, dateCancellations: next, chainRepairs: [...repairs, record] };
}

/**
 * Prevention: would reprogramming the card on `fromDate` to `destination` fuse two classes?
 * null = fine. Blocks only destinations that already carry another class or a reprogramming of this
 * series; free dates and grey occurrences beyond the package stay allowed.
 */
export function rescheduleDestinationConflict({ series, students, fromDate, destination, knownSeriesIds }) {
  if (!series || !isIsoDate(destination) || destination === fromDate) return null;
  const dc = series.dateCancellations || {};
  if (dc[destination]) return "destination-has-history";
  if (Object.entries(dc).some(([k, e]) => k !== fromDate && e && e.cancelType === "cancelled_reprog" && e.rescheduledTo === destination)) return "destination-taken";
  if ((series.attendanceLog || []).some((e) => e && e.date === destination)) return "destination-scheduled";
  // A student who holds the moved class AND already has a class of their own on the destination would end up with
  // two classes on one date. Other students' dates (group classes) never block it.
  const slots = seriesSlots(series, students, knownSeriesIds);
  const moved = new Set(slots.filter((s) => !s.broken && s.path.includes(fromDate)).flatMap((s) => s.holders.map((h) => h.studentId)));
  if (slots.some((s) => s.origin === destination && s.holders.some((h) => moved.has(h.studentId)))) return "destination-scheduled";
  return null;
}

const DATED = {
  "paused-date": (d) => `No se puede separar: hay una pausa activa el ${d} en estas clases. Reanudala primero.`,
  "resume-date": (d) => `No se puede separar: una reanudación de esta clase usa el ${d}.`,
  "planned-resume": (d) => `No se puede separar: la clase tiene una reanudación planificada desde el ${d}, que podría ocupar la fecha que se libera. Resolvé primero esa reanudación.`,
  "terminal-not-live": (d) => `No se puede separar: la clase del ${d} figura pausada o cancelada.`,
};
const MESSAGES = {
  "destination-has-history": "Esa fecha ya tiene una reprogramación o cancelación registrada en esta clase. Elegí otra fecha para no unir dos clases.",
  "destination-taken": "Otra clase ya fue reprogramada a esa fecha. Elegí otra fecha para no unir dos clases.",
  "destination-scheduled": "Esa fecha ya tiene una clase de este alumno en esta serie. Elegí otra fecha para no unir dos clases.",
  changed: "Las clases cambiaron mientras revisabas. Cerrá y volvé a abrir Detalles de Pagos.",
  "write-pending": "Hay cambios pendientes de sincronizar. Esperá unos segundos e intentá de nuevo.",
  "write-failed": "No se pudo guardar. Revisá la conexión e intentá de nuevo; no se cambió nada a medias.",
  complex: "Hay más de dos clases unidas en la misma fecha: no se pueden separar automáticamente.",
  "same-day": "Una de las clases ya estaba en esa fecha sin reprogramar: hay que elegirle otra fecha a mano.",
  paused: "No se puede separar mientras haya una pausa o reanudación en esta clase.",
  shared: "Otra reprogramación también usa esa fecha: no se puede separar automáticamente.",
};
/** dd/mm for the preview and the messages. */
export const shortDate = (d) => (isIsoDate(d) ? d.slice(8, 10) + "/" + d.slice(5, 7) : String(d));
/** Readable text for a refusal; `info.blockDate` (when present) names the exact date. */
export const fusedMessage = (reason, info) =>
  (DATED[reason] && info && info.blockDate ? DATED[reason](shortDate(info.blockDate)) : null) ||
  MESSAGES[reason] || "No se pudieron separar las clases. Revisá la clase e intentá de nuevo.";
