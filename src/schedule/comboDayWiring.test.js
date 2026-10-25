import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Source checks for the React parts of "Agregar día al combo".
const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
const slice = (from, to) => {
  const a = app.indexOf(from);
  assert.ok(a >= 0, "missing: " + from);
  const b = app.indexOf(to, a + from.length);
  assert.ok(b > a, "missing end: " + to);
  return app.slice(a, b);
};

test("orchestrator: one students write re-planned on the latest state with the exact preview, then the class, each confirmed", () => {
  const orch = slice("const addComboDay=async(", "  };\n");
  const students = orch.indexOf("const {promise}=commitStudentsBatch(latest=>{");
  const replan = orch.indexOf("planComboDayAddition({classes:latestClassesRef.current,students:latest,seriesId,date,todayDate:today})", students);
  const signature = orch.indexOf('if(plan.signature!==expected){refused={reason:"changed"};return null;}', replan);
  const awaitStudents = orch.indexOf("const studentsResult=await promise;", signature);
  const classes = orch.indexOf("await setClasses(p=>p.map(c=>c.id===seriesId?applyAdditionToClassRow(c,{opId,date,studentIds,at}):c));", awaitStudents);
  assert.ok(students > 0 && replan > students && signature > replan && awaitStudents > signature && classes > awaitStudents, "order");
  assert.match(orch, /if\(!writeConfirmed\(studentsResult\)\) return/);
  assert.match(orch, /if\(!writeConfirmed\(classesResult\)\) return/);
  assert.match(orch, /!isClassesWriteSettled\(\)/);
  assert.match(orch, /releaseInFlightRef\.current\.delete\(key\);/);
});

test("recovery finishes a pending class part of an addition, idempotently and only when settled", () => {
  const rec = slice("completePendingReleasesRef.current=()=>{", "useEffect(()=>{ completePendingReleasesRef.current(); }");
  assert.match(rec, /if\(!isClassesWriteSettled\(\)\) return;/);
  assert.match(rec, /findPendingAdditionCompletions\(latestClassesRef\.current,latestStudentsRef\.current\)/);
  assert.match(rec, /applyAdditionToClassRow\(c,pending\)/);
});

test("Agenda: the action shows only for a class with a current combo; the modal previews and confirms with the signature", () => {
  assert.match(app, /<Agenda onReleaseAndRenew=\{releaseAndRenew\} onAddComboDay=\{addComboDay\} /);
  assert.match(app, /\{onAddComboDay&&hasCurrentComboForDayAddition\(\{series:/);
  assert.match(app, /<AddComboDayModal series=\{\(rawClasses\|\|classes\)\.find\(cl=>cl\.id===addDayFor\)\} classes=\{rawClasses\|\|classes\} students=\{students\} onConfirm=\{onAddComboDay\}/);
  const modal = slice("function AddComboDayModal(", "\nfunction ");
  assert.match(modal, /planComboDayAddition\(\{classes,students,seriesId:series\.id,date,todayDate:todayIso\(\)\}\)/);
  assert.match(modal, /onConfirm\(\{seriesId:series\.id,date,expected:plan\.signature\}\)/);
  assert.equal((modal.match(/onConfirm\(/g) || []).length, 1, "the only write path is the confirm button");
  assert.match(modal, /Se agrega: /);
  assert.match(modal, /Se quita: /);
  assert.match(modal, /clases, sin cambios/);
  assert.ok(modal.indexOf("useState(false)") < modal.indexOf("return ("), "hooks first");
});

test("Editar clase keeps added dates when it regenerates the occurrences", () => {
  const regen = slice("const preserved=(cls.occurrences||[]).filter(d=>d<sd);", "// Only send studentPacks");
  assert.match(regen, /const addedKeep=\(cls\.addedDates\|\|\[\]\)\.map\(a=>a&&a\.date\)/);
  assert.match(regen, /newOccurrences=\[\.\.\.new Set\(\[\.\.\.preserved,\.\.\.result,\.\.\.addedKeep\]\)\]\.sort\(\);/);
});
