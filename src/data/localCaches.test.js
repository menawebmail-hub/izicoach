import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LEGACY_BUSINESS_CACHE_KEYS,
  clearLegacyBusinessCaches,
  clearLocalStateExceptPreserved,
  isPreservedLocalKey,
} from "./localCaches.js";
import { createTestStorage } from "./testStorage.js";

// BUG-ISO-01 / BUG-ISO-02: the session cleanup never removes unsynced outbox entries, Chat groups
// or the legacy business caches (old unsynced changes); the legacy caches are removed only by an
// explicit clearLegacyBusinessCaches() call, which the app does not make yet.

const OUTBOX_A = "izi_outbox:coach-a:classes:tab1:inFlight";
const OUTBOX_A2 = "izi_outbox:coach-a:students:tab1:pendingLatest";
const OUTBOX_B = "izi_outbox:coach-b:classes:tab9:inFlight";
const pending = JSON.stringify({ status: "pending", mutationToken: "m1", payload: [{ id: 1 }] });

function deviceWithEverything() {
  return createTestStorage({
    [OUTBOX_A]: pending,
    [OUTBOX_A2]: pending,
    [OUTBOX_B]: pending,
    "izi_chat_groups:coach-a": "[]",
    izi_groups: "[]",
    ...Object.fromEntries(LEGACY_BUSINESS_CACHE_KEYS.map((k) => [k, "[{\"id\":1}]"])),
    izi_mode: "\"coach\"",
    izi_onboarded: "true",
    izi_student_coach_id: "\"x\"",
    "sb-project-auth-token": "token-not-ours",
    other_app_key: "keep",
  });
}

test("session cleanup removes only session keys; outbox (pending entries), groups and legacy caches survive", () => {
  const storage = deviceWithEverything();
  const removed = clearLocalStateExceptPreserved(storage).sort();
  assert.deepEqual(removed, ["izi_mode", "izi_onboarded", "izi_student_coach_id"]);
  const left = storage.dump();
  for (const k of [OUTBOX_A, OUTBOX_A2, OUTBOX_B]) assert.equal(left[k], pending, k);
  assert.equal(left["izi_chat_groups:coach-a"], "[]");
  assert.equal(left.izi_groups, "[]");
  for (const k of LEGACY_BUSINESS_CACHE_KEYS) assert.ok(left[k], k);
  assert.equal(left["sb-project-auth-token"], "token-not-ours");
  assert.equal(left.other_app_key, "keep");
});

test("clearLegacyBusinessCaches removes exactly the six caches and nothing else", () => {
  const storage = deviceWithEverything();
  assert.deepEqual(clearLegacyBusinessCaches(storage), [...LEGACY_BUSINESS_CACHE_KEYS]);
  const left = storage.dump();
  for (const k of LEGACY_BUSINESS_CACHE_KEYS) assert.equal(left[k], undefined, k);
  for (const k of [OUTBOX_A, OUTBOX_A2, OUTBOX_B]) assert.equal(left[k], pending, k);
  for (const k of ["izi_chat_groups:coach-a", "izi_groups", "izi_mode", "izi_onboarded", "izi_student_coach_id", "sb-project-auth-token", "other_app_key"]) {
    assert.ok(k in left, k);
  }
  // Idempotent: nothing left to remove.
  assert.deepEqual(clearLegacyBusinessCaches(storage), []);
});

test("isPreservedLocalKey: exact rules (never by loose prefix)", () => {
  assert.equal(isPreservedLocalKey("izi_outbox:coach:students:tab:inFlight"), true);
  assert.equal(isPreservedLocalKey("izi_chat_groups:coach"), true);
  assert.equal(isPreservedLocalKey("izi_groups"), true);
  for (const k of LEGACY_BUSINESS_CACHE_KEYS) assert.equal(isPreservedLocalKey(k), true, k);
  for (const k of ["izi_outboxX", "izi_students_backup", "izi_groups2", "izi_mode", "izi_onboarded", 42, null]) {
    assert.equal(isPreservedLocalKey(k), false, String(k));
  }
});

test("the app wiring: no legacy cache is written, the cleanup is not called automatically, Chat is per coach", () => {
  const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  const coachData = readFileSync(new URL("./coachData.js", import.meta.url), "utf8");
  for (const k of LEGACY_BUSINESS_CACHE_KEYS) {
    assert.doesNotMatch(app, new RegExp(`setItem\\(\\s*"${k}"|lsSet\\(\\s*"${k}"`), k);
  }
  assert.doesNotMatch(app, /lsSet/);
  // Never imported nor called (a mention in a comment is fine).
  for (const src of [app, coachData]) {
    assert.doesNotMatch(src, /import[^;]*clearLegacyBusinessCaches/);
    assert.doesNotMatch(src, /clearLegacyBusinessCaches\(\s*[A-Za-z_]/);
  }
  // Chat groups: per-coach storage, and Chat starts fresh for every identity.
  assert.doesNotMatch(app, /"izi_groups"/);
  assert.match(app, /useState\(\(\)=>loadChatGroups\(localStorage,userId,students\.map\(s=>s\.id\)\)\)/);
  assert.match(app, /saveChatGroups\(localStorage,userId,next\)/);
  assert.match(app, /<Chat key=\{user\?\.id\|\|"no-user"\} /);
  // Session cleanup delegates to the preserved-keys rules.
  assert.match(coachData, /clearLocalStateExceptPreserved\(localStorage\);/);
  // Identity change and logout keep their existing guards.
  assert.match(app, /if\(previousIdentity\) cancelPendingSync\(previousIdentity\);/);
  assert.match(app, /clearLocalStateExceptOutbox\(\);\s*resetBusinessState\(\);/);
});
