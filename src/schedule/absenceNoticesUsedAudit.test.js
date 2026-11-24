import { test, mock } from "node:test";
import assert from "node:assert/strict";

// Stage 2.1 final audit — no double counting between stored `used`, explicit attendance and advance notices.
// The attendance recount is the formula handleAttendance writes: countUsedForCombo(...) + dueDadaNoticeCount(...).
// Synthetic data only. "Today" = Thu 15/10/2026 12:00.
mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-15T12:00:00").getTime() });
const S = await import("./slotStatus.js");
const { countUsedForCombo } = await import("./slotMoves.js");
const { loadAppFunctions } = await import("../test/loadAppFunctions.js");
const A = await loadAppFunctions([
  "TODAY_DATE", "isClassDone", "interpretContractDate", "resolveSlotPayments", "buildSlotHistoryRows", "buildPersonSlotRows",
  "getSlotFulfillmentDate", "isComboClosed", "getClassEntitlements", "getCountedClassEntitlements", "getAccountCounters",
  "getEffectiveTotal", "getClaseRem", "expandClasses", "getComboExportCounters", "resolveComboClassName", "formatDateDDMMYYYY", "buildComboExportRows", "deletedSlotCounts",
]);

const J = "juan", P = "pedro";
const EIGHT = ["2026-10-05", "2026-10-07", "2026-10-12", "2026-10-14", "2026-10-19", "2026-10-21", "2026-10-26", "2026-10-28"];
const entry = (date, present = [], ausente_dada = [], ausente_reprog = []) => ({ date, day: "x", present, ausente_dada, ausente_reprog });
const notice = (status) => ({ status, at: "2026-10-04T10:00:00Z", history: [{ status, at: "2026-10-04T10:00:00Z" }] });
const MIXED = { "2026-10-07": { [J]: notice("ausente_dada") }, "2026-10-12": { [J]: notice("ausente_reprog") }, "2026-10-19": { [J]: notice("ausente_dada") }, "2026-10-21": { [J]: notice("ausente_reprog") } };
const group = (log, notices = MIXED, extra = {}) => ({ id: 10, title: "Grupo", days: ["Lun", "Mié"], time: "18:00", timeEnd: "19:00", students: [J, P], startDate: EIGHT[0], date: EIGHT[0],
  occurrences: [...EIGHT, "2026-11-02"], cancelledDates: [], rescheduledDates: [], dateCancellations: {}, attendanceLog: log, attendanceNotices: notices, ...extra });
const combo = (extra = {}) => ({ id: 1, total: 8, packType: "combo", sourceClassId: 10, used: 0, paid: false, paidCount: 0, amount: 400000, payments: [], dates: [...EIGHT], ...extra });
const BASE_LOG = [entry("2026-10-05", [J, P]), entry("2026-10-07", [P]), entry("2026-10-12", [P]), entry("2026-10-14", [J, P])];
const recount = (c, classes, sid = J) => countUsedForCombo({ combo: c, studentId: sid, dc: classes[0].dateCancellations, attendanceLog: classes[0].attendanceLog, baseClassId: 10, classes }) + S.dueDadaNoticeCount({ combo: c, studentId: sid, classes });
const counters = (c, classes, sid = J) => A.getAccountCounters({ id: sid, name: sid, combos: [c] }, A.expandClasses(classes));

test("several Dada and No dada notices on different dates: only due Dada notices consume, each once", () => {
  const classes = [group(BASE_LOG)];
  assert.equal(S.dueDadaNoticeCount({ combo: combo(), studentId: J, classes }), 1, "07 (Dada, past); 12 No dada never; 19 Dada not yet; 21 No dada never");
  assert.equal(recount(combo(), classes), 3, "05 + 14 explicit + 07 notice");
  const c = counters(combo(), classes);
  assert.deepEqual([c.realizadas, c.restantes], [3, 5]);
  assert.equal(S.effectiveComboUsed({ combo: combo(), studentId: J, classes: A.expandClasses(classes) }), 3);
  assert.equal(A.buildComboExportRows({ id: J, name: "Juan" }, combo(), A.expandClasses(classes))[0].Restantes, 5);
  mock.timers.setTime(new Date("2026-10-21T19:45:00").getTime());
  assert.equal(S.dueDadaNoticeCount({ combo: combo(), studentId: J, classes }), 2, "after 19/10 and 21/10: 19 Dada now due, 21 No dada still never");
  mock.timers.setTime(new Date("2026-10-15T12:00:00").getTime());
});

test("a Dada notice already included in the stored used is not counted again (recount is idempotent)", () => {
  const classes = [group(BASE_LOG)];
  const first = recount(combo(), classes);
  const stored = combo({ used: first });
  assert.equal(recount(stored, classes), first, "recount derives from attendance + notices, never from the stored value");
  assert.equal(S.effectiveComboUsed({ combo: stored, studentId: J, classes }), first, "max(stored, explicit + due), not a sum");
  assert.equal(A.buildComboExportRows({ id: J, name: "Juan" }, stored, A.expandClasses(classes))[0].Restantes, 8 - first);
});

test("attendance recorded after the notice decides; the notice no longer counts", () => {
  const variants = [
    { log: [...BASE_LOG.filter((e) => e.date !== "2026-10-07"), entry("2026-10-07", [J, P])], used: 3, label: "came after all: Presente" },
    { log: [...BASE_LOG.filter((e) => e.date !== "2026-10-07"), entry("2026-10-07", [P], [J])], used: 3, label: "confirmed Ausente – Dada" },
    { log: [...BASE_LOG.filter((e) => e.date !== "2026-10-07"), entry("2026-10-07", [P], [], [J])], used: 2, label: "corrected to Ausente – No dada" },
  ];
  for (const v of variants) {
    const classes = [group(v.log)];
    assert.equal(S.dueDadaNoticeCount({ combo: combo(), studentId: J, classes }), 0, v.label + ": notice not counted");
    assert.equal(recount(combo({ used: 3 }), classes), v.used, v.label);
    assert.equal(counters(combo(), classes).realizadas, v.used, v.label + ": realizadas agree");
  }
});

test("reprogrammed and fused dates: a notice counts only on the slot's live terminal, once", () => {
  // slot 12/10 reprogrammed to Tue 13/10: a Dada notice on the origin is history; one on the destination counts
  const dc = { "2026-10-12": { cancelType: "cancelled_reprog", rescheduledTo: "2026-10-13" } };
  const onOrigin = [group(BASE_LOG.filter((e) => e.date !== "2026-10-12"), { "2026-10-12": { [J]: notice("ausente_dada") } }, { dateCancellations: dc })];
  const onDest = [group(BASE_LOG.filter((e) => e.date !== "2026-10-12"), { "2026-10-13": { [J]: notice("ausente_dada") } }, { dateCancellations: dc })];
  assert.equal(S.dueDadaNoticeCount({ combo: combo(), studentId: J, classes: onOrigin }), 0);
  assert.equal(S.dueDadaNoticeCount({ combo: combo(), studentId: J, classes: onDest }), 1);
  // two slots ending on one terminal (fused): the notice counts once, like explicit attendance does
  const fusedDc = { "2026-10-05": { cancelType: "cancelled_reprog", rescheduledTo: "2026-10-07" } };
  const fused = [group([], { "2026-10-07": { [J]: notice("ausente_dada") } }, { dateCancellations: fusedDc })];
  assert.equal(S.dueDadaNoticeCount({ combo: combo(), studentId: J, classes: fused }), 1);
  const fusedExplicit = [group([entry("2026-10-07", [], [J])], {}, { dateCancellations: fusedDc })];
  assert.equal(countUsedForCombo({ combo: combo(), studentId: J, dc: fusedDc, attendanceLog: fusedExplicit[0].attendanceLog, baseClassId: 10, classes: fusedExplicit }), 1);
});

test("No dada notices never consume, before or long after the class; Pedro is never affected", () => {
  const onlyNoDada = { "2026-10-07": { [J]: notice("ausente_reprog") }, "2026-10-12": { [J]: notice("ausente_reprog") } };
  const classes = [group([entry("2026-10-05", [J, P]), entry("2026-10-14", [J, P])], onlyNoDada)];
  mock.timers.setTime(new Date("2026-12-31T23:00:00").getTime());
  assert.equal(S.dueDadaNoticeCount({ combo: combo(), studentId: J, classes }), 0);
  mock.timers.setTime(new Date("2026-10-15T12:00:00").getTime());
  const x = A.expandClasses(classes);
  const rows = A.buildPersonSlotRows({ id: J, combos: [combo()] }, x, A.TODAY_DATE, x);
  assert.equal(rows.filter((r) => ["2026-10-07", "2026-10-12"].includes(r.date)).some((r) => r.isGiven), false);
  // Pedro: identical with or without any of Juan's notices, in every reading
  const pedro = combo({ used: 4 });
  for (const n of [MIXED, onlyNoDada]) {
    const withJ = [group(BASE_LOG, n)], without = [group(BASE_LOG, {})];
    assert.equal(recount(pedro, withJ, P), recount(pedro, without, P));
    assert.equal(S.effectiveComboUsed({ combo: pedro, studentId: P, classes: withJ }), 4);
    assert.deepEqual(counters(pedro, withJ, P), counters(pedro, without, P));
    assert.deepEqual(A.buildComboExportRows({ id: P, name: "Pedro" }, pedro, A.expandClasses(withJ)), A.buildComboExportRows({ id: P, name: "Pedro" }, pedro, A.expandClasses(without)));
  }
});
