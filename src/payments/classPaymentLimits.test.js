import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classPaymentLimits, isPayableClassQuantity } from "./classPaymentLimits.js";

// Regression: Cobros → Detalles de Pagos blocked the stepper at 0 ("Esta clase no tiene días
// configurados…") for a student with 10 given-unpaid Individual classes, because the first
// class the student belongs to has no weekly days. Paying existing rows never needs a calendar.

test("Individual classes without weekly days: every real pending class can be paid", () => {
  const limits = classPaymentLimits({ payableCount: 10, classHasNoCalendar: true });
  assert.deepEqual(limits, { maxClasses: 10, blockedByNoCalendar: false });
  for (let qty = 1; qty <= 10; qty += 1) assert.equal(isPayableClassQuantity(qty, 10), true, `qty ${qty}`);
  assert.equal(isPayableClassQuantity(11, 10), false);
});

test("Student in several classes whose FIRST class has no weekly days: pending rows stay payable", () => {
  // classHasNoCalendar is computed from the first class (myClasses[0].days); the rows come from
  // every obligation (Combo + Individual). The block must not hide them.
  const limits = classPaymentLimits({ payableCount: 3, classHasNoCalendar: true });
  assert.equal(limits.maxClasses, 3);
  assert.equal(limits.blockedByNoCalendar, false);
});

test("A class with weekly days behaves as before", () => {
  assert.deepEqual(classPaymentLimits({ payableCount: 4, classHasNoCalendar: false }), { maxClasses: 4, blockedByNoCalendar: false });
});

test("No calendar and nothing real to pay: still blocked (nothing to pay, no dates invented)", () => {
  assert.deepEqual(classPaymentLimits({ payableCount: 0, classHasNoCalendar: true }), { maxClasses: 0, blockedByNoCalendar: true });
});

test("Nothing pending with a calendar: cap 0, no no-calendar warning", () => {
  assert.deepEqual(classPaymentLimits({ payableCount: 0, classHasNoCalendar: false }), { maxClasses: 0, blockedByNoCalendar: false });
});

test("Malformed counts never open the stepper", () => {
  for (const payableCount of [undefined, null, -1, 2.5, NaN, "3"]) {
    assert.equal(classPaymentLimits({ payableCount, classHasNoCalendar: false }).maxClasses, 0, String(payableCount));
  }
});

test("No duplicate or stale payment: a quantity above the CURRENT pending rows is refused", () => {
  // After paying 10 of 10, the pending rows are 0: re-confirming the same quantity is refused.
  assert.equal(isPayableClassQuantity(10, 0), false);
  // Rows shrank while the modal was open (another payment): refused, never silently truncated.
  assert.equal(isPayableClassQuantity(5, 3), false);
  for (const qty of [0, -1, 1.5, NaN, undefined]) assert.equal(isPayableClassQuantity(qty, 10), false, String(qty));
});

test("PagoModal uses these limits (the stepper is no longer capped at 0 by classHasNoCalendar)", () => {
  const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  assert.match(app, /const classPayment=classPaymentLimits\(\{payableCount:payableRows\.length,classHasNoCalendar\}\);/);
  assert.match(app, /const maxUnpaid=classPayment\.maxClasses;/);
  assert.doesNotMatch(app, /maxUnpaid=classHasNoCalendar\?0/);
  assert.doesNotMatch(app, /disabled=\{classHasNoCalendar\}/);
  // The payment write still pays exactly the rows the stepper selected.
  assert.match(app, /const selectedRows=payableRows\.slice\(0,qty\);/);
  // payableRows: pending or given-unpaid only, never cancelled or paused (unchanged).
  assert.match(app, /const payableRows=allDates\.filter\(d=>\(d\.status==="pendiente"\|\|d\.status==="dada_unpaid"\)&&!d\.isCancelled&&!d\.isPaused\);/);
  // Both write paths refuse a stale quantity.
  assert.equal((app.match(/isPayableClassQuantity\(parseInt\(localClasses\)\|\|0,payableRows\.length\)/g) || []).length, 2);
});
