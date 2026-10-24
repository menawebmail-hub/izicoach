/*
 * Which badges a slot row shows (presentation only, pure — BUG-COBROS-02).
 *
 * Used by SlotGroup (Cobros → Detalles de Pagos and the Student Portal). A slot row has a
 * state badge (Reprogramada, Realizada, Pausada…) and a payment badge (Pagada, Pendiente…).
 * Each date of a reschedule chain shows a single badge:
 *   - original and intermediate dates: only the state badge ("🔄 Reprogramada");
 *   - the final date when it was done and is paid: only the payment badge ("✓ Pagada");
 *   - any other final state, and every date of a slot that was never rescheduled: both
 *     badges, exactly as before.
 * It never changes what is paid, given or rescheduled; it only decides what is drawn.
 */
export function slotRowBadges({ rescheduled, isTerminal, status, paid }) {
  if (!rescheduled) return { state: true, payment: true };
  if (!isTerminal) return { state: true, payment: false };
  if (status === "done" && paid) return { state: false, payment: true };
  return { state: true, payment: true };
}
