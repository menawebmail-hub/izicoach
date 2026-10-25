import { test, mock } from "node:test";
import assert from "node:assert/strict";

// FICTITIOUS data shaped exactly like the reported case (Mon/Wed series, combo of 8, three reprogrammings,
// two of them fused on 02/10). Runs on the REAL App.jsx functions with "today" fixed to 25/10/2026.
mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-25T12:00:00").getTime() });
const { loadAppFunctions } = await import("../test/loadAppFunctions.js");
const A = await loadAppFunctions([
  "TODAY_DATE", "isClassDone", "interpretContractDate", "resolveContractSlotStatus", "resolveSlotPayments",
  "resolveSlotGiven", "buildSlotHistoryRows", "buildPersonSlotRows", "getSlotFulfillmentDate", "isComboClosed",
  "isNextComboPending", "CLASS_DAY_MAP", "CLASS_DAY_ALIASES", "normalizeValidClassDays", "classDowSetFrom",
  "isoOfDate", "collectSlotPathDates", "collectComboOccupiedDates", "isValidIsoDate", "getComboEffectiveEnd",
  "getComboDcCandidates", "buildRenewalDates", "expandClasses", "slotReadingsOf", "planFusedRepairChecked",
]);
const F = await import("./fusedChains.js");
const { countAttendedSlots } = await import("./releaseReprogrammedDate.js");

const TODAY = "2026-10-25", SID = 700, STU = 7;
const DAYS = ["Lun", "Mié"];
const OCC = (() => { const s = A.classDowSetFrom(DAYS), o = [], c = new Date("2026-09-21T12:00:00"); while (A.isoOfDate(c) <= "2027-01-31") { if (s.has(c.getDay())) o.push(A.isoOfDate(c)); c.setDate(c.getDate() + 1); } return o; })();
const DATES = ["2026-09-21", "2026-09-23", "2026-09-28", "2026-09-30", "2026-10-05", "2026-10-07", "2026-10-12", "2026-10-14"];
const R = (to) => ({ cancelType: "cancelled_reprog", rescheduledTo: to });
const P = (date, extra = {}) => ({ date, day: "x", present: [STU], ausente_dada: [], ausente_reprog: [], ...extra });
const DC = {
  "2026-09-28": R("2026-10-19"), "2026-10-19": R("2026-10-02"),   // class 3
  "2026-10-05": R("2026-10-21"),                                   // class 5
  "2026-10-12": R("2026-10-26"), "2026-10-26": R("2026-10-19"),   // class 7 (fused into class 3's chain)
};
const LOG = ["2026-09-21", "2026-09-23", "2026-09-30", "2026-10-07", "2026-10-14", "2026-10-02", "2026-10-21"].map((d) => P(d));

function fixture({ dc = DC, log = LOG, paidCount = 8, extraStudents = [] } = {}) {
  const series = { id: SID, title: "Alumno Ficticio", days: DAYS, time: "08:00", timeEnd: "09:00", students: [STU, ...extraStudents.map((s) => s.id)],
    occurrences: OCC, cancelledDates: [], rescheduledDates: [], dateCancellations: JSON.parse(JSON.stringify(dc)), attendanceLog: JSON.parse(JSON.stringify(log)) };
  const combo = { id: 1, total: 8, packType: "combo", sourceClassId: SID, dates: [...DATES], paid: paidCount >= 8, paidCount, used: 7, amount: 400000, payments: [{ id: 3, qty: paidCount, amount: 400000, dates: DATES.slice(0, paidCount) }] };
  return { classes: [series], students: [{ id: STU, name: "Alumno Ficticio", combos: [combo] }, ...extraStudents] };
}
const plan = (f) => A.planFusedRepairChecked({ ...f, seriesId: SID, todayDate: TODAY });
const apply = (f, p, opId = "rep-1") => {
  const row = F.applyFusedRepairToClassRow(f.classes[0], p, { opId, at: "2026-10-25T12:00:00.000Z" });
  return { classes: [row], students: f.students };
};
const pathOf = (f, origin) => A.buildPersonSlotRows(f.students[0], A.expandClasses(f.classes), TODAY).find((r) => r.date === origin).reschedulePath;
const card = (f, d) => A.expandClasses(f.classes).filter((c) => c.date === d).map((c) => ({ live: !c.cancelled && !c.paused, grey: A.isNextComboPending(c, f.students) }));

test("detection: exactly one fused group — classes 3 and 7 both end on 02/10; class 5 is not involved", () => {
  const f = fixture();
  const groups = F.findFusedGroups({ series: f.classes[0], students: f.students });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].terminal, "2026-10-02");
  assert.deepEqual(groups[0].slots.map((s) => [s.origin, s.holders[0].classNumber, s.path]), [
    ["2026-09-28", 3, ["2026-09-28", "2026-10-19", "2026-10-02"]],
    ["2026-10-12", 7, ["2026-10-12", "2026-10-26", "2026-10-19", "2026-10-02"]],
  ]);
});

test("plan reproduces the expected chains: class 3 28/09 -> 02/10, class 7 12/10 -> 19/10, class 5 unchanged; 26/10 freed", () => {
  const f = fixture();
  const p = plan(f);
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.equal(p.sharedStep, "2026-10-19");
  assert.deepEqual([p.keep.holders[0].classNumber, p.keep.pathAfter], [3, ["2026-09-28", "2026-10-02"]]);
  assert.deepEqual([p.move.holders[0].classNumber, p.move.pathAfter], [7, ["2026-10-12", "2026-10-19"]]);
  assert.deepEqual(p.freedDates, ["2026-10-26"]);
  assert.deepEqual(p.before, { "2026-09-28": R("2026-10-19"), "2026-10-12": R("2026-10-26"), "2026-10-19": R("2026-10-02"), "2026-10-26": R("2026-10-19") });
  assert.deepEqual(p.after, { "2026-09-28": R("2026-10-02"), "2026-10-12": R("2026-10-19"), "2026-10-19": null, "2026-10-26": null });
  const done = apply(f, p);
  assert.deepEqual(pathOf(done, "2026-09-28"), ["2026-09-28", "2026-10-02"]);
  assert.deepEqual(pathOf(done, "2026-10-12"), ["2026-10-12", "2026-10-19"]);
  assert.deepEqual(pathOf(done, "2026-10-05"), ["2026-10-05", "2026-10-21"]);
  assert.deepEqual(done.classes[0].dateCancellations, { "2026-09-28": R("2026-10-02"), "2026-10-05": R("2026-10-21"), "2026-10-12": R("2026-10-19") });
});

test("payments, amounts, combo dates and attendance are untouched; the audit record keeps before/after", () => {
  const f = fixture({ paidCount: 5 });
  const p = plan(f);
  const done = apply(f, p);
  assert.equal(done.students, f.students); // no students write at all
  assert.deepEqual(done.classes[0].attendanceLog, f.classes[0].attendanceLog);
  const before = A.slotReadingsOf(f.students[0], f.classes, TODAY);
  const after = A.slotReadingsOf(done.students[0], done.classes, TODAY);
  for (const k of ["isPaid", "displayPaid", "isDisplaced", "isPaused", "isCancelledClass"]) assert.deepEqual(after.map((r) => [r.date, r[k]]), before.map((r) => [r.date, r[k]]), k);
  const rec = done.classes[0].chainRepairs[0];
  assert.equal(rec.kind, "split-fused");
  assert.deepEqual(rec.before, p.before);
  assert.deepEqual(rec.after, p.after);
  assert.deepEqual(rec.slots.map((s) => [s.classNumbers, s.from, s.to]), [
    [[3], ["2026-09-28", "2026-10-19", "2026-10-02"], ["2026-09-28", "2026-10-02"]],
    [[7], ["2026-10-12", "2026-10-26", "2026-10-19", "2026-10-02"], ["2026-10-12", "2026-10-19"]],
  ]);
});

test("19/10 attendance is reported, never assumed: without a record the combo is NOT 8/8 by attendance", () => {
  const f = fixture();
  const p = plan(f);
  assert.deepEqual(p.attendance.sharedStep, [{ studentId: STU, status: "none" }]);
  assert.deepEqual(p.attendance.terminal, [{ studentId: STU, status: "present" }]);
  assert.deepEqual(p.evidence, [{ studentId: STU, attendedBefore: 7, attendedAfter: 7, total: 8 }]);
  const done = apply(f, p);
  assert.equal(countAttendedSlots({ dates: DATES, dc: done.classes[0].dateCancellations, attendanceLog: done.classes[0].attendanceLog, studentId: STU }), 7);
  // With the 19/10 attendance registered afterwards, 8 by explicit evidence.
  const withAtt = fixture({ log: [...LOG, P("2026-10-19")] });
  const p2 = plan(withAtt);
  assert.deepEqual(p2.attendance.sharedStep, [{ studentId: STU, status: "present" }]);
  assert.deepEqual(p2.evidence, [{ studentId: STU, attendedBefore: 7, attendedAfter: 8, total: 8 }]);
});

test("Agenda after the repair: 19/10 and 02/10 are live classes, 26/10 grey, 28/10 grey; renewal starts on 26/10", () => {
  const f = fixture();
  assert.deepEqual(card(f, "2026-10-26"), [{ live: false, grey: false }]); // today: green Reprogramada
  const done = apply(f, plan(f));
  assert.deepEqual(card(done, "2026-10-19"), [{ live: true, grey: false }]);
  assert.deepEqual(card(done, "2026-10-02"), [{ live: true, grey: false }]);
  assert.deepEqual(card(done, "2026-10-26"), [{ live: true, grey: true }]);
  assert.deepEqual(card(done, "2026-10-28"), [{ live: true, grey: true }]);
  const combo = done.students[0].combos[0];
  const mine = A.expandClasses(done.classes);
  const ren = A.buildRenewalDates({ combo, dcCandidates: A.getComboDcCandidates(mine, combo), dowSet: A.classDowSetFrom(DAYS), fallbackDate: TODAY });
  assert.deepEqual(ren.dates.slice(0, 3), ["2026-10-26", "2026-10-28", "2026-11-02"]);
  // No two classes on one date any more.
  assert.deepEqual(F.findFusedGroups({ series: done.classes[0], students: done.students }), []);
});

test("idempotent and re-validated: same operation twice changes nothing; a changed entry blocks the write", () => {
  const f = fixture();
  const p = plan(f);
  const once = apply(f, p);
  assert.equal(F.applyFusedRepairToClassRow(once.classes[0], p, { opId: "rep-1", at: "x" }), once.classes[0]);
  assert.equal(F.applyFusedRepairToClassRow(once.classes[0], p, { opId: "rep-2", at: "x" }), once.classes[0]); // before no longer matches
  assert.equal(plan(once).reason, "none");
  const changed = fixture();
  changed.classes[0].dateCancellations["2026-10-26"] = R("2026-10-28");
  assert.equal(F.applyFusedRepairToClassRow(changed.classes[0], p, { opId: "rep-3", at: "x" }), changed.classes[0]);
});

test("refusals: three classes on one date, a class already living on the date, pauses, other references", () => {
  const three = fixture({ dc: { ...DC, "2026-10-14": R("2026-10-27"), "2026-10-27": R("2026-10-19") } });
  assert.equal(plan(three).reason, "complex");
  const sameDay = fixture({ dc: { "2026-10-12": R("2026-10-07") } }); // moved onto class 6's own date
  assert.equal(plan(sameDay).reason, "same-day");
  // A pause on the shared terminal itself is a real conflict (the class there is not a live one).
  const pausedTerminal = fixture({ dc: { ...DC, "2026-10-02": { cancelType: "paused", rescheduledTo: null } } });
  const pt = plan(pausedTerminal);
  assert.ok(pt.ok === false, JSON.stringify(pt));
  assert.equal(plan(fixture({ dc: { "2026-10-05": R("2026-10-21") } })).reason, "none");
});

test("prevention: the move that caused it (26/10 -> 19/10) is blocked; free dates and grey dates stay allowed", () => {
  const before = { ...DC };
  delete before["2026-10-26"];
  const f = fixture({ dc: before });
  const series = f.classes[0];
  const conflict = (fromDate, destination) => F.rescheduleDestinationConflict({ series, students: f.students, fromDate, destination });
  assert.equal(conflict("2026-10-26", "2026-10-19"), "destination-has-history");
  assert.equal(conflict("2026-10-26", "2026-10-21"), "destination-taken"); // class 5 already moved there
  assert.equal(conflict("2026-10-26", "2026-10-14"), "destination-scheduled"); // class 8's own date
  assert.equal(conflict("2026-10-26", "2026-10-02"), "destination-taken"); // class 3 already ends there
  series.attendanceLog = [...series.attendanceLog, P("2026-10-16")];
  assert.equal(conflict("2026-10-26", "2026-10-16"), "destination-scheduled"); // a class was given there (attendance)
  assert.equal(conflict("2026-10-26", "2026-10-30"), null); // a free Friday
  assert.equal(conflict("2026-10-26", "2026-11-02"), null); // grey Monday after the package
  assert.equal(conflict("2026-10-26", "2026-10-26"), null);
});

test("prevention in a group class: another student's own date does not block; the moved student's does", () => {
  const before = { ...DC };
  delete before["2026-10-26"];
  const other = { id: 8, name: "Otro Ficticio", combos: [{ id: 1, total: 2, packType: "combo", sourceClassId: SID, dates: ["2026-10-30", "2026-11-04"], paid: false, paidCount: 0, used: 0, amount: 1, payments: [] }] };
  const f = fixture({ dc: before, extraStudents: [other] });
  const conflict = (fromDate, destination) => F.rescheduleDestinationConflict({ series: f.classes[0], students: f.students, fromDate, destination });
  assert.equal(conflict("2026-10-26", "2026-10-30"), null); // only the other student has a class that day
  assert.equal(conflict("2026-10-26", "2026-10-14"), "destination-scheduled"); // the moved student's own class 8
});

// Pauses and resumes count only where they touch the repaired dates, and only in THIS class and its students.
const OTHER_CLASS = { id: 900, title: "Otra clase", days: ["Vie"], students: [9], occurrences: ["2026-10-02", "2026-10-09"], cancelledDates: [], rescheduledDates: [], dateCancellations: {}, attendanceLog: [] };
const planWith = (f) => A.planFusedRepairChecked({ ...f, seriesId: SID, todayDate: TODAY });
const withResume = (f, studentIdx, op) => { f.students[studentIdx].combos[0] = { ...f.students[studentIdx].combos[0], resumeOperations: [op] }; return f; };

test("pauses: an unrelated active pause or a historical (compensated) one no longer blocks the separation", () => {
  const unrelated = fixture({ dc: { ...DC, "2026-11-09": { cancelType: "paused", rescheduledTo: null } } });
  assert.equal(planWith(unrelated).ok, true, JSON.stringify(planWith(unrelated)));
  const historical = fixture({ dc: { ...DC, "2026-09-14": { cancelType: "paused", rescheduledTo: null, compensated: true } } });
  assert.equal(planWith(historical).ok, true);
  // The result is still exactly the expected repair.
  const p = planWith(unrelated);
  assert.deepEqual([p.keep.pathAfter, p.move.pathAfter, p.freedDates], [["2026-09-28", "2026-10-02"], ["2026-10-12", "2026-10-19"], ["2026-10-26"]]);
});

test("resumes: another student's resume in another class is ignored; one of this class on an involved date blocks, with its date", () => {
  const otherStudent = { id: 9, name: "Otro Ficticio", combos: [{ id: 1, total: 4, packType: "combo", sourceClassId: 900, dates: ["2026-10-02", "2026-10-09", "2026-10-19"], paid: false, paidCount: 0, used: 0, amount: 1, payments: [],
    resumeOperations: [{ id: "op-x", classId: 900, resumeDate: "2026-10-16", pausedDates: ["2026-10-09"], replacementDates: ["2026-10-19"] }] }] };
  const f = fixture();
  const all = { classes: [...f.classes, OTHER_CLASS], students: [...f.students, otherStudent] };
  assert.equal(A.planFusedRepairChecked({ ...all, seriesId: SID, todayDate: TODAY }).ok, true);
  const mine = withResume(fixture(), 0, { id: "op-1", classId: SID, resumeDate: "2026-10-01", pausedDates: ["2026-09-30"], replacementDates: ["2026-10-02"] });
  const r = planWith(mine);
  assert.deepEqual([r.ok, r.reason, r.blockDate], [false, "resume-date", "2026-10-02"]);
  assert.match(F.fusedMessage(r.reason, r), /02\/10/);
  // A resume of this class on dates that are not involved does not block.
  const far = withResume(fixture(), 0, { id: "op-2", classId: SID, resumeDate: "2026-09-25", pausedDates: ["2026-09-23"], replacementDates: ["2026-09-25"] });
  assert.equal(planWith(far).ok, true);
});

test("planned resume: blocks only if it could take the freed 26/10, and says from which date", () => {
  const early = fixture();
  early.classes[0].plannedResume = { id: "pr", classId: SID, resumeDate: "2026-10-20", completed: false };
  const r = planWith(early);
  assert.deepEqual([r.ok, r.reason, r.blockDate], [false, "planned-resume", "2026-10-20"]);
  assert.match(F.fusedMessage(r.reason, r), /20\/10/);
  const late = fixture();
  late.classes[0].plannedResume = { id: "pr", classId: SID, resumeDate: "2026-11-30", completed: false };
  assert.equal(planWith(late).ok, true);
  const done = fixture();
  done.classes[0].plannedResume = { id: "pr", classId: SID, resumeDate: "2026-10-20", completed: true };
  assert.equal(planWith(done).ok, true);
});
