// Test-only (never imported by the app): fictitious students and classes that exercise every per-slot reading
// Cobros does today — attendance mix, time-based fallback, reprogramming chain, pending reprogramming, definitive
// cancellation, pause + resume replacement (displaced slot), released date (slotRelocations), partial payments,
// individual pack, and a legacy single class without dateCancellations. "Today" is pinned by the test to
// 2026-11-21 12:00 (Saturday).
export const NOW = "2026-11-21T12:00:00";

const SERIES = 200;
const LEGACY = 300;
const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const monWed = (() => {
  const o = [];
  for (let d = new Date("2026-10-05T12:00:00"); iso(d) <= "2027-01-31"; d.setDate(d.getDate() + 1)) if ([1, 3].includes(d.getDay())) o.push(iso(d));
  return o;
})();
const entry = (date, present = [], ausente_dada = [], ausente_reprog = []) => ({ date, day: "x", present, ausente_dada, ausente_reprog });

export function slotReaderFixture() {
  const series = {
    id: SERIES, title: "Ficticia L/M", days: ["Lun", "Mié"], time: "18:00", timeEnd: "19:00", students: [1, 2, 3, 4],
    startDate: monWed[0], date: monWed[0], occurrences: [...monWed, "2026-10-30", "2026-11-25"],
    cancelledDates: [], rescheduledDates: [],
    dateCancellations: {
      "2026-10-26": { cancelType: "cancelled_reprog", rescheduledTo: "2026-11-06" },
      "2026-11-02": { cancelType: "paused", rescheduledTo: null, compensated: true, compensatedBy: "op1" },
      "2026-11-09": { cancelType: "cancelled", rescheduledTo: null },
      "2026-11-11": { cancelType: "cancelled_reprog", rescheduledTo: null },
      "2026-11-30": { cancelType: "paused", rescheduledTo: null },
    },
    attendanceLog: [
      entry("2026-10-05", [1, 2, 4]),
      entry("2026-10-07", [1, 2], [], [4]),
      entry("2026-10-12", [2], [1]),
      entry("2026-10-14", [2], [], [1]),
      entry("2026-10-21", [1, 2]),
      entry("2026-10-30", [4]),
      entry("2026-11-06", [2]),
      entry("2026-11-16", [3]),
      entry("2026-11-18", [], [], [3]),
    ],
  };
  const legacy = { id: LEGACY, title: "Legacy individual", days: [], time: "10:00", timeEnd: "11:00", students: [5], date: "2026-11-10", cancelled: true, cancelType: "cancelled_reprog", rescheduledTo: "2026-11-12", attendanceLog: [] };
  const students = [
    // 1: attendance mix (present, ausente-dada, ausente-no-dada, no record in the past, future), 5 of 8 paid
    { id: 1, name: "Uno", combos: [{ id: 1, total: 8, packType: "combo", sourceClassId: SERIES, used: 4, paid: false, paidCount: 5, amount: 400000,
      payments: [{ id: 1, qty: 5, amount: 250000, dates: [] }], dates: ["2026-10-05", "2026-10-07", "2026-10-12", "2026-10-14", "2026-10-19", "2026-10-21", "2026-11-23", "2026-12-07"] }] },
    // 2: reprogramming chain given at the destination, compensated pause + resume replacement (9 dates for 8),
    //    definitive cancellation, pending reprogramming, active pause; fully paid
    { id: 2, name: "Dos", combos: [{ id: 1, total: 8, packType: "combo", sourceClassId: SERIES, used: 5, paid: true, paidCount: 8, amount: 400000,
      payments: [{ id: 1, qty: 8, amount: 400000, dates: [] }],
      resumeOperations: [{ id: "op1", pausedDates: ["2026-11-02"], replacementDates: ["2026-11-25"] }],
      dates: ["2026-10-05", "2026-10-07", "2026-10-12", "2026-10-26", "2026-11-02", "2026-11-09", "2026-11-11", "2026-11-25", "2026-11-30"] }] },
    // 3: individual pack in the group class, 1 of 3 paid
    { id: 3, name: "Tres", combos: [{ id: 1, total: 3, packType: "individual", sourceClassId: SERIES, used: 1, paid: false, paidCount: 1, amount: 90000,
      payments: [{ id: 1, qty: 1, amount: 30000, dates: [] }], dates: ["2026-11-16", "2026-11-18", "2026-11-23"] }] },
    // 4: a released date (slot moved to its real date 30/10), unpaid, plus an ausente-no-dada
    { id: 4, name: "Cuatro", combos: [{ id: 1, total: 4, packType: "combo", sourceClassId: SERIES, used: 2, paid: false, paidCount: 0, amount: 200000, payments: [],
      slotRelocations: [{ id: "rel1", from: "2026-10-28", to: "2026-10-30", classId: SERIES, at: "2026-10-31" }],
      dates: ["2026-10-05", "2026-10-07", "2026-10-30", "2026-12-02"] }] },
    // 5: legacy individual class without dateCancellations (card flags only)
    { id: 5, name: "Cinco", combos: [{ id: 1, total: 1, packType: "individual", used: 0, paid: true, paidCount: 1, amount: 50000,
      payments: [{ id: 1, qty: 1, amount: 50000, dates: [] }], dates: ["2026-11-10"] }] },
  ];
  return { classes: [series, legacy], students };
}
