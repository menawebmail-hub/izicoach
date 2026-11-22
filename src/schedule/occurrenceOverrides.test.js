import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// BUG-AGENDA-05 stage 2.2 — time and court of ONE occurrence. Synthetic data only.
// "Today" = Tue 20/10/2026 17:40 (the series ends 17:00 + 30 min margin; the moved class ends 18:00 + margin).
mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-20T17:40:00").getTime() });
const O = await import("./occurrenceOverrides.js");
const S = await import("./slotStatus.js");
const CE = await import("./classEditScope.js");
const { loadAppFunctions } = await import("../test/loadAppFunctions.js");
const A = await loadAppFunctions([
  "TODAY_DATE", "isClassDone", "interpretContractDate", "resolveSlotPayments", "buildSlotHistoryRows", "buildPersonSlotRows",
  "getSlotFulfillmentDate", "isComboClosed", "getClassEntitlements", "getCountedClassEntitlements", "getAccountCounters",
  "getEffectiveTotal", "getClaseRem", "expandClasses", "applyResumeToClassRow",
]);

const J = "juan";
const TUESDAYS = ["2026-10-06", "2026-10-13", "2026-10-20", "2026-10-27", "2026-11-03"];
const tue = (extra = {}) => ({ id: 30, title: "Martes", days: ["Mar"], time: "16:00", timeEnd: "17:00", court: "Cancha 2", students: [J], startDate: TUESDAYS[0], date: TUESDAYS[0],
  occurrences: TUESDAYS, cancelledDates: [], rescheduledDates: [], dateCancellations: {}, attendanceLog: [], ...extra });
const combo = (extra = {}) => ({ id: 1, total: 5, packType: "combo", sourceClassId: 30, used: 0, paid: false, paidCount: 0, amount: 0, payments: [], dates: [...TUESDAYS], ...extra });
const MOVE = { time: "17:00", timeEnd: "18:00", court: "Cancha 4" };
const withOverride = (row, date = "2026-10-20", edited = MOVE) => O.applyOverrideToClassRow(row, { date, values: O.overrideValuesFrom(row, { ...row, ...edited }), at: "2026-10-19T10:00:00Z" });
const card = (rows, date, id = 30) => A.expandClasses(rows).find((c) => c.date === date && (c._seriesId ?? c.id) === id);

test("Tuesday 20/10 moves to 17:00–18:00 on Cancha 4; every other Tuesday and the series keep 16:00–17:00 Cancha 2", () => {
  const base = tue();
  assert.equal(O.overrideRefusal({ row: base, date: "2026-10-20", values: O.overrideValuesFrom(base, { ...base, ...MOVE }) }), null);
  const row = withOverride(base);
  assert.deepEqual([row.time, row.timeEnd, row.court], ["16:00", "17:00", "Cancha 2"], "series unchanged");
  const moved = card([row], "2026-10-20");
  assert.deepEqual([moved.time, moved.timeEnd, moved.court, moved.occurrenceOverride], ["17:00", "18:00", "Cancha 4", true]);
  assert.deepEqual(moved.seriesValues, { time: "16:00", timeEnd: "17:00", court: "Cancha 2" });
  for (const d of TUESDAYS.filter((x) => x !== "2026-10-20")) {
    const c = card([row], d);
    assert.deepEqual([c.time, c.timeEnd, c.court, "occurrenceOverride" in c], ["16:00", "17:00", "Cancha 2", false], d);
  }
  assert.deepEqual(row.occurrenceOverrides["2026-10-20"].history.length, 1);
});

test("Cobros reads the occurrence's own end time (counters, given, history)", () => {
  const plain = [tue()], moved = [withOverride(tue())];
  const s = { id: J, name: "Juan", combos: [combo()] };
  // 17:40: the series class (ends 17:00) is done; the moved one (ends 18:00) is not yet
  const r = (rows) => A.buildPersonSlotRows(s, A.expandClasses(rows), A.TODAY_DATE, A.expandClasses(rows)).find((x) => x.date === "2026-10-20");
  assert.equal(r(plain).isGiven, true);
  assert.equal(r(moved).isGiven, false);
  assert.equal(A.getAccountCounters(s, A.expandClasses(plain)).realizadas - A.getAccountCounters(s, A.expandClasses(moved)).realizadas, 1);
  const x = A.expandClasses(moved);
  assert.equal(S.createSlotReader({ classes: x, combo: s.combos[0], studentId: J }).timeEndFor("2026-10-20"), "18:00");
  assert.equal(O.effectiveTimeEnd(moved[0], "2026-10-20"), "18:00");
  assert.equal(O.effectiveTimeEnd(x.find((c) => c.date === "2026-10-20"), "2026-10-27"), "17:00", "another date from an overridden card: the series end");
  // a due Ausente – Dada notice uses that date's end time too
  const notice = { "2026-10-20": { [J]: { status: "ausente_dada", at: "x", history: [] } } };
  assert.equal(S.dueDadaNoticeCount({ combo: combo(), studentId: J, classes: [{ ...moved[0], attendanceNotices: notice }] }), 0, "18:00 not passed");
  assert.equal(S.dueDadaNoticeCount({ combo: combo(), studentId: J, classes: [{ ...plain[0], attendanceNotices: notice }] }), 1);
});

test("restoring the series values clears the date (history kept); same values are a no-op", () => {
  const row = withOverride(tue());
  const restored = withOverride(row, "2026-10-20", { time: "16:00", timeEnd: "17:00", court: "Cancha 2" });
  assert.equal(O.activeOverrideOf(restored, "2026-10-20"), null);
  assert.equal(restored.occurrenceOverrides["2026-10-20"].history.length, 2);
  const c = card([restored], "2026-10-20");
  assert.deepEqual([c.time, c.timeEnd, c.court, "occurrenceOverride" in c], ["16:00", "17:00", "Cancha 2", false]);
  assert.equal(withOverride(row), row, "same values again: unchanged object");
  // only the court
  const courtOnly = withOverride(tue(), "2026-10-27", { court: "Cancha 5" });
  assert.deepEqual(courtOnly.occurrenceOverrides["2026-10-27"], { time: null, timeEnd: null, court: "Cancha 5", at: "2026-10-19T10:00:00Z", history: [{ time: null, timeEnd: null, court: "Cancha 5", at: "2026-10-19T10:00:00Z" }] });
});

test("Reprogramar to another date and time: the destination gets that time; the origin's own values never travel", () => {
  assert.deepEqual(O.reprogDestinationValues(tue(), "19:00"), { time: "19:00", timeEnd: "20:00", court: null });
  assert.equal(O.reprogDestinationValues(tue(), "16:00"), null, "series time: nothing stored (previous behaviour)");
  assert.equal(O.reprogDestinationValues(tue(), "23:30"), null, "would end after midnight: not stored (never start > end)");
  assert.equal(O.shiftedTimeEnd(tue(), "23:30"), null, "would end after midnight");
  // origin 20/10 has its own time; reprogrammed to Fri 23/10 at 19:00
  let row = withOverride(tue());
  row = { ...row, dateCancellations: { "2026-10-20": { cancelType: "cancelled_reprog", rescheduledTo: "2026-10-23" } } };
  row = O.applyOverrideToClassRow(row, { date: "2026-10-23", values: O.reprogDestinationValues(row, "19:00"), at: "t" });
  const dest = card([row], "2026-10-23");
  assert.deepEqual([dest.time, dest.timeEnd, dest.court], ["19:00", "20:00", "Cancha 2"]);
  // without a chosen time the destination shows the SERIES values, not the origin's 17:00 / Cancha 4
  const noTime = { ...withOverride(tue()), dateCancellations: { "2026-10-20": { cancelType: "cancelled_reprog", rescheduledTo: "2026-10-23" } } };
  const d2 = card([noTime], "2026-10-23");
  assert.deepEqual([d2.time, d2.timeEnd, d2.court], ["16:00", "17:00", "Cancha 2"]);
  assert.ok(noTime.occurrenceOverrides["2026-10-20"], "the origin's values stay as history");
  const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  assert.match(app, /const \[newTime,setNewTime\]=useState\(\(series&&series\.time\)\|\|cls\.time\|\|"08:00"\);/);
  assert.match(app, /rescheduledTo:targetDate,rescheduled:true,attendanceLog:updatedLog,applyToAll:false,_destTime:newTime\},true\);/);
  assert.match(app, /const destValues=cd\.cancelled===true&&cd\.cancelType==="cancelled_reprog"&&cd\.rescheduledTo&&cd\._destTime\?reprogDestinationValues\(c,cd\._destTime\):null;/);
});

test("chained reprogramming and fused dates: each card shows its own date's values only", () => {
  const dc = { "2026-10-13": { cancelType: "cancelled_reprog", rescheduledTo: "2026-10-15" }, "2026-10-15": { cancelType: "cancelled_reprog", rescheduledTo: "2026-10-16" } };
  let row = { ...tue(), dateCancellations: dc };
  row = withOverride(row, "2026-10-15", { time: "18:00", timeEnd: "19:00" });
  assert.equal(O.overrideRefusal({ row, date: "2026-10-15", values: { time: "18:00", timeEnd: null, court: null } }), "not-live", "an intermediate step is not live");
  const terminal = card([row], "2026-10-16");
  assert.deepEqual([terminal.time, terminal.timeEnd], ["16:00", "17:00"], "the step's values do not travel to the terminal");
  // fused: 13/10 and 20/10 both end on 23/10 (one card); its own override serves both slots
  const fdc = { "2026-10-13": { cancelType: "cancelled_reprog", rescheduledTo: "2026-10-23" }, "2026-10-20": { cancelType: "cancelled_reprog", rescheduledTo: "2026-10-23" } };
  const frow = O.applyOverrideToClassRow({ ...tue(), dateCancellations: fdc }, { date: "2026-10-23", values: { time: "18:00", timeEnd: "19:00", court: null }, at: "t" });
  const cards = A.expandClasses([frow]).filter((c) => c.date === "2026-10-23");
  assert.equal(cards.length, 1);
  assert.equal(cards[0].timeEnd, "19:00");
});

test("pauses, cancellations, attendance and invalid times are refused; attendance needs an explicit confirmation", () => {
  const row = tue({ dateCancellations: { "2026-10-27": { cancelType: "paused", rescheduledTo: null }, "2026-11-03": { cancelType: "cancelled", rescheduledTo: null } },
    attendanceLog: [{ date: "2026-10-13", present: [J], ausente_dada: [], ausente_reprog: [] }] });
  const v = O.overrideValuesFrom(row, { ...row, ...MOVE });
  assert.equal(O.overrideRefusal({ row, date: "2026-10-27", values: v }), "not-live");
  assert.equal(O.overrideRefusal({ row, date: "2026-11-03", values: v }), "not-live");
  assert.equal(O.overrideRefusal({ row, date: "2026-10-13", values: v }), "attendance-recorded");
  assert.equal(O.overrideRefusal({ row, date: "2026-10-13", values: v, confirmedAttendance: true }), null);
  assert.equal(O.overrideRefusal({ row, date: "2026-10-20", values: { time: "18:00", timeEnd: "17:30", court: null } }), "time-order");
  assert.equal(O.overrideRefusal({ row, date: "2026-10-20", values: { time: "18:00", timeEnd: null, court: null } }), "time-order", "18:00 start after the series 17:00 end");
  assert.equal(O.overrideRefusal({ row, date: "2026-10-20", values: { time: "7:00", timeEnd: null, court: null } }), "time-format");
  assert.match(CE.editRefusalMessage({ status: "override-refused", reason: "time-order" }), /anterior a la hora de finalización/);
});

test("two classes of the same student on one date: an override of one never touches the other", () => {
  const other = { ...tue(), id: 31, title: "Otra", time: "09:00", timeEnd: "10:00", court: "Cancha 1" };
  const rows = [withOverride(tue()), other];
  const s = { id: J, name: "Juan", combos: [combo(), combo({ id: 2, sourceClassId: 31 })] };
  const x = A.expandClasses(rows);
  assert.deepEqual([card(rows, "2026-10-20", 31).time, card(rows, "2026-10-20", 31).court], ["09:00", "Cancha 1"]);
  assert.equal(S.createSlotReader({ classes: x, combo: s.combos[1], studentId: J }).timeEndFor("2026-10-20"), "10:00");
  assert.equal(S.createSlotReader({ classes: x, combo: s.combos[0], studentId: J }).timeEndFor("2026-10-20"), "18:00");
});

test("per-date values never reach the series: A Todas from that card, and pause/resume/reprogram writes", () => {
  const row = withOverride(tue());
  const c = card([row], "2026-10-20");
  // untouched on the card -> series values; changed -> applied
  assert.deepEqual(O.seriesEditFromCard({ series: row, card: c, edited: { ...c, title: "Martes B" } }).time, "16:00");
  assert.deepEqual(O.seriesEditFromCard({ series: row, card: c, edited: { ...c, time: "15:00" } }).time, "15:00");
  assert.equal(O.seriesEditFromCard({ series: row, card: card([row], "2026-10-27"), edited: { time: "15:00" } }).time, "15:00", "card without override: as before");
  // per-date flows merge the card: its own values are dropped
  assert.deepEqual(O.withoutCardOverride({ ...c, cancelled: true }, c).time, undefined);
  assert.equal("seriesValues" in O.withoutCardOverride(c, c), false);
  const resumed = A.applyResumeToClassRow({ c: row, cd: { ...c, _resuming: true, _compensatedPausedDates: [], _newOccurrenceDates: [] }, realId: 30, editDate: "2026-10-20", dc: {}, occ: row.occurrences, plannedResume: undefined });
  assert.deepEqual([resumed.time, resumed.timeEnd, resumed.court], ["16:00", "17:00", "Cancha 2"]);
  assert.equal("occurrenceOverride" in resumed, false);
  assert.deepEqual(CE.editableFromCard(c).seriesValues, undefined);
  const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  assert.equal((app.match(/withoutCardOverride\(/g) || []).length, 3, "interceptor (2) and resume");
});

test("Solo esta clase: time and court are allowed for that date; days, title and students still refused", () => {
  const series = tue();
  assert.deepEqual(CE.singleDateRefusedChanges(series, { ...series, ...MOVE }, [J]), []);
  assert.deepEqual(CE.singleDateRefusedChanges(series, { ...series, ...MOVE, title: "X", days: ["Jue"] }, [J]), ["días", "título"]);
  assert.match(CE.singleDateEditMessage(["días", "título"]), /no puede cambiar días ni título/);
});

test("equivalence: without overrides the cards are exactly as before (no new keys)", () => {
  const x = A.expandClasses([tue()]);
  for (const c of x) for (const k of ["occurrenceOverride", "seriesValues"]) assert.equal(k in c, false);
  assert.equal(O.effectiveTimeEnd(tue(), "2026-10-20"), "17:00");
  assert.equal(O.activeOverrideOf(tue(), "2026-10-20"), null);
});
