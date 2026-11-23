import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// BUG-AGENDA-05 / BUG-AGENDA-03 stage 1d — reading per-student slot moves (nothing writes them yet).
// Synthetic data only. "Today" = Thu 15/10/2026, after the 4th date of Juan and Pedro's combos.
mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-15T12:00:00").getTime() });
const M = await import("./slotMoves.js");
const S = await import("./slotStatus.js");
const { countAttendedSlots } = await import("./releaseReprogrammedDate.js");
const { loadAppFunctions } = await import("../test/loadAppFunctions.js");
const A = await loadAppFunctions([
  "TODAY_DATE", "isClassDone", "interpretContractDate", "resolveSlotPayments", "buildSlotHistoryRows", "buildPersonSlotRows",
  "getSlotFulfillmentDate", "isComboClosed", "getClassEntitlements", "getCountedClassEntitlements", "getAccountCounters",
  "getEffectiveTotal", "getClaseRem", "expandClasses",
]);

const GA = 10; // group A, Mon/Wed — Juan and Pedro
const GB = 20; // group B, Tue/Thu — where Juan recovers
const JUAN = "juan", PEDRO = "pedro";
const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const weekdays = (dows) => { const o = []; for (let d = new Date("2026-10-05T12:00:00"); iso(d) <= "2026-12-31"; d.setDate(d.getDate() + 1)) if (dows.includes(d.getDay())) o.push(iso(d)); return o; };
const OCC_A = weekdays([1, 3]);
const OCC_B = weekdays([2, 4]);
const EIGHT = OCC_A.slice(0, 8); // 05,07,12,14,19,21,26,28 Oct
const entry = (date, present = [], ausente_dada = [], ausente_reprog = []) => ({ date, day: "x", present, ausente_dada, ausente_reprog });

function world({ juanMoves, logB = [], dcA = {}, dcB = {}, logA, juanCombo = {}, pedroCombo = {} } = {}) {
  const gA = { id: GA, title: "Grupo A", days: ["Lun", "Mié"], time: "18:00", timeEnd: "19:00", students: [JUAN, PEDRO], startDate: OCC_A[0], date: OCC_A[0],
    occurrences: OCC_A, cancelledDates: [], rescheduledDates: [], dateCancellations: dcA,
    attendanceLog: logA || [entry("2026-10-05", [JUAN, PEDRO]), entry("2026-10-07", [PEDRO], [], [JUAN]), entry("2026-10-12", [JUAN, PEDRO]), entry("2026-10-14", [JUAN, PEDRO])] };
  const gB = { id: GB, title: "Grupo B", days: ["Mar", "Jue"], time: "18:00", timeEnd: "19:00", students: ["otro"], startDate: OCC_B[0], date: OCC_B[0],
    occurrences: OCC_B, cancelledDates: [], rescheduledDates: [], dateCancellations: dcB, attendanceLog: logB };
  const combo = (extra) => ({ id: 1, total: 8, packType: "combo", sourceClassId: GA, used: 0, paid: false, paidCount: 0, amount: 400000, payments: [], dates: [...EIGHT], ...extra });
  const students = [
    { id: JUAN, name: "Juan", combos: [combo({ ...(juanMoves ? { slotMoves: juanMoves } : {}), ...juanCombo })] },
    { id: PEDRO, name: "Pedro", combos: [combo(pedroCombo)] },
    { id: "otro", name: "Otro", combos: [] },
  ];
  return { classes: [gA, gB], students };
}
const recovery = (slotDate, to, extra = {}) => ({ id: "mv-" + slotDate + "-" + to.date, slot: { index: EIGHT.indexOf(slotDate), date: slotDate }, kind: "recovery",
  from: { classId: GA, date: slotDate }, to, at: "2026-10-12T10:00:00Z", ...extra });

const read = (w, sid) => {
  const x = A.expandClasses(w.classes);
  const s = w.students.find((st) => st.id === sid);
  const mine = x.filter((c) => c.students && c.students.includes(sid));
  return { rows: A.buildPersonSlotRows(s, mine, A.TODAY_DATE, x), counters: A.getAccountCounters(s, x), claseRem: A.getClaseRem(s, x) };
};
const usedOf = (w, sid) => {
  const s = w.students.find((st) => st.id === sid);
  const combo = s.combos[0];
  const gA = w.classes.find((c) => c.id === GA);
  return M.countUsedForCombo({ combo, studentId: sid, dc: gA.dateCancellations, attendanceLog: gA.attendanceLog, baseClassId: GA, classes: w.classes });
};
const row = (r, date) => r.rows.find((x) => x.date === date);

test("Juan and Pedro, combos of 8: after four dates Pedro 4 done / 4 left, Juan 3 / 5 (Ausente – No dada consumes nothing)", () => {
  const w = world();
  const p = read(w, PEDRO), j = read(w, JUAN);
  assert.equal(p.counters.realizadas, 4); assert.equal(p.counters.restantes, 4);
  assert.equal(j.counters.realizadas, 3); assert.equal(j.counters.restantes, 5);
  assert.equal(usedOf(w, PEDRO), 4); assert.equal(usedOf(w, JUAN), 3);
});

test("Juan recovers in group B (Presente): his counters move exactly once; Pedro's do not change at all", () => {
  const before = world();
  const w = world({ juanMoves: [recovery("2026-10-07", { classId: GB, date: "2026-10-13" })], logB: [entry("2026-10-13", [JUAN])] });
  const j = read(w, JUAN), jBefore = read(before, JUAN);
  assert.equal(j.counters.realizadas, 4); assert.equal(j.counters.restantes, 4);
  assert.equal(usedOf(w, JUAN), 4);
  assert.deepEqual(read(w, PEDRO), read(before, PEDRO), "Pedro identical");
  assert.equal(usedOf(w, PEDRO), 4);
  const r = row(j, "2026-10-07");
  assert.equal(r.isGiven, true); assert.equal(r.terminalDate, "2026-10-13"); assert.equal(r.isReprogWithDate, true); assert.equal(r.rescheduledTo, "2026-10-13");
  assert.deepEqual(r.historyRows.map((h) => [h.date, h.status]), [["2026-10-07", "reprogrammed"], ["2026-10-13", "done"]]);
  // identity, position and payments untouched
  assert.deepEqual(w.students[0].combos[0].dates, EIGHT);
  assert.deepEqual(j.rows.map((x) => [x.date, x.isPaid, x.displayPaid]), jBefore.rows.map((x) => [x.date, x.isPaid, x.displayPaid]));
});

test("a recovery without explicit attendance stays pending, even after its time", () => {
  const w = world({ juanMoves: [recovery("2026-10-07", { classId: GB, date: "2026-10-13" })] });
  const j = read(w, JUAN);
  assert.equal(j.counters.realizadas, 3); assert.equal(j.counters.restantes, 5);
  assert.equal(usedOf(w, JUAN), 3);
  const r = row(j, "2026-10-07");
  assert.equal(r.isGiven, false); assert.equal(r.isReprogWithDate, true);
  assert.equal(r.historyRows[1].status, "scheduled");
});

test("a duplicate recovery is rejected (reader and planner); the slot is consumed once", () => {
  const first = recovery("2026-10-07", { classId: GB, date: "2026-10-13" });
  const dup = recovery("2026-10-07", { classId: GB, date: "2026-10-15" }, { id: "dup" });
  const w = world({ juanMoves: [first, dup], logB: [entry("2026-10-13", [JUAN]), entry("2026-10-15", [JUAN])] });
  const juan = w.students[0];
  const r = S.createSlotReader({ classes: A.expandClasses(w.classes).filter((c) => c.students.includes(JUAN)), allClasses: A.expandClasses(w.classes), combo: juan.combos[0], studentId: JUAN });
  assert.deepEqual(r.moves().conflicts.map((c) => [c.move.id, c.reason]), [["dup", "not-from-current-location"]]);
  assert.equal(read(w, JUAN).counters.realizadas, 4);
  assert.equal(usedOf(w, JUAN), 4);
  const w1 = world({ juanMoves: [first] });
  const plan = S.planStudentSlotMove({ classes: A.expandClasses(w1.classes), student: w1.students[0], combo: w1.students[0].combos[0], slot: { index: 1, date: "2026-10-07" }, to: { classId: GB, date: "2026-10-15" }, kind: "recovery" });
  assert.deepEqual(plan, { ok: false, reason: "active-recovery" });
});

test("missing the recovery again (Ausente – No dada) keeps the slot pending; a new recovery is then allowed and counts once", () => {
  const first = recovery("2026-10-07", { classId: GB, date: "2026-10-13" });
  const w = world({ juanMoves: [first], logB: [entry("2026-10-13", [], [], [JUAN])] });
  const j = read(w, JUAN);
  const r = row(j, "2026-10-07");
  assert.equal(r.isGiven, false); assert.equal(r.isReprogNoDate, true); assert.equal(r.isReprogWithDate, false);
  assert.equal(j.counters.aReprogramar, 1); assert.equal(j.counters.realizadas, 3);
  const plan = S.planStudentSlotMove({ classes: A.expandClasses(w.classes), student: w.students[0], combo: w.students[0].combos[0], slot: { index: 1, date: "2026-10-07" }, to: { classId: GB, date: "2026-10-15" }, kind: "recovery", id: "mv2", at: "t" });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.move.from, { classId: GB, date: "2026-10-13" });
  const w2 = world({ juanMoves: [first, plan.move], logB: [entry("2026-10-13", [], [], [JUAN]), entry("2026-10-15", [JUAN])] });
  const j2 = read(w2, JUAN);
  assert.equal(j2.counters.realizadas, 4); assert.equal(usedOf(w2, JUAN), 4);
  assert.deepEqual(row(j2, "2026-10-07").historyRows.map((h) => [h.date, h.status]), [["2026-10-07", "reprogrammed"], ["2026-10-13", "reprogrammed"], ["2026-10-15", "done"]]);
});

test("no double consumption: a move from a slot that was given at its origin is ignored", () => {
  const logA = [entry("2026-10-05", [JUAN, PEDRO]), entry("2026-10-07", [JUAN, PEDRO]), entry("2026-10-12", [JUAN, PEDRO]), entry("2026-10-14", [JUAN, PEDRO])];
  const w = world({ logA, juanMoves: [recovery("2026-10-07", { classId: GB, date: "2026-10-13" })], logB: [entry("2026-10-13", [JUAN])] });
  assert.equal(read(w, JUAN).counters.realizadas, 4);
  assert.equal(usedOf(w, JUAN), 4);
  assert.equal(row(read(w, JUAN), "2026-10-07").studentMoves, undefined);
});

test("collisions: never onto another slot's location, never two slots onto one date", () => {
  const onOwn = world({ juanMoves: [recovery("2026-10-07", { classId: GA, date: "2026-10-12" })] });
  assert.equal(row(read(onOwn, JUAN), "2026-10-07").studentMoves, undefined, "own slot date: ignored");
  const logA = [entry("2026-10-05", [JUAN, PEDRO]), entry("2026-10-07", [PEDRO], [], [JUAN]), entry("2026-10-12", [PEDRO], [], [JUAN]), entry("2026-10-14", [JUAN, PEDRO])];
  const two = world({ logA, juanMoves: [recovery("2026-10-07", { classId: GB, date: "2026-10-13" }), recovery("2026-10-12", { classId: GB, date: "2026-10-13" }, { id: "second" })], logB: [entry("2026-10-13", [JUAN])] });
  assert.equal(read(two, JUAN).counters.realizadas, 3, "05, 14 and one recovery");
  assert.equal(usedOf(two, JUAN), 3);
  const plan = S.planStudentSlotMove({ classes: A.expandClasses(onOwn.classes), student: onOwn.students[0], combo: onOwn.students[0].combos[0], slot: { index: 1, date: "2026-10-07" }, to: { classId: GA, date: "2026-10-12" }, kind: "recovery" });
  assert.deepEqual(plan, { ok: false, reason: "collision" });
});

test("chained class-level reprogramming: the student moves from the chain's pending terminal", () => {
  const dcA = { "2026-10-12": { cancelType: "cancelled_reprog", rescheduledTo: "2026-10-16" }, "2026-10-16": { cancelType: "cancelled_reprog", rescheduledTo: null } };
  const logA = [entry("2026-10-05", [JUAN, PEDRO]), entry("2026-10-07", [JUAN, PEDRO]), entry("2026-10-14", [JUAN, PEDRO])];
  const fromChain = recovery("2026-10-12", { classId: GB, date: "2026-10-13" }, { from: { classId: GA, date: "2026-10-16" } });
  const w = world({ dcA, logA, juanMoves: [fromChain], logB: [entry("2026-10-13", [JUAN])] });
  const r = row(read(w, JUAN), "2026-10-12");
  assert.equal(r.isGiven, true);
  assert.deepEqual(r.reschedulePath, ["2026-10-12", "2026-10-16", "2026-10-13"]);
  assert.equal(usedOf(w, JUAN), 4);
  // Pedro, still waiting for the class-level reprogramming, is untouched
  assert.equal(row(read(w, PEDRO), "2026-10-12").isReprogNoDate, true);
  const wrongFrom = world({ dcA, logA, juanMoves: [recovery("2026-10-12", { classId: GB, date: "2026-10-13" })], logB: [entry("2026-10-13", [JUAN])] });
  assert.equal(row(read(wrongFrom, JUAN), "2026-10-12").studentMoves, undefined, "must leave from the chain terminal");
});

test("fused dates (two slots on one terminal) are never consumed twice; a pause is never moved", () => {
  const dcA = { "2026-10-19": { cancelType: "cancelled_reprog", rescheduledTo: "2026-10-21" }, "2026-10-26": { cancelType: "paused", rescheduledTo: null } };
  const logA = [entry("2026-10-05", [JUAN]), entry("2026-10-07", [JUAN]), entry("2026-10-12", [JUAN]), entry("2026-10-14", [JUAN]), entry("2026-10-21", [JUAN])];
  const fused = world({ dcA, logA, juanMoves: [recovery("2026-10-19", { classId: GB, date: "2026-10-13" }, { from: { classId: GA, date: "2026-10-21" } })], logB: [entry("2026-10-13", [JUAN])] });
  const base = world({ dcA, logA });
  assert.equal(usedOf(fused, JUAN), usedOf(base, JUAN), "given terminal: move ignored, fused terminal counted once");
  assert.equal(usedOf(base, JUAN), countAttendedSlots({ dates: EIGHT, dc: dcA, attendanceLog: logA, studentId: JUAN }));
  const paused = world({ dcA, logA, juanMoves: [recovery("2026-10-26", { classId: GB, date: "2026-10-13" })], logB: [entry("2026-10-13", [JUAN])] });
  assert.equal(row(read(paused, JUAN), "2026-10-26").isPaused, true);
  assert.equal(row(read(paused, JUAN), "2026-10-26").studentMoves, undefined);
});

test("partial payments: payment positions and amounts never move; individual packages follow the same rules", () => {
  const paid = { paidCount: 3, payments: [{ id: 1, qty: 3, amount: 150000, dates: [] }] };
  const before = read(world({ juanCombo: paid }), JUAN);
  const after = read(world({ juanCombo: paid, juanMoves: [recovery("2026-10-07", { classId: GB, date: "2026-10-13" })], logB: [entry("2026-10-13", [JUAN])] }), JUAN);
  assert.deepEqual(after.rows.map((x) => x.isPaid), before.rows.map((x) => x.isPaid));
  assert.equal(after.counters.pagadas, before.counters.pagadas);
  assert.equal(after.counters.noPagadas, before.counters.noPagadas);
  const ind = { packType: "individual" };
  const iBefore = world({ juanCombo: ind });
  const iAfter = world({ juanCombo: ind, juanMoves: [recovery("2026-10-07", { classId: GB, date: "2026-10-13" })], logB: [entry("2026-10-13", [JUAN])] });
  assert.equal(row(read(iBefore, JUAN), "2026-10-07").isGiven, false);
  assert.equal(row(read(iAfter, JUAN), "2026-10-07").isGiven, true);
  assert.equal(usedOf(iAfter, JUAN), usedOf(iBefore, JUAN) + 1);
});

test("an undone move is history only; a destination the class did not hold leaves the slot pending", () => {
  const undone = world({ juanMoves: [recovery("2026-10-07", { classId: GB, date: "2026-10-13" }, { undoneAt: "2026-10-12T11:00:00Z" })], logB: [entry("2026-10-13", [JUAN])] });
  assert.equal(row(read(undone, JUAN), "2026-10-07").studentMoves, undefined);
  assert.equal(usedOf(undone, JUAN), 3);
  const notHeld = world({ juanMoves: [recovery("2026-10-07", { classId: GB, date: "2026-10-13" })], dcB: { "2026-10-13": { cancelType: "cancelled", rescheduledTo: null } }, logB: [entry("2026-10-13", [JUAN])] });
  assert.equal(row(read(notHeld, JUAN), "2026-10-07").isReprogNoDate, true);
  assert.equal(usedOf(notHeld, JUAN), 3);
});

test("without the destination class in hand (e.g. the student portal today) a recovery reads pending, never consumed", () => {
  const w = world({ juanMoves: [recovery("2026-10-07", { classId: GB, date: "2026-10-13" })], logB: [entry("2026-10-13", [JUAN])] });
  const x = A.expandClasses(w.classes);
  const mine = x.filter((c) => c.students.includes(JUAN));
  const rows = A.buildPersonSlotRows(w.students[0], mine, A.TODAY_DATE); // no allClasses
  assert.equal(rows.find((r) => r.date === "2026-10-07").isGiven, false);
});

test("equivalence: without slotMoves the used count IS countAttendedSlots and the reader reports nothing", () => {
  const w = world();
  for (const s of w.students.filter((x) => x.combos.length)) {
    const gA = w.classes[0];
    assert.equal(M.countUsedForCombo({ combo: s.combos[0], studentId: s.id, dc: gA.dateCancellations, attendanceLog: gA.attendanceLog, baseClassId: GA, classes: w.classes }),
      countAttendedSlots({ dates: s.combos[0].dates, dc: gA.dateCancellations, attendanceLog: gA.attendanceLog, studentId: s.id }));
    const r = S.createSlotReader({ classes: A.expandClasses(w.classes), combo: s.combos[0], studentId: s.id });
    assert.equal(r.moves().bySlot.size, 0);
  }
  assert.equal(M.studentsWithMoveInto(w.students, GB, "2026-10-13").length, 0);
});

test("attendance save: a guest with a recovery into this class and date is recounted on that combo only", () => {
  const w = world({ juanMoves: [recovery("2026-10-07", { classId: GB, date: "2026-10-13" })] });
  assert.deepEqual(M.studentsWithMoveInto(w.students, GB, "2026-10-13"), [JUAN]);
  assert.equal(M.comboIndexWithMoveInto(w.students[0].combos, GB, "2026-10-13"), 0);
  assert.equal(M.comboIndexWithMoveInto(w.students[1].combos, GB, "2026-10-13"), -1);
  const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  const att = app.slice(app.indexOf("const handleAttendance=(cls)=>{"), app.indexOf("const releaseInFlightRef=useRef(new Set());"));
  assert.match(att, /const classesForMoves=classes\.map\(c=>c\.id===realId\?\{\.\.\.c,attendanceLog:mergedLog\}:c\);/);
  assert.match(att, /const guestIdx=allClassStudents\.includes\(s\.id\)\?-1:comboIndexWithMoveInto\(s\.combos,realId,classDate\);/);
  assert.ok(att.indexOf("if(guestIdx>=0){") < att.indexOf("if(!allClassStudents.includes(s.id)) return s;"));
});
