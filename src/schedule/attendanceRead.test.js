import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// BUG-AGENDA-05 stage 2.0 — every combo slot reads attendance (and its card) in its own class and date.
// Synthetic data only. "Today" = Thu 15/10/2026.
mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-15T12:00:00").getTime() });
const R = await import("./attendanceRead.js");
const await_import_slotStatus = await import("./slotStatus.js");
const { countAttendedSlots } = await import("./releaseReprogrammedDate.js");
const { countUsedForCombo } = await import("./slotMoves.js");
const { loadAppFunctions } = await import("../test/loadAppFunctions.js");
const A = await loadAppFunctions([
  "TODAY_DATE", "isClassDone", "interpretContractDate", "resolveSlotPayments", "buildSlotHistoryRows", "buildPersonSlotRows",
  "getSlotFulfillmentDate", "isComboClosed", "getClassEntitlements", "getCountedClassEntitlements", "getAccountCounters",
  "getEffectiveTotal", "getClaseRem", "expandClasses",
]);

const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const weekdays = (dows, from = "2026-10-05", to = "2026-12-31") => { const o = []; for (let d = new Date(from + "T12:00:00"); iso(d) <= to; d.setDate(d.getDate() + 1)) if (dows.includes(d.getDay())) o.push(iso(d)); return o; };
const entry = (date, present = [], ausente_dada = [], ausente_reprog = []) => ({ date, day: "x", present, ausente_dada, ausente_reprog });
const cls = (id, title, days, dows, students, log, extra = {}) => ({ id, title, days, time: "18:00", timeEnd: "19:00", students, startDate: "2026-10-05", date: "2026-10-05",
  occurrences: weekdays(dows), cancelledDates: [], rescheduledDates: [], dateCancellations: {}, attendanceLog: log, ...extra });
const combo = (id, sourceClassId, dates, extra = {}) => ({ id, total: dates.length, packType: "combo", sourceClassId, used: 0, paid: false, paidCount: 0, amount: 0, payments: [], dates, ...extra });

const SOFI = "sofi";
// Sofi: group MORNING (Mon, 09:00) and group EVENING (Mon/Wed, 18:00). The morning class is listed FIRST, so the old
// date-only reading took the morning attendance for her evening Mondays.
function twoClasses({ morningLog, eveningLog, morningExtra = {}, eveningExtra = {}, eveningCombo = {} } = {}) {
  const morning = cls(1, "Mañana", ["Lun"], [1], [SOFI], morningLog || [entry("2026-10-05", [SOFI]), entry("2026-10-12", [SOFI])], { time: "09:00", timeEnd: "10:00", ...morningExtra });
  const evening = cls(2, "Tarde", ["Lun", "Mié"], [1, 3], [SOFI], eveningLog || [entry("2026-10-05", [], [], [SOFI]), entry("2026-10-07", [SOFI])], eveningExtra);
  const student = { id: SOFI, name: "Sofi", combos: [
    combo(1, 1, weekdays([1]).slice(0, 4)),
    combo(2, 2, weekdays([1, 3]).slice(0, 4), eveningCombo),
  ] };
  return { classes: [morning, evening], students: [student] };
}
const rowsOf = (w, sid) => {
  const x = A.expandClasses(w.classes);
  const s = w.students.find((st) => st.id === sid);
  const mine = x.filter((c) => c.students.includes(sid));
  return { rows: A.buildPersonSlotRows(s, mine, A.TODAY_DATE, x), counters: A.getAccountCounters(s, x), x, mine, s };
};

test("readAttendance: one class and one date; explicit entry first; nothing recorded -> null", () => {
  const w = twoClasses();
  const x = A.expandClasses(w.classes);
  assert.equal(R.readAttendance({ classes: x, classId: 1, date: "2026-10-05", studentId: SOFI }).state, "present");
  assert.equal(R.readAttendance({ classes: x, classId: 2, date: "2026-10-05", studentId: SOFI }).state, "ausente_reprog");
  assert.equal(R.readAttendance({ classes: x, classId: 2, date: "2026-10-12", studentId: SOFI }).state, null);
  assert.equal(R.readAttendance({ classes: x, classId: 2, date: "2026-10-07", studentId: "otro" }).state, "unmarked");
  assert.equal(R.readAttendance({ classes: w.classes, classId: "2", date: "2026-10-07", studentId: SOFI }).state, "present", "raw rows and string ids");
  assert.equal(R.readAttendance({ classes: x, classId: undefined, date: "2026-10-05", studentId: SOFI }).entry, null);
});

test("two classes on the same day: the morning attendance never decides the evening slot (Cobros rows and counters)", () => {
  const { rows, counters } = rowsOf(twoClasses(), SOFI);
  // counters are per combo: morning 05 + 12 given (2); evening 07 Presente + 12 and 14 by time (3), 05 Ausente – No dada.
  // The previous reading took the morning Presente for the evening 05/10 and counted 6.
  assert.equal(counters.realizadas, 5);
  assert.equal(counters.aReprogramar, 0);
  // one row per combo and date: the morning and the evening 05/10 each keep their own row
  const monday = rows.filter((r) => r.date === "2026-10-05");
  assert.equal(monday.length, 2);
  assert.equal(monday.find((r) => r.sourceClassId === 1).isGiven, true, "morning: Presente");
  assert.equal(monday.find((r) => r.sourceClassId === 2).isGiven, false, "evening: Ausente – No dada");
  // per-combo reading through the shared reader
  const w = twoClasses();
  const x = A.expandClasses(w.classes);
  const mine = x.filter((c) => c.students.includes(SOFI));
  const S = await_import_slotStatus;
  const evening = S.createSlotReader({ classes: mine, combo: w.students[0].combos[1], studentId: SOFI });
  const morning = S.createSlotReader({ classes: mine, combo: w.students[0].combos[0], studentId: SOFI });
  assert.equal(evening.isGiven("2026-10-05"), false, "evening: Ausente – No dada");
  assert.equal(morning.isGiven("2026-10-05"), true, "morning: Presente");
  assert.equal(evening.isGiven("2026-10-12"), true, "evening 12/10: no record, past -> time fallback as before");
  assert.equal(evening.timeEndFor("2026-10-05"), "19:00", "evening end time, not the morning card's");
  assert.equal(morning.timeEndFor("2026-10-05"), "10:00");
});
test("the old date-only reading WAS crossed (documents the fix)", () => {
  const w = twoClasses();
  const x = A.expandClasses(w.classes);
  const mine = x.filter((c) => c.students.includes(SOFI));
  const S = await_import_slotStatus;
  const slot = S.resolveContractSlotStatus(mine, w.students[0].combos[1], "2026-10-05", mine.find((c) => c.date === "2026-10-05"));
  assert.equal(S.resolveSlotGiven(slot, "combo", "2026-10-05", "19:00", mine, SOFI), true, "without classId: the morning entry (previous reading)");
  assert.equal(S.resolveSlotGiven(slot, "combo", "2026-10-05", "19:00", mine, SOFI, 2), false, "with the slot's class: its own entry");
});

test("isComboClosed reads each slot in its own class (card flags and attendance)", () => {
  const paidAll = { paid: true, paidCount: 4 };
  // evening pending makeup on 05/10 must keep the evening combo open, whatever the morning says
  const w = twoClasses({ eveningCombo: paidAll, eveningLog: [entry("2026-10-05", [], [], [SOFI]), entry("2026-10-07", [SOFI]), entry("2026-10-12", [SOFI]), entry("2026-10-14", [SOFI])] });
  const x = A.expandClasses(w.classes);
  const mine = x.filter((c) => c.students.includes(SOFI));
  assert.equal(A.isComboClosed(w.students[0].combos[1], mine, SOFI), false);
  // a morning PAUSE on a Monday does not pause the evening slot of that Monday
  const w2 = twoClasses({ eveningCombo: paidAll, morningExtra: { dateCancellations: { "2026-10-12": { cancelType: "paused", rescheduledTo: null } } },
    eveningLog: [entry("2026-10-05", [SOFI]), entry("2026-10-07", [SOFI]), entry("2026-10-12", [SOFI]), entry("2026-10-14", [SOFI])] });
  const x2 = A.expandClasses(w2.classes);
  const mine2 = x2.filter((c) => c.students.includes(SOFI));
  assert.equal(A.isComboClosed(w2.students[0].combos[1], mine2, SOFI), true, "evening fully given and paid: closed");
});

test("Juan and Pedro (combos of 8, same group): individual absences, 4/4 and 3/5, nobody affects the other", () => {
  const J = "juan", P = "pedro";
  const g = cls(10, "Grupo", ["Lun", "Mié"], [1, 3], [J, P], [entry("2026-10-05", [J, P]), entry("2026-10-07", [P], [], [J]), entry("2026-10-12", [J, P]), entry("2026-10-14", [J, P])]);
  const eight = weekdays([1, 3]).slice(0, 8);
  const students = [{ id: J, name: "Juan", combos: [combo(1, 10, eight)] }, { id: P, name: "Pedro", combos: [combo(1, 10, eight)] }];
  const w = { classes: [g], students };
  const p = rowsOf(w, P), j = rowsOf(w, J);
  assert.deepEqual([p.counters.realizadas, p.counters.restantes], [4, 4]);
  assert.deepEqual([j.counters.realizadas, j.counters.restantes], [3, 5]);
  const jRow = j.rows.find((r) => r.date === "2026-10-07");
  assert.equal(jRow.isGiven, false);
  for (const s of students) assert.equal(countUsedForCombo({ combo: s.combos[0], studentId: s.id, dc: {}, attendanceLog: g.attendanceLog, baseClassId: 10, classes: [g] }), s.id === P ? 4 : 3);
});

test("chained reprogramming and fused dates read the destination in the slot's own class", () => {
  const J = "juan";
  const dc = { "2026-10-12": { cancelType: "cancelled_reprog", rescheduledTo: "2026-10-16" }, "2026-10-16": { cancelType: "cancelled_reprog", rescheduledTo: "2026-10-23" },
    "2026-10-19": { cancelType: "cancelled_reprog", rescheduledTo: "2026-10-21" } };
  const g = cls(10, "Grupo", ["Lun", "Mié"], [1, 3], [J], [entry("2026-10-05", [J]), entry("2026-10-07", [J]), entry("2026-10-14", [J])], { dateCancellations: dc });
  // another class of Juan has attendance on the chain destination 23/10 and on the fused terminal 21/10
  const other = cls(20, "Otra", ["Mié", "Vie"], [3, 5], [J], [entry("2026-10-23", [J]), entry("2026-10-21", [J])]);
  const eight = weekdays([1, 3]).slice(0, 8);
  const w = { classes: [other, g], students: [{ id: J, name: "Juan", combos: [combo(1, 10, eight)] }] };
  const { rows } = rowsOf(w, J);
  const chained = rows.find((r) => r.date === "2026-10-12");
  assert.equal(chained.terminalDate, "2026-10-23");
  assert.equal(chained.isGiven, false, "23/10 is a future date in its own class (today 15/10); the other class's entry is not read");
  const fused = rows.filter((r) => r.terminalDate === "2026-10-21");
  assert.equal(fused.length, 2, "19/10 and 21/10 end on 21/10 (fused)");
  assert.ok(fused.every((r) => !r.isGiven), "future in its own class: not given by the other class's entry");
});

test("individual and group combos, partial payments, pauses and cancellations keep their reading", () => {
  const J = "juan";
  const dc = { "2026-10-12": { cancelType: "paused", rescheduledTo: null }, "2026-10-14": { cancelType: "cancelled", rescheduledTo: null } };
  const g = cls(10, "Grupo", ["Lun", "Mié"], [1, 3], [J], [entry("2026-10-05", [J]), entry("2026-10-07", [], [J])], { dateCancellations: dc });
  const other = cls(20, "Otra", ["Lun", "Mié"], [1, 3], [J], [entry("2026-10-12", [J]), entry("2026-10-14", [J])]);
  const eight = weekdays([1, 3]).slice(0, 8);
  for (const packType of ["combo", "individual"]) {
    const w = { classes: [other, g], students: [{ id: J, name: "Juan", combos: [combo(1, 10, eight, { packType, paidCount: 3, payments: [{ id: 1, qty: 3, amount: 0, dates: [] }] }), combo(2, 20, ["2026-10-12", "2026-10-14"], { packType })] }] };
    const { rows } = rowsOf(w, J);
    const byDate = (d) => rows.filter((r) => r.date === d);
    assert.equal(byDate("2026-10-12")[0].isPaused, true, packType + ": the group pause stays");
    assert.equal(byDate("2026-10-12")[0].isGiven, false, packType + ": paused, never given by the other class");
    assert.equal(byDate("2026-10-14")[0].isCancelledClass, true, packType + ": the group cancellation stays");
    assert.equal(rows.find((r) => r.date === "2026-10-07").isGiven, true, packType + ": Ausente – Dada consumes");
    assert.equal(rows.filter((r) => r.date >= "2026-10-05" && eight.includes(r.date)).slice(0, 3).every((r) => r.isPaid), true, packType + ": 3 paid slots stay paid by position");
  }
});

test("equivalence: without a second class on the same date nothing changes (date-only vs class reading)", () => {
  const J = "juan";
  const g = cls(10, "Grupo", ["Lun", "Mié"], [1, 3], [J], [entry("2026-10-05", [J]), entry("2026-10-07", [], [], [J]), entry("2026-10-12", [], [J])]);
  const eight = weekdays([1, 3]).slice(0, 8);
  const c = combo(1, 10, eight);
  const x = A.expandClasses([g]);
  const S = await_import_slotStatus;
  for (const d of eight) {
    const slot = S.resolveContractSlotStatus(x, c, d, x.find((k) => k.date === d));
    assert.equal(S.resolveSlotGiven(slot, "combo", d, "19:00", x, J, 10), S.resolveSlotGiven(slot, "combo", d, "19:00", x, J), d);
  }
  assert.equal(countUsedForCombo({ combo: c, studentId: J, dc: {}, attendanceLog: g.attendanceLog, baseClassId: 10, classes: [g] }), countAttendedSlots({ dates: eight, dc: {}, attendanceLog: g.attendanceLog, studentId: J }));
});

test("wiring: no date-only attendance or card lookup left in the slot readers except the legacy fallback", () => {
  const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  const ss = readFileSync(new URL("./slotStatus.js", import.meta.url), "utf8");
  assert.equal((app.match(/flatMap\(cls=>cls\.attendanceLog\|\|\[\]\)/g) || []).length, 3, "only the three legacy fallbacks (history, isComboClosed, PagoModal)");
  // stage 2.1: isComboClosed and the history read the full reading (attendance, then notice); PagoModal keeps the entry
  assert.match(app, /const r=readAttendance\(\{classes:myClasses,classId:slotCls,date:fulfillmentDate,studentId\}\);/);
  assert.match(app, /const rd=slotCls!==undefined\?readAttendance\(\{classes:myClasses,classId:slotCls,date:ds,studentId:s\.id\}\):null;/);
  assert.match(app, /const given=givenByReading\(readAttendance\(\{classes:myClasses,classId,date,studentId\}\),date,timeEnd\);/);
  assert.equal((app.match(/const cl=slotCardOn\(myClasses,c,d\);/g) || []).length, 5, "isComboClosed (3) + paused extension in counters and PagoModal (2)");
  assert.ok(!/myClasses\.find\(x=>x\.date===d\)/.test(app), "no date-only card lookup for the pause flag");
  assert.match(app, /const classOnDate=reader\.cardFor\(ds\);/);
  assert.match(app, /const clsD=slotCardOn\(myClsForCombo,c,d\);/);
  assert.match(app, /historyRows:buildSlotHistoryRows\(slot,displayPaid,isGiven,personClasses,person\.id,timeEnd,slotClassId\(personClasses,c,d\)\),comboIndex,sourceClassId:c\.sourceClassId\}/);
  assert.match(ss, /const cardFor = \(date\) => slotCardOn\(list, combo, date\);/);
  assert.match(ss, /resolveSlotGiven\(baseStatus\(date\), combo\.packType, date, timeEndFor\(date\), list, studentId, slotClassId\(list, combo, date\)\)/);
  assert.equal((ss.match(/flatMap\(cls=>cls\.attendanceLog/g) || []).length, 1, "legacy fallback only");
});
