import { test, mock } from "node:test";
import assert from "node:assert/strict";

// Pato Ojeda (reported 2026-10-25): series Mon/Wed, combo of 8 ending Mon 26/10, the 26/10 class
// reprogrammed to Fri 02/10 and given there. Runs on the REAL App.jsx functions with "today" fixed.
mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-25T12:00:00").getTime() });
const { loadAppFunctions } = await import("../test/loadAppFunctions.js");
const A = await loadAppFunctions([
  "TODAY_DATE", "isClassDone", "interpretContractDate", "resolveContractSlotStatus", "resolveSlotPayments",
  "resolveSlotGiven", "buildSlotHistoryRows", "buildPersonSlotRows", "getSlotFulfillmentDate", "isComboClosed",
  "isNextComboPending", "CLASS_DAY_MAP", "CLASS_DAY_ALIASES", "normalizeValidClassDays", "classDowSetFrom",
  "isoOfDate", "collectSlotPathDates", "collectComboOccupiedDates", "isValidIsoDate", "getComboEffectiveEnd",
  "getComboDcCandidates", "buildRenewalDates", "expandClasses", "slotReadingsOf", "sameSlotReadings",
  "planRelease", "buildRenewalAfterRelease", "resolveReleaseCandidate", "findReleaseCandidateForStudent",
]);
const R = await import("./releaseReprogrammedDate.js");

const TODAY = "2026-10-25", D26 = "2026-10-26", D28 = "2026-10-28", D02 = "2026-10-02", SID = 100;
const DAYS = ["Lun", "Mié"];
const OCC = (() => { const s = A.classDowSetFrom(DAYS), o = [], c = new Date("2026-09-28T12:00:00"); while (A.isoOfDate(c) <= "2027-01-31") { if (s.has(c.getDay())) o.push(A.isoOfDate(c)); c.setDate(c.getDate() + 1); } return o; })();
const OLD = ["2026-09-30", "2026-10-05", "2026-10-07", "2026-10-12", "2026-10-14", "2026-10-19", "2026-10-21", D26];
const att = (dates, sids) => dates.map((d) => ({ date: d, day: "x", present: sids, ausente_dada: [], ausente_reprog: [] }));

function fixture({ paidCount = 8, sids = [1], extraDc = {}, log } = {}) {
  const series = {
    id: SID, title: "Tenis", days: DAYS, time: "18:00", timeEnd: "19:00", students: sids, occurrences: OCC,
    cancelledDates: [], rescheduledDates: [],
    dateCancellations: { [D26]: { cancelType: "cancelled_reprog", rescheduledTo: D02 }, ...extraDc },
    attendanceLog: log || att([...OLD.filter((d) => d < TODAY && d !== D26), D02], sids),
  };
  const students = sids.map((id) => ({ id, name: "Alumno " + id, combos: [{
    id: 1, total: 8, packType: "combo", sourceClassId: SID, dates: [...OLD], paid: paidCount >= 8, paidCount, used: 7,
    amount: 400000, payments: paidCount ? [{ id: 5, qty: paidCount, amount: 50000 * paidCount, dates: OLD.slice(0, paidCount) }] : [],
  }] }));
  return { classes: [series], students };
}
const cardsOn = (classes, students, d) => A.expandClasses(classes).filter((c) => c.date === d).map((c) => ({
  green: !!(c.cancelled && c.cancelType === "cancelled_reprog" && c.rescheduledTo), live: !c.cancelled && !c.paused,
  grey: A.isNextComboPending(c, students), attendance: (c.attendanceLog || []).map((e) => e.present),
}));
const comboSummary = (classes, st, idx) => {
  const rows = A.buildPersonSlotRows({ ...st, combos: [st.combos[idx]] }, A.expandClasses(classes), TODAY);
  return { realizadas: rows.filter((r) => r.isGiven).length, pagadas: rows.filter((r) => r.isPaid).length, total: st.combos[idx].total };
};
const OP = { opId: "op-1", at: "2026-10-25T12:00:00.000Z" };
function releaseAndRenew(f) {
  const plan = A.planRelease({ ...f, seriesId: SID, date: D26, todayDate: TODAY, ...OP });
  assert.equal(plan.ok, true, JSON.stringify(plan));
  let students = plan.nextStudents;
  for (const id of plan.release.affected.map((a) => a.studentId)) {
    const r = A.buildRenewalAfterRelease({ classes: plan.nextClasses, students, studentId: id, seriesId: SID, date: D26, todayDate: TODAY });
    assert.equal(r.ok, true, JSON.stringify(r));
    students = students.map((s) => (s.id === id ? { ...s, combos: [...s.combos, r.combo] } : s));
  }
  return { plan, classes: plan.nextClasses, students };
}

test("today (before): 26/10 is a green Reprogramada card, 28/10 is grey; Cobros reads 8/8 but `used` stays 7", () => {
  const f = fixture();
  assert.deepEqual(cardsOn(f.classes, f.students, D26), [{ green: true, live: false, grey: false, attendance: [] }]);
  assert.equal(cardsOn(f.classes, f.students, D28)[0].grey, true);
  assert.deepEqual(comboSummary(f.classes, f.students[0], 0), { realizadas: 8, pagadas: 8, total: 8 });
  // The old recount (attendance looked up ON combo.dates) never sees the 02/10 class.
  const series = f.classes[0];
  const oldRule = OLD.filter((d) => series.attendanceLog.some((e) => e.date === d && e.present.includes(1))).length;
  assert.equal(oldRule, 7);
  // BUG-COMBO-01: counted where it happened.
  assert.equal(R.countAttendedSlots({ dates: OLD, dc: series.dateCancellations, attendanceLog: series.attendanceLog, studentId: 1 }), 8);
});

test("the 26th is offered as releasable (Agenda and Cobros read the same candidate)", () => {
  const f = fixture();
  const cand = A.resolveReleaseCandidate({ ...f, seriesId: SID, date: D26, todayDate: TODAY });
  assert.deepEqual(cand, { ok: true, kind: "releasable", seriesId: SID, date: D26, destination: D02, studentIds: [1] });
  assert.deepEqual(A.findReleaseCandidateForStudent({ ...f, studentId: 1, todayDate: TODAY }), cand);
});

test("the release keeps every fact: slot position, attendance, payments, history", () => {
  const f = fixture();
  const { plan } = { plan: A.planRelease({ ...f, seriesId: SID, date: D26, todayDate: TODAY, ...OP }) };
  assert.equal(plan.ok, true);
  const old = plan.nextStudents[0].combos[0];
  assert.deepEqual(old.dates, [...OLD.slice(0, 7), D02]); // same position, new date
  assert.equal(old.used, 8);
  assert.deepEqual(old.slotRelocations, [{ id: "op-1", from: D26, to: D02, classId: SID, at: OP.at }]);
  for (const k of ["total", "paidCount", "paid", "amount", "payments"]) assert.deepEqual(old[k], f.students[0].combos[0][k], k);
  const series = plan.nextClasses[0];
  assert.equal(series.dateCancellations, undefined);
  assert.ok(series.occurrences.includes(D02) && series.occurrences.includes(D26));
  assert.deepEqual(series.attendanceLog, f.classes[0].attendanceLog); // attendance untouched
  assert.deepEqual(series.releasedReschedules, [{ id: "op-1", date: D26, destination: D02, entry: { cancelType: "cancelled_reprog", rescheduledTo: D02 }, at: OP.at }]);
  // The 02/10 card is still there with its attendance; no class is fused or lost.
  assert.deepEqual(cardsOn(plan.nextClasses, plan.nextStudents, D02), [{ green: false, live: true, grey: false, attendance: [[1]] }]);
  // Before the 26th the live classes are exactly the same dates (the 02/10 one included).
  const liveBefore26 = (cls) => A.expandClasses(cls).filter((c) => !c.cancelled && !c.paused && c.date < D26).map((c) => c.date).sort();
  assert.deepEqual(liveBefore26(plan.nextClasses), liveBefore26(f.classes));
});

test("Pato after the release: 26/10 grey, 28/10 grey; after renewing: new combo 0/8 from the 26th, old combo 8/8", () => {
  const f = fixture();
  const plan = A.planRelease({ ...f, seriesId: SID, date: D26, todayDate: TODAY, ...OP });
  assert.deepEqual(cardsOn(plan.nextClasses, plan.nextStudents, D26), [{ green: false, live: true, grey: true, attendance: [] }]);
  assert.equal(cardsOn(plan.nextClasses, plan.nextStudents, D28)[0].grey, true);
  const { classes, students } = releaseAndRenew(f);
  const nw = students[0].combos[1];
  assert.deepEqual(nw.dates.slice(0, 3), [D26, D28, "2026-11-02"]);
  assert.equal(nw.sourceClassId, SID);
  assert.deepEqual(comboSummary(classes, students[0], 1), { realizadas: 0, pagadas: 0, total: 8 });
  assert.deepEqual(comboSummary(classes, students[0], 0), { realizadas: 8, pagadas: 8, total: 8 });
  assert.equal(A.isComboClosed(students[0].combos[0], A.expandClasses(classes), 1), true);
  // The 26th is now the new combo's first class, not grey any more; nothing else counts twice.
  assert.deepEqual(cardsOn(classes, students, D26), [{ green: false, live: true, grey: false, attendance: [] }]);
  // A second renewal is refused.
  assert.equal(A.buildRenewalAfterRelease({ classes, students, studentId: 1, seriesId: SID, date: D26, todayDate: TODAY }).reason, "already-renewed");
});

test("payment states never change: fully paid, partly paid and unpaid combos read the same slot by slot", () => {
  for (const paidCount of [8, 5, 3, 0]) {
    const f = fixture({ paidCount });
    const plan = A.planRelease({ ...f, seriesId: SID, date: D26, todayDate: TODAY, ...OP });
    assert.equal(plan.ok, true, "paidCount " + paidCount);
    const before = A.slotReadingsOf(f.students[0], f.classes, TODAY);
    const after = A.slotReadingsOf(plan.nextStudents[0], plan.nextClasses, TODAY);
    assert.ok(A.sameSlotReadings(before, after, D26, D02), "paidCount " + paidCount);
    // The released slot keeps ITS payment state on its destination (position-based, never re-sorted).
    assert.equal(after.find((r) => r.date === D02).isPaid, before.find((r) => r.date === D26).isPaid);
  }
  // Re-sorting the dates would move payments: this is exactly what the guard rejects.
  const f = fixture({ paidCount: 5 });
  const sorted = { ...f.students[0], combos: [{ ...f.students[0].combos[0], dates: [...OLD.slice(0, 7), D02].sort() }] };
  const plan = A.planRelease({ ...f, seriesId: SID, date: D26, todayDate: TODAY, ...OP });
  assert.equal(A.sameSlotReadings(A.slotReadingsOf(f.students[0], f.classes, TODAY), A.slotReadingsOf(sorted, plan.nextClasses, TODAY), D26, D02), false);
});

test("two students in the class, with different payments: both relocated, nothing changes for either", () => {
  const f = fixture({ sids: [1, 2] });
  f.students[1].combos[0] = { ...f.students[1].combos[0], paidCount: 3, paid: false };
  const { classes, students } = releaseAndRenew(f);
  for (const i of [0, 1]) {
    assert.deepEqual(comboSummary(classes, students[i], 1), { realizadas: 0, pagadas: 0, total: 8 });
    assert.equal(comboSummary(classes, students[i], 0).realizadas, 8);
    assert.equal(comboSummary(classes, students[i], 0).pagadas, i === 0 ? 8 : 3);
  }
});

test("partial write (students saved, class not yet): nothing counts twice, and the recovery completes idempotently", () => {
  const f = fixture();
  const plan = A.planRelease({ ...f, seriesId: SID, date: D26, todayDate: TODAY, ...OP });
  const half = { classes: f.classes, students: plan.nextStudents };
  assert.deepEqual(comboSummary(half.classes, half.students[0], 0), { realizadas: 8, pagadas: 8, total: 8 });
  assert.equal(R.releaseStateOf({ series: half.classes[0], students: half.students, date: D26 }).state, "class-pending");
  const pending = R.findPendingReleaseCompletions(half.classes, half.students);
  assert.deepEqual(pending.map((p) => [p.seriesId, p.date, p.destination, p.opId]), [[SID, D26, D02, "op-1"]]);
  // The candidate now reads "class-pending": the orchestrator finishes the class part before renewing.
  assert.equal(A.resolveReleaseCandidate({ ...half, seriesId: SID, date: D26, todayDate: TODAY }).kind, "class-pending");
  const done = R.applyReleaseToClassRow(half.classes[0], pending[0]);
  assert.deepEqual(done, plan.nextClasses[0]);
  assert.equal(R.applyReleaseToClassRow(done, pending[0]), done); // second run: no change
  assert.equal(R.releaseStateOf({ series: done, students: half.students, date: D26 }).state, "released");
  assert.deepEqual(R.findPendingReleaseCompletions([done], half.students), []);
  // Re-applying the students part is a no-op too.
  const again = R.applyReleaseToCombo(plan.nextStudents[0].combos[0], { opId: "op-1", date: D26, destination: D02, classId: SID, at: OP.at, usedAfter: 8 });
  assert.equal(again, plan.nextStudents[0].combos[0]);
});

test("the passing of time is never proof: no attendance on the destination blocks the release", () => {
  const log = att(OLD.filter((d) => d < TODAY && d !== D26), [1]); // 02/10 is past but has no record
  const f = fixture({ log });
  assert.equal(A.resolveReleaseCandidate({ ...f, seriesId: SID, date: D26, todayDate: TODAY }).reason, "not-attended");
  const absent = fixture({ log: [...log, { date: D02, day: "x", present: [], ausente_dada: [], ausente_reprog: [1] }] });
  assert.equal(A.resolveReleaseCandidate({ ...absent, seriesId: SID, date: D26, todayDate: TODAY }).reason, "not-attended");
});

test("every unsafe shape is refused, nothing is planned", () => {
  const cand = (f, date = D26, todayDate = TODAY) => A.resolveReleaseCandidate({ ...f, seriesId: SID, date, todayDate }).reason;
  // Destination already one of the combo's dates (two classes on one day).
  const fused = fixture(); fused.students[0].combos[0].dates = [...OLD.slice(0, 6), D02, D26];
  assert.equal(cand(fused), "fused");
  // Another class also reprogrammed to the destination.
  assert.equal(cand(fixture({ extraDc: { "2026-10-21": { cancelType: "cancelled_reprog", rescheduledTo: D02 } } })), "shared");
  // Multi-step chain.
  assert.equal(cand(fixture({ extraDc: { [D02]: { cancelType: "cancelled_reprog", rescheduledTo: "2026-10-03" } } })), "chain");
  // Active pause in the series.
  // An active pause on a date the renewed combo would use is a real conflict (02/11 is its 3rd date).
  assert.equal(cand(fixture({ extraDc: { "2026-11-02": { cancelType: "paused", rescheduledTo: null } } })), "renewal-date-busy");
  // Attendance already recorded on the 26th.
  const logged = fixture(); logged.classes[0].attendanceLog = [...logged.classes[0].attendanceLog, { date: D26, present: [1], ausente_dada: [], ausente_reprog: [] }];
  assert.equal(cand(logged), "attendance-on-date");
  // The 26th already passed.
  assert.equal(cand(fixture(), D26, "2026-10-27"), "past");
  // Another slot of the combo is still pending a reprogramming.
  assert.equal(cand(fixture({ extraDc: { "2026-10-21": { cancelType: "cancelled_reprog", rescheduledTo: null } } })), "combo-open");
  // Two combos hold the date.
  const twice = fixture(); twice.students[0].combos.push({ ...twice.students[0].combos[0], id: 2 });
  assert.equal(cand(twice), "ambiguous");
  // A later combo of the series already exists (renewed from the 28th the old way).
  const later = fixture(); later.students[0].combos.push({ id: 2, total: 8, packType: "combo", sourceClassId: SID, dates: [D28, "2026-11-02"], paid: false, paidCount: 0, used: 0, amount: 1, payments: [] });
  assert.equal(cand(later), "already-renewed");
  // A normal reprogramming to a future date is not a release.
  const forward = fixture(); forward.classes[0].dateCancellations = { [D26]: { cancelType: "cancelled_reprog", rescheduledTo: "2026-11-06" } };
  assert.equal(cand(forward), "not-attended");
});

test("precise pause rules for the release: unrelated pauses pass; a planned resume that could take the 26th blocks, with its date", () => {
  const cand = (f) => A.resolveReleaseCandidate({ ...f, seriesId: SID, date: D26, todayDate: TODAY });
  // Far-away active pause and a historical compensated one: allowed.
  assert.equal(cand(fixture({ extraDc: { "2027-01-11": { cancelType: "paused", rescheduledTo: null } } })).ok, true);
  assert.equal(cand(fixture({ extraDc: { "2026-09-28": { cancelType: "paused", rescheduledTo: null, compensated: true } } })).ok, true);
  // Planned resume from 20/10: it could place a replacement on the freed 26th.
  const early = fixture(); early.classes[0].plannedResume = { id: "p", classId: SID, resumeDate: "2026-10-20", completed: false };
  const r = cand(early);
  assert.deepEqual([r.ok, r.reason, r.blockDate], [false, "planned-resume", "2026-10-20"]);
  assert.match(R.releaseMessage(r.reason, r), /20\/10/);
  const late = fixture(); late.classes[0].plannedResume = { id: "p", classId: SID, resumeDate: "2026-12-31", completed: false };
  assert.equal(cand(late).ok, true);
  // The renewal date conflict names the date.
  const busy = cand(fixture({ extraDc: { "2026-11-02": { cancelType: "paused", rescheduledTo: null } } }));
  assert.equal(busy.blockDate, "2026-11-02");
  assert.match(R.releaseMessage(busy.reason, busy), /02\/11/);
});
