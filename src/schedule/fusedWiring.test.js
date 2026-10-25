import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Source checks for "Separar clases fusionadas" and the reprogramming prevention (React parts of App.jsx).
const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
const slice = (from, to) => {
  const a = app.indexOf(from);
  assert.ok(a >= 0, "missing: " + from);
  const b = app.indexOf(to, a + from.length);
  assert.ok(b > a, "missing end: " + to);
  return app.slice(a, b);
};

test("prevention at write time: a dated reprogramming onto a conflicting date returns before any write", () => {
  const inter = slice('if((cd.cancelled===true||cd.cancelType==="paused"||cd._resuming||cd._reactivating)&&editDate){', "const classesWritePromise=setClasses(");
  const check = inter.indexOf("rescheduleDestinationConflict({series:latestClassesRef.current.find(c2=>c2.id===realId),students:latestStudentsRef.current,fromDate:editDate,destination:cd.rescheduledTo");
  const ret = inter.indexOf('if(conflict) return {status:"reprog-destination-conflict",reason:conflict};');
  assert.ok(check > 0 && ret > check, "checked on the latest state, returned before writing");
  assert.ok(inter.indexOf('if(cd.cancelled===true&&cd.cancelType==="cancelled_reprog"&&cd.rescheduledTo&&!cd._endOfPackage){') > 0 && inter.indexOf('&&!cd._endOfPackage){') < check);
});

test("prevention in the reprogramming modal: message, disabled confirm, and the write-time answer is honoured", () => {
  const modal = slice("function CancelReprogModal(", "\nfunction ");
  assert.match(modal, /const destConflict=selected==="reprog"&&newDate\?rescheduleDestinationConflict\(\{series,students,fromDate:cls\.date,destination:newDate,knownSeriesIds\}\):null;/);
  assert.match(modal, /\(\(!newDate&&!endChoice&&!reprogLater\)\|\|!!destConflict\)/);
  assert.match(modal, /\{destConflict&&<div role="alert"[^>]*>\{fusedMessage\(destConflict\)\}<\/div>\}/);
  assert.match(modal, /if\(destConflict\)\{alert\(fusedMessage\(destConflict\)\);return;\}/);
  assert.match(modal, /if\(r&&r\.status==="reprog-destination-conflict"\)\{alert\(fusedMessage\(r\.reason\)\);return;\}/);
});

test("repair orchestrator: re-plans on the latest state, writes only the exact confirmed preview, once", () => {
  const orch = slice("const repairFusedChains=async(", "const fusedRepair={");
  const plan = orch.indexOf("planFusedRepairChecked({classes:latestClassesRef.current,students:latestStudentsRef.current,seriesId,todayDate:todayIso()})");
  const compare = orch.indexOf("JSON.stringify(plan.before)!==JSON.stringify(expectedBefore)||JSON.stringify(plan.after)!==JSON.stringify(expectedAfter)");
  const write = orch.indexOf("const result=await setClasses(p=>p.map(c=>{");
  assert.ok(plan > 0 && compare > plan && write > compare, "plan, compare, then write");
  assert.match(orch, /applyFusedRepairToClassRow\(c,plan,\{opId,at\}\)/);
  assert.match(orch, /if\(!applied\) return \{status:"blocked",reason:"changed"\};/);
  assert.match(orch, /if\(!writeConfirmed\(result\)\) return \{status:"blocked",reason:"write-failed"\};/);
  assert.match(orch, /!isClassesWriteSettled\(\)/);
  assert.doesNotMatch(orch, /commitStudentsBatch|setStudents\(/); // never touches students (combos, payments)
});

test("Detalles de Pagos: notice with preview and explicit confirmation; threaded to every Cobros level", () => {
  assert.equal((app.match(/<FusedRepairNotice studentId=\{s\.id\} fusedRepair=\{fusedRepair\}\/>/g) || []).length, 2);
  const comp = slice("function FusedRepairNotice(", "\nfunction ");
  assert.match(comp, /Confirmar separación/);
  assert.match(comp, /fusedRepair\.run\(\{seriesId:found\.seriesId,expectedBefore:p\.before,expectedAfter:p\.after\}\)/);
  assert.match(comp, /No se marca ninguna asistencia automáticamente/);
  assert.equal((comp.match(/fusedRepair\.run\(/g) || []).length, 1, "the only write path is the confirm button");
  // Hooks come before any early return.
  assert.ok(comp.indexOf("useState(null)") < comp.indexOf("if(done) return"));
  assert.match(app, /<Finances releaseRenewal=\{releaseRenewal\} fusedRepair=\{fusedRepair\} /);
  assert.match(app, /<PaymentsTab releaseRenewal=\{releaseRenewal\} fusedRepair=\{fusedRepair\} /);
  assert.equal((app.match(/<PaymentCard (key=\{s\.id\} )?releaseRenewal=\{releaseRenewal\} fusedRepair=\{fusedRepair\} /g) || []).length, 2);
  assert.match(app, /<PagoModal releaseRenewal=\{releaseRenewal\} fusedRepair=\{fusedRepair\} /);
});
