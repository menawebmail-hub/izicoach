import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// BUG-COBROS-08 — Renovar Combo: the card added the finished combo to the renewed one (4 No pagadas / 4 Pagadas /
// 4 Realizadas / 4 Restantes, «4 de 8»). Synthetic data only. Class Mon/Wed 18:00–19:00, combo of 4:
// 16, 18, 23, 25 Nov 2026; renewal 30/11, 02/12, 07/12, 09/12. "Now" = Wed 25/11 20:00 (last class ended).
mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-25T20:00:00").getTime() });
const { loadAppFunctions } = await import("../test/loadAppFunctions.js");
const A = await loadAppFunctions([
  "TODAY_DATE", "isClassDone", "interpretContractDate", "resolveSlotPayments", "getSlotFulfillmentDate", "isComboClosed",
  "getClassEntitlements", "getCountedClassEntitlements", "getVisibleClassEntitlements", "getAccountCounters", "expandClasses",
]);
const SRC = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
const at = (iso) => mock.timers.setTime(new Date(iso).getTime());

const G = "gaby", O = "otro";
const OLD = ["2026-11-16", "2026-11-18", "2026-11-23", "2026-11-25"];
const NEW = ["2026-11-30", "2026-12-02", "2026-12-07", "2026-12-09"];
const OCC = [...OLD, ...NEW, "2026-12-14", "2026-12-16"];
const entry = (date, present = [], ausente_reprog = []) => ({ date, day: "x", present, ausente_dada: [], ausente_reprog });
const cls = (extra = {}) => ({ id: 77, title: "TEST Gaby", days: ["Lun", "Mié"], time: "18:00", timeEnd: "19:00", students: [G], startDate: OLD[0],
  date: OLD[0], occurrences: OCC, cancelledDates: [], rescheduledDates: [], dateCancellations: {}, attendanceLog: [], ...extra });
const paidCombo = (extra = {}) => ({ id: 1, total: 4, packType: "combo", sourceClassId: 77, used: 4, paid: true, paidCount: 4, amount: 400000,
  dates: [...OLD], payments: [{ id: 1, qty: 4, amount: 400000, method: "efectivo", date: "2026-11-25", dates: [...OLD] }], ...extra });
// The combo every Renovar entry point writes (Cobros success step: no sourceClassId; Cobros card and Agenda: with it).
const renewal = (extra = {}) => ({ id: 2, total: 4, packType: "combo", sourceClassId: 77, used: 0, paid: false, paidCount: 0, date: NEW[0],
  amount: 400000, dates: [...NEW], payments: [], ...extra });
const student = (combos, id = G) => ({ id, name: "TEST " + id, combos });
const read = (classes, combos) => {
  const c = A.getAccountCounters(student(combos), A.expandClasses(classes));
  return [c.noPagadas, c.pagadas, c.realizadas, c.restantes, c.realizadasCombo + " de " + c.totalEntitlementCombo];
};
const closed = (classes, combo, id = G) => A.isComboClosed(combo, A.expandClasses(classes).filter((k) => k.students.includes(id)), id);
const EXPECTED = [4, 0, 0, 4, "0 de 4"];

test("A — renewed the evening of the last class, no attendance taken: the card reads only the new combo", () => {
  at("2026-11-25T20:00:00");
  assert.equal(closed([cls()], paidCombo()), true, "closes at the class end + margin, not at midnight");
  assert.deepEqual(read([cls()], [paidCombo(), renewal()]), EXPECTED);
  // Same with the success-step renewal (no sourceClassId: its class is read from its dates).
  const { sourceClassId: _, ...legacy } = renewal();
  assert.deepEqual(read([cls()], [paidCombo(), legacy]), EXPECTED);
});

test("A — before the last class has ended the finished-looking combo stays open (a class is really pending)", () => {
  at("2026-11-25T18:30:00");
  assert.equal(closed([cls()], paidCombo()), false);
  at("2026-11-25T19:15:00");
  assert.equal(closed([cls()], paidCombo()), false, "inside the 30-minute margin");
  at("2026-11-25T19:30:00");
  assert.equal(closed([cls()], paidCombo()), true, "the same instant Realizadas counts it");
  at("2026-11-25T18:30:00");
  assert.deepEqual(read([cls()], [paidCombo(), renewal()]), [4, 4, 3, 5, "3 de 8"], "a pending class keeps counting (unchanged)");
});

test("B — Presente marked on the four dates", () => {
  at("2026-11-25T20:00:00");
  const k = cls({ attendanceLog: OLD.map((d) => entry(d, [G])) });
  assert.deepEqual(read([k], [paidCombo(), renewal()]), EXPECTED);
});

test("C — Presente on three dates, the last one left unmarked", () => {
  at("2026-11-25T20:00:00");
  const k = cls({ attendanceLog: OLD.slice(0, 3).map((d) => entry(d, [G])) });
  assert.deepEqual(read([k], [paidCombo(), renewal()]), EXPECTED);
});

test("D — the next day (unchanged)", () => {
  at("2026-11-26T09:00:00");
  assert.deepEqual(read([cls()], [paidCombo(), renewal()]), EXPECTED);
});

test("E — a pause already compensated by a resume no longer keeps the combo open; an active one still does", () => {
  at("2026-12-01T09:00:00");
  // Paused 18/11, resumed: the replacement (30/11) was added to combo.dates by the resume.
  const dates = [...OLD, "2026-11-30"];
  const next = renewal({ dates: ["2026-12-02", "2026-12-07", "2026-12-09", "2026-12-14"], date: "2026-12-02" });
  const compensated = cls({ dateCancellations: { "2026-11-18": { cancelType: "paused", compensated: true, compensatedBy: "op1" } } });
  assert.equal(closed([compensated], paidCombo({ dates })), true);
  assert.deepEqual(read([compensated], [paidCombo({ dates }), next]), EXPECTED);
  // compensatedBy lost: the combo's resumeOperations still say so (the same reading as the Pausada counter).
  const lost = cls({ dateCancellations: { "2026-11-18": { cancelType: "paused" } } });
  const op = { id: "op1", classId: 77, pausedDates: ["2026-11-18"], replacementDates: ["2026-11-30"], resumeDate: "2026-11-23" };
  assert.equal(closed([lost], paidCombo({ dates, resumeOperations: [op] })), true);
  // Active pause: open, the paused class is still owed.
  assert.equal(closed([lost], paidCombo({ dates })), false);
  // Compensated but the replacement is missing from combo.dates: open (never closed with a class short).
  assert.equal(closed([compensated], paidCombo()), false);
  // Compensated, replacement still in the future: open.
  at("2026-11-27T09:00:00");
  assert.equal(closed([compensated], paidCombo({ dates })), false);
});

test("F — a renewed combo with debt keeps its debt in No pagadas only", () => {
  at("2026-11-26T09:00:00");
  const debt = paidCombo({ paid: false, paidCount: 3, payments: [{ id: 1, qty: 3, amount: 300000, date: "2026-11-20", dates: OLD.slice(0, 3) }] });
  assert.equal(closed([cls()], debt), false, "not paid: never closed");
  assert.deepEqual(read([cls()], [debt, renewal()]), [5, 0, 0, 4, "0 de 4"]);
  // Not renewed: it is still the current combo and reads exactly as before.
  assert.deepEqual(read([cls()], [debt]), [1, 3, 4, 0, "4 de 4"]);
  // Paying the debt later closes it; the card then reads the new combo alone.
  assert.deepEqual(read([cls()], [{ ...debt, paid: true, paidCount: 4 }, renewal()]), EXPECTED);
});

test("never closed early: pending reprogramming, future recovery, Ausente – No dada", () => {
  at("2026-11-26T09:00:00");
  const pend = cls({ dateCancellations: { "2026-11-23": { cancelType: "cancelled_reprog" } } });
  assert.equal(closed([pend], paidCombo()), false, "A Reprogramar");
  assert.deepEqual(read([pend], [paidCombo(), renewal()]).slice(3), [5, "3 de 8"], "its pending class still counts");
  const future = cls({ dateCancellations: { "2026-11-23": { cancelType: "cancelled_reprog", rescheduledTo: "2026-11-28" } }, occurrences: [...OCC, "2026-11-28"] });
  assert.equal(closed([future], paidCombo()), false, "recovery not given yet");
  at("2026-11-28T20:00:00");
  assert.equal(closed([future], paidCombo()), true, "the recovery ended (its card's end time + margin)");
  at("2026-11-26T09:00:00");
  const noDada = cls({ attendanceLog: [entry("2026-11-25", [], [G])] });
  assert.equal(closed([noDada], paidCombo()), false, "Ausente – No dada owes a makeup");
  assert.deepEqual(read([noDada], [paidCombo(), renewal()]).slice(2), [3, 5, "3 de 8"]);
});

test("early renewal from Agenda (old combo still has a class): both combos keep counting (unchanged)", () => {
  at("2026-11-23T20:00:00");
  const old = paidCombo({ used: 3 });
  assert.deepEqual(read([cls()], [old, renewal()]), [4, 4, 3, 5, "3 de 8"]);
});

test("multiple classes: a renewal only affects combos of its own class; individuals untouched", () => {
  at("2026-11-26T09:00:00");
  const other = { ...cls({ id: 88, title: "TEST Otra", days: ["Mar"], occurrences: ["2026-11-17", "2026-11-24", "2026-12-01"] }), students: [G] };
  const mine = cls();
  const otherDebt = { id: 3, total: 2, packType: "combo", sourceClassId: 88, used: 2, paid: false, paidCount: 1, amount: 200000, dates: ["2026-11-17", "2026-11-24"], payments: [] };
  const debt = paidCombo({ paid: false, paidCount: 3 });
  // Class 88's finished combo with debt was not renewed: it counts in full; class 77's renewed one only by its debt.
  assert.deepEqual(read([mine, other], [otherDebt, debt, renewal()]), [1 + 1 + 4, 1, 2, 4, "2 de 6"]);
  // An individual after a combo never makes the combo "renewed".
  const ind = { id: 4, total: 1, packType: "individual", sourceClassId: 77, used: 0, paid: false, paidCount: 0, amount: 100000, dates: ["2026-11-30"], payments: [] };
  assert.deepEqual(read([mine], [debt, ind]), [1 + 1, 3, 4, 0, "4 de 4"]);
  // A combo of another class after it never renews it either.
  assert.deepEqual(read([mine, other], [debt, { ...otherDebt, dates: ["2026-12-01"], total: 1, paidCount: 0 }]).slice(1), [3, 4, 1, "4 de 5"], "its own future class stays in Restantes");
  // Unknown class (sourceClassId names no card, no dates): never assumed renewed.
  assert.deepEqual(read([mine], [{ ...debt, sourceClassId: undefined, dates: [] }, renewal()]).slice(4), ["0 de 8"]);
});

test("groups: each student reads only their own combos", () => {
  at("2026-11-25T20:00:00");
  const group = cls({ students: [G, O] });
  const gaby = A.getAccountCounters(student([paidCombo(), renewal()]), A.expandClasses([group]));
  const otro = A.getAccountCounters(student([paidCombo({ used: 0, paid: false, paidCount: 2 })], O), A.expandClasses([group]));
  assert.deepEqual([gaby.noPagadas, gaby.pagadas, gaby.realizadas, gaby.restantes], [4, 0, 0, 4]);
  assert.deepEqual([otro.noPagadas, otro.pagadas, otro.realizadas, otro.restantes], [2, 2, 4, 0]);
});

test("BUG-COBROS-07 preserved: Detalles counts the visible closed combo when nothing is open", () => {
  at("2026-11-25T20:00:00");
  const s = student([paidCombo()]);
  const x = A.expandClasses([cls()]);
  const det = A.getAccountCounters(s, x, { closedVisibleFallback: true });
  assert.deepEqual([det.noPagadas, det.pagadas, det.realizadas, det.restantes], [0, 4, 4, 0]);
  const withNew = student([paidCombo(), renewal()]);
  assert.deepEqual(A.getAccountCounters(withNew, x, { closedVisibleFallback: true }), A.getAccountCounters(withNew, x));
});

test("reading never writes: combos, payments and classes are untouched", () => {
  at("2026-11-26T09:00:00");
  const combos = [paidCombo({ paid: false, paidCount: 3 }), renewal()];
  const classes = [cls({ attendanceLog: [entry("2026-11-16", [G])] })];
  const before = JSON.stringify({ combos, classes });
  read(classes, combos);
  closed(classes, combos[0]);
  assert.equal(JSON.stringify({ combos, classes }), before);
});

test("wiring: the three Renovar entry points append an independent combo; card, Detalles, Dashboard and portal share the readers", () => {
  // Cobros success step, Cobros card, Agenda: each writes a fresh combo after the existing ones.
  assert.match(SRC, /const newCombo=\{id:updatedCombos\.length\+1,total:lastC\.total,packType:lastC\.packType\|\|"combo",used:0,paid:false,paidCount:0,[^}]*payments:\[\]\};\s*onUpdate\(\{\.\.\.s,combos:\[\.\.\.updatedCombos,newCombo\]\}\)/);
  assert.match(SRC, /const newCombo=\{id:\(s\.combos\|\|\[\]\)\.length\+1,total:lastComboS\.total,[^}]*used:0,paid:false,paidCount:0,[^}]*payments:\[\]\};\s*onUpdate\(\{\.\.\.s,combos:\[\.\.\.\(s\.combos\|\|\[\]\),newCombo\]\}\)/);
  assert.match(SRC, /const newCombo=\{id:combos\.length\+1,total:lastCombo\.total,[^}]*used:0,paid:false,paidCount:0,[^}]*payments:\[\]\};\s*onUpdateStudent\(\{\.\.\.st,combos:\[\.\.\.combos,newCombo\]\}\)/);
  // Readers: Cobros card, Detalles (BUG-COBROS-07 fallback), portal, Dashboard renewal alert and the Cobros button.
  assert.match(SRC, /=getAccountCounters\(s,classes\);\n/);
  assert.match(SRC, /getAccountCounters\(s,classes,\{closedVisibleFallback:true\}\)/);
  assert.match(SRC, /const computeAccountStats=\(memberStudent,memberClasses\)=>getAccountCounters\(memberStudent,memberClasses\);/);
  assert.match(SRC, /return isComboClosed\(last,myClasses,s\.id\);/);
  assert.match(SRC, /const showRenewal=!!lastComboS&&isComboClosed\(lastComboS,myClassesH,s\.id\);/);
  // Closure no longer waits for midnight in its time fallback.
  const body = SRC.slice(SRC.indexOf("function isComboClosed("), SRC.indexOf("// --- COBROS: Combo + Individual consolidation helpers"));
  assert.doesNotMatch(body, /isClassDone\(fulfillmentDate,"23:59"\)/);
});
