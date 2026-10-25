import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyReleaseToClassRow,
  applyReleaseToCombo,
  countAttendedSlots,
  findPendingReleaseCompletions,
  releaseMessage,
  releaseStateOf,
} from "./releaseReprogrammedDate.js";

const P = (date, ids = [1]) => ({ date, present: ids, ausente_dada: [], ausente_reprog: [] });

test("BUG-COMBO-01: dates without reprogramming count exactly as the old recount (explicit attendance on the date)", () => {
  const log = [P("2026-10-05"), { date: "2026-10-07", present: [], ausente_dada: [1], ausente_reprog: [] }, { date: "2026-10-12", present: [], ausente_dada: [], ausente_reprog: [1] }];
  assert.equal(countAttendedSlots({ dates: ["2026-10-05", "2026-10-07", "2026-10-12", "2026-10-14"], dc: {}, attendanceLog: log, studentId: 1 }), 2);
  assert.equal(countAttendedSlots({ dates: ["2026-10-05"], dc: {}, attendanceLog: log, studentId: 2 }), 0);
});

test("BUG-COMBO-01: a reprogrammed slot counts on its destination, once; pending, paused or broken chains never count", () => {
  const dc = {
    "2026-10-26": { cancelType: "cancelled_reprog", rescheduledTo: "2026-10-02" },
    "2026-10-19": { cancelType: "cancelled_reprog", rescheduledTo: null },
    "2026-10-21": { cancelType: "paused", rescheduledTo: null },
    "2026-10-12": { cancelType: "cancelled_reprog", rescheduledTo: "2026-10-13" },
    "2026-10-13": { cancelType: "cancelled_reprog", rescheduledTo: "2026-10-12" },
  };
  const log = [P("2026-10-02"), P("2026-10-19"), P("2026-10-21"), P("2026-10-26")];
  const dates = ["2026-10-26", "2026-10-19", "2026-10-21", "2026-10-12"];
  // 26 -> 02 (attended) counts; 19 pending and 21 paused have no class; 12 <-> 13 is a cycle.
  assert.equal(countAttendedSlots({ dates, dc, attendanceLog: log, studentId: 1 }), 1);
  // Two slots ending on the same day (a fused class) count once: one class was given.
  const fused = { "2026-10-26": { cancelType: "cancelled_reprog", rescheduledTo: "2026-10-02" } };
  assert.equal(countAttendedSlots({ dates: ["2026-10-02", "2026-10-26"], dc: fused, attendanceLog: [P("2026-10-02")], studentId: 1 }), 1);
});

const combo = { id: 1, total: 3, packType: "combo", sourceClassId: 9, dates: ["2026-10-05", "2026-10-12", "2026-10-26"], used: 2, paidCount: 3, paid: true, payments: [{ id: 1 }] };
const rec = { opId: "op", date: "2026-10-26", destination: "2026-10-02", classId: 9, at: "t" };

test("applyReleaseToCombo: same position, never re-sorted, used never decreases, idempotent, input untouched", () => {
  const next = applyReleaseToCombo(combo, { ...rec, usedAfter: 3 });
  assert.deepEqual(next.dates, ["2026-10-05", "2026-10-12", "2026-10-02"]);
  assert.equal(next.used, 3);
  assert.deepEqual(next.slotRelocations, [{ id: "op", from: "2026-10-26", to: "2026-10-02", classId: 9, at: "t" }]);
  assert.equal(next.payments, combo.payments);
  assert.equal(applyReleaseToCombo(next, { ...rec, usedAfter: 3 }), next);
  assert.equal(applyReleaseToCombo(combo, { ...rec, usedAfter: 1 }).used, 2);
  assert.deepEqual(combo.dates, ["2026-10-05", "2026-10-12", "2026-10-26"]);
});

const row = { id: 9, occurrences: ["2026-10-05", "2026-10-26"], cancelledDates: [], rescheduled: true, dateCancellations: { "2026-10-26": { cancelType: "cancelled_reprog", rescheduledTo: "2026-10-02" } }, attendanceLog: [P("2026-10-02")] };
const entry = { cancelType: "cancelled_reprog", rescheduledTo: "2026-10-02" };

test("applyReleaseToClassRow: removes only that entry, adds the destination, keeps the record; idempotent", () => {
  const next = applyReleaseToClassRow(row, { ...rec, entry });
  assert.equal(next.dateCancellations, undefined);
  assert.deepEqual(next.occurrences, ["2026-10-02", "2026-10-05", "2026-10-26"]);
  assert.equal(next.rescheduled, false);
  assert.equal(next.attendanceLog, row.attendanceLog);
  assert.deepEqual(next.releasedReschedules, [{ id: "op", date: "2026-10-26", destination: "2026-10-02", entry, at: "t" }]);
  assert.equal(applyReleaseToClassRow(next, { ...rec, entry }), next);
  // Other entries stay.
  const other = { ...row, dateCancellations: { ...row.dateCancellations, "2026-10-05": { cancelType: "cancelled", rescheduledTo: null } } };
  assert.deepEqual(applyReleaseToClassRow(other, { ...rec, entry }).dateCancellations, { "2026-10-05": { cancelType: "cancelled", rescheduledTo: null } });
});

test("applyReleaseToClassRow never removes an entry that changed meanwhile", () => {
  const changed = { ...row, dateCancellations: { "2026-10-26": { cancelType: "paused", rescheduledTo: null } } };
  assert.equal(applyReleaseToClassRow(changed, { ...rec, entry }), changed);
});

test("releaseStateOf / findPendingReleaseCompletions: none, class-pending, released, inconsistent", () => {
  const moved = [{ id: 1, combos: [applyReleaseToCombo(combo, { ...rec, usedAfter: 3 })] }];
  assert.equal(releaseStateOf({ series: row, students: [{ id: 1, combos: [combo] }], date: "2026-10-26" }).state, null);
  assert.equal(releaseStateOf({ series: row, students: moved, date: "2026-10-26" }).state, "class-pending");
  assert.deepEqual(findPendingReleaseCompletions([row], moved).map((p) => p.opId), ["op"]);
  const done = applyReleaseToClassRow(row, { ...rec, entry });
  assert.equal(releaseStateOf({ series: done, students: moved, date: "2026-10-26" }).state, "released");
  assert.deepEqual(findPendingReleaseCompletions([done], moved), []);
  const changed = { ...row, dateCancellations: { "2026-10-26": { cancelType: "paused", rescheduledTo: null } } };
  assert.equal(releaseStateOf({ series: changed, students: moved, date: "2026-10-26" }).state, "inconsistent");
  assert.deepEqual(findPendingReleaseCompletions([changed], moved), []);
});

test("messages: every reason has a readable text", () => {
  for (const r of ["write-pending", "not-attended", "payment-shift", "combo-open", "paused", "write-failed", "inconsistent", "anything"]) {
    assert.ok(releaseMessage(r).length > 20, r);
  }
});
