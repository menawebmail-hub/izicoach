import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// BUG-AGENDA-05 stage 2.1 — advance absence notices. Synthetic data only. "Today" = Thu 15/10/2026 12:00.
mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-15T12:00:00").getTime() });
const N = await import("./absenceNotices.js");
const R = await import("./attendanceRead.js");
const S = await import("./slotStatus.js");
const { countUsedForCombo } = await import("./slotMoves.js");
const { loadAppFunctions } = await import("../test/loadAppFunctions.js");
const A = await loadAppFunctions([
  "TODAY_DATE", "isClassDone", "interpretContractDate", "resolveSlotPayments", "buildSlotHistoryRows", "buildPersonSlotRows",
  "getSlotFulfillmentDate", "isComboClosed", "getClassEntitlements", "getCountedClassEntitlements", "getAccountCounters",
  "getEffectiveTotal", "getClaseRem", "expandClasses", "getAttendanceChipStatus",
]);

const J = "juan", P = "pedro";
const EIGHT = ["2026-10-05", "2026-10-07", "2026-10-12", "2026-10-14", "2026-10-19", "2026-10-21", "2026-10-26", "2026-10-28"];
const OCC = [...EIGHT, "2026-11-02", "2026-11-04"];
const entry = (date, present = [], ausente_dada = [], ausente_reprog = []) => ({ date, day: "x", present, ausente_dada, ausente_reprog });
const notice = (status, at = "2026-10-06T10:00:00Z") => ({ status, at, history: [{ status, at }] });
const group = (log, notices = {}, extra = {}) => ({ id: 10, title: "Grupo", days: ["Lun", "Mié"], time: "18:00", timeEnd: "19:00", students: [J, P], startDate: EIGHT[0], date: EIGHT[0],
  occurrences: OCC, cancelledDates: [], rescheduledDates: [], dateCancellations: {}, attendanceLog: log, attendanceNotices: notices, ...extra });
const combo = (extra = {}) => ({ id: 1, total: 8, packType: "combo", sourceClassId: 10, used: 0, paid: false, paidCount: 0, amount: 0, payments: [], dates: [...EIGHT], ...extra });
const people = (juan = {}, pedro = {}) => [{ id: J, name: "Juan", combos: [combo(juan)] }, { id: P, name: "Pedro", combos: [combo(pedro)] }];
const counters = (classes, students, sid) => A.getAccountCounters(students.find((s) => s.id === sid), A.expandClasses(classes));
const rowOf = (classes, students, sid, date) => {
  const x = A.expandClasses(classes);
  return A.buildPersonSlotRows(students.find((s) => s.id === sid), x.filter((c) => c.students.includes(sid)), A.TODAY_DATE, x).find((r) => r.date === date);
};

test("Juan gives notice (Ausente – No dada) for the 2nd date and Pedro attends: after four dates Juan 3/5, Pedro 4/4", () => {
  const n = { "2026-10-07": { [J]: notice("ausente_reprog") } };
  const st = people();
  // (a) attendance taken afterwards from the prefilled screen: Pedro Presente, Juan Ausente – No dada
  const a = [group([entry("2026-10-05", [J, P]), entry("2026-10-07", [P], [], [J]), entry("2026-10-12", [J, P]), entry("2026-10-14", [J, P])], n)];
  // (b) attendance never taken on the 7th: Pedro by time, Juan by his notice
  const b = [group([entry("2026-10-05", [J, P]), entry("2026-10-12", [J, P]), entry("2026-10-14", [J, P])], n)];
  // (c) the day's entry exists but does not list Juan: his notice decides
  const c = [group([entry("2026-10-05", [J, P]), entry("2026-10-07", [P]), entry("2026-10-12", [J, P]), entry("2026-10-14", [J, P])], n)];
  for (const classes of [a, b, c]) {
    const p = counters(classes, st, P), j = counters(classes, st, J);
    assert.deepEqual([p.realizadas, p.restantes], [4, 4]);
    assert.deepEqual([j.realizadas, j.restantes], [3, 5]);
    assert.equal(rowOf(classes, st, J, "2026-10-07").isGiven, false);
    assert.equal(rowOf(classes, st, P, "2026-10-07").isGiven, true);
  }
  // Pedro reads exactly as with no notice at all
  assert.deepEqual(counters(b, st, P), counters([group(b[0].attendanceLog)], st, P));
});

test("Ausente – Dada notice consumes only once the class has happened (date and time)", () => {
  const st = people();
  const classes = [group([], { "2026-10-15": { [J]: notice("ausente_dada") } }, { occurrences: [...OCC, "2026-10-15"] })];
  const c = combo({ dates: ["2026-10-15"] , total: 1 });
  const x = A.expandClasses(classes);
  const mine = x.filter((k) => k.students.includes(J));
  const r = S.createSlotReader({ classes: mine, combo: c, studentId: J });
  assert.equal(r.isGiven("2026-10-15"), false, "12:00, the class ends at 19:00");
  mock.timers.setTime(new Date("2026-10-15T19:45:00").getTime());
  assert.equal(S.createSlotReader({ classes: mine, combo: c, studentId: J }).isGiven("2026-10-15"), true, "after end time + margin");
  mock.timers.setTime(new Date("2026-10-15T12:00:00").getTime());
  // the No dada notice never consumes, even long after
  const nd = [group([], { "2026-10-12": { [J]: notice("ausente_reprog") } })];
  assert.equal(rowOf(nd, st, J, "2026-10-12").isGiven, false);
  // isComboClosed: a paid combo with an Ausente – No dada notice stays open
  const paid = { paid: true, paidCount: 8 };
  const log = EIGHT.filter((d) => d !== "2026-10-12").map((d) => entry(d, [J]));
  const mineOf = (classes) => A.expandClasses(classes).filter((k) => k.students.includes(J));
  assert.equal(A.isComboClosed(combo(paid), mineOf([group(log)]), J), true, "no record on a past date: closed by time (unchanged)");
  assert.equal(A.isComboClosed(combo(paid), mineOf([group(log, { "2026-10-12": { [J]: notice("ausente_reprog") } })]), J), false, "a No dada notice owes a makeup: open");
  assert.equal(A.isComboClosed(combo(paid), mineOf([group(log, { "2026-10-12": { [J]: notice("ausente_dada") } })]), J), true, "a past Dada notice resolves it");
});

test("Juan gave notice but came: the coach corrects to Presente; the notice keeps its history", () => {
  const st = people();
  const n = { "2026-10-07": { [J]: { status: "ausente_reprog", at: "2026-10-06T10:00:00Z", history: [{ status: "ausente_reprog", at: "2026-10-06T10:00:00Z" }] } } };
  const classes = [group([entry("2026-10-05", [J, P]), entry("2026-10-07", [J, P]), entry("2026-10-12", [J, P]), entry("2026-10-14", [J, P])], n)];
  assert.equal(counters(classes, st, J).realizadas, 4);
  assert.equal(R.readAttendance({ classes, classId: 10, date: "2026-10-07", studentId: J }).source, "attendance");
  assert.equal(classes[0].attendanceNotices["2026-10-07"][J].history.length, 1, "history untouched");
  // withdrawing the notice before the class keeps the record
  const row = N.applyNoticesToClassRow(group([], n), { date: "2026-10-07", changes: [{ studentId: J, status: null }], at: "2026-10-06T12:00:00Z" });
  assert.equal(R.noticeOf(row, "2026-10-07", J), null);
  assert.deepEqual(row.attendanceNotices["2026-10-07"][J].history.map((h) => h.status), ["ausente_reprog", null]);
});

test("a notice without later attendance: pending, shown in Inicio only after the class", () => {
  const classes = [group([entry("2026-10-05", [J, P])], { "2026-10-07": { [J]: notice("ausente_reprog") }, "2026-10-19": { [J]: notice("ausente_reprog") } })];
  const x = A.expandClasses(classes);
  const past = x.find((c) => c.date === "2026-10-07"), future = x.find((c) => c.date === "2026-10-19");
  assert.deepEqual(N.pendingNoticeStudentIds(past), [J]);
  assert.equal(A.isClassDone(past.date, past.timeEnd), true, "07/10 happened: shown");
  assert.equal(A.isClassDone(future.date, future.timeEnd), false, "19/10 not yet: not shown");
  // the day's attendance deciding Juan removes him from the notice path
  const decided = A.expandClasses([group([entry("2026-10-07", [P], [], [J])], { "2026-10-07": { [J]: notice("ausente_reprog") } })]).find((c) => c.date === "2026-10-07");
  assert.deepEqual(N.pendingNoticeStudentIds(decided), []);
  // Agenda chips: the notice shows on its own card, also before the class; classmates unchanged
  assert.equal(A.getAttendanceChipStatus(future, J), "ausente_reprog");
  assert.equal(A.getAttendanceChipStatus(future, P), null);
  const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  assert.match(app, /\.\.\.classes\.filter\(c=>!c\.cancelled&&!\(c\.paused\|\|c\.cancelType==="paused"\)&&isClassDone\(c\.date,c\.timeEnd\|\|"23:59"\)\)\.map\(c=>\{\s*const ids=pendingNoticeStudentIds\(c\)\.filter\(sid=>!isMensualForClass\(sid,c\)\);/);
});

test("two classes the same day: a notice in one never affects the other", () => {
  const morning = { ...group([], { "2026-10-12": { [J]: notice("ausente_reprog") } }), id: 1, title: "Mañana", time: "09:00", timeEnd: "10:00", students: [J] };
  const evening = { ...group([]), id: 2, title: "Tarde", students: [J] };
  const st = [{ id: J, name: "Juan", combos: [combo({ id: 1, sourceClassId: 1, dates: ["2026-10-12"], total: 1 }), combo({ id: 2, sourceClassId: 2, dates: ["2026-10-12"], total: 1 })] }];
  const x = A.expandClasses([morning, evening]);
  const rows = A.buildPersonSlotRows(st[0], x.filter((c) => c.students.includes(J)), A.TODAY_DATE, x).filter((r) => r.date === "2026-10-12");
  assert.deepEqual(rows.map((r) => [r.sourceClassId, r.isGiven]), [[1, false], [2, true]]);
  assert.equal(R.readAttendance({ classes: x, classId: 2, date: "2026-10-12", studentId: J }).source, null);
});

test("pauses, cancellations, reprogramming, mensual and individual packages", () => {
  const dc = { "2026-10-19": { cancelType: "paused", rescheduledTo: null }, "2026-10-21": { cancelType: "cancelled", rescheduledTo: null },
    "2026-10-26": { cancelType: "cancelled_reprog", rescheduledTo: "2026-10-30" } };
  const row = group([], {}, { dateCancellations: dc });
  const refusal = (date, changes = [{ studentId: J, status: "ausente_reprog" }], isMensual = () => false) => N.noticeWriteRefusal({ row, date, changes, todayDate: "2026-10-15", isMensual });
  assert.equal(refusal("2026-10-19"), "not-live", "paused date");
  assert.equal(refusal("2026-10-21"), "not-live", "cancelled date");
  assert.equal(refusal("2026-10-26"), "not-live", "reprogrammed origin");
  assert.equal(refusal("2026-10-30"), null, "live reprogramming destination");
  assert.equal(refusal("2026-10-12"), "past");
  assert.equal(refusal("2026-11-02", [{ studentId: "x", status: "ausente_reprog" }]), "not-in-class");
  assert.equal(refusal("2026-11-02", [{ studentId: J, status: "presente" }]), "status");
  assert.equal(refusal("2026-11-02", [{ studentId: J, status: null }]), "no-notice");
  assert.equal(refusal("2026-11-02", [{ studentId: J, status: "ausente_reprog" }], () => true), "mensual", "mensual: Ausente only");
  assert.equal(refusal("2026-11-02", [{ studentId: J, status: "ausente_dada" }], () => true), null, "mensual Ausente is informational");
  const withAtt = group([entry("2026-11-02", [P])]);
  assert.equal(N.noticeWriteRefusal({ row: withAtt, date: "2026-11-02", changes: [{ studentId: J, status: "ausente_reprog" }], todayDate: "2026-10-15" }), "attendance-recorded");
  const x = A.expandClasses([row]);
  assert.equal(N.cardNoticeRefusal(x.find((c) => c.date === "2026-10-19"), "2026-10-15"), "not-live");
  assert.equal(N.cardNoticeRefusal(x.find((c) => c.date === "2026-10-30"), "2026-10-15"), null);
  // individual package: same reading
  const st = people({ packType: "individual" });
  const classes = [group([entry("2026-10-05", [J, P])], { "2026-10-07": { [J]: notice("ausente_reprog") }, "2026-10-12": { [J]: notice("ausente_dada") } })];
  assert.equal(rowOf(classes, st, J, "2026-10-07").isGiven, false);
  assert.equal(rowOf(classes, st, J, "2026-10-12").isGiven, true, "past Ausente – Dada notice consumes");
});

test("notices never touch attendanceLog, students, combos, payments or other dates/students", () => {
  const base = group([entry("2026-10-05", [J, P])], { "2026-10-19": { [P]: notice("ausente_dada") } });
  const frozen = JSON.stringify(base);
  const next = N.applyNoticesToClassRow(base, { date: "2026-10-19", changes: [{ studentId: J, status: "ausente_reprog" }], at: "2026-10-15T12:00:00Z" });
  assert.equal(JSON.stringify(base), frozen, "input not mutated");
  assert.deepEqual(next.attendanceLog, base.attendanceLog);
  assert.deepEqual(next.attendanceNotices["2026-10-19"][P], base.attendanceNotices["2026-10-19"][P]);
  assert.deepEqual(Object.keys(next).sort(), Object.keys(base).sort());
  assert.equal(N.applyNoticesToClassRow(next, { date: "2026-10-19", changes: [{ studentId: J, status: "ausente_reprog" }], at: "x" }), next, "same status: no change");
  const used = (classes) => countUsedForCombo({ combo: combo(), studentId: J, dc: {}, attendanceLog: classes[0].attendanceLog, baseClassId: 10, classes });
  assert.equal(used([next]), used([base]), "used is explicit attendance only (unchanged)");
});

test("equivalence without notices; no definitive attendance in the future", () => {
  const plain = group([entry("2026-10-05", [J]), entry("2026-10-07", [P], [], [J])]);
  const withEmpty = { ...plain, attendanceNotices: {} };
  const st = people();
  assert.deepEqual(counters([withEmpty], st, J), counters([{ ...plain, attendanceNotices: undefined }], st, J));
  for (const d of EIGHT) assert.deepEqual(R.readAttendance({ classes: [plain], classId: 10, date: d, studentId: J }).state, R.readAttendance({ classes: [withEmpty], classId: 10, date: d, studentId: J }).state);
  const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  assert.match(app, /const isFutureDate=att\.date>todayIso\(\);\s*const handleSave=\(\)=>\{\s*if\(isFutureDate\) return;/);
  assert.match(app, /<button onClick=\{handleSave\} disabled=\{isFutureDate\}/);
  assert.match(app, /if\(classDate>todayIso\(\)\) return \{status:"future-attendance"\};/);
  const att = app.slice(app.indexOf("const handleAttendance=(cls)=>{"));
  assert.ok(att.indexOf('return {status:"future-attendance"}') < att.indexOf("setClasses("), "refused before any write");
  // Asistencia starts from the notice; the notice write is re-validated on the latest row, class row only
  assert.match(app, /else init\[sid\]=fromNotice\|\|"presente";/);
  const save = app.slice(app.indexOf("const saveAbsenceNotices=("), app.indexOf("const handleAttendance=(cls)=>{"));
  assert.match(save, /noticeWriteRefusal\(\{row,date,changes,todayDate:todayIso\(\),isMensual\}\)/);
  assert.match(save, /setClasses\(p=>p\.map\(c=>c\.id===seriesId\?applyNoticesToClassRow\(c,\{date,changes,at\}\):c\)\);/);
  assert.ok(!/setStudents\(/.test(save), "never writes students");
  assert.equal((app.match(/\.\.\.\(onAbsenceNotice\?\[\{label:"Avisar ausencia"/g) || []).length, 2, "day and week menus");
});
