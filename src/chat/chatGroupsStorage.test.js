import { test } from "node:test";
import assert from "node:assert/strict";
import { chatGroupsKey, isAdoptableGroup, loadChatGroups, saveChatGroups } from "./chatGroupsStorage.js";
import { createTestStorage } from "../data/testStorage.js";

// BUG-ISO-01: Chat groups lived in one shared localStorage key ("izi_groups"): after coach A's
// session expired, coach B logging into the same browser saw A's groups. Now one key per coach;
// legacy groups are adopted only when every member unambiguously belongs to the coach.

const A = "coach-a-uuid";
const B = "coach-b-uuid";
const A_STUDENTS = [1717000000001, 1717000000002, 1717000000003];
const B_STUDENTS = [1729000000001, 1729000000002];
const g = (id, members, extra = {}) => ({ id, name: "Grupo " + id, avatar: "G", isGroup: true, members, ...extra });
const read = (storage, key) => JSON.parse(storage.getItem(key));

test("each coach reads and writes only its own key", () => {
  const storage = createTestStorage();
  assert.equal(saveChatGroups(storage, A, [g("gA", [A_STUDENTS[0]])]), true);
  assert.equal(saveChatGroups(storage, B, [g("gB", [B_STUDENTS[0]])]), true);
  assert.deepEqual(loadChatGroups(storage, A, A_STUDENTS).map((x) => x.id), ["gA"]);
  assert.deepEqual(loadChatGroups(storage, B, B_STUDENTS).map((x) => x.id), ["gB"]);
  assert.equal(chatGroupsKey(A), "izi_chat_groups:" + A);
  assert.equal(storage.getItem("izi_groups"), null);
});

test("no coach id: nothing is read or written", () => {
  const storage = createTestStorage({ izi_groups: JSON.stringify([g("g1", [A_STUDENTS[0]])]) });
  for (const id of [undefined, null, "", "   "]) {
    assert.deepEqual(loadChatGroups(storage, id, A_STUDENTS), []);
    assert.equal(saveChatGroups(storage, id, []), false);
  }
  assert.deepEqual(Object.keys(storage.dump()), ["izi_groups"]);
});

test("legacy groups whose members all belong to the coach are adopted, then the legacy key is removed", () => {
  const legacy = [g("g1", [A_STUDENTS[0], A_STUDENTS[1]]), g("g2", [String(A_STUDENTS[2])])];
  const storage = createTestStorage({ izi_groups: JSON.stringify(legacy) });
  assert.deepEqual(loadChatGroups(storage, A, A_STUDENTS).map((x) => x.id), ["g1", "g2"]);
  assert.deepEqual(read(storage, chatGroupsKey(A)).map((x) => x.id), ["g1", "g2"]);
  assert.equal(storage.getItem("izi_groups"), null);
});

test("ambiguous groups stay in the legacy key, neither shown nor deleted", () => {
  const legacy = [
    g("empty", []),
    g("noMembers", undefined),
    g("foreign", [B_STUDENTS[0]]),
    g("mixed", [A_STUDENTS[0], B_STUDENTS[0]]),
    g("badId", [A_STUDENTS[0], null]),
    g("blankId", [""]),
    { name: "no id", members: [A_STUDENTS[0]] },
    "not-an-object",
    null,
  ];
  const storage = createTestStorage({ izi_groups: JSON.stringify(legacy) });
  assert.deepEqual(loadChatGroups(storage, A, A_STUDENTS), []);
  assert.deepEqual(read(storage, "izi_groups"), JSON.parse(JSON.stringify(legacy)));
  assert.equal(storage.getItem(chatGroupsKey(A)), null);
});

test("a mixed legacy key is split: A adopts its own, B's stay for B, nothing is lost", () => {
  const legacy = [g("gA", [A_STUDENTS[0]]), g("gB", [B_STUDENTS[0], B_STUDENTS[1]]), g("empty", [])];
  const storage = createTestStorage({ izi_groups: JSON.stringify(legacy) });
  assert.deepEqual(loadChatGroups(storage, A, A_STUDENTS).map((x) => x.id), ["gA"]);
  assert.deepEqual(read(storage, "izi_groups").map((x) => x.id), ["gB", "empty"]);
  assert.deepEqual(loadChatGroups(storage, B, B_STUDENTS).map((x) => x.id), ["gB"]);
  assert.deepEqual(read(storage, "izi_groups").map((x) => x.id), ["empty"]);
  // A never sees B's group, B never sees A's.
  assert.deepEqual(loadChatGroups(storage, A, A_STUDENTS).map((x) => x.id), ["gA"]);
});

test("a coach without students adopts nothing", () => {
  const storage = createTestStorage({ izi_groups: JSON.stringify([g("g1", [A_STUDENTS[0]])]) });
  assert.deepEqual(loadChatGroups(storage, A, []), []);
  assert.ok(storage.getItem("izi_groups"));
});

test("adoption is idempotent and keeps the coach's existing groups", () => {
  const storage = createTestStorage({
    [chatGroupsKey(A)]: JSON.stringify([g("own", [A_STUDENTS[0]])]),
    izi_groups: JSON.stringify([g("own", [A_STUDENTS[0]]), g("new", [A_STUDENTS[1]])]),
  });
  assert.deepEqual(loadChatGroups(storage, A, A_STUDENTS).map((x) => x.id), ["own", "new"]);
  assert.deepEqual(loadChatGroups(storage, A, A_STUDENTS).map((x) => x.id), ["own", "new"]);
  assert.equal(storage.getItem("izi_groups"), null);
});

test("corrupt data is never overwritten or lost", () => {
  const corruptLegacy = createTestStorage({ izi_groups: "{not json" });
  assert.deepEqual(loadChatGroups(corruptLegacy, A, A_STUDENTS), []);
  assert.equal(corruptLegacy.getItem("izi_groups"), "{not json");

  const corruptOwn = createTestStorage({ [chatGroupsKey(A)]: "{oops", izi_groups: JSON.stringify([g("g1", [A_STUDENTS[0]])]) });
  assert.deepEqual(loadChatGroups(corruptOwn, A, A_STUDENTS), []);
  assert.equal(corruptOwn.getItem(chatGroupsKey(A)), "{oops");
  assert.ok(corruptOwn.getItem("izi_groups"));
});

test("if writing the coach's key fails, the legacy groups stay where they were", () => {
  const legacy = [g("g1", [A_STUDENTS[0]])];
  const storage = createTestStorage({ izi_groups: JSON.stringify(legacy) }, { failWritesFor: (k) => k === chatGroupsKey(A) });
  assert.deepEqual(loadChatGroups(storage, A, A_STUDENTS), []);
  assert.deepEqual(read(storage, "izi_groups"), legacy);
});

test("isAdoptableGroup: every rule", () => {
  const ids = new Set(A_STUDENTS.map(String));
  assert.equal(isAdoptableGroup(g("x", [A_STUDENTS[0]]), ids), true);
  assert.equal(isAdoptableGroup(g("x", []), ids), false);
  assert.equal(isAdoptableGroup(g("x", [B_STUDENTS[0]]), ids), false);
  assert.equal(isAdoptableGroup(g("", [A_STUDENTS[0]]), ids), false);
  assert.equal(isAdoptableGroup(g("x", [NaN]), ids), false);
  assert.equal(isAdoptableGroup(g("x", "1717000000001"), ids), false);
});
