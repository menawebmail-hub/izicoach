import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Safe class deletion (Eliminar clase) — synthetic data only. "Today" = Wed 25/11/2026 12:00.
// Group G (Lun/Mié 18–19): Ana (combo 8, paid 8) and Beto (combo 8, paid 5), both attended the first 6 dates;
// the last 2 dates (30/11, 02/12) are still ahead. The coach deletes the future instances from 30/11.
mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-25T12:00:00").getTime() });
const D = await import("./classDeletion.js");
const { normalizeDeletedDates, markAddedDatesDeleted } = await import("./deletedDates.js");
const { loadAppFunctions } = await import("../test/loadAppFunctions.js");
const A = await loadAppFunctions([
  "TODAY_DATE", "isClassDone", "interpretContractDate", "resolveSlotPayments", "buildSlotHistoryRows", "buildPersonSlotRows",
  "getSlotFulfillmentDate", "isComboClosed", "getClassEntitlements", "getCountedClassEntitlements", "getAccountCounters",
  "expandClasses", "scheduleCards", "getComboExportCounters", "resolveComboClassName", "formatDateDDMMYYYY", "buildComboExportRows",
  "deletedSlotCounts", "applyResumeToClassRow",
]);
const SRC = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");

const ANA = "ana", BETO = "beto";
const OCC = ["2026-11-02", "2026-11-04", "2026-11-09", "2026-11-11", "2026-11-16", "2026-11-18", "2026-11-23", "2026-11-25",
  "2026-11-30", "2026-12-02", "2026-12-07", "2026-12-09"];
const EIGHT = ["2026-11-02", "2026-11-04", "2026-11-09", "2026-11-11", "2026-11-16", "2026-11-18", "2026-11-30", "2026-12-02"];
const entry = (date, present) => ({ date, day: "x", present, ausente_dada: [], ausente_reprog: [] });
const G = () => ({ id: 50, title: "Grupo G", days: ["Lun", "Mié"], time: "18:00", timeEnd: "19:00", court: "C1", students: [ANA, BETO],
  startDate: OCC[0], date: OCC[0], occurrences: [...OCC], cancelledDates: [], rescheduledDates: [], dateCancellations: {},
  attendanceLog: EIGHT.slice(0, 6).map((d) => entry(d, [ANA, BETO])) });
// Another class of Ana on Mondays (shares 30/11 and 07/12 with G) — must never change.
const H = () => ({ id: 60, title: "Clase H", days: ["Lun"], time: "10:00", timeEnd: "11:00", court: "C2", students: [ANA],
  startDate: "2026-11-30", date: "2026-11-30", occurrences: ["2026-11-30", "2026-12-07", "2026-12-14", "2026-12-21"],
  cancelledDates: [], rescheduledDates: [], dateCancellations: {}, attendanceLog: [] });
const combo = (paidCount, extra = {}) => ({ id: 1, total: 8, packType: "combo", sourceClassId: 50, used: 6, paid: paidCount >= 8,
  paidCount, amount: 800000, payments: paidCount ? [{ amount: paidCount * 100000, qty: paidCount, date: "2026-11-01" }] : [], date: EIGHT[0], dates: [...EIGHT], ...extra });
const comboH = () => ({ id: 2, total: 4, packType: "combo", sourceClassId: 60, used: 0, paid: true, paidCount: 4, amount: 400000, payments: [],
  date: "2026-11-30", dates: ["2026-11-30", "2026-12-07", "2026-12-14", "2026-12-21"] });
const ana = () => ({ id: ANA, name: "Ana", status: "active", combos: [combo(8), comboH()] });
const beto = () => ({ id: BETO, name: "Beto", status: "active", combos: [combo(5)] });
const AT = "2026-11-25T15:00:00.000Z";
const delFuture = (row = G()) => D.planClassDeletion({ series: row, scope: "future", fromDate: "2026-11-30", at: AT, op: "op1" });
const cards = (rows) => A.expandClasses(rows);
const countersOf = (s, rows) => A.getAccountCounters(s, cards(rows));
const at = (iso) => mock.timers.setTime(new Date(iso).getTime());

test("future deletion marks only the dates from the selected one (incl. never-held), keeps the rest; idempotent", () => {
  const r = delFuture();
  assert.equal(r.status, "deleted");
  assert.deepEqual(r.dates, ["2026-11-30", "2026-12-02", "2026-12-07", "2026-12-09"]);
  for (const d of r.dates) assert.deepEqual([r.series.dateCancellations[d].cancelType, r.series.dateCancellations[d].held], ["deleted", false]);
  assert.equal(r.series.dateCancellations["2026-11-25"], undefined, "today, before the cut: untouched");
  assert.deepEqual(r.series.attendanceLog, G().attendanceLog, "attendance untouched");
  assert.deepEqual([r.series.students, r.series.occurrences], [G().students, G().occurrences], "roster and occurrences untouched");
  assert.deepEqual(r.series.deletion, { from: "2026-11-30", at: AT, op: "op1", scope: "future" });
  assert.equal(D.planClassDeletion({ series: r.series, scope: "future", fromDate: "2026-11-30", at: "later", op: "op2" }).status, "nothing");
  assert.equal(D.planClassDeletion({ series: G(), scope: "future", fromDate: "30/11", at: AT }).status, "refused");
});

test("deleted instances never appear in the schedule (Agenda/Dashboard/portal), earlier dates stay", () => {
  const row = delFuture().series;
  const shown = A.scheduleCards(cards([row])).map((c) => c.date);
  assert.deepEqual(shown, OCC.filter((d) => d < "2026-11-30"));
  assert.ok(cards([row]).filter((c) => c.date >= "2026-11-30").every((c) => c.deletedOccurrence), "still read by Cobros, flagged");
});

test("Ana (paid 8, 6 given): counters keep 8 paid, 6 given, 2 remaining as classes in favour; the 2 rows read A Reprogramar, paid", () => {
  const before = countersOf(ana(), [G(), H()]);
  const row = delFuture().series;
  const c = countersOf(ana(), [row, H()]);
  assert.deepEqual([c.noPagadas, c.pagadas, c.realizadas, c.restantes, c.aReprogramar], [0, before.pagadas, 6, 2 + 4, 0], "H adds its own 4");
  const rows = A.buildPersonSlotRows(ana(), cards([row, H()]).filter((x) => x.students.includes(ANA)), A.TODAY_DATE).filter((r) => r.sourceClassId === 50);
  assert.equal(rows.length, 8);
  assert.deepEqual(rows.slice(6).map((r) => [r.isReprogNoDate, r.isPaid, r.isGiven]), [[true, true, false], [true, true, false]]);
});

test("Beto (paid 5, 6 given): historical debt of 1 kept, the 2 unpaid deleted classes are no debt, not remaining and no rows", () => {
  const before = countersOf(beto(), [G()]);
  assert.deepEqual([before.noPagadas, before.restantes], [3, 2]);
  const c = countersOf(beto(), [delFuture().series]);
  assert.deepEqual([c.noPagadas, c.pagadas, c.realizadas, c.restantes], [1, 5, 6, 0]);
  const rows = A.buildPersonSlotRows(beto(), cards([delFuture().series]), A.TODAY_DATE);
  assert.deepEqual(rows.map((r) => r.date), EIGHT.slice(0, 6));
  const exp = A.buildComboExportRows(beto(), combo(5), cards([delFuture().series]));
  assert.deepEqual([exp[0]["No pagadas"], exp[0].Restantes], [1, 0]);
  assert.equal(exp.find((x) => x.Estado === "Pendiente").Monto, 800000 - 500000 - 200000, "pending money without the 2 deleted classes");
});

test("internal expiry: 60 days after the last given class (18/11 -> 17/01); before it the combo stays open", () => {
  const row = delFuture().series;
  const st = D.comboDeletionOf({ cards: cards([row]), combo: combo(8), studentId: ANA, todayDate: "2027-01-16" });
  assert.deepEqual([st.expiresOn, st.expired, [...st.deleted]], ["2027-01-17", false, ["2026-11-30", "2026-12-02"]]);
  assert.equal(D.comboDeletionOf({ cards: cards([row]), combo: combo(8), studentId: ANA, todayDate: "2027-01-17" }).expired, true);
  assert.equal(A.isComboClosed(combo(8), cards([row]), ANA), false, "today (25/11): open, 2 classes in favour");
});

test("expiry closes the combo (isComboClosed) and removes the classes in favour from Restantes and the export", async () => {
  const row = delFuture().series; // deleted on 25/11
  const names = ["TODAY_DATE", "isComboClosed", "getCountedClassEntitlements", "getAccountCounters", "expandClasses",
    "resolveSlotPayments", "buildPersonSlotRows", "buildSlotHistoryRows", "getSlotFulfillmentDate", "getClassEntitlements", "interpretContractDate",
    "buildComboExportRows", "getComboExportCounters", "resolveComboClassName", "formatDateDDMMYYYY", "deletedSlotCounts", "isClassDone"];
  try {
    at("2027-01-16T12:00:00");
    const L1 = await loadAppFunctions(names);
    assert.equal(L1.isComboClosed(combo(8), L1.expandClasses([row]), ANA), false, "one day before: still open");
    assert.equal(L1.getAccountCounters({ id: ANA, name: "Ana", combos: [combo(8)] }, L1.expandClasses([row])).restantes, 2);
    at("2027-01-17T12:00:00");
    const L = await loadAppFunctions(names);
    assert.equal(L.isComboClosed(combo(8), L.expandClasses([row]), ANA), true);
    const c = L.getAccountCounters({ id: ANA, name: "Ana", combos: [combo(8)] }, L.expandClasses([row]));
    assert.equal(c.restantes, 0);
    assert.equal(L.buildComboExportRows({ id: ANA, name: "Ana" }, combo(8), L.expandClasses([row]))[0].Restantes, 0);
    const rows = L.buildPersonSlotRows({ id: ANA, name: "Ana", combos: [combo(8)] }, L.expandClasses([row]), "2027-01-17");
    assert.equal(rows.length, 8, "history kept: 6 given + 2 paid");
  } finally {
    at("2026-11-25T12:00:00");
  }
});

test("no class given: the expiry counts from the deletion", () => {
  const future = { ...combo(8), dates: ["2026-11-30", "2026-12-02", "2026-12-07", "2026-12-09"], total: 4, used: 0 };
  const row = delFuture().series;
  const st = D.comboDeletionOf({ cards: cards([row]), combo: future, studentId: ANA, todayDate: "2026-11-25" });
  assert.deepEqual([st.deleted.size, st.expiresOn], [4, "2027-01-24"]);
});

test("another class of the same student is untouched (row byte-identical, its combo reads exactly as before)", () => {
  const before = JSON.stringify(H());
  const r = delFuture();
  assert.equal(JSON.stringify(H()), before);
  const sliceH = (rows) => A.buildPersonSlotRows({ ...ana(), combos: [comboH()] }, cards(rows).filter((x) => x.students.includes(ANA)), A.TODAY_DATE);
  assert.deepEqual(sliceH([r.series, H()]), sliceH([G(), H()]));
});

test("Eliminar todas: every card hidden, past readings unchanged (held), future ones in favour / no charge", () => {
  const r = D.planClassDeletion({ series: G(), scope: "all", at: AT, op: "op3" });
  assert.equal(r.series.deletion.from, "");
  assert.ok(EIGHT.slice(0, 6).every((d) => r.series.dateCancellations[d].held === true));
  assert.equal(A.scheduleCards(cards([r.series])).length, 0);
  const c = countersOf({ ...ana(), combos: [combo(8)] }, [r.series]);
  assert.deepEqual([c.pagadas, c.realizadas, c.restantes], [8, 6, 2]);
  const b = countersOf(beto(), [r.series]);
  assert.deepEqual([b.noPagadas, b.realizadas, b.restantes], [1, 6, 0]);
});

test("a held date keeps its previous pause/cancellation reading; a reprogramming into the deleted range is hidden and in favour", () => {
  const row = { ...G(), dateCancellations: { "2026-11-16": { cancelType: "cancelled_reprog", rescheduledTo: "2026-11-30" } },
    attendanceLog: G().attendanceLog.filter((e) => e.date !== "2026-11-16") };
  const r = delFuture(row).series;
  const shown = A.scheduleCards(cards([r])).map((c) => c.date);
  assert.ok(!shown.includes("2026-11-16") && !shown.includes("2026-11-30"), "origin whose destination is deleted is hidden too");
  const slot = A.interpretContractDate(r.dateCancellations, "2026-11-16");
  assert.deepEqual([slot.terminalStatus, slot.isDeleted], ["pending", true]);
  const pausedRow = { ...G(), dateCancellations: { "2026-11-18": { cancelType: "paused", rescheduledTo: null } } };
  const all = D.planClassDeletion({ series: pausedRow, scope: "all", at: AT }).series;
  assert.deepEqual(normalizeDeletedDates(all.dateCancellations)["2026-11-18"], { cancelType: "paused", rescheduledTo: null });
});

test("deleted dates never reappear: dates a pause or resume adds after the cut are deleted too", () => {
  const row = delFuture().series;
  const added = markAddedDatesDeleted(row, row.dateCancellations, ["2026-12-14", "2026-11-26"]);
  assert.equal(added["2026-12-14"].cancelType, "deleted");
  assert.equal(added["2026-11-26"], undefined, "before the cut: untouched");
  const plain = G().dateCancellations;
  assert.equal(markAddedDatesDeleted(G(), plain, ["2026-12-14"]), plain, "never deleted: same object, nothing added");
  const resumed = A.applyResumeToClassRow({ c: row, cd: { _newOccurrenceDates: ["2026-12-14"] }, realId: 50, editDate: "2026-11-23", dc: row.dateCancellations, occ: row.occurrences, plannedResume: undefined });
  assert.ok(resumed.occurrences.includes("2026-12-14"));
  assert.ok(!A.scheduleCards(cards([resumed])).some((c) => c.date === "2026-12-14"), "resume replacement stays hidden");
  assert.match(SRC, /if\(_replacements\.length>0\) Object\.assign\(dc,markAddedDatesDeleted\(c,dc,_replacements\)\);/, "pause replacements guarded");
});

test("a student who comes back starts a new combo: the old one is over once its class was deleted", () => {
  const row = delFuture().series;
  assert.equal(D.comboEndedByDeletion({ cards: cards([G()]), combo: combo(8), studentId: ANA }), false, "before: still active");
  assert.equal(D.comboEndedByDeletion({ cards: cards([row]), combo: combo(8), studentId: ANA }), true);
  assert.equal(D.comboEndedByDeletion({ cards: cards([row]), combo: { ...combo(8), packType: "mensual" }, studentId: ANA }), false);
  assert.match(SRC, /const lastComboFullyUsed=endedByDeletion\|\|/);
  assert.match(SRC, /const hasActiveCombo=!endedByDeletion&&lastCombo&&\(/);
});

test("wiring: one classes write only (no students/expenses), approved modal, edit screen deletes safely, unpaid deleted slots not payable", () => {
  const hs = SRC.indexOf("  const handleDeleteClass=({seriesId,scope,fromDate})=>{");
  const h = SRC.slice(hs, SRC.indexOf("\n  };", hs));
  assert.ok(h.length > 0 && h.includes("setClasses(") && !h.includes("setStudents(") && !h.includes("setExpenses("));
  assert.ok(!SRC.includes("Remove expenses related to this class's students"), "old destructive handler gone");
  assert.match(SRC, /Todas las instancias o instancias futuras de <strong>\{confirmDelete\.title\}<\/strong> serán eliminadas del calendario\. Esta acción no se puede deshacer\./);
  assert.match(SRC, />Eliminar todas las instancias<\/button>/);
  assert.match(SRC, />Eliminar las instancias futuras<\/button>/);
  assert.match(SRC, /scope:"future",fromDate:confirmDelete\.date/);
  assert.match(SRC, /onDeleteClass&&onDeleteClass\(\{seriesId:realId,scope:"all"\}\)/);
  assert.match(SRC, /if\(slot\.isDeleted&&!isPaidDate\) return;/);
  assert.match(SRC, /classes=\{scheduleCards\(xClasses\)\}/);
});
