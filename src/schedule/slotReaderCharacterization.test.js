import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NOW, slotReaderFixture } from "./slotReaderFixtures.js";

// BUG-AGENDA-05 stage 1 (= BUG-AGENDA-03 stage 0): characterization of every per-slot reading Cobros shows.
// The snapshot was generated from main 9a26124 + stage 0 (5db25f9) BEFORE the shared reader existed; the
// refactor must keep every row, counter and "Por dar" value byte-identical.
mock.timers.enable({ apis: ["Date"], now: new Date(NOW).getTime() });
const { loadAppFunctions } = await import("../test/loadAppFunctions.js");
const NAMES = [
  "TODAY_DATE", "isClassDone", "interpretContractDate", "resolveSlotPayments",
  "buildSlotHistoryRows", "buildPersonSlotRows", "getSlotFulfillmentDate", "isComboClosed", "getClassEntitlements",
  "getCountedClassEntitlements", "getAccountCounters", "getEffectiveTotal", "getClaseRem", "expandClasses",
];
const A = await loadAppFunctions(NAMES);

function readAll() {
  const { classes, students } = slotReaderFixture();
  const x = A.expandClasses(classes);
  return students.map((s) => {
    const mine = x.filter((c) => c.students && c.students.includes(s.id));
    return {
      id: s.id,
      rows: A.buildPersonSlotRows(s, mine, A.TODAY_DATE),
      counters: A.getAccountCounters(s, x),
      claseRem: A.getClaseRem(s, x),
    };
  });
}

const snapshot = JSON.parse(readFileSync(new URL("./slotReaderCharacterization.snapshot.json", import.meta.url), "utf8"));

test("fixture covers every slot state", () => {
  const all = readAll().flatMap((r) => r.rows);
  for (const k of ["isPaused", "isCompensated", "isCancelledClass", "isReprogWithDate", "isReprogNoDate", "isDisplaced", "isGiven", "isPaid"]) {
    assert.ok(all.some((r) => r[k]), "some row has " + k);
  }
  assert.ok(all.some((r) => !r.isGiven && r.isPast), "a past slot that is not given");
});

for (const s of snapshot) {
  test("student " + s.id + ": rows, counters and Por dar unchanged", () => {
    const now = readAll().find((r) => r.id === s.id);
    assert.deepEqual(JSON.parse(JSON.stringify(now)), s);
  });
}
