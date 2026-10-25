import { CHAT_GROUPS_PREFIX, LEGACY_GROUPS_KEY } from "../data/localCaches.js";

/*
 * Chat groups, isolated per coach (BUG-ISO-01). Pure, no React; the storage is injected
 * (localStorage in the app). Groups are device-local only (not in coach_data).
 *
 * Legacy groups (the shared "izi_groups" key) are adopted by a coach only when EVERY member
 * unambiguously belongs to that coach: a non-empty member list, every member a valid id, every
 * id among the coach's own students. Anything else — no members, an unknown or foreign member,
 * a malformed group or a corrupt key — stays in the legacy key, neither shown nor deleted.
 * The legacy key is removed only once every group in it has been adopted.
 */

export const chatGroupsKey = (coachId) => CHAT_GROUPS_PREFIX + coachId;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isValidId = (v) => (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.trim() !== "");

/** { ok:true, value:Array|null } (null = absent) or { ok:false } for unreadable/corrupt data. */
function readArray(storage, key) {
  let raw;
  try {
    raw = storage.getItem(key);
  } catch {
    return { ok: false };
  }
  if (raw === null || raw === undefined) return { ok: true, value: null };
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? { ok: true, value: parsed } : { ok: false };
  } catch {
    return { ok: false };
  }
}

function writeJson(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Whether a legacy group can be attributed to the coach whose student ids are given. */
export function isAdoptableGroup(group, studentIdSet) {
  if (!isObject(group) || !isValidId(group.id)) return false;
  const members = group.members;
  if (!Array.isArray(members) || members.length === 0) return false;
  return members.every((m) => isValidId(m) && studentIdSet.has(String(m)));
}

/**
 * The coach's groups. Adopts the unambiguous legacy groups first (written to the coach's key
 * BEFORE they leave the legacy key, so a failed write never loses one).
 */
export function loadChatGroups(storage, coachId, studentIds) {
  if (!isValidId(coachId)) return [];
  const ownKey = chatGroupsKey(coachId);
  const own = readArray(storage, ownKey);
  // A corrupt own key is left untouched (no overwrite, no adoption on top of it).
  if (!own.ok) return [];
  let groups = (own.value || []).filter(isObject);

  const legacy = readArray(storage, LEGACY_GROUPS_KEY);
  if (!legacy.ok || !legacy.value || legacy.value.length === 0) return groups;

  const ids = new Set((studentIds || []).filter(isValidId).map(String));
  const ownIds = new Set(groups.map((g) => String(g.id)));
  const adopt = [];
  const keep = [];
  for (const g of legacy.value) {
    if (isAdoptableGroup(g, ids)) {
      if (!ownIds.has(String(g.id))) adopt.push(g);
      // Same id already in this coach's key: that copy is kept; the legacy duplicate is dropped.
    } else {
      keep.push(g);
    }
  }
  if (adopt.length === 0 && keep.length === legacy.value.length) return groups;

  const next = [...groups, ...adopt];
  if (adopt.length > 0 && !writeJson(storage, ownKey, next)) return groups;
  if (keep.length === 0) {
    try {
      storage.removeItem(LEGACY_GROUPS_KEY);
    } catch {
      /* the adopted copies are already safe in the coach's key */
    }
  } else if (keep.length < legacy.value.length) {
    writeJson(storage, LEGACY_GROUPS_KEY, keep);
  }
  return next;
}

/** Saves the coach's groups to the coach's own key only. Returns false when nothing was written. */
export function saveChatGroups(storage, coachId, groups) {
  if (!isValidId(coachId) || !Array.isArray(groups)) return false;
  return writeJson(storage, chatGroupsKey(coachId), groups);
}
