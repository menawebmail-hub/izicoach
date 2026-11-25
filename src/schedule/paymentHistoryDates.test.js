import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Punto 2 — Historial de Pagos / Compartir effective dates (A), Detalles de Pagos counters of a closed combo (B) and the
// final-date badges of a reprogrammed class (C). Synthetic data modelled on the Pato case: combo 8 paid on 28/10, class
// 4 (Wed 04/11) reprogrammed to Mon 23/11. "Today" = Tue 24/11/2026 09:40.
mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-24T09:40:00").getTime() });
const { loadAppFunctions } = await import("../test/loadAppFunctions.js");
const { slotRowBadges } = await import("../components/slotRowBadges.js");
const A = await loadAppFunctions([
  "TODAY_DATE", "isClassDone", "interpretContractDate", "resolveSlotPayments", "buildSlotHistoryRows", "buildPersonSlotRows",
  "getSlotFulfillmentDate", "isComboClosed", "getClassEntitlements", "getCountedClassEntitlements", "getVisibleClassEntitlements",
  "getAccountCounters", "expandClasses", "buildStudentPaymentHistory", "buildMensualHistoryEvents", "mensualPeriodLabel", "paymentDateChains", "effectivePaymentDates",
]);
const SRC = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");

const P = "pato";
const D = ["2026-10-26", "2026-10-28", "2026-11-02", "2026-11-04", "2026-11-09", "2026-11-11", "2026-11-16", "2026-11-18"];
const entry = (date) => ({ date, day: "x", present: [P], ausente_dada: [], ausente_reprog: [] });
const klass = (dc, extra = {}) => ({ id: 7, title: "Pato", days: ["Lun", "Mié"], time: "18:00", timeEnd: "19:00", students: [P], startDate: D[0], date: D[0],
  occurrences: [...D, "2026-11-23", "2026-11-25", "2026-11-30"], cancelledDates: [], rescheduledDates: [], dateCancellations: dc,
  attendanceLog: D.filter((d) => !dc[d]).map(entry), ...extra });
const REPROG = { "2026-11-04": { cancelType: "cancelled_reprog", rescheduledTo: "2026-11-23" } };
const combo = (extra = {}) => ({ id: 1, total: 8, packType: "combo", sourceClassId: 7, used: 8, paid: true, paidCount: 8, amount: 960000, date: D[0], dates: [...D],
  payments: [{ id: 11, date: "2026-10-28", amount: 960000, qty: 8, method: "efectivo", dates: [...D] }], ...extra });
const student = (c = combo()) => ({ id: P, name: "Pato", combos: [c] });
const cards = (rows) => A.expandClasses(rows);
const history = (s) => A.buildStudentPaymentHistory(s, []);

test("A: Historial shows the effective date of the reprogrammed class (04/11 -> 23/11); the stored payment is unchanged", () => {
  const s = student();
  const h = history(s);
  assert.deepEqual(h[0].dates, D, "history entry still carries the stored dates");
  assert.equal(h[0].comboIndex, 0);
  const shown = A.effectivePaymentDates(s, h[0], cards([klass(REPROG)]));
  assert.deepEqual(shown, ["2026-10-26", "2026-10-28", "2026-11-02", "2026-11-23", "2026-11-09", "2026-11-11", "2026-11-16", "2026-11-18"]);
  assert.deepEqual(s.combos[0].payments[0].dates, D, "payment data never modified");
  assert.deepEqual([h[0].date, h[0].amount, h[0].method, h[0].qty], ["2026-10-28", 960000, "efectivo", 8]);
});

test("A: a reprogramming chain shows its final date; 'A Reprogramar' without date and untouched dates keep the original", () => {
  const chain = { "2026-11-04": { cancelType: "cancelled_reprog", rescheduledTo: "2026-11-23" }, "2026-11-23": { cancelType: "cancelled_reprog", rescheduledTo: "2026-11-30" },
    "2026-11-09": { cancelType: "cancelled_reprog", rescheduledTo: null } };
  const s = student();
  const shown = A.effectivePaymentDates(s, history(s)[0], cards([klass(chain)]));
  assert.equal(shown[3], "2026-11-30", "04/11 -> 23/11 -> 30/11");
  assert.equal(shown[4], "2026-11-09", "pending without date keeps the original");
  assert.equal(shown[0], "2026-10-26");
});

test("A: archived combos and a class that no longer lists the student still read their effective dates; mensual untouched", () => {
  const archived = student(combo({ archived: true }));
  assert.equal(A.effectivePaymentDates(archived, history(archived)[0], cards([klass(REPROG)]))[3], "2026-11-23");
  const left = student();
  assert.equal(A.effectivePaymentDates(left, history(left)[0], cards([klass(REPROG, { students: [] })]))[3], "2026-11-23", "found by sourceClassId");
  const noClass = student();
  assert.deepEqual(A.effectivePaymentDates(noClass, history(noClass)[0], []), D, "no class data: stored dates");
  assert.deepEqual(A.effectivePaymentDates(student(), { dates: ["2026-11-04"] }, cards([klass(REPROG)])), ["2026-11-04"], "no combo link: as stored");
});

test("A: each paid class keeps its stored date plus, when reprogrammed, its whole path (shown like Detalles)", () => {
  const s = student();
  const chains = A.paymentDateChains(s, history(s)[0], cards([klass(REPROG)]));
  assert.deepEqual(chains[3], ["2026-11-04", "2026-11-23"]);
  assert.deepEqual(chains.filter((c) => c.length > 1).length, 1, "only the reprogrammed class has a chain");
  const chain = { "2026-11-04": { cancelType: "cancelled_reprog", rescheduledTo: "2026-11-23" }, "2026-11-23": { cancelType: "cancelled_reprog", rescheduledTo: "2026-11-30" } };
  assert.deepEqual(A.paymentDateChains(s, history(s)[0], cards([klass(chain)]))[3], ["2026-11-04", "2026-11-23", "2026-11-30"]);
  assert.deepEqual(history(s)[0].dates, D, "stored dates unchanged");
});

test("A wiring: the panel and Compartir (preview and image) use the same chains; the stored dates stay", () => {
  assert.match(SRC, /const p=\{\.\.\.selected,dateChains:paymentDateChains\(s,selected,classes\)\};/);
  assert.match(SRC, /const chains=dates\.map\(\(ds,i\)=>\(p\.dateChains&&p\.dateChains\[i\]\)\|\|\[ds\]\);/, "share image draws the chains");
  assert.match(SRC, /setShowComprobante\(\{\.\.\.p,studentName:s\.name\}\)/);
  assert.match(SRC, /const dates=p\.dates\|\|\[\];/, "share canvas reads the comprobante's dates");
});

test("B: Detalles de Pagos counts a closed, not archived combo (8 / 8 / 0); Cobros keeps excluding it", () => {
  const s = student();
  const cs = cards([klass(REPROG)]);
  assert.equal(A.isComboClosed(s.combos[0], cs, P), true);
  const cobros = A.getAccountCounters(s, cs);
  assert.deepEqual([cobros.noPagadas, cobros.pagadas, cobros.realizadas, cobros.restantes], [0, 0, 0, 0], "Cobros unchanged");
  const det = A.getAccountCounters(s, cs, { closedVisibleFallback: true });
  assert.deepEqual([det.noPagadas, det.pagadas, det.realizadas, det.restantes], [0, 8, 8, 0]);
});

test("B: with an open combo the Detalles counters are exactly the Cobros ones (closed combos never added)", () => {
  const open = combo({ id: 2, paid: false, paidCount: 2, used: 0, dates: ["2026-11-25", "2026-11-30", "2026-12-02", "2026-12-07"], total: 4, payments: [] });
  const s = { id: P, name: "Pato", combos: [combo(), open] };
  const cs = cards([klass(REPROG, { occurrences: [...D, "2026-11-23", "2026-11-25", "2026-11-30", "2026-12-02", "2026-12-07"] })]);
  assert.deepEqual(A.getAccountCounters(s, cs, { closedVisibleFallback: true }), A.getAccountCounters(s, cs));
  assert.equal(A.getAccountCounters(s, cs).pagadas, 2);
});

test("C: the reprogrammed class reads Reprogramada on 04/11 and Realizada + Pagada on 23/11 in Detalles", () => {
  const s = student();
  const rows = A.buildPersonSlotRows(s, cards([klass(REPROG)]), A.TODAY_DATE);
  const slot4 = rows.find((r) => r.date === "2026-11-04");
  const [orig, fin] = slot4.historyRows;
  assert.deepEqual([orig.status, orig.isTerminal, fin.date, fin.status, fin.isTerminal, fin.isPaid], ["reprogrammed", false, "2026-11-23", "done", true, true]);
  const det = (h) => slotRowBadges({ rescheduled: true, isTerminal: h.isTerminal, status: h.status, paid: h.isPaid, showFinalState: true });
  assert.deepEqual(det(orig), { state: true, payment: false });
  assert.deepEqual(det(fin), { state: true, payment: true });
});

test("C: a final date still ahead reads Programada (+ its payment), never Realizada", () => {
  const future = { "2026-11-04": { cancelType: "cancelled_reprog", rescheduledTo: "2026-11-30" } };
  const rows = A.buildPersonSlotRows(student(), cards([klass(future)]), A.TODAY_DATE);
  const fin = rows.find((r) => r.date === "2026-11-04").historyRows.at(-1);
  assert.deepEqual([fin.date, fin.status, fin.isPaid], ["2026-11-30", "scheduled", true]);
});
