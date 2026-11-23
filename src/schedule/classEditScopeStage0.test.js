import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanCombosAfterClassRemoval,
  comboDatesLeftWithoutCard,
  editableFromCard,
  editRefusalMessage,
  keepDatesWithHistory,
  regenerateOccurrences,
  seriesFieldsFromEdit,
  studentRemovalBlock,
} from "./classEditScope.js";

// BUG-AGENDA-05 stage 0. Fictitious data; "today" = Wed 25/11/2026.
const TODAY = "2026-11-25";
const MON_WED = new Set([1, 3]);
const TUE_THU = new Set([2, 4]);
const days = (from, to, dow) => {
  const out = [];
  for (let d = new Date(from + "T12:00:00"); d <= new Date(to + "T12:00:00"); d.setDate(d.getDate() + 1)) {
    if (dow.has(d.getDay())) out.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"));
  }
  return out;
};
const monWed = days("2026-09-28", "2027-03-28", MON_WED);

// ---------- 0.1 regeneration ----------

test("0.1: a weekday change regenerates from the selected date; every earlier date is kept exactly", () => {
  const out = regenerateOccurrences({ previous: monWed, dowSet: TUE_THU, fromDate: "2026-12-07", todayDate: TODAY });
  const before = monWed.filter((d) => d < "2026-12-07");
  assert.deepEqual(out.filter((d) => d < "2026-12-07"), before, "dates before the change point unchanged");
  const after = out.filter((d) => d >= "2026-12-07");
  assert.ok(after.every((d) => [2, 4].includes(new Date(d + "T12:00:00").getDay())), "only new weekdays after");
  assert.equal(after[0], "2026-12-08");
  assert.equal(after[after.length - 1], "2027-06-03", "6 months after the change point");
});

test("0.1: a past selected card applies from today; no past date is generated", () => {
  const out = regenerateOccurrences({ previous: monWed, dowSet: TUE_THU, fromDate: "2026-10-05", todayDate: TODAY });
  assert.deepEqual(out.filter((d) => d < TODAY), monWed.filter((d) => d < TODAY));
  assert.ok(!out.includes("2026-10-06") && !out.includes("2026-11-24"), "no invented past Tuesday");
  assert.ok(out.includes("2026-11-26"), "first new date from today");
});

test("0.1: the class end date bounds the horizon; protected and added dates after the change point stay", () => {
  const out = regenerateOccurrences({
    previous: [...monWed, "2026-12-11"],
    dowSet: TUE_THU,
    fromDate: TODAY,
    todayDate: TODAY,
    endDate: "2026-12-31",
    addedDates: [{ id: "a", date: "2026-12-11" }],
    dateCancellations: { "2026-12-14": { cancelType: "paused", rescheduledTo: null } },
  });
  assert.equal(out.filter((d) => d > "2026-12-31").length, 0, "nothing after the end date");
  assert.ok(out.includes("2026-12-11"), "added date");
  assert.ok(out.includes("2026-12-14"), "paused date");
  assert.ok(!out.includes("2026-12-16"), "clean old weekday after the change point goes");
  assert.ok(out.includes("2026-12-31"), "end date itself (Thursday)");
});

test("0.1: no valid weekday or no change point changes nothing", () => {
  assert.deepEqual(regenerateOccurrences({ previous: ["2026-12-02", "2026-11-30"], dowSet: new Set(), fromDate: TODAY, todayDate: TODAY }), ["2026-11-30", "2026-12-02"]);
  assert.deepEqual(regenerateOccurrences({ previous: ["2026-12-02"], dowSet: TUE_THU }), ["2026-12-02"]);
});

test("0.1: on save, a past date that was not an occurrence is rejected; past occurrences stay", () => {
  const out = keepDatesWithHistory({ previous: ["2026-11-23", "2026-11-30"], next: ["2026-11-17", "2026-11-26"], todayDate: TODAY });
  assert.deepEqual(out, ["2026-11-23", "2026-11-26"]);
});

const series = (extra) => ({ id: 100, days: ["Lun", "Mié"], students: ["juan", "pedro", "ana"], occurrences: monWed, attendanceLog: [], dateCancellations: {}, ...extra });
const combo = (extra) => ({ id: 1, packType: "combo", total: 8, sourceClassId: 100, used: 0, paidCount: 0, payments: [], dates: ["2026-11-23", "2026-11-25", "2026-11-30", "2026-12-02", "2026-12-07", "2026-12-09", "2026-12-14", "2026-12-16"], ...extra });

test("0.1: lost future combo / individual dates block the change and name the students; mensual never does", () => {
  const students = [
    { id: "juan", name: "Juan", combos: [combo()] },
    { id: "pedro", name: "Pedro", combos: [combo({ packType: "individual", total: 2, dates: ["2026-11-30", "2026-12-02"] })] },
    { id: "ana", name: "Ana", combos: [{ id: 1, packType: "mensual", sourceClassId: 100, dates: [], mensualidades: [] }] },
  ];
  const next = regenerateOccurrences({ previous: monWed, dowSet: TUE_THU, fromDate: TODAY, todayDate: TODAY });
  const lost = comboDatesLeftWithoutCard({ series: series(), students, nextOccurrences: next, todayDate: TODAY });
  assert.deepEqual(lost.map((x) => x.name), ["Juan", "Pedro"]);
  // the change applies from today inclusive, so today's class (a Wednesday) also loses its card
  assert.deepEqual(lost[0].dates, ["2026-11-25", "2026-11-30", "2026-12-02", "2026-12-07", "2026-12-09", "2026-12-14", "2026-12-16"]);
  assert.match(editRefusalMessage({ status: "weekday-change-blocked", affected: lost }), /Juan \(7 fechas\) y Pedro \(2 fechas\)/);
});

test("0.1: the change is allowed when no future combo date would lose its card", () => {
  const students = [{ id: "juan", name: "Juan", combos: [combo({ dates: ["2026-11-16", "2026-11-18"] })] }]; // finished
  const next = regenerateOccurrences({ previous: monWed, dowSet: TUE_THU, fromDate: TODAY, todayDate: TODAY });
  assert.deepEqual(comboDatesLeftWithoutCard({ series: series(), students, nextOccurrences: next, todayDate: TODAY }), []);
  // same days (title/time edit): nothing lost
  assert.deepEqual(comboDatesLeftWithoutCard({ series: series(), students: [{ id: "juan", name: "Juan", combos: [combo()] }], nextOccurrences: monWed, todayDate: TODAY }), []);
  // a future combo date that is reprogrammed keeps its card (dateCancellations) -> not lost
  const s2 = series({ dateCancellations: { "2026-12-16": { cancelType: "cancelled_reprog", rescheduledTo: "2026-12-18" } } });
  const lost = comboDatesLeftWithoutCard({ series: s2, students: [{ id: "juan", name: "Juan", combos: [combo()] }], nextOccurrences: regenerateOccurrences({ previous: monWed, dowSet: TUE_THU, fromDate: TODAY, todayDate: TODAY, dateCancellations: s2.dateCancellations }), todayDate: TODAY });
  assert.ok(!lost[0].dates.includes("2026-12-16"));
  // an older gap (date already not an occurrence) is not this edit's doing
  const gap = comboDatesLeftWithoutCard({ series: series({ occurrences: monWed.filter((d) => d !== "2026-12-07") }), students: [{ id: "juan", name: "Juan", combos: [combo()] }], nextOccurrences: monWed.filter((d) => d !== "2026-12-07"), todayDate: TODAY });
  assert.deepEqual(gap, []);
  // another class's combo is not judged
  assert.deepEqual(comboDatesLeftWithoutCard({ series: series(), students: [{ id: "juan", name: "Juan", combos: [combo({ sourceClassId: 999 })] }], nextOccurrences: [], todayDate: TODAY }), []);
});

// ---------- 0.2 removal ----------

const removal = (studentCombos, extra) =>
  studentRemovalBlock({ series: series(extra), students: [{ id: "juan", name: "Juan", combos: studentCombos }, { id: "pedro", name: "Pedro", combos: [] }], nextStudentIds: ["pedro", "ana"] });

test("0.2: a student added by mistake (no history) can be removed", () => {
  assert.deepEqual(removal([combo()]), []);
  assert.deepEqual(removal([]), []);
});

test("0.2: payments, paid months, attendance, used classes and class history block the removal", () => {
  assert.deepEqual(removal([combo({ payments: [{ id: 1, amount: 100 }] })])[0].reasons, ["pagos"]);
  assert.deepEqual(removal([combo({ paidCount: 3 })])[0].reasons, ["pagos"]);
  assert.deepEqual(removal([combo({ paid: true })])[0].reasons, ["pagos"]);
  assert.deepEqual(removal([{ id: 2, packType: "mensual", sourceClassId: 100, dates: [], mensualidades: [{ mes: "2026-11", estado: "pagado" }] }])[0].reasons, ["mensualidades pagadas"]);
  assert.deepEqual(removal([combo({ used: 1 })])[0].reasons, ["asistencia"]);
  assert.deepEqual(removal([combo()], { attendanceLog: [{ date: "2026-11-23", present: [], ausente_dada: [], ausente_reprog: ["juan"] }] })[0].reasons, ["asistencia"]);
  assert.deepEqual(removal([combo({ slotRelocations: [{ id: "r" }] })])[0].reasons, ["historial de clases"]);
  assert.deepEqual(removal([combo()], { dateCancellations: { "2026-12-07": { cancelType: "paused", rescheduledTo: null } } })[0].reasons, ["historial de clases"]);
  const msg = editRefusalMessage({ status: "student-removal-blocked", blocked: removal([combo({ paidCount: 3, used: 2 })]) });
  assert.match(msg, /No se puede quitar de esta clase a Juan \(pagos, asistencia\): tiene historial registrado\./);
});

test("0.2: a combo of another class is not judged; a deleted student or a kept student is never blocked", () => {
  assert.deepEqual(removal([combo({ sourceClassId: 999, paidCount: 8 })]), []);
  const r = studentRemovalBlock({ series: series({ students: ["ghost", "juan"] }), students: [{ id: "juan", name: "Juan", combos: [combo({ paidCount: 8 })] }], nextStudentIds: ["juan"] });
  assert.deepEqual(r, []);
});

test("0.2: legacy combos without sourceClassId are judged exactly as the removal cleans them", () => {
  const legacyPaid = { id: 3, packType: "combo", total: 2, dates: ["2026-11-30", "2026-12-02"], paidCount: 2 };
  assert.deepEqual(removal([legacyPaid])[0].reasons, ["pagos"]);
  const legacyOther = { id: 4, packType: "combo", total: 2, dates: ["2026-11-03", "2026-11-05"], paidCount: 2 }; // Tue/Thu: not this class
  assert.deepEqual(removal([legacyOther]), []);
});

test("0.2: the cleaning helper is the previous removal logic, unchanged", () => {
  const classDates = new Set(["2026-11-30", "2026-12-02"]);
  const out = cleanCombosAfterClassRemoval(
    [combo({ dates: ["2026-11-30", "2026-12-02"] }), combo({ id: 2, dates: ["2026-11-30", "2027-01-04"] }), combo({ id: 3, sourceClassId: 999 })],
    100,
    classDates
  );
  assert.equal(out.length, 2, "fully contained combo deleted");
  assert.deepEqual(out[0], { ...combo({ id: 2, dates: ["2027-01-04"] }), total: 1, date: "2027-01-04" });
  assert.equal(out[1].sourceClassId, 999);
});

// ---------- 0.3 card state ----------

test("0.3: an edit carries no card state; A Todas merges no card id or scope flag", () => {
  const card = { id: 100, _seriesId: 100, _virtualId: "100_2026-12-07", date: "2026-12-07", title: "T", days: ["Lun"], cancelled: true, cancelType: "paused", paused: true, rescheduledTo: "x", rescheduled: true, _isRescheduledInstance: true, attendanceLog: [{ date: "2026-12-07" }], _resuming: true, _reactivating: true, _plannedResumeDate: "y", _endOfPackage: "z" };
  const edit = editableFromCard(card);
  assert.deepEqual(edit, { id: 100, _seriesId: 100, _virtualId: "100_2026-12-07", date: "2026-12-07", title: "T", days: ["Lun"] });
  assert.deepEqual(seriesFieldsFromEdit({ ...edit, applyToAll: true, _singleDate: true }), { id: 100, date: "2026-12-07", title: "T", days: ["Lun"] });
  assert.equal(card.cancelled, true, "the card itself is not mutated");
});

test("refusal messages: unknown results are not refusals", () => {
  assert.equal(editRefusalMessage(undefined), "");
  assert.equal(editRefusalMessage({ status: "confirmed" }), "");
  assert.match(editRefusalMessage({ status: "single-date-edit-refused", changes: ["días"] }), /Solo esta clase no puede cambiar días/);
});
