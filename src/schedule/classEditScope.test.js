import { test } from "node:test";
import assert from "node:assert/strict";
import { keepDatesWithHistory, singleDateEditChanges, singleDateEditMessage } from "./classEditScope.js";
import { loadAppFunctions } from "../test/loadAppFunctions.js";

// Fictitious series shaped like the reported case: Mon/Wed from 28/09, "today" 25/10/2026.
const series = {
  id: "cls-1",
  title: "Pádel inicial",
  court: "Cancha 1",
  days: [1, 3],
  time: "18:00",
  timeEnd: "19:00",
  students: ["st-a", "st-b"],
};
const known = ["st-a", "st-b", "st-c"];

test("Solo esta clase: an edit that changes no series field is allowed", () => {
  assert.deepEqual(singleDateEditChanges(series, { ...series, date: "2026-10-26", _virtualId: "cls-1_2026-10-26" }, known), []);
  // weekday order and number/string do not matter
  assert.deepEqual(singleDateEditChanges(series, { ...series, days: ["3", "1"] }, known), []);
  // a missing timeEnd starts as "09:00" in EditClassScreen
  assert.deepEqual(singleDateEditChanges({ ...series, timeEnd: undefined }, { ...series, timeEnd: "09:00" }, known), []);
  // a deleted student is not shown in EditClassScreen, so leaving it out is not a change
  assert.deepEqual(singleDateEditChanges({ ...series, students: ["st-a", "st-b", "st-gone"] }, { ...series }, known), []);
  // a package change is not a series field
  assert.deepEqual(singleDateEditChanges(series, { ...series, studentPacks: { "st-a": { pack: "p1" } } }, known), []);
});

test("Solo esta clase: every series field is refused and named", () => {
  assert.deepEqual(singleDateEditChanges(series, { ...series, days: [2, 3] }, known), ["días"]);
  assert.deepEqual(singleDateEditChanges(series, { ...series, days: [1, 3, 5] }, known), ["días"]);
  assert.deepEqual(singleDateEditChanges(series, { ...series, time: "19:00" }, known), ["horario"]);
  assert.deepEqual(singleDateEditChanges(series, { ...series, timeEnd: "20:00" }, known), ["horario"]);
  assert.deepEqual(singleDateEditChanges(series, { ...series, court: "Cancha 2" }, known), ["cancha"]);
  assert.deepEqual(singleDateEditChanges(series, { ...series, title: "Otro" }, known), ["título"]);
  assert.deepEqual(singleDateEditChanges(series, { ...series, students: ["st-a"] }, known), ["alumnos"]);
  assert.deepEqual(singleDateEditChanges(series, { ...series, students: ["st-a", "st-b", "st-c"] }, known), ["alumnos"]);
  const all = singleDateEditChanges(series, { ...series, days: [2], time: "07:00", court: "X", title: "Y", students: [] }, known);
  assert.deepEqual(all, ["días", "horario", "cancha", "título", "alumnos"]);
});

test("Solo esta clase: the message names the fields and points to Reprogramar", () => {
  assert.equal(singleDateEditMessage([]), "");
  assert.equal(
    singleDateEditMessage(["días"]),
    "Solo esta clase no puede cambiar días: esos cambios se aplican a todas las clases. Para mover solo esta fecha, usá Reprogramar."
  );
  assert.match(singleDateEditMessage(["días", "horario", "alumnos"]), /no puede cambiar días, horario ni alumnos:/);
});

const TODAY = "2026-10-25";
// Mon/Wed occurrences 28/09 … 25/11 and the regenerated Tue/Thu list from 29/09 (what EditClassScreen builds).
const monWed = ["2026-09-28", "2026-09-30", "2026-10-05", "2026-10-07", "2026-10-12", "2026-10-14", "2026-10-19", "2026-10-21", "2026-10-26", "2026-10-28", "2026-11-02", "2026-11-04", "2026-11-09", "2026-11-11"];
const tueThu = ["2026-09-29", "2026-10-01", "2026-10-06", "2026-10-08", "2026-10-13", "2026-10-15", "2026-10-20", "2026-10-22", "2026-10-27", "2026-10-29", "2026-11-03", "2026-11-05", "2026-11-10", "2026-11-12"];

test("regenerated occurrences keep past, attended, paused, reprogrammed and added dates; clean future ones go", () => {
  const out = keepDatesWithHistory({
    previous: [...monWed, "2026-10-30"],
    next: tueThu,
    attendanceLog: [{ date: "2026-10-26", present: ["st-a"] }],
    dateCancellations: {
      "2026-11-02": { cancelType: "paused", rescheduledTo: null },
      "2026-11-04": { cancelType: "cancelled_reprog", rescheduledTo: "2026-11-06" },
    },
    addedDates: [{ id: "a1", date: "2026-10-30", studentIds: ["st-a"] }],
    todayDate: TODAY,
  });
  for (const d of monWed.filter((d) => d < TODAY)) assert.ok(out.includes(d), "past " + d);
  assert.ok(out.includes("2026-10-26"), "future date with attendance");
  assert.ok(out.includes("2026-11-02"), "paused date");
  assert.ok(out.includes("2026-11-04"), "origin of a reprogramming");
  assert.ok(out.includes("2026-10-30"), "added date");
  for (const d of ["2026-10-28", "2026-11-09", "2026-11-11"]) assert.ok(!out.includes(d), "clean future old weekday " + d);
  for (const d of tueThu.filter((d) => d >= TODAY)) assert.ok(out.includes(d), "new " + d);
  for (const d of tueThu.filter((d) => d < TODAY)) assert.ok(!out.includes(d), "invented past date " + d);
  assert.deepEqual(out, [...new Set(out)].sort());
  // the destination of a reprogramming is not invented as an occurrence
  assert.ok(!out.includes("2026-11-06"));
});

test("nothing to keep: the regenerated list is returned sorted; missing inputs are safe", () => {
  assert.deepEqual(keepDatesWithHistory({ previous: ["2026-11-02"], next: ["2026-11-03", "2026-11-01"], todayDate: TODAY }), ["2026-11-01", "2026-11-03"]);
  assert.deepEqual(keepDatesWithHistory({ previous: undefined, next: [], todayDate: TODAY }), []);
  // a date with history that is still a new weekday date appears once
  assert.deepEqual(keepDatesWithHistory({ previous: ["2026-10-20"], next: ["2026-10-20"], todayDate: TODAY }), ["2026-10-20"]);
});

test("Agenda (real expandClasses) after a weekday change still shows past, paused and reprogrammed cards", async () => {
  const { expandClasses } = await loadAppFunctions(["expandClasses"]);
  const row = {
    ...series,
    cancelledDates: [],
    occurrences: monWed,
    attendanceLog: [{ date: "2026-10-19", present: ["st-a", "st-b"] }],
    dateCancellations: {
      "2026-11-02": { cancelType: "paused", rescheduledTo: null },
      "2026-11-04": { cancelType: "cancelled_reprog", rescheduledTo: "2026-11-06" },
    },
  };
  const occurrences = keepDatesWithHistory({ previous: row.occurrences, next: tueThu, attendanceLog: row.attendanceLog, dateCancellations: row.dateCancellations, todayDate: TODAY });
  const cards = expandClasses([{ ...row, days: [2, 4], occurrences }]);
  const byDate = Object.fromEntries(cards.map((c) => [c.date, c]));
  assert.ok(byDate["2026-10-19"] && byDate["2026-10-19"].attendanceLog.length === 1, "past attended card");
  assert.ok(byDate["2026-09-28"], "past card");
  assert.equal(byDate["2026-11-02"]?.paused, true, "paused card");
  assert.equal(byDate["2026-11-04"]?.rescheduledTo, "2026-11-06", "reprogrammed origin");
  assert.ok(byDate["2026-11-06"]?._isRescheduledInstance, "reprogrammed destination card");
  assert.ok(byDate["2026-10-27"] && !byDate["2026-10-28"], "new weekday in, clean old weekday out");
});
