/*
 * Limits of the class-payment stepper in Detalles de Pagos (pure, no React).
 *
 * The stepper pays only rows that already exist: payableRows (pending or given-unpaid,
 * not cancelled, not paused), and the write pays exactly payableRows.slice(0, qty).
 * Paying them never generates dates, so a class without weekly days (an Individual
 * class with a fixed date, or a student whose first class has no days) must not block
 * paying real pending classes. The weekly calendar is needed only to generate new
 * dates; on this screen it can block only when there is nothing real to pay.
 */
export function classPaymentLimits({ payableCount, classHasNoCalendar }) {
  const available = Number.isInteger(payableCount) && payableCount > 0 ? payableCount : 0;
  return {
    // The stepper never goes above the real pending rows.
    maxClasses: available,
    // Warning and refusal only when the class has no calendar AND nothing exists to pay.
    blockedByNoCalendar: Boolean(classHasNoCalendar) && available === 0,
  };
}

/**
 * Whether a requested quantity can be paid as-is: at least one class and never more than
 * the pending rows that exist right now (a stale quantity is refused, never truncated
 * silently while the amount stays the same).
 */
export function isPayableClassQuantity(qty, payableCount) {
  return Number.isInteger(qty) && qty > 0 && Number.isInteger(payableCount) && qty <= payableCount;
}
