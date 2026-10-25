import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Source checks for the parts of BUG-COMBO-01 and the date release that live inside React components.
const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
const slice = (from, to) => {
  const a = app.indexOf(from);
  assert.ok(a >= 0, "missing: " + from);
  const b = app.indexOf(to, a + from.length);
  assert.ok(b > a, "missing end: " + to);
  return app.slice(a, b);
};

test("BUG-COMBO-01: attendance recount and payment count read each slot where it happened", () => {
  const att = slice("const handleAttendance=(cls)=>{", "const releaseInFlightRef=useRef(new Set());");
  assert.match(att, /const newUsed=countAttendedSlots\(\{dates:targetDates,dc:seriesDc,attendanceLog:mergedLog,studentId:s\.id\}\);/);
  assert.match(att, /target\.sourceClassId===realId\|\|target\.sourceClassId===undefined/);
  assert.doesNotMatch(att, /targetDates\.filter\(d=>\{\s*const entry=mergedLog\.find/);
  const pay = slice("const givenCount=(c.dates||[]).filter(d=>{", "}).length;");
  assert.match(pay, /getSlotFulfillmentDate\(d,clsD&&clsD\.cancelled,clsD&&clsD\.cancelType,clsD&&clsD\.rescheduledTo\)/);
  assert.doesNotMatch(pay, /if\(d>TODAY_DATE\) return false;/);
});

test("release orchestrator: students first, then the class, then the renewal, each awaited and confirmed", () => {
  const orch = slice("const releaseAndRenew=async(", "const findReleaseRenewalFor=");
  const students = orch.indexOf("const {promise}=commitStudentsBatch(latest=>{");
  const plan = orch.indexOf("planRelease({classes:latestClassesRef.current,students:latest,", students);
  const awaitStudents = orch.indexOf("const studentsResult=await promise;", students);
  const classes = orch.indexOf("await setClasses(p=>p.map(c=>c.id===seriesId?applyReleaseToClassRow(c,state.record):c));");
  const renew = orch.indexOf("buildRenewalAfterRelease({classes:latestClassesRef.current,students:next,");
  const awaitRenew = orch.indexOf("const renewResult=await renewPromise;");
  assert.ok(students > 0 && plan > students && awaitStudents > plan && classes > awaitStudents && renew > classes && awaitRenew > renew, "order");
  // Re-validated on the latest state, refused writes never fall through, and a pending queue blocks it.
  assert.match(orch, /if\(!isClassesWriteSettled\(\)\) return \{status:"blocked",reason:"write-pending"\};/);
  assert.match(orch, /if\(!writeConfirmed\(studentsResult\)\) return/);
  assert.match(orch, /if\(!writeConfirmed\(classesResult\)\) return/);
  assert.match(orch, /else if\(state\.state!=="released"\) return \{status:"blocked",reason:"inconsistent"\};/);
  assert.match(orch, /releaseInFlightRef\.current\.delete\(key\);/);
  assert.match(orch, /todayIso\(\)/);
});

test("recovery: a half-done release is completed from the latest state, only when the classes queue is settled", () => {
  const eff = slice("// Recovery: a release whose students part is saved", "const [pendingReprog,setPendingReprog]");
  assert.match(eff, /useEffect\(\(\)=>\{ completePendingReleasesRef\.current\(\); \},\[classes,students,user\?\.id,dataReadyForCurrentIdentity\]\);/);
  assert.match(eff, /if\(!isClassesWriteSettled\(\)\) return;/);
  assert.match(eff, /findPendingReleaseCompletions\(latestClassesRef\.current,latestStudentsRef\.current\)/);
  assert.match(eff, /applyReleaseToClassRow\(c,pending\)/);
  assert.match(eff, /releaseInFlightRef\.current\.has\(key\)/);
});

test("Agenda: a releasable date reads grey and opens only the renewal, in the day and the week views", () => {
  assert.match(app, /<Agenda onReleaseAndRenew=\{releaseAndRenew\} /);
  assert.match(app, /const releaseCandidateOf=\(c\)=>\{/);
  assert.equal((app.match(/\{const rc=releaseCandidateOf\(c\);if\(rc\) return renderReleaseModal\(c,rc\);\}\s*\n\s*if\(resolveAgendaMenu\(c,resolveAgendaCardStatus\(c,students,classes,TODAY_DATE\),WEEK_AGO\)\.readOnly\) return renderRevertModal\(c\);/g) || []).length, 2);
  assert.match(app, /const isGreyCard=!!relCand\|\|isNextComboPending\(c,students\);/);
  assert.match(app, /const isReprogWithDate=cv\.cancelled&&cv\.cancelType==="cancelled_reprog"&&reprogTo;/);
  assert.match(app, /const canOpenMenu=!agMenu\.readOnly\|\|!!rvInfo\|\|!!relCand;/);
  assert.match(app, /const cvGrey=!!cvRel\|\|isNextComboPending\(c,students\);/);
  assert.match(app, /const canOpenMenu=!agMenu\.readOnly\|\|!!rvInfo\|\|!!cvRel;/);
  assert.match(app, /onReleaseAndRenew\(\{seriesId:cand\.seriesId,date:cand\.date\}\)/);
});

test("Cobros: both renewal buttons go through the same release first, for that student only", () => {
  assert.match(app, /<Finances releaseRenewal=\{releaseRenewal\} students=\{students\} classes=\{xClasses\} initialTab="payments"/);
  assert.match(app, /<PaymentsTab releaseRenewal=\{releaseRenewal\} /);
  assert.equal((app.match(/<PaymentCard (key=\{s\.id\} )?releaseRenewal=\{releaseRenewal\} /g) || []).length, 2);
  assert.match(app, /<PagoModal releaseRenewal=\{releaseRenewal\} /);
  assert.match(app, /if\(lastComboS&&renewThroughRelease\(releaseRenewal,s\.id\)\) return;/);
  assert.match(app, /if\(renewThroughRelease\(releaseRenewal,s\.id,onClose\)\) return;/);
  assert.match(app, /releaseRenewal\.run\(\{seriesId:cand\.seriesId,date:cand\.date,onlyStudentIds:\[studentId\]\}\)/);
  assert.match(app, /const releaseRenewal=\{find:findReleaseRenewalFor,run:releaseAndRenew\};/);
});

test("the chain walk lives in one place (src/schedule/rescheduleChain.js)", () => {
  assert.match(app, /import \{ resolveRescheduleChain, resolveComboDateStatus, traceRescheduleHistory \} from "\.\/schedule\/rescheduleChain\.js";/);
  for (const n of ["resolveRescheduleChain", "resolveComboDateStatus", "traceRescheduleHistory"]) {
    assert.doesNotMatch(app, new RegExp(`\\nconst ${n}=`), n);
  }
});
