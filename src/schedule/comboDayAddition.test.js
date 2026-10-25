import { test, mock } from "node:test";
import assert from "node:assert/strict";

// "Agregar día al combo" on the REAL App.jsx functions with "today" fixed to 25/10/2026 (fictitious data).
mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-25T12:00:00").getTime() });
const { loadAppFunctions } = await import("../test/loadAppFunctions.js");
const A = await loadAppFunctions([
  "TODAY_DATE", "isClassDone", "interpretContractDate", "resolveContractSlotStatus", "resolveSlotPayments",
  "resolveSlotGiven", "buildSlotHistoryRows", "buildPersonSlotRows", "getSlotFulfillmentDate", "isComboClosed",
  "isNextComboPending", "CLASS_DAY_MAP", "CLASS_DAY_ALIASES", "normalizeValidClassDays", "classDowSetFrom",
  "isoOfDate", "collectSlotPathDates", "collectComboOccupiedDates", "isValidIsoDate", "getComboEffectiveEnd",
  "getComboDcCandidates", "buildRenewalDates", "expandClasses", "slotReadingsOf", "sameSlotReadings", "planComboDayAddition",
]);
const M = await import("./comboDayAddition.js");

const TODAY = "2026-10-25", SID = 300, THU = "2026-10-29";
const MONDAYS = ["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30", "2026-12-07", "2026-12-14"];
const OCC = (() => { const s = A.classDowSetFrom(["Lun"]), o = [], c = new Date("2026-10-26T12:00:00"); while (A.isoOfDate(c) <= "2027-04-26") { if (s.has(c.getDay())) o.push(A.isoOfDate(c)); c.setDate(c.getDate() + 1); } return o; })();
const combo = (paidCount, extra = {}) => ({ id: 1, total: 8, packType: "combo", sourceClassId: SID, dates: [...MONDAYS], paid: paidCount >= 8, paidCount, used: 0, amount: 400000, payments: paidCount ? [{ id: 9, qty: paidCount, amount: 50000 * paidCount, dates: MONDAYS.slice(0, paidCount) }] : [], ...extra });
function fixture({ paid = [0], dc = {}, log = [], plannedResume, mensual = false } = {}) {
  const sids = paid.map((_, i) => i + 1);
  const students = paid.map((p, i) => ({ id: i + 1, name: "Alumno " + (i + 1), combos: [combo(p)] }));
  if (mensual) { students.push({ id: 99, name: "Mensual", combos: [{ id: 1, total: null, packType: "mensual", sourceClassId: SID, cobroDia: 5, mensualidades: [] }] }); sids.push(99); }
  const series = { id: SID, title: "Clase Ficticia", days: ["Lun"], time: "18:00", timeEnd: "19:00", students: sids, occurrences: OCC, cancelledDates: [], rescheduledDates: [], dateCancellations: dc, attendanceLog: log, ...(plannedResume ? { plannedResume } : {}) };
  return { classes: [series], students };
}
const plan = (f, date = THU) => A.planComboDayAddition({ ...f, seriesId: SID, date, todayDate: TODAY });
function applyAll(f, p, opId = "add-1") {
  const students = M.applyAdditionToStudents(f.students, p, { opId, at: "t" });
  const row = M.applyAdditionToClassRow(f.classes[0], { opId, date: p.date, studentIds: p.affected.map((a) => a.studentId), at: "t" });
  return { classes: [row], students };
}
const paidDates = (f, i = 0) => A.buildPersonSlotRows(f.students[i], A.expandClasses(f.classes), TODAY).filter((r) => r.isPaid).map((r) => r.date);
const card = (f, d) => A.expandClasses(f.classes).filter((c) => c.date === d).map((c) => ({ live: !c.cancelled && !c.paused, grey: A.isNextComboPending(c, f.students) }));

test("unpaid combo: Thursday 29/10 is added, the last Monday 14/12 leaves; total, price and payments unchanged", () => {
  const f = fixture({ paid: [0] });
  const p = plan(f);
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.deepEqual([p.addOccurrence, p.affected.map((a) => [a.studentId, a.removed, a.total])], [true, [[1, "2026-12-14", 8]]]);
  const done = applyAll(f, p);
  const c = done.students[0].combos[0];
  assert.deepEqual(c.dates, ["2026-10-26", THU, "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30", "2026-12-07"]);
  for (const k of ["total", "amount", "paidCount", "paid", "payments", "used"]) assert.deepEqual(c[k], f.students[0].combos[0][k], k);
  assert.deepEqual(c.dateAdditions, [{ id: "add-1", date: THU, removed: "2026-12-14", classId: SID, at: "t" }]);
  assert.ok(done.classes[0].occurrences.includes(THU));
  assert.deepEqual(done.classes[0].addedDates, [{ id: "add-1", date: THU, studentIds: [1], at: "t" }]);
  // Agenda: the new Thursday is a class of the combo; 14/12 goes back to grey "Sin pagar".
  assert.deepEqual(card(done, THU), [{ live: true, grey: false }]);
  assert.deepEqual(card(done, "2026-12-14"), [{ live: true, grey: true }]);
  // Renewal now starts right after the new end (07/12).
  const mine = A.expandClasses(done.classes);
  assert.equal(A.buildRenewalDates({ combo: c, dcCandidates: A.getComboDcCandidates(mine, c), dowSet: A.classDowSetFrom(["Lun"]), fallbackDate: TODAY }).dates[0], "2026-12-14");
});

test("fully paid combo: allowed; every remaining class stays paid and the new date takes the replaced date's 'Pagada'", () => {
  const f = fixture({ paid: [8] });
  const done = applyAll(f, plan(f));
  assert.equal(paidDates(done).length, 8);
  assert.ok(paidDates(done).includes(THU));
  assert.ok(!paidDates(done).includes("2026-12-14"));
});

test("partly paid combo: a date before a paid class is refused (it would move 'Pagada'); after the last paid class it is allowed", () => {
  const f = fixture({ paid: [4] }); // paid: 26/10, 02/11, 09/11, 16/11
  const r = plan(f, THU);
  assert.deepEqual([r.ok, r.reason, r.blockDate], [false, "payment-shift", "2026-11-16"]);
  assert.match(M.additionMessage(r.reason, r), /16\/11/);
  const later = plan(f, "2026-11-19");
  assert.equal(later.ok, true, JSON.stringify(later));
  const done = applyAll(f, later);
  assert.deepEqual(paidDates(done), paidDates(f)); // exactly the same paid dates
});

test("group class: every combo student gets the date and drops their own last date, in one plan; a mensual student refuses all", () => {
  const f = fixture({ paid: [8, 3] });
  const p = plan(f, "2026-11-26"); // a Thursday after student 2's third paid class
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.deepEqual(p.affected.map((a) => [a.studentId, a.removed]), [[1, "2026-12-14"], [2, "2026-12-14"]]);
  const done = applyAll(f, p);
  for (const i of [0, 1]) {
    assert.ok(done.students[i].combos[0].dates.includes("2026-11-26"));
    assert.deepEqual(paidDates(done, i).filter((d) => d !== "2026-11-26").sort(), paidDates(f, i).filter((d) => d !== "2026-12-14").sort());
  }
  // One student's payments would move: nobody is changed.
  assert.equal(plan(f, THU).reason, "payment-shift");
  assert.equal(plan(fixture({ paid: [0], mensual: true })).reason, "mixed-class");
});

test("refused dates: past, already in the combo, with an entry or arriving reprogramming, with attendance, after the end", () => {
  const f = fixture({ paid: [0] });
  assert.equal(plan(f, "2026-10-22").reason, "past");
  assert.equal(plan(f, "2026-11-02").reason, "already-in-combo");
  assert.equal(plan(fixture({ dc: { [THU]: { cancelType: "cancelled", rescheduledTo: null } } })).reason, "date-busy");
  assert.equal(plan(fixture({ dc: { "2026-11-02": { cancelType: "cancelled_reprog", rescheduledTo: THU } } })).reason, "date-busy");
  assert.equal(plan(fixture({ log: [{ date: THU, present: [1], ausente_dada: [], ausente_reprog: [] }] })).reason, "attendance-on-date");
  assert.equal(plan(f, "2026-12-17").reason, "no-removable");
  assert.equal(plan(f, "not-a-date").reason, "invalid-date");
});

test("refused states: active pause in the combo, planned resume, resume dates; the removed date skips committed dates", () => {
  assert.deepEqual((({ reason, blockDate }) => [reason, blockDate])(plan(fixture({ dc: { "2026-11-23": { cancelType: "paused", rescheduledTo: null } } }))), ["paused", "2026-11-23"]);
  assert.equal(plan(fixture({ plannedResume: { id: "p", resumeDate: "2026-11-30", completed: false } })).reason, "planned-resume");
  // The last Monday is reprogrammed: it is never removed; the previous clean one goes.
  const reprog = plan(fixture({ dc: { "2026-12-14": { cancelType: "cancelled_reprog", rescheduledTo: "2026-12-18" } } }));
  assert.equal(reprog.affected[0].removed, "2026-12-07");
  // A resume replacement date is never removed either.
  const f = fixture({ paid: [0] });
  f.students[0].combos[0] = { ...f.students[0].combos[0], resumeOperations: [{ id: "r", classId: SID, resumeDate: "2026-12-14", pausedDates: [], replacementDates: ["2026-12-14"] }] };
  assert.equal(plan(f).affected[0].removed, "2026-12-07");
  assert.equal(plan(f, "2026-12-14").reason, "already-in-combo");
});

test("idempotent, re-validated and recoverable: a half-written addition counts nothing twice and is completed once", () => {
  const f = fixture({ paid: [8] });
  const p = plan(f);
  const students = M.applyAdditionToStudents(f.students, p, { opId: "add-1", at: "t" });
  // Same operation again: no change.
  assert.equal(M.applyAdditionToCombo(students[0].combos[0], { opId: "add-1", date: THU, removed: "2026-12-14", classId: SID, at: "t" }), students[0].combos[0]);
  // Half-written: students saved, class not. Readings already equal the final ones.
  const half = { classes: f.classes, students };
  assert.ok(A.sameSlotReadings(A.slotReadingsOf(f.students[0], f.classes, TODAY), A.slotReadingsOf(students[0], f.classes, TODAY), "2026-12-14", THU));
  const pending = M.findPendingAdditionCompletions(half.classes, half.students);
  assert.deepEqual(pending.map((x) => [x.seriesId, x.opId, x.date, x.studentIds]), [[SID, "add-1", THU, [1]]]);
  const row = M.applyAdditionToClassRow(half.classes[0], pending[0]);
  assert.equal(M.applyAdditionToClassRow(row, pending[0]), row);
  assert.deepEqual(M.findPendingAdditionCompletions([row], students), []);
  // A second plan for the same date is refused (no duplicate).
  assert.equal(A.planComboDayAddition({ classes: [row], students, seriesId: SID, date: THU, todayDate: TODAY }).reason, "already-in-combo");
});

test("the Agenda action shows only for a class with a current combo", () => {
  const f = fixture({ paid: [0] });
  assert.equal(M.hasCurrentComboForDayAddition({ series: f.classes[0], students: f.students, todayDate: TODAY }), true);
  const old = fixture({ paid: [0] });
  old.students[0].combos[0] = { ...old.students[0].combos[0], dates: ["2026-09-07", "2026-09-14"] };
  assert.equal(M.hasCurrentComboForDayAddition({ series: old.classes[0], students: old.students, todayDate: TODAY }), false);
});
