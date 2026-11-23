import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Stage 2.0 follow-up — (1) Cobros / Mis Clases rows are per combo and date (no longer merged by date across
// combos) and every consumer picks the row of its own class; (2) the paused-dates extension reads the combo's own
// class. Synthetic data only. "Today" = Thu 15/10/2026.
mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-15T12:00:00").getTime() });
const { loadAppFunctions } = await import("../test/loadAppFunctions.js");
const A = await loadAppFunctions([
  "TODAY_DATE", "isClassDone", "interpretContractDate", "resolveSlotPayments", "buildSlotHistoryRows", "buildPersonSlotRows",
  "getSlotFulfillmentDate", "isComboClosed", "getClassEntitlements", "getCountedClassEntitlements", "getAccountCounters",
  "getEffectiveTotal", "getClaseRem", "expandClasses", "resolveAgendaCardStatus", "slotReadingsOf", "sameSlotReadings",
]);

const SOFI = "sofi";
const entry = (date, present = [], ausente_dada = [], ausente_reprog = []) => ({ date, day: "x", present, ausente_dada, ausente_reprog });
const base = { cancelledDates: [], rescheduledDates: [], dateCancellations: {}, students: [SOFI], startDate: "2026-10-05", date: "2026-10-05" };
const MONDAYS = ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"];
const MON_WED = ["2026-10-05", "2026-10-07", "2026-10-12", "2026-10-14", "2026-10-19", "2026-10-21", "2026-10-26", "2026-10-28", "2026-11-02", "2026-11-04"];
const morning = (extra = {}) => ({ ...base, id: 1, title: "Mañana", days: ["Lun"], time: "09:00", timeEnd: "10:00", occurrences: MONDAYS, attendanceLog: [entry("2026-10-05", [SOFI])], ...extra });
const evening = (extra = {}) => ({ ...base, id: 2, title: "Tarde", days: ["Lun", "Mié"], time: "18:00", timeEnd: "19:00", occurrences: MON_WED,
  attendanceLog: [entry("2026-10-05", [], [], [SOFI]), entry("2026-10-07", [SOFI])], ...extra });
const combo = (id, sourceClassId, dates, extra = {}) => ({ id, total: dates.length, packType: "combo", sourceClassId, used: 0, paid: false, paidCount: 0, amount: 0, payments: [], date: dates[0], dates, ...extra });
const PAID = (n) => ({ paid: true, paidCount: n, payments: [{ id: 9, qty: n, amount: 0, dates: [] }] });

test("(1) a shared date keeps one row per combo, each with its own reading and identity", () => {
  const s = { id: SOFI, name: "Sofi", combos: [combo(1, 1, MONDAYS.slice(0, 4), PAID(4)), combo(2, 2, MON_WED.slice(0, 4))] };
  const x = A.expandClasses([morning(), evening()]);
  const rows = A.buildPersonSlotRows(s, x.filter((c) => c.students.includes(SOFI)), A.TODAY_DATE, x);
  const monday = rows.filter((r) => r.date === "2026-10-05");
  assert.deepEqual(monday.map((r) => [r.comboIndex, r.sourceClassId, r.isGiven, r.displayPaid]), [[0, 1, true, true], [1, 2, false, false]]);
  assert.equal(rows.length, 8, "4 + 4 slots, nothing merged");
  // a combo that repeats a date in its own dates[] still reads once (unchanged)
  const dup = { id: SOFI, name: "Sofi", combos: [combo(2, 2, ["2026-10-05", "2026-10-05", "2026-10-07"])] };
  assert.equal(A.buildPersonSlotRows(dup, x.filter((c) => c.students.includes(SOFI)), A.TODAY_DATE, x).length, 2);
});

test("(1) Agenda payment chip of a card reads the row of that card's class, never another class's row on that date", () => {
  // evening combo unpaid with a resume replacement on Mon 19/10; morning combo fully paid also has 19/10
  const ev = combo(2, 2, [...MON_WED.slice(0, 4), "2026-10-19"], { total: 4, resumeOperations: [{ id: "op", pausedDates: ["2026-10-14"], replacementDates: ["2026-10-19"] }] });
  const s = { id: SOFI, name: "Sofi", combos: [combo(1, 1, MONDAYS.slice(0, 4), PAID(4)), ev] };
  const ec = evening({ dateCancellations: { "2026-10-14": { cancelType: "paused", rescheduledTo: null, compensated: true, compensatedBy: "op" } } });
  const x = A.expandClasses([morning(), ec]);
  const card = x.find((c) => c.id === 2 && c.date === "2026-10-19");
  assert.equal(A.resolveAgendaCardStatus(card, [s], x, A.TODAY_DATE).payment, null, "evening replacement slot is unpaid");
  const mcard = x.find((c) => c.id === 1 && c.date === "2026-10-19");
  assert.equal(A.resolveAgendaCardStatus(mcard, [s], x, A.TODAY_DATE).payment, null, "the morning live card is not a replacement: the evening resume belongs to another class");
});

test("(1) release readings compare per combo and date (two combos on one date no longer read as a payment shift)", () => {
  const s = { id: SOFI, name: "Sofi", combos: [combo(1, 1, MONDAYS.slice(0, 4), PAID(4)), combo(2, 2, MON_WED.slice(0, 4))] };
  const raw = [morning(), evening()];
  const before = A.slotReadingsOf(s, raw, A.TODAY_DATE);
  assert.equal(before.filter((r) => r.date === "2026-10-05").length, 2);
  assert.equal(A.sameSlotReadings(before, A.slotReadingsOf(s, raw, A.TODAY_DATE), "none", "none"), true);
  const changed = A.slotReadingsOf({ ...s, combos: [s.combos[0], { ...s.combos[1], ...PAID(1) }] }, raw, A.TODAY_DATE);
  assert.equal(A.sameSlotReadings(before, changed, "none", "none"), false, "a real change in the evening combo is still detected");
});

test("(2) another class paused on the same date never extends (or blocks) this combo", () => {
  // Sofi is in the morning roster without a combo there; only the evening combo counts
  const s = { id: SOFI, name: "Sofi", combos: [combo(2, 2, MON_WED.slice(0, 4))] };
  const calm = A.getAccountCounters(s, A.expandClasses([morning(), evening()]));
  const pausedMorning = A.getAccountCounters(s, A.expandClasses([morning({ dateCancellations: { "2026-10-12": { cancelType: "paused", rescheduledTo: null } } }), evening()]));
  assert.deepEqual(pausedMorning, calm, "a morning pause on Mon 12/10 does not touch the evening combo");
  // its own pause still extends it, as before
  const pausedEvening = A.getAccountCounters(s, A.expandClasses([morning(), evening({ dateCancellations: { "2026-10-12": { cancelType: "paused", rescheduledTo: null } } })]));
  assert.equal(pausedEvening.pausadas, 1);
  assert.equal(pausedEvening.noPagadas, calm.noPagadas, "unpaid count kept by the extension (one more date, one paused)");
});

test("wiring: rows carry their combo, Mis Clases lists its own class rows, pause lookups by class", () => {
  const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  assert.match(app, /return rows\.filter\(d=>\{const k=d\.comboIndex\+"\|"\+d\.date;if\(seen2\.has\(k\)\)return false;seen2\.add\(k\);return true;\}\);/);
  assert.match(app, /const ofCard=r=>r\.sourceClassId===undefined\|\|String\(r\.sourceClassId\)===String\(cardSeries\);/);
  assert.match(app, /const isReplacement=isLiveCard&&\(st\.combos\|\|\[\]\)\.some\(c=>ofCard\(c\)&&/);
  assert.match(app, /const deduped=buildPersonSlotRows\(person,personClasses,TODAY_DATE\)\.filter\(r=>r\.sourceClassId===undefined\|\|cardSeriesIds\.has\(String\(r\.sourceClassId\)\)\);/);
  assert.match(app, /const expected=new Map\(before\.map\(r=>\[r\.comboIndex\+"\|"\+\(r\.date===date\?destination:r\.date\),key\(r\)\]\)\);/);
  assert.match(app, /const _pc2=c\.sourceClassId!==undefined\?myClasses\.find\(cl=>String\(cl\._seriesId!==undefined\?cl\._seriesId:cl\.id\)===String\(c\.sourceClassId\)\):/);
});
