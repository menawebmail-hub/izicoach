import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { slotRowBadges } from "./slotRowBadges.js";

// Regression (BUG-COBROS-02): in Detalles de Pagos (Pato Ojeda) and the Student Portal, every
// date of a reschedule chain showed two badges, "Reprogramada" and "Pagada", because the slot's
// payment status is repeated on every step. One badge per date of the chain.

const STATE_ONLY = { state: true, payment: false };
const PAYMENT_ONLY = { state: false, payment: true };
const BOTH = { state: true, payment: true };

/** The badges SlotGroup draws for a chain: the numbered original row, then one row per step. */
function chain(statuses, paid) {
  const rows = statuses.map((status, depth) => ({ depth, status, isTerminal: depth === statuses.length - 1 }));
  const main = slotRowBadges({ rescheduled: rows.length > 1, isTerminal: rows.length <= 1, status: null, paid: false });
  const steps = rows.filter((r) => r.depth > 0).map((r) => slotRowBadges({ rescheduled: true, isTerminal: r.isTerminal, status: r.status, paid }));
  return [main, ...steps];
}

test("One reschedule, final done and paid: original 'Reprogramada', final 'Pagada'", () => {
  assert.deepEqual(chain(["reprogrammed", "done"], true), [STATE_ONLY, PAYMENT_ONLY]);
});

test("Multiple reschedules: original and every intermediate date 'Reprogramada', final 'Pagada'", () => {
  assert.deepEqual(chain(["reprogrammed", "reprogrammed", "reprogrammed", "done"], true), [STATE_ONLY, STATE_ONLY, STATE_ONLY, PAYMENT_ONLY]);
});

test("Original and intermediate dates never show a payment badge, paid or not", () => {
  for (const paid of [true, false]) {
    assert.deepEqual(slotRowBadges({ rescheduled: true, isTerminal: false, status: "reprogrammed", paid }), STATE_ONLY, String(paid));
  }
});

test("Other final states keep their current presentation (both badges)", () => {
  assert.deepEqual(chain(["reprogrammed", "done"], false), [STATE_ONLY, BOTH]); // Realizada + Pendiente
  for (const status of ["scheduled", "paused", "cancelled", "pending"]) {
    for (const paid of [true, false]) {
      assert.deepEqual(slotRowBadges({ rescheduled: true, isTerminal: true, status, paid }), BOTH, `${status} paid=${paid}`);
    }
  }
});

test("A final date being paid right now (paidNow) reads 'Pagada' only", () => {
  // SlotGroup passes paid = h.isPaid || paidNow.
  assert.deepEqual(slotRowBadges({ rescheduled: true, isTerminal: true, status: "done", paid: true }), PAYMENT_ONLY);
});

test("Dates without a reschedule are unchanged: both badges in every state", () => {
  for (const status of [null, "done", "scheduled", "paused", "cancelled", "pending"]) {
    for (const paid of [true, false]) {
      assert.deepEqual(slotRowBadges({ rescheduled: false, isTerminal: true, status, paid }), BOTH, `${status} paid=${paid}`);
    }
  }
  assert.deepEqual(chain(["done"], true), [BOTH]);
});

test("SlotGroup draws through slotRowBadges; the data and its helpers are untouched", () => {
  const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  const slotGroup = app.slice(app.indexOf("function SlotGroup("), app.indexOf("function IziLogoBlack("));
  assert.match(slotGroup, /const rescheduled=\(item\.historyRows\|\|\[\]\)\.length>1;/);
  assert.match(slotGroup, /\{mainBadges\.state&&pill\(left\.bg,left\.color,left\.label,"l"\)\}/);
  // A hidden payment badge leaves an invisible pill in its column (the state badge keeps its column).
  assert.match(slotGroup, /\{pill\(right\.bg,right\.color,right\.label,"r",!mainBadges\.payment\)\}/);
  assert.match(slotGroup, /const shown=slotRowBadges\(\{rescheduled,isTerminal:h\.isTerminal,status:h\.status,paid\}\);/);
  assert.match(slotGroup, /\{shown\.state&&pill\(/);
  assert.match(slotGroup, /\{pill\(rBg,rCol,rLabel,"p",!shown\.payment\)\}/);
  assert.match(slotGroup, /aria-hidden=\{hidden\|\|undefined\}/);
  assert.match(slotGroup, /visibility:hidden\?"hidden":undefined/);
  // "Reprogramada" reuses the existing orange (Pausada's tokens); other states keep their colors.
  assert.match(app, /reprogrammed:\{bg:"#FFF3E0",color:"#E65100",icon:"🔄 ",text:"Reprogramada"\}/);
  assert.match(app, /paused:\{bg:"#FFF3E0",color:"#E65100",icon:"⏸ ",text:"Pausada"\}/);
  assert.match(app, /done:\{bg:"#E8F5E9",color:"#2E7D32",icon:"✓ ",text:"Realizada"\}/);
  // The main rows of Detalles de Pagos (2) and the Student Portal (2) read the same tokens.
  assert.equal((app.match(/leftBg=SLOT_BADGES\.reprogrammed\.bg;leftColor=SLOT_BADGES\.reprogrammed\.color;leftLabel="(🔄 )?Reprogramada";/g) || []).length, 4);
  assert.doesNotMatch(app, /leftBg="#E8F5E9";leftColor="#2E7D32";leftLabel="(🔄 )?Reprogramada"/);
  // Data unchanged: the history rows still carry the slot's payment status on every step.
  assert.match(app, /return \{date,depth,status,isPaid:!!displayPaid,isTerminal\};/);
  // Both views use the shared SlotGroup (Detalles de Pagos and the Student Portal).
  assert.equal((app.match(/<SlotGroup /g) || []).length, 2);
});
