import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Stage 2.1 review — (1) an individual absence in Inicio never reprograms the whole class; (2) `used`, realizadas and
// restantes agree when an advance Ausente – Dada notice exists. Synthetic data only. "Today" = Thu 15/10/2026 12:00.
mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-15T12:00:00").getTime() });
const N = await import("./absenceNotices.js");
const S = await import("./slotStatus.js");
const { countUsedForCombo } = await import("./slotMoves.js");
const { slotReaderFixture } = await import("./slotReaderFixtures.js");
const { loadAppFunctions } = await import("../test/loadAppFunctions.js");
const A = await loadAppFunctions([
  "TODAY_DATE", "isClassDone", "interpretContractDate", "resolveSlotPayments", "buildSlotHistoryRows", "buildPersonSlotRows",
  "getSlotFulfillmentDate", "isComboClosed", "getClassEntitlements", "getCountedClassEntitlements", "getAccountCounters",
  "getEffectiveTotal", "getClaseRem", "expandClasses", "getComboExportCounters", "resolveComboClassName", "formatDateDDMMYYYY", "buildComboExportRows", "deletedSlotCounts",
]);

const J = "juan", P = "pedro";
const EIGHT = ["2026-10-05", "2026-10-07", "2026-10-12", "2026-10-14", "2026-10-19", "2026-10-21", "2026-10-26", "2026-10-28"];
const entry = (date, present = [], ausente_dada = [], ausente_reprog = []) => ({ date, day: "x", present, ausente_dada, ausente_reprog });
const notice = (status) => ({ status, at: "2026-10-06T10:00:00Z", history: [{ status, at: "2026-10-06T10:00:00Z" }] });
const group = (log, notices = {}) => ({ id: 10, title: "Grupo", days: ["Lun", "Mié"], time: "18:00", timeEnd: "19:00", students: [J, P], startDate: EIGHT[0], date: EIGHT[0],
  occurrences: [...EIGHT, "2026-11-02"], cancelledDates: [], rescheduledDates: [], dateCancellations: {}, attendanceLog: log, attendanceNotices: notices });
const combo = (extra = {}) => ({ id: 1, total: 8, packType: "combo", sourceClassId: 10, used: 0, paid: false, paidCount: 0, amount: 400000, payments: [], dates: [...EIGHT], ...extra });
const LOG = [entry("2026-10-05", [J, P]), entry("2026-10-12", [J, P]), entry("2026-10-14", [J, P])];
const card = (classes, date) => A.expandClasses(classes).find((c) => c.date === date);

// ---------- (1) Inicio ----------

test("Inicio: Juan's No dada (notice or attendance) while Pedro took the class is individual: never reprograms the class", () => {
  const byNotice = card([group(LOG, { "2026-10-07": { [J]: notice("ausente_reprog") } })], "2026-10-07");
  const byAttendance = card([group([...LOG, entry("2026-10-07", [P], [], [J])])], "2026-10-07");
  for (const c of [byNotice, byAttendance]) {
    assert.deepEqual(N.noGivenStudentIds(c), [J]);
    assert.equal(N.isWholeClassAbsence(c, [J, P]), false, "Pedro took it: individual");
  }
  assert.equal(N.individualRecoveryMessage(["Juan"]), "Juan tiene una recuperación individual pendiente. Esta función estará disponible próximamente.");
  assert.equal(N.individualRecoveryMessage(["Juan", "Ana"]), "Juan y Ana tienen una recuperación individual pendiente. Esta función estará disponible próximamente.");
  assert.doesNotMatch(N.individualRecoveryMessage(["Juan"]), /Etapa/, "no internal wording for coaches");
});

test("Inicio: when nobody took the class (everyone No dada) the class-level flow stays available", () => {
  const all = card([group([...LOG, entry("2026-10-07", [], [], [J])], { "2026-10-07": { [P]: notice("ausente_reprog") } })], "2026-10-07");
  assert.equal(N.isWholeClassAbsence(all, [J, P]), true);
  // a deleted student id on the roster does not turn a whole-class absence into an individual one
  const withGhost = { ...all, students: [J, P, "ghost"] };
  assert.equal(N.isWholeClassAbsence(withGhost, [J, P]), true);
  assert.equal(N.isWholeClassAbsence({ ...all, students: [] }, []), false);
  const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  assert.match(app, /const individual=reason==="reprog"&&!isWholeClassAbsence\(cls,students\.map\(x=>x\.id\)\);/);
  assert.match(app, /onClick=\{\(\)=>\{if\(individual\)\{alert\(individualRecoveryMessage\(sts\.map\(x=>x\.name\.split\(" "\)\[0\]\)\)\);return;\}onNavigate\("agenda",\{reprog:cls\}\);\}\}/);
  assert.match(app, /individual\?"Recuperación individual pendiente":"A reprogramar \(asistencia\)"/);
});

// ---------- (2) used / realizadas / restantes ----------

test("an Ausente – Dada notice: used, realizadas, restantes and the export agree once the class has happened", () => {
  const classes = [group(LOG, { "2026-10-07": { [J]: notice("ausente_dada") } })];
  const x = A.expandClasses(classes);
  const juan = { id: J, name: "Juan", combos: [combo({ used: 3 })] };
  assert.equal(S.dueDadaNoticeCount({ combo: juan.combos[0], studentId: J, classes }), 1);
  assert.equal(S.effectiveComboUsed({ combo: juan.combos[0], studentId: J, classes: x }), 4, "3 explicit + 1 due notice");
  const c = A.getAccountCounters(juan, x);
  assert.deepEqual([c.realizadas, c.restantes], [4, 4]);
  const exportRow = A.buildComboExportRows(juan, juan.combos[0], x)[0];
  assert.equal(exportRow.Restantes, 4, "export restantes = total - effective used");
  // handleAttendance recount adds the due notices (explicit count stays as before)
  assert.equal(countUsedForCombo({ combo: juan.combos[0], studentId: J, dc: {}, attendanceLog: LOG, baseClassId: 10, classes }) + S.dueDadaNoticeCount({ combo: juan.combos[0], studentId: J, classes }), 4);
});

test("before the class time a Dada notice consumes nothing; a No dada notice never does", () => {
  const today = [group(LOG, { "2026-10-15": { [J]: notice("ausente_dada") } })];
  const c15 = combo({ dates: ["2026-10-15"], total: 1, used: 0 });
  assert.equal(S.dueDadaNoticeCount({ combo: c15, studentId: J, classes: today }), 0, "12:00 < 19:00 + margin");
  mock.timers.setTime(new Date("2026-10-15T19:45:00").getTime());
  assert.equal(S.dueDadaNoticeCount({ combo: c15, studentId: J, classes: today }), 1);
  mock.timers.setTime(new Date("2026-10-15T12:00:00").getTime());
  const nd = [group(LOG, { "2026-10-07": { [J]: notice("ausente_reprog") } })];
  const j = combo({ used: 3 });
  assert.equal(S.dueDadaNoticeCount({ combo: j, studentId: J, classes: nd }), 0);
  assert.equal(S.effectiveComboUsed({ combo: j, studentId: J, classes: nd }), 3);
  const c = A.getAccountCounters({ id: J, name: "Juan", combos: [j] }, A.expandClasses(nd));
  assert.deepEqual([c.realizadas, c.restantes], [3, 5]);
  assert.equal(A.buildComboExportRows({ id: J, name: "Juan" }, j, A.expandClasses(nd))[0].Restantes, 5);
});

test("Pedro is never affected by Juan's notices (used, counters, export)", () => {
  const pedro = { id: P, name: "Pedro", combos: [combo({ used: 3 })] };
  const plain = [group(LOG)];
  for (const n of [{ "2026-10-07": { [J]: notice("ausente_dada") } }, { "2026-10-07": { [J]: notice("ausente_reprog") } }]) {
    const withJuan = [group(LOG, n)];
    assert.equal(S.effectiveComboUsed({ combo: pedro.combos[0], studentId: P, classes: withJuan }), 3);
    assert.deepEqual(A.getAccountCounters(pedro, A.expandClasses(withJuan)), A.getAccountCounters(pedro, A.expandClasses(plain)));
    assert.deepEqual(A.buildComboExportRows(pedro, pedro.combos[0], A.expandClasses(withJuan)), A.buildComboExportRows(pedro, pedro.combos[0], A.expandClasses(plain)));
  }
});

test("without notices `used` is read exactly as stored (equivalence on the characterization fixture)", () => {
  const { classes, students } = slotReaderFixture();
  const x = A.expandClasses(classes);
  for (const s of students) for (const c of s.combos) {
    assert.equal(S.effectiveComboUsed({ combo: c, studentId: s.id, classes: x }), Number(c.used || 0));
    assert.equal(S.dueDadaNoticeCount({ combo: c, studentId: s.id, classes: x }), 0);
  }
});

test("wiring: recount, payment count, mora, export and package checks read the unified used", () => {
  const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  assert.equal((app.match(/\+dueDadaNoticeCount\(\{combo:/g) || []).length, 2, "attendance recount: roster and guest paths");
  assert.match(app, /if\(rn&&rn\.source==="notice"\) return givenByReading\(rn,fulfillment,\(clsD&&clsD\.timeEnd\)\|\|"23:59"\);/);
  assert.match(app, /const totalUsed=lastCombo\?effectiveComboUsed\(\{combo:lastCombo,studentId:s\.id,classes\}\):0;/);
  assert.match(app, /const counters=getComboExportCounters\(\{\.\.\.combo,used:effectiveComboUsed\(\{combo,studentId:student\.id,classes:classesList\}\)\}\);/);
  assert.match(app, /const lastUsed=lastCombo\?effectiveComboUsed\(\{combo:lastCombo,studentId:s\.id,classes\}\):0;/);
  assert.match(app, /const consumed=lastUsed;/);
});
