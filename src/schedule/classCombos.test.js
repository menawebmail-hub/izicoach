import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Agenda grey "Sin pagar" cards / Asistencia lock / Renovar Combo / Pausar read only the combos of the card's own class.
// Case reported 2026-11-26: Competencia grey because its mensual student Camila once took individual classes elsewhere.
// REAL App.jsx functions, fictitious data, "today" = Thu 26/11/2026.
mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-26T12:00:00").getTime() });
const { loadAppFunctions } = await import("../test/loadAppFunctions.js");
const A = await loadAppFunctions([
  "TODAY_DATE", "isClassDone", "interpretContractDate", "expandClasses", "isNextComboPending", "classCombosOfCard",
  "getClassEntitlements", "getAllMensualEntitlements", "isoOfDate", "collectSlotPathDates", "collectComboOccupiedDates", "END_OF_PACKAGE_SCAN_LIMIT",
  "resolveEndOfPackageTarget",
]);
const M = await import("./classCombos.js");
const SRC = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");

const dow = { Dom: 0, Lun: 1, Mar: 2, "Mié": 3, Jue: 4, Vie: 5, "Sáb": 6 };
const occ = (days) => { const s = new Set(days.map((d) => dow[d])), o = [], c = new Date("2026-09-01T12:00:00"); while (A.isoOfDate(c) <= "2027-01-31") { if (s.has(c.getDay())) o.push(A.isoOfDate(c)); c.setDate(c.getDate() + 1); } return o; };
const klass = (id, title, days, students) => { const o = occ(days); return { id, title, days, time: "18:00", timeEnd: "19:00", students, startDate: o[0], date: o[0], occurrences: o, cancelledDates: [], rescheduledDates: [], dateCancellations: {}, attendanceLog: [] }; };
const COMP = 10, PRECOM = 20, IND = 30, TENIS = 40;
const mensual = (extra = {}) => ({ id: 1, packType: "mensual", total: null, date: "2026-09-01", amount: 500000, cobroDia: 5, graciaDias: 5, dates: [], payments: [], mensualidades: [], sourceClassId: COMP, ...extra });
const combo = (dates, extra = {}) => ({ id: 2, packType: "combo", total: dates.length, paid: true, paidCount: dates.length, used: dates.length, date: dates[0], dates, amount: 1, payments: [], ...extra });
const individual = (date, extra = {}) => ({ id: 3, packType: "individual", total: 1, paid: true, paidCount: 1, used: 1, date, dates: [date], amount: 1, payments: [], sourceClassId: IND, ...extra });
const MONWED_OCT = ["2026-10-05", "2026-10-07", "2026-10-12", "2026-10-14"];
const MONWED_NOV = ["2026-11-02", "2026-11-04", "2026-11-09", "2026-11-11"];
const TUETHU_OCT = ["2026-10-06", "2026-10-08", "2026-10-13", "2026-10-15"];

// What Agenda passes: every raw class row + the ids of the existing classes.
const world = (classes, students) => ({ classes, students, scope: { classes, knownSeriesIds: new Set(classes.map((c) => c.id)) } });
const card = (w, id, date) => A.expandClasses(w.classes).find((c) => c._seriesId === id && c.date === date);
const grey = (w, id, date) => A.isNextComboPending(card(w, id, date), w.students, w.scope);

test("reported case: Competencia (Camila mensual + an old individual of another class) is white; Pre-Com white", () => {
  const camila = { id: "cam", name: "Camila", combos: [individual("2026-10-10"), mensual()] };
  const lau = { id: "lau", name: "Lautaro", combos: [mensual({ sourceClassId: PRECOM })] };
  const w = world([klass(COMP, "Competencia", ["Lun", "Mié"], ["cam"]), klass(PRECOM, "Pre-Com", ["Mar", "Jue"], ["lau"]), klass(IND, "Individual", ["Sáb"], ["cam"])], [camila, lau]);
  assert.equal(grey(w, COMP, "2026-11-30"), false, "Competencia: not grey, Asistencia not locked (same reading)");
  assert.equal(grey(w, PRECOM, "2026-12-01"), false);
  // Before the fix every non-mensual combo of the student counted, whatever its class:
  assert.equal(A.isNextComboPending(card(w, COMP, "2026-11-30"), w.students, { classes: w.classes, knownSeriesIds: new Set([IND]) }), false, "an orphan COMP-less id set never re-reads the individual as COMP's");
});

test("a mensual in mora still never greys its class because of earlier combos (same class or another)", () => {
  const mora = mensual({ mensualidades: [{ id: "M-2026-09", mes: "2026-09", monto: 500000, estado: "pendiente", fechaVencimiento: "2026-09-05" }] });
  const st = { id: "cam", name: "Camila", combos: [combo(["2026-08-03", "2026-08-05"], { sourceClassId: COMP }), individual("2026-10-10"), mora] };
  const w = world([klass(COMP, "Competencia", ["Lun", "Mié"], ["cam"]), klass(IND, "Individual", ["Sáb"], ["cam"])], [st]);
  assert.equal(grey(w, COMP, "2026-11-30"), false);
  assert.equal(grey(w, COMP, "2026-12-02"), false);
});

test("mensual then back to combos in the SAME class: the later combo still greys after its end (renewal really due)", () => {
  const st = { id: "a", name: "A", combos: [mensual(), combo(MONWED_NOV, { sourceClassId: COMP })] };
  const w = world([klass(COMP, "Competencia", ["Lun", "Mié"], ["a"])], [st]);
  assert.equal(grey(w, COMP, "2026-11-04"), false, "inside the combo");
  assert.equal(grey(w, COMP, "2026-11-30"), true, "after its last date: grey, as before");
  // A mensual that only starts later does not hide an ended combo before it starts.
  const later = { id: "a", name: "A", combos: [combo(MONWED_OCT, { sourceClassId: COMP }), mensual({ date: "2026-12-01" })] };
  const w2 = world([klass(COMP, "Competencia", ["Lun", "Mié"], ["a"])], [later]);
  assert.equal(grey(w2, COMP, "2026-11-30"), true);
  assert.equal(grey(w2, COMP, "2026-12-02"), false);
});

test("combo students keep today's grey: ended combo of this class -> grey; inside/gap/after unchanged", () => {
  const st = { id: "a", name: "A", combos: [combo(["2026-10-05", "2026-10-12", "2026-10-19"], { sourceClassId: COMP })] };
  const w = world([klass(COMP, "Competencia", ["Lun", "Mié"], ["a"])], [st]);
  assert.deepEqual(["2026-10-05", "2026-10-07", "2026-10-19", "2026-10-21", "2026-11-30"].map((d) => grey(w, COMP, d)), [false, true, false, true, true]);
  assert.equal(grey(w, COMP, "2026-09-30"), false, "before the combo: white, as before");
});

test("student in several classes: another class's combo (ended) never greys this one; its own class does", () => {
  const st = { id: "a", name: "A", combos: [combo(TUETHU_OCT, { sourceClassId: PRECOM })] };
  const w = world([klass(COMP, "Competencia", ["Lun", "Mié"], ["a"]), klass(PRECOM, "Pre-Com", ["Mar", "Jue"], ["a"])], [st]);
  assert.equal(grey(w, COMP, "2026-11-30"), false, "no combo of Competencia");
  assert.equal(grey(w, PRECOM, "2026-12-01"), true, "Pre-Com's own combo ended");
});

test("archived combos: an archived combo of THIS class keeps today's reading; one of another class is ignored", () => {
  const own = { id: "a", name: "A", combos: [combo(MONWED_OCT, { sourceClassId: COMP, archived: true })] };
  const other = { id: "b", name: "B", combos: [combo(MONWED_OCT, { sourceClassId: TENIS, archived: true }), mensual()] };
  const w = world([klass(COMP, "Competencia", ["Lun", "Mié"], ["a"])], [own]);
  assert.equal(grey(w, COMP, "2026-11-30"), true);
  const w2 = world([klass(COMP, "Competencia", ["Lun", "Mié"], ["b"]), klass(TENIS, "Tenis", ["Lun", "Mié"], ["b"])], [other]);
  assert.equal(grey(w2, COMP, "2026-11-30"), false);
});

test("groups: grey when any combo student of this class needs renewal; mensual classmates never do", () => {
  const men = { id: "m", name: "Mensual", combos: [mensual(), individual("2026-10-10")] };
  const ended = { id: "e", name: "Ended", combos: [combo(MONWED_OCT, { sourceClassId: COMP })] };
  const active = { id: "x", name: "Active", combos: [combo(["2026-11-30", "2026-12-02"], { sourceClassId: COMP })] };
  const cls = (ids) => [klass(COMP, "Competencia", ["Lun", "Mié"], ids), klass(IND, "Individual", ["Sáb"], ["m"])];
  assert.equal(grey(world(cls(["m", "e"]), [men, ended]), COMP, "2026-11-30"), true, "Ended needs renewal");
  assert.equal(grey(world(cls(["m", "x"]), [men, active]), COMP, "2026-11-30"), false, "Active covers the date");
  assert.equal(grey(world(cls(["m"]), [men]), COMP, "2026-11-30"), false);
});

test("legacy combos without sourceClassId: placed by dates among the student's classes; ambiguous never assumed", () => {
  const legacy = (dates) => combo(dates); // no sourceClassId
  // Only class: read as before.
  const one = world([klass(COMP, "Competencia", ["Lun", "Mié"], ["a"])], [{ id: "a", name: "A", combos: [legacy(MONWED_OCT)] }]);
  assert.equal(grey(one, COMP, "2026-11-30"), true);
  // Two classes on different days: the combo's dates say which one.
  const two = world([klass(COMP, "Competencia", ["Lun", "Mié"], ["a"]), klass(PRECOM, "Pre-Com", ["Mar", "Jue"], ["a"])], [{ id: "a", name: "A", combos: [legacy(TUETHU_OCT)] }]);
  assert.equal(grey(two, COMP, "2026-11-30"), false);
  assert.equal(grey(two, PRECOM, "2026-12-01"), true);
  // Two classes on the same days: ambiguous -> belongs to neither.
  const amb = world([klass(COMP, "Competencia", ["Lun", "Mié"], ["a"]), klass(TENIS, "Tenis", ["Lun", "Mié"], ["a"])], [{ id: "a", name: "A", combos: [legacy(MONWED_OCT)] }]);
  assert.equal(grey(amb, COMP, "2026-11-30"), false);
  assert.equal(grey(amb, TENIS, "2026-11-30"), false);
  // An orphan sourceClassId (no such class) is legacy data, placed by dates like a missing one.
  const orphan = world([klass(COMP, "Competencia", ["Lun", "Mié"], ["a"])], [{ id: "a", name: "A", combos: [combo(MONWED_OCT, { sourceClassId: 999 })] }]);
  assert.equal(grey(orphan, COMP, "2026-11-30"), true);
  // A legacy individual from a class the student no longer attends: no holder -> ambiguous -> ignored.
  const gone = world([klass(COMP, "Competencia", ["Lun", "Mié"], ["a"])], [{ id: "a", name: "A", combos: [mensual(), { ...individual("2026-10-10"), sourceClassId: undefined }] }]);
  assert.equal(grey(gone, COMP, "2026-11-30"), false);
});

test("legacy mensual (no sourceClassId) belongs to the class only when the student has exactly one class", () => {
  const legacyMensual = mensual({ sourceClassId: undefined, date: "2026-10-20" });
  const st = { id: "a", name: "A", combos: [combo(MONWED_OCT, { sourceClassId: COMP }), legacyMensual] };
  assert.equal(grey(world([klass(COMP, "Competencia", ["Lun", "Mié"], ["a"])], [st]), COMP, "2026-11-30"), false);
  const two = world([klass(COMP, "Competencia", ["Lun", "Mié"], ["a"]), klass(PRECOM, "Pre-Com", ["Mar", "Jue"], ["a"])], [st]);
  assert.equal(grey(two, COMP, "2026-11-30"), true, "ambiguous mensual: not assumed, the ended combo still greys");
  assert.equal(M.mensualClassMembership({ combo: legacyMensual, seriesId: COMP, studentId: "a", classes: two.classes, knownSeriesIds: two.scope.knownSeriesIds }), "ambiguous");
});

test("Renovar Combo only ever renews combos of this class (never another class's, never before a current mensual)", () => {
  const st = { id: "a", name: "A", combos: [combo(TUETHU_OCT, { sourceClassId: PRECOM, id: 7 }), combo(MONWED_OCT, { sourceClassId: COMP, id: 8 })] };
  const w = world([klass(COMP, "Competencia", ["Lun", "Mié"], ["a"]), klass(PRECOM, "Pre-Com", ["Mar", "Jue"], ["a"])], [st]);
  assert.deepEqual(A.classCombosOfCard(st, card(w, COMP, "2026-11-30"), w.scope).map((c) => c.id), [8]);
  const men = { id: "a", name: "A", combos: [combo(MONWED_OCT, { sourceClassId: COMP }), mensual({ date: "2026-10-20" })] };
  assert.deepEqual(A.classCombosOfCard(men, card(world([klass(COMP, "C", ["Lun", "Mié"], ["a"])], [men]), COMP, "2026-11-30"), { classes: [klass(COMP, "C", ["Lun", "Mié"], ["a"])] }), []);
  assert.match(SRC, /const renewableCombosOf=\(st\)=>classCombosOfCard\(st,clsForCheck,greyScope\)\.filter\(x=>x\.total>0&&x\.packType!=="mensual"&&x\.packType!=="individual"\);/);
  assert.match(SRC, /const classCombos=renewableCombosOf\(st\);/);
  assert.match(SRC, /return renewableCombosOf\(st\)\.length>0;/);
  assert.match(SRC, /packType:lastCombo\.packType\|\|"combo",sourceClassId:c\._seriesId\|\|c\.id,/, "the renewed combo is stamped with this class");
});

test("Agenda wiring: grey card, week view, Asistencia lock and Renovar all read the class scope", () => {
  assert.match(SRC, /const greyScope=\{classes:greyScopeClasses,knownSeriesIds:new Set\(\(greyScopeClasses\|\|\[\]\)\.map\(seriesIdOf\)\)\};/);
  assert.equal((SRC.match(/isNextComboPending\(c,students,greyScope\)/g) || []).length, 3);
  assert.match(SRC, /isNextComboPending\(clsForCheck,students,greyScope\)/);
  assert.doesNotMatch(SRC, /isNextComboPending\([^)]*,students\)/, "no call left without its class scope");
});

test("Pausar (end of package): same grey reading for the class's combos; a mensual or another class's combo changes nothing", () => {
  const OLD = ["2026-11-02", "2026-11-04", "2026-11-09", "2026-11-11", "2026-11-16", "2026-11-18", "2026-11-23", "2026-11-30"];
  const series = klass(COMP, "Competencia", ["Lun", "Mié"], ["a"]);
  const base = { id: "a", name: "A", combos: [combo(OLD, { sourceClassId: COMP, paidCount: 8, used: 6 })] };
  const target = (st) => A.resolveEndOfPackageTarget({ series, students: [st], slotDate: "2026-11-30", todayDate: "2026-11-26", knownSeriesIds: new Set([COMP, PRECOM]) });
  const r = target(base);
  assert.equal(r.ok, true);
  assert.equal(r.date, "2026-12-02", "first grey occurrence after the package");
  assert.equal(target({ ...base, combos: [...base.combos, mensual({ sourceClassId: COMP, date: "2026-09-01" })] }).date, "2026-12-02", "mensual ignored here, as before");
  assert.equal(target({ ...base, combos: [...base.combos, combo(["2026-12-03", "2026-12-08"], { sourceClassId: PRECOM })] }).date, "2026-12-02", "another class's combo ignored");
  assert.match(SRC, /isNextComboPending\(\{id:seriesId,date:g,students:\[a\.studentId\],dateCancellations:dc,_isRescheduledInstance:false\},students,\{classes:\[series\],knownSeriesIds,ignoreMensual:true\}\)/);
});

test("membership helpers are pure and string-tolerant", () => {
  const classes = [klass(COMP, "C", ["Lun", "Mié"], ["a"])];
  const c = combo(MONWED_OCT, { sourceClassId: String(COMP) });
  const frozen = JSON.stringify({ classes, c });
  assert.equal(M.comboClassMembership({ combo: c, seriesId: COMP, studentId: "a", classes, knownSeriesIds: new Set([COMP]) }), "own");
  assert.equal(M.comboClassMembership({ combo: combo(MONWED_OCT, { sourceClassId: PRECOM }), seriesId: COMP, studentId: "a", classes }), "other");
  assert.equal(JSON.stringify({ classes, c }), frozen);
});
