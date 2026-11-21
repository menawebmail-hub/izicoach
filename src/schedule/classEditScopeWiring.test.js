import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Source checks for the React parts of BUG-AGENDA-05 (phase 1 + stage 0): Editar clase scope and save guards.
const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
const slice = (from, to) => {
  const a = app.indexOf(from);
  assert.ok(a >= 0, "missing: " + from);
  const b = app.indexOf(to, a + from.length);
  assert.ok(b > a, "missing end: " + to);
  return app.slice(a, b);
};

test("scope modal: both choices are disabled and explained when refused, and every refusal is honoured", () => {
  const modal = slice("{editScopeData&&(", "{editCls&&<EditClassScreen");
  assert.match(modal, /const scopeSeries=\(rawClasses\|\|classes\)\.find\(c2=>c2\.id===\(editScopeData\._seriesId\|\|editScopeData\.id\)\);/);
  assert.match(modal, /singleDateEditChanges\(scopeSeries,editScopeData,students\.map\(s=>s\.id\)\)/);
  assert.match(modal, /comboDatesLeftWithoutCard\(\{series:scopeSeries,students,nextOccurrences:editScopeData\.occurrences,todayDate:todayIso\(\)\}\)/);
  assert.match(modal, /studentRemovalBlock\(\{series:scopeSeries,students,nextStudentIds:editScopeData\.students\}\)/);
  assert.match(modal, /<button disabled=\{singleDateBlocked\} onClick=\{\(\)=>\{const r=onSaveClass\(\{\.\.\.editScopeData,_singleDate:true\},true\);const msg=editRefusalMessage\(r\);if\(msg\)\{alert\(msg\);return;\}/);
  assert.match(modal, /<button disabled=\{allBlocked\} onClick=\{\(\)=>\{const r=onSaveClass\(\{\.\.\.editScopeData,applyToAll:true\},true\);const msg=editRefusalMessage\(r\);if\(msg\)\{alert\(msg\);return;\}/);
  assert.match(modal, /\{singleDateBlocked&&<div role="alert"[^>]*>\{singleDateEditMessage\(singleDateChanges\)\}<\/div>\}/);
  assert.match(modal, /\{lostCards\.length>0&&<div role="alert"[^>]*>\{weekdayChangeMessage\(lostCards\)\}<\/div>\}/);
  assert.match(modal, /\{removalBlocked\.length>0&&<div role="alert"[^>]*>\{studentRemovalMessage\(removalBlocked\)\}<\/div>\}/);
  assert.equal((modal.match(/onSaveClass\(/g) || []).length, 2);
});

test("non-recurring classes (no scope prompt) honour a refusal and keep the edit screen open", () => {
  const onSave = slice("{editCls&&<EditClassScreen", "onCreateStudent={onAddStudent}");
  assert.match(onSave, /const msg=editRefusalMessage\(onSaveClass\(u,true\)\);\s*if\(msg\)\{alert\(msg\);return;\}\s*setEditCls\(null\);/);
});

test("EditClassScreen: regenerates from the selected date and never sends the card's state", () => {
  const screen = slice("function EditClassScreen(", "\nfunction ");
  assert.match(screen, /newOccurrences=regenerateOccurrences\(\{previous:cls\.occurrences\|\|\[\],dowSet:classDowSetFrom\(days\),fromDate:cls\.date,todayDate:todayIso\(\)/);
  assert.match(screen, /onSave\(\{\.\.\.editableFromCard\(cls\),title,court,days,time:t1,timeEnd:t2,students:clsSt,/);
  assert.ok(!/const sd=cls\.startDate\|\|cls\.date;/.test(screen), "no regeneration from the class start date");
});

test("handleSaveClass: Solo esta clase is re-checked first; edits never enter the per-date branch", () => {
  const save = slice("const handleSaveClass=(cd,isEdit=false)=>{", "return createNewClass(cd);");
  const guard = save.indexOf("if(cd._singleDate){");
  const check = save.indexOf("singleDateEditChanges(latestClassesRef.current.find(c2=>c2.id===realId),cd,latestStudentsRef.current.map(s=>s.id))", guard);
  const refuse = save.indexOf('if(changes.length>0) return {status:"single-date-edit-refused",changes};', check);
  const perDate = save.indexOf('if(!cd._singleDate&&!cd.applyToAll&&(cd.cancelled===true||cd.cancelType==="paused"||cd._resuming||cd._reactivating)&&editDate){');
  const firstWrite = save.indexOf("setClasses(", guard);
  assert.ok(guard > 0 && check > guard && refuse > check && perDate > refuse && firstWrite > perDate, "order");
});

test("handleSaveClass: removal and lost-card refusals run on the latest state before any edit write", () => {
  const save = slice("const handleSaveClass=(cd,isEdit=false)=>{", "return createNewClass(cd);");
  const edit = save.slice(save.indexOf("const hasRecurringSpEdit="));
  const removal = edit.indexOf("studentRemovalBlock({series:latestSeries,students:latestStudentsRef.current,nextStudentIds:cd.students})");
  const removalRet = edit.indexOf('if(blocked.length>0) return {status:"student-removal-blocked",blocked};', removal);
  const lost = edit.indexOf("comboDatesLeftWithoutCard({series:latestSeries,students:latestStudentsRef.current,nextOccurrences:cd.occurrences,todayDate:todayIso()})", removalRet);
  const lostRet = edit.indexOf('if(affected.length>0) return {status:"weekday-change-blocked",affected};', lost);
  const apply = edit.indexOf("applyEditToClass(cd, realId);", lostRet);
  const remove = edit.indexOf("removeStudentsFromClass(cd, realId);", apply);
  const packs = edit.indexOf("updateStudentPacks(cd);", remove);
  assert.ok(edit.indexOf("const latestSeries=latestClassesRef.current.find(c2=>c2.id===realId);") >= 0);
  assert.ok(removal > 0 && removalRet > removal && lost > removalRet && lostRet > lost && apply > lostRet && remove > apply && packs > remove, "order");
});

test("applyEditToClass: Solo esta clase writes only the occurrences; A Todas merges only series fields", () => {
  const apply = slice("const applyEditToClass=(cd,realId)=>{", "\n  };\n");
  assert.match(apply, /keepDatesWithHistory\(\{previous:c\.occurrences\|\|\[\],next:cd\.occurrences,attendanceLog:c\.attendanceLog,dateCancellations:c\.dateCancellations,addedDates:c\.addedDates,todayDate:todayIso\(\)\}\)/);
  assert.match(apply, /if\(cd\._singleDate\)\{[\s\S]*?setClasses\(p=>p\.map\(c=>c\.id===realId\?\{\.\.\.c,occurrences:occurrencesKeepingHistory\(c\)\}:c\)\);\s*return;\s*\}/);
  assert.match(apply, /return \{\.\.\.c,\.\.\.seriesFieldsFromEdit\(cd\),id:realId,date:c\.date,occurrences:occurrencesKeepingHistory\(c\),attendanceLog:c\.attendanceLog\};/);
  // non-recurring classes (no scope prompt) keep their own path, including the date change
  assert.match(apply, /setClasses\(p=>p\.map\(c=>c\.id===realId\?\{\.\.\.c,\.\.\.cd,id:realId,attendanceLog:c\.attendanceLog\}:c\)\);/);
  assert.ok(apply.indexOf("if(cd._occOnly){") < apply.indexOf("if(cd._singleDate){"), "_occOnly untouched and first");
});

test("removeStudentsFromClass cleans combos with the same helper the removal guard judges", () => {
  const rem = slice("const removeStudentsFromClass=(cd,realId)=>{", "\n  };\n");
  assert.match(rem, /return \{\.\.\.s,combos:cleanCombosAfterClassRemoval\(s\.combos,realId,classDates\)\};/);
  assert.ok(!/filteredDates/.test(rem), "no second copy of the cleaning logic");
});
