import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  UNAVAILABLE_MEMBER_NAME,
  groupMemberCount,
  groupMemberNames,
  groupMembersLabel,
} from "./groupMembers.js";
import { saveChatGroups } from "./chatGroupsStorage.js";
import { createTestStorage } from "../data/testStorage.js";

const students = [
  { id: 1785989420999, name: "Ana", avatar: "AN" },
  { id: 1785987555098, name: "Bruno", avatar: "BR" },
  { id: 1786000000000, name: "Carla" },
];

test("members keep the order the coach selected them, not the student list order", () => {
  const group = { id: "g1", isGroup: true, members: [1785987555098, 1786000000000, 1785989420999] };
  assert.deepEqual(
    groupMemberNames(group, students).map((m) => m.name),
    ["Bruno", "Carla", "Ana"],
  );
});

test("a deleted student reads 'Alumno no disponible' and keeps its place", () => {
  const group = { id: "g1", members: [1785989420999, 999, 1785987555098] };
  const members = groupMemberNames(group, students);
  assert.deepEqual(members.map((m) => m.name), ["Ana", UNAVAILABLE_MEMBER_NAME, "Bruno"]);
  assert.deepEqual(members.map((m) => m.available), [true, false, true]);
  assert.equal(members[1].avatar, "?");
  assert.equal(UNAVAILABLE_MEMBER_NAME, "Alumno no disponible");
});

test("ids match whether stored as numbers or strings; a missing avatar falls back to '?'", () => {
  const members = groupMemberNames({ members: ["1785989420999", 1786000000000] }, students);
  assert.deepEqual(members.map((m) => [m.name, m.avatar, m.available]), [
    ["Ana", "AN", true],
    ["Carla", "?", true],
  ]);
});

test("keys stay unique even if an id repeats", () => {
  const members = groupMemberNames({ members: [1785989420999, 1785989420999] }, students);
  assert.equal(new Set(members.map((m) => m.key)).size, 2);
});

test("malformed groups or student lists never throw", () => {
  for (const group of [null, undefined, {}, { members: null }, { members: "x" }]) {
    assert.deepEqual(groupMemberNames(group, students), []);
    assert.equal(groupMemberCount(group), 0);
  }
  assert.deepEqual(
    groupMemberNames({ members: [1, null] }, null).map((m) => m.available),
    [false, false],
  );
});

test("the count includes unavailable members; label singular and plural", () => {
  assert.equal(groupMemberCount({ members: [1785989420999, 999] }), 2);
  assert.equal(groupMembersLabel(0), "0 integrantes");
  assert.equal(groupMembersLabel(1), "1 integrante");
  assert.equal(groupMembersLabel(2), "2 integrantes");
});

test("saveChatGroups reports a failed write, so the app can refuse to show the group", () => {
  const storage = createTestStorage({}, { failWritesFor: (k) => k === "izi_chat_groups:coach-a" });
  assert.equal(saveChatGroups(storage, "coach-a", [{ id: "g1", members: [1] }]), false);
  assert.equal(storage.getItem("izi_chat_groups:coach-a"), null);
});

test("the app wiring: group header, members panel, save failure; individual chats unchanged", () => {
  const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  assert.match(app, /import \{ groupMemberCount, groupMemberNames, groupMembersLabel \} from "\.\/chat\/groupMembers\.js";/);
  // Group header: "N integrantes · Ver/Ocultar"; individual chats keep "En línea".
  assert.match(app, /active\.isGroup\s*\?/);
  assert.match(app, /groupMembersLabel\(groupMemberCount\(active\)\)\+" · "\+\(showMembers\?"Ocultar":"Ver"\)/);
  assert.match(app, /<div style=\{\{fontSize:11,color:C\.muted\}\}>En línea<\/div>/);
  // The panel lists the members in order and can be closed.
  assert.match(app, /active\.isGroup&&showMembers&&/);
  assert.match(app, /groupMemberNames\(active,students\)\.map\(/);
  assert.match(app, /onClick=\{\(\)=>setShowMembers\(false\)\}/);
  // A group is added to the list only after it was saved.
  assert.match(app, /if\(!saveChatGroups\(localStorage,userId,next\)\) return false;\s*setGroups\(next\);/);
  assert.match(app, /if\(onCreate\(\{id:"g"\+Date\.now\(\)/);
  assert.match(app, /setSaveError\(true\)/);
});
