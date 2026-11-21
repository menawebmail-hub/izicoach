import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NOW, slotReaderFixture } from "./slotReaderFixtures.js";

mock.timers.enable({ apis: ["Date"], now: new Date(NOW).getTime() });
const S = await import("./slotStatus.js");
const { loadAppFunctions } = await import("../test/loadAppFunctions.js");
const { expandClasses } = await loadAppFunctions(["expandClasses"]);

test("createSlotReader = resolveContractSlotStatus + resolveSlotGiven, for every date of every fixture combo", () => {
  const { classes, students } = slotReaderFixture();
  const x = expandClasses(classes);
  let checked = 0;
  for (const s of students) {
    const mine = x.filter((c) => c.students && c.students.includes(s.id));
    for (const combo of s.combos) {
      const reader = S.createSlotReader({ classes: mine, combo, studentId: s.id });
      for (const d of [...combo.dates, "2026-12-30"]) {
        const card = mine.find((c) => c.date === d);
        const slot = S.resolveContractSlotStatus(mine, combo, d, card);
        assert.deepEqual(reader.status(d), slot, "status " + s.id + " " + d);
        const timeEnd = (card && card.timeEnd) || "23:59";
        assert.equal(reader.timeEndFor(d), timeEnd);
        assert.equal(reader.isGiven(d), S.resolveSlotGiven(slot, combo.packType, d, timeEnd, mine, s.id), "given " + s.id + " " + d);
        checked++;
      }
    }
  }
  assert.ok(checked >= 25);
});

test("the reader memoizes the slot per date, never mutates its inputs, and tolerates no classes", () => {
  const { classes, students } = slotReaderFixture();
  const before = JSON.stringify({ classes, students });
  const x = expandClasses(classes);
  const r = S.createSlotReader({ classes: x, combo: students[1].combos[0], studentId: 2 });
  assert.equal(r.status("2026-10-26"), r.status("2026-10-26"));
  r.isGiven("2026-10-26");
  assert.equal(JSON.stringify({ classes, students }), before);
  const empty = S.createSlotReader({ classes: undefined, combo: { packType: "combo", dates: ["2026-10-05"] }, studentId: 1 });
  assert.equal(empty.status("2026-10-05").terminalStatus, "normal");
  assert.equal(empty.isGiven("2026-10-05"), true, "past date with no card: time-based fallback, as before");
});

test("wiring: Cobros rows, counters, Por dar and PagoModal read slots only through createSlotReader", () => {
  const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  assert.match(app, /^import \{ createSlotReader, getSlotFulfillmentDate, interpretContractDate, isClassDone \} from "\.\/schedule\/slotStatus\.js";$/m);
  assert.match(app, /^import \{ comboIndexWithMoveInto, countUsedForCombo, hasSlotMoves \} from "\.\/schedule\/slotMoves\.js";$/m);
  assert.equal((app.match(/resolveContractSlotStatus\(/g) || []).length, 0, "no direct slot status call left in App.jsx");
  assert.equal((app.match(/resolveSlotGiven\(/g) || []).length, 0, "no direct given call left in App.jsx");
  assert.ok(!/^const (isClassDone|interpretContractDate|resolveContractSlotStatus|resolveSlotGiven)=/m.test(app), "moved, not duplicated");
  assert.ok(!/^function getSlotFulfillmentDate\(/m.test(app));
  assert.match(app, /const reader=createSlotReader\(\{classes:personClasses,combo:c,studentId:person\.id,allClasses\}\);/);
  assert.equal((app.match(/const reader=createSlotReader\(\{classes:myClasses,combo:c,studentId:s\.id,allClasses:classes\}\);/g) || []).length, 2, "counters + PagoModal");
  assert.match(app, /const reader=createSlotReader\(\{classes:studentClasses,combo:c,studentId:s\.id,allClasses:classes\}\);/);
  // PagoModal keeps its own isGiven rule, except for a slot moved for this student
  assert.match(app, /const isGiven=slot\.studentMoves\?reader\.isGiven\(ds\):isPaused\?false:/);
});
